#!/usr/bin/env bash
# Builds the macOS disk images for Apple silicon and Intel, called by .github/workflows/release.yml.
#
# With the signing secrets set, the app is signed with the Developer ID certificate, notarized
# with an App Store Connect API key, stapled, and each image is checked: the app inside must pass
# codesign, carry a stapled ticket and pass Gatekeeper's assessment. Without them (a fork, say)
# the app is signed ad hoc so Apple silicon will run it, and macOS asks the user to approve the
# first launch.
#
#   bash scripts/release-mac.sh <folder with the Intel Electron>
set -euo pipefail

x64_electron=${1:?Expected the folder holding the Intel Electron}
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"

signed=false
if [ -n "${MAC_CERT_P12_BASE64:-}" ]; then
  for key in MAC_CERT_PASSWORD APPLE_API_KEY_P8 APPLE_API_KEY_ID APPLE_API_ISSUER; do
    if [ -z "${!key:-}" ]; then
      echo "::error::Missing signing secret: $key"
      exit 1
    fi
  done
  signed=true
fi

umask 077
key_file="$RUNNER_TEMP/ArchitectAuthKey.p8"
mountpoint="$RUNNER_TEMP/architect-dmg"
cleanup() {
  rm -f "$key_file"
  hdiutil detach "$mountpoint" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ "$signed" = true ]; then
  export CSC_LINK="$MAC_CERT_P12_BASE64" CSC_KEY_PASSWORD="$MAC_CERT_PASSWORD"
  printf '%s' "$APPLE_API_KEY_P8" >"$key_file"
  # electron-builder notarizes with APPLE_API_KEY (the key file), APPLE_API_KEY_ID and
  # APPLE_API_ISSUER.
  export APPLE_API_KEY="$key_file"
  options=()
else
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  # Library validation would reject Electron's own frameworks under an ad hoc signature.
  options=(-c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false)
fi

# Apple's ticket service sometimes drops its connection while electron-builder staples
# (code 68). Only that failure is retried; notarization is never skipped.
build() {
  local arch=$1
  shift
  local attempt log="$RUNNER_TEMP/build-$arch.log"
  for attempt in 1 2 3; do
    if pnpm --filter @architect/desktop exec electron-builder --publish never --mac "--$arch" \
      ${options[@]+"${options[@]}"} "$@" 2>&1 | tee "$log"; then
      return 0
    fi
    if ! grep -q 'code: 68' "$log" || [ "$attempt" -eq 3 ]; then return 1; fi
    echo "Stapling hit Apple's transient ticket lookup failure (68); building again in 30 seconds." >&2
    sleep 30
  done
}

# The same lookup can fail when the ticket is checked afterwards; retry only that failure.
validate_ticket() {
  local attempt status
  for attempt in 1 2 3; do
    if xcrun stapler validate "$1"; then return 0; else status=$?; fi
    if [ "$status" -ne 68 ] || [ "$attempt" -eq 3 ]; then return "$status"; fi
    echo "Ticket lookup failed (68); checking again in 10 seconds." >&2
    sleep 10
  done
}

pnpm --filter @architect/desktop build
build arm64
build x64 -c.electronDist="$x64_electron"

if [ "$signed" = true ]; then
  for dmg in apps/desktop/release/Architect-*.dmg; do
    hdiutil attach -nobrowse -readonly -mountpoint "$mountpoint" "$dmg"
    app="$mountpoint/Architect.app"
    codesign --verify --deep --strict --verbose=2 "$app"
    validate_ticket "$app"
    spctl --assess --type execute --verbose "$app"
    hdiutil detach "$mountpoint"
    echo "$dmg: signed, notarized and stapled"
  done
fi
