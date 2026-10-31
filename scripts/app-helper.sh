#!/usr/bin/env bash
# Builds, installs and removes the MaiPai app helper (native/app-helper), the one reader of running apps
# for the auto-close feature. It runs as a LaunchAgent in the logged-in person's session, never as root.
#
#   bash scripts/app-helper.sh build [out-dir]      release build (arm64 + x86_64), signed ad hoc or with MAIPAI_CODESIGN_IDENTITY
#   bash scripts/app-helper.sh install [binary]     copy the binary, write the LaunchAgent, load it
#   bash scripts/app-helper.sh status               show the agent, the binary and the socket
#   bash scripts/app-helper.sh remove               unload the agent and delete its files
#
# Home calls install only after an admin turns the feature on (auto-close-apps design note, sections 5 and 6);
# a fresh install of Home does not load it. No file here is ever written outside the person's own home folder.
set -euo pipefail

label="ai.maipai.app-helper"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkg="$here/native/app-helper"
agents_dir="${MAIPAI_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
launchctl_cmd="${MAIPAI_LAUNCHCTL:-launchctl}"
support="${MAIPAI_APP_HELPER_DIR:-$HOME/Library/Application Support/MaiPai}"
bin_dir="$support/app-helper"
bin="$bin_dir/maipai-app-helper"
sock="$support/app-helper.sock"
log="${MAIPAI_APP_HELPER_LOG:-$HOME/Library/Logs/MaiPai/app-helper.log}"
plist="$agents_dir/$label.plist"

die() { echo "app-helper: $*" >&2; exit 1; }

case "${1:-}" in
  build)
    out="${2:-$here/data-scratch/app-helper-build}"
    command -v swift >/dev/null || die "the Swift toolchain is missing. Install Xcode or its command line tools, then run this again."
    (cd "$pkg" && swift build -c release --arch arm64 --arch x86_64 >&2)
    built="$(cd "$pkg" && swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/maipai-app-helper"
    [[ -x "$built" ]] || die "the build produced no binary at $built. Read the build output above."
    mkdir -p "$out"
    cp "$built" "$out/maipai-app-helper"
    codesign --force --sign "${MAIPAI_CODESIGN_IDENTITY:--}" --options runtime --identifier "$label" "$out/maipai-app-helper" >&2 \
      || die "signing failed. Check MAIPAI_CODESIGN_IDENTITY, or unset it for an ad hoc signature."
    echo "$out/maipai-app-helper"
    ;;
  install)
    [[ "$(id -u)" != 0 ]] || die "run this as the logged-in person, not root: the helper must live in that person's session."
    src="${2:-}"
    if [[ -z "$src" ]]; then src="$("$0" build)" || exit 1; fi
    [[ -x "$src" ]] || die "$src is not an executable. Build it with: bash scripts/app-helper.sh build"
    mkdir -p "$bin_dir" "$agents_dir" "$(dirname "$log")"
    chmod 700 "$support"
    install -m 755 "$src" "$bin"
    python3 - "$pkg/$label.plist" "$plist" "$bin" "$log" "$sock" <<'PY'
import plistlib, sys
template, out, binary, log, sock = sys.argv[1:6]
with open(template, "rb") as f:
    value = plistlib.load(f)
value["ProgramArguments"] = [binary, "--socket", sock]
value["StandardErrorPath"] = log
value["StandardOutPath"] = log
with open(out, "wb") as f:
    plistlib.dump(value, f, fmt=plistlib.FMT_XML, sort_keys=True)
PY
    uid="$(id -u)"
    "$launchctl_cmd" bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
    "$launchctl_cmd" bootstrap "gui/$uid" "$plist" || die "launchd would not load the helper (error 5 means nobody is logged in at the Mac's own screen). Log in there and run this again."
    echo "installed $plist"
    ;;
  status)
    [[ -f "$plist" ]] && echo "agent: installed ($plist)" || echo "agent: not installed"
    [[ -x "$bin" ]] && echo "binary: present" || echo "binary: missing"
    [[ -S "$sock" ]] && echo "socket: present" || echo "socket: absent"
    ;;
  remove)
    "$launchctl_cmd" bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
    rm -f "$plist" "$sock"
    rm -rf "$bin_dir"
    echo "removed the app helper"
    ;;
  *) die "usage: app-helper.sh build [out-dir] | install [binary] | status | remove" ;;
esac
