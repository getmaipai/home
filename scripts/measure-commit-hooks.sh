#!/usr/bin/env bash
# MEASURE-HOOKS-01 (2026-11-12): time every git step of an integration and every hook that runs around it, each one separately, without
# changing anything: Claude Code's PreToolUse hooks (the maipai plugin's guard, review, gate, architect and UI-rules hooks, the user-level
# reuse check, this repo's guard-shared.sh) fed a `git commit` of a frontend file, then git commit, rebase, fetch, the pre-push hook and a
# dry-run push, all in a throwaway detached commit that is dropped at the end. Hooks are only timed, never added to.
# usage: bash scripts/measure-commit-hooks.sh [<worktree>]   (default: this checkout; never run it in the main checkout)
set -euo pipefail
W="$(cd "${1:-$(git rev-parse --show-toplevel)}" && pwd -P)"
[[ "$(git -C "$W" rev-parse --git-common-dir)" != "$(git -C "$W" rev-parse --git-dir)" ]] || { echo "measure: run it in a worktree, not the main checkout" >&2; exit 2; }
[[ -z "$(git -C "$W" status --porcelain --untracked-files=no)" ]] || { echo "measure: commit or stash nothing first; the tree must be clean" >&2; exit 2; }
plugin="$(ls -d "$HOME"/.claude/plugins/cache/maipai/maipai/*/hooks/scripts 2>/dev/null | sort -V | tail -n 1 || true)"
now() { python3 -c 'import time; print(time.time())'; }
row() { local label="$1" s rc=0; shift; s="$(now)"; "$@" >/dev/null 2>&1 || rc=$?; printf '%-44s %6.2f s  (exit %s)\n' "$label" "$(python3 -c "print($(now) - $s)")" "$rc"; }
hook() { local f="$1"; [[ -f "$f" ]] || { printf '%-44s missing\n' "hook $(basename "$f")"; return; }; row "hook $(basename "$f" .sh)" bash -c 'printf "%s" "$1" | CLAUDE_PROJECT_DIR="$2" bash "$3"' _ "$input" "$W" "$f"; }
file="$(git -C "$W" ls-files 'frontend/src/*.tsx' | head -n 1)"
input="$(jq -n --arg c "git -C $W commit -m measure -- $file" --arg cwd "$W" '{tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}')"
echo "== PreToolUse hooks on a git commit of $file"
for h in guard-main-checkout require-review-before-commit require-gate-before-commit require-architect-verdict run-ui-rules-before-commit; do hook "$plugin/$h.sh"; done
hook "$HOME/.claude/hooks/require-reuse-check.sh"
hook "$W/scripts/hooks/guard-shared.sh"
echo "== git steps (throwaway detached commit)"
branch="$(git -C "$W" symbolic-ref -q --short HEAD || true)"; start="$(git -C "$W" rev-parse HEAD)"
restore() { git -C "$W" checkout -q "${branch:-$start}" 2>/dev/null || true; }
trap restore EXIT
git -C "$W" checkout -q --detach
printf '\n' >>"$W/$file"; git -C "$W" add -- "$file"
row "git commit (git hooks: none)" git -C "$W" commit -q -m measure --no-verify
row "git commit (with any git hooks)" git -C "$W" commit -q --amend -m measure
row "git rebase (1 commit, onto HEAD~3)" git -C "$W" rebase -q --onto HEAD~4 HEAD~1
row "git fetch origin main" git -C "$W" fetch -q origin main
guard="$(sed -n 's/^exec bash \([^ ]*origin-guard.sh\).*/\1/p' "$(git -C "$W" rev-parse --git-common-dir)/hooks/pre-push" 2>/dev/null || true)"
[[ -z "$guard" ]] || row "pre-push hook (origin-guard)" bash "$guard" "$W"
row "git push --dry-run (branch, with pre-push)" git -C "$W" push --dry-run origin "HEAD:refs/heads/wt/measure-dry-run"
