#!/usr/bin/env bash
set -euo pipefail
usage() { echo "usage: sudo bash scripts/install-promote.sh [--dry-run]" >&2; }
root="$(id -u)"; [[ "$root" == 0 ]] || { echo "install-promote.sh: run it with sudo." >&2; exit 1; }
[[ -n "${SUDO_USER:-}" ]] || { echo "install-promote.sh: SUDO_USER is missing; run it as a named user with sudo." >&2; exit 1; }
[[ $# -le 1 ]] || { usage; exit 2; }
[[ $# == 0 || "$1" == --dry-run ]] || { usage; exit 2; }
source="$(cd "$(dirname "$0")" && pwd)/maipai-promote"
binary=/usr/local/libexec/maipai-promote
rule=/etc/sudoers.d/maipai-promote
line="${SUDO_USER} ALL=(root) NOPASSWD: ${binary} *"
if [[ "${1:-}" == --dry-run ]]; then printf 'would copy %s to %s (root:wheel, 0755)\nwould write %s (0440): %s\n' "$source" "$binary" "$rule" "$line"; exit 0; fi
install -d -o root -g wheel -m 0755 /usr/local/libexec
install -o root -g wheel -m 0755 "$source" "$binary"
tmp="$(mktemp /etc/sudoers.d/maipai-promote.XXXXXX)" || { echo "install-promote.sh: could not create a sudoers temporary file; check /etc/sudoers.d." >&2; exit 1; }
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$line" > "$tmp"
visudo -cf "$tmp" >/dev/null || { echo "install-promote.sh: visudo rejected the rule; fix it and rerun this setup." >&2; exit 1; }
install -o root -g wheel -m 0440 "$tmp" "$rule"
echo "Installed $binary and $rule for $SUDO_USER."
