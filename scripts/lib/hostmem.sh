#!/bin/bash
# Host memory gate for heavy development work (HOST-GUARD-09, 2026-11-12). Sourced by ship.sh, lander.sh, watcher.sh and check.sh.
#
#   hostmem_gate "<what>"   0: go ahead. 75: do not start now; one plain line on stderr says why (the caller defers and retries).
#
# It says no while the kernel reports memory pressure level 2 or more (kern.memorystatus_vm_pressure_level), or while the host guard's
# dev-shed flag is fresh (written within 10 minutes; a stale flag from a stopped guard is ignored). On 2026-11-12 pressure sat at
# level 2 for hours because the file-event daemon leaked 66 GB, and tests started anyway paused for 40 minutes and died "unfinished".
# A missing reading never blocks and never counts as a pass of anything: the caller only decides whether to start.
# MAIPAI_MEMORY_GATE=off skips the gate (the owner's explicit override). Test seams: MAIPAI_HOSTMEM_PRESSURE, MAIPAI_HOST_GUARD_STATE_DIR.

hostmem_state_dir() { printf '%s' "${MAIPAI_HOST_GUARD_STATE_DIR:-/var/db/maipai-host-guard}"; }

hostmem_pressure() {
  local v=""
  if [[ -n "${MAIPAI_HOSTMEM_PRESSURE:-}" ]]; then v="$MAIPAI_HOSTMEM_PRESSURE"
  elif [[ "$(uname)" == Darwin ]]; then v="$(/usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null)"
  fi
  [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0
}

hostmem_dev_shed() {
  local f m=""
  f="$(hostmem_state_dir)/dev-shed"
  [[ -f "$f" ]] || return 1
  m="$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)"
  [[ "$m" =~ ^[0-9]+$ ]] && (( $(date +%s) - m <= 600 ))
}

# The host guard's one-line summary (admin wording), when it has written one recently.
hostmem_summary() {
  local f
  f="$(hostmem_state_dir)/memory.json"
  [[ -f "$f" ]] || return 0
  sed -n 's/.*"summary":"\([^"]*\)".*/\1/p' "$f" 2>/dev/null | head -n 1
}

hostmem_gate() {
  local what="${1:-heavy work}" level summary
  [[ "${MAIPAI_MEMORY_GATE:-on}" == off ]] && return 0
  summary="$(hostmem_summary)"
  if hostmem_dev_shed; then
    echo "$what deferred: the host guard paused heavy development work while this Mac is short of memory${summary:+ ($summary)}. It starts again by itself when the pressure clears." >&2
    return 75
  fi
  level="$(hostmem_pressure)"
  if (( level >= 2 )); then
    echo "$what deferred: this Mac is under memory pressure (level $level)${summary:+; $summary}. Try again when it clears; the host guard repairs a leaking file-event service by itself." >&2
    return 75
  fi
  return 0
}
