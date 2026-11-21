# Commands, previewing and release helpers (full reference)

Moved out of `AGENTS.md` on 2026-11-21 so the always-loaded file stays short. `AGENTS.md` keeps the rule lines; the full wording is here.
The delivery path (preview, land, watcher, ship, recovery) is in [delivery-pipeline.md](delivery-pipeline.md); the job launcher and the dev
checkout lease are in [dev-jobs.md](dev-jobs.md).

## Layout and commands

From the repo root: `bun start` / `bun stop` / `bun restart` run the local app: the main checkout serves 8787 and `bun restart` there
fast-forwards from origin first; a worktree leases a free 88xx port from `scripts/wt.sh port` (set `MAIPAI_MAIN_CHECKOUT=1` to take 8787). `bun test` in `backend/` or `frontend/`. `MAIPAI_TEST_NO_PORTS=1 bun test` (set automatically in Codex runs) skips the port-binding probe so tests that start no server run in a sandbox that forbids binding; a test that does start a server fails there by design.
`bun run dev` starts a seeded hot-reload Home for this worktree (`scripts/dev.sh`, see its header); `bun run dev:stop` stops it.
Land with `bash scripts/land.sh` (pushes the branch to the lander's queue; the lander runs the 15 s static check and fast-forwards
`main`; `wt.sh land` hands off to it). `bash scripts/pipeline.sh status | start | stop` shows the queue and the last landings
and runs the lander (`scripts/lander.sh`, one per machine, warm checkout `../home-lander`).
Never write sleep loops for a landing; use `bash scripts/land.sh wait` or `bash scripts/pipeline.sh wait <SHA|queue-empty|main-green|branch B>` (they block on a FIFO the lander rings; DISK-WAIT-01).
The lander and watcher run from copies of `scripts/lander.sh` and `scripts/watcher.sh` taken from `origin/main` into `data-scratch/pipeline-bin/` and replace themselves between runs, so landing a change to them updates the daemons without touching the main checkout.
Use `bash scripts/pipeline.sh install-service --load` only when Jesse approves enabling the reboot-resilient LaunchAgents; `bash scripts/land.sh --queue-anyway` explicitly queues while the lander is stopped, and safety-surface changes receive backend and frontend sharded tests before landing.
`bash scripts/pin.sh commons <pkg>-vX.Y.Z | stack <sha> | bot <version>` edits every file a pin lives in, reinstalls, commits and lands it.
A landing names the backlog items it finishes (`bash scripts/land.sh --done ITEM-01`) and never edits `docs/BACKLOG.md` checkboxes or generated files by hand; the lander writes both.
Lint: `tsc --noEmit` (backend); `tsc --noEmit && eslint .` (frontend). `bash scripts/check.sh --docs` for docs-only changes,
`--pre` for the cheap preflight, plain `check.sh` for the full gate (it takes the machine-wide lock; never hand-roll a wait).

A `@maipai/*` pin bump, a lockfile conflict or a bundled-manifest change: load [docs/PINNING.md](../PINNING.md) first.

Heavy dev work (tests, builds, temporary servers, video and image jobs) runs through `bash scripts/jobs/job.sh run ...` and `bash scripts/jobs/lease.sh run ...`: process-group cleanup, timeouts that report UNFINISHED, pause on memory pressure, an audit line per action, and a queue among sessions ([docs/dev/dev-jobs.md](dev-jobs.md)).

The whole delivery path (preview, land, watcher, ship, recovery) is documented in [docs/dev/delivery-pipeline.md](delivery-pipeline.md).

## Previewing a change (Jesse looks, and so do you)

Never hand Jesse a UI change you have not opened yourself. One command gives both of you the same running app, from your worktree:

- **Start (one shared workbench is the default, 2026-11-12):** `bun run dev` (or `bash scripts/dev.sh start`) starts the one machine-wide workbench from your worktree: fixed ports (Home 9780, API 8780), its own demo data in `data/dev/workbench` (seeded once; Sage the owner, Marlow a teen, Nova a child, tours off; `bash scripts/dev.sh reseed` resets it), the real Stack when it answers, a checked tailnet-only link, and hot reload (a frontend edit shows in about a second, a backend edit restarts the hub in one to three seconds). If another worktree already runs the workbench, `start` names it and exits: `bash scripts/dev.sh start --takeover` replaces it with yours. A private per-worktree hub (88xx/98xx ports, idle stop after 30 minutes) only with an explicit `bash scripts/dev.sh start --own`; GATED mode has no workbench, so there `start` falls back to a private hub. `bun run dev:stop` stops whatever this worktree runs. `--no-stack` skips the engine, `--stack <url>` points at another one. The default uses the real Stack on `127.0.0.1:8770` when that answers, which the live hub shares: keep chat checks short.
- **Where:** `bash scripts/dev.sh url` prints it (the workbench: Home `http://localhost:9780`, API `http://127.0.0.1:8780`, plus its Tailscale link; with `--own`: Home is `http://localhost:<port + 1000>`, the API `http://127.0.0.1:<port>`, the port 8800 plus a number derived from the worktree path). Sign in as Sage with the secret `dev.sh start` prints; it belongs to the demo household only.
- **See it yourself:** use the built-in browser tools (`mcp__Claude_Browser__*`): navigate to the Home URL, pick Sage, type the secret, press Return, then `read_page` or `get_page_text` for structure and a screenshot you open and judge. A blank page or "Something went wrong" means read `read_console_messages` first: that is how the Vite pre-bundling crash was found. Check both a desktop and a phone width (`resize_window`) for any layout change.
- **Show Jesse:** start the dev hub, verify it yourself as above, then put the Home URL and what to click in your final message. He opens it on this Mac. Leave it running while he looks and stop it afterwards (`bun run dev:stop`; `bash scripts/dev.sh status` lists what runs). Viewing from another device is not set up (it needs `VITE_ALLOWED_HOSTS` and a non-loopback bind); ask before changing that.
- **The dev checkout (DEV-CHECKOUT-01, `docs/dev/dev-jobs.md`):** `dev.sh`, `wt.sh check`, every test shard run and engine jobs from a dev session run through `scripts/jobs/job.sh`, which takes the one dev checkout first: one session holds the dev machine, the others queue first come, first served (Jesse's own work first), and it is returned by itself when the job ends, the session ends, or after 10 idle minutes. A `dev.sh start` while another session holds it refuses and names the holder: start again when it is returned. A hand test is `lease.sh take --manual` (30 min timer). Every hub also has its own process group, a lifetime (24 h, the workbench 30 d) and an audit line; hubs whose worktree pid files are gone, whose watcher is gone, for 60 minutes, are stopped by the orphan reaper and noted on the admin Status row. `MAIPAI_JOBS_OFF=1` starts the servers directly. The workbench skips heavy or outside-world background jobs (`WORKBENCH_SKIPPED_JOBS` in `backend/src/lib/scheduler.ts`); `bun run workbench:status` shows it.

- **Never preview on:** the live hub (`localhost:3000`, the installed app with the family's data), or the main checkout's 8787 (a dev Home there blocked the installer three times). `bun run screenshots` is for generated documentation captures, not for looking at a change.
- **Then land it:** `bash scripts/land.sh`. A change reaches the live hub only through `bash scripts/ship.sh`, and only when Jesse says so in that turn.

## Where a change is, and the live hub's state

**To say where a change is** (worktree only, GitHub `main`, release tag, live hub, and the newer commits the hub lacks), run `bash scripts/where.sh [sha]`.

**Before you say the live hub is up, down or healthy, run `bash scripts/ship.sh status`** (one line: is a release deploying, the live tag, whether the hub answers). A ship stops the hub for a few minutes while it installs; that is not an outage to fix, and nothing is restarted or shipped while it runs (2026-10-30: a session reported the hub down without knowing a ship was installing).

`ship.sh` refuses, before it stops or installs anything, when the running Home uses a data directory other than the live install's `data/` and the live install holds less data (2026-10-25: a ship replaced the Home Jesse uses with an empty install). `--dry-run` reports the same finding. Migrate the data first; `--adopt-empty-live` overrides only when Jesse says so.
