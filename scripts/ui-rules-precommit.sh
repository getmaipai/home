#!/usr/bin/env bash
# PRECOMMIT-RULES-01: fast, early rejection of Elements/UI rule violations.
# Pure deterministic code: no network, no LLM, writes nothing. Runs only when
# the staged files can matter (frontend/src, the ledger); a backend-only or
# docs-only commit exits at once. Used by the git pre-commit hook
# (scripts/install-hooks.sh) and the maipai plugin's commit hook.
#
# Skip (documented, for a genuine emergency): MAIPAI_SKIP_UI_RULES=1.
# scripts/check.sh never reads it and always runs `bun run lint:ui-rules`,
# so a skipped commit still cannot land.
set -uo pipefail
[ "${MAIPAI_SKIP_UI_RULES:-}" = "1" ] && { echo "ui-rules: skipped by MAIPAI_SKIP_UI_RULES=1 (the gate still runs it)" >&2; exit 0; }
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
[ -f frontend/src/dev/uiRulesGuard.ts ] || exit 0
git diff --cached --name-only --diff-filter=ACMR | grep -qE '^(frontend/src/|docs/design/ELEMENTS-DECISIONS\.md$)' || exit 0
if [ ! -d node_modules ] && [ ! -d frontend/node_modules ]; then
  echo "ui-rules: dependencies are not installed in this worktree; run 'bun install' once (or MAIPAI_SKIP_UI_RULES=1 for this commit; the gate still checks)." >&2
  exit 1
fi
bun frontend/src/dev/uiRulesGuard.ts || exit 1
out=$(cd frontend && bun run lint:ui-rules 2>&1) && exit 0
{
  echo "ui-rules: commit refused (RULES.md rule 9). Offending code and what to do instead:"
  echo "$out" | grep -vE '^\s*(at |bun test|\(pass\)|$)' | grep -E '^\s*(error:|[A-Za-z]+.*(override|wrapper|component|baseline)|[a-z/]+/[A-Za-z./]+:|Use |Render |Look |Home CSS|remove |Expected|Received|-|\+)' | grep -v 'script "lint:ui-rules"' | head -30
  echo "(full output: cd frontend && bun run lint:ui-rules)"
} >&2
exit 1
