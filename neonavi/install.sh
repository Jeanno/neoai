#!/bin/sh
# Puts `navi` on your PATH. Needs Node 22+ (and git when run through curl).
#
#   curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/neonavi/install.sh | sh
#   ./install.sh               the same, from a checkout you already have
#
# Run it again to update. To remove navi:
#
#   curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/neonavi/install.sh | sh -s -- --uninstall
#   ./install.sh --uninstall
#
# The command is a small launcher in ~/.local/bin (override with NAVI_BIN_DIR)
# that runs navi through the checkout's own tsx, so Bun is not required. Piped
# from curl, the checkout is cloned to ~/.local/share/neoai (NEOAI_SRC).
set -eu

repo_url=${NEOAI_REPO:-https://github.com/Jeanno/neoai.git}
src_dir=${NEOAI_SRC:-"$HOME/.local/share/neoai"}
bin_dir=${NAVI_BIN_DIR:-"$HOME/.local/bin"}
target="$bin_dir/navi"
# Written into the launcher and the clone, so we only replace or remove our own.
marker="# installed by neoai/neonavi/install.sh"
clone_marker="$src_dir/.git/neoai-install"

say() { printf '%s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
ours() { [ -f "$target" ] && grep -qF "$marker" "$target"; }

if [ "${1:-}" = "--uninstall" ]; then
  if ours; then
    rm "$target"
    say "Removed $target"
  elif [ -e "$target" ]; then
    fail "$target was not installed by this script; leaving it alone"
  else
    say "navi is not installed in $bin_dir"
  fi
  # Only a clone this script made; a checkout you cloned yourself is yours.
  if [ -f "$clone_marker" ]; then
    rm -rf "$src_dir"
    say "Removed $src_dir"
  fi
  exit 0
fi
[ $# -eq 0 ] || fail "unknown option: $1 (try --uninstall)"

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get it from https://nodejs.org or run: brew install node"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "navi needs Node 22 or newer; this is $(node -v). Update from https://nodejs.org or run: brew upgrade node"

if [ -e "$target" ] && ! ours; then
  fail "$target already exists and was not installed by this script. Remove it, or set NAVI_BIN_DIR to install elsewhere."
fi

# Run from a checkout, use it. Piped from curl there is no checkout beside us,
# so fetch one (or update the one fetched last time).
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || here=
if [ -n "$here" ] && [ -f "$here/src/cli.ts" ] && [ -f "$here/../package.json" ]; then
  root=$(cd "$here/.." && pwd)
else
  command -v git >/dev/null 2>&1 || fail "git is not installed. On a Mac, run: xcode-select --install"
  if [ -f "$clone_marker" ]; then
    say "Updating ${src_dir}…"
    git -C "$src_dir" pull --ff-only --quiet || fail "could not update $src_dir"
  elif [ -e "$src_dir" ]; then
    fail "$src_dir already exists and was not cloned by this script. Remove it, or set NEOAI_SRC."
  else
    say "Downloading neoai to ${src_dir}…"
    mkdir -p "$(dirname "$src_dir")"
    git clone --depth 1 --quiet "$repo_url" "$src_dir" || fail "could not clone $repo_url"
    touch "$clone_marker"
  fi
  root=$src_dir
  here="$src_dir/neonavi"
fi

say "Installing dependencies…"
(cd "$root" && npm install --no-audit --no-fund --loglevel=error >/dev/null) || fail "npm install failed in $root"

tsx="$root/node_modules/.bin/tsx"
[ -x "$tsx" ] || fail "tsx is missing from $root/node_modules after npm install"

mkdir -p "$bin_dir"
# --tsconfig pins navi's own settings; otherwise tsx would read the tsconfig of
# whatever project you happen to run navi in.
cat >"$target" <<EOF
#!/bin/sh
$marker
exec "$tsx" --tsconfig "$here/tsconfig.json" "$here/src/cli.ts" "\$@"
EOF
chmod +x "$target"

# With no prompt and no terminal, navi prints its usage line: proof it starts.
"$target" </dev/null 2>&1 | grep -q '^usage: navi' || fail "installed $target, but it did not start; try running it directly"

say "Installed navi → $target"
# Tells someone with no model yet what to do next, rather than leaving it to
# their first question to fail. Only reports; never asks (SET-2).
say ""
"$target" setup --check </dev/null || true
say ""
case ":$PATH:" in
  *":$bin_dir:"*) say "Try it: navi -p \"what is in this directory\"" ;;
  *)
    say ""
    say "$bin_dir is not on your PATH yet. Add this line to ~/.zshrc (or your shell's startup file),"
    say "then open a new terminal:"
    say ""
    say "  export PATH=\"$bin_dir:\$PATH\""
    ;;
esac
