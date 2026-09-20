#!/usr/bin/env bash
# MaiPai Home pre-commit gate. Checks the @maipai/core, @maipai/ui and
# @maipai/spec pins against getmaipai/shared, runs the backend's checks
# (including the settings registry drift check against shared/spec),
# then the frontend's, then the pinned @maipai/standards core. See
# docs/dev.md. @maipai/spec's own checks (lint, tests, codegen drift)
# run in shared's own check.sh, not here - this repo just pins a tag.
# With --docs it runs only the reading-level lint and the standards core, the gate for a commit that touches only Markdown.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCS_ONLY=0; if [ "${1:-}" = "--docs" ]; then DOCS_ONLY=1; fi

STANDARDS_DIR="${MAIPAI_STANDARDS_DIR:-../.github}"
STANDARDS_DIR="$(cd "$STANDARDS_DIR" && pwd)"
export MAIPAI_STANDARDS_DIR="$STANDARDS_DIR"

# The @maipai/core and @maipai/ui pins (shared tags core-v0.1.0,
# ui-v0.2.4). Bump a line here and the matching file: dependency in
# backend/package.json or frontend/package.json together, then
# `bun install --force` in that workspace (a plain `bun install` does
# not refresh @maipai/ui's file: dependency snapshot in bun's
# content-addressed store - found live, step 5a, docs/dev.md).
if [ "$DOCS_ONLY" = 0 ]; then
  CORE_PIN="0.1.0"
  UI_PIN="0.2.4"
  SPEC_PIN="0.1.1"
  SHARED_DIR="${MAIPAI_SHARED_DIR:-../shared}"
  if [ ! -d "$SHARED_DIR" ]; then
    echo "getmaipai/shared is missing at $SHARED_DIR (set MAIPAI_SHARED_DIR); backend and frontend import @maipai/core, @maipai/ui and @maipai/spec from its workspaces."
    exit 1
  fi
  SHARED_DIR="$(cd "$SHARED_DIR" && pwd)"
  export MAIPAI_SHARED_DIR="$SHARED_DIR"
  if [ ! -f "$SHARED_DIR/core/package.json" ]; then
    echo "getmaipai/shared is missing at $SHARED_DIR (set MAIPAI_SHARED_DIR); backend imports @maipai/core from its core/ workspace."
    exit 1
  fi
  CORE_VERSION="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$SHARED_DIR/core/package.json")"
  if [ "$CORE_VERSION" != "$CORE_PIN" ]; then
    echo "@maipai/core at $SHARED_DIR/core is version $CORE_VERSION; this repo pins core-v$CORE_PIN. Check out the tag there or move the pin here."
    exit 1
  fi
  if [ ! -f "$SHARED_DIR/ui/package.json" ]; then
    echo "getmaipai/shared is missing at $SHARED_DIR (set MAIPAI_SHARED_DIR); frontend imports @maipai/ui from its ui/ workspace."
    exit 1
  fi
  UI_VERSION="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$SHARED_DIR/ui/package.json")"
  if [ "$UI_VERSION" != "$UI_PIN" ]; then
    echo "@maipai/ui at $SHARED_DIR/ui is version $UI_VERSION; this repo pins ui-v$UI_PIN. Check out the tag there or move the pin here."
    exit 1
  fi
  if [ ! -f "$SHARED_DIR/spec/package.json" ]; then
    echo "getmaipai/shared is missing at $SHARED_DIR (set MAIPAI_SHARED_DIR); backend and frontend import @maipai/spec from its spec/ workspace."
    exit 1
  fi
  SPEC_VERSION="$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$SHARED_DIR/spec/package.json")"
  if [ "$SPEC_VERSION" != "$SPEC_PIN" ]; then
    echo "@maipai/spec at $SHARED_DIR/spec is version $SPEC_VERSION; this repo pins spec-v$SPEC_PIN. Check out the tag there or move the pin here."
    exit 1
  fi
fi

if [ "$DOCS_ONLY" = 0 ] && [ -d backend/src ]; then
  echo "== backend: install"
  bun install --silent

  echo "== backend: settings registry, regenerate and check for drift"
  (cd backend && bun run gen:settings >/dev/null)
  if ! git -C "$SHARED_DIR" diff --quiet -- spec/settings/keys.json; then
    echo "$SHARED_DIR/spec/settings/keys.json is out of date with backend/src/settings/coreKeys.ts. Run 'bun run gen:settings' in backend/ and commit the result in getmaipai/shared."
    git -C "$SHARED_DIR" --no-pager diff --stat -- spec/settings/keys.json
    exit 1
  fi

  echo "== backend: API docs, regenerate and check for drift"
  (cd backend && bun run gen:api-docs >/dev/null)
  if ! git diff --quiet -- docs/api; then
    echo "docs/api/ is out of date with the route registrations in backend/src/app.ts and its route files. Run 'bun run gen:api-docs' in backend/ and commit the result."
    git --no-pager diff --stat -- docs/api
    exit 1
  fi

  echo "== backend: typecheck"
  (cd backend && bunx tsc --noEmit)

  echo "== scripts: typecheck"
  (cd backend && bunx tsc --noEmit -p ../scripts/tsconfig.json)

  echo "== backend: bun test"
  (cd backend && bun test)
fi

if [ "$DOCS_ONLY" = 0 ] && [ -d frontend/src ]; then
  echo "== frontend: bun test"
  (cd frontend && bun test)

  # "lint" is "tsc --noEmit && eslint ." (frontend/package.json), so this
  # also covers the typecheck; build's own script re-runs tsc as part of
  # the real compile, which is fine, it's fast and idempotent.
  echo "== frontend: lint"
  (cd frontend && bun run lint)

  echo "== frontend: build (includes typecheck)"
  (cd frontend && bun run build >/dev/null)

  # Left out while #43 (the chat contrast failure) was open; #43 closed
  # 2026-09-06 and the timestamp finding it left behind was resolved
  # 2026-09-12 (11e8afd) - back in the gate now that it passes clean
  # (getmaipai/home#55). `a11y` is a repo-root script (package.json),
  # not frontend/'s own - it drives scripts/screenshot.ts directly.
  echo "== frontend: a11y"
  bun run a11y >/dev/null
fi

echo "== docs: reading-level lint"
bun install --silent
bun run scripts/reading-level.ts

if [ ! -d "$STANDARDS_DIR/standards" ]; then
  echo "missing @maipai/standards checkout at $STANDARDS_DIR (pin std-v0.2.0)"
  exit 1
fi

echo "== standards core (std-v0.2.0)"
bash "$STANDARDS_DIR/standards/bin/check-core.sh" "$(pwd)"

echo "== all checks passed"
