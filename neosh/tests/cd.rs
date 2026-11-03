//! NSH-25: `cd` and CDPATH, through the neosh binary.

use std::process::Command;

fn neosh(dir: &std::path::Path, script: &str) -> (String, String, i32) {
    let out = Command::new(env!("CARGO_BIN_EXE_neosh")).args(["-c", script]).current_dir(dir).env("HOME", dir).output().unwrap();
    (String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned(), out.status.code().unwrap_or(-1))
}

// NSH-25
#[test]
fn cd_finds_a_directory_in_cdpath_and_says_where() {
    let top = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("neosh-cd-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&top);
    for d in ["projects/neoai", "here/local"] {
        std::fs::create_dir_all(top.join(d)).unwrap();
    }
    std::fs::write(top.join("here/file"), "").unwrap();
    let here = top.join("here");
    let cdpath = format!("CDPATH={}", top.join("projects").display());
    let (out, _, code) = neosh(&here, &format!("{cdpath}; cd neoai && pwd"));
    let found = top.join("projects/neoai").display().to_string();
    assert_eq!(out, format!("{found}\n{found}\n"));
    assert_eq!(code, 0);
    let (out, _, _) = neosh(&here, &format!("{cdpath}; cd local && pwd"));
    assert_eq!(out, format!("{}\n", here.join("local").display()), "not in CDPATH: here, unprinted");
    let (_, err, code) = neosh(&here, "cd nope");
    assert_eq!((err.trim(), code), ("neosh: cd: nope: No such file or directory", 1));
    let (_, err, code) = neosh(&here, "cd file");
    assert_eq!((err.trim(), code), ("neosh: cd: file: Not a directory", 1));
    std::fs::remove_dir_all(&top).unwrap();
}
