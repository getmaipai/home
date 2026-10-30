# MaiPai Home

The self-hosted family AI hub: the platform and the household's master (identity, people, memory, the turn engine, settings,
the package host, the credentials center, backups, updates, the shell). Every feature ships as a catalog package from
`getmaipai/catalog`; this repo ships the default set. Org standards load from the parent directory CLAUDE.md.

Fresh rebuild started 2026-09-03: [docs/dev.md](docs/dev.md) is the design record, [docs/BACKLOG.md](docs/BACKLOG.md) is what is built
and missing. The pre-rebuild hub is `legacy-backups/home-legacy.git`: reference for hard-won logic only, never a requirement.

**Hard design rules: read [docs/design/RULES.md](docs/design/RULES.md) before any work on the chat turn, search, the turn stream,
the chat UI, the canvas or the engine launch.** It overrides `docs/dev.md`, `docs/plans/` and any backlog item that says otherwise.
A change that breaks a rule is rejected in review; if the work needs a rule changed, stop and report it: only Jesse changes a rule.
In short: age and surface gates outrank everything; the model decides when to search; the engine's native features are the
implementation; no length cap on adult written chat; a failed tool never fails the answer; shipped parts only; port before delete.

**Kit Elements as they ship (rule 9).** Never put a `className` on a kit Element that changes shape, border, radius, shadow,
background, padding, margin, size or layout, and never write a Home wrapper around an Element. Restyle by tokens and the Element's
own props; if the look is not reachable, add a prop or variant in `commons` first (its own worktree; the pinned tag does not block it,
and only Jesse says yes to a new tag: [docs/PINNING.md](docs/PINNING.md) "Changing a shared kit element"). Full text in `RULES.md`.
`cd frontend && bun run lint:ui-rules` runs the lints in about a second.

## Layout and commands

`backend/` (Bun, Hono, Zod, Drizzle/SQLite), `frontend/` (React, Vite). Shared shapes live in `getmaipai/commons`'s `spec/`
(`@maipai/spec`, pinned by tag). Stack standard: STACK.md in `getmaipai/.github`.

From the repo root: `bun start` / `bun stop` / `bun restart` run the local app: the main checkout serves 8787 and `bun restart` there
fast-forwards from origin first; a worktree leases a free 88xx port from `scripts/wt.sh port` (set `MAIPAI_MAIN_CHECKOUT=1` to take 8787). `bun test` in `backend/` or `frontend/`. `MAIPAI_TEST_NO_PORTS=1 bun test` (set automatically in Codex runs) skips the port-binding probe so tests that start no server run in a sandbox that forbids binding; a test that does start a server fails there by design.
`bun run dev` starts a seeded hot-reload Home for this worktree (`scripts/dev.sh`, see its header); `bun run dev:stop` stops it.
Land with `bash scripts/land.sh` (pushes the branch to the lander's queue; the lander runs the 15 s static check and fast-forwards
`main`; `wt.sh land` hands off to it). `bash scripts/pipeline.sh status | start | stop` shows the queue and the last landings
and runs the lander (`scripts/lander.sh`, one per machine, warm checkout `../home-lander`).
The lander and watcher run from copies of `scripts/lander.sh` and `scripts/watcher.sh` taken from `origin/main` into `data-scratch/pipeline-bin/` and replace themselves between runs, so landing a change to them updates the daemons without touching the main checkout.
Use `bash scripts/pipeline.sh install-service --load` only when Jesse approves enabling the reboot-resilient LaunchAgents; `bash scripts/land.sh --queue-anyway` explicitly queues while the lander is stopped, and safety-surface changes receive backend and frontend sharded tests before landing.
`bash scripts/pin.sh commons <pkg>-vX.Y.Z | stack <sha> | bot <version>` edits every file a pin lives in, reinstalls, commits and lands it.
A landing names the backlog items it finishes (`bash scripts/land.sh --done ITEM-01`) and never edits `docs/BACKLOG.md` checkboxes or generated files by hand; the lander writes both.
Lint: `tsc --noEmit` (backend); `tsc --noEmit && eslint .` (frontend). `bash scripts/check.sh --docs` for docs-only changes,
`--pre` for the cheap preflight, plain `check.sh` for the full gate (it takes the machine-wide lock; never hand-roll a wait).

A `@maipai/*` pin bump, a lockfile conflict or a bundled-manifest change: load [docs/PINNING.md](docs/PINNING.md) first.

The whole delivery path (preview, land, watcher, ship, recovery) is documented in [docs/dev/delivery-pipeline.md](docs/dev/delivery-pipeline.md).

## Previewing a change (Jesse looks, and so do you)

Never hand Jesse a UI change you have not opened yourself. One command gives both of you the same running app, from your worktree:

- **Start:** `bun run dev` (or `bash scripts/dev.sh start`). No build; a frontend edit shows in about a second, a backend edit restarts the hub in one to three seconds. The first start seeds a demo household (Sage the owner, Marlow a teen, Nova a child, tours off) into `data/dev/hub`; `bash scripts/dev.sh reseed` starts it fresh, `--no-stack` skips the engine, `--stack <url>` points at another one. By default it uses the real Stack on `127.0.0.1:8770` when that answers, so chat works, and that Stack is shared with the live hub: keep chat checks short.
- **Where:** `bash scripts/dev.sh url` prints it. Home is `http://localhost:<port + 1000>`, the API `http://127.0.0.1:<port>`, and the port is 8800 plus a number derived from the worktree path (the same every time). Sign in as Sage with the secret `dev.sh start` prints; it belongs to the demo household only.
- **See it yourself:** use the built-in browser tools (`mcp__Claude_Browser__*`): navigate to the Home URL, pick Sage, type the secret, press Return, then `read_page` or `get_page_text` for structure and a screenshot you open and judge. A blank page or "Something went wrong" means read `read_console_messages` first: that is how the Vite pre-bundling crash was found. Check both a desktop and a phone width (`resize_window`) for any layout change.
- **Show Jesse:** start the dev hub, verify it yourself as above, then put the Home URL and what to click in your final message. He opens it on this Mac. Leave it running while he looks and stop it afterwards (`bun run dev:stop`; `bash scripts/dev.sh status` lists what runs). Viewing from another device is not set up (it needs `VITE_ALLOWED_HOSTS` and a non-loopback bind); ask before changing that.
- **Never preview on:** the live hub (`localhost:3000`, the installed app with the family's data), or the main checkout's 8787 (a dev Home there blocked the installer three times). `bun run screenshots` is for generated documentation captures, not for looking at a change.
- **Then land it:** `bash scripts/land.sh`. A change reaches the live hub only through `bash scripts/ship.sh`, and only when Jesse says so in that turn.

**Releases (one releaser).** Ship with `bash scripts/ship.sh [sha] [--before-green] [--tag]` after the owner said yes in that turn. It promotes a landed commit to the live hub through `/usr/local/libexec/maipai-promote`, checks it and rolls back on failure; `--tag` cuts and publishes the next patch tag from what is live. One session owns releases at a time: the StackChan firmware session on the Studio (2026-10-20).

**Before you say the live hub is up, down or healthy, run `bash scripts/ship.sh status`** (one line: is a release deploying, the live tag, whether the hub answers). A ship stops the hub for a few minutes while it installs; that is not an outage to fix, and nothing is restarted or shipped while it runs (2026-10-30: a session reported the hub down without knowing a ship was installing).

`ship.sh` refuses, before it stops or installs anything, when the running Home uses a data directory other than the live install's `data/` and the live install holds less data (2026-10-25: a ship replaced the Home Jesse uses with an empty install). `--dry-run` reports the same finding. Migrate the data first; `--adopt-empty-live` overrides only when Jesse says so.
