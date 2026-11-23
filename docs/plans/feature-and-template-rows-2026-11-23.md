# Features and templates are data rows in the Stack (2026-11-23)

Status: draft, waiting for the architect verdict. Owner rule (Jesse, 2026-11-23): nothing about a feature or a hardware template is hard-coded or special.

## Supersedes

- The "Stack tier table" design in [stack-owns-model-choices-2026-11-21.md](stack-owns-model-choices-2026-11-21.md) (`backend/src/lib/tiers.ts` as the one hand-written list of candidates per category and tier). The candidates become a view over the part rows and the template rows below. Everything else in that plan stands.

## The rule

A **feature** (chat, coding, pictures, video, music, voice, speech to text, embeddings, vision, wake word, stems) is one row in the Stack. A **template** (16, 32, 64, 128 GB, or a named setup such as Mac Studio M5) is one row in the Stack. Home and the Stack admin page are two doors onto those rows: both render them with the same components and both change them through the same Stack API. No code branches on a feature name, a template id or a memory size, and no code names a model id to decide a tier, a level, a fallback, a queue or a message.

Per-person access (who may use a level, age and lane gates, rule 0 gates, C5 and C7 access checks) stays in Home and is the one carve-out from "no code branches on a feature name": it needs people.

## The rows

Feature row: `id`, `label`, `description`, `icon`, `priority`, `enabled`, `levels` (each: `part`, `enabled`), `requires` (parts the feature needs: model, engine, draft, wake word; each has state, size, install and remove), `steps` (readiness steps, such as a self test), `queue_class`, `memory_class`, `residency`, `launch_kind`, `worker`, `queue_after`, `follows` (a level that is the same choice as another feature's level), `settings` (its own keys, generated from the row; each generated key is also written to the spec settings registry with its copy fields, S4 and S5). A step shows its state only through `roleHealth` and `installStatus` (S6); the row holds no state of its own.

Part row (a model, engine or draft): `id`, `label`, `description`, `family`, `size`, `min_memory_gb`, `peak_by_level`, `fallback_for`, `requires_engine`, `minor_only`, `vetting`. Part data stays in each model's pack folder (E7) and the Stack's part table; the Stack derives the part rows from them and nothing is copied into `spec`. A part declares what it needs; the template only declares what it has.

Template row: `id`, `memory_gb`, `label`, `reserve`, `features` available, `assignments` (per feature and level, the default part; kept in the part table and pack data, never in Stack source, so the no-model-ids lint passes), `recommended`. Template assignments are defaults only; a household's edits are stored in the Stack's settings store, never in a repo or a migration (E5). Whether a part fits is `part.min_memory_gb <= template.memory_gb - reserve`. Nobody compares a template id.

One API: `GET /stack/v1/choices` returns feature rows with their parts, steps and levels. `PUT` routes change `enabled`, `priority`, a level's part, order. The kit's `StackModelsPage` renders any row, including its `requires` and `steps`, so Coding needs no panel of its own.

## Audit (2026-11-23, five read-only sweeps; counts are approximate and the sweeps were samples, not proofs of completeness)

Roughly 190 sites. Worst first.

**Stack, choices and tiers (about 45).** `diskPlan.ts:164-223` one hand-written row per feature with model ids and `notAvailable` keys; `components.ts:247-261` role to group and label, `:519` per-feature memory text; `tiers.ts:39-74` `profiles: [...]` on about 35 candidates, `:89,118,151` the Reduced model for chat and voice hard-coded; `choices.ts:453-501` and `choiceResolver.ts:83-179` branches on chat and voice and the `stack.engines.chat.model` key built by hand; `choiceCategories.ts` model ids in `partIds` and `heavyAt`.

**Stack, runtime (about 70, about 20 legitimate).** `roles.ts:51-187` `ROLES` and `ROLE_JOB_CLASS` as code tables; `governor.ts:438,467,608,1137-1195` video and image branches for the chat window, the flex band and messages; `supervisor.ts:161-182,962-1012` role lists (`SPAWNABLE`, `MANAGED`, `GENERATOR`, `JIT`) and chat, judge, router forced into coding mode; `jobs.ts:334` worker names per role, `media/jobs.ts:998` `queueBehind`; `settings.ts:50-144,342` per-role keys and defaults by hand. Legitimate: the engine and launch-plan switches in `supervisor.ts` (a different process really starts) and ffmpeg stream checks.

**Templates (about 32, about 8 legitimate).** `diskPlan.ts:195-223` about 17 `TIER_ORDER.indexOf(tier.id) >= indexOf("p64"|"p128"|"p32")` gates; `profiles.ts:20-69` `PROFILE_TIERS` and `PROFILE_MODEL_BINDINGS` as code; per-feature tier lists `MUSIC_TIERS`, `VIDEO_TIERS`, `SFX_TIERS`; `p16` and `p32` checks in `images/models.ts`, `images/h3Runner.ts`, `governor.ts:426`, `recordedSpeech*.ts`; Splash on `p128` in `supervisor.ts:721,1249`; `profilePlanner.ts:160`; Home `shared/diskPlanMath.ts:107-114` and `routes/setup.ts:78,103`; GB text in `installPlan.ts:41`, `splash.ts:55`.

**Home backend (about 40, about 12 legitimate).** `shared/aiChoices.ts` per-job cards, row ids and copy; `tiers.ts:7,35-63,172-183` per-category map, `engines.<role>.tier.*` keys, `qwen-image-2512-q8`; `stackChoiceSnapshot.ts:10` and `stackChoicesMigration.ts:14-26` feature to Stack name map and per-feature switch keys; `stackCodingPieces.ts`, `codingMode.ts`, `codeReady.ts` the coding pieces and eight readiness steps; `lib/videos/quality.ts`, `lib/music/models.ts`, `modelCatalog.ts` model ids. Legitimate: access grants and age and lane gates.

**Frontend and kit (about 14, about 6 legitimate).** `ui/src/stack/StackParts.tsx:18` icon per feature; `stackWords.ts:38` `categoryBlurb` switch; Home `levelAccess.ts:14,23` `ACCESS_FEATURES` and `GATE_KEYS`, `shared/tierSlotOptions.ts`, `AiLevelAccess.tsx:40`; admin `roleIcons.ts`, `resourceData.ts:106` `ROLE_ORDER`; `performanceModel.ts`, `PerformanceCustomize.tsx`; `CodingSettings.tsx` pieces and checklist; `FeatureAccess.tsx:14`; `roleWords.ts`. Legitimate: the level names (reduced, standard, boost, max) and the media app kinds.

The first build step makes the audit exact: a script (`scripts/lint-no-feature-names.ts` in each repo) that fails on a feature id, a template id or a model id in logic, so the list cannot grow back and the remaining sites are counted by the lint, not by a sweep.

## Build order

1. **Stack: rows as data.** One definition for features and templates in the Stack (spec holds only the row shapes, never part ids or sizes; E1); `CATEGORY_DEFS`, `PROFILE_TIERS`, `ROLES` and the tier table become views over it. `follows`, `heavyAt` and `process` (landed in Stack aad8371) become row fields.
2. **Stack: readers.** The resolver, runtime, governor, supervisor, disk plan, components and settings read the rows. Delete each special case as its reader moves. The lint turns on per file.
3. **Stack API.** Serve `requires`, `steps`, `icon`, `description`, `priority` and `enabled` on the feature row; add the PUT routes that change them.
4. **Kit.** `StackModelsPage` renders `requires` and `steps` and reads icon and description from the row; delete `CATEGORY_ICON` and `categoryBlurb`. Tag `ui`.
5. **Home.** Pin the new tags; delete the Coding pieces panel, `shared/aiChoices.ts`, the per-category map in `tiers.ts`, the snapshot name map and the per-feature access maps; keep per-person access, keyed by the feature id the Stack serves.
6. **Admin UI.** Roles, icons and order from the row.

Each step lands alone and keeps the tests green. Steps 1 and 2 are the largest: about 160 sites across the Stack and Home.

## Reuse check

Considered: keeping the category table in code and adding a field per feature (what grew the special cases); a database for rows (the Stack's existing settings store and part table are enough). Chosen: the row shapes in `spec` (no part ids or sizes), the rows themselves in the Stack, plus the existing choices API and `StackModelsPage`. No new library.

## Open for the architect

Rule E5 and the 2026-11-21 entry already moved choices to the Stack. This extends it to features, parts and templates as rows and adds a `requires` and `steps` shape to the choices API.
