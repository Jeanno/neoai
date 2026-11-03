//! neosh: a bash-compatible shell with navi inside (spec.md).
//!
//! The interpreter is brush's (brush-core, MIT, github.com/reubeno/brush);
//! starting it follows brush-shell's entry. What neosh adds is the line
//! reader around brush's own, which sends lines for navi to navi (NSH-4).

mod bang;
mod cd;
mod histctl;
mod histsize;
mod navi;
mod prompt;
mod term;

use std::io::{IsTerminal as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use brush_builtins::ShellBuilderExt as _;
use brush_interactive::{InputBackend, InteractivePrompt, ReadResult, ShellError, ShellRef};

const USAGE: &str = "\
usage: neosh [-l] [--norc] [-c '<commands>' [name [args…]] | <script> [args…]]

neosh is a bash-compatible shell with navi inside: start a line with ? to
ask navi, or write a sentence that is not a command.

  -c COMMANDS  run the commands and exit with the last one's status
  -l, --login  read ~/.profile first, as a login shell does
  --norc       do not read ~/.neoshrc
  --version    say which neosh this is";

/// What the command line asked for (NSH-1).
#[derive(Debug, Default, PartialEq, Eq)]
struct Args {
    command: Option<String>,
    login: bool,
    norc: bool,
    /// The script and its arguments, or with -c the name and arguments.
    rest: Vec<String>,
}

fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut args = Args { login: argv.first().is_some_and(|a| a.starts_with('-')), ..Default::default() };
    let mut i = 1;
    while i < argv.len() {
        let a = argv[i].as_str();
        match a {
            "-c" => {
                i += 1;
                args.command = Some(argv.get(i).ok_or("-c needs the commands to run")?.clone());
            }
            "-l" | "--login" => args.login = true,
            "--norc" => args.norc = true,
            // Everything after is the script's, or -c's name and arguments.
            "--" => {
                args.rest.extend(argv[i + 1..].iter().cloned());
                break;
            }
            _ if a.starts_with('-') && a.len() > 1 => return Err(format!("unknown option {a}")),
            _ => {
                args.rest.extend(argv[i..].iter().cloned());
                break;
            }
        }
        i += 1;
    }
    Ok(args)
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if argv.iter().skip(1).any(|a| a == "--version") {
        println!("neosh {} (brush-core {})", env!("CARGO_PKG_VERSION"), "0.5");
        return;
    }
    if argv.iter().skip(1).any(|a| a == "--help" || a == "-h") {
        println!("{USAGE}");
        return;
    }
    let args = match parse_args(&argv) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("neosh: {e}\n{USAGE}");
            std::process::exit(2);
        }
    };
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("a runtime");
    let code = runtime.block_on(run(args)).unwrap_or_else(|e| {
        eprintln!("neosh: {e}");
        1
    });
    std::process::exit(i32::from(code));
}

async fn run(args: Args) -> Result<u8, ShellError> {
    let interactive = args.command.is_none() && args.rest.is_empty() && std::io::stdin().is_terminal();
    let from_stdin = args.command.is_none() && args.rest.is_empty();
    let mut builder = brush_core::Shell::builder()
        .login(args.login)
        .interactive(interactive)
        .command_string_mode(args.command.is_some())
        .profile(brush_core::ProfileLoadBehavior::Skip)
        .rc(brush_core::RcLoadBehavior::Skip)
        .maybe_shell_args(args.command.as_ref().map(|_| args.rest.iter().skip(1).cloned().collect()))
        .read_commands_from_stdin(from_stdin)
        .maybe_shell_name(Some(if args.command.is_some() { args.rest.first().cloned().unwrap_or_else(|| "neosh".into()) } else { "neosh".into() }))
        .shell_product_display_str(format!("neosh {}", env!("CARGO_PKG_VERSION")))
        .shell_version(env!("CARGO_PKG_VERSION").to_string())
        .default_builtins(brush_builtins::BuiltinSet::BashMode);
    if let Some(histfile) = history_file(std::env::var_os("HISTFILE"), std::env::var_os("HOME")) {
        builder = builder.var("HISTFILE", brush_core::ShellVariable::new(histfile.to_string_lossy().into_owned()));
    }
    let mut shell = builder.build().await?;
    // NSH-25: CDPATH, which brush's `cd` does not look in.
    cd::install(&mut shell);
    let shell: ShellRef = std::sync::Arc::new(tokio::sync::Mutex::new(shell));

    // NSH-1: ~/.profile for a login shell, ~/.neoshrc for an interactive one.
    let rc = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".neoshrc"));
    let rc = match rc {
        Some(path) if interactive && !args.norc && path.exists() => brush_core::RcLoadBehavior::LoadCustom(path),
        _ => brush_core::RcLoadBehavior::Skip,
    };
    let profile = if args.login { brush_core::ProfileLoadBehavior::LoadDefault } else { brush_core::ProfileLoadBehavior::Skip };
    // NSH-5: ^C is for what runs, navi included, never the shell itself. A
    // handler, unlike an ignored signal, is not inherited across exec, so
    // children still get ^C as they expect.
    let _interrupts = if interactive { Some(tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?) } else { None };
    // NSH-10: the directory and `$`, unless a PS1 came with the environment; the rc can set its own.
    if interactive && std::env::var_os("PS1").is_none() {
        shell.lock().await.env_mut().set_global("PS1", brush_core::ShellVariable::new(prompt::DEFAULT_PS1))?;
    }
    // NSH-27: as long as bash's history, unless the environment says otherwise.
    if interactive {
        let mut s = shell.lock().await;
        for name in ["HISTSIZE", "HISTFILESIZE"] {
            if std::env::var_os(name).is_none() {
                s.env_mut().set_global(name, brush_core::ShellVariable::new(histsize::DEFAULT))?;
            }
        }
    }
    shell.lock().await.load_config(&profile, &rc).await?;

    if let Some(command) = args.command {
        shell.lock().await.run_dash_c_command(command).await?;
    } else if let Some(script) = args.rest.first() {
        shell.lock().await.run_script(std::path::Path::new(script), args.rest.iter().skip(1)).await?;
    } else if interactive {
        // NSH-18: VS Code's command marks, where brush finds them supported.
        let ui = brush_interactive::UIOptions { terminal_shell_integration: true, ..Default::default() };
        let mut input = WithNavi::new(brush_interactive::ReedlineInputBackend::new(&ui, &shell)?);
        brush_interactive::InteractiveShell::new(&shell, &mut input, &(&ui).into())?.run_interactively().await?;
        // NSH-27: the file as long as HISTFILESIZE says, now history is written.
        let s = shell.lock().await;
        if let (Some(file), Some(keep)) = (s.env_str("HISTFILE"), histsize::limit(s.env_str("HISTFILESIZE").as_deref())) {
            let _ = histsize::trim_file(Path::new(file.as_ref()), keep);
        }
    } else {
        let ui = brush_interactive::UIOptions::default();
        let mut input = brush_interactive::MinimalInputBackend;
        brush_interactive::InteractiveShell::new(&shell, &mut input, &(&ui).into())?.run_interactively().await?;
    }
    Ok(shell.lock().await.last_exit_status())
}

/// brush's line reader, with lines for navi taken to navi (NSH-4 to NSH-8).
struct WithNavi<IB: InputBackend> {
    inner: IB,
    recent: navi::Recent,
    /// The line handed to the shell last, and where, to learn how it ended (NSH-6).
    handed: Option<(String, PathBuf, Instant)>,
    /// How long the last command took, for the prompt (NSH-15).
    took: Option<Duration>,
    /// The line run for `… | ?`, and as typed, to put right in history (NSH-16).
    piped: Option<(String, String)>,
    /// Whether NSH-19's note has been said this session.
    noted: bool,
    /// What navi suggested running, for the next prompt (NSH-11).
    suggested: Option<String>,
    /// A line not found as a command, to offer navi (NSH-23).
    missed: Option<String>,
    /// A line run in place of the one typed, and that one, for history (NSH-29).
    retyped: Option<(String, String)>,
    /// NSH-32: the last `:s` or `^old^new`, for `:&`.
    substituted: bang::Memory,
    /// The line brush adds to history as it runs it, and whether bash would keep it (NSH-26).
    settle: Option<(String, bool)>,
    session: String,
}

impl<IB: InputBackend> WithNavi<IB> {
    fn new(inner: IB) -> Self {
        let started = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        Self { inner, recent: navi::Recent::default(), handed: None, piped: None, noted: false, took: None, suggested: None, missed: None, retyped: None, substituted: bang::Memory::default(), settle: None, session: format!("neosh-{started}-{}", std::process::id()) }
    }
}

// The session's files go with it.
impl<IB: InputBackend> Drop for WithNavi<IB> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(navi::seen_file(&self.session));
        let _ = std::fs::remove_file(navi::command_file(&self.session));
    }
}

impl<IB: InputBackend> InputBackend for WithNavi<IB> {
    fn read_line(&mut self, shell: &ShellRef<impl brush_core::ShellExtensions>, prompt: InteractivePrompt) -> Result<ReadResult, ShellError> {
        loop {
            // The shell is not running anything while it waits for a line.
            let mut guard = shell.try_lock().ok();
            // Only the command just run: an empty line or a question shows none.
            self.took = None;
            // NSH-16: navi has answered; history keeps the line as typed.
            if let Some((ran, typed)) = self.piped.take() {
                if let Some(history) = guard.as_mut().and_then(|s| s.history_mut()) {
                    let found = history.iter().filter(|i| i.command_line == ran).last().cloned();
                    if let Some(item) = found {
                        let _ = history.update_by_id(item.id, brush_core::history::Item { command_line: typed.trim().to_string(), ..item });
                    }
                }
                self.recent.clear();
                self.suggested = navi::take_suggestion(&navi::command_file(&self.session));
            }
            // NSH-29: history keeps what was typed, not the `cd` run for it.
            if let Some((ran, typed)) = self.retyped.take() {
                if let Some(history) = guard.as_mut().and_then(|s| s.history_mut()) {
                    let found = history.iter().filter(|i| i.command_line == ran).last().cloned();
                    if let Some(item) = found {
                        let _ = history.update_by_id(item.id, brush_core::history::Item { command_line: typed, ..item });
                    }
                }
            }
            // NSH-31: the terminal's size, for scripts, while checkwinsize is on.
            if let Some(s) = guard.as_mut().filter(|s| s.options().check_window_size_after_external_commands) {
                if let Ok((columns, lines)) = crossterm::terminal::size() {
                    let _ = s.env_mut().set_global("COLUMNS", brush_core::ShellVariable::new(columns.to_string()));
                    let _ = s.env_mut().set_global("LINES", brush_core::ShellVariable::new(lines.to_string()));
                }
            }
            // NSH-27: no more than HISTSIZE lines.
            if let Some(keep) = guard.as_ref().and_then(|s| histsize::limit(s.env_str("HISTSIZE").as_deref())) {
                if let Some(history) = guard.as_mut().and_then(|s| s.history_mut()) {
                    histsize::trim_list(history, keep);
                }
            }
            // NSH-26: brush keeps every line; drop what bash would not have kept.
            if let Some((line, keep)) = self.settle.take() {
                let erase = guard.as_ref().is_some_and(|s| histctl::erases(s.env_str("HISTCONTROL").as_deref()));
                if let Some(history) = guard.as_mut().and_then(|s| s.history_mut()) {
                    settle(history, &line, keep, erase);
                }
            }
            if let (Some((line, dir, at)), Some(s)) = (self.handed.take(), guard.as_ref()) {
                let took = at.elapsed();
                self.took = Some(took);
                let status = s.last_exit_status();
                // NSH-23: a sentence typed as a command, offered to navi.
                let ask = navi::Ask::from_setting(s.env_str("NEOSH_ASK").as_deref());
                if status == 127 && ask == navi::Ask::Marked && self.suggested.is_none() {
                    self.missed = Some(line.clone());
                }
                self.recent.push(navi::Ran { line, dir, status, took });
            }
            if let Some(line) = self.missed.take() {
                if navi::sentence(&line, |word| guard.as_mut().is_none_or(|s| is_command(s, word))) {
                    self.suggested = Some(format!("?{line}"));
                }
            }
            // NSH-12: drawn by neosh while PS1 is still its own.
            let ours = guard.as_ref().filter(|s| s.env_str("PS1").as_deref() == Some(prompt::DEFAULT_PS1)).map(|s| {
                let dir = s.working_dir().to_path_buf();
                let home = std::env::var_os("HOME").map(PathBuf::from);
                let branch = prompt::branch(&dir);
                prompt::render(&prompt::Parts {
                    dir: &dir,
                    home: home.as_deref(),
                    // NSH-22: asked only inside a repository.
                    changed: branch.is_some()
                        && s.find_first_executable_in_path("git").is_some_and(|git| prompt::changed(&git, &dir, std::time::Duration::from_millis(200))),
                    branch,
                    status: s.last_exit_status(),
                    took: self.took,
                    root: s.env_str("EUID").as_deref() == Some("0"),
                    color: s.env_str("NO_COLOR").is_none(),
                })
            });
            // NSH-18: the title and directory, for the window and new tabs.
            let told = guard.as_ref().filter(|s| term::wanted(s.env_str("TERM").as_deref())).map(|s| {
                let dir = s.working_dir().to_path_buf();
                let home = std::env::var_os("HOME").map(PathBuf::from);
                let host = s.env_str("HOSTNAME").map(|h| h.into_owned()).unwrap_or_default();
                format!("{}{}", term::title(&prompt::tilde(&dir, home.as_deref())), term::directory(&host, &dir))
            });
            let again = InteractivePrompt { prompt: ours.unwrap_or_else(|| prompt.prompt.clone()), alt_side_prompt: prompt.alt_side_prompt.clone(), continuation_prompt: prompt.continuation_prompt.clone() };
            let titled = guard.as_ref().is_some_and(|s| term::wanted(s.env_str("TERM").as_deref()));
            drop(guard.take());
            if let Some(told) = told {
                print!("{told}");
                let _ = std::io::stdout().flush();
            }
            // NSH-11: ready to run with Enter, change, or clear with ^C.
            if let Some(command) = self.suggested.take() {
                let end = command.len();
                self.inner.set_read_buffer(command, end);
            }
            let read = self.inner.read_line(shell, again)?;
            let ReadResult::Input(mut line) = read else { return Ok(read) };
            let mut guard = shell.try_lock().ok();
            // NSH-24: `!!` and the rest, before anything reads the line.
            let history = guard.as_ref().filter(|s| s.options().enable_bang_style_history_substitution).map(|s| -> Vec<String> { s.history().map(|h| h.iter().map(|i| i.command_line.clone()).collect()).unwrap_or_default() });
            if let Some(history) = history {
                match bang::expand_with(line.trim_end_matches('\n'), &history, &mut self.substituted) {
                    // NSH-32: `:p` prints it and keeps it in history, and runs nothing.
                    Ok(Some(bang::Expanded { line: expanded, print: true })) => {
                        println!("{expanded}");
                        if let Some(h) = guard.as_mut().and_then(|s| s.history_mut()) {
                            let _ = h.add(brush_core::history::Item::new(expanded));
                        }
                        continue;
                    }
                    Ok(Some(bang::Expanded { line: expanded, .. })) => {
                        println!("{expanded}");
                        line = if line.ends_with('\n') { format!("{expanded}\n") } else { expanded };
                    }
                    Ok(None) => {}
                    Err(said) => {
                        eprintln!("neosh: {said}");
                        continue;
                    }
                }
            }
            // NSH-17: read each line, so `NEOSH_ASK=marked` at the prompt counts at once.
            let ask = navi::Ask::from_setting(guard.as_ref().and_then(|s| s.env_str("NEOSH_ASK")).as_deref());
            let dir = guard.as_ref().map(|s| s.working_dir().to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
            // NSH-26: decided on the line as typed, its leading space and all.
            let mut keep = guard.as_ref().is_none_or(|s| {
                let previous = s.history().and_then(|h| h.iter().last().map(|i| i.command_line.clone()));
                histctl::keeps(line.trim_end_matches('\n'), previous.as_deref(), s.env_str("HISTCONTROL").as_deref(), s.env_str("HISTIGNORE").as_deref())
            });
            // NSH-27: room made for it, so history never holds more than HISTSIZE.
            match guard.as_ref().and_then(|s| histsize::limit(s.env_str("HISTSIZE").as_deref())) {
                Some(0) => keep = false,
                Some(size) if keep => {
                    if let Some(history) = guard.as_mut().and_then(|s| s.history_mut()) {
                        histsize::trim_list(history, size - 1);
                    }
                }
                _ => {}
            }
            let what = navi::classify_in(&line, ask, |word| guard.as_mut().is_none_or(|s| is_command(s, word)), |word| navi::globs_a_file(word, &dir));
            match what {
                navi::Line::Shell => {
                    if !line.trim().is_empty() {
                        // NSH-18: the command, while it runs.
                        if titled {
                            print!("{}", term::title(line.trim()));
                            let _ = std::io::stdout().flush();
                        }
                        self.handed = Some((line.trim().to_string(), dir.clone(), Instant::now()));
                        self.settle = Some((line.trim().to_string(), keep));
                        // NSH-29: a directory's name alone goes there.
                        let home = guard.as_ref().and_then(|s| s.env_str("HOME").map(|h| PathBuf::from(h.as_ref())));
                        let auto = guard.as_mut().filter(|s| s.options().auto_cd).is_some_and(|s| autocd(s, line.trim(), &dir, home.as_deref()));
                        if auto {
                            let typed = line.trim().to_string();
                            let ran = format!("cd -- {typed}");
                            eprintln!("{ran}");
                            self.retyped = Some((ran.clone(), typed));
                            return Ok(ReadResult::Input(format!("{ran}\n")));
                        }
                    }
                    return Ok(ReadResult::Input(line));
                }
                navi::Line::Piped { command, question } => {
                    let Some(found) = guard.as_ref().and_then(|s| s.find_first_executable_in_path("navi")) else {
                        if let Some(s) = guard.as_mut() {
                            let _ = s.add_to_history(line.trim_end_matches('\n'));
                        }
                        eprintln!("{}", navi::NOT_INSTALLED);
                        if let Some(s) = guard.as_mut() {
                            s.set_last_exit_status(127);
                        }
                        continue;
                    };
                    let home = std::env::var_os("HOME").map(PathBuf::from);
                    let file = navi::command_file(&self.session);
                    let _ = std::fs::remove_file(&file);
                    let ran = navi::piped_line(&command, &question, &found, &self.session, &self.recent.describe(home.as_deref()), &file);
                    self.piped = Some((ran.clone(), line.trim_end_matches('\n').to_string()));
                    self.settle = Some((line.trim().to_string(), keep));
                    return Ok(ReadResult::Input(ran));
                }
                navi::Line::Navi(ask) => {
                    // NSH-8: kept as typed, if bash would keep it (NSH-26).
                    if let Some(s) = guard.as_mut() {
                        let _ = s.add_to_history(line.trim_end_matches('\n'));
                        self.settle = Some((line.trim().to_string(), keep));
                    }
                    // Found as the shell finds programs, so `export PATH=…` here counts.
                    let found = guard.as_ref().and_then(|s| s.find_first_executable_in_path("navi"));
                    let path = guard.as_ref().and_then(|s| s.env_str("PATH").map(|p| p.into_owned()));
                    drop(guard);
                    // NSH-28: how the asking went, as `$?` and in the prompt.
                    let ended = |status: u8| {
                        if let Ok(mut s) = shell.try_lock() {
                            s.set_last_exit_status(status);
                        }
                    };
                    // NSH-9: alone, it asks about a failure just seen, or says how to ask.
                    let ask = match ask.is_empty() {
                        true if self.recent.last_failed() => navi::WHY_FAILED.to_string(),
                        true => {
                            println!("{}", navi::HELP);
                            ended(0);
                            continue;
                        }
                        false => ask,
                    };
                    let home = std::env::var_os("HOME").map(PathBuf::from);
                    let Some(found) = found else {
                        eprintln!("{}", navi::NOT_INSTALLED);
                        ended(127);
                        continue;
                    };
                    // NSH-19: once, so a sentence meant as a command is not a mystery.
                    if !self.noted && !line.trim_start().starts_with('?') {
                        self.noted = true;
                        eprintln!("{}", navi::SENTENCE_NOTE);
                    }
                    match navi::ask(&found, path.as_deref(), &ask, &dir, &self.session, &self.recent.describe(home.as_deref())) {
                        Ok((status, suggested)) => {
                            self.recent.clear();
                            self.suggested = suggested;
                            ended(status);
                        }
                        Err(e) => {
                            eprintln!("neosh: could not start navi: {e}");
                            ended(126);
                        }
                    }
                }
            }
        }
    }

    fn get_read_buffer(&self) -> Option<(String, usize)> {
        self.inner.get_read_buffer()
    }

    fn set_read_buffer(&mut self, buffer: String, cursor: usize) {
        self.inner.set_read_buffer(buffer, cursor);
    }
}

/// NSH-13: neosh's own history file, unless the environment names one.
fn history_file(inherited: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> Option<PathBuf> {
    match inherited {
        Some(_) => None,
        None => home.map(|h| PathBuf::from(h).join(".neosh_history")),
    }
}

/// NSH-26: history put right once `line` is in it: dropped if not kept,
/// and with `erase` its earlier copies dropped.
fn settle(history: &mut brush_core::history::History, line: &str, keep: bool, erase: bool) {
    let ids: Vec<_> = history.iter().filter(|i| i.command_line == line).map(|i| i.id).collect();
    let dropped = match (keep, ids.split_last()) {
        (false, Some((last, _))) => vec![*last],
        (true, Some((_, earlier))) if erase => earlier.to_vec(),
        _ => Vec::new(),
    };
    for id in dropped {
        let _ = history.delete_item_by_id(id);
    }
}

/// NSH-29: whether `line` is only the name of a directory and no command,
/// in words the shell reads as they are (`~` aside), so `cd -- <line>` goes there.
fn autocd<SE: brush_core::ShellExtensions>(shell: &mut brush_core::Shell<SE>, line: &str, dir: &Path, home: Option<&Path>) -> bool {
    let plain = !line.is_empty() && line.chars().all(|c| c.is_alphanumeric() || "._-/~+@:,%".contains(c));
    if !plain || is_command(shell, line) {
        return false;
    }
    let path = match (line.strip_prefix('~'), home) {
        (Some(rest), Some(home)) if rest.is_empty() || rest.starts_with('/') => home.join(rest.trim_start_matches('/')),
        _ => dir.join(line),
    };
    path.is_dir()
}

/// NSH-4: whether a word runs something: a keyword, alias, function, builtin or program.
fn is_command<SE: brush_core::ShellExtensions>(shell: &mut brush_core::Shell<SE>, word: &str) -> bool {
    shell.is_keyword(word)
        || shell.aliases().contains_key(word)
        || shell.func_mut(word).is_some()
        || shell.builtin_mut(word).is_some()
        // A directory on PATH (`bin/..`) is no program.
        || shell.find_first_executable_in_path(word).is_some_and(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(s: &[&str]) -> Vec<String> {
        s.iter().map(|a| a.to_string()).collect()
    }

    // NSH-13
    #[test]
    fn history_is_kept_in_neosh_s_own_file() {
        assert_eq!(history_file(None, Some("/home/u".into())), Some(PathBuf::from("/home/u/.neosh_history")));
        assert_eq!(history_file(Some("/tmp/h".into()), Some("/home/u".into())), None);
        assert_eq!(history_file(None, None), None);
    }

    // NSH-1
    #[test]
    fn arguments_say_what_to_run() {
        assert_eq!(parse_args(&argv(&["neosh"])).unwrap(), Args::default());
        assert_eq!(parse_args(&argv(&["-neosh"])).unwrap(), Args { login: true, ..Default::default() });
        assert_eq!(
            parse_args(&argv(&["neosh", "-l", "-c", "echo $0 $1", "me", "one"])).unwrap(),
            Args { command: Some("echo $0 $1".into()), login: true, rest: argv(&["me", "one"]), ..Default::default() }
        );
        assert_eq!(parse_args(&argv(&["neosh", "run.sh", "-x"])).unwrap(), Args { rest: argv(&["run.sh", "-x"]), ..Default::default() });
        assert!(parse_args(&argv(&["neosh", "-c"])).is_err());
        assert!(parse_args(&argv(&["neosh", "--nope"])).is_err());
    }
}
