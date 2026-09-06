# Wave 2: four sessions, no collisions

Written 2026-09-06 from a review of `docs/BACKLOG.md` (including the
"Wave 2 additions" section written the same day), `docs/dev.md`, the
platform plan (chapters 4, 5, 7, 12, 13), the org standards in
`getmaipai/.github`, the two Wave 1 work orders
(`session-a-intelligence.md`, `session-b-ui.md`) and what their worktrees
had shipped, and the legacy hub mirror (`legacy-backups/home-legacy.git`).

Wave 1 was two sessions: A (intelligence, backend) and B (UI, frontend).
Wave 2 is four. Each session has one file here, owns a disjoint set of
paths, and builds against contracts frozen below. Read this file first,
then your own.

| Session | File | Lane |
|---|---|---|
| C | `session-c-brain-and-voice.md` | The turn engine past Wave 1: real routing, tool calls, guards, benches, the voice loop's server half, the legacy import |
| D | `session-d-packages-and-store.md` | Packages: the Tier 1 host, the store, the catalog tooling, quality and smoke, the lookups and lists the family asks for |
| E | `session-e-ui-and-docs.md` | Every screen the other three need, the first-run wizard, home cards, push-to-talk, the parental surfaces, user docs |
| F | `session-f-platform-and-trust.md` | Health, Repairs, updates and self-update, trust on the LAN, passkeys and devices, grants, backups, storage, the first release |

## When to start

Wave 2 starts from `main` after the Wave 1 worktrees have merged. Session A
(`home-a`, branch `session-a-intelligence`) has steps 11 and 12 left;
Session B (`home-b`, branch `session-b-ui`) has steps 8 to 10 left. Do not
start a Wave 2 session on files a Wave 1 session still owns:

- C, D and F may start as soon as A has merged (they own backend and spec
  paths A touched; B's remaining steps touch only `frontend/`,
  `scripts/screenshot.ts`, `scripts/check.sh` and `vite.config.ts`).
- E may start as soon as B has merged.

If A's step 11 (per-person request limits, the Telegram and voice-catalog
fetches through the limiter) is not on `main` when C starts, C ships the
turn and LLM route half and F ships the fetch half, in their first steps.

## Rules every session follows

Everything in `getmaipai/.github/CLAUDE.md` applies. On top of it:

- **Worktree.** `git worktree add ../home-<letter> main` (or `EnterWorktree`),
  branch `session-<letter>-<lane>`. Merge to `main` and delete the worktree
  before the session ends.
- **Own data directory and port.** `MAIPAI_DATA_DIR=<worktree>/data-<letter>
  PORT=<port> bun run dev` in `backend/`; C 8801, D 8802, E 8803 (its backend
  for manual checks; Vite proxies to it through the env var
  `session-b-ui.md` step 0 added to `vite.config.ts`), F 8804. Never the
  shared `data/`.
- **Rebase before every commit**: `git fetch && git rebase origin/main`.
  Conflicts should be none on owned files. On a shared file (below), keep
  both sides.
- **Definition of done per step**: `scripts/check.sh` green, the behaviour
  exercised against the running app (curl, the test client, or the
  browser), the `code-review` skill at medium effort on the diff, docs in
  the same commit, one commit per step, never `git add -A`.
- **Tests first, in the repo's shape**: `bun:test` with the existing
  helpers in `backend/tests/` and `frontend/tests/`; every bug found live
  becomes a regression test before the fix; no live model in the
  per-commit suite (bench runs are on demand, recorded in dev docs).
- **Spec first**: a record shape changes in `spec/schemas/`, then
  `bun run gen:ts` and `bash scripts/gen-py.sh` in `spec/`, a fixture, then
  the hub.
- **Prebuilt over hand-built**: a maintained library for a solved problem
  beats a hand-rolled one. Every dependency is AGPL-compatible, pinned,
  installed with `bun add`, listed in `NOTICE` when its licence asks.
- **Dev docs**: each session writes its own file, `docs/dev/session-<letter>.md`,
  one `## Step N:` section per shipped step (what shipped, numbers chosen
  and why, what is left for whom). `docs/dev.md` is not edited except for
  one line in its "Wave 2" index at wrap-up. `docs/BACKLOG.md`: check off
  only what you shipped, add gaps under the right section.
- **User docs**: a feature a family member can see gets a page under
  `docs/user/` in the same commit (dad test, grade 6, one action per
  step). Session F builds the site that renders them; the pages are
  plain Markdown and do not wait for it.
- **Privacy page**: any new outbound connection updates `lib/privacy.ts`'s
  aggregation (D owns that file; other sessions declare the connection in
  their package manifest's `data_sources[]` or, for core, write the row
  into their dev file for D to add, and D adds it the same day).
- **Never**: log or return a secret, put real family data in a fixture,
  add a network call outside the limiter, or weaken a safety invariant.

## Ownership map

Paths not listed are shared (next section) or untouched this wave.

**C (brain and voice)**
`backend/src/lib/{turnEngine,routing,conversationHistory,memory,memoryJudge,memoryShape,memoryId,persona,replyVariation,text,safety,guards,llm,tts,ttsSupervisor,stt,sttSession,voiceCatalog,clonedVoices,wakewordAssets,legacyImport}.ts`
(new names are C's to create), `backend/src/routes/{turn,llm,memory,conversations,tts,voice,stt,openai,safety}.ts`,
`backend/src/settings/{aiKeys,personaKeys,voiceKeys}.ts`,
`backend/scripts/bench/**`, `backend/tests/` for those modules,
`spec/{safety,llm,voice}/**`, `spec/schemas/{memory-record,conversation,content-ceiling,safety-result}.schema.json`
and their fixtures, `backend/packages/{remember,recall}/` (memory-owned
recipes; every other package is D's).

**D (packages and the store)**
`backend/packages/**` except `remember` and `recall`,
`backend/src/lib/{plugins,skills,packageHost,scheduler,commands,privacy,store,storeIndex,packageCache,smoke,denoHost,lists,widgets}.ts`,
`backend/src/routes/{plugins,host,scheduler,commands,privacy,store,lists,widgets}.ts`,
`backend/src/settings/{homeAssistantKeys,packageKeys,searchKeys}.ts`,
`spec/{interpreters,emulators,vocab}/**`, `spec/fixtures/recipes/**`,
`spec/schemas/{manifest,recipe,result,list}.schema.json` and fixtures,
the whole `getmaipai/catalog` repo.

**E (UI and user docs)**
`frontend/**`, `spec/ui/**`, `scripts/screenshot.ts`, `package.json` at
the root, `backend/src/settings/uiKeys.ts`, `docs/user/**` pages for what
E builds, `docs/assets/**`.

**F (platform and trust)**
`backend/src/lib/{access,personLifecycle,personShape,session,secret,secretThrottle,keystore,secrets,deviceId,selfUrl,trustProxy,ssrfGuard,singleflight,validation,backup,backupCrypto,archive,restoreStaging,paths,id,hlc,notifications,notificationTypes,telegramChannel,webPush,rateLimiter,llmSupervisor,embedSupervisor,embedAssets,engineAutotune,engineCatalog,enginePostLoadCheck,engineStats,hardware,modelCatalog,modelDownload,modelDownloadJobs,issues,updates,selfUpdate,sidecars,householdCa,mdns,passkeys,deviceTokens,quickConnect,approvals,entities,relationships,grants,storage,diagnostics,setup}.ts`,
`backend/src/routes/{auth,people,backups,settings,notifications,health,repairs,updates,devices,entities,relationships,grants,storage,diagnostics,setup}.ts`,
`backend/src/middleware/**`, `backend/src/settings/{coreKeys,backupKeys,notificationKeys}.ts`,
`spec/schemas/{person,entity,relationship,grant,device,issue,setting,settings-key}.schema.json` and fixtures,
`spec/records/**`, `spec/link/**` (new, spec only), `scripts/**` except
`screenshot.ts`, `docs/site/**` (the docs site build), `README.md`,
`CHANGELOG.md`, `LICENSE`.

## Shared files: the protocol

These are touched by more than one session. The rule for each is
"additive only, rebase first, regenerate rather than merge".

| File | Rule |
|---|---|
| `backend/src/db/schema.ts` | Add tables and columns; never rename or remove. Each session's tables sit in one clearly commented block. |
| `backend/src/db/migrations/**` | Generate with `bun run db:generate` only immediately after a rebase. If the journal conflicts on rebase, delete your own migration and snapshot and regenerate on top. Never hand-edit a snapshot. |
| `backend/src/db/schema-version.ts` | Bump to one more than whatever `main` has at rebase time. |
| `backend/src/index.ts`, `backend/src/app.ts`, `backend/src/wire.ts` | One registration line per feature (a route mount, a core job, a wire type export). Keep both sides on conflict. |
| `spec/gen/**`, `spec/settings/keys.json`, `spec/schemas.resolved/**`, `bun.lock` | Generated. Never resolve a conflict by hand: take either side, rerun the generator or `bun install`, commit the result. |
| `spec/errors/errors.json` | Append your codes under a comment naming your session. |
| `NOTICE` | Append; keep both sides. |
| `docs/BACKLOG.md` | Edit the checkbox of an item you shipped; add new items at the end of the section they belong to. |
| `docs/dev.md` | Untouched except one line in the "Wave 2" index at wrap-up. |
| `scripts/check.sh` | F owns it. Another session that needs a step added writes the need in its dev file and pings F through the backlog; until then, run the extra check from the repo's `package.json` script. |

## Contracts between sessions (frozen; additive only)

Build against these from day one with a local mock where the other side
has not merged yet; swap to the real routes when they land (rebase and
check). Nothing existing on `main` is renamed or removed by any of them.

### C to E: speech to text

- `WS /api/stt/stream`: the client sends `{ "type": "hello",
  "sample_rate": 16000 }` then binary f32le PCM frames; the server sends
  `{ type: "ready" }`, `{ type: "vad", speaking: boolean }`,
  `{ type: "partial", text }`, `{ type: "final", text, turn_id? }`,
  `{ type: "no_speech" }`. A `final` with `submit: true` in the hello
  means the server also ran the turn and the turn stream follows on
  `POST /api/turn/stream` as usual (the client passes the returned text).
- `POST /api/stt/transcribe`: a WAV body, returns `{ text }`.
- `GET /api/voice/stt/status`: `{ installed, engine, model }`.

### C to D: routing and tools

- C reads manifests only through D's existing `listPackageIds()` and
  `loadPackage()` (`lib/plugins.ts`) and runs them through `runPlugin()`.
  C never edits `plugins.ts`; D never edits `turnEngine.ts` or
  `routing.ts`.
- Tier 1 embeds `routing.examples` per package at first load; Tier 2
  offers a package as a tool using its `args` JSON Schema and
  `description`. D keeps both fields accurate; a package with fewer than
  five examples is not offered.
- D's `ask` continuation (the recipe result's `ask` field, unbuilt today)
  is consumed by C: when a result carries `ask`, C stores it on the
  conversation and matches the next utterance against it before the
  floor.
- The manifest gains `exposes: { queries: [{ id, description, args,
  returns }] }` (D's schema change). C offers those as typed read tools
  in Tier 2 and D implements them as parameterised SQL per package.

### D to E: the store, widgets, lists

- `GET /api/store/index` returns the verified catalog index summary
  `{ fetched_at, expires_at, packages: [{ id, kind, category, display,
  description, latest, permissions, min_app, community: boolean }] }`.
- `GET /api/store/packages?q=&kind=` searches it. `GET /api/store/packages/:id`
  returns the card (README rendered as HTML-safe Markdown, versions,
  permissions, privacy rows, scorecard).
- `POST /api/store/install { id, version? }` returns `{ ok: false,
  needs_confirm: true, permissions_added: [...] }` on first call when a
  prompt is needed; `POST /api/store/install/confirm { id, version }`
  proceeds. `POST /api/store/uninstall`, `/rollback`, `/channel`.
- `GET /api/plugins` rows gain `installed_version`, `latest_version`,
  `channel`, `status: "enabled" | "disabled" | "faulted"`, `smoke: {
  last_run_at, ok, message }`.
- Widgets: the manifest gains `contributes.widgets[]`: `{ id, title,
  size: "card" | "row", refresh_s, inputs }`. `GET /api/widgets` lists the
  actor's available widgets; `GET /api/widgets/:package/:id/data` returns
  `{ as_of, items: [{ title, subtitle?, value?, icon?, href?,
  image? }] }` served from the package cache (never a live fetch in the
  request path unless the cache is empty).
- Lists: `GET/POST /api/lists`, `PATCH/DELETE /api/lists/:id`,
  `POST /api/lists/:id/items`, `PATCH/DELETE /api/lists/:id/items/:itemId`,
  `POST /api/lists/:id/clear`; a list is `{ id, person, scope, kind:
  "shopping" | "todo" | "custom", title, items: [{ id, text, done,
  due_at?, created_at }], hlc }`.

### F to E: health, repairs, updates, storage, devices, setup, grants

- `GET /api/health`: `{ sidecars: [...], gpu, disk, last_backup,
  certificate, models: [...], link: [] }`.
- `GET /api/repairs`: issues `{ id, source, severity: "info" | "warning" |
  "error", title, detail, fix: { label, action } | null, learn_more,
  created_at, resolved_at }`; `POST /api/repairs/:id/fix`,
  `POST /api/repairs/:id/dismiss`.
- `GET /api/updates`: rows `{ kind: "app" | "package" | "model" |
  "sidecar", id, installed, latest, summary, url, channel: "auto" |
  "notify" | "pinned", progress, needs, blocked_by }`;
  `POST /api/updates/:kind/:id/install | hold | rollback`,
  `POST /api/updates/check`.
- `GET /api/storage`: layout, sizes, quotas, targets;
  `PATCH /api/storage/quotas`.
- Devices and sign-in: `GET /api/devices`, `DELETE /api/devices/:id`;
  `POST /api/auth/quick-connect/code` (from the device) returns `{ code,
  poll_token }`, `GET /api/auth/quick-connect/poll` (from the device),
  `POST /api/auth/quick-connect/approve { code }` (from a signed-in
  phone); `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`;
  passkeys under `POST /api/auth/passkeys/register/{options,verify}` and
  `.../authenticate/{options,verify}` (WebAuthn, `@simplewebauthn`).
- Approvals: `GET /api/approvals`, `POST /api/approvals/:id/{approve,deny}`.
- Setup: `GET /api/setup/state` returns `{ done: boolean, step, steps: [
  { id, done } ] }` for the wizard; `POST /api/setup/:step` per step
  (`household`, `owner`, `acknowledgment`, `hardware`, `trust`,
  `packages`, `remote`, `emergency_kit`, `backup`, `done`).
- Entities, relationships, grants: CRUD under `/api/entities`,
  `/api/relationships`, `/api/grants`, rows in the spec shapes;
  `GET /api/people/:id/permissions` returns the effective grant set.
- Notifications: `GET /api/notifications/history` (exists) gains `?since=`;
  a `web_push` channel and `POST /api/notifications/push/subscribe`;
  quiet hours as settings keys `notifications.quiet_start` and
  `notifications.quiet_end` (person scope).

### F to C and D: issues and sidecars (merge these first)

- `lib/issues.ts`: `raiseIssue({ source, key, severity, title, detail,
  fix? })` upserts by `(source, key)`; `resolveIssue(source, key)`. D's
  smoke failures and C's engine faults call these. F ships this in its
  step 1 and merges that step alone, early, so the others can import it.
- `lib/sidecars.ts`: `registerSidecar({ id, command, args, cwd, port,
  health_url, startup_order, backup_mode })`, `getSidecar(id)` returning
  `{ status, base_url }`. D's SearXNG and C's voice programs register
  through it. F ships this in its step 2, merged early the same way.

### C and F: age, roles and ceilings

C owns the safety layer and the new `content-ceiling` record; F owns
Person, Grant and the roles-to-grants migration. Both read the backlog's
"Resolve the unrestricted-mode age collision" and "Do roles keep
age-flavoured names" items, which are Jesse's calls. Until he decides:
age band is derived from birthdate (done in Wave 1) and used by safety
only; roles keep gating what they gate today; grants are added beside
roles, not instead of them.

## Deferred to Wave 3, on purpose

The link transport and the sync engine (`spec/link/` beyond the record
shapes, the oplog, pairing over the network, Python ports of the memory
store) touch every record table and every session's files at once; they
are the next wave's single session, once these four have merged. F lays
the pieces the link needs that are also useful now: the Device record,
device tokens, Quick Connect, HLC on every table, and the never-sync
allowlist as a spec test.
