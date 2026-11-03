//! neosh's own prompt (NSH-10, NSH-12): the directory, the git branch and a
//! failed status.

use std::path::{Path, PathBuf};

/// The PS1 neosh sets; while it is still the shell's, neosh draws the prompt itself.
pub const DEFAULT_PS1: &str = r"\w \$ ";

/// What the prompt shows.
pub struct Parts<'a> {
    pub dir: &'a Path,
    pub home: Option<&'a Path>,
    pub branch: Option<String>,
    pub status: u8,
    /// How long the last command took, when long enough to show (NSH-15).
    pub took: Option<std::time::Duration>,
    pub root: bool,
    pub color: bool,
}

/// NSH-12: the prompt, `~/proj main 1 $ `.
pub fn render(p: &Parts) -> String {
    let paint = |code: &str, text: &str| if p.color { format!("\x1b[{code}m{text}\x1b[0m") } else { text.to_string() };
    let mut out = paint("1;34", &tilde(p.dir, p.home));
    if let Some(branch) = &p.branch {
        out += " ";
        out += &paint("35", branch);
    }
    if let Some(took) = p.took.and_then(long) {
        out += " ";
        out += &paint("33", &took);
    }
    if p.status != 0 {
        out += " ";
        out += &paint("31", &p.status.to_string());
    }
    out += if p.root { " # " } else { " $ " };
    out
}

/// NSH-15: a duration worth showing, `12s`, `1m 4s` or `2h 5m`; none under 5 seconds.
pub fn long(took: std::time::Duration) -> Option<String> {
    let s = took.as_secs();
    match s {
        0..5 => None,
        5..60 => Some(format!("{s}s")),
        60..3600 => Some(format!("{}m {}s", s / 60, s % 60)),
        _ => Some(format!("{}h {}m", s / 3600, s % 3600 / 60)),
    }
}

/// The directory with `~` for home.
pub fn tilde(dir: &Path, home: Option<&Path>) -> String {
    match home.and_then(|h| dir.strip_prefix(h).ok()) {
        Some(rel) if rel.as_os_str().is_empty() => "~".to_string(),
        Some(rel) => format!("~/{}", rel.display()),
        None => dir.display().to_string(),
    }
}

/// NSH-12: the branch checked out in the repository holding `dir`, or the
/// short hash of a detached HEAD; read from `.git`, without running git.
pub fn branch(dir: &Path) -> Option<String> {
    let git = dir.ancestors().map(|d| d.join(".git")).find(|g| g.exists())?;
    // A worktree or submodule's `.git` is a file naming the real one.
    let git = if git.is_file() {
        let said = std::fs::read_to_string(&git).ok()?;
        let named = PathBuf::from(said.trim().strip_prefix("gitdir:")?.trim());
        if named.is_absolute() { named } else { git.parent()?.join(named) }
    } else {
        git
    };
    let head = std::fs::read_to_string(git.join("HEAD")).ok()?;
    let head = head.trim();
    match head.strip_prefix("ref:") {
        Some(r) => Some(r.trim().strip_prefix("refs/heads/").unwrap_or(r.trim()).to_string()),
        None if head.len() >= 7 && head.chars().all(|c| c.is_ascii_hexdigit()) => Some(head[..7].to_string()),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(dir: &Path) -> Parts<'_> {
        Parts { dir, home: Some(Path::new("/home/u")), branch: None, status: 0, took: None, root: false, color: false }
    }

    // NSH-10, NSH-12
    #[test]
    fn the_prompt_shows_where_which_branch_and_a_failure() {
        let dir = Path::new("/home/u/proj");
        assert_eq!(render(&parts(dir)), "~/proj $ ");
        assert_eq!(render(&Parts { branch: Some("main".into()), status: 1, ..parts(dir) }), "~/proj main 1 $ ");
        assert_eq!(render(&Parts { root: true, ..parts(Path::new("/etc")) }), "/etc # ");
        assert_eq!(render(&parts(Path::new("/home/u"))), "~ $ ");
        let slow = Parts { took: Some(std::time::Duration::from_secs(64)), status: 1, ..parts(dir) };
        assert_eq!(render(&slow), "~/proj 1m 4s 1 $ ");
        let red = render(&Parts { status: 2, color: true, ..parts(dir) });
        assert!(red.contains("\x1b[31m2\x1b[0m"), "{red:?}");
    }

    // NSH-15
    #[test]
    fn only_a_slow_command_s_time_is_shown() {
        let d = std::time::Duration::from_millis;
        assert_eq!(long(d(4999)), None);
        assert_eq!(long(d(5000)).as_deref(), Some("5s"));
        assert_eq!(long(d(59_900)).as_deref(), Some("59s"));
        assert_eq!(long(d(3_599_000)).as_deref(), Some("59m 59s"));
        assert_eq!(long(d(7_500_000)).as_deref(), Some("2h 5m"));
    }

    // NSH-12
    #[test]
    fn the_branch_is_read_from_git_s_files() {
        let top = std::env::temp_dir().join(format!("neosh-prompt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        let deep = top.join("repo/src/a");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(top.join("repo/.git")).unwrap();
        assert_eq!(branch(&top), None);
        std::fs::write(top.join("repo/.git/HEAD"), "ref: refs/heads/feature/x\n").unwrap();
        assert_eq!(branch(&deep).as_deref(), Some("feature/x"));
        std::fs::write(top.join("repo/.git/HEAD"), "0796b0b1234567890abcdef0796b0b1234567890\n").unwrap();
        assert_eq!(branch(&deep).as_deref(), Some("0796b0b"));
        // A worktree: `.git` is a file pointing at the real one.
        std::fs::create_dir_all(top.join("wt")).unwrap();
        std::fs::create_dir_all(top.join("repo/.git/worktrees/wt")).unwrap();
        std::fs::write(top.join("repo/.git/worktrees/wt/HEAD"), "ref: refs/heads/other\n").unwrap();
        std::fs::write(top.join("wt/.git"), "gitdir: ../repo/.git/worktrees/wt\n").unwrap();
        assert_eq!(branch(&top.join("wt")).as_deref(), Some("other"));
        std::fs::remove_dir_all(&top).unwrap();
    }
}
