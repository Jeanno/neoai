//! How long history is, as bash's `HISTSIZE` and `HISTFILESIZE` say (NSH-27).

use std::path::Path;

/// What both are when nothing sets them, as in bash.
pub const DEFAULT: &str = "500";

/// How many to keep, or `None` for all: a value below zero or not a number.
pub fn limit(value: Option<&str>) -> Option<usize> {
    value.and_then(|v| v.trim().parse::<i64>().ok()).and_then(|n| usize::try_from(n).ok())
}

/// The history file cut to its last `keep` commands, each with the
/// `#<seconds>` timestamp line before it, if any; left alone when shorter.
pub fn trim_file(path: &Path, keep: usize) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path)?;
    let mut entries: Vec<String> = Vec::new();
    let mut stamp: Option<&str> = None;
    for line in text.lines() {
        let is_stamp = line.len() > 1 && line.starts_with('#') && line[1..].chars().all(|c| c.is_ascii_digit());
        if is_stamp {
            stamp = Some(line);
            continue;
        }
        entries.push(match stamp.take() {
            Some(s) => format!("{s}\n{line}\n"),
            None => format!("{line}\n"),
        });
    }
    if entries.len() <= keep {
        return Ok(());
    }
    let kept = entries[entries.len() - keep..].concat();
    // Written beside it and moved over, so a crash leaves the old file whole.
    let fresh = path.with_extension(format!("neosh-trim-{}", std::process::id()));
    std::fs::write(&fresh, kept)?;
    std::fs::rename(&fresh, path)
}

/// The shell's history cut to its last `keep` commands.
pub fn trim_list(history: &mut brush_core::history::History, keep: usize) {
    while history.count() > keep && history.remove_nth_item(0) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    // NSH-27
    #[test]
    fn a_limit_is_a_number_not_below_zero() {
        assert_eq!(limit(Some("500")), Some(500));
        assert_eq!(limit(Some(" 0 ")), Some(0));
        assert_eq!(limit(Some("-1")), None);
        assert_eq!(limit(Some("lots")), None);
        assert_eq!(limit(Some("")), None);
        assert_eq!(limit(None), None);
    }

    // NSH-27
    #[test]
    fn the_file_keeps_its_last_commands_with_their_timestamps() {
        let path = std::env::temp_dir().join(format!("neosh-histsize-{}", std::process::id()));
        std::fs::write(&path, "one\n#1700000000\ntwo\nthree\n#1700000002\nfour\n").unwrap();
        trim_file(&path, 10).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\n#1700000000\ntwo\nthree\n#1700000002\nfour\n", "shorter: alone");
        trim_file(&path, 3).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "#1700000000\ntwo\nthree\n#1700000002\nfour\n");
        trim_file(&path, 1).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "#1700000002\nfour\n");
        trim_file(&path, 0).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
        std::fs::remove_file(&path).unwrap();
    }
}
