#!/usr/bin/env bash
# Builds, installs and removes the MaiPai app helper (native/app-helper), the one reader of running apps
# for the auto-close feature. It runs as a LaunchAgent in the logged-in person's session, never as root.
#
#   bash scripts/app-helper.sh build [out-dir]      release build (arm64 + x86_64), signed ad hoc or with MAIPAI_CODESIGN_IDENTITY
#   bash scripts/app-helper.sh install [binary]     copy the binary, write the LaunchAgent, load it
#   bash scripts/app-helper.sh status               show the agent, the binary and the socket
#   bash scripts/app-helper.sh remove               unload the agent and delete its files
#
# Installing the helper does not turn the feature on (presets leave Close apps Off); it only lets Home see and quit apps once an admin does.
# scripts/install.sh (macOS) and the setup wizard / Close apps card ("Install helper") both call `install`. Run as root (they are),
# it re-runs itself as the person logged in at the Mac's own screen, so nothing is built or written as root.
# No file here is ever written outside that person's own home folder. Exit codes: 10 no Swift toolchain, 11 nobody logged in, 12 launchd refused.
set -euo pipefail

label="ai.maipai.app-helper"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkg="$here/native/app-helper"
agents_dir="${MAIPAI_LAUNCH_AGENTS_DIR:-${HOME:-/var/empty}/Library/LaunchAgents}"
launchctl_cmd="${MAIPAI_LAUNCHCTL:-launchctl}"
support="${MAIPAI_APP_HELPER_DIR:-${HOME:-/var/empty}/Library/Application Support/MaiPai}"
bin_dir="$support/app-helper"
bin="$bin_dir/maipai-app-helper"
sock="$support/app-helper.sock"
log="${MAIPAI_APP_HELPER_LOG:-${HOME:-/var/empty}/Library/Logs/MaiPai/app-helper.log}"
plist="$agents_dir/$label.plist"

die() { echo "app-helper: $*" >&2; exit "${2:-1}"; }
is_root() { [[ "${MAIPAI_TEST_UID:-$(id -u)}" == 0 ]]; }
scratch="${MAIPAI_APP_HELPER_SCRATCH:-$support/swift-build}"

case "${1:-}" in
  build)
    out="${2:-$support/build}"
    if ! xcode-select -p >/dev/null 2>&1 || ! command -v swift >/dev/null; then
      die "the Swift toolchain is missing. At the Mac's own screen open Terminal, run xcode-select --install, wait for it to finish, then install the helper again." 10
    fi
    # Built for this Mac's own chip into the person's own folder (the install folder is root-owned), so it is quick and needs no privileges.
    arch_flags=(--arch "${MAIPAI_APP_HELPER_ARCH:-$(uname -m)}")
    (cd "$pkg" && swift build -c release "${arch_flags[@]}" --scratch-path "$scratch" >&2)
    built="$(cd "$pkg" && swift build -c release "${arch_flags[@]}" --scratch-path "$scratch" --show-bin-path)/maipai-app-helper"
    [[ -x "$built" ]] || die "the build produced no binary at $built. Read the build output above."
    mkdir -p "$out"
    cp "$built" "$out/maipai-app-helper"
    codesign --force --sign "${MAIPAI_CODESIGN_IDENTITY:--}" --options runtime --identifier "$label" "$out/maipai-app-helper" >&2 \
      || die "signing failed. Check MAIPAI_CODESIGN_IDENTITY, or unset it for an ad hoc signature."
    echo "$out/maipai-app-helper"
    ;;
  install)
    if is_root; then
      # The helper must live in the logged-in person's session, so root hands the whole install to that person.
      who="${MAIPAI_CONSOLE_USER:-$(stat -f%Su /dev/console 2>/dev/null || true)}"
      if [[ -z "$who" || "$who" == root || "$who" == loginwindow ]]; then
        die "nobody is logged in at the Mac's own screen. Log in there (the lock screen counts as logged out), then install the helper again." 11
      fi
      uid="$(id -u "$who" 2>/dev/null)" || die "$who is not an account on this Mac. Log in at the Mac's own screen as the person who uses it, then install the helper again." 11
      home="$(dscl . -read "/Users/$who" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
      [[ -n "$home" ]] || home="/Users/$who"
      exec "$launchctl_cmd" asuser "$uid" sudo -u "$who" env "HOME=$home" bash "$here/scripts/app-helper.sh" install ${2:+"$2"}
    fi
    src="${2:-}"
    if [[ -z "$src" ]]; then src="$(bash "$0" build)" || exit $?; fi
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
    "$launchctl_cmd" bootstrap "gui/$uid" "$plist" || die "launchd would not load the helper (error 5 means nobody is logged in at the Mac's own screen). Log in there and run this again." 12
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
