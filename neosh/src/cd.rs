//! `cd` with bash's `CDPATH` (NSH-25), around brush's own `cd`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use brush_core::builtins::{BoxFuture, CommandExecuteFunc};
use brush_core::commands::{CommandArg, ExecutionContext};
use brush_core::ExecutionResult;
use brush_core::extensions::DefaultShellExtensions as SE;

static BRUSH_CD: OnceLock<CommandExecuteFunc<SE>> = OnceLock::new();

/// Puts neosh's `cd` in place of brush's, which it then calls.
pub fn install(shell: &mut brush_core::Shell<SE>) {
    if let Some(cd) = shell.builtin_mut("cd") {
        let _ = BRUSH_CD.set(cd.execute_func);
        cd.execute_func = execute;
    }
}

/// NSH-25: where `target` is found in `cdpath` from `cwd`, and whether that
/// path is printed; `None` when it is not looked up or not found there.
pub fn look_up(target: &str, cdpath: Option<&str>, cwd: &Path) -> Option<(PathBuf, bool)> {
    let cdpath = cdpath.filter(|c| !c.is_empty())?;
    let never = target.starts_with('/') || target.starts_with("./") || target.starts_with("../") || matches!(target, "" | "." | ".." | "-");
    if never {
        return None;
    }
    cdpath.split(':').find_map(|entry| {
        let base = if entry.is_empty() { cwd.to_path_buf() } else { cwd.join(entry) };
        let found = base.join(target);
        found.is_dir().then_some((found, !entry.is_empty()))
    })
}

/// NSH-30: `target` with each part not there put right by one character
/// swapped, missing, extra or wrong, when exactly one directory is that near.
pub fn spelled(target: &str, cwd: &Path) -> Option<String> {
    let mut base = if target.starts_with('/') { PathBuf::from("/") } else { cwd.to_path_buf() };
    let mut parts = Vec::new();
    for part in target.split('/') {
        if part.is_empty() || part == "." || part == ".." || base.join(part).is_dir() {
            base = base.join(part);
            parts.push(part.to_string());
            continue;
        }
        let near: Vec<String> = std::fs::read_dir(&base)
            .ok()?
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| one_off(part, name))
            .collect();
        let [only] = near.as_slice() else { return None };
        base = base.join(only);
        parts.push(only.clone());
    }
    Some(parts.join("/"))
}

/// Whether `a` and `b` are one swap, one missing, one extra or one wrong character apart.
fn one_off(a: &str, b: &str) -> bool {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a == b {
        return false;
    }
    let lead = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    match a.len() as isize - b.len() as isize {
        0 => a[lead + 1..] == b[lead + 1..] || (lead + 1 < a.len() && a[lead] == b[lead + 1] && a[lead + 1] == b[lead] && a[lead + 2..] == b[lead + 2..]),
        1 => a[lead + 1..] == b[lead..],
        -1 => a[lead..] == b[lead + 1..],
        _ => false,
    }
}

fn execute(context: ExecutionContext<'_, SE>, mut args: Vec<CommandArg>) -> BoxFuture<'_, Result<ExecutionResult, brush_core::Error>> {
    Box::pin(async move {
        let Some(brush_cd) = BRUSH_CD.get().copied() else {
            return Ok(ExecutionResult::general_error());
        };
        // The directory named, after any options.
        let mut operand = None;
        let mut options_over = false;
        for (i, arg) in args.iter().enumerate().skip(1) {
            let CommandArg::String(s) = arg else { continue };
            if !options_over && s == "--" {
                options_over = true;
            } else if !options_over && s.starts_with('-') && s != "-" {
                continue;
            } else {
                operand = Some((i, s.clone()));
                break;
            }
        }
        let mut printed = None;
        if let Some((i, target)) = &operand {
            let cwd = context.shell.working_dir().to_path_buf();
            let cdpath = context.shell.env_str("CDPATH").map(|c| c.into_owned());
            if let Some((found, print)) = look_up(target, cdpath.as_deref(), &cwd) {
                args[*i] = CommandArg::String(found.to_string_lossy().into_owned());
                printed = print.then_some(found);
            } else if let Some(fixed) = (target != "-" && !cwd.join(target).is_dir() && context.shell.options().interactive && context.shell.options().cd_autocorrect_spelling)
                .then(|| spelled(target, &cwd))
                .flatten()
            {
                // NSH-30: a typo put right, said as bash says it.
                args[*i] = CommandArg::String(fixed.clone());
                printed = Some(PathBuf::from(fixed));
            } else if target != "-" && !cwd.join(target).is_dir() {
                let why = if cwd.join(target).exists() { "Not a directory" } else { "No such file or directory" };
                let _ = writeln!(context.stderr(), "neosh: cd: {target}: {why}");
                return Ok(ExecutionResult::general_error());
            }
        }
        let mut out = context.stdout();
        let result = brush_cd(context, args).await?;
        if let Some(found) = printed.filter(|_| result.is_success()) {
            let _ = writeln!(out, "{}", found.display());
        }
        Ok(result)
    })
}

use std::io::Write as _;

#[cfg(test)]
mod tests {
    use super::*;

    // NSH-25
    #[test]
    fn a_relative_directory_is_looked_up_in_cdpath() {
        let top = std::env::temp_dir().join(format!("neosh-cdpath-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        for d in ["projects/neoai", "work/neoai", "work/other", "here/local"] {
            std::fs::create_dir_all(top.join(d)).unwrap();
        }
        let cwd = top.join("here");
        let path = format!("{}:{}", top.join("projects").display(), top.join("work").display());
        assert_eq!(look_up("neoai", Some(&path), &cwd), Some((top.join("projects/neoai"), true)), "the first entry wins");
        assert_eq!(look_up("other", Some(&path), &cwd), Some((top.join("work/other"), true)));
        assert_eq!(look_up("local", Some(&path), &cwd), None, "not in CDPATH: the current directory's");
        assert_eq!(look_up("local", Some(&format!(":{path}")), &cwd), Some((cwd.join("local"), false)), "an empty entry is ., unprinted");
        for never in ["./neoai", "../neoai", "/neoai", ".", "..", "-"] {
            assert_eq!(look_up(never, Some(&path), &cwd), None, "{never}");
        }
        assert_eq!(look_up("neoai", None, &cwd), None);
        assert_eq!(look_up("neoai", Some(""), &cwd), None);
        std::fs::remove_dir_all(&top).unwrap();
    }

    // NSH-30
    #[test]
    fn a_typo_in_a_path_is_put_right_when_one_directory_is_that_near() {
        let top = std::env::temp_dir().join(format!("neosh-cdspell-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        for d in ["here", "beta/src", "gamma", "gamme"] {
            std::fs::create_dir_all(top.join(d)).unwrap();
        }
        std::fs::write(top.join("betb"), "").unwrap();
        let here = top.join("here");
        assert_eq!(spelled("../bta", &here).as_deref(), Some("../beta"), "missing");
        assert_eq!(spelled("../ebta", &here).as_deref(), Some("../beta"), "swapped");
        assert_eq!(spelled("../betaa/scr", &here).as_deref(), Some("../beta/src"), "extra, then swapped");
        assert_eq!(spelled("../bexa", &here).as_deref(), Some("../beta"), "wrong, and the file betb is no directory");
        assert_eq!(spelled("../gammx", &here), None, "two near: none chosen");
        assert_eq!(spelled("../zzz", &here), None);
        assert!(!one_off("beta", "beta") && !one_off("ab", "abcd") && one_off("ab", "ba"));
        std::fs::remove_dir_all(&top).unwrap();
    }
}
