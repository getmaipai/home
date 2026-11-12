#!/usr/bin/env bash
# SHIP-NOW-01 (owner standing approval, 2026-11-11): the default way a finished change reaches the live hub.
# Jesse: "we make a change and I can rapidly see it on the regular home app; getting to GitHub behind the scenes can take longer, as long as
# it is non-blocking." It is scripts/rush-ship.sh --owner-asked under a standing approval. Since SINGLE-WRITER-01 (2026-11-12) that means:
# the lander's express lane (land.sh --express: rebase on the landed main, typecheck of the changed workspaces, boot check of the exact
# rebased commit, no test suite, the lander pushes main), then ship.sh installs that exact commit (about 4 min). The result is labelled
# "starts and typechecks on top of main", never "tested"; the watcher runs the full tests on main afterwards. The express entry waits for the
# current lander operation and delays other queued work. Run it as a BACKGROUND command from your own worktree, tree clean, branch committed.
# Still ask Jesse first (this script does not decide that): docs/design/RULES.md or a safety/child gate change, credentials, anything that
# costs money. After it ends, run `bash scripts/ship.sh status` and `bash scripts/where.sh`, say where the change is, and later check
# `bash scripts/pipeline.sh status` for "main: red"; a red main is fixed forward at once and reported.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "ship-now: standing owner approval 2026-11-11 (express lane: starts and typechecks on top of main; tests run afterwards on main)"
exec bash scripts/rush-ship.sh --owner-asked
