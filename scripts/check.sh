#!/usr/bin/env bash
# MaiPai Home pre-commit gate. Runs the spec package's checks, then the
# backend's, then the pinned @maipai/standards core. See docs/dev.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d spec/schemas ]; then
  echo "== spec: regenerate and check for drift"
  (cd spec && bun run gen:ts >/dev/null)
  (cd spec && bash scripts/gen-py.sh >/dev/null)
  if ! git diff --quiet -- spec/gen; then
    echo "spec/gen/ is out of date with spec/schemas/. Run the gen scripts and commit the result."
    git --no-pager diff --stat -- spec/gen
    exit 1
  fi

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

  echo "== backend: typecheck"
  (cd backend && bunx tsc --noEmit)

  echo "== backend: bun test"
  (cd backend && bun test)
fi

STANDARDS_DIR="${MAIPAI_STANDARDS_DIR:-../.github}"
if [ ! -d "$STANDARDS_DIR/standards" ]; then
  echo "missing @maipai/standards checkout at $STANDARDS_DIR (pin std-v0.2.0)"
  exit 1
fi

echo "== standards core (std-v0.2.0)"
bash "$STANDARDS_DIR/standards/bin/check-core.sh" "$(pwd)"

echo "== all checks passed"
