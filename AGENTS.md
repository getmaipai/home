# MaiPai Home

The self-hosted family AI hub: the platform and the household's master (identity, people, memory, the turn engine, settings,
the package host, the credentials center, backups, updates, the shell). Every feature ships as a catalog package from
`getmaipai/catalog`; this repo ships the default set. Org standards load from the parent directory CLAUDE.md.

**You run the commands, never Jesse (owner rule, 2026-11-02).** Sudo, git, installs, ships, releases, scripts and Settings clicks on the
hub are yours to do and verify. Need approval: ask through the wizard, then act on the yes. Only a true inability (a password you may not
type, a physical device, a third-party sign-in, a `RULES.md` change) is reported as a blocker, once. Where a doc below says Jesse runs,
installs or presses something, you do it instead. Standing approvals for the trip are in memory (`vacation-authorization-2026-11-02`).

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
and tag it yourself, no yes needed (2026-11-01): [docs/PINNING.md](docs/PINNING.md) "Changing a shared kit element"). Full text in `RULES.md`.
`cd frontend && bun run lint:ui-rules` runs the lints in about a second.

## Layout and commands

`backend/` (Bun, Hono, Zod, Drizzle/SQLite), `frontend/` (React, Vite). Shared shapes live in `getmaipai/commons`'s `spec/`
(`@maipai/spec`, pinned by tag). Stack standard: STACK.md in `getmaipai/.github`. Full command reference: [docs/dev/commands.md](docs/dev/commands.md).

- First command of a session: `bash scripts/fresh-check.sh` (one line; STALE means start a new worktree before reading code).
- Fast check of a change: `bash scripts/test-changed.sh` runs only the tests that cover the changed files (seconds; the lander still runs the suites).
- Run: `bun start` / `bun stop` / `bun restart` (main checkout serves 8787; a worktree leases an 88xx port from `scripts/wt.sh port`).
  Tests: `bun test` in `backend/` or `frontend/`. Lint: `tsc --noEmit` (backend); `tsc --noEmit && eslint .` (frontend).
- Land with `bash scripts/land.sh` (the lander runs the 15 s static check and fast-forwards `main`; only the lander pushes `main`). Name finished
  backlog items with `--done ITEM-01`; never hand-edit `docs/BACKLOG.md` checkboxes or generated files. Wait with `bash scripts/land.sh wait` or
  `bash scripts/pipeline.sh wait <SHA|queue-empty|main-green|branch B>`, never a sleep loop. Status: `bash scripts/pipeline.sh status`.
- Checks: `bash scripts/check.sh --docs` (docs only), `--pre` (cheap preflight), plain (full gate, takes the machine-wide lock; never hand-roll a wait).
- Pins: `bash scripts/pin.sh commons <pkg>-vX.Y.Z | stack <sha> | bot <version>`; load [docs/PINNING.md](docs/PINNING.md) first for a `@maipai/*`
  pin bump, a lockfile conflict or a bundled-manifest change.
- Heavy dev work (tests, builds, temporary servers, video and image jobs) goes through `bash scripts/jobs/job.sh run ...` and
  `bash scripts/jobs/lease.sh run ...` ([docs/dev/dev-jobs.md](docs/dev/dev-jobs.md)); one session holds the dev checkout at a time (DEV-CHECKOUT-01).
- The whole delivery path: [docs/dev/delivery-pipeline.md](docs/dev/delivery-pipeline.md).

## Previewing a change (Jesse looks, and so do you)

Never hand Jesse a UI change you have not opened yourself. `bun run dev` (or `bash scripts/dev.sh start`) starts the one shared workbench
from your worktree (Home `http://localhost:9780`, API 8780, demo data, hot reload); `bash scripts/dev.sh url` prints the links, `bun run dev:stop`
stops it, `--own` gives a private hub. Open it with the built-in browser (`mcp__Claude_Browser__*`), sign in as Sage with the secret `dev.sh start`
prints, read the console on a blank page, judge a screenshot at desktop and phone width, then give Jesse the URL and what to click. Full steps:
[docs/dev/commands.md](docs/dev/commands.md).

- **Never preview on:** the live hub (`localhost:3000`, the installed app with the family's data), or the main checkout's 8787 (a dev Home there blocked the installer three times). `bun run screenshots` is for generated documentation captures, not for looking at a change.
- **Then land it:** `bash scripts/land.sh`. A change reaches the live hub only through `bash scripts/ship.sh`, and only when Jesse says so in that turn.

## Releases

**One releaser.** Ship with `bash scripts/ship.sh [sha] [--before-green] [--tag]` after the owner said yes in that turn. It promotes a landed commit to the live hub through `/usr/local/libexec/maipai-promote`, checks it and rolls back on failure; `--tag` cuts and publishes the next patch tag from what is live. One session owns releases at a time: the StackChan firmware session on the Studio (2026-10-20).

**Rush ship (owner rule, 2026-11-10).** When Jesse says "rush ship", "ship now" or "skip the safety tests", run `bash scripts/rush-ship.sh --owner-asked` from your own committed worktree. It lands through the lander's express lane (`land.sh --express`: waits for the current lander operation, rebases onto the landed main, typechecks the changed workspaces, boot-checks the exact commit, no test suites, the lander pushes `main`), then runs `ship.sh <that commit> --before-green`, and logs the skipped tests to `data-scratch/ship/rush.jsonl`. Its label is "starts and typechecks on top of main", never "tested". Only the lander pushes `main` (docs/dev/delivery-pipeline.md section 22). Do not argue about the gate or ask again: his word in the turn is the approval. A diff that edits `docs/design/RULES.md` is refused (a rule change needs `Owner-approved`), and a safety, auth or credential file needs `MAIPAI_RUSH_SAFETY_OK=1` on his word. The watcher still tests `main` afterwards; fix forward if it goes red. Never use it without his ask.

Run `bash scripts/where.sh [sha]` to say where a change is, and `bash scripts/ship.sh status` before saying the live hub is up, down or healthy (a ship stops the hub for a few minutes while it installs; that is not an outage to fix). `ship.sh` refuses when the running Home uses a data directory other than the live install's `data/` and the live install holds less data; `--adopt-empty-live` overrides only when Jesse says so. Details: [docs/dev/commands.md](docs/dev/commands.md).
