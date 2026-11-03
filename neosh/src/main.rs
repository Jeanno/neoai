//! neosh: a bash-compatible shell with navi inside (spec.md).
//!
//! The interpreter is brush's (brush-core, MIT, github.com/reubeno/brush);
//! starting it follows brush-shell's entry. What neosh adds is the line
//! reader around brush's own, which sends lines for navi to navi (NSH-4).

mod navi;
mod prompt;

use std::io::IsTerminal as _;
use std::path::PathBuf;
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
    let shell = builder.build().await?;
    let shell: ShellRef = std::sync::Arc::new(tokio::sync::Mutex::new(shell));

    // NSH-1: ~/.profile for a login shell, ~/.neoshrc for an interactive one.
    let rc = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".neoshrc"));
    let rc = match rc {
        Some(path) if interactive && !args.norc && path.exists() => brush_core::RcLoadBehavior::LoadCustom(path),
        _ => brush_core::RcLoadBehavior::Skip,
    };
    let profile = if args.login { brush_core::ProfileLoadBehavior::LoadDefault } else { brush_core::ProfileLoadBehavior::Skip };
    // NSH-10: the directory and `$`, unless a PS1 came with the environment; the rc can set its own.
    if interactive && std::env::var_os("PS1").is_none() {
        shell.lock().await.env_mut().set_global("PS1", brush_core::ShellVariable::new(prompt::DEFAULT_PS1))?;
    }
    shell.lock().await.load_config(&profile, &rc).await?;

    if let Some(command) = args.command {
        shell.lock().await.run_dash_c_command(command).await?;
    } else if let Some(script) = args.rest.first() {
        shell.lock().await.run_script(std::path::Path::new(script), args.rest.iter().skip(1)).await?;
    } else if interactive {
        let ui = brush_interactive::UIOptions::default();
        let mut input = WithNavi::new(brush_interactive::ReedlineInputBackend::new(&ui, &shell)?);
        brush_interactive::InteractiveShell::new(&shell, &mut input, &(&ui).into())?.run_interactively().await?;
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
    /// What navi suggested running, for the next prompt (NSH-11).
    suggested: Option<String>,
    session: String,
}

impl<IB: InputBackend> WithNavi<IB> {
    fn new(inner: IB) -> Self {
        let started = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        Self { inner, recent: navi::Recent::default(), handed: None, piped: None, took: None, suggested: None, session: format!("neosh-{started}-{}", std::process::id()) }
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
                        let _ = history.update_by_id(item.id, brush_core::history::Item { command_line: typed, ..item });
                    }
                }
                self.recent.clear();
                self.suggested = navi::take_suggestion(&navi::command_file(&self.session));
            }
            if let (Some((line, dir, at)), Some(s)) = (self.handed.take(), guard.as_ref()) {
                let took = at.elapsed();
                self.took = Some(took);
                self.recent.push(navi::Ran { line, dir, status: s.last_exit_status(), took });
            }
            // NSH-12: drawn by neosh while PS1 is still its own.
            let ours = guard.as_ref().filter(|s| s.env_str("PS1").as_deref() == Some(prompt::DEFAULT_PS1)).map(|s| {
                let dir = s.working_dir().to_path_buf();
                let home = std::env::var_os("HOME").map(PathBuf::from);
                prompt::render(&prompt::Parts {
                    dir: &dir,
                    home: home.as_deref(),
                    branch: prompt::branch(&dir),
                    status: s.last_exit_status(),
                    took: self.took,
                    root: s.env_str("EUID").as_deref() == Some("0"),
                    color: s.env_str("NO_COLOR").is_none(),
                })
            });
            let again = InteractivePrompt { prompt: ours.unwrap_or_else(|| prompt.prompt.clone()), alt_side_prompt: prompt.alt_side_prompt.clone(), continuation_prompt: prompt.continuation_prompt.clone() };
            drop(guard.take());
            // NSH-11: ready to run with Enter, change, or clear with ^C.
            if let Some(command) = self.suggested.take() {
                let end = command.len();
                self.inner.set_read_buffer(command, end);
            }
            let read = self.inner.read_line(shell, again)?;
            let ReadResult::Input(line) = read else { return Ok(read) };
            let mut guard = shell.try_lock().ok();
            // NSH-17: read each line, so `NEOSH_ASK=marked` at the prompt counts at once.
            let ask = navi::Ask::from_setting(guard.as_ref().and_then(|s| s.env_str("NEOSH_ASK")).as_deref());
            let what = navi::classify(&line, ask, |word| guard.as_mut().is_none_or(|s| is_command(s, word)));
            let dir = guard.as_ref().map(|s| s.working_dir().to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
            match what {
                navi::Line::Shell => {
                    if !line.trim().is_empty() {
                        self.handed = Some((line.trim().to_string(), dir, Instant::now()));
                    }
                    return Ok(ReadResult::Input(line));
                }
                navi::Line::Piped { command, question } => {
                    let Some(found) = guard.as_ref().and_then(|s| s.find_first_executable_in_path("navi")) else {
                        if let Some(s) = guard.as_mut() {
                            let _ = s.add_to_history(line.trim_end_matches('\n'));
                        }
                        eprintln!("{}", navi::NOT_INSTALLED);
                        continue;
                    };
                    let home = std::env::var_os("HOME").map(PathBuf::from);
                    let file = navi::command_file(&self.session);
                    let _ = std::fs::remove_file(&file);
                    let ran = navi::piped_line(&command, &question, &found, &self.session, &self.recent.describe(home.as_deref()), &file);
                    self.piped = Some((ran.clone(), line.trim_end_matches('\n').to_string()));
                    return Ok(ReadResult::Input(ran));
                }
                navi::Line::Navi(ask) => {
                    // NSH-8: kept as typed.
                    if let Some(s) = guard.as_mut() {
                        let _ = s.add_to_history(line.trim_end_matches('\n'));
                    }
                    // Found as the shell finds programs, so `export PATH=…` here counts.
                    let found = guard.as_ref().and_then(|s| s.find_first_executable_in_path("navi"));
                    let path = guard.as_ref().and_then(|s| s.env_str("PATH").map(|p| p.into_owned()));
                    drop(guard);
                    if ask.is_empty() {
                        println!("{}", navi::HELP);
                        continue;
                    }
                    let home = std::env::var_os("HOME").map(PathBuf::from);
                    let Some(found) = found else {
                        eprintln!("{}", navi::NOT_INSTALLED);
                        continue;
                    };
                    match navi::ask(&found, path.as_deref(), &ask, &dir, &self.session, &self.recent.describe(home.as_deref())) {
                        Ok(suggested) => {
                            self.recent.clear();
                            self.suggested = suggested;
                        }
                        Err(e) => eprintln!("neosh: could not start navi: {e}"),
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

/// NSH-4: whether a word runs something: a keyword, alias, function, builtin or program.
fn is_command<SE: brush_core::ShellExtensions>(shell: &mut brush_core::Shell<SE>, word: &str) -> bool {
    shell.is_keyword(word)
        || shell.aliases().contains_key(word)
        || shell.func_mut(word).is_some()
        || shell.builtin_mut(word).is_some()
        || shell.find_first_executable_in_path(word).is_some()
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
