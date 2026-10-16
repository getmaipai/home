#!/usr/bin/env bash
# Keeps MaiPai's log files from growing forever. Run daily by the
# com.maipai.logrotate LaunchDaemon (scripts/install.sh installs it) with
# the install folder as its one argument. A log over LOG_MAX_MB (default
# 20) is copied to <name>.1, older copies shift to .2 and .3, and the
# original is emptied in place. launchd keeps the original file open, so
# it is emptied rather than renamed.
set -euo pipefail

LOG_KEEP=3

rotate_file() {
  local file="$1" max_bytes="$2" size i
  [ -f "$file" ] || return 0
  size=$(wc -c < "$file" | tr -d ' ')
  [ "$size" -gt "$max_bytes" ] || return 0
  rm -f "${file}.${LOG_KEEP}"
  i=$((LOG_KEEP - 1))
  while [ "$i" -ge 1 ]; do
    [ -f "${file}.${i}" ] && mv "${file}.${i}" "${file}.$((i + 1))"
    i=$((i - 1))
  done
  cp "$file" "${file}.1"
  : > "$file"
}

rotate_dir() {
  local dir="$1" max_bytes="$2" f
  [ -d "$dir" ] || return 0
  for f in "$dir"/*.log; do
    [ -e "$f" ] || continue
    rotate_file "$f" "$max_bytes"
  done
}

main() {
  local root="${1:-}" max_mb="${LOG_MAX_MB:-20}" max_bytes
  [ -n "$root" ] || { echo "error: give the MaiPai install folder, for example: bash rotate-logs.sh /usr/local/maipai-home" >&2; exit 1; }
  case "$max_mb" in ''|*[!0-9]*) echo "error: LOG_MAX_MB must be a whole number of megabytes, got '${max_mb}'." >&2; exit 1 ;; esac
  max_bytes=$((max_mb * 1024 * 1024))
  rotate_dir "${MAIPAI_DATA_DIR:-$root/data}/logs" "$max_bytes"
  rotate_dir "$root/stack/data/logs" "$max_bytes"
}

if ! (return 0 2>/dev/null); then
  main "$@"
fi
