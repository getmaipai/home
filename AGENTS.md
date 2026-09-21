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
`getmaipai/commons`'s `spec/` workspace (`@maipai/spec`, pinned by tag -
see "Pinning" below); `bot` pins the same tag. Full stack standard:
[STACK.md](https://github.com/getmaipai/.github/blob/main/STACK.md) in
`.github`.

**Pinning `getmaipai/commons`:** this repo resolves `@maipai/core`,
`@maipai/ui` and `@maipai/spec` each from their own immutable per-tag
worktree, not from the sibling `getmaipai/commons` checkout itself -
that checkout is one mutable directory any session on the machine can
`git checkout` a different tag into, and reading it directly let one
session's pin change silently detach every other consumer underneath
it (SHARED-PIN-01, `commons/docs/dev.md`). `scripts/check.sh` calls
`commons`'s own `scripts/ensure-tag.sh <workspace> <tag>` for each pin,
which creates `../commons-tags/<workspace>-<tag>` as a detached worktree
of that tag the first time it's asked for and reuses it after (`../
commons` by default for locating the `commons` repo itself, override
with `MAIPAI_COMMONS_DIR`). Each `package.json` `file:` dependency names
that same worktree path directly (e.g. `file:../../commons-tags/
core-core-v0.1.0/core`). Bumping a pin is therefore two edits: the tag
string in `scripts/check.sh` and the matching `file:` path in
`backend/package.json` or `frontend/package.json`, then run
`scripts/check.sh` (it creates the new tag's worktree if this is the
first consumer to ask for it) followed by `bun install --force` in
`backend/` and `frontend/` (a plain `bun install` doesn't refresh a
`file:` dependency's snapshot in bun's content-addressed store). Never
delete `node_modules` and `bun.lock` to get there: a fresh install floats every dependency
to its latest compatible version, not just the pin you
changed (2026-09-21: one recovery from a `bun.lock` merge conflict silently
moved `@assistant-ui/core` 0.3.17 to 0.3.20 and broke the chat's tests before
it was caught by diffing against a clean `origin/main` worktree). On a
lockfile conflict, take `main`'s `bun.lock` whole, then `bun install --force`;
the diff against a clean `origin/main` worktree before committing is what
proves only your pin moved. The same applies to the main checkout that serves `localhost:8787`:
a pin bump landed on `main` is not on 8787 until `bun install --force`
has run in that checkout's `frontend/` and `backend/`, because `bun
restart` rebuilds with whatever `file:` snapshot the store already
holds (2026-09-21: 8787 served a build with the kit's single-root fix
but the previous tag's palette, because the bump to ui-v0.5.13 was
installed in the session's worktree and never in `main`'s). A done
report's "what you see on reload" line is proven on 8787 itself after
the restart, by a probe or a screenshot taken from that port, never
from a worktree's own build.

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
`getmaipai/commons` checkout present with the pinned tags fetched (see
"Pinning" above - the gate resolves each into its own worktree itself),
or the gate fails with a "missing" error that looks unrelated to what
you changed.
A commit that touches only docs runs `bash scripts/check.sh --docs` instead (the reading-level lint plus the standards core, seconds not minutes).
