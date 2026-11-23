# Recipes: where do I change X

One block each: files in order, the check, the catch. Map of the code: [module-map.md](module-map.md). Mode names are for
`bash scripts/verify.sh <mode>` (`code`, `ui`, `docs`); put it in the commit. Land with `bash scripts/land.sh`.

## Add a backend endpoint
1. Route file in `backend/src/routes/<area>.ts` (a Hono router; validate input with Zod); logic goes in `backend/src/lib/<area>.ts`, not in the route.
2. Mount it in `backend/src/app.ts` next to the others (`app.route("/api/<area>", routes)`). Check who may call it: see `middleware/auth.ts` and the age and surface gates in RULES.md.
3. Test in `backend/tests/<area>.test.ts` with `TestClient` (`backend/tests/client.ts`) and `resetDb()` (`backend/tests/reset-db.ts`); copy `backend/tests/people.test.ts`.
4. `cd backend && bun run gen:api-docs` if the endpoint is public API. Mode: `code`. Catch: API changes are additive only.

## Add a setting key
1. Declare it in the matching `backend/src/settings/<group>Keys.ts` (or a new file registered in `backend/scripts/gen-settings-registry.ts`); say its scope (`person`, `household`).
2. The registry itself lives in `commons/spec` and is generated: `cd backend && bun run gen:settings` writes it to the sibling commons checkout. Spec first, then pin the tag (`bash scripts/pin.sh commons <pkg>-vX.Y.Z`, see [../PINNING.md](../PINNING.md)). Until the tag exists, list the key in `scripts/settings-ahead-of-spec.json`.
3. Copy and screen text: `cd frontend && bun run i18n:settings`, then `bun run i18n:extract` and fill `src/locales/es/messages.po` (see [language-stack.md](language-stack.md)). `bun run i18n:check` must pass.
4. Read it with `getHouseholdSettingValue` or `getPersonSettingValue`, write with `setValue`, all in `backend/src/lib/settings.ts`; show it in `frontend/src/apps/settings/` or `frontend/src/shell/pages/settings/`. Mode: `code` (then `ui` if a screen changed).

## Add a database column or table
1. Edit `backend/src/db/schema.ts`, then `cd backend && bun run db:generate` (writes `db/migrations/NNNN_*.sql` and the journal). Never hand-number a migration.
2. Test it like `backend/tests/applySkippedMigrations.test.ts`. A migration is a risky surface: the lander runs its safety tests. Mode: `code`.

## Change the chat turn
1. Read [../design/RULES.md](../design/RULES.md) first. Turn flow: `backend/src/routes/turn.ts` to `backend/src/lib/turnMachine/` (`machine.ts`, `turnNext.ts`, `nodes/`).
2. Tests: `backend/tests/turnMachine/` (use `modeHarness.ts`, `toolHarness.ts`). Gate changes also run `backend/tests/gate/` and `backend/tests/filter/`. Mode: `code`.

## Add or change a screen (frontend)
1. Find it in [code-map.md](code-map.md) (generated), edit under `frontend/src/apps/<app>/`. Use Elements from `@maipai/ui` as shipped: no `className` that changes shape, spacing or color (rule 9). A missing prop goes into `commons` first.
2. User-facing text through lingui (`t`/`Trans`), then `bun run i18n:extract` and `i18n:check`. `bun run lint:ui-rules` in `frontend/` takes about a second.
3. Open it: `bun run dev` from the worktree, sign in as Sage, screenshot desktop and phone width. Mode: `ui`. Never preview on 3000 or 8787.

## Add a package or package page
1. `backend/packages/<id>/` holds `manifest.json`, `pages/*.json` and the tool code (`handler.ts` or `recipe.json`); copy a small neighbor such as `weather`. Rules: org `docs/PACKAGES.md`.
2. Bundled packages are hashed: after editing run `bun run refresh-bundled-packages` from the repo root; `backend/tests/bundledPackages.test.ts` and `bundledPackageHash.test.ts` check it. Then regenerate the screen map: `python3 scripts/code-map.py`.
3. Mode: `code`.

## Add a test
Next to the file (`name.test.ts`) or in `backend/tests/`, `bun:test`. Real network or wall-clock timing tests belong to the bench lane (`scripts/gate/flakes.json`), not the gate. `bash scripts/test-changed.sh --list` shows which tests a change already selects.

## Change a script or the delivery path
Read [delivery-pipeline.md](delivery-pipeline.md). `scripts/check.sh`, `wt.sh` and `land.sh` are risky surfaces: full `check.sh` under the machine lock and a `code-review`. Mode: `code`.
