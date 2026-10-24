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
fast-forwards from origin first; a worktree leases a free 88xx port from `scripts/wt.sh port` (set `MAIPAI_MAIN_CHECKOUT=1` to take 8787). `bun test` in `backend/` or `frontend/`.
`bun run dev` starts a seeded hot-reload Home for this worktree (`scripts/dev.sh`, see its header); `bun run dev:stop` stops it.
Land with `bash scripts/land.sh` (pushes the branch to the lander's queue; the lander runs the 15 s static check and fast-forwards
`main`; `wt.sh land` hands off to it). `bash scripts/pipeline.sh status | start | stop` shows the queue and the last landings
and runs the lander (`scripts/lander.sh`, one per machine, warm checkout `../home-lander`).
`bash scripts/pin.sh commons <pkg>-vX.Y.Z | stack <sha> | bot <version>` edits every file a pin lives in, reinstalls, commits and lands it.
A landing names the backlog items it finishes (`bash scripts/land.sh --done ITEM-01`) and never edits `docs/BACKLOG.md` checkboxes or generated files by hand; the lander writes both.
Lint: `tsc --noEmit` (backend); `tsc --noEmit && eslint .` (frontend). `bash scripts/check.sh --docs` for docs-only changes,
`--pre` for the cheap preflight, plain `check.sh` for the full gate (it takes the machine-wide lock; never hand-roll a wait).

A `@maipai/*` pin bump, a lockfile conflict or a bundled-manifest change: load [docs/PINNING.md](docs/PINNING.md) first.

**Releases (one releaser).** Ship with `bash scripts/ship.sh [sha] [--before-green] [--tag]` after the owner said yes in that turn. It promotes a landed commit to the live hub through `/usr/local/libexec/maipai-promote`, checks it and rolls back on failure; `--tag` cuts and publishes the next patch tag from what is live. One session owns releases at a time: the StackChan firmware session on the Studio (2026-10-20).
