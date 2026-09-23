#!/usr/bin/env bash
# MaiPai Home pre-commit gate. Checks the @maipai/core, @maipai/ui and
# @maipai/spec pins against getmaipai/commons, runs the backend's checks
# (including the settings registry drift check against commons/spec),
# then the frontend's, then the pinned @maipai/standards core. See
# docs/dev.md. @maipai/spec's own checks (lint, tests, codegen drift)
# run in commons's own check.sh, not here - this repo just pins a tag.
# With --docs it runs only the reading-level lint and the standards core, the gate for a commit that touches only Markdown.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCS_ONLY=0; if [ "${1:-}" = "--docs" ]; then DOCS_ONLY=1; fi
GATE_INSTALL="${GATE_INSTALL:-1}"

stage() { now=$(date +%s); [ -n "${STAGE_T:-}" ] && echo "   (${STAGE_NAME}: $((now-STAGE_T))s)" >&2; STAGE_T=$now; STAGE_NAME="$1"; echo "== $1"; }

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
# UI_PIN sat stale at 0.2.4 through ui-v0.3.0/0.3.1/0.3.2 (HOME-UI-01
# and HOME-UI-02 both adopted a newer kit without ever bumping this
# line or running this gate's own pin check end to end) - found
# cherry-picking a77cbce8, closed here rather than left for the next
# session to hit cold.
if [ "$DOCS_ONLY" = 0 ]; then
  CORE_TAG="core-v0.1.0"
  UI_TAG="ui-v0.5.36"
  SPEC_TAG="spec-v0.1.21"
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

if [ "$DOCS_ONLY" = 0 ] && [ -d backend/src ]; then
  stage "backend: install"
  bun install --silent

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

if [ "$DOCS_ONLY" = 0 ] && [ -d frontend/src ]; then
  stage "frontend: bun test"
  (cd frontend && bun test)

  # The typecheck runs once here (the frontend's `lint` script is
  # "tsc --noEmit && eslint ." and `build` is "tsc --noEmit && vite
  # build", so running both scripts would typecheck three times); the
  # three steps below keep each tool once, with tsc and eslint cached.
  stage "frontend: typecheck"
  (cd frontend && bunx tsc --noEmit)

  stage "frontend: eslint"
  (cd frontend && bunx eslint . --cache --cache-location .eslintcache)

  stage "frontend: build"
  (cd frontend && bunx vite build >/dev/null)

  # Left out while #43 (the chat contrast failure) was open; #43 closed
  # 2026-09-06 and the timestamp finding it left behind was resolved
  # 2026-09-12 (11e8afd) - back in the gate now that it passes clean
  # (getmaipai/home#55). `a11y` is a repo-root script (package.json),
  # not frontend/'s own - it drives scripts/screenshot.ts directly.
  stage "frontend: a11y"
  bun run a11y >/dev/null
fi

stage "docs: reading-level lint"
[ -n "$GATE_INSTALL" ] && [ "$DOCS_ONLY" = 1 ] && bun install --silent
bun run scripts/reading-level.ts

if [ "$(cat "$STANDARDS_DIR/standards/VERSION")" != "${STD_TAG#std-v}" ]; then
  echo "@maipai/standards at $STANDARDS_DIR is $(cat "$STANDARDS_DIR/standards/VERSION"), but the tag is $STD_TAG"
  exit 1
fi

stage "standards core ($STD_TAG)"
bash "$STANDARDS_DIR/standards/bin/check-core.sh" "$(pwd)"

stage "all checks passed"
