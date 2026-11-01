#!/usr/bin/env bash
# Worktree workflow for this repo (start, tmux, port, check, land, done, reap, tier).
# The logic is one shared script, getmaipai/.github standards/bin/wt.sh; this wrapper
# only says what is specific to this repo and runs it. The shared script is read from
# the sibling .github checkout's origin/main (never its working tree, which may be
# stale or mid-edit); `start` and `land` fetch it first. MAIPAI_WT_SHARED=<file>
# overrides the source.
set -euo pipefail

export WT_INSTALL_DIRS="backend frontend"
# T2 (full gate, review, architect) is the safety and auth surface only (GATE-FAST-01, 2026-10-16):
# everything else, pins and the turn pipeline included, is T1 (preflight plus the tests beside the change).
export WT_T2_GLOBS="docs/design/RULES.md backend/src/auth/* backend/src/credentials* backend/src/consent* backend/src/people/*child* backend/src/people/*teen* backend/src/db/migrations/*"
export WT_TEST_WORKSPACES="backend frontend scripts"
export WT_PIN_REMINDER="a pin changed; run bun install --force in backend and frontend, then bun restart, in the main checkout to make it live."
common="$(git rev-parse --git-common-dir)"
case "$common" in /*) ;; *) common="$(cd "$common" && pwd)" ;; esac
std="$(cd "$common/.." && pwd)/../.github"
# GITNET-01: every git child of the shared script inherits the https low-speed abort from the environment (not the ssh command: that carries
# this repo's deploy key), and the .github fetch below is bounded and retried. Plain git when the helper is absent.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ -f "$here/lib/gitnet.sh" ]]; then source "$here/lib/gitnet.sh"; GITNET_NO_SSH_COMMAND=1 gitnet_env; else gitnet() { git "$@"; }; fi

case "${1:-}" in done) [[ ! -f scripts/dev.sh ]] || bash scripts/dev.sh stop >/dev/null 2>&1 || true;; esac
if [[ -n "${MAIPAI_WT_SHARED:-}" ]]; then shared="$MAIPAI_WT_SHARED"
else
  [[ -d "$std/.git" || -f "$std/.git" ]] || { echo "wt: getmaipai/.github is missing at $std; clone it next to this repo and retry." >&2; exit 1; }
  case "${1:-}" in start|land) GITNET_TRIES=2 GITNET_TIMEOUT=45 gitnet -C "$std" fetch -q origin main 2>/dev/null || echo "wt: could not fetch .github; using its last known origin/main." >&2;; esac
  shared="$(mktemp)"
  trap 'rm -f "$shared"' EXIT
  git -C "$std" show origin/main:standards/bin/wt.sh > "$shared" 2>/dev/null || { echo "wt: .github has no standards/bin/wt.sh on origin/main; fetch it and retry." >&2; exit 1; }
fi
if [[ "${1:-}" != start ]]; then bash "$shared" "$@"; exit $?; fi

# OUTBOX-01: a new worktree starts from the pipeline's main. The shared script branches from origin/main; when the lander has landed
# commits GitHub does not have yet, a fresh worktree (no commits, no edits) is moved forward to the landed main so a new session sees
# everything that already landed. Nothing else about the worktree changes.
out="$(bash "$shared" "$@")" || exit $?
printf '%s\n' "$out"
wt_path="$(printf '%s\n' "$out" | tail -n 1)"
if [[ -d "$wt_path" ]] && declare -F pipeline_main_sha >/dev/null; then
  pm="$(pipeline_main_sha "$wt_path" 2>/dev/null || true)"
  head="$(git -C "$wt_path" rev-parse HEAD 2>/dev/null || true)"
  origin_main="$(git -C "$wt_path" rev-parse --verify -q 'origin/main^{commit}' 2>/dev/null || true)"
  if [[ -n "$pm" && "$pm" != "$head" && "$head" == "$origin_main" ]] && [[ -z "$(git -C "$wt_path" status --porcelain --untracked-files=no 2>/dev/null)" ]] && git -C "$wt_path" merge-base --is-ancestor "$head" "$pm" 2>/dev/null; then
    ahead="$(git -C "$wt_path" rev-list --count "$head..$pm" 2>/dev/null || echo '?')"
    if git -C "$wt_path" merge --ff-only "$pm" >/dev/null 2>&1; then
      echo "wt: GitHub main is $ahead landed commits behind the pipeline's main (the push is still pending); this worktree starts from the landed main ${pm:0:7}." >&2
      if git -C "$wt_path" diff --name-only "$head" "$pm" -- backend/package.json backend/bun.lock frontend/package.json frontend/bun.lock 2>/dev/null | grep -q .; then
        for d in $WT_INSTALL_DIRS; do [[ -d "$wt_path/$d" ]] && { (cd "$wt_path/$d" && bounded_run 600 "bun install $d (new worktree)" bun install --force >/dev/null 2>&1) || echo "wt: bun install --force failed in $d; run it there before working." >&2; }; done
      fi
    else
      echo "wt: could not move this worktree to the landed main ${pm:0:7}; it starts from GitHub main ${head:0:7}. Fetch and rebase before landing." >&2
    fi
  fi
fi
