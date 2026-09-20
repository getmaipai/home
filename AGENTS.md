# MaiPai Home

The self-hosted family AI hub: the platform and the household's master
(identity, people, memory, the turn engine, settings, the package host,
the credentials center, backups, updates, the shell). Every feature ships
as a catalog package from `getmaipai/catalog`; this repo ships the
default set.

Org standards apply and are auto-loaded from the parent directory
CLAUDE.md (source:
[getmaipai/.github](https://github.com/getmaipai/.github)).

Fresh rebuild on the platform design, started 2026-09-03: see
[docs/dev.md](docs/dev.md) for the design record and
[docs/BACKLOG.md](docs/BACKLOG.md) for what's built and what's missing.
The pre-rebuild hub (244 commits, Bun/Hono, ~250 SQLite tables) is
preserved locally as `legacy-backups/home-legacy.git`, reference only for
hard-won logic, never a requirement of feature scope.

Layout: `backend/` (Bun, Hono, Zod, Drizzle/SQLite), `frontend/` (React,
Vite). The shared record shapes, interpreters, and fixtures live in
`getmaipai/shared`'s `spec/` workspace (`@maipai/spec`, pinned by tag -
see "Pinning" below); `bot` pins the same tag. Full stack standard:
[STACK.md](https://github.com/getmaipai/.github/blob/main/STACK.md) in
`.github`.

**Pinning `getmaipai/shared`:** this repo resolves `@maipai/core`,
`@maipai/ui` and `@maipai/spec` from a sibling `getmaipai/shared`
checkout (`../shared` by default, override with `MAIPAI_SHARED_DIR`),
each pinned to a tag stated in `backend/package.json` /
`frontend/package.json` and checked by `scripts/check.sh`. Bumping a
pin: check out the new tag in the sibling `shared/` checkout, update the
pin in this repo's `package.json` files and in `scripts/check.sh`, then
`bun install --force` in `backend/` and `frontend/` (a plain `bun
install` doesn't refresh a `file:` dependency's snapshot in bun's
content-addressed store).

Commands: from the repo root (the `home/` folder containing `package.json`),
`bun start` builds and starts the local app in the background and prints
its URLs; `bun stop` stops it; `bun restart` calls stop, then start.
See README.md for folder and command examples.
`bun run dev` in `backend/` or `frontend/` runs a local dev
server; `bun test` in `backend/` or `frontend/` for that
package's own tests; `tsc --noEmit` (backend) or `tsc --noEmit && eslint
.` (frontend) to lint. `bash scripts/check.sh` from the repo root is the
full pre-commit gate: it needs a sibling `getmaipai/.github` checkout
(`../.github` by default, override with `MAIPAI_STANDARDS_DIR`, which may be
relative to the repo root) with its
own `gen/ts` and `gen/py` already generated, and a sibling
`getmaipai/shared` checkout at the pinned tags (see "Pinning" above), or
the gate fails with a "missing" error that looks unrelated to what you
changed.
A commit that touches only docs runs `bash scripts/check.sh --docs` instead (the reading-level lint plus the standards core, seconds not minutes).
