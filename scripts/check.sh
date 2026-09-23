#!/usr/bin/env bash
# MaiPai Home pre-commit gate. Checks the @maipai/core, @maipai/ui and
# @maipai/spec pins against getmaipai/commons, runs the backend's checks
# (including the settings registry drift check against commons/spec),
# then the frontend's, then the pinned @maipai/standards core. See
# docs/dev.md. @maipai/spec's own checks (lint, tests, codegen drift)
# run in commons's own check.sh, not here - this repo just pins a tag.
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
# The diff is the working tree against the merge base with
# origin/main, not literally "the staged diff": this workflow stages
# and commits in one step, so at the moment check.sh actually runs
# there is usually nothing staged at all, and a staged-only read would
# fall back to "full" on every single run. Comparing the working tree
# (committed + staged + unstaged + untracked) against the merge base
# covers everything the run's own tests will actually see, and is
# never narrower than "the staged diff" or "main...HEAD" would have
# been - a stale local base only ever widens the scope, never narrows
# it, so origin/main is preferred when it exists but main is a safe
# fallback in a checkout with no remote configured.
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

  if [ -n "$base" ]; then
    while IFS= read -r -d '' f; do files+=("$f"); done \
      < <(git diff -z --name-only --no-renames "$base" -- .)
  fi
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(git ls-files -z --others --exclude-standard)

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
  # list to decide the direct-import full-gate escalation.
  git grep -hoE '@maipai/home-backend/src/[A-Za-z0-9_./-]+' -- frontend/ 2>/dev/null \
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
  UI_TAG="ui-v0.5.48"
  SPEC_TAG="spec-v0.1.29"
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

if { [ "$SCOPE" = "backend" ] || [ "$SCOPE" = "full" ]; } && [ -d backend/src ]; then
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
