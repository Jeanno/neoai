//! Which lines history keeps, as bash decides with `HISTCONTROL` and
//! `HISTIGNORE` (NSH-26).

/// Whether history keeps `typed`, the line as typed, after `previous`.
pub fn keeps(typed: &str, previous: Option<&str>, control: Option<&str>, ignore: Option<&str>) -> bool {
    let line = typed.trim();
    let has = |word: &str| control.is_some_and(|c| c.split(':').any(|w| w.trim() == word || w.trim() == "ignoreboth" && word != "erasedups"));
    if line.is_empty() || has("ignorespace") && typed.starts_with(char::is_whitespace) {
        return false;
    }
    if has("ignoredups") && previous == Some(line) {
        return false;
    }
    let ignored = ignore.is_some_and(|patterns| {
        patterns.split(':').filter(|p| !p.is_empty()).any(|p| match p {
            "&" => previous == Some(line),
            _ => glob(&p.chars().collect::<Vec<_>>(), &line.chars().collect::<Vec<_>>()),
        })
    });
    !ignored
}

/// Whether earlier copies of a kept line are dropped (`erasedups`).
pub fn erases(control: Option<&str>) -> bool {
    control.is_some_and(|c| c.split(':').any(|w| w.trim() == "erasedups"))
}

/// A whole-line shell pattern: `*`, `?`, `[…]` (with `!` or `^` to negate), `\` to quote.
fn glob(p: &[char], t: &[char]) -> bool {
    match p.first() {
        None => t.is_empty(),
        Some('*') => (0..=t.len()).any(|i| glob(&p[1..], &t[i..])),
        Some('?') => !t.is_empty() && glob(&p[1..], &t[1..]),
        Some('[') => {
            let Some(close) = p.iter().skip(2).position(|&c| c == ']').map(|i| i + 2) else {
                return t.first() == Some(&'[') && glob(&p[1..], &t[1..]);
            };
            let Some(&c) = t.first() else { return false };
            let set = &p[1..close];
            let (negate, set) = match set.first() {
                Some('!' | '^') => (true, &set[1..]),
                _ => (false, set),
            };
            let mut hit = false;
            let mut i = 0;
            while i < set.len() {
                if i + 2 < set.len() && set[i + 1] == '-' {
                    hit |= set[i] <= c && c <= set[i + 2];
                    i += 3;
                } else {
                    hit |= set[i] == c;
                    i += 1;
                }
            }
            hit != negate && glob(&p[close + 1..], &t[1..])
        }
        Some('\\') if p.len() > 1 => t.first() == Some(&p[1]) && glob(&p[2..], &t[1..]),
        Some(&c) => t.first() == Some(&c) && glob(&p[1..], &t[1..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // NSH-26
    #[test]
    fn histcontrol_keeps_a_spaced_line_or_a_repeat_out() {
        assert!(keeps("echo a", None, None, None));
        assert!(keeps(" export TOKEN=x", None, None, None), "kept unless asked");
        for control in ["ignorespace", "ignoreboth", "ignoredups:ignorespace"] {
            assert!(!keeps(" export TOKEN=x", None, Some(control), None), "{control}");
        }
        assert!(!keeps("echo a", Some("echo a"), Some("ignoredups"), None));
        assert!(!keeps("echo a", Some("echo a"), Some("ignoreboth"), None));
        assert!(keeps("echo a", Some("echo b"), Some("ignoreboth"), None));
        assert!(keeps("echo a", Some("echo a"), Some("ignorespace"), None));
        assert!(keeps("echo a", Some("echo a"), Some("erasedups"), None));
        assert!(erases(Some("ignorespace:erasedups")) && !erases(Some("ignoreboth")) && !erases(None));
        assert!(!keeps("   ", None, None, None));
    }

    // NSH-26
    #[test]
    fn histignore_patterns_match_the_whole_line() {
        let ignore = Some("ls*:[bf]g:exit:&:? *");
        assert!(!keeps("ls -la", None, None, ignore));
        assert!(!keeps("bg", None, None, ignore));
        assert!(!keeps("fg", None, None, ignore));
        assert!(keeps("fg 2", None, None, ignore), "whole line");
        assert!(!keeps("exit", None, None, ignore));
        assert!(!keeps("make", Some("make"), None, ignore), "& is the line before");
        assert!(!keeps("? hi there", None, None, ignore));
        assert!(keeps("cat ls", None, None, ignore));
        assert!(!keeps("x", None, None, Some("[!a-m]")));
        assert!(keeps("c", None, None, Some("[!a-m]")));
        assert!(!keeps("a*b", None, None, Some("a\\*b")));
        assert!(keeps("axb", None, None, Some("a\\*b")));
    }
}
