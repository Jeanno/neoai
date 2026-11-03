//! navi inside the shell (NSH-4 to NSH-9): which lines go to navi, what it is
//! told about the commands run before, and running it.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Commands kept to tell navi about (NSH-6).
pub const RECENT_KEPT: usize = 10;

/// Characters that make a line shell, not a sentence (NSH-4).
const SHELL_CHARS: &[char] = &['|', '&', ';', '<', '>', '$', '`', '=', '(', ')', '/'];

/// Question words that are also programs (`/usr/bin/what`, `which`, `who`).
const ASKING: &[&str] = &["what", "which", "who"];

/// Words after one of ASKING that make it a question, not a command (`who am i` stays one).
const QUESTION_NEXT: &[&str] = &[
    "is", "are", "was", "were", "does", "do", "did", "the", "a", "an", "my", "should", "can", "will", "would", "could", "has",
    "have", "process", "program", "file", "files", "folder", "port",
];

/// What a line typed at the prompt is.
#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    /// For navi, with its prompt (empty for `?` alone).
    Navi(String),
    /// For the shell to run.
    Shell,
}

/// NSH-4: a `?` line, or a sentence whose first word is no command; `is_command`
/// says whether a word is a command, alias, function, builtin or keyword.
pub fn classify(line: &str, mut is_command: impl FnMut(&str) -> bool) -> Line {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix('?') {
        // `?*` and `?.txt` are globs, not questions.
        if rest.is_empty() || rest.starts_with(char::is_whitespace) {
            return Line::Navi(rest.trim().to_string());
        }
    }
    let words: Vec<&str> = line.split_whitespace().collect();
    if words.len() < 3 || line.contains(SHELL_CHARS) {
        return Line::Shell;
    }
    let first = words[0];
    // A sentence starts with a word, not a flag, a number or a path.
    let wordlike = first.chars().all(|c| c.is_alphabetic() || c == '\'' || c == ',');
    if !wordlike {
        return Line::Shell;
    }
    let lower = first.to_lowercase();
    let asking = ASKING.contains(&lower.as_str()) && QUESTION_NEXT.contains(&words[1].to_lowercase().as_str());
    if asking || line.ends_with('?') || !is_command(first) {
        return Line::Navi(line.to_string());
    }
    Line::Shell
}

/// A command run in this shell, for navi (NSH-6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ran {
    pub line: String,
    pub dir: PathBuf,
    pub status: u8,
    pub took: std::time::Duration,
}

/// The commands since navi last answered, oldest first, kept to RECENT_KEPT.
#[derive(Debug, Default)]
pub struct Recent {
    ran: Vec<Ran>,
}

impl Recent {
    pub fn push(&mut self, ran: Ran) {
        self.ran.push(ran);
        if self.ran.len() > RECENT_KEPT {
            self.ran.remove(0);
        }
    }

    pub fn clear(&mut self) {
        self.ran.clear();
    }

    /// What navi is told (CLI-40): one command a line, with where and how it ended.
    pub fn describe(&self, home: Option<&Path>) -> String {
        self.ran
            .iter()
            .map(|r| {
                let dir = crate::prompt::tilde(&r.dir, home);
                let mut how = if r.status == 0 { "ok".to_string() } else { format!("exit {}", r.status) };
                // NSH-15
                if let Some(took) = crate::prompt::long(r.took) {
                    how += &format!(", took {took}");
                }
                format!("{dir} $ {} ({how})", r.line.replace('\n', " "))
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// What `?` alone says (NSH-9).
pub const HELP: &str = "\
Ask navi: start a line with ? (? why did that fail), or just write a
sentence that is not a command (find the biggest files here). navi sees the
commands you ran since it last answered and asks before it changes anything.";

/// What a line for navi says when navi is not installed (NSH-9).
pub const NOT_INSTALLED: &str = "\
neosh: navi is not installed, so there is no one to ask.
Install it: curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/neonavi/install.sh | sh";

/// NSH-5, NSH-7, NSH-11: navi's answer in the terminal, in `dir`, in this
/// session's conversation, and the command it suggests, if any.
/// `navi` is the program the shell found on its own `$PATH`, which is passed on too.
pub fn ask(navi: &Path, path: Option<&str>, prompt: &str, dir: &Path, session: &str, recent: &str) -> Result<Option<String>, std::io::Error> {
    let handed = std::env::temp_dir().join(format!("{session}-command"));
    let _ = std::fs::remove_file(&handed);
    let mut command = Command::new(navi);
    command.args(["--once", "--session", session, "-p", prompt]).current_dir(dir).env("NAVI_COMMAND_FILE", &handed);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    if !recent.is_empty() {
        command.env("NAVI_RECENT", recent);
    } else {
        command.env_remove("NAVI_RECENT");
    }
    command.status()?;
    let suggested = std::fs::read_to_string(&handed).ok();
    let _ = std::fs::remove_file(&handed);
    Ok(suggested.and_then(|s| suggestion(&s)))
}

/// NSH-11: what navi handed back, as one line to put at the prompt; or nothing.
pub fn suggestion(handed: &str) -> Option<String> {
    let line = handed.trim_end_matches(['\n', '\r']).trim();
    (!line.is_empty() && !line.contains(['\n', '\r'])).then(|| line.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMMANDS: &[&str] = &["ls", "git", "find", "cd", "if", "echo"];
    fn known(w: &str) -> bool {
        COMMANDS.contains(&w)
    }

    // NSH-4
    #[test]
    fn question_mark_lines_go_to_navi() {
        assert_eq!(classify("? why did that fail", known), Line::Navi("why did that fail".into()));
        assert_eq!(classify("  ?  ", known), Line::Navi(String::new()));
        // Globs stay globs.
        assert_eq!(classify("?.txt", known), Line::Shell);
        assert_eq!(classify("?? x", known), Line::Shell);
    }

    // NSH-4
    #[test]
    fn sentences_that_are_no_command_go_to_navi() {
        assert_eq!(classify("why did that fail", known), Line::Navi("why did that fail".into()));
        assert_eq!(classify("what's using port 8080", known), Line::Navi("what's using port 8080".into()));
        // A command first, however English it reads.
        assert_eq!(classify("find the biggest files", known), Line::Shell);
        // Unless it asks: a question word that is also a program, or a question mark.
        let with_what = |w: &str| known(w) || ["what", "which", "who"].contains(&w);
        assert_eq!(classify("what is in this folder", with_what), Line::Navi("what is in this folder".into()));
        assert_eq!(classify("Which process has port 3000", with_what), Line::Navi("Which process has port 3000".into()));
        assert_eq!(classify("who am i", with_what), Line::Shell);
        assert_eq!(classify("which node npm yarn", with_what), Line::Shell);
        assert_eq!(classify("find the biggest files?", known), Line::Navi("find the biggest files?".into()));
        // Too short to be a sentence: a typo stays command not found.
        assert_eq!(classify("gti status", known), Line::Shell);
        // Shell in it.
        assert_eq!(classify("show me $HOME please", known), Line::Shell);
        assert_eq!(classify("list files in /tmp now", known), Line::Shell);
        assert_eq!(classify("make it so | tee", known), Line::Shell);
        assert_eq!(classify("FOO=1 run the thing", known), Line::Shell);
        // Not a word first.
        assert_eq!(classify("./run the tests now", known), Line::Shell);
        assert_eq!(classify("-x is a flag here", known), Line::Shell);
    }

    // NSH-11
    #[test]
    fn a_suggestion_is_one_line_or_nothing() {
        assert_eq!(suggestion("du -sh * | sort -h\n"), Some("du -sh * | sort -h".into()));
        assert_eq!(suggestion("  \n"), None);
        assert_eq!(suggestion("cd x\nmake\n"), None);
    }

    // NSH-6
    #[test]
    fn recent_keeps_the_last_ten_and_says_where_and_how_each_ended() {
        let mut r = Recent::default();
        for i in 0..12 {
            r.push(Ran { line: format!("cmd {i}"), dir: PathBuf::from("/home/u/proj"), status: (i % 2) as u8, took: Default::default() });
        }
        let said = r.describe(Some(Path::new("/home/u")));
        let lines: Vec<&str> = said.lines().collect();
        assert_eq!(lines.len(), 10);
        assert_eq!(lines[0], "~/proj $ cmd 2 (ok)");
        assert_eq!(lines[9], "~/proj $ cmd 11 (exit 1)");
        r.clear();
        assert_eq!(r.describe(None), "");
        r.push(Ran { line: "ls\n-l".into(), dir: PathBuf::from("/home/u"), status: 0, took: Default::default() });
        assert_eq!(r.describe(Some(Path::new("/home/u"))), "~ $ ls -l (ok)");
        // NSH-15
        r.clear();
        r.push(Ran { line: "cargo build".into(), dir: PathBuf::from("/home/u"), status: 101, took: std::time::Duration::from_secs(64) });
        assert_eq!(r.describe(Some(Path::new("/home/u"))), "~ $ cargo build (exit 101, took 1m 4s)");
    }
}
