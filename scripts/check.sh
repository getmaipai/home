#!/usr/bin/env bash
# MaiPai Home pre-commit gate. Checks the @maipai/core, @maipai/ui and
# @maipai/spec pins against getmaipai/commons, runs the backend's checks
# (including the settings registry drift check against commons/spec),
# then the frontend's, then the pinned @maipai/standards core. See
# docs/dev.md. @maipai/spec's own checks (lint, tests, codegen drift)
# run in commons's own check.sh, not here - this repo just pins a tag.
#
# GATE-SPEED-02 (a) (2026-09-22): under `full` scope, both suites' cost
# is already unavoidable - no narrower scope applies, unlike the
# backend-only or frontend-only cases, where the other suite's absence
# already does the narrowing GATE-SCOPE-01 exists for. That's the one
# case this runs the backend and frontend suites concurrently in their
# own subshells instead of serially, each leg's output buffered and
# printed whole once it finishes (never interleaved line by line), the
# worse of the two exit codes wins.
#
# Scoped gates (GATE-SCOPE-01, org CLAUDE.md "Verification" > "Scoped
# gates", owner's rule 2026-09-23): the gate decides which stages a
# change can possibly touch from the diff itself, not from a flag or a
# session's own judgment, so a frontend-only commit is never held behind
# the backend suite (or the reverse). --full always runs everything;
# --docs is kept only so an existing "docs commit" habit still works -
# if the diff actually reaches wider than docs, the computed (wider)
# scope runs instead and says so, rather than silently under-checking.
set -euo pipefail
cd "$(dirname "$0")/.."

FULL_FORCED=0
DOCS_REQUESTED=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL_FORCED=1 ;;
    --docs) DOCS_REQUESTED=1 ;;
  esac
done

stage() { now=$(date +%s); [ -n "${STAGE_T:-}" ] && echo "   (${STAGE_NAME}: $((now-STAGE_T))s)" >&2; STAGE_T=$now; STAGE_NAME="$1"; echo "== $1"; }

# --- Scope computation (before anything else can print, so it is
# genuinely the gate's first line) -----------------------------------
#
# The diff is the tracked working tree against the merge base with
# origin/main, not literally "the staged diff": this workflow stages
# and commits in one step, so at the moment check.sh actually runs
# there is usually nothing staged at all, and a staged-only read would
# fall back to "full" on every single run. Comparing the tracked
# working tree (committed + staged + unstaged, never untracked - see
# compute_scope()'s own note below) against the merge base covers
# everything the run's own tests will actually see, and is never
# narrower than "the staged diff" or "main...HEAD" would have been - a
# stale local base only ever widens the scope, never narrows it, so
# origin/main is preferred when it exists but main is a safe fallback
# in a checkout with no remote configured.
gate_diff_base() {
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    git merge-base HEAD origin/main
  elif git rev-parse --verify main >/dev/null 2>&1; then
    git merge-base HEAD main
  else
    echo ""
  fi
}

# The actual path-classification logic (which bucket each changed path
# falls into, the crosses-packages and frontend-imports-backend rules)
# lives in scripts/gateScope.ts, unit tested there with bun:test - bash
# string matching over dozens of path shapes is exactly the kind of
# thing that silently drifts wrong with no test suite proving it, and
# this script only ever proves "did it exit 0 today". check.sh's own
# job is just gathering the two file lists gateScope.ts needs (git is
# naturally a shell job) and reading its two-line result without ever
# eval-ing anything a file path could inject into.
SCOPE=""
SCOPE_WHY=""

compute_scope() {
  local base files=() f
  base="$(gate_diff_base)"

  # Tracked, changed files first - an untracked file never WIDENS this
  # (found live: another session's own stray output sitting in this
  # shared working tree, backend/scripts/bench/query-rewrite.ts,
  # widened a --docs run to backend and cost it the full four-minute
  # suite - only tracked files decide the scope when any exist). This
  # also means --docs is honoured whenever every tracked, changed file
  # is a doc, exactly as the flag's own caller intends - no separate
  # code path needed for that; it falls out of using tracked files
  # alone whenever the tracked set is non-empty.
  #
  # But an untracked file is exactly how a brand-new file looks before
  # its first `git add` - the ordinary, common case of creating a file
  # and running check.sh before staging anything at all (this comment
  # block's own sibling above: "at the moment check.sh actually runs
  # there is usually nothing staged"). If NO tracked file changed at
  # all, there is no "another session's stray file" ambiguity to
  # protect against - untracked files are the only signal of what this
  # run is actually for, so they're included then (a review caught an
  # earlier version of this fix dropping them unconditionally, which
  # would have forced `full` on every single new-file-only change,
  # exactly the cost this whole item exists to eliminate).
  #
  # Residual, accepted gap (a second review round, empirically checked
  # rather than reopened a third time): a tracked change in one area
  # plus a brand-new untracked file in a DIFFERENT, unscoped area, both
  # meant for the same not-yet-staged commit, scopes to only the
  # tracked area - the untracked one is silently dropped here, same as
  # the "another session's stray file" case, since this function can't
  # tell the two apart. This is safe, not just tolerated: it can never
  # let an under-scoped commit actually land, because require-gate-
  # before-commit.sh (GATE-HOOK-01, getmaipai/.github) recomputes the
  # required scope from the real staged diff at commit time, not from
  # this run's own guess - confirmed live, staging both files and
  # attempting the commit denies with "needs 'frontend'" against a
  # stale 'docs' stamp, every time. What this function computes is a
  # fast, best-effort convenience for the common case, never the actual
  # safety boundary; a session that hits this gap sees an honest commit
  # denial naming the real scope needed, not a silent gap in what
  # shipped.
  if [ -n "$base" ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done \
      < <(git diff -z --name-only --no-renames "$base" -- .)
  fi
  if [ "${#files[@]}" -eq 0 ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done \
      < <(git ls-files -z --others --exclude-standard)
  fi

  local changed_file imported_file
  changed_file="$(mktemp)"
  imported_file="$(mktemp)"
  # An EXIT trap, not RETURN: `set -e` aborting the whole script from a
  # failing command inside this function (bun missing, gateScope.ts
  # throwing) skips straight past a RETURN trap without firing it -
  # confirmed live on this machine's own bash. The paths are expanded
  # now, with double quotes, into the trap's own command string, since
  # $changed_file/$imported_file are this function's locals and won't
  # exist by the time a later EXIT actually fires.
  trap "rm -f '$changed_file' '$imported_file'" EXIT
  # "${files[@]}" on a genuinely empty array throws "unbound variable"
  # under set -u on this machine's own bash (3.2.57 - macOS never
  # shipped past the last GPLv2 release, and 3.2's array expansion
  # predates bash 4.4's fix for exactly this) - a clean tree with
  # nothing to scope is a real, common case (re-running the gate to
  # verify a just-pushed state), not an edge case to let crash the
  # whole run before gateScope.ts ever gets to say "full, nothing to
  # scope" itself.
  if [ "${#files[@]}" -gt 0 ]; then
    printf '%s\n' "${files[@]}" > "$changed_file"
  else
    : > "$changed_file"
  fi
  # The @maipai/home-backend/src/... paths frontend/ imports directly
  # (types and runtime alike) - found live at gate time with this git
  # grep, not a hand-kept list that can silently go stale as new
  # imports are added; classifyScope() (scripts/gateScope.ts) compares
  # a changed backend/ path's own extension-stripped form against this
  # list to decide the direct-import full-gate escalation. `git grep`
  # exits 1 (not an error) when it finds nothing - real in any repo (or
  # this repo, someday) whose frontend/ doesn't import backend code at
  # all, and under this function's own `set -o pipefail` that would
  # otherwise kill the whole gate run via the pipeline's own exit
  # status (getmaipai/home#144 - dormant on the real frontend/, which
  # always has a real match today, but scripts/checkScope.test.ts's
  # own minimal fixture repo hit it immediately, so it's fixed here
  # rather than left filed).
  { git grep -hoE '@maipai/home-backend/src/[A-Za-z0-9_./-]+' -- frontend/ 2>/dev/null || true; } \
    | sed 's#@maipai/home-backend/#backend/#' \
    | sort -u > "$imported_file"

  { IFS= read -r SCOPE; IFS= read -r SCOPE_WHY; } < <(bun scripts/gateScope.ts "$changed_file" "$imported_file")
}

if [ "$FULL_FORCED" = 1 ]; then
  SCOPE=full
  SCOPE_WHY="--full requested"
else
  compute_scope
  if [ "$DOCS_REQUESTED" = 1 ] && [ "$SCOPE" != "docs" ]; then
    echo "== scope: $SCOPE ($SCOPE_WHY) - wider than the --docs requested, running $SCOPE instead of narrowing to it"
  fi
fi
echo "== scope: $SCOPE ($SCOPE_WHY)"

STANDARDS_REPO="${MAIPAI_STANDARDS_DIR:-../.github}"
STD_TAG="std-v0.3.0"
if [ ! -x "$STANDARDS_REPO/standards/bin/ensure-tag.sh" ]; then
  echo "getmaipai/.github is missing at $STANDARDS_REPO or older than std-v0.3.0 (set MAIPAI_STANDARDS_DIR to a checkout that has standards/bin/ensure-tag.sh)"
  exit 1
fi
STANDARDS_DIR="$(bash "$STANDARDS_REPO/standards/bin/ensure-tag.sh" "$STD_TAG")"
export MAIPAI_STANDARDS_DIR="$STANDARDS_DIR"

# The @maipai/core, @maipai/ui and @maipai/spec pins, each a full commons
# tag name (not a bare version - core-v0.1.0, ui-v0.3.3, spec-v0.1.1).
# Each resolves to its own immutable per-tag worktree via getmaipai/
# commons's scripts/ensure-tag.sh (SHARED-PIN-01, 2026-09-20) instead of
# reading whatever the commons/ checkout itself happens to have checked
# out - that checkout is one mutable directory shared by every session
# on the machine, and reading it directly let one session's `git
# checkout` there silently detach every other consumer's install
# underneath it (found live: a session gating Home at ui-v0.2.4 did
# exactly this). Bumping a pin is now two edits - the tag string here,
# and the matching file: dependency in backend/package.json or
# frontend/package.json (it names the same tag in its own path) - then
# `bun install --force` in that workspace (a plain `bun install` does
# not refresh a file: dependency's snapshot in bun's content-addressed
# store - found live, step 5a, docs/dev.md).
#
# Needed whenever the scope isn't docs-only: both workspaces' own
# package.json reference these pins by path, so bun install fails
# without them resolved first, regardless of which scope's tests run.
if [ "$SCOPE" != "docs" ]; then
  CORE_TAG="core-v0.1.0"
  UI_TAG="ui-v0.5.54"
  SPEC_TAG="spec-v0.1.34"
  SHARED_REPO="${MAIPAI_COMMONS_DIR:-../commons}"
  if [ ! -d "$SHARED_REPO" ]; then
    echo "getmaipai/commons is missing at $SHARED_REPO (set MAIPAI_COMMONS_DIR); backend and frontend import @maipai/core, @maipai/ui and @maipai/spec from its workspaces."
    exit 1
  fi
  SHARED_REPO="$(cd "$SHARED_REPO" && pwd)"

  # Resolves one workspace's pin to its tag worktree (creating it via
  # ensure-tag.sh if no consumer has asked for that tag yet, reusing it
  # otherwise) and checks the worktree's own package.json version
  # against the tag name, the same honesty-of-the-pin contract the
  # standards core already uses - this only ever fires if a tag itself
  # were cut against the wrong commit, since ensure-tag.sh has already
  # confirmed the tag exists and the worktree is really checked out
  # there. Prints the worktree path on stdout.
  ensure_pin() {
    local workspace="$1"
    local tag="$2"
    local expected_version="${tag#"$workspace"-v}"
    local dir
    dir="$(bash "$SHARED_REPO/scripts/ensure-tag.sh" "$workspace" "$tag")"
    if [ ! -f "$dir/$workspace/package.json" ]; then
      echo "$tag's worktree at $dir has no $workspace/package.json - check the workspace name." >&2
      exit 1
    fi
    local actual_version
    actual_version="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$dir/$workspace/package.json")"
    if [ "$actual_version" != "$expected_version" ]; then
      echo "@maipai/$workspace at $dir/$workspace is version $actual_version, but its own tag is $tag - the tag was cut against the wrong commit in getmaipai/commons." >&2
      exit 1
    fi
    echo "$dir"
  }

  CORE_DIR="$(ensure_pin core "$CORE_TAG")"
  UI_DIR="$(ensure_pin ui "$UI_TAG")"
  SPEC_DIR="$(ensure_pin spec "$SPEC_TAG")"
fi

# One root-level install covers both workspaces (bun's own workspace
# resolution) - needed once for whichever scope actually runs code.
if [ "$SCOPE" != "docs" ]; then
  stage "install"
  bun install --silent
fi

# stage_end() closes out whichever stage a leg's own subshell last
# opened: each leg below runs in its own process, so it gets its own
# STAGE_T/STAGE_NAME instead of racing the other leg's, but nothing
# after a leg's last real stage ever calls stage() again in that same
# subshell to print that stage's own elapsed time - printed here
# explicitly instead, since the per-stage numbers are what this item's
# own measurement reads.
stage_end() { local now; now=$(date +%s); [ -n "${STAGE_T:-}" ] && echo "   (${STAGE_NAME}: $((now-STAGE_T))s)" >&2; }

run_backend_suite() {
  stage "backend: settings registry, regenerate and check for drift"
  # $SPEC_DIR is a per-tag worktree shared by every consumer pinning
  # spec-v0.1.2 (home, bot, and any other session's check.sh run) - a
  # review on this same item caught an earlier version of this step
  # writing gen:settings' own output straight into it, silently
  # reintroducing SHARED-PIN-01 inside its own fix. Generated into a
  # private scratch directory instead and compared there, never
  # touching the worktree's working tree at all.
  SETTINGS_SCRATCH="$(mktemp -d)"
  mkdir -p "$SETTINGS_SCRATCH/spec/settings"
  git -C "$SPEC_DIR" show HEAD:spec/settings/keys.json > "$SETTINGS_SCRATCH/spec/settings/keys.json"
  (cd backend && MAIPAI_COMMONS_DIR="$SETTINGS_SCRATCH" bun run gen:settings >/dev/null)
  if ! diff -q "$SETTINGS_SCRATCH/spec/settings/keys.json" <(git -C "$SPEC_DIR" show HEAD:spec/settings/keys.json) >/dev/null; then
    echo "backend/src/settings/coreKeys.ts no longer matches spec/settings/keys.json as pinned at $SPEC_TAG. Run 'bun run gen:settings' in backend/ (with MAIPAI_COMMONS_DIR pointed at a scratch copy, not $SPEC_DIR - that worktree is shared and read-only), then fix and re-tag spec/settings/keys.json in getmaipai/commons's own main checkout and bump the pin here."
    diff -u <(git -C "$SPEC_DIR" show HEAD:spec/settings/keys.json) "$SETTINGS_SCRATCH/spec/settings/keys.json" || true
    rm -rf "$SETTINGS_SCRATCH"
    exit 1
  fi
  rm -rf "$SETTINGS_SCRATCH"

  stage "backend: API docs, regenerate and check for drift"
  (cd backend && bun run gen:api-docs >/dev/null)
  if ! git diff --quiet -- docs/api; then
    echo "docs/api/ is out of date with the route registrations in backend/src/app.ts and its route files. Run 'bun run gen:api-docs' in backend/ and commit the result."
    git --no-pager diff --stat -- docs/api
    exit 1
  fi

  stage "backend: typecheck"
  (cd backend && bunx tsc --noEmit)

  stage "backend: rule-budget lint (U0b, docs/plans/simple-turn-pipeline-2026-09-22.md)"
  (cd backend && bun run scripts/lint/rule-budget.ts)

  stage "scripts: typecheck"
  (cd backend && bunx tsc --noEmit -p ../scripts/tsconfig.json)

  stage "scripts: bun test"
  (cd scripts && bun test)

  stage "backend: bun test"
  (cd backend && bun test)
}

if [ "$SCOPE" = "full" ] && [ -d backend/src ] && [ -d frontend/src ]; then
  # `bun install` above stays the one serial step before either leg
  # starts - it writes into the one shared node_modules both workspaces
  # resolve from, so two concurrent installs would race the same files.
  BACKEND_LOG="$(mktemp)"
  FRONTEND_LOG="$(mktemp)"

  ( run_backend_suite; stage_end ) > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  ( stage "frontend: typecheck"
    (cd frontend && bunx tsc --noEmit)

    stage "frontend: bun test"
    (cd frontend && bun test)

    stage "frontend: eslint"
    (cd frontend && bunx eslint . --cache --cache-location .eslintcache)

    stage "frontend: build"
    (cd frontend && bunx vite build >/dev/null)

    stage "frontend: a11y"
    bun run a11y >/dev/null
    stage_end
  ) > "$FRONTEND_LOG" 2>&1 &
  FRONTEND_PID=$!

  BACKEND_RC=0
  wait "$BACKEND_PID" || BACKEND_RC=$?
  FRONTEND_RC=0
  wait "$FRONTEND_PID" || FRONTEND_RC=$?

  echo "== backend leg =="
  cat "$BACKEND_LOG"
  echo "== frontend leg =="
  cat "$FRONTEND_LOG"
  rm -f "$BACKEND_LOG" "$FRONTEND_LOG"

  # stage()'s own STAGE_T/STAGE_NAME were last set for "install" in this
  # (parent) process, right before both legs forked - every stage() call
  # since then happened inside a subshell, whose STAGE_T/STAGE_NAME never
  # propagate back here. Left alone, the next stage() call in this
  # process (docs: reading-level lint) would print the whole concurrent
  # block's wall time mislabeled as "(install: Ns)" - reproduced live
  # during this item's own measurement. Print the real number under its
  # own name instead, then clear STAGE_T so the next stage() call starts
  # a fresh clock silently rather than also printing a second, redundant
  # "(both legs: 0s)" line for the same reset point.
  now=$(date +%s)
  echo "   (both legs: $((now-STAGE_T))s)" >&2
  unset STAGE_T STAGE_NAME

  if [ "$BACKEND_RC" -ne 0 ] || [ "$FRONTEND_RC" -ne 0 ]; then
    WORSE_RC=$BACKEND_RC
    [ "$FRONTEND_RC" -gt "$WORSE_RC" ] && WORSE_RC=$FRONTEND_RC
    exit "$WORSE_RC"
  fi
else
  if { [ "$SCOPE" = "backend" ] || [ "$SCOPE" = "full" ]; } && [ -d backend/src ]; then
    run_backend_suite
  fi

  if { [ "$SCOPE" = "frontend" ] || [ "$SCOPE" = "backend" ] || [ "$SCOPE" = "full" ]; } && [ -d frontend/src ]; then
    # Runs under backend scope too: the frontend imports typed backend
    # code (currently wire.ts and homeCardQuestions.ts - see the git grep
    # for @maipai/home-backend/src/... in compute_scope() above, which
    # feeds classifyScope() in scripts/gateScope.ts), so a backend-only
    # change can still break the frontend's own type surface even when it
    # doesn't touch one of those files directly enough to force a full
    # gate on its own. Cheap with tsc's incremental cache.
    stage "frontend: typecheck"
    (cd frontend && bunx tsc --noEmit)
  fi

  if { [ "$SCOPE" = "frontend" ] || [ "$SCOPE" = "full" ]; } && [ -d frontend/src ]; then
    stage "frontend: bun test"
    (cd frontend && bun test)

    stage "frontend: eslint"
    (cd frontend && bunx eslint . --cache --cache-location .eslintcache)

    stage "frontend: build"
    (cd frontend && bunx vite build >/dev/null)

    # Left out while #43 (the chat contrast failure) was open; #43 closed
    # 2026-09-06 and the timestamp finding it left behind was resolved
    # 2026-09-12 (11e8afd) - back in the gate now that it passes clean
    # (getmaipai/home#55). `a11y` is a repo-root script (package.json),
    # not frontend/'s own - it drives scripts/screenshot.ts directly. It
    # only checks frontend/ - the pages it captures, their accessibility
    # tree and overflow - and never runs the backend's own test suite, so
    # it stays in frontend scope rather than forcing a full gate: it is
    # not the stage GATE-SCOPE-01 exists to route around (that is the
    # backend suite's own stub-engine flakiness and runtime).
    stage "frontend: a11y"
    bun run a11y >/dev/null
  fi
fi

stage "docs: reading-level lint"
[ -n "${GATE_INSTALL:-1}" ] && [ "$SCOPE" = "docs" ] && bun install --silent
bun run scripts/reading-level.ts

if [ "$(cat "$STANDARDS_DIR/standards/VERSION")" != "${STD_TAG#std-v}" ]; then
  echo "@maipai/standards at $STANDARDS_DIR is $(cat "$STANDARDS_DIR/standards/VERSION"), but the tag is $STD_TAG"
  exit 1
fi

# Runs in every scope, no exceptions (the secrets scan and PII
# wordlist are never skippable, per the scoped-gates rule).
stage "standards core ($STD_TAG)"
bash "$STANDARDS_DIR/standards/bin/check-core.sh" "$(pwd)"

stage "all checks passed (scope: $SCOPE)"
