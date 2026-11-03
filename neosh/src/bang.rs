//! bash's history expansion (NSH-24): `!!`, `!$`, `!n`, `!text`, `^old^new`.

/// The line with its history references expanded, `None` when it has none,
/// or what bash would say when one names nothing. `history` is oldest first.
pub fn expand(line: &str, history: &[String]) -> Result<Option<String>, String> {
    if let Some(rest) = line.strip_prefix('^') {
        return quick(rest, history).map(Some);
    }
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let (mut single, mut double, mut changed) = (false, false, false);
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
                let (text, used) = reference(&chars[i + 1..], history)?;
                out += &text;
                changed = true;
                i += 1 + used;
                continue;
            }
            _ => {}
        }
        out.push(c);
        i += 1;
    }
    Ok(changed.then_some(out))
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

/// The reference after a `!` and how many characters it took.
fn reference(after: &[char], history: &[String]) -> Result<(String, usize), String> {
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
    let Some(start) = spec_start else {
        return Ok((event.clone(), used));
    };
    let spec_len = after[start..].iter().take_while(|c| c.is_ascii_digit() || matches!(c, '^' | '$' | '*' | '-')).count();
    let spec: String = after[start..start + spec_len].iter().collect();
    used = start + spec_len;
    let all: String = after[..used].iter().collect();
    let words = words(event);
    pick(&words, &spec).map(|w| (w, used)).ok_or_else(|| format!("!{all}: bad word specifier"))
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
fn quick(rest: &str, history: &[String]) -> Result<String, String> {
    let (old, new) = rest.split_once('^').unwrap_or((rest, ""));
    let new = new.strip_suffix('^').unwrap_or(new);
    let last = history.last().ok_or_else(|| format!("^{rest}: event not found"))?;
    if old.is_empty() || !last.contains(old) {
        return Err(format!(":s^{rest}: substitution failed"));
    }
    Ok(last.replacen(old, new, 1))
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

    // NSH-24
    #[test]
    fn a_quick_substitution_changes_the_last_command() {
        assert_eq!(ok("^/tmp^/var^"), "cp a.txt 'b c.txt' /var");
        assert_eq!(ok("^a.txt^z.txt"), "cp z.txt 'b c.txt' /tmp");
        assert_eq!(x("^nothere^x"), Err(":s^nothere^x: substitution failed".into()));
    }
}
