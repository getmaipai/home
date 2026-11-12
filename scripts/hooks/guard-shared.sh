#!/usr/bin/env bash
# PreToolUse (Bash) guardrail, SINGLE-WRITER-01 (2026-11-12). A GUARDRAIL, NOT A SECURITY BOUNDARY: every session runs as the owner's user,
# so a session that wants to can still do these things another way. It stops the common mistakes:
#   - a push to main from a session (only the lander pushes main: land.sh, or land.sh --express via rush-ship.sh / ship-now.sh);
#   - a session restarting a shared service: launchctl bootout/bootstrap/kickstart/kill/load/unload/stop/start/remove/enable/disable,
#     bash scripts/pipeline.sh stack on|off, the root helpers maipai-promote and maipai-install (ship.sh is the sanctioned path).
# Deterministic: no network, writes nothing. ship.sh, ship-now.sh, rush-ship.sh, the lander and the installer call these helpers from
# inside their own scripts, which this hook never sees, so they keep working untouched.
# The one owner-approved escape (owner ruling 2026-11-12): a rollback (maipai-promote --rollback) or a tag install (maipai-install vX.Y.Z)
# is allowed when MAIPAI_OWNER_APPROVED=1 is in that exact command. A session sets it only after the owner said yes in the question wizard
# for that rollback or that tag. Nothing else has an escape.
set -euo pipefail
input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[[ -n "$command" ]] || exit 0
owner_ok=0; printf '%s' "$command" | grep -Eq '(^|[[:space:];&|])MAIPAI_OWNER_APPROVED=1([[:space:]]|$)' && owner_ok=1
seg='(^|[;&|(]|&&|\|\||\$\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
reason=""
if printf '%s' "$command" | grep -Eq "${seg}(sudo[[:space:]]+(-n[[:space:]]+)?)?git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]]+[^;&|]*)?[[:space:]:+](refs/heads/)?main([[:space:];&|)]|$)"; then
  reason="Only the lander pushes main (one writer). Land with: bash scripts/land.sh (or, on the owner's word, bash scripts/rush-ship.sh --owner-asked, which goes through land.sh --express)."
elif printf '%s' "$command" | grep -Eq "${seg}(sudo[[:space:]]+(-n[[:space:]]+)?)?launchctl[[:space:]]+(bootout|bootstrap|kickstart|kill|load|unload|stop|start|remove|enable|disable)\b"; then
  reason="Sessions do not restart shared services (the Stack, the hub, the lander, the watcher). Ask the owner; pipeline.sh start/stop is for the pipeline daemons only."
elif printf '%s' "$command" | grep -Eq "pipeline\.sh[[:space:]]+stack[[:space:]]+(on|off)\b"; then
  reason="Stopping or starting the Stack is the owner's call (the family may be using it). bash scripts/pipeline.sh stack status is allowed."
elif (( owner_ok )) && printf '%s' "$command" | grep -Eq "^[[:space:]]*MAIPAI_OWNER_APPROVED=1[[:space:]]+sudo[[:space:]]+(-n[[:space:]]+)?(/usr/local/libexec/)?maipai-promote[[:space:]]+--rollback[[:space:]]*$"; then
  reason=""
elif (( owner_ok )) && printf '%s' "$command" | grep -Eq "^[[:space:]]*MAIPAI_OWNER_APPROVED=1[[:space:]]+sudo[[:space:]]+(-n[[:space:]]+)?(/usr/local/(sbin|bin|libexec)/)?maipai-install[[:space:]]+v[0-9]+\.[0-9]+\.[0-9]+[[:space:]]*$"; then
  reason=""
elif printf '%s' "$command" | grep -Eq "(^|[^[:alnum:]_-])(maipai-promote|maipai-install)([^[:alnum:]_-]|$)"; then
  reason="The live hub is installed only through bash scripts/ship.sh (with the owner's word), never by calling the root helper directly."
fi
[[ -n "$reason" ]] || exit 0
jq -n --arg reason "$reason Owner-approved escape, only for a rollback or a tag install and only after the owner said yes in the question wizard: MAIPAI_OWNER_APPROVED=1 sudo -n /usr/local/libexec/maipai-promote --rollback, or MAIPAI_OWNER_APPROVED=1 sudo -n maipai-install vX.Y.Z (that exact command, nothing chained)." '{decision: "deny", reason: $reason}' >&2
exit 2
