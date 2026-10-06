# MaiPai Home

The self-hosted family AI hub: the platform and the household's master (identity, people, memory, the turn engine, settings,
the package host, the credentials center, backups, updates, the shell). Every feature ships as a catalog package from
`getmaipai/catalog`; this repo ships the default set.

Org standards are auto-loaded from the parent directory CLAUDE.md (source: [getmaipai/.github](https://github.com/getmaipai/.github)).

Fresh rebuild on the platform design, started 2026-09-03: [docs/dev.md](docs/dev.md) is the design record and
[docs/BACKLOG.md](docs/BACKLOG.md) is what is built and missing. The pre-rebuild hub (244 commits, Bun/Hono, ~250 SQLite tables) is preserved locally as
`legacy-backups/home-legacy.git`, reference only for hard-won logic, never a requirement of feature scope.

**Hard design rules (owner's rule, 2026-10-02): read [docs/design/RULES.md](docs/design/RULES.md) before any work on the
chat turn, search, the turn stream, the chat UI, the canvas or the engine launch.** That file is the authority. It overrides
`docs/dev.md`, every file in `docs/plans/` and any backlog item that says otherwise, including ones written before it; an older
record is history, never permission. A change that breaks a rule is rejected in review whatever it cites. If the work needs a rule
to change, stop and report that to the coordinator: only the owner changes a rule. In short, for the chat turn: age and surface gates
outrank everything; the model decides when to search; the engine's native features are the implementation; no length cap on adult
written chat; a failed tool never fails the answer; shipped parts only (the chat screen is assistant-ui Elements from the kit, never hand-written; see rule 9); port before delete; the main navigation is a permanent rail and each app area emulates its native app (App shell, S1 to S3).

**Kit Elements as they ship, everywhere in the frontend (rule 9, owner's rule 2026-10-06).** Never put a `className` on a kit
Element or its parts that changes shape, border, radius, shadow, background, padding, margin, size or layout; restyle by tokens and
the Element's own props and variants (Home CSS likewise never sets size, layout, spacing, border, shadow, background or display on a
kit `data-slot` or `aui-*` part; there it only defines tokens the kit reads), and when the look is not reachable, add an additive prop or
variant in `commons` first. Never
write a Home wrapper around an Element (a component whose root is one, a box or overlay drawn around one, or a `*Panel`/`*Card`/
`*Wrapper` beside one): render the Element where it is used and pass it data, handlers and copy. ELEMENTS-LINT-02 and
ELEMENTS-LINT-03 (`frontend/src/dev/kitElementLints.test.ts`) fail the gate on a new one they can detect (a floor; review catches the rest); their baselines only shrink.

## Layout

`backend/` (Bun, Hono, Zod, Drizzle/SQLite), `frontend/` (React, Vite). Shared record shapes, interpreters and fixtures live in
`getmaipai/commons`'s `spec/` workspace (`@maipai/spec`, pinned by tag; `bot` pins the same tag).
Stack standard: [STACK.md](https://github.com/getmaipai/.github/blob/main/STACK.md).

## Commands

From the repo root (the `home/` folder with `package.json`):

- `bun start` builds and starts the local app in the background and prints its URLs; `bun stop` stops it; `bun restart` stops then starts.
- `bun run dev` in `backend/` or `frontend/` runs a dev server; `bun test` there runs that package's tests.
- Lint: `tsc --noEmit` (backend); `tsc --noEmit && eslint .` (frontend).
- `bash scripts/check.sh` is the full gate; `bash scripts/check.sh --docs` is the seconds-long gate for a docs-only commit.
  Never hand-roll a wait for another gate: run `check.sh`, which takes the machine-wide lock.

## Pins, lockfiles and what is live on 8787

- Bump a `@maipai/*` pin in two places (the tag in `scripts/check.sh`, the `file:` path in `package.json`), then `bun install --force`
  in `backend/` and `frontend/`. Never delete `node_modules` and `bun.lock`. On a lockfile conflict take `main`'s `bun.lock` whole.
- A pin or bundled-manifest change is not live on `localhost:8787` until `bun install --force` and a hub restart have run in the main
  checkout. Prove "what you see on reload" from port 8787 itself, and say in the done report whether the restart happened.
- The gate needs sibling checkouts of `getmaipai/.github` and `getmaipai/commons` (pinned tags fetched); a "missing" error means one is absent.

Load [docs/PINNING.md](docs/PINNING.md) (draft: `home-PINNING.md`) before bumping a pin, resolving a lockfile conflict, changing a bundled manifest, or first running the gate on a machine.
