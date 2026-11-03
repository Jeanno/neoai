//! neosh end to end on a terminal: a pseudo-terminal from `drive.py`, a
//! home of its own, and a stand-in navi that logs what it was given.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Logs its arguments, directory, what it was told and what was piped in; a
/// prompt asking for a suggestion hands one back (CLI-41).
const STAND_IN: &str = r#"#!/bin/sh
{ echo "ARGS: $*"; echo "PWD: $PWD"; echo "RECENT: $NAVI_RECENT"; [ -t 0 ] || echo "STDIN: $(cat)"; echo ---; } >> "$HOME/navi.log"
case "$*" in *suggest*) echo 'echo suggested-ran' > "$NAVI_COMMAND_FILE" ;; esac
echo "navi says hi"
"#;

struct Home(PathBuf);

impl Home {
    fn new(name: &str) -> Home {
        let home = std::env::temp_dir().join(format!("neosh-e2e-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join("bin")).unwrap();
        std::fs::create_dir_all(home.join("work")).unwrap();
        let navi = home.join("bin/navi");
        std::fs::write(&navi, STAND_IN).unwrap();
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&navi, std::fs::Permissions::from_mode(0o755)).unwrap();
        Home(home)
    }

    /// What the screen showed for these lines, typed into a fresh neosh.
    fn run(&self, lines: &[&str], env: &[(&str, &str)]) -> String {
        let driver = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/drive.py");
        let out = Command::new("python3")
            .arg("-I")
            .arg(driver)
            .arg(env!("CARGO_BIN_EXE_neosh"))
            .args(lines)
            .current_dir(self.0.join("work"))
            .env_clear()
            .env("HOME", &self.0)
            .env("PATH", format!("{}:/usr/bin:/bin", self.0.join("bin").display()))
            .env("TERM", "xterm-256color")
            .envs(env.iter().copied())
            .output()
            .expect("python3 to drive neosh");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn log(&self) -> String {
        std::fs::read_to_string(self.0.join("navi.log")).unwrap_or_default()
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// NSH-4 to NSH-7, NSH-19
#[test]
fn a_sentence_and_a_question_reach_navi_with_what_was_run() {
    let home = Home::new("ask");
    let screen = home.run(&["false", "why did that fail", "? and now", "gti status", "exit"], &[]);
    let log = home.log();
    assert!(log.contains("-p why did that fail"), "{log}");
    assert!(log.contains("-p and now"), "{log}");
    assert!(log.contains("RECENT: ~/work $ false (exit 1)"), "{log}");
    let work = std::fs::canonicalize(home.0.join("work")).unwrap();
    assert!(log.contains(&format!("PWD: {}", work.display())), "{log}");
    // One conversation: both asked in the same session.
    let sessions: Vec<&str> = log.lines().filter(|l| l.starts_with("ARGS:")).map(|l| l.split_whitespace().nth(3).unwrap()).collect();
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0], sessions[1]);
    assert!(sessions[0].starts_with("neosh-"));
    // Said once, for the sentence only; a typo is still a typo.
    assert_eq!(screen.matches("a sentence goes to navi").count(), 1, "{screen}");
    assert!(screen.contains("command not found: gti"), "{screen}");
}

// NSH-17, NSH-9
#[test]
fn neosh_ask_marked_keeps_sentences_commands() {
    let home = Home::new("marked");
    let screen = home.run(&["NEOSH_ASK=marked", "why did that fail", "true", "?", "exit"], &[]);
    assert!(screen.contains("command not found: why"), "{screen}");
    assert!(screen.contains("Ask navi: start a line with ?"), "{screen}");
    assert_eq!(home.log(), "");
}

// NSH-11
#[test]
fn the_command_navi_suggests_waits_at_the_prompt() {
    let home = Home::new("suggest");
    let screen = home.run(&["? suggest something", "", "exit"], &[]);
    assert!(screen.lines().any(|l| l.trim() == "suggested-ran"), "{screen}");
}

// NSH-16, NSH-8
#[test]
fn output_piped_to_a_question_reaches_navi_and_history_keeps_the_line() {
    let home = Home::new("piped");
    let screen = home.run(&["ls missing-folder | ? why", "history", "exit"], &[]);
    let log = home.log();
    assert!(log.contains("-a - -p why"), "{log}");
    assert!(log.contains("STDIN: ls: missing-folder"), "{log}");
    assert!(screen.contains("  ls missing-folder | ? why"), "{screen}");
}

// NSH-12, NSH-13
#[test]
fn the_prompt_shows_the_branch_and_history_outlives_the_session() {
    let home = Home::new("prompt");
    std::fs::create_dir_all(home.0.join("work/.git")).unwrap();
    std::fs::write(home.0.join("work/.git/HEAD"), "ref: refs/heads/main\n").unwrap();
    let screen = home.run(&["false", "echo from-the-first", "exit"], &[]);
    assert!(screen.contains("~/work main 1 $"), "{screen}");
    let again = home.run(&["history", "exit"], &[]);
    assert!(again.contains("echo from-the-first"), "{again}");
    assert!(home.0.join(".neosh_history").exists());
}

// NSH-5
#[test]
fn ctrl_c_stops_navi_and_never_the_shell() {
    let home = Home::new("interrupt");
    std::fs::write(home.0.join("bin/navi"), "#!/bin/sh\necho thinking\nsleep 30\necho never\n").unwrap();
    let screen = home.run(&["? a slow one", "\x03", "echo still-here", "? again", "\x03", "echo here-too", "exit"], &[]);
    assert!(screen.contains("still-here"), "{screen}");
    assert!(screen.contains("here-too"), "{screen}");
    assert!(!screen.contains("never"), "{screen}");
}

// NSH-3, NSH-6
#[test]
fn job_control_and_a_command_of_several_lines_work_through_neosh() {
    let home = Home::new("jobs");
    let screen = home.run(
        &["sleep 20", "@wait 1", "\x1a", "jobs", "fg", "@wait 1", "\x03", "for f in a b; do", "echo got-$f", "done", "? what ran", "exit"],
        &[],
    );
    assert!(screen.contains("Stopped\tsleep 20"), "{screen}");
    assert!(screen.contains("got-a") && screen.contains("got-b"), "{screen}");
    let log = home.log();
    assert!(log.contains("~/work $ for f in a b; do ↵ echo got-$f ↵ done (ok)"), "{log}");
}

// NSH-9
#[test]
fn a_question_mark_alone_after_a_failure_asks_why() {
    let home = Home::new("why");
    let screen = home.run(&["?", "ls missing-folder", "?", "true", "?", "exit"], &[]);
    let log = home.log();
    assert_eq!(log.matches("ARGS:").count(), 1, "{log}");
    assert!(log.contains("-p why did my last command fail"), "{log}");
    assert!(log.contains("~/work $ ls missing-folder (exit 1)"), "{log}");
    // Before the failure, and after a command that worked: how to ask.
    assert_eq!(screen.matches("Ask navi: start a line with ?").count(), 2, "{screen}");
}
