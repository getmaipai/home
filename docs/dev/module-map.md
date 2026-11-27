# Module map

Hand-written; names, not line numbers. Read this first, then open the file. For one screen or package page use the generated
[code-map.md](code-map.md). Recipes ("where do I change X"): [recipes.md](recipes.md). Scripts: [process.md](process.md).
Rules that override everything: [../design/RULES.md](../design/RULES.md).

## Repo shape
- `backend/` Bun, Hono, Zod, Drizzle on SQLite. `frontend/` React and Vite. `scripts/` the delivery tools. `docs/` design records, dev notes, user docs.
- Shared shapes and the settings registry come from `getmaipai/commons` (`@maipai/spec`, `@maipai/core`, `@maipai/ui`), pinned by tag in `package.json`. Never copy them here.
- Tests sit beside the code (`*.test.ts`) and in `backend/tests/` and `frontend/src/tests/`. Fixtures: `backend/tests/fixtures/`, helpers `backend/tests/support/`.

## Backend (`backend/src`)
| Area | Where |
|---|---|
| App wiring, every route mounted | `app.ts` (`app.route("/api/...", x)`), start in `index.ts`, wire types `wire.ts` |
| HTTP routes, one file per area | `routes/` (`turn.ts` chat turn, `conversations.ts`, `settings.ts`, `setup.ts`, `apps.ts`, `backups.ts`, `devices.ts`, `companions.ts`) |
| Chat turn engine | `lib/turnMachine/` (`machine.ts`, `turnNext.ts`, `nodes/`, `toolGates.ts`, `research*.ts`, `speaker.ts`); turn helpers `lib/turn*.ts` |
| Age, audience and surface gates | `lib/gate/decide.ts`, `lib/ageBand.ts`, `lib/audience.ts`, `lib/adultLock*.ts`, `lib/contentPolicy/` |
| Content filter, ratings | `lib/filter/` (`door.ts`, `pass.ts`, `textGate.ts`) |
| Memory | `lib/memory*.ts`, `lib/retrieval/` |
| Search | `lib/search/`, `lib/searchAssist/`, `lib/searchEngines.ts`, `lib/webSearchBudget.ts` |
| Engine and Stack link (Home's only caller of Stack) | `lib/stack/` (`client.ts`, `link.ts`), `lib/engine*.ts`, `lib/stack*.ts`, `lib/chatLease*.ts` |
| Tier leases (Boost, Max) | `lib/tierLease/policy.ts`, `routes/aiTiers.ts`, `routes/codeGateway.ts` |
| Coding mode | `routes/codingSessions.ts`, `lib/codingTurns.ts`, `lib/stackCoding*.ts` |
| Media: pictures, video, music, films | `lib/pictures/`, `lib/videos/`, `lib/films/`, `lib/music/`, `lib/media/`, `lib/imaging/` |
| Settings keys (declared here, registry generated from spec) | `settings/*Keys.ts`; `bun run gen:settings` in `backend/` |
| Database | `db/schema.ts`, `db/migrations/NNNN_*.sql`, `db/migrate.ts` (`bun run db:generate` makes a migration) |
| Package host (every feature is a package) | `lib/apps.ts`, `lib/package*.ts`; packages in `backend/packages/<id>/` (`manifest.json`, `handler.ts`, `pages/*.json`) |
| Auth and credentials | `routes/auth.ts`, `routes/authSessions.ts`, `lib/session.ts`, `lib/apiKeys.ts`, `middleware/auth.ts` |
| Background jobs, scheduler | `lib/jobs/`, `lib/schedules/`, `lib/backgroundWork.ts` |
| Backups, updates, install | `routes/backups.ts`, `lib/backup*.ts`, `lib/stackUpdates.ts`, `setup/` |

## Frontend (`frontend/src`)
- `main.tsx`, `App.tsx` boot and routes; `shell/` the app frame (rail, dock, alarms, mini player, ambient companion).
- `apps/<name>/` one folder per app: `chat`, `settings`, `home`, `library`, `memory`, `people`, `reminders`, `clock`, `code`, `notifications`, `privacy`, `setup`.
- Settings, Stack (STACK-MENU-SYNC-01): the spec section `stack` in `areas.json` is drawn by `shell/pages/settings/SettingsAreaPage.tsx`; its views are registered in `shell/pages/settings/settingsViews.tsx` (`stack.general`, `home.engine_admin` for Models, `stack.monitor`, `stack.maintain`) and live in `apps/settings/stack/` (`StackGeneral`, `StackDown` (the shared Stack-down card and `withStackDown`), `StackTabs`, `StackScreenStubs`, `stackScreens.ts` which reads `spec/stack/screens.json`). Models and Styles keep `AiModelsPage` and `StylesTab`. `StackAdminLink.tsx` is the one Open Stack admin button. Old `/settings/ai` and `/settings/media?tab=styles` addresses redirect through `movedSettingsTarget` in `settingsRedirects.ts`. Backend: `routes/aiStack.ts` `GET /api/ai/stack/general` over `lib/stackGeneral.ts`.
- `lib/` API clients and helpers (`api.ts`, `assistantTurnStream.ts`); `kit/` Home's kit hooks (shared Elements come from `@maipai/ui`, never forked).
- `i18n.ts` and `locales/` (en-US source, en-GB, es); `dev/` lint tests for UI rules (`bun run lint:ui-rules`).

## Scripts and delivery (`scripts/`)
Land `land.sh` (queue), `lander.sh` and `watcher.sh` (daemons), `pipeline.sh` (status, wait), worktrees `wt.sh`, gate `check.sh` with `gate/`,
preview `dev.sh`, live hub `ship.sh` (only on Jesse's word), pins `pin.sh`. Full sheet: [process.md](process.md). Each script's purpose: [../../scripts/INDEX.md](../../scripts/INDEX.md).

## Invariants (one line each, full text in RULES.md)
- Age and surface gates outrank everything; the model decides when to search; no length cap on adult written chat.
- A failed tool never fails the answer; shipped parts only; port before delete.
- Kit Elements ship as they are: no `className` that changes shape, spacing or color on them.
- Shared record shapes change in `commons/spec` first, then here. API changes are additive. No outbound connection without the org `docs/PRIVACY.md`.
- Never preview on the live hub (3000) or the main checkout's 8787; a change reaches the hub only through `ship.sh` on Jesse's word.
