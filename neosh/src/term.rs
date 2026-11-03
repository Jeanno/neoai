//! What neosh tells the terminal (NSH-18): the window title, and the
//! directory, so a new tab opens where you are.

use std::path::Path;

/// Whether to tell the terminal anything: not on a dumb one.
pub fn wanted(term: Option<&str>) -> bool {
    term.is_some_and(|t| !t.is_empty() && t != "dumb")
}

/// OSC 2: the window or tab title, one line of printable text, cut to 60 characters.
pub fn title(text: &str) -> String {
    let clean: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = clean.chars().take(60).collect();
    let cut = if clean.chars().count() > 60 { format!("{}…", cut.trim_end()) } else { cut };
    format!("\x1b]2;{cut}\x07")
}

/// OSC 7: the working directory as a `file://` URL, as Terminal, iTerm and
/// others read it.
pub fn directory(host: &str, dir: &Path) -> String {
    let mut url = String::new();
    for b in dir.to_string_lossy().bytes() {
        if b.is_ascii_alphanumeric() || b"/-._~".contains(&b) {
            url.push(b as char);
        } else {
            url.push_str(&format!("%{b:02X}"));
        }
    }
    format!("\x1b]7;file://{host}{url}\x07")
}

#[cfg(test)]
mod tests {
    use super::*;

    // NSH-18
    #[test]
    fn the_terminal_is_told_the_title_and_the_directory() {
        assert!(wanted(Some("xterm-256color")));
        assert!(!wanted(Some("dumb")));
        assert!(!wanted(None));
        assert_eq!(title("~/proj"), "\x1b]2;~/proj\x07");
        // One line, no escapes of its own, and not too long.
        assert_eq!(title("echo a\nb\x1b]0;x\x07"), "\x1b]2;echo a b ]0;x\x07");
        let long = title(&"x".repeat(80));
        assert!(long.contains(&format!("{}…", "x".repeat(60))), "{long:?}");
        assert_eq!(directory("mac", Path::new("/Users/u/my proj/ü")), "\x1b]7;file://mac/Users/u/my%20proj/%C3%BC\x07");
    }
}
