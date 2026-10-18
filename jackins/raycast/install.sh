#!/bin/sh
# Installs Navi for Raycast without the Store, Node, npm or git:
#
#   curl -fsSL https://raw.githubusercontent.com/Jeanno/neoai/master/jackins/raycast/install.sh | sh
#
# It downloads the latest prebuilt release (a few hundred KB), puts it in
# Raycast's extensions folder and tells Raycast about it. Run it again to
# update; chats and settings are kept. To remove Navi, press ⌘K on any of its
# commands in Raycast and choose Uninstall Extension.
set -eu

repo=Jeanno/neoai
name=navi-raycast
dest="$HOME/.config/raycast/extensions/$name"
# Raycast records a source folder for a development extension; give it one
# that stays put rather than a temporary download folder.
home_dir="$HOME/.local/share/$name"

ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; exit 1; }

printf 'Installing Navi for Raycast\n'

[ "$(uname -s)" = Darwin ] || fail "Navi for Raycast needs macOS."
if [ -d /Applications/Raycast.app ] || mdfind "kMDItemCFBundleIdentifier == 'com.raycast.macos'" 2>/dev/null | grep -q .; then
  ok "Raycast found"
else
  fail "Raycast is not installed. Get it from https://raycast.com, then run this again."
fi

# The repo also releases other things, so take the newest raycast-v* tag rather
# than "latest". NAVI_RAYCAST_ASSET_URL is for testing (file:// works).
url=${NAVI_RAYCAST_ASSET_URL:-}
if [ -z "$url" ]; then
  tag=$(curl -fsSL "https://api.github.com/repos/$repo/releases?per_page=30" 2>/dev/null |
    grep -o '"tag_name": *"raycast-v[^"]*"' | head -n 1 | sed 's/.*"\(raycast-v[^"]*\)"$/\1/') || tag=
  [ -n "$tag" ] || fail "Couldn't find a Navi for Raycast release. Check your internet connection and try again."
  url="https://github.com/$repo/releases/download/$tag/$name.tar.gz"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/pkg.tar.gz" || fail "Download failed: $url"
mkdir "$tmp/pkg"
tar -xzf "$tmp/pkg.tar.gz" -C "$tmp/pkg" || fail "The download is damaged; try again."
grep -q "\"name\": \"$name\"" "$tmp/pkg/package.json" 2>/dev/null || fail "The download is not Navi for Raycast."
version=$(cat "$tmp/pkg/VERSION" 2>/dev/null || echo '?')
ok "Downloaded $version"

# Replace only Navi itself: a folder of this name holding something else is
# not ours to delete.
if [ -e "$dest" ] && ! grep -q "\"name\": \"$name\"" "$dest/package.json" 2>/dev/null; then
  fail "$dest exists and is not Navi; leaving it alone."
fi
mkdir -p "$(dirname "$dest")" "$home_dir"
rm -rf "$dest"
mv "$tmp/pkg" "$dest"
cp "$dest/package.json" "$home_dir/package.json"
ok "Installed"

# The notification `ray develop` sends after a build: it registers or reloads a
# development extension, and `open` starts Raycast if it isn't running. It is
# not a documented interface; if it stops working, installing from source
# (see the guide) still does.
cwd=$(osascript -l JavaScript -e 'function run(a) { return encodeURIComponent(a[0]) }' "$home_dir")
open -g -b com.raycast.macos "raycast://cli/$name/build-success?cwd=$cwd&info=" || fail "Couldn't reach Raycast. Open it and run this again."
ok "Added to Raycast"

printf '\nOpen Raycast and type "Ask Navi".\n'
printf 'Navi needs a model to answer with; the easiest is LM Studio (https://lmstudio.ai).\n'
printf 'Step-by-step guide: https://github.com/%s/blob/master/jackins/raycast/README.md\n' "$repo"
