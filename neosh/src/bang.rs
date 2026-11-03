//! bash's history expansion (NSH-24): `!!`, `!$`, `!n`, `!text`, `^old^new`,
//! and the modifiers after them (NSH-32): `:h`, `:t`, `:s/a/b/`, `:p`.

/// What expanding a line gave: the line, and whether `:p` asked for it to be
/// printed and kept in history but not run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expanded {
    pub line: String,
    pub print: bool,
}

/// The last substitution, which `:&` and an empty `:s//new/` use, kept from
/// line to line as bash keeps it.
#[derive(Debug, Clone, Default)]
pub struct Memory {
    old: String,
    new: String,
}

/// The line with its history references expanded, `None` when it has none,
/// or what bash would say when one names nothing. `history` is oldest first.
#[cfg(test)]
pub fn expand(line: &str, history: &[String]) -> Result<Option<String>, String> {
    expand_with(line, history, &mut Memory::default()).map(|e| e.map(|e| e.line))
}

/// As `expand`, remembering substitutions in `memory` and saying when `:p`
/// was used.
pub fn expand_with(line: &str, history: &[String], memory: &mut Memory) -> Result<Option<Expanded>, String> {
    if let Some(rest) = line.strip_prefix('^') {
        return quick(rest, history, memory).map(|line| Some(Expanded { line, print: false }));
    }
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let (mut single, mut double, mut changed, mut print) = (false, false, false, false);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' if !single => {
                out.push(c);
                if let Some(&n) = chars.get(i + 1) {
                    out.push(n);
                }
                i += 2;
                continue;
            }
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            '!' if !single && expands(&chars, i, double) => {
                let (text, used, printed) = reference(&chars[i + 1..], history, memory)?;
                out += &text;
                print |= printed;
                changed = true;
                i += 1 + used;
                continue;
            }
            _ => {}
        }
        out.push(c);
        i += 1;
    }
    Ok(changed.then_some(Expanded { line: out, print }))
}

/// Whether the `!` at `i` starts a reference, as bash decides.
fn expands(chars: &[char], i: usize, double: bool) -> bool {
    let before = |n: usize| i.checked_sub(n).map(|j| chars[j]);
    if before(1) == Some('$') || (before(1) == Some('{') && before(2) == Some('$')) {
        return false;
    }
    match chars.get(i + 1) {
        None => false,
        Some(c) if c.is_whitespace() || *c == '=' || *c == '(' => false,
        Some('"') => !double,
        _ => true,
    }
}

/// The reference after a `!`, how many characters it took, and whether it
/// ended in `:p`.
fn reference(after: &[char], history: &[String], memory: &mut Memory) -> Result<(String, usize, bool), String> {
    let at = |n: usize| after.get(n).copied();
    let (event, mut used) = match at(0) {
        Some('!') => (history.last(), 1),
        // `!$`, `!^`, `!*`: the last command's words.
        Some('$' | '^' | '*') => (history.last(), 0),
        Some('-' | '0'..='9') => {
            let back = at(0) == Some('-');
            let skip = usize::from(back);
            let used = skip + after[skip..].iter().take_while(|c| c.is_ascii_digit()).count();
            let n = after[skip..used].iter().collect::<String>().parse::<usize>().ok().filter(|&n| n > 0);
            let index = n.and_then(|n| if back { history.len().checked_sub(n) } else { Some(n - 1) });
            (index.and_then(|i| history.get(i)), used)
        }
        Some('?') => {
            let end = after[1..].iter().position(|&c| c == '?').map(|p| p + 1);
            let text: String = after[1..end.unwrap_or(after.len())].iter().collect();
            let used = end.map_or(after.len(), |e| e + 1);
            memory.old.clone_from(&text);
            (history.iter().rev().find(|l| l.contains(&text)), used)
        }
        _ => {
            let n = after.iter().take_while(|c| !c.is_whitespace() && !matches!(c, ':' | ';' | '&' | '|' | '"' | '\'' | '<' | '>' | '(' | ')')).count();
            let text: String = after[..n].iter().collect();
            (history.iter().rev().find(|l| l.starts_with(&text)), n)
        }
    };
    let taken: String = after[..used].iter().collect();
    let Some(event) = event else {
        return Err(format!("!{taken}: event not found"));
    };
    // Words: `:n` and the like, or `$`, `^`, `*` straight after.
    let spec_start = match at(used) {
        Some(':') if at(used + 1).is_some_and(|c| c.is_ascii_digit() || matches!(c, '^' | '$' | '*' | '-')) => Some(used + 1),
        Some('$' | '^' | '*') => Some(used),
        _ => None,
    };
    let mut text = event.clone();
    if let Some(start) = spec_start {
        let spec_len = after[start..].iter().take_while(|c| c.is_ascii_digit() || matches!(c, '^' | '$' | '*' | '-')).count();
        let spec: String = after[start..start + spec_len].iter().collect();
        used = start + spec_len;
        let all: String = after[..used].iter().collect();
        text = pick(&words(event), &spec).ok_or_else(|| format!("!{all}: bad word specifier"))?;
    }
    let mut print = false;
    while at(used) == Some(':') && at(used + 1).is_some_and(|c| c.is_ascii_alphabetic() || c == '&') {
        let (changed, took, printed) = modify(&text, &after[used + 1..], memory)?;
        text = changed;
        used += 1 + took;
        print |= printed;
    }
    Ok((text, used, print))
}

/// NSH-32: one modifier after a `:` applied to `text`, how many characters it
/// took, and whether it was `:p`.
fn modify(text: &str, after: &[char], memory: &mut Memory) -> Result<(String, usize, bool), String> {
    let at = |n: usize| after.get(n).copied();
    let cut = |c: char| text.rfind(c);
    let changed = match at(0) {
        Some('h') => cut('/').map_or(text, |i| &text[..i]).to_string(),
        Some('t') => cut('/').map_or(text, |i| &text[i + 1..]).to_string(),
        Some('r') => cut('.').map_or(text, |i| &text[..i]).to_string(),
        Some('e') => cut('.').map_or(text, |i| &text[i..]).to_string(),
        Some('q') => quote(text),
        Some('x') => text.split_whitespace().map(quote).collect::<Vec<_>>().join(" "),
        Some('p') => return Ok((text.to_string(), 1, true)),
        Some('&') => return substitute(text, false, 1, after, memory),
        Some('g' | 'a') if at(1) == Some('&') => return substitute(text, true, 2, after, memory),
        Some('s') => return substituted(text, false, 1, after, memory),
        Some('g' | 'a') if at(1) == Some('s') => return substituted(text, true, 2, after, memory),
        _ => {
            let word: String = after.iter().take_while(|c| c.is_ascii_alphabetic()).collect();
            return Err(format!(":{word}: unrecognized history modifier"));
        }
    };
    Ok((changed, 1, false))
}

/// `s/old/new/` from `after[from..]`: any delimiter, `\` before it quoting it,
/// `&` in new standing for old, the last delimiter optional at the end.
fn substituted(text: &str, global: bool, from: usize, after: &[char], memory: &mut Memory) -> Result<(String, usize, bool), String> {
    let Some(&delim) = after.get(from) else {
        return Err(format!(":{}: substitution failed", after.iter().collect::<String>()));
    };
    let mut i = from + 1;
    let mut part = || {
        let mut s = String::new();
        while let Some(&c) = after.get(i) {
            i += 1;
            if c == delim {
                return s;
            }
            if c == '\\' && after.get(i) == Some(&delim) {
                s.push(delim);
                i += 1;
            } else {
                s.push(c);
            }
        }
        s
    };
    let old = part();
    let new = part();
    let written: String = after[..i].iter().collect();
    if !old.is_empty() {
        memory.old = old;
    } else if memory.old.is_empty() {
        return Err(format!(":{written}: no previous substitution"));
    }
    memory.new = replace_amp(&new, &memory.old);
    substitute(text, global, i, after, memory).map_err(|_| format!(":{written}: substitution failed"))
}

/// `new` with each `&` made `old`, and `\&` a plain `&`.
fn replace_amp(new: &str, old: &str) -> String {
    let mut out = String::new();
    let mut chars = new.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'&') => out.push(chars.next().unwrap()),
            '&' => out += old,
            c => out.push(c),
        }
    }
    out
}

/// The remembered substitution applied to `text`, once or everywhere.
fn substitute(text: &str, global: bool, took: usize, after: &[char], memory: &Memory) -> Result<(String, usize, bool), String> {
    let written: String = after[..took].iter().collect();
    if memory.old.is_empty() {
        return Err(format!(":{written}: no previous substitution"));
    }
    if !text.contains(&memory.old) {
        return Err(format!(":{written}: substitution failed"));
    }
    let changed = if global { text.replace(&memory.old, &memory.new) } else { text.replacen(&memory.old, &memory.new, 1) };
    Ok((changed, took, false))
}

/// `text` in single quotes, each `'` in it written `'\''`.
fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// Words `spec` names: `n`, `n-m`, `n-`, `n*`, `^`, `$`, `*`.
fn pick(words: &[String], spec: &str) -> Option<String> {
    let last = words.len().checked_sub(1)?;
    let index = |s: &str| match s {
        "^" => Some(1),
        "$" => Some(last),
        _ => s.parse::<usize>().ok(),
    };
    let (from, to) = if spec == "*" {
        if last == 0 {
            return Some(String::new());
        }
        (1, last)
    } else if let Some(from) = spec.strip_suffix('*') {
        (index(from)?, last)
    } else if let Some((from, to)) = spec.split_once('-') {
        let from = if from.is_empty() { 0 } else { index(from)? };
        let to = if to.is_empty() { last.checked_sub(1)? } else { index(to)? };
        (from, to)
    } else {
        let n = index(spec)?;
        (n, n)
    };
    (from <= to && to <= last).then(|| words[from..=to].join(" "))
}

/// A command line's words, quotes kept with the word they are in.
fn words(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let (mut single, mut double, mut escaped) = (false, false, false);
    for c in line.chars() {
        match c {
            _ if escaped => escaped = false,
            '\\' if !single => escaped = true,
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            c if c.is_whitespace() && !single && !double => {
                if !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                continue;
            }
            _ => {}
        }
        word.push(c);
    }
    if !word.is_empty() {
        words.push(word);
    }
    words
}

/// `^old^new[^]`: the last command with the first `old` made `new`.
fn quick(rest: &str, history: &[String], memory: &mut Memory) -> Result<String, String> {
    let (old, new) = rest.split_once('^').unwrap_or((rest, ""));
    let new = new.strip_suffix('^').unwrap_or(new);
    let last = history.last().ok_or_else(|| format!("^{rest}: event not found"))?;
    if old.is_empty() || !last.contains(old) {
        return Err(format!(":s^{rest}: substitution failed"));
    }
    memory.old = old.to_string();
    memory.new = replace_amp(new, old);
    Ok(last.replacen(old, &memory.new, 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h() -> Vec<String> {
        ["git status", "make install PREFIX=/opt", "cp a.txt 'b c.txt' /tmp"].map(String::from).to_vec()
    }
    fn x(line: &str) -> Result<Option<String>, String> {
        expand(line, &h())
    }
    fn ok(line: &str) -> String {
        x(line).unwrap().unwrap_or_else(|| panic!("{line} expands"))
    }

    // NSH-24
    #[test]
    fn events_name_earlier_commands() {
        assert_eq!(ok("sudo !!"), "sudo cp a.txt 'b c.txt' /tmp");
        assert_eq!(ok("!1"), "git status");
        assert_eq!(ok("!-2"), "make install PREFIX=/opt");
        assert_eq!(ok("!gi"), "git status");
        assert_eq!(ok("!?PREFIX?"), "make install PREFIX=/opt");
        assert_eq!(ok("!?PREFIX"), "make install PREFIX=/opt");
        assert_eq!(ok("echo !git; ls"), "echo git status; ls");
        assert_eq!(x("!nope"), Err("!nope: event not found".into()));
        assert_eq!(x("!9"), Err("!9: event not found".into()));
        assert_eq!(x("!0"), Err("!0: event not found".into()));
        assert_eq!(expand("!!", &[]), Err("!!: event not found".into()));
    }

    // NSH-24
    #[test]
    fn words_are_picked_from_an_event() {
        assert_eq!(ok("ls !$"), "ls /tmp");
        assert_eq!(ok("ls !^"), "ls a.txt");
        assert_eq!(ok("echo !*"), "echo a.txt 'b c.txt' /tmp");
        assert_eq!(ok("echo !!:2"), "echo 'b c.txt'");
        assert_eq!(ok("echo !!:0"), "echo cp");
        assert_eq!(ok("echo !!:1-2"), "echo a.txt 'b c.txt'");
        assert_eq!(ok("echo !!:2*"), "echo 'b c.txt' /tmp");
        assert_eq!(ok("echo !!:1-"), "echo a.txt 'b c.txt'");
        assert_eq!(ok("echo !make:$"), "echo PREFIX=/opt");
        assert_eq!(ok("echo !1:1"), "echo status");
        assert_eq!(x("echo !!:9"), Err("!!:9: bad word specifier".into()));
    }

    // NSH-24
    #[test]
    fn a_bang_is_left_alone_where_bash_leaves_it() {
        for line in ["echo 'hi!!'", "echo hi\\!!", "[[ ! -f x ]]", "echo hi!", "a != b", "echo \"wow!\"", "echo $!", "echo ${!name}", "x!=y", "echo !(*.txt)"] {
            assert_eq!(x(line), Ok(None), "{line}");
        }
        // In double quotes it still expands, as in bash.
        assert_eq!(ok("echo \"!!\""), "echo \"cp a.txt 'b c.txt' /tmp\"");
    }

    // NSH-32: each as bash prints it.
    #[test]
    fn modifiers_change_what_a_reference_names() {
        let h = vec!["echo cp /usr/lib/a.tar.gz 'b c' x.d/y".to_string()];
        let m = |line: &str| expand(line, &h).unwrap().unwrap();
        assert_eq!(m("echo !:2:h !:2:t"), "echo /usr/lib a.tar.gz");
        assert_eq!(m("echo !:2:r !:2:e !:4:r !:4:e"), "echo /usr/lib/a.tar .gz x .d/y");
        assert_eq!(m("echo !:2:h:h !:3:q"), r"echo /usr ''\''b c'\'''");
        assert_eq!(m("echo !$:t"), "echo y");
        let h = vec!["echo foo foo bar".to_string()];
        let m = |line: &str| expand(line, &h).unwrap().unwrap();
        assert_eq!(m("!!:s/foo/X/"), "echo X foo bar");
        assert_eq!(m("!!:gs/foo/X/"), "echo X X bar");
        assert_eq!(m("!!:as/foo/X/"), "echo X X bar");
        assert_eq!(m("!!:s/foo/[&]/"), "echo [foo] foo bar");
        assert_eq!(m(r"!!:s/foo/\&/"), "echo & foo bar");
        assert_eq!(m("!!:s/foo/X"), "echo X foo bar");
        assert_eq!(m("!!:s|foo|a/b|"), "echo a/b foo bar");
        assert_eq!(m("!!:s/foo/X/:&"), "echo X X bar");
        assert_eq!(m("echo !:1:x"), "echo 'foo'");
        assert_eq!(m("!!:t"), "echo foo foo bar", "no / leaves it");
        assert_eq!(expand("!!:s/zz/y/", &h), Err(":s/zz/y/: substitution failed".into()));
        assert_eq!(expand("!!:z", &h), Err(":z: unrecognized history modifier".into()));
        assert_eq!(expand("!!:&", &h), Err(":&: no previous substitution".into()));
    }

    // NSH-32
    #[test]
    fn print_only_and_a_substitution_remembered_between_lines() {
        let h = vec!["echo a b".to_string()];
        let mut memory = Memory::default();
        let printed = expand_with("!!:s/a/Z/:p", &h, &mut memory).unwrap().unwrap();
        assert_eq!(printed, Expanded { line: "echo Z b".into(), print: true });
        let h = vec!["echo a a a".to_string()];
        let again = expand_with("!!:g&", &h, &mut memory).unwrap().unwrap();
        assert_eq!(again, Expanded { line: "echo Z Z Z".into(), print: false });
        // `^old^new` counts as one, `&` in it too.
        let mut memory = Memory::default();
        assert_eq!(expand_with("^a^[&]", &h, &mut memory).unwrap().unwrap().line, "echo [a] a a");
        assert_eq!(expand_with("!!:&", &h, &mut memory).unwrap().unwrap().line, "echo [a] a a");
        // `!?text?` sets what an empty `:s//new/` changes.
        let h = vec!["make foo".to_string(), "echo hi".to_string()];
        let mut memory = Memory::default();
        assert_eq!(expand_with("!?foo?:s//bar/", &h, &mut memory).unwrap().unwrap().line, "make bar");
    }

    // NSH-24
    #[test]
    fn a_quick_substitution_changes_the_last_command() {
        assert_eq!(ok("^/tmp^/var^"), "cp a.txt 'b c.txt' /var");
        assert_eq!(ok("^a.txt^z.txt"), "cp z.txt 'b c.txt' /tmp");
        assert_eq!(x("^nothere^x"), Err(":s^nothere^x: substitution failed".into()));
    }
}
