#!/bin/sh
# Builds the release package that install.sh downloads: the extension bundled
# for distribution (neorouter and neonavi inlined, so no Node or npm on the
# user's side), without source maps, as navi-raycast.tar.gz in this folder.
#
#   sh scripts/dist.sh [version]      run from anywhere, after npm install at the repo root
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
version=${1:-$(node -p "require('$here/package.json').version")}
cd "$here"

# `ray build -e dist` type-checks with ./node_modules/.bin/tsc and nothing
# else; in a workspace the compiler is hoisted to the root.
if [ ! -x node_modules/.bin/tsc ]; then
  mkdir -p node_modules/.bin
  ln -sf ../../../../node_modules/typescript/bin/tsc node_modules/.bin/tsc
fi

rm -rf dist navi-raycast.tar.gz
npx ray build -e dist -o dist -I
find dist -name '*.map' -delete
printf '%s\n' "$version" > dist/VERSION
tar -czf navi-raycast.tar.gz -C dist .
echo "built navi-raycast.tar.gz ($version, $(du -h navi-raycast.tar.gz | cut -f1))"
