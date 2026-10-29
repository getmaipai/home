#!/usr/bin/env bash
# Keeps one Claude Code session alive in tmux on the Mac Studio, so releases,
# installs and the Smart Turn bench run in the Studio's own login session
# (no launchd error 5, no Keychain-over-ssh problem).
#
#   bash scripts/studio-claude.sh install   write and load the LaunchAgent
#   bash scripts/studio-claude.sh status    show the agent and the tmux session
#   bash scripts/studio-claude.sh remove    unload and delete the LaunchAgent
#   bash scripts/studio-claude.sh start     start the session once if it is missing
#   bash scripts/studio-claude.sh run       (used by the agent) keep it started
#
# The session runs `claude --dangerously-skip-permissions`: it asks nothing.
# Attach with `tmux attach -t studio-claude`. It starts at login; with FileVault
# on, someone logs in once after a restart, as for the Stack.
set -euo pipefail

# launchd starts agents with a bare PATH that lacks Homebrew, where tmux and claude live.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

label="com.maipai.studio-claude"
session="${MAIPAI_STUDIO_CLAUDE_SESSION:-studio-claude}"
agents_dir="${MAIPAI_LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
launchctl_cmd="${MAIPAI_LAUNCHCTL:-launchctl}"
plist="$agents_dir/$label.plist"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checkout="${MAIPAI_STUDIO_CLAUDE_DIR:-$here}"
script="$checkout/scripts/studio-claude.sh"

die() { echo "studio-claude: $*" >&2; exit 1; }

# A login shell, so claude and tmux are found the way they are in Terminal.
start_session() {
  tmux has-session -t "$session" 2>/dev/null && return 0
  tmux new-session -d -s "$session" -c "$checkout" "${SHELL:-/bin/zsh} -lc 'claude --dangerously-skip-permissions'"
  echo "started tmux session $session in $checkout"
}

case "${1:-}" in
  start) start_session ;;
  run)
    # launchd runs this at login; the loop restarts the session if it ever exits.
    while true; do start_session || true; sleep 60; done
    ;;
  install)
    command -v tmux >/dev/null || die "tmux is not installed. Install it (brew install tmux), then run this again."
    [[ -f "$script" ]] || die "$script is missing. Run this from a home checkout that has scripts/studio-claude.sh."
    mkdir -p "$agents_dir"
    python3 - "$plist" "$label" "$script" "$HOME" <<'PY'
import plistlib, sys
plist, label, script, home = sys.argv[1:5]
value = {
    "Label": label,
    "ProgramArguments": ["/bin/bash", script, "run"],
    "RunAtLoad": True,
    "KeepAlive": True,
    "StandardOutPath": f"{home}/Library/Logs/studio-claude.log",
    "StandardErrorPath": f"{home}/Library/Logs/studio-claude.log",
}
with open(plist, "wb") as f:
    plistlib.dump(value, f, fmt=plistlib.FMT_XML, sort_keys=True)
PY
    uid="$(id -u)"
    "$launchctl_cmd" bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
    "$launchctl_cmd" bootstrap "gui/$uid" "$plist" || die "launchd would not load the agent (error 5 means nobody is logged in at the Mac's own screen). Log in there and run this again."
    echo "installed $plist"
    echo "attach with: tmux attach -t $session"
    ;;
  status)
    [[ -f "$plist" ]] && echo "agent: installed ($plist)" || echo "agent: not installed"
    if tmux has-session -t "$session" 2>/dev/null; then echo "session: $session running"; else echo "session: $session not running"; fi
    ;;
  remove)
    "$launchctl_cmd" bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
    if [[ -f "$plist" ]]; then rm -f "$plist"; echo "removed $plist"; else echo "not installed"; fi
    tmux kill-session -t "$session" 2>/dev/null && echo "stopped session $session" || true
    ;;
  *) die "usage: studio-claude.sh install | status | remove | start | run" ;;
esac
