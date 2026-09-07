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
Vite), `spec/` (the shared record shapes, interpreters, and fixtures that
`bot` also pins as `maipai-spec`). Full stack standard:
[STACK.md](https://github.com/getmaipai/.github/blob/main/STACK.md) in
`.github`.

Commands: `bun run dev` in `backend/` or `frontend/` for a local dev
server; `bun test` in `backend/`, `frontend/`, or `spec/` for that
package's own tests; `tsc --noEmit` (backend) or `tsc --noEmit && eslint
.` (frontend) to lint. `bash scripts/check.sh` from the repo root is the
full pre-commit gate: it needs a sibling `getmaipai/.github` checkout
(`../.github` by default, override with `MAIPAI_STANDARDS_DIR`) with its
own `gen/ts` and `gen/py` already generated, or the spec step fails with
a "missing or empty" error that looks unrelated to what you changed.
