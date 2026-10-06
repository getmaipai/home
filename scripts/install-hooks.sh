#!/usr/bin/env bash
# Installs the pre-commit hook into the repo's shared hooks dir, so every
# worktree gets it. Idempotent. Honors core.hooksPath if set.
set -euo pipefail
dir=$(git rev-parse --git-path hooks)
case "$dir" in /*) ;; *) dir="$(git rev-parse --show-toplevel)/$dir";; esac
mkdir -p "$dir"
hook="$dir/pre-commit"
marker="# maipai ui-rules"
if [ -f "$hook" ] && grep -q "$marker" "$hook"; then echo "already installed: $hook"; exit 0; fi
[ -f "$hook" ] || printf '#!/usr/bin/env bash\n' > "$hook"
printf '%s\n[ -f scripts/ui-rules-precommit.sh ] && { bash scripts/ui-rules-precommit.sh || exit 1; }\n' "$marker" >> "$hook"
chmod +x "$hook"
echo "installed: $hook"
