#!/usr/bin/env bash
# PreToolUse (Bash) guardrail, SINGLE-WRITER-01 (2026-11-12). A GUARDRAIL, NOT A SECURITY BOUNDARY: every session runs as the owner's user,
# so a session that wants to can still do these things another way. It stops the common mistakes:
#   - a push to main from a session (only the lander pushes main: land.sh, or land.sh --express via rush-ship.sh / ship-now.sh);
#   - a session restarting a shared service: launchctl bootout/bootstrap/kickstart/kill/load/unload/stop/start/remove/enable/disable,
#     bash scripts/pipeline.sh stack on|off, the root helpers maipai-promote and maipai-install (ship.sh is the sanctioned path).
# Deterministic: no network, writes nothing. Owner-approved exception: put MAIPAI_ALLOW_SHARED_SERVICE=1 in the command.
set -euo pipefail
input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[[ -n "$command" ]] || exit 0
printf '%s' "$command" | grep -q 'MAIPAI_ALLOW_SHARED_SERVICE=1' && exit 0
seg='(^|[;&|(]|&&|\|\||\$\()[[:space:]]*'
reason=""
if printf '%s' "$command" | grep -Eq "${seg}(sudo[[:space:]]+(-n[[:space:]]+)?)?git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]]+[^;&|]*)?[[:space:]:+](refs/heads/)?main([[:space:];&|)]|$)"; then
  reason="Only the lander pushes main (one writer). Land with: bash scripts/land.sh (or, on the owner's word, bash scripts/rush-ship.sh --owner-asked, which goes through land.sh --express)."
elif printf '%s' "$command" | grep -Eq "${seg}(sudo[[:space:]]+(-n[[:space:]]+)?)?launchctl[[:space:]]+(bootout|bootstrap|kickstart|kill|load|unload|stop|start|remove|enable|disable)\b"; then
  reason="Sessions do not restart shared services (the Stack, the hub, the lander, the watcher). Ask the owner; pipeline.sh start/stop is for the pipeline daemons only."
elif printf '%s' "$command" | grep -Eq "pipeline\.sh[[:space:]]+stack[[:space:]]+(on|off)\b"; then
  reason="Stopping or starting the Stack is the owner's call (the family may be using it). bash scripts/pipeline.sh stack status is allowed."
elif printf '%s' "$command" | grep -Eq "(^|[^[:alnum:]_-])(maipai-promote|maipai-install)([^[:alnum:]_-]|$)"; then
  reason="The live hub is installed only through bash scripts/ship.sh (with the owner's word), never by calling the root helper directly."
fi
[[ -n "$reason" ]] || exit 0
jq -n --arg reason "$reason If the owner approved this exact command, put MAIPAI_ALLOW_SHARED_SERVICE=1 in it." '{decision: "deny", reason: $reason}' >&2
exit 2
