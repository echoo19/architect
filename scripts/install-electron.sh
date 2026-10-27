#!/usr/bin/env bash
# Installs the Electron binary the way docs/GOTCHAS.md describes, because Electron 45's package
# downloads nothing when it is installed: fetch the release zip, check it against the release's
# SHASUMS256.txt, and unzip it.
#
#   scripts/install-electron.sh <win32|darwin> <x64|arm64> [folder]
#
# Run it from the repository root after `pnpm install`. Without a folder the binary goes into
# node_modules/electron/dist and path.txt is written beside it, which is where
# `require('electron')` looks. With one, the zip is only unpacked there, for a build of another
# architecture to point electronDist at.
set -euo pipefail

usage="usage: scripts/install-electron.sh <win32|darwin> <x64|arm64> [folder]"
platform="${1:?$usage}"
arch="${2:?$usage}"
package=node_modules/electron
folder="${3:-$package/dist}"

case "$platform" in
  win32) binary=electron.exe ;;
  darwin) binary=Electron.app/Contents/MacOS/Electron ;;
  *) echo "Electron is installed for win32 and darwin only, not $platform." >&2; exit 1 ;;
esac

version="$(node -p "require('./$package/package.json').version")"
zip="electron-v$version-$platform-$arch.zip"
release="https://github.com/electron/electron/releases/download/v$version"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/electron.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

download() {
  curl --fail --silent --show-error --location --retry 3 --output "$scratch/$1" "$release/$1"
}
download "$zip"
download SHASUMS256.txt

expected="$(awk -v name="$zip" '{ file = $2; sub(/^\*/, "", file); if (file == name) print $1 }' "$scratch/SHASUMS256.txt")"
actual="$(node -e "
const hash = require('node:crypto').createHash('sha256');
require('node:fs').createReadStream(process.argv[1])
  .on('data', (chunk) => hash.update(chunk))
  .on('end', () => console.log(hash.digest('hex')));
" "$scratch/$zip")"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "$zip does not match its checksum in SHASUMS256.txt (expected '$expected', got '$actual')." >&2
  exit 1
fi

rm -rf "$folder"
mkdir -p "$folder"
unzip -q "$scratch/$zip" -d "$folder"
if [ "$folder" = "$package/dist" ]; then
  printf '%s' "$binary" > "$package/path.txt"
fi
echo "Installed Electron $version for $platform-$arch in $folder."
