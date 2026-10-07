#!/usr/bin/env bash
# Installs the pre-commit hook into the repo's shared hooks dir, so every
# worktree gets it. Idempotent; also repairs the older form of the block.
# Honors core.hooksPath if set. The block never fails a commit in a tree
# that lacks scripts/ui-rules-precommit.sh (it ends with `exit 0`).
set -euo pipefail
dir=$(git rev-parse --git-path hooks)
case "$dir" in /*) ;; *) dir="$(git rev-parse --show-toplevel)/$dir";; esac
mkdir -p "$dir"
hook="$dir/pre-commit"
marker="# maipai ui-rules"
block=$(printf '%s\nif [ -f scripts/ui-rules-precommit.sh ]; then\n  bash scripts/ui-rules-precommit.sh || exit 1\nfi\nexit 0\n' "$marker")
if [ -f "$hook" ] && grep -q "$marker" "$hook"; then
  if [ "$(tail -n 5 "$hook")" = "$block" ]; then echo "already installed: $hook"; exit 0; fi
  # an older form: drop everything from the marker on, then rewrite the block
  tmp=$(mktemp)
  sed "/^$marker\$/,\$d" "$hook" > "$tmp"
  cat "$tmp" > "$hook"; rm -f "$tmp"
fi
[ -f "$hook" ] || printf '#!/usr/bin/env bash\n' > "$hook"
printf '%s\n' "$block" >> "$hook"
chmod +x "$hook"
echo "installed: $hook"
