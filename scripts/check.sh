#!/usr/bin/env bash
# MaiPai Home pre-commit gate. Runs the spec package's checks, then the
# backend's, then the pinned @maipai/standards core. See docs/dev.md.
set -euo pipefail
cd "$(dirname "$0")/.."

STANDARDS_DIR="${MAIPAI_STANDARDS_DIR:-../.github}"

if [ -d spec/schemas ]; then
  # spec/README.md: "standards/gen/ts/ and standards/gen/py/ (in the
  # sibling .github checkout) need to already be generated before home's
  # codegen runs" - a schema here $ref's a standards schema by bare
  # filename, so gen:ts/gen-py.sh silently produce a broken import if the
  # sibling checkout's own gen/ output is missing or stale, and nothing
  # caught that until now.
  echo "== spec: standards gen/ presence"
  for lang in ts py; do
    dir="$STANDARDS_DIR/standards/gen/$lang"
    if [ ! -d "$dir" ] || [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
      echo "missing or empty $dir - generate the sibling @maipai/standards checkout's own gen/ output first (its own gen:ts / gen-py.sh)."
      exit 1
    fi
  done

  echo "== spec: regenerate and check for drift"
  (cd spec && bun run gen:ts >/dev/null)
  (cd spec && bash scripts/gen-py.sh >/dev/null)
  if ! git diff --quiet -- spec/gen; then
    echo "spec/gen/ is out of date with spec/schemas/. Run the gen scripts and commit the result."
    git --no-pager diff --stat -- spec/gen
    exit 1
  fi

  echo "== spec: typecheck"
  (cd spec && bun install --silent && bunx tsc --noEmit)

  echo "== spec: bun test"
  (cd spec && bun install --silent && bun test)

  echo "== spec: ruff"
  (cd spec && uv run ruff check . && uv run ruff format --check .)

  echo "== spec: pytest"
  (cd spec && uv run pytest tests/py -q)
fi

if [ -d backend/src ]; then
  echo "== backend: install"
  bun install --silent

  echo "== backend: settings registry, regenerate and check for drift"
  (cd backend && bun run gen:settings >/dev/null)
  if ! git diff --quiet -- spec/settings/keys.json; then
    echo "spec/settings/keys.json is out of date with backend/src/settings/coreKeys.ts. Run 'bun run gen:settings' in backend/ and commit the result."
    git --no-pager diff --stat -- spec/settings/keys.json
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

  echo "== backend: bun test"
  (cd backend && bun test)
fi

if [ -d frontend/src ]; then
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

  echo "== docs: reading-level lint"
  bun run scripts/reading-level.ts
fi

if [ ! -d "$STANDARDS_DIR/standards" ]; then
  echo "missing @maipai/standards checkout at $STANDARDS_DIR (pin std-v0.2.0)"
  exit 1
fi

echo "== standards core (std-v0.2.0)"
bash "$STANDARDS_DIR/standards/bin/check-core.sh" "$(pwd)"

echo "== all checks passed"
