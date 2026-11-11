#!/usr/bin/env bash
# SHIP-NOW-01 (owner standing approval, 2026-11-11): the default way a finished change reaches the live hub.
# Jesse: "we make a change and I can rapidly see it on the regular home app; getting to GitHub behind the scenes can take longer, as long as
# it is non-blocking." So: rebase, boot-check the exact commit, push it to main, put it on the live hub (about 4 min), and let the watcher
# run the full tests on main afterwards. Run it as a BACKGROUND command from your own worktree, tree clean, branch committed.
# It is scripts/rush-ship.sh --owner-asked under a standing approval; rush-ship records the skipped lander tests in data-scratch/ship/rush.jsonl.
# Still ask Jesse first (this script does not decide that): docs/design/RULES.md or a safety/child gate change, credentials, anything that
# costs money. After it ends, run `bash scripts/ship.sh status` and `bash scripts/where.sh`, say where the change is, and later check
# `bash scripts/pipeline.sh status` for "main: red"; a red main is fixed forward at once and reported.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "ship-now: standing owner approval 2026-11-11 (boot check runs before the hub is touched; tests run afterwards on main)"
exec bash scripts/rush-ship.sh --owner-asked
