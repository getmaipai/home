#!/usr/bin/env bash
# The restore drill (platform plan 2.5): restores the latest local backup
# into a throwaway data directory, boots a real hub against it, and
# confirms its own sign-in picker shows real people - see
# backend/scripts/restore-drill.ts for the real logic and why it stops
# short of a full PIN/password ceremony. The release skill runs this
# before cutting a release; exits non-zero on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== restore drill"
(cd backend && bun run scripts/restore-drill.ts)
