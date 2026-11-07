# Talent: the build spec (2026-11-07)

Status: build instructions for [talent-2026-11-07.md](talent-2026-11-07.md) (the design, architect APPROVED). This file: architect
APPROVED 2026-11-07 (record `TALENT-BUILD.verdict`), then NEEDS-RULE-CHANGE after the owner's ruling that minors may use real-person
synths under a parental control; that rule change landed in `.github/docs/SAFETY.md` on 2026-11-07 (`Owner-approved: 2026-11-07`,
org commit 545a2a5), so the verdict is APPROVED again and the slices build. Written so that a smaller
coding model can build each slice from this file alone. Every path, name and signature below was read from `origin/main` of `home`,
`commons` and `stack` on 2026-11-07; if a named thing is missing when you build, stop and report it instead of inventing a replacement.
No code exists yet. Owner's words: "do not code, we are just planning" (2026-11-07); this file is the plan, a slice is built only when
the owner says so.

## Supersedes

- [talent-2026-11-07.md](talent-2026-11-07.md) section 7.4 and the TALENT-03 row: the episode is assembled by a Stack `media.mix` job
  (an audio timeline, section 5.2 here) instead of a `media.edit` job, because `media.edit` takes at most 24 inputs and writes only
  video or png while an episode has up to 400 clips and wants an audio file. Stingers are trimmed by `media.mix` itself (`end_ms`, `fade_out_ms`), never by `media.edit`. Four more details differ from the note
  and this file wins: the episode file is m4a (AAC), not MP3; a line the floor refuses is cut, not rewritten once (the writer's segment
  call already saw the floor rules, a second call buys little); a segment with every line cut fails the episode with a plain reason
  instead of being dropped and the outline re-sized; and there is no separate music bed, the intro and outro stingers are the bed. Where
  this file and the note differ in any other detail, this file is the one to build from.

## 0. How to build a slice

1. Read the design note's sections named in the slice, then this slice, then nothing else unless the slice says so.
2. Work in your own worktree: `bash scripts/wt.sh start <slug>` from `/Users/jessetorres/Developer/github.com/getmaipai/home`.
3. Write the failing tests named in the slice first, then the code, by file name, exactly as listed. Touch no other file.
4. Run `cd backend && bun test tests/<file>.test.ts` for each test file, then `bash scripts/check.sh --pre` from the worktree root.
5. Land with `bash scripts/land.sh --done <ITEM-ID>`, then `bash scripts/land.sh wait`. Never edit `docs/BACKLOG.md` checkboxes.
6. A slice that touches `commons` is spec first: its own worktree in `/Users/jessetorres/Developer/github.com/getmaipai/commons`,
   `cd spec && bun run gen:ts && bash scripts/gen-py.sh && bun test && uv run pytest tests/py -q`, commit by file name, tag
   `spec-vX.Y.Z` (equal to `spec/package.json` `version`), push the tag over https, then in Home `bash scripts/pin.sh commons spec-vX.Y.Z`.
7. Rules that bind every slice: no em dashes in any text; every error message says what went wrong and what to do; no `className` on a
   kit Element and no Home wrapper around one (rule 9); logs carry counts and milliseconds, never a line of speech or a fact (rule 6a);
   every spoken line goes through the normalizer; a child's floor applies to every sentence (rule 10).

## 1. Shared facts (read once)

Home backend: `/Users/jessetorres/Developer/github.com/getmaipai/home/backend/src`. Tests: `backend/tests/*.test.ts`. Test helpers:
`tests/reset-db.ts` (`resetDb()` in `beforeEach`), `tests/support/testAuth.ts` (`owner()`, `teen(ownerClient)`, `child(ownerClient)`,
each returning `{ client, row }`), `lib/stackEngine.ts` `__setStackClientForTests(client)`, `tests/filmRun.test.ts` `fake(record)` as
the pattern for a scripted engine, `lib/films/plan.ts` `testCompleter` as the pattern for a scripted model.

| Thing | Where | Shape |
|---|---|---|
| Memory write | `lib/memory.ts` l.215 | `remember(actor: PersonRow, input: RememberInput): MemoryOpResult<MemoryRecord>`; `RememberInput` l.178 (`text, category, tier, scope, person?, subject_id?, source, importance, pinned?, sensitive?, child_disclosure?, valid_from?, valid_to?, device_id?, created_by?`) |
| Memory supersede | `lib/memory.ts` l.1160 | `supersede(actor, oldId, input: SupersedeInput, opts?)` |
| Memory list and recall | `lib/memory.ts` l.393, l.689 | `list(actor, opts: ListOptions)`, `recall(actor, query, opts: RecallOptions)`; `ListOptions.scope` is `"household" \| "person" \| "self"` today |
| Memory read gate | `lib/memory.ts` l.50 | `canRead(actor, record, roleOf, selfOnly, withholdSensitive, anonymous)` (not exported); household branch checks `child_disclosure` by `speakerAgeBand` |
| Memory table | `db/schema.ts` l.163 `memoryRecords` | no `companion_id`, `fact_confidence`, `confidence_evidence`, `conflicts_with` columns today |
| Profile card | `lib/memoryProfile.ts` | `PROFILE_CARD_MAX_LINES = 8`, `PROFILE_CARD_MAX_CHARS = 400`, `ProfileCard { ruleLine, lines: ProfileCardLine[] }`, `renderProfileCard(card): string`, `buildProfileCard(person, now, opts)` |
| Context node | `lib/turnMachine/nodes/context.ts` | memory recall at l.306, matches pushed at l.381 as `memory-<id>`, profile card at l.402 as `profile-rule` and `profile-<id>` |
| Persona | `lib/persona.ts` | `Persona` l.61; `adaptPersonaToBand(persona, band)` l.446; `composePersonaPrompt(persona, surfaceClass = "spoken")` l.503; `personaFromManifest(id, manifest, allowDraft)` l.122; `resolvePersona(id)` l.188 |
| Dial presets | `lib/companionPersonality.ts` | `COMPANION_PERSONALITIES` (friendly, funny, calm, professional, playful) |
| Household companions | `lib/householdCompanions.ts` | `createHouseholdCompanion(input: Companion, author: CompanionAuthor, startingAudience)`, `updateHouseholdCompanion(id, patch)`, `getHouseholdCompanion(id): Manifest \| null`, `listHouseholdCompanionIds()`, `deleteHouseholdCompanion(id)`; store `<data>/companions/<id>/manifest.json` plus `owner.json` `{ person_id }`; id `/^hc-[a-z0-9]+(?:-[a-z0-9]+)*$/` max 40 |
| Companion routes | `routes/companions.ts` | `GET /`, `POST /`, `GET /{id}`, `PUT /{id}`, `PUT /{id}/audience`, `DELETE /{id}`, look and portrait routes; confirm the mount path in `app.ts` |
| Companion copier | `lib/householdCompanions.ts` l.120 to l.129 | `copyBundledCompanion(bundledId, author)`, `copyHouseholdCompanion(sourceId, author)`, behind `POST /api/companions/{id}/copy` ("Make a copy"): the one copier, extended by `forkSynth` |
| Oversight ladder | `lib/personLifecycle.ts` l.122 | `canManage(actor, target)`: who may manage a person (a parent or admin for a minor); the only definition of it |
| Companion gates | `lib/companionsApp.ts` l.101, `lib/robotCompanion.ts` l.52, l.31 | `mayUseCompanion(person, persona)`, `companionFits(controls: AgeBand, floor: AgeBand)`, `companionFloor(audience): AgeBand` |
| Companion pick | setting `persona.active_id`; `lib/turnMachine/turnNext.ts` l.1065 | `ownPersona(actor)`, `conversationPersona(actor, companionId)` |
| Look | `lib/companionLook.ts` | `readLook(id)` (`rest` is the approved picture), `describeCharacter(png, lookPrompt)`; `lib/companionPortrait.ts` `retainCompanionPortrait(companionId, versionId)` |
| Scheduler | `lib/scheduler.ts` | `CORE_JOBS: Record<string, CoreJobHandler>` l.324 (not exported; add entries in the file), `CoreJobHandler = (row: JobRow) => void \| Promise<void \| CoreJobIdle>`, `ensureCoreJob(job, when)` l.222, `when` is `every:<n>m\|h\|d` only; boot seeds in `index.ts` l.166 to l.251 |
| Local day | `lib/news/dayParts.ts` | `hubTimeZone()`, `localDayKey(...)` |
| Safety | `lib/safety.ts` l.119 | `evaluateReply({ text, speech? }, band): ReplyEvaluation`, `effective.action` is `allow \| allow_with_resources \| refuse`; `lib/ageBand.ts` `AgeBand`, `speakerAgeBand(actor, now)` |
| Productions | `lib/mediaProductions.ts` | types `CastRole { subject_id, role, wardrobe_variant_ids, voice_choice, notes }`, `Shot { id, subject_ids, clip_file_id?, picture_file_id?, music_line_id?, voice_line_id? }`, `Scene { id, title?, shots }`, `Episode { id, title?, scenes }`, `Production`; `createMediaProduction(actor, input, source)`, `updateMediaProduction(actor, id, patch)`, `setShotVoiceLine(ownerPersonId, productionId, shotId, fileId)`, `applyCastOperation`, `applyScriptOperation`, `canSeeProduction` |
| Production routes | `routes/mediaProductions.ts` | `GET /`, `POST /`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`, `POST /{id}/share`, `PATCH /{id}/cast`, `PATCH /{id}/script` |
| Subjects | `lib/mediaSubjects.ts` | `createMediaSubject(actor, { name, kind, look, referenceIds?, real? })`, `getMediaSubject`, `subjectsForNames` |
| Media items | `lib/media/appHost.ts` l.43 `MEDIA_APPS`, l.153 `queryItems`; `lib/media/band.ts` l.38 `bandOkAtIngest`, `allowedBandsFor(person)`; `lib/media/podcasts.ts` ~l.390 `recordFor` (the `media_items` insert for an episode) | `media_items` columns: `id, kind, title, subtitle, description, source_id, loc_file_id, loc_url, media_type, duration_s, playable, artwork (JSON), chapters (JSON), advisory_explicit, advisory_source, band_ok, hidden, deleted_at, ...`; playback `GET /api/media/items/{id}/content` |
| Transcripts | `lib/transcripts/store.ts` l.99, l.71 | `insertTranscript(actor, NewTranscript)`, `storedTranscriptForItem(itemId)` |
| Files | `lib/attachments.ts` l.187 | `storeFile(actor, { conversationId: null, turnId: null, mediaType, bytes, provenance, name? })`; provenance is a `"<kind>:<json>"` string, see `lib/films/engines.ts` l.82 |
| Background model call | `lib/llm.ts` l.1053 | `completeBackground(messages: LlmMessage[], options): Promise<BackgroundResult>`; schema through `options.response_format = { type: "json_schema", json_schema: { schema } }` built by `responseFormat(schema, name)` in `lib/films/plan.ts` l.55; `thinking: false, dropReasoning: true` |
| Speech | `lib/tts.ts` l.78 | `synthesizeSpeech(rawText, voiceUrl?, { normalize? })` streams one WAV; `MAX_TEXT_LENGTH = 4_000`; `lib/voiceForSpeech.ts` `voiceForSpeech({ actor, deviceId?, companionVoice? }): string`, `isPresetVoice(id)`; `lib/voiceResolve.ts` `resolveVoice(stored, offered)`, `getOfferedVoices()`; `lib/voiceCues.ts` `planVoiceCues(input: CueInput)`, `sanitizeSpeechTags(text, supportedTags)`; `lib/spokenText.ts` `toSpokenText(text, { locale? })` |
| Stack client | `lib/stack/client.ts` | `submitJob({ kind, role?, input })`, `job(id)`, `cancelJob(id)`, `speak(form)` (POST `/v1/audio/speech`, multipart `{ text, voice_url?, temperature?, pitch_semitones? }`, WAV 24 kHz mono 16-bit); Home and the Stack share one disk, a job's result carries file paths |
| Stack jobs | stack `backend/src/media/jobs.ts` l.21 `MEDIA_KINDS`, l.826 `registerJobRunner(kind, runner, { lane })`; `backend/src/lib/jobs.ts` l.25 `JobRunner = (job, signal, progress) => Promise<unknown>`, `JobRunnerOptions.generator { role, memory, queueBehind? }` | recorded speech registers with `role: "tts"` (`backend/src/recordedSpeech/jobs.ts`) |
| Stack edit | stack `backend/src/media/editOps.ts` | `EditInput { inputs (1 to 24 paths), ops (1 to 12), output { dir?, name matching mp4\|mov\|webm\|png } }`; ops `concat`, `audio_overlay { input, gain_db, start_s, duck, loudness_lufs?, fade_in_s, fade_out_s }`, `fade`, `gain`, `trim`, `crossfade` |
| Music from a job | `lib/music/tool.ts` l.343 | `runGenerateMusic({ state, args: { instrumental: true, length: "quick", ... }, callId, spoken })` then `getMusicJobFor(actor, jobId)`; see `lib/films/engines.ts` l.143 for the `state` it builds |
| Picture from a job | `lib/pictures/stack.ts` l.119 | `submitGeneration({ prompt, size?, n?, seed?, audience: "all-ages" \| "adult", timeout_ms })`, `getGenerationJob`, `fetchPicture(job, index)` |
| News | `lib/shelf/shelfRead.ts` l.52 | `releaseShelfItems(band, limit): ShelfItem[]` (`id, url, title, summary, published_at, publisher, band_ok, topics?` JSON string parsed by `topicsOf`); `lib/news/summary.ts` `summarizeStory(storyId, band)`, `storedKeyPoints(storyId, band)` |
| Weather | `lib/weatherSummary.ts` l.131 | `summaryFor(input: SummaryInput, nowMs): string`; the place is setting `household.home_place`; see `lib/plugins.ts` l.750 for how it is called |
| Web search | `lib/packageHost.ts` l.1784 | `searchPickedWebSources({ args, band, role, spoken, temporary, searxOpts, signal?, deadlineAt? }): Promise<SearxngSearchResult>` (`rows: { title, url, snippet }[]`, `pages?: { url, title, text }[]`); sources gate `lib/retrieval/webSources.ts` `webSourcesFor(band, temporary, spoken)` (empty means off) |
| Reference | `lib/referenceSearch.ts` l.45 | `searchReference(person, q, book?): Promise<{ hits: { title, snippet, book, path }[], total }>`; `lib/reference/article.ts` `loadArticleFor(person, book, path)` |
| Lists and reminders | `lib/lists.ts` l.76 `listLists(actor)`, `lib/reminderActions.ts` l.28 `pendingReminders(actor)`, `lib/comingUp.ts` l.39 `listComingUp(actor)` | |
| Tool caps | `lib/turnMachine/budget.ts` l.202 `MUSIC_SHRINK_ORDER`, l.207 `withTurnToolGates`, l.184 `offerPassesGate` | `max_tools: 16` per model in `lib/modelCatalog.ts` |
| Film pattern | `lib/films/run.ts` (`FilmStage`, `FilmEngines`, `runFilm`), `lib/films/plan.ts` (`planFilm`), `lib/films/engines.ts` (`realFilmEngines`, `backgroundTurn`), `lib/films/tool.ts` (`MAKE_FILM_TOOL_ID`, `makeFilmArgs`, `runMakeFilm`), package `backend/packages/make_film/manifest.json` (`"offer": { "mode": "conditional", "gate": "filmAllowed", "bench_row": "make-film-tool" }`), card `frontend/src/apps/chat/chatToolUis.tsx` l.380 `FilmToolRender` with `JobProgress` and `VideoPlayer` | copy this shape for shows |
| Podcasts package | `backend/packages/podcasts/pages/{index,shows,show,play,episodes,...}.json`, data routes in `routes/podcastApp.ts` | a list block: `{ "type": "list", "bind": { "source": "package", "path": "<data id>", "params": {...} }, "item_key_field", "item_label_field", "item_subtitle_field", "item_badge_field", "empty_state" }` |
| Spec conventions | commons `spec/schemas/<name>.schema.json`, fixture `spec/fixtures/records/<name>.example.json`, Zod `spec/gen/ts/<name>.ts` (generated), Python `spec/gen/py/<name>_schema.py` (generated), tests `spec/tests/ts/{fixtures,record-validate,media-records}.test.ts` and `spec/tests/py/*`, index row in `spec/README.md` "Layout", entry in `spec/CHANGELOG.md`; shared defs are referenced as `"$ref": "<file>.schema.json#/$defs/<name>"` | current tag spec-v0.1.338 |
| Settings keys | spec `spec/settings/keys.json` (required `key, scope, selector, default, label, level, lives_in, honoured_by`; copy `copy.does` plus optional `does_child, does_teen`), `spec/settings/areas.json`; Home `backend/src/settings/audioKeys.ts` is the pattern (`SettingsKey.parse({...})`), registered in `backend/src/lib/settingsRegistry.ts` l.111; ahead-of-spec list `scripts/settings-ahead-of-spec.json` | |

## 2. TALENT-00: the spec (commons, then one Home pin)

Design: sections 2.2, 2.3, 2.4, 4.1, 4.2, 5. All additive. One commons worktree, one tag, one pin.

### 2.1 `spec/schemas/manifest.schema.json`: share the persona

1. Add a top-level `"$defs": { "persona": { ... } }` whose value is exactly the current `properties.companion` object (type object,
   `additionalProperties: false`, the same `required` `["display_name","formality","complexity","engagement","filler_density"]`, every
   property unchanged: `display_name, pronouns, tagline, backstory, interests, audience, behavior, examples_child, examples_teen,
   examples_adult, examples, voice_id, formality, complexity, engagement, filler_density, clock_style, hedging, social, status_phrases,
   style_adapters, look_prompt, status, review, animation`).
2. Replace `properties.companion` with `{ "$ref": "#/$defs/persona" }`. Nothing else in the file changes. `bun test` in `spec/` must stay
   green with no fixture change (same shape, new location).

### 2.1a `manifest.schema.json`: the optional `synth` block

Add an optional top-level property `"synth": { "$ref": "synth.schema.json#/$defs/meta" }` (the root keeps `additionalProperties:
false`). `meta` is defined in 2.2 below: everything a synth has beyond its persona. A manifest without it is a plain companion package.

### 2.2 New `spec/schemas/synth.schema.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "synth.schema.json",
  "title": "Synth",
  "description": "An artificial being: one personality with a voice, a look, an audience and a life. A companion is a synth assigned to a person; a cast entry is a synth assigned to a part (talent-2026-11-07.md section 2).",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "persona", "based_on", "life", "owner_person_id", "subject_id", "pins", "phrase_sources", "forked_from", "private_to", "provenance", "created_at", "updated_at", "hlc"],
  "$defs": { "meta": { "type": "object", "additionalProperties": false,
    "required": ["based_on", "life", "owner_person_id", "subject_id", "pins", "phrase_sources", "forked_from", "private_to", "provenance", "created_at", "updated_at", "hlc"],
    "properties": { "based_on": { "$ref": "#/properties/based_on" }, "life": { "$ref": "#/properties/life" }, "subject_id": { "$ref": "#/properties/subject_id" },
      "pins": { "$ref": "#/properties/pins" }, "phrase_sources": { "$ref": "#/properties/phrase_sources" }, "forked_from": { "$ref": "#/properties/forked_from" }, "private_to": { "$ref": "#/properties/private_to" }, "owner_person_id": { "$ref": "#/properties/owner_person_id" }, "provenance": { "$ref": "#/properties/provenance" },
      "created_at": { "$ref": "#/properties/created_at" }, "updated_at": { "$ref": "#/properties/updated_at" }, "hlc": { "$ref": "#/properties/hlc" } } } },
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{0,39}$", "description": "The companion package or household companion id (hc-...)." },
    "persona": { "$ref": "manifest.schema.json#/$defs/persona" },
    "pins": { "type": "object", "additionalProperties": false, "required": ["dials", "examples"], "default": { "dials": [], "examples": [] },
      "properties": { "dials": { "type": "array", "items": { "type": "string" }, "default": [] }, "examples": { "type": "array", "items": { "type": "string" }, "default": [] } },
      "description": "What the researcher must not overwrite (TALENT-13, TALENT-14)." },
    "phrase_sources": { "type": "object", "additionalProperties": { "type": "string", "format": "uri" }, "default": {}, "description": "For a synth based on a real person: each known phrase in persona.examples to the page it came from (TALENT-14)." },
    "forked_from": { "type": ["string", "null"], "pattern": "^[a-z0-9][a-z0-9-]{0,39}$", "default": null, "description": "The base synth this one was copied from when a person made it their companion (design 2.3). Null for a base." },
    "private_to": { "type": ["string", "null"], "pattern": "^person-[a-z0-9]{6,}$", "default": null, "description": "Set on a companion fork: only this person (and a parent or admin for a minor) may see or use it. Null means household-wide by audience." },
    "subject_id": { "type": ["string", "null"], "pattern": "^msub-[a-z0-9]{6,}$", "description": "The saved subject that is this synth's look for pictures and films; null until one is made." },
    "based_on": {
      "type": "object", "additionalProperties": false, "required": ["kind"],
      "properties": {
        "kind": { "type": "string", "enum": ["none", "household_member", "real_person"] },
        "person_id": { "type": ["string", "null"], "pattern": "^person-[a-z0-9]{6,}$", "default": null, "description": "Required when kind is household_member." },
        "name": { "type": ["string", "null"], "maxLength": 120, "default": null, "description": "The real name when kind is real_person; always shown as Based on <name>. persona.display_name defaults to it and may differ (Donnie for a synth based on Donald Trump)." },
        "refresh": { "type": ["string", "null"], "enum": ["1d", "7d", null], "default": "7d", "description": "How often the researcher refreshes a real person's history; null means never after the first run." },
        "minor": { "type": "boolean", "default": false, "description": "Set by the researcher when a real person's dated birth fact makes them under 18; carried into the CSAM check (rule 10). Never set by hand." }
      }
    },
    "life": {
      "type": "object", "additionalProperties": false, "required": ["enabled"],
      "properties": {
        "enabled": { "type": "boolean", "description": "False keeps the synth static. Always false when based_on.kind is not none." },
        "seed": { "type": "string", "maxLength": 200, "default": "" }
      }
    },
    "owner_person_id": { "type": "string", "pattern": "^person-[a-z0-9]{6,}$" },
    "provenance": { "type": "string" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" },
    "hlc": { "type": "string", "pattern": "^[0-9]+:[0-9]+:[a-z0-9]{6,}$" }
  }
}
```

Cross-field rule in `spec/records/ts/validate.ts` (and the Python mirror `spec/records/py/validate.py`): `based_on.kind ==
"household_member"` requires `person_id`; `"real_person"` requires `name` (its audience is the maker's choice, default `adult`; owner
ruling 2026-11-07); `kind != "none"` requires `life.enabled == false`. Fixture `spec/fixtures/records/synth.example.json`: an invented synth (`kind: none`, `life.enabled: true`,
`seed: "Just moved to the coast, learning to sail."`).

### 2.3 Additive fields on existing records

- `media-subject.schema.json`: `"synth_id": { "type": ["string","null"], "pattern": "^[a-z0-9][a-z0-9-]{0,39}$", "default": null }`.
- `made-artist.schema.json`: on each `members` item, `"synth_id"` with the same shape.
- `media-production.schema.json`: in `$defs.cast` add `"synth_id"` (same shape, default null) and `"part": { "type": ["string","null"],
  "enum": ["anchor","reporter","host","co_host","guest","moderator","side","critic","dj","narrator","announcer","actor",null], "default": null }`;
  `subject_id` stays required (a synth's cast entry carries the synth's `subject_id`; TALENT-09 makes one on first need). At the top
  level add `"show"`:

```json
"show": { "type": ["object","null"], "default": null, "additionalProperties": false,
  "required": ["format_id", "audience", "household_facts", "sources", "schedule", "length_s"],
  "properties": {
    "format_id": { "type": "string", "enum": ["news_briefing","kids_news","round_table","debate","review","discussion","dj_links","narration","announcer"] },
    "audience": { "type": "string", "enum": ["all","teen","adult"] },
    "household_facts": { "type": "boolean" },
    "sources": { "type": "array", "uniqueItems": true, "items": { "type": "object", "additionalProperties": false, "required": ["kind"],
      "properties": {
        "kind": { "type": "string", "enum": ["news","weather","household","documents","media_item","bookmarks"] },
        "topics": { "type": "array", "items": { "type": "string", "maxLength": 60 }, "default": [] },
        "file_ids": { "type": "array", "items": { "type": "string", "pattern": "^file-[a-z0-9]{6,}$" }, "default": [] },
        "media_item_id": { "type": ["string","null"], "default": null }
      } } },
    "schedule": { "type": ["object","null"], "default": null, "additionalProperties": false, "required": ["every","at"],
      "properties": { "every": { "type": "string", "enum": ["1d","7d"] }, "at": { "type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$" }, "days": { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 6 }, "default": [] } } },
    "length_s": { "type": "integer", "minimum": 60, "maximum": 1800 },
    "state": { "type": ["object","null"], "default": null, "additionalProperties": false,
      "properties": { "episode_id": { "type": "string" }, "stage": { "type": "string", "enum": ["brief","outline","script","check","voices","mix","keep","done","failed"] }, "reason": { "type": ["string","null"] }, "started_at": { "type": "string", "format": "date-time" }, "last_make_ms": { "type": ["integer","null"], "default": null } } },
    "stand_in_synth_id": { "type": ["string","null"], "default": null }
  } }
```

- `media-source.schema.json`: `kind` enum gains `"production"`; add `"production_id": { "type": ["string","null"], "pattern": "^mprd-[a-z0-9]{6,}$", "default": null }`.
- `stack-job.schema.json`: the `kind` description's media job list gains `media.tts` (already listed) and `media.mix`.
- `generation-provenance.schema.json`: `kind` enum gains `"show"`; the description line names it ("a made episode of a show").
- `memory-record.schema.json`: no change (scope `companion` and `companion_id` exist).

### 2.4 New `spec/schemas/show-format.schema.json`

```json
{ "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "show-format.schema.json", "title": "ShowFormat",
  "type": "object", "additionalProperties": false,
  "required": ["id","label","parts","structure","length_s","talk_over","gap_ms","sources_allowed","min_audience","substitute","stingers","words_per_minute","first_app"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z_]+$" },
    "label": { "type": "string", "maxLength": 40 },
    "parts": { "type": "array", "minItems": 1, "items": { "type": "object", "additionalProperties": false, "required": ["id","label","min","max","leads","dials"],
      "properties": { "id": { "type": "string" }, "label": { "type": "string" }, "min": { "type": "integer", "minimum": 0 }, "max": { "type": "integer", "minimum": 0 }, "leads": { "type": "boolean" },
        "dials": { "type": "object", "additionalProperties": false, "properties": {
          "formality": { "enum": ["casual","neutral","formal"] }, "complexity": { "enum": ["simple","standard","advanced"] }, "engagement": { "enum": ["brief","balanced","curious"] },
          "filler_density": { "enum": ["none","light","frequent"] }, "clock_style": { "enum": ["formal","plain","loose"] }, "hedging": { "enum": ["low","medium","high"] },
          "social": { "type": "object", "additionalProperties": false, "properties": { "humor": { "enum": ["low","medium","high"] }, "warmth": { "enum": ["low","medium","high"] }, "initiative": { "enum": ["low","medium","high"] } } } } } } } },
    "structure": { "type": "array", "minItems": 1, "items": { "type": "object", "additionalProperties": false, "required": ["kind","share"],
      "properties": { "kind": { "enum": ["hook","intro","segment","exchange","closing"] }, "share": { "type": "number", "exclusiveMinimum": 0, "maximum": 1 }, "repeat": { "type": "boolean", "default": false } } } },
    "length_s": { "type": "object", "additionalProperties": false, "required": ["min","default","max"], "properties": { "min": { "type": "integer" }, "default": { "type": "integer" }, "max": { "type": "integer" } } },
    "talk_over": { "enum": ["none","light","lively","heated"] },
    "gap_ms": { "type": "integer", "minimum": 0, "maximum": 2000 },
    "sources_allowed": { "type": "array", "items": { "enum": ["news","weather","household","documents","media_item","bookmarks"] } },
    "min_audience": { "enum": ["all","teen","adult"] },
    "substitute": { "enum": ["stand_in","skip"] },
    "stingers": { "type": "boolean" },
    "words_per_minute": { "type": "integer", "minimum": 100, "maximum": 220 },
    "first_app": { "type": "string" }
  } }
```

### 2.5 Settings keys (spec `spec/settings/keys.json`, area `spec/settings/areas.json`)

Five keys, each with `copy.does` and `copy.does_child`, `copy.does_teen` (plain words, grade 6), `honoured_by: ["home"]`, `lives_in:
"synths"` (a new section in the Companions area, renamed Synths by TALENT-13):

| key | scope | selector | default | level | label |
|---|---|---|---|---|---|
| `talent.shows.enabled` | household | boolean | true | basic | Made shows |
| `talent.life.enabled` | household | boolean | true | basic | Synths have lives |
| `talent.minors.make` | household | boolean | true | advanced | Children and teens can make shows |
| `synths.of_me` | person | boolean | true | basic | Synths can be based on me |
| `synths.real_people` | person | select `off \| ask \| all` | ask | basic | Synths based on real people |
| `synths.real_people_allowed` | person | entity (a list of synth ids) | [] | advanced | Real-person synths a parent allowed |

`synths.of_me`'s copy: `does_child` and `does_teen` say a parent sets it. `synths.real_people` is a parental control in the exact shape of
the precedent in RULES.md rule 0: a per-band user default (`ask` for child and teen, `all` for adults, where it is never shown), an
admin's global default, a per-person override by a parent or admin, and the child or teen never writes it (the key's `self_service` is
false for the child and teen bands); a child's band never offers `all` (`band_default` and the range for the child band are `off |
ask`); its `copy.does_child` and `copy.does_teen` say a parent decides it. `synths.real_people_allowed` is the lasting-yes list: written
only by the Ask's Allow (below) and by a parent on the child's Settings page, never by the minor. The who-sets-it text lives in `copy`, never in the label (rule S5).

### 2.6 Wrap up the commons slice

`spec/README.md` Layout rows for `synth` and `show-format`; `spec/CHANGELOG.md` entry; fixtures for both records; `media-records.test.ts`
gains a production with `show` and a source with `kind: production`; regenerate TS and Python; `bash scripts/check.sh`; tag; pin in Home.
Home side of the pin: `backend/src/lib/settingsRegistry.ts` picks the five keys up from the spec; nothing else.

## 3. TALENT-01: a synth's life

Design: sections 2.2 (where synths live), 3.1 to 3.4. Home only. After TALENT-00.

### 3.1 Migration `backend/src/db/migrations/<next>_memory_companion_id.sql`

```sql
ALTER TABLE memory_records ADD COLUMN companion_id TEXT;
CREATE INDEX memory_records_companion_idx ON memory_records (companion_id, status) WHERE companion_id IS NOT NULL;
```

`db/schema.ts` `memoryRecords`: add `companionId: text("companion_id")`. Follow the migration numbering and the drizzle snapshot
convention the newest migration in the folder uses.

### 3.2 The synth store: `backend/src/lib/synths.ts` (new)

```ts
import type { Synth } from "@maipai/spec/gen/ts/synth.js";
export type SynthRecord = Synth;
export function listSynths(actor: PersonRow): SynthRecord[]         // household + bundled synths the actor may use (mayUseCompanion on persona; and, for a child or teen, no real-person synth when their `synths.real_people` is off, read with the per-person settings reader the other parental keys use), minus forks private to someone else unless canManage(actor, thatPerson) && speakerAgeBand(thatPerson, now) != "adult" (lib/personLifecycle.ts l.122; an adult's private fork is never listed to an admin, rule 6a), newest first
export function forkSynth(actor: PersonRow, baseId: string): WriteResult   // "Make it mine": calls the existing copier (copyBundledCompanion or copyHouseholdCompanion, extended with options { keepAudience: true, keepStatus: true, copyLook: true, synth: { forked_from: baseId, private_to: actor.id, owner_person_id: actor.id, life: base.life, based_on: base.based_on, pins: base.pins, subject_id: null } }); never a second copier; writes one durable beat "<base display name>'s life so far: ..." from synthCard(base) as the fork's first beat; sets persona.active_id for the actor to the fork; refused when the actor may not use the base (the same sentence the companion picker uses)
export function shareFork(actor: PersonRow, id: string): WriteResult       // the fork's owner, or canManage(actor, owner) when the owner is a child or teen: clears private_to (the fork becomes a household synth)
export function requestSynthAccess(actor: PersonRow, id: string): AskResult   // child or teen at "ask": creates one Ask on the existing Ask record (notifications-and-asks-2026-10-17.md; the same record and parent surface KID-MODE-06 uses), kind "synth.real_person", summary "<child name> wants to talk with <synth display name>, a synth based on <based_on.name>", one open Ask per child and synth; the parent's Allow appends id to that child's `synths.real_people_allowed` (a lasting yes), Deny closes it; the child sees "Asked your parent" through the existing ask status on the synth page; never for an adult or a synth the actor may already see
export function isCompanionFork(id: string): boolean                      // forked_from != null AND (some person's persona.active_id equals id); a base someone picked directly before forks existed keeps working as today and is not a fork (it ticks only when on air)
export function getSynth(actor: PersonRow, id: string): SynthRecord | null
export function synthById(id: string): SynthRecord | null            // no gate; for jobs
export function maySeeSynth(actor: PersonRow, synth: SynthRecord, now = new Date()): boolean
// THE one gate (architect, 2026-11-07): mayUseCompanion(actor, synthPersona(synth)) AND (synth.private_to is null OR equals actor.id OR
// (canManage(actor, personById(private_to)) AND speakerAgeBand(that person) != "adult")) AND (based_on.kind != "household_member" OR that
// person's `synths.of_me` is on) AND (based_on.kind != "real_person" OR speakerAgeBand(actor) == "adult" OR actor's `synths.real_people` == "all" OR (it is "ask" AND synth.id is in actor's `synths.real_people_allowed`)).
// A real-person synth that fails only the last clause while `synths.real_people` is "ask" is "askable": `getSynth` returns it with
// `pending_ask: true` and nothing else (no beats, no chat, no fork), and `requestSynthAccess(actor, id)` below sends the Ask.
// Used by listSynths, getSynth, forkSynth, shareFork, the Chat and @mention paths (`conversationPersona` and `mentionedConversationPersona`
// in turnNext.ts l.1071 to l.1084 call it after mayUseCompanion), createShow's cast check, the robot pick, and the read gate of 15.7.
export function synthPersona(synth: SynthRecord): Persona | null      // personaFromManifest(id, manifestOf(synth), true /* allowDraft */); null means the manifest is broken: jobs skip the synth, routes answer 404
export function synthFloor(synth: SynthRecord): AgeBand               // companionFloor(synth.persona.audience)
export function createSynth(actor: PersonRow, input: { persona: Companion /* @maipai/spec/gen/ts/manifest.js, the type createHouseholdCompanion takes */; based_on: Synth["based_on"]; life: Synth["life"] }): WriteResult
export function updateSynth(actor: PersonRow, id: string, patch: Partial<Pick<SynthRecord,"persona"|"based_on"|"life"|"subject_id">>): WriteResult
```

- Storage: the household companion folder. `manifest.json` gains the optional top-level `synth` block (TALENT-00 section 2.1a adds it
  to the manifest schema, whose root has `additionalProperties: false`): `{ based_on, life, subject_id, owner_person_id, pins, phrase_sources,
  created_at, updated_at, hlc, provenance }`. `householdCompanions.ts` `write()` keeps validating with `PackageManifest.safeParse`, so
  the block survives a write only once the pin carries it. `owner.json`: `createHouseholdCompanion` stops writing it;
  `householdCompanionAuthorId(id)` (l.73, called from `companionsApp.ts` l.157, l.166, l.199) reads `synth.owner_person_id` first and,
  when the manifest has no `synth` block yet, reads `owner.json`, writes the block into the manifest and deletes `owner.json` (migrate
  on first read). Its callers do not change. At boot, `index.ts` runs `migrateOwnerJsonAll()` from `householdCompanions.ts` once over
  every `hc-` folder so no `owner.json` is left after the first start (architect condition 12).
- A bundled or catalog companion (no household folder) is a synth with `based_on.kind: "none"`, `life.enabled: true`, `seed: ""`,
  `owner_person_id` the household owner, `subject_id: null`, `forked_from: null`, `private_to: null`; its life beats are stored by its
  package id. Picking it as a companion forks it (`forkSynth`), so a package synth itself never carries rapport.
- Rule: `createSynth` defaults `persona.audience` to `"adult"` when `based_on.kind == "real_person"` (the adult maker may choose
  `teen` or `all`; owner ruling 2026-11-07, SAFETY amended for synths) and sets `life.enabled = false` when `based_on.kind != "none"`; a
  child or teen actor cannot create a synth with `based_on.kind != "none"` (error: "Only an adult can base a synth on a real person.
  Make an invented one instead."). `createSynth` and `forkSynth` refuse a `household_member` base whose person has the setting
  `synths.of_me` off ("<name> has turned off synths of them."), and `listSynths`, casting and chat skip such synths while it is off
  (owner ruling 2026-11-07: no prompt, a switch).
- `createSynth` writes the origin (3.4) when `life.enabled`.

### 3.3 Memory: the `companion` scope

`backend/src/lib/memory.ts`:
- `ListOptions.scope` gains `"companion"`; `ListOptions.companionId?: string`. `RememberInput.companion_id?: string | null`.
- `assertCanWrite`: scope `companion` is allowed only when `source` starts with `talent.` (the jobs, and the `POST /{id}/life` route,
  which writes `talent.life`); never by role alone, so no chat path can write a shared beat (architect condition 3). It requires
  `companion_id`.
- `canRead`: new branch before `household`: scope `companion` returns false unless `record.companionId` is set, the actor may use that
  synth (`mayUseCompanion(actor, synthPersona(synthById(id)))`, false when the synth is gone, and false when the synth's `private_to` is
  set to someone else unless `canManage(actor, thatPerson) && speakerAgeBand(thatPerson, now) != "adult"`; a manager reads a minor's
  fork's beats, never the person's rapport, which is `scope: person` and keeps its own gate; an adult's private fork is readable by
  nobody else, rule 6a) and the band check on `childDisclosure` passes
  exactly as the household branch does.
- `list` and `recall` filter `companion_id = opts.companionId` when scope is `companion`; recall never mixes companion records into a
  person or household query.
- Export a small helper for the jobs: `rememberBeat(synthId: string, actor: PersonRow, beat: { text, category, tier, source, valid_from?,
  valid_to?, importance? }): MemoryOpResult<MemoryRecord>` that sets `scope: "companion"`, `companion_id`, `child_disclosure` from the
  synth's audience (`all` gives `child_ok`, `teen` gives `teen_ok`, `adult` gives `adult_only`), and **first runs
  `evaluateReply({ text: beat.text }, synthFloor(synth))` and refuses (returns a `MemoryOpResult` error 422) when the action is `refuse`**
  (architect condition 4).

### 3.4 The origin and the card: `backend/src/lib/talent/life.ts` (new)

```ts
export const LIFE_SOURCE = "talent.life";
export async function writeOrigin(synth: SynthRecord, actor: PersonRow, complete = completeBackground): Promise<number>  // returns beats written
export async function tickLife(synth: SynthRecord, actor: PersonRow, today: string, complete = completeBackground): Promise<"beat" | "none" | "skipped">
export function activeBeats(synthId: string, actor: PersonRow, now = new Date()): MemoryRecord[]   // list(actor, { scope: "companion", companionId }) filtered valid now
export function synthCard(synthId: string, actor: PersonRow, now = new Date()): string               // renderProfileCard over the synth's records
```

- `writeOrigin`: one `completeBackground` call with `thinking: false, dropReasoning: true, temperature: 0.7, max_tokens: 900` and the
  schema `ORIGIN_SCHEMA = z.object({ born_year: z.number().int(), hometown: z.string().max(60), occupation: z.string().max(80), events:
  z.array(z.object({ date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/), text: z.string().max(140) })).min(3).max(5), memories:
  z.array(z.object({ date: z.string(), text: z.string().max(160) })).min(2).max(3) })`. System prompt, verbatim:

  > You write the life so far of a fictional person for a family app. You are given their name, backstory, interests and the audience
  > (all ages, teen or adult). Return only the JSON asked for. Rules: the birth year makes them an adult (at least 21 years old today)
  > unless the backstory says otherwise; events are small and ordinary (a move, a job, a trip, a friendship, a hobby milestone), dated,
  > in the past, none this month; memories are told the way a person tells them, in the first person, one sentence each; nothing about
  > real public events, real companies, illness, money trouble, or anything an audience of all ages should not hear; do not repeat the
  > backstory, extend it.

  Each event becomes `rememberBeat` with `category: "event", tier: "durable", valid_from: <date>`; born year and hometown and occupation
  become three `category: "identity"` durable beats; each memory becomes `category: "event", tier: "episodic"`. Source `talent.life`.
  The seed, when set, becomes a durable `state` beat with `valid_from` today.
- `tickLife`: skipped when `life.enabled` is false, when the synth already has a beat with `source == "talent.life"` dated today, or when
  the household key `talent.life.enabled` is false. Otherwise one call with the schema `TICK_SCHEMA = z.object({ beat: z.union([z.null(),
  z.object({ kind: z.enum(["plan","outcome","mood","person","absence"]), text: z.string().max(160), from: z.string(), to: z.string().nullable() })]) })`
  and the system prompt, verbatim:

  > You keep a fictional person's life moving one small step at a time for a family app. You are given today's date, their backstory, and
  > their current life (dated lines). Return only the JSON asked for. Most days return null. About one day in five return one small
  > development: a plan with a date, the outcome of an earlier plan, a passing mood, a person they mention, or, about one day in twenty,
  > an absence (a trip or a few days away) with a return date within seven days. Never contradict a current line; never mention real news,
  > real companies, illness, money trouble, politics or anything an audience of all ages should not hear; keep it the kind of thing a
  > coworker would mention in passing.

  A `plan` or `absence` beat gets `valid_from: from`, `valid_to: to`, `category: "state"`, `tier: "episodic"`; an `absence` beat is written with `source: "talent.life.absence"` (the kind lives in the code-owned `source`, never in the text, so
  a person or the model cannot fake one by typing "Away:"; principle 4); the show brief recognises an absence by that source and its
  span. Before writing, the new text is embedded (`embedQueryForRecall`) and compared with `similarByVector` against the synth's records;
  a cosine above 0.92 means "already said" and the tick returns `"none"`.
- `synthCard`: build `ProfileCard { ruleLine: "<display_name>'s life so far:", lines }` from the synth's active beats ordered importance
  then newest, `isProfileCardCategory` widened for this call to identity, event, state and relationship, cut at
  `PROFILE_CARD_MAX_LINES` and `PROFILE_CARD_MAX_CHARS`, then `renderProfileCard`. Never stored.

### 3.5 Jobs and chat

- `lib/scheduler.ts` `CORE_JOBS["talent.life.tick"]`: for every synth from `listHouseholdCompanionIds()` plus the bundled companion ids
  with `life.enabled` **that is on air or is a companion fork** (`isOnAir(synthId)`: cast on at least one Production whose `show.schedule`
  is not null; `isCompanionFork(synthId)` (true forks only: `forked_from != null`); both derived, never stored; architect condition 17 widened by the owner on 2026-11-07: a
  companion lives whether or not it is cast; until TALENT-04 exists only companion forks tick), run `tickLife(synth, ownerActor(synth), localDayKey(now, hubTimeZone()))`, sequentially, catching and counting
  errors; log `talent.life.tick synths=<n> beats=<n> ms=<n>`. `index.ts`: `ensureCoreJob("talent.life.tick", "every:1d");` beside the
  memory jobs (l.185).
- `lib/turnMachine/nodes/context.ts` beside l.381: when `state.persona.id` is a synth with any companion records, push one item
  `{ id: "synth-card", text: synthCard(...) }` and up to four `recall(actor, utterance, { scope: "companion", companionId })` matches as
  `synth-<id>`, into the persona context (the same `items` array; mark them with the same kind the profile card uses so `messages.ts`
  places them with the persona).
- Chat with a synth based on a minor (a household child or teen, or `based_on.minor` from the researcher): the turn's delivery
  check runs the same dedicated CSAM line check the shows use (`contentChecksForFold(foldForSafety(reply)).adultContent`, build 4.4) on
  the reply when the conversation's persona is such a synth, fails closed, and never adds any other block (rule 10, design 2.2 "on
  every surface"); it is wired where `turnNext.ts` applies `evaluateReply` to the reply, keyed on the resolved synth's `minor` fact.
- Routes in `routes/companions.ts`: `GET /{id}/life` (the beats the actor may read, newest first, with `id, text, at, valid_from,
  valid_to, source`), `POST /{id}/life` (owner or admin, body `{ text, date }`, writes through `rememberBeat` with source `talent.life`),
  `DELETE /{id}/life/{recordId}` (the memory "forget" path for that record).

### 3.6 Tests: `backend/tests/talentLife.test.ts`

Scripted `completeBackground` (the `planFilm` `testCompleter` pattern). Cases: (1) `createSynth` for an invented synth writes 3 identity
beats, 3 to 5 events and 2 to 3 memories, all `scope companion` with the synth's id, `child_disclosure child_ok` for audience `all`; (2) a
beat with `valid_from` yesterday and `valid_to` tomorrow is in `activeBeats`, one that ended yesterday is not; (3) a child actor reads
only `child_ok` beats of a synth with audience `all` and nothing of an adult synth; (4) a scripted tick returning a text that
`evaluateReply` refuses at the child floor is not written and the function returns `"none"`; (5) a tick on a day that already has a beat
returns `"skipped"`; (6) `synthCard` output is at most 8 lines and 400 characters; (7) a chat turn with the synth as companion carries the
`synth-card` item (use the context node test pattern in `tests/` for the turn machine); (8) a `remember` with scope `person` and
`companion_id` set (COMP-05 rapport) is not returned by `list({ scope: "companion" })`; (9) `forkSynth` by a member makes a private
synth with `forked_from` the base, one durable first beat and `persona.active_id` set; another member cannot list or read it (404 and no
beats), a parent can when the member is a child (`canManage`), and the parent never reads the child's rapport; (10) a companion fork with no show ticks, a base synth with no show and no fork does
not.

## 4. TALENT-02: formats and the writer

Design: sections 5, 6. Home only. After TALENT-00 and 01.

### 4.1 The package and the formats

`backend/packages/talent/manifest.json`: `{ "id": "talent", "kind": "app", "name": "Talent", "min_role": "child", "offline": "full",
"description": "Makes spoken shows from the household's own news, weather and life." }` plus the fields the other bundled manifests
carry (copy `backend/packages/podcasts/manifest.json` and keep only what the manifest schema requires; no pages in this slice).

`backend/packages/talent/formats/<id>.json`, one per format, validated against `ShowFormat` at boot by `lib/talent/formats.ts`
(`loadFormats(): Map<string, ShowFormat>`, `formatById(id)`). Values:

| id | parts (id: min..max, leads) | structure (kind: share) | length_s min/default/max | talk_over | gap_ms | sources_allowed | min_audience | substitute | stingers | wpm | first_app |
|---|---|---|---|---|---|---|---|---|---|---|---|
| news_briefing | anchor 1..1 leads; reporter 0..2 | hook 0.05, intro 0.1, segment 0.7 repeat, closing 0.15 | 180/300/480 | none | 350 | news, weather, household | all | stand_in | true | 150 | news |
| kids_news | host 1..1 leads; sidekick 0..1 | hook 0.1, intro 0.1, segment 0.6 repeat, closing 0.2 | 120/180/300 | light | 300 | news, weather, household | all | stand_in | true | 140 | news |
| round_table | host 1..1 leads; co_host 1..2; guest 0..1 | intro 0.1, exchange 0.75 repeat, closing 0.15 | 480/900/1800 | lively | 180 | news, bookmarks, documents, media_item, household | all | skip | true | 180 | podcasts |
| debate | moderator 1..1 leads; side 2..2 | intro 0.1, exchange 0.8 repeat, closing 0.1 | 360/600/1200 | heated | 80 | news, documents, media_item | all | skip | true | 185 | podcasts |
| review | critic 1..2 (first leads) | intro 0.1, segment 0.75 repeat, closing 0.15 | 240/420/720 | light | 250 | media_item | all | stand_in | true | 170 | podcasts |
| discussion | host 2..2 (first leads) | intro 0.1, exchange 0.8 repeat, closing 0.1 | 360/600/1200 | lively | 180 | documents, media_item | all | skip | true | 175 | podcasts |
| dj_links | dj 1..1 leads | segment 1 | 10/20/40 | none | 0 | household | all | skip | false | 170 | music |
| narration | narrator 1..1 leads | segment 1 | 30/60/600 | none | 400 | documents | all | stand_in | false | 150 | films |
| announcer | announcer 1..1 leads | segment 1 | 5/10/30 | none | 0 | household | all | stand_in | false | 160 | games |

Dials per part (the register, applied as overrides on the synth's persona; architect condition 8): anchor and reporter `formality formal,
filler_density none, hedging low, clock_style formal, engagement brief, social.humor low`; kids host and sidekick `formality casual,
complexity simple, filler_density light, clock_style loose, social.warmth high`; round-table host, co_host, guest `formality casual,
filler_density light, hedging medium`; moderator `formality neutral, filler_density none, hedging low`; side `engagement curious,
hedging low, social.initiative high`; critic `formality neutral, engagement curious, hedging medium`; discussion host `formality casual,
engagement curious, complexity standard`; dj `formality casual, filler_density light`; narrator `formality neutral, filler_density none,
clock_style formal`; announcer `formality casual, engagement brief, filler_density none, social.humor medium`. A part's dials replace the
synth's for that episode only; the synth's record is never written.

Child variants: when the show's audience is `all`, `adaptPersonaToBand(persona, "child")` runs after the overrides (it never loosens),
and `talk_over` is lowered one step (`heated` to `lively`, `lively` to `light`); for `teen`, `heated` becomes `lively`.

### 4.2 Types: `backend/src/lib/talent/types.ts` (new)

```ts
export type Part = "anchor"|"reporter"|"host"|"co_host"|"guest"|"moderator"|"side"|"critic"|"dj"|"narrator"|"announcer"|"actor";
export interface CastMember { synth_id: string; part: Part; display_name: string; persona: Persona; voice: string; minor: boolean; absent: null | { text: string; back: string | null } }
// minor: true when based_on.kind == "household_member" and that person's role is child or teen (speakerAgeBand != "adult"), or when based_on.kind == "real_person" and the researcher's facts say the person is under 18 (synth.based_on.minor, set by the researcher from a dated birth fact, never from the display name); it is carried into every prompt
// as the line "This synth is based on a minor." and into checkLines (architect condition 15, rule 10).
export interface Brief { show: Production; format: ShowFormat; cast: CastMember[]; audience: AgeBand; date: string; weekday: string; air_time: string;
  stories: Array<{ id: string; title: string; summary: string; points: string[]; publisher: string; published_at: string | null; topic: string | null }>;
  weather: string | null; household: string[]; documents: Array<{ title: string; text: string }>; item: { title: string; kind: string; description: string } | null;
  cards: Record<string, string>; beats: Record<string, Array<{ at: string; text: string }>>; recaps: Array<{ at: string; text: string }>; person_name: string | null }
export const OutlineSchema = z.object({ title: z.string().max(90), segments: z.array(z.object({ kind: z.enum(["hook","intro","segment","exchange","closing"]), goal: z.string().max(200), source_refs: z.array(z.string()).max(6), seconds: z.number().int().min(8).max(600), leads: z.string(), beats_to_use: z.array(z.string()).max(3) })).min(2).max(24) });
export const LineSchema = z.object({ part: z.string(), text: z.string().min(1).max(600),
  delivery: z.object({ energy: z.enum(["low","mid","high"]), pace: z.enum(["slow","mid","quick"]), tags: z.array(z.string().max(16)).max(2) }),
  timing: z.object({ gap_ms: z.number().int().min(0).max(2000).nullable(), overlap_ms: z.number().int().min(0).max(900).nullable(), cut_in_at_word: z.number().int().min(1).nullable(), talked_over: z.enum(["yield","continue"]).nullable(), backchannels: z.array(z.object({ part: z.string(), word_index: z.number().int().min(1), text: z.string().max(24) })).max(2) }) });
export const SegmentScriptSchema = z.object({ lines: z.array(LineSchema).min(1).max(60) });
export type Outline = z.infer<typeof OutlineSchema>; export type Line = z.infer<typeof LineSchema>;
export interface Script { title: string; segments: Array<{ kind: string; goal: string; lines: Line[] }> }
```

### 4.3 The brief: `backend/src/lib/talent/brief.ts`

`buildBrief(actor: PersonRow, show: Production, format: ShowFormat, now = new Date()): Promise<Brief>`:
- `cast`: each `show.cast[]` with `synth_id` resolved through `synthById`; `persona` = `synthPersona` with the part's dial overrides then
  `adaptPersonaToBand` for `all` and `teen`; `voice` = `voiceForSpeech({ actor: ownerActor, companionVoice: synth.persona.voice_id })` and,
  for audience `all` or `teen`, forced to a preset: if `!isPresetVoice(voice)` pick the first offered preset not used by another cast
  member (`getOfferedVoices()`); `absent` from the synth's active beats with `source == "talent.life.absence"` whose span covers today.
- `stories`: `releaseShelfItems(audience, 60)` filtered by the source's `topics` against `topicsOf(item)` (all when `topics` is empty),
  ranked by `published_at` newest first, cut at 12, each with `storedKeyPoints(id, audience)` or `summarizeStory(id, audience)` for the
  first 8 and the `summary` field for the rest. Only when `sources` has `news`.
- `weather`: `summaryFor(...)` built the way `lib/plugins.ts` l.750 builds it, only when `sources` has `weather`.
- `household`: only when `show.household_facts` and `sources` has `household`: `list(actor, { scope: "household" })` filtered by
  `canRead` for the audience band and not `sensitive` (the list already applies it for the actor; here the actor is the show's owner,
  so **re-filter by the show's audience band**: drop `teen_ok` for `all`, drop `adult_only` for `all` and `teen`), plus, **only when the
  show's `shared_to` is empty** (the owner's own show), `list(actor, { scope: "person", person: actor.id })` with the same band filter,
  `listLists(actor)` names and item counts, `listComingUp(actor)` within 7 days, formatted as one sentence each; capped at 12 lines
  (architect condition 5).
- `documents`: TALENT-08 fills this; here `[]`. `item`: TALENT-07; here `null`.
- `cards` and `beats`: `synthCard` and `activeBeats` per cast member (at most 8 beats each). `recaps`: the show's last three
  `talent.episode:<id>` beats across the cast (TALENT-04 writes them).
- `person_name`: `actor.displayName` when `shared_to` is empty, else null. `date`, `weekday`, `air_time` from `hubTimeZone()`.

### 4.4 The writer: `backend/src/lib/talent/writer.ts`

```ts
export async function writeOutline(brief: Brief, complete = completeBackground): Promise<Outline>        // schema output, one repair, then throws TalentWriteError("The outline could not be written. Try a shorter show or fewer topics.")
export async function writeSegment(brief: Brief, outline: Outline, index: number, complete = completeBackground): Promise<Line[]>
export async function writeScript(brief: Brief, complete = completeBackground): Promise<Script>          // outline then every segment in order, each segment call given the previous segment's last 6 lines
export function checkLines(lines: Line[], band: AgeBand, opts: { minorInCast: boolean }): { kept: Line[]; cut: number }   // evaluateReply per line; refuse -> cut
export function checkText(text: string, band: AgeBand): boolean                                          // one evaluateReply; false on refuse; used for titles, goals and invented persona text
```

Model options for every call: `thinking: false, dropReasoning: true, temperature: 0.8 (outline 0.5), max_tokens: 1800`, response_format
from `responseFormat(zodSchema, name)` as `plan.ts` does.

Outline system prompt, verbatim (the brief is appended as a JSON block after it):

> You are the producer of a short spoken show for one household. Plan the episode as JSON only, checked against the schema you are given.
> The format tells you the parts, the structure and the length in seconds. Size the segments so their seconds add up to within ten percent
> of the length. Each segment names what it is for, which sources it uses by id, how long it runs, which part leads it, and which of the
> cast's life lines (by id) it should touch, if any. Use only the sources in the brief. A cast member marked absent gets no segment to
> lead. If a cast member is marked returned, give the first exchange room for a short welcome back. The last segment of a scheduled show
> ends on tomorrow's hook. Title the episode in at most eight words.

Segment system prompt, verbatim (then the persona prompt of each cast member from `composePersonaPrompt(persona, "spoken")`, labelled by
part, then the brief's sources for this segment, the cast cards, the beats to use, the previous lines, and the segment's goal and seconds):

> You write the spoken lines of one segment of a show, as JSON only, checked against the schema. Rules. Use only the facts in the brief; a
> fact not in the brief is not said, opinion is fine and is the speaker's own. Quote outside voices as such ("the mayor said", "the paper
> reports"); never perform a real person who is not in the cast. No assistant phrasing, no "as an AI", no plugs, no sign-off except the
> show's own closing. People talk the way people talk: round numbers, hedges, a secondhand fact carries "they say" or "the report says",
> short acknowledgements. A reaction is one to six words. Interruptions: at most one in this segment when talk_over is light, two when
> lively, no cap when heated but each side keeps equal time and the moderator restores it. An interruption is written as timing.cut_in_at_word
> on the line being interrupted (the word number where the next speaker starts), overlap_ms between 250 and 700, talked_over yield when the
> speaker gives way or continue when they keep going under the other voice. A backchannel is a short word by another part under a long
> line at a word index. Mention a life line once, briefly, then move on; an absence is mentioned only in the first episode and on the
> return. A household fact is mentioned once, warmly, with no detail beyond the brief. The register is the part's; the personality is the
> speaker's. Write the words to be heard, not read: no headings, no lists, no URLs, no parentheses. Fit the seconds at the format's words per
> minute.

`checkLines`: for each line `evaluateReply({ text: line.text, speech: toSpokenText(line.text) }, band)`; when `opts.minorInCast` the
line gets the dedicated CSAM check with the minor known as a fact, the way pictures of a possible minor are checked: the line is cut
when `contentChecksForFold(foldForSafety(line.text)).adultContent` is true (`contentChecksForFold` from
`backend/src/lib/pictures/minorLine.ts` l.111; `foldForSafety` from `@maipai/spec/safety/ts/fold.js`, which `minorLine.ts` imports and
does not re-export) or when
`evaluateReply`'s result carries the `csam` category (`SafetyResult` has no `sexual` category; its categories are `self_harm,
harmful_request, credible_threat, csam, grooming, pii_extraction, prompt_injection, jailbreak`); a known minor plus sexual content is a
CSAM candidate (rule 10, architect condition 15); no other category ever cuts a line in an adult show (rule 0: an adult is never blocked
for ordinary content); when that check cannot run the line is cut (fails closed); `refuse` on the first pass cuts the line; `checkText` is run on the outline's
`title` and every segment `goal` at the show's audience before they are kept (a refused title becomes "Episode <date>", a refused goal
becomes "Segment <n>"; rule 10 covers every sentence a child sees, chapter titles included); a cut
line that carried a `cut_in_at_word` for the next line clears that timing on the next line. A segment with every line cut throws
`TalentWriteError("This segment could not be written for this audience. Pick other sources or a different format.")`.

### 4.5 Tests: `backend/tests/talentWriter.test.ts`

Scripted completer returning fixed JSON. Cases: (1) `loadFormats` loads all nine and each validates; (2) a `news_briefing` brief from a
seeded shelf (use the shelf store test helper the News tests use; if none, insert three `ShelfItem` rows directly) gives 3 stories with
points; (3) `writeOutline` with a scripted outline whose seconds sum to 300 passes, one summing to 500 for a 300 s show is repaired once
(second scripted reply) and a second bad reply throws `TalentWriteError`; (4) `writeSegment` output validates `LineSchema`; (5)
`checkLines` at the child band cuts a line the scripted `evaluateReply` refuses (stub `evaluateReply` through its module) and clears the
next line's `cut_in_at_word`; (6) a cast member with an active `talent.life.absence` beat is `absent` in the brief and the outline prompt text contains
`absent:`; (7) a shared show (`shared_to` non-empty) never includes `listLists` output in `household`; the owner's own show does; (8) an adult
show whose cast includes a synth based on a household child: a sexual line is cut by the minor check and a line about a violent news
story is kept (stub `contentChecksForFold` to return `adultContent: true` for the first and false for the second).

## 5. TALENT-03: the studio

Design: section 7. Stack first (two job kinds), then Home. After TALENT-00.

### 5.1 Stack: `media.tts` (batch lines) in `backend/src/media/tts.ts` (new) and `jobs.ts`

- `MEDIA_KINDS` gains `"media.tts"` and `"media.mix"`. Register: `registerJobRunner("media.tts", runTtsBatch, { generator: { role: "tts",
  memory: <the value recorded speech uses>, queueBehind: ["image","video","music"] } })` (copy the exact option shape from
  `backend/src/recordedSpeech/jobs.ts`).
- Input (zod): `{ lines: Array<{ id: string (1..40, pattern ^[a-z0-9_-]+$), text: string (1..4000), voice_url?: string, temperature?: number, pitch_semitones?: number (-12..12) }> (1..400), output: { dir?: string } }`.
- Runner: for each line in order, call the same internal function the `/v1/audio/speech` route uses to reach the engine (the function
  behind `routes/v1.ts` l.46; export it if it is not), write `<dir>/<id>.wav`, read the WAV header for `duration_s`, compute sha256,
  report `progress` per line. Result: `{ lines: Array<{ id, path, duration_s, sha256 }> }`. A failed line fails the job with the line id
  in `reason` ("Line <id> could not be spoken: <engine error>. Try again or change the voice.").
- Test `backend/src/media/tts.test.ts` with the engine stubbed: three lines produce three files with positive durations and the result
  order matches the input.

### 5.2 Stack: `media.mix` (an audio timeline) in `backend/src/media/mix.ts` (new)

Why a new kind: `media.edit` takes at most 24 inputs and writes only video or png; an episode has up to 400 clips and wants an audio file.
`media.mix` is the audio-only sibling in the same module, one ffmpeg filter graph.

- Input: `{ tracks: Array<{ path: string, start_ms: int >= 0, gain_db: number (-60..24) = 0, fade_in_ms: int = 0, fade_out_ms: int = 0, end_ms?: int }> (1..400), duck: { under: number[] (track indexes that duck the others), by_db: number = 8 } | null, loudness_lufs: number (-24..-12) = -16, output: { dir?: string, name: string matching \.(m4a|wav)$ }, chapters?: Array<{ start_ms, title }> }`.
- Runner: `ffmpeg -i <each track>` then a filter graph: per track `atrim` (when `end_ms`), `afade` in and out, `volume=<gain>dB`,
  `adelay=<start_ms>|<start_ms>`; `amix=inputs=N:normalize=0:dropout_transition=0`; when `duck` is set, the ducked tracks go through
  `sidechaincompress` keyed by the sum of the `under` tracks (same settings as `audio_overlay`'s duck: threshold 0.03, ratio 8); then
  `loudnorm=I=<lufs>:TP=-1.5:LRA=11`; encode AAC 160 kbps 48 kHz for `.m4a`, PCM for `.wav`; write `.part` then rename, as `runEdit` does.
  Chapters are written as ffmpeg metadata (`FFMETADATA` chapter blocks) for `.m4a`. Result: `{ path, duration_s, sha256 }`. Lane: the
  idle media lane with the `media.edit` deadline.
- Test `backend/src/media/mix.test.ts`: two 1-second sine WAVs made with ffmpeg in the test, track B at `start_ms: 500`: the output is
  about 1.5 s long; with `duck.under: [1]` the loudness of track A during B is lower than without (measure with `ffmpeg -af
  volumedetect` on a trimmed window). Skipped when ffmpeg is absent, with a printed reason.

### 5.3 Home: lines to clips: `backend/src/lib/talent/studio.ts`

```ts
export interface RenderedLine { line_id: string; part: string; clip_path: string; duration_ms: number; sha256: string; split?: { before: RenderedLine; after: RenderedLine } }
export interface EditTrack { path: string; start_ms: number; gain_db: number; fade_in_ms: number; fade_out_ms: number; end_ms?: number }
export function speakableText(line: Line, voiceTags: readonly string[]): string      // toSpokenText(line.text) -> planVoiceCues per the persona's filler dial -> sanitizeSpeechTags(text, voiceTags); delivery.tags appended where the engine lists them
export function splitAtWord(text: string, word: number): [string, string]
export async function renderLines(script: Script, cast: CastMember[], outDir: string, stack = stackClient()): Promise<RenderedLine[]>
export function layout(script: Script, rendered: RenderedLine[], format: ShowFormat): { tracks: EditTrack[]; chapters: Array<{ start_ms: number; title: string }>; total_ms: number }
export async function mixEpisode(tracks: EditTrack[], chapters, stingers: { intro: string | null; outro: string | null }, outPath: string, stack = stackClient()): Promise<{ path: string; duration_s: number }>
```

- `renderLines`: every line becomes one `media.tts` line `{ id: "<seg>-<n>", text: speakableText(...), voice_url: <cast voice>,
  pitch_semitones: <cast offset> }`; a line with `timing.cut_in_at_word` becomes two lines `<id>-a` and `<id>-b` from `splitAtWord`;
  backchannel texts are rendered once per part as `bc-<part>-<hash>` and reused. Lines are sent in batches of at most 400 per job, jobs
  submitted one at a time, polling `job(id)` every 2 s, `signal` aborts cancel the job. Between batches call the same idle wait films
  use (`engines.waitForIdle` pattern in `lib/films/engines.ts`): chat and pictures first.
- `layout` (section 7.3 of the design, exact numbers): cursor starts at 0; for each line in order: `start = cursor`; for a split line,
  place `-a` at `start`, the interrupter's clip at `start + dur(a) - overlap_ms` (default `overlap_ms` by `talk_over`: light 300,
  lively 450, heated 650; `none` ignores interruptions and renders the whole line), and `-b` either dropped (`yield`) or placed at
  `start + dur(a)` with `gain_db: -6`, `end_ms: min(dur(b), 1500)`, `fade_out_ms: 300` (`continue`); `cursor = end of the last placed
  clip + gap` where `gap = line.timing.gap_ms ?? format.gap_ms`; a backchannel at `word_index` is placed at `start + dur * (word_index /
  word_count)` with `gain_db: -10`. Chapters: one per outline segment at the first line's start, titled by the segment's goal cut at 60
  characters. `total_ms` is the end of the last clip.
- `mixEpisode`: stingers (when present) are tracks: intro at 0 with the first line pushed to `intro_dur - 1500` (all other starts shift
  by the same amount), `fade_out_ms: 1500`, and `duck.under` the speech tracks; the outro starts 1000 ms before the last line ends with
  `fade_in_ms: 800`. Submit one `media.mix` with `loudness_lufs: -16`, `output.name: "<episode id>.m4a"`.
- Cover: made once per show in `createShow` through `submitGeneration({ prompt: "<title>, podcast cover art, <format label>, flat
  illustration, no text, no people", size: "1024x1024", n: 1, audience: show.audience == "adult" ? "adult" : "all-ages", timeout_ms:
  120000 })`, polled with `getGenerationJob` and read with `fetchPicture(job, 0)`, stored with `storeFile(owner, { mediaType: "image/png",
  bytes, provenance: "show-cover:" + JSON.stringify({ v: 1, production_id }) })`, its file id first in the Production's
  `picture_file_ids`; the episode's `artwork` is `{ file_id }` of it, or null while the picture job has not finished (a cover never blocks
  an episode).
- Stingers: made once per show by TALENT-04 through `runGenerateMusic` (`instrumental: true, length: "quick"`, prompt "a <format label>
  show opening sting, <six style words from the show's title and format>, 6 seconds") and cut to 6 s by `media.mix` itself (`end_ms: 6000`, `fade_out_ms: 800` on that track), never by `media.edit` (it
  writes no audio); the stinger file id is kept on the Production's `music_line_ids`. Absent stingers mean no intro and outro; nothing waits for them.

### 5.4 Tests: `backend/tests/talentStudio.test.ts`

Stack client stubbed through `__setStackClientForTests` (a fake `submitJob` and `job` that return durations by text length, 60 ms per
word). Cases: (1) `splitAtWord("one two three four", 3)` gives `["one two", "three four"]`; (2) a two-line script where line 2 cuts into
line 1 at word 3 with `overlap_ms 400` and `yield` lays out `1-a` at 0, line 2 at `dur(1-a) - 400`, no `1-b`; (3) the same with
`continue` adds `1-b` at `dur(1-a)` with `gain_db -6` and `end_ms <= 1500`; (4) a backchannel lands at the proportional position with
`gain_db -10`; (5) gaps follow `format.gap_ms` and a line's own `gap_ms` wins; (6) chapters start where segments start; (7) `speakableText`
on a line with `[laugh]` keeps the tag for a voice that lists it and strips it for one that does not; (8) 401 lines go out as two jobs.

## 6. TALENT-04: the news briefing (the first thing heard)

Design: sections 4, 8, 9, 10. Home only. After TALENT-01, 02, 03.

### 6.0 Home columns the pin does not add

Migration `0183_productions_show.sql` (after TALENT-01's 0182; copy the SQL, the `meta/_journal.json` entry and the `meta/0183_snapshot.json`
the way 0181 did them, with the `backend/package.json` script that runs `drizzle-kit generate`):

```sql
ALTER TABLE media_productions ADD COLUMN show TEXT NOT NULL DEFAULT 'null';
ALTER TABLE media_sources ADD COLUMN production_id TEXT;
```

`db/schema.ts`: `show: text("show").notNull().default("null")` on `mediaProductions`, `productionId: text("production_id")` on
`mediaSources`. `lib/mediaProductions.ts`: `Production` gains `show: Show | null` (type from the pinned spec), `CastRole` gains
`synth_id: string | null` and `part: string | null`; `decode` (l.17) and the `persist` map (l.33) carry all three; `createMediaProduction`
and `updateMediaProduction` accept them; the `PATCH /{id}` route strips `show.state` from any body (only Home sets it) through a new
internal `setShowState(ownerPersonId: string, productionId: string, state: Show["state"]): void`; `validSubjectIds` (l.28) also accepts a
subject whose `synth_id` names a synth the actor may use (`mayUseCompanion`), so a show made by one member can cast a synth whose subject
another member owns. `lib/media/model.ts` `sourceFromRow` parses `kind: "production"` once the pin carries it: TALENT-00's pin lands
before this slice.

### 6.1 Shows: `backend/src/lib/talent/shows.ts`

```ts
export interface CreateShowInput { title: string; format_id: string; cast: Array<{ synth_id: string; part: Part }> | "invent"; audience?: "all"|"teen"|"adult"; sources: ShowSource[]; schedule: Schedule | null; length_s?: number; household_facts?: boolean }
export async function createShow(actor: PersonRow, input: CreateShowInput): Promise<Production>
export function listShows(actor: PersonRow): Production[]                    // listMediaProductions filtered show != null
export function getShow(actor: PersonRow, id: string): Production | null
export async function inventCast(actor: PersonRow, format: ShowFormat, show: Pick<CreateShowInput,"title"|"audience">, complete = completeBackground): Promise<Array<{ synth_id: string; part: Part }>>
export async function makeEpisode(actor: PersonRow, productionId: string, opts: { now?: Date; complete?; stack? }): Promise<{ episode_id: string; item_id: string }>
export function dueShows(now: Date): Array<{ production: Production; owner: PersonRow }>
```

- `createShow`: audience defaults to the actor's band (`speakerAgeBand`) and is never above it; a child or teen actor is refused when the
  household key `talent.minors.make` is false ("Shows are off for children and teens in this household. A parent can turn them on in
  Settings."); `household_facts` defaults true; `length_s` defaults to the format's default and is clamped; the Production is created
  with `createMediaProduction(actor, { title, summary: "", cast: <one entry per cast member: synth_id, part, role: part, subject_id:
  await ensureSubject(synth)>, show: { format_id, audience, household_facts, sources, schedule, length_s, state: null } })`.
  `ensureSubject(synth): Promise<string>` lives in `lib/synths.ts` and is built in this slice (section 11 then only adds the band and
  film callers): when `synth.subject_id` is null it calls `createMediaSubject(ownerActor(synth), { name: persona.display_name, kind:
  "character", look: persona.look_prompt ?? persona.display_name, referenceIds: [<the rest picture from readLook(id).rest stored through
  storeFile as image/png, when one exists>], real: synth.based_on.kind !== "none" })` (architect condition 13: `real` follows
  `based_on`), writes `subject_id` on the synth and `synth_id` on the subject, and never makes a second one (condition 10, principle 1);
  then, for every person in the show's `shared_to`, `shareMediaSubject(ownerActor(synth), subjectId, personId, true)`, repeated by
  `shareMediaProduction` when the show is shared later; a `media_sources` row is inserted the way `subscribePodcast` (`lib/media/podcasts.ts` l.287) inserts one: `id: newMediaSourceId()`
  (`lib/id.ts`), `kind: "production"`, `scope: "person"`, `owner_person_id: actor.id`, `label: title`, `production_id`, `visible_to: [actor.id,
  ...shared_to]` (never `"household"`: a show with an empty `shared_to` is the owner's alone, exactly as `canSeeProduction` reads it, and
  its brief reads the owner's own records; architect condition 5), `created_at`, `hlc: nextHlc()`, `provenance: "talent:show"`;
  `shareMediaProduction` keeps `visible_to` in sync (add that write to it); every cast synth must pass `maySeeSynth(actor, synth)` and `companionFits(audience floor, synthFloor)` or
  the call is refused naming the synth ("<name> is for adults and this show is for everyone. Pick another synth or make the show adults
  only.").
- `inventCast`: one schema call (`z.array(z.object({ part, display_name, pronouns, tagline, backstory, interests, dials... }))` sized by
  the format's `min` per part), system prompt:

  > Invent the people for a show. For each part you are given, create one fictional adult: a name that is not a real public figure's, a
  > tagline, a 300-character backstory, three interests, and the speaking dials (formality, complexity, engagement, filler_density,
  > clock_style, hedging, humor, warmth, initiative) that suit the part. Make the cast different from each other in age, background and
  > manner. Nothing about real people, companies or events.

  Each result's `display_name`, `tagline`, `backstory` and `interests` pass `checkText` at the show's audience (a refused field fails
  the whole invented cast with the error in section 15 item 34; rule 10), then becomes `createSynth(actor, ...)` with `based_on.kind:
  "none"`, `life.enabled: true`, `seed: ""`, audience = the show's, voice picked as 4.3 describes.
- `makeEpisode`: the stages of `show.state.stage` in order, each written to the Production before it runs so a crash resumes at it:
  `brief` (buildBrief), `outline` and `script` (writeScript), `check` (checkLines per segment), `voices` (renderLines into
  `<data>/talent/<production>/<episode>/`), `mix` (mixEpisode), `keep`: `storeFile(owner, { conversationId: null, turnId: null, mediaType:
  "audio/mp4", bytes, name: "<title>.m4a", provenance: "show:" + JSON.stringify({ v: 1, kind: "show", production_id, episode_id, format_id,
  synth_ids, model, engines: { tts: <engine id>, mix: "media.mix" }, made_at }) })`, then a media item built exactly the way `recordFor` (`lib/media/podcasts.ts` l.389 to l.429) builds one: `MediaItem.parse({ id:
  newMediaItemId(), kind: "podcast_episode", title: <episode title>, subtitle: <show title>, description: <the outline's goals joined>,
  source_id: <the production source id>, location: { file_id: <file id> }, locator_kind: "none", media_type: "audio/mp4", duration_s,
  playable: "original", artwork: <cover file id ? { file_id } : null>, chapters: [{ start_s, title, source: "manual" }], subtitles: [],
  previews: null, external: null, advisory: { explicit: audience == "adult", source: "platform" }, band_ok: audience == "adult" ? "adult" :
  audience == "teen" ? "teen" : "child", verified_by_person_id: null, hidden: false, added_at, created_at, hlc, provenance })` then
  `itemToRow(record, extras)` and `db.insert(mediaItems)`; `bandOkAtIngest` is not used, the band is set from the audience (architect
  condition 1); then `insertTranscript(owner, { itemId, language: "en", segments: <one per line: start and end in seconds from the
  layout's start_ms and duration_ms, text, speaker: the part>, provenance: <the store's Provenance with the source_kind for a transcript
  made in the home; if its enum has none, add "made" to it in this slice>, author: owner.id })`, the
  Production `episodes` gains `{ id: "ep-<YYYYMMDD local>-<6 random>", title, scenes: [one per outline segment, each with one shot `{ id:
  "<segment>-<n>", subject_ids: [the cast subjects in it] }` and no clip, picture or voice line ids: line clips are working files under
  `<data>/talent/...` and are deleted after `keep`; only the finished cut is a Library file] }` and `finished_cut_file_ids` gains the
  file id; then the "said on air" beats: for each cast member one `rememberBeat` written as `ownerActor(synth)` (never as the show maker, who
  may not own the synth) with `source: "talent.episode:<episode id>"`, `category: "event"`, `tier: "episodic"`, text from one more schema call ("In one sentence each, what did
  each cast member say about their own life in this script, if anything; null when nothing") so the next episode can follow through; the
  first episode of an absence writes "<name> was away; <lead> said so" for the lead. `state.stage` ends `done` or `failed` with a plain
  `reason`. Any failure leaves the stage name in `state` and is logged as `talent.episode stage=<stage> ms=<n> ok=false`.
- A minor whose `synths.real_people` is off never sees the episodes of a show that casts a real-person synth: `episodesOf`, the
  briefing route and `queryItems` for the `production` source kind skip those productions for that actor (the source row carries the
  production, and the cast is read once per request).
- `dueShows`: every Production with `show.schedule` where `localDayKey(now)` has no episode with that day in its id, the local time is
  past `schedule.at` minus the show's measured make time (`show.state` keeps `last_make_ms`; default 600000), and `days` is empty or
  contains today's weekday.

### 6.2 Jobs, routes, pages

- `CORE_JOBS["talent.shows.due"]`: for each `dueShows(now)` entry, when the household key `talent.shows.enabled` is true, run
  `makeEpisode(owner, production.id)` one at a time (a module-level promise guards against overlap); `index.ts`:
  `ensureCoreJob("talent.shows.due", "every:15m");`.
- `backend/src/routes/talent.ts` mounted at `/api/talent` (mount beside `mediaProductionsRoutes` in `app.ts`): `GET /formats`,
  `GET /shows`, `POST /shows` (CreateShowInput), `GET /shows/{id}`, `PATCH /shows/{id}` (title, schedule, sources, household_facts,
  length_s; owner only), `POST /shows/{id}/episodes` (make now; returns 202 with `{ production_id, stage }` and runs `makeEpisode` in the
  background), `GET /shows/{id}/episodes` (the media items of its source the actor may read), `GET /briefing/today` (today's episode of a briefing show the actor owns, else one shared to the actor, else `{ item: null, offer:
  true }`; never a show the actor cannot see).
- Podcasts package: the shows data is `showRows` in `lib/media/podcastApp.ts` (l.32, `case "shows"` at l.117, registered with
  `registerMediaAppData`); it filters `allowedSources(person)` to `kind === "feed"`: widen that filter to `feed` or `production`, and give a
  production row `copy_label: "Made here"` so `pages/shows.json`'s `media_shelf` block (`item_badge_field: "copy_label"`) shows the badge.
  `routes/podcastApp.ts` l.49 and l.72 also require `row.kind === "feed"`: widen them the same way. `episodesOf` filters by show title
  through `params.channel`; a production's `show.json` passes the same `channel` (the show title is the episode's `subtitle`, as above).
  For the owner, `show.json` adds a line with the schedule and a button whose action is `{"call": {"target": "/api/talent/shows/{id}/episodes",
  "args": {}}}` (the `call` form `backend/packages/news/pages/index.json` uses). New `pages/new-show.json`: the text input block
  `pages/search.json` uses, bound to state `title`, then one button per format (`news_briefing`, `kids_news`, `round_table`) whose
  `call` targets `/api/talent/shows` with `{ "title": "$state.title", "format_id": "<id>", "cast": "invent", "sources": [{"kind":"news"},
  {"kind":"weather"},{"kind":"household"}], "schedule": { "every": "1d", "at": "07:00" } }`; topics, time and cast are changed later
  through `PATCH /api/talent/shows/{id}` or the chat tool (TALENT-06). No picker or time block exists in package pages; do not invent
  one. Listed from `index.json` as "New show".
- News package: add `{ "id": "briefing", "refresh_s": 300 }` to the `data` array of `backend/packages/news/manifest.json` (l.447) and
  serve it from the handler that serves the news data id `today` (find it: grep `"today"` under `backend/src/lib/news` and
  `backend/src/routes`); it returns `GET /api/talent/briefing/today`'s answer. In `pages/index.json` (exists; it has no `list` block
  today) add at the top a `list` bound to `briefing` with one row when an item exists ("Listen to today's briefing") and, when `offer`
  is true, one row "Make me a morning briefing" with the `call` action above (`/api/talent/shows`). Playing: `pages/story.json` l.36's
  `{"play": {"media_id": "story"}}` names a data id, not an item id; read how that handler resolves `play` and give the briefing row the
  same mechanism (a data id `briefing_item` that returns the media item) so the news player plays a `podcast_episode` item through the
  shell's media host (`MediaHostProvider`) exactly as a podcast page does.
- Status: the Podcasts show page shows "Making today's episode" through the same progress row the media apps use for "one job's
  progress" (S6), fed by `show.state.stage` read with the page's own data load (the row the page already fetches), no polling loop and
  no new element.

### 6.3 Tests: `backend/tests/talentShows.test.ts` and `talentBriefing.test.ts`

Scripted completer, stubbed Stack (TALENT-03's fake), seeded shelf. Cases: (1) `createShow` by the owner with `cast: "invent"` creates
two synths (anchor plus reporter when the scripted cast has both), a Production with `show`, a `production` media source; (2) a child
actor with `talent.minors.make` false is refused with the exact message; a child with it true gets `audience: "all"`; (3) `makeEpisode`
runs every stage, stores a file with provenance kind `show`, a media item with `band_ok: "child"` for audience `all` and `"teen"` for
`teen`, chapters equal to the outline's segments, a transcript, and the Production episode with one shot per line; (4) a teen episode is
not returned by `queryItems` for a child actor (architect condition 1); (5) `dueShows(now)` with a fake clock returns a daily show at 07:00 at or after `06:50` local (07:00 minus the default make time of
10 minutes), not at 06:49, and not after an episode exists for the day; (6) a crash injected in the `mix` stage leaves `state.stage: "mix"` and a
second `makeEpisode` resumes from `mix` without calling the writer again (count completer calls); (7) the next day's brief carries the
"said on air" recap beats of the first episode; (8) `GET /api/talent/briefing/today` returns the owner's item, a shared show's item for a member it is shared to, and `offer: true`
for a member with neither; a member's own lists never appear in a shared show's brief. Exit by ear: the owner runs `bun run dev`, makes a briefing from
the seeded News shelf, and listens; judged in the preview before landing (AGENTS.md "Previewing a change").

## 7. TALENT-BENCH-01: the overlap and render-time bench

Design: section 7.5. Bench lane only (`check.sh --bench`), never the gate. Script `backend/scripts/bench/talent-overlap.ts`: takes a fixed
90-second round-table script (`backend/tests/fixtures/talent/round-table-90s.json`, written by hand, three parts, four interruptions,
six backchannels), renders it three ways on the real Stack: (a) `renderLines` plus `layout` with overlap, (b) the same with `talk_over:
none`, (c) the Stack's recorded speech with three speakers (adult only; three preset reference clips from the VOICES-02 set or the
household's own), and writes `data-scratch/talent-bench/<date>/{a,b,c}.m4a` plus `numbers.json` (`render_s_per_spoken_min` per engine,
`peak_memory_mb` from the Stack's job record, `total_s`). The listening test is Jesse's and two listeners'; the result is written to
`docs/design/talent-2026-11-07.md` section 7.5 as a dated line with the chosen base path, and section 8's tier numbers are filled from
`numbers.json`.

## 8. TALENT-05: round table and kids' news

Design: sections 3.3 (absences), 5, 7.1, 7.3. After TALENT-04 and the bench. Home only.

- `inventCast` for `round_table` (host plus two co-hosts) and `kids_news` (host plus sidekick); the voice picker guarantees three distinct
  voices (`pitch_semitones` offsets of +2 and -2 when the engine offers fewer presets than cast members, both on the `media.tts` line).
- Absences: `dueShows` and `makeEpisode` already read `absent`; this slice adds the `substitute` rule: `stand_in` formats get a stand-in
  synth made once per show (`inventCast` for the lead part, stored on `show.stand_in_synth_id`, additive spec field in TALENT-00's
  `show` block, nullable), `skip` formats skip the day and write a `talent.episode` beat "no episode this week" for the next brief.
- The bench's chosen path becomes the default `talk_over` handling in `layout`; if Drama 3 won for adults, add `renderExchange` for
  adult shows behind `show.audience == "adult"` and the Stack's recorded speech route; otherwise nothing.
- Tests `backend/tests/talentRoundTable.test.ts`: three scheduled episodes with a scripted life (B gets a `talent.life.absence` beat on day 2 with
  `valid_to` day 3): episode 1's script prompt carries B's "going away" beat, episode 2 casts without B and the lead's lines include the
  scripted mention, episode 3 carries `returned: B`; a `kids_news` show by a child is made at `band_ok: "child"` with `talk_over` lowered to
  `light`; a show whose every host is absent on a `skip` format writes the beat and makes no file.

## 9. TALENT-06: the `make_show` chat tool

Design: section 9 (the tool), architect conditions 6, 7, 9. After TALENT-04.

- `backend/packages/make_show/manifest.json`: copy `backend/packages/make_film/manifest.json`; `id: "make_show"`, `min_role: "child"`,
  `"offer": { "mode": "conditional", "gate": "showAllowed", "bench_row": "make-show-tool" }`.
- `backend/src/lib/talent/tool.ts`: `MAKE_SHOW_TOOL_ID = "make_show"`, `makeShowArgs = z.object({ idea: z.string().min(1).max(400),
  format_id: z.enum([...]).optional(), minutes: z.number().int().min(2).max(30).optional(), cast: z.array(z.string().max(60)).max(4).optional()
  /* synth display names */, daily_at: z.string().regex(/^\d{2}:\d{2}$/).optional(), go_ahead: z.boolean().optional() })`, `runMakeShow(...)`
  with the same shape as `runMakeFilm`: Plan (format and cast resolved, the card shows title, cast, length, schedule and waits for Go
  unless `go_ahead`), then `createShow` and `makeEpisode`; the result carries `production_id`, `item_id`, `stage`.
- Gate: `turnNext.ts` sets `state.showAllowed = talentShowsEnabled() && (band === "adult" || minorsMayMake()) && speechEngineReady() &&
  state.surface is the person's own written screen` (the same surface test `filmAllowed` uses; copy that line); `policy.ts` refuses
  with a plain line when the tool is called and `!state.showAllowed`; `budget.ts` `offerPassesGate` (l.184) is an explicit list of gate names, not a match by name: add a `showAllowed` clause to it. The video
  set cap rule in `budget.ts` l.230 counts `make_show` in the media set; the music set shrinks first.
- Card: `frontend/src/apps/chat/chatToolUis.tsx` `ShowToolRender` beside `FilmToolRender`: kit `JobProgress` with `stages: ["Brief",
  "Outline", "Script", "Check", "Voices", "Mix"]`, then the kit `Player` with `src=/api/media/items/{item_id}/content` and the title;
  actions Redo a segment (`POST /api/talent/shows/{id}/episodes/{episode}/redo` with `{ segment }`, which re-runs `writeSegment`,
  `renderLines` for that segment and `mixEpisode`), Make it daily (`PATCH` schedule), Change the cast (opens the Synths page). No Home
  wrapper; props only; the Player is registered as its own binding in `frontend/src/apps/chat/elementBindings.ts` the way
  `FilmPlayerToolRender` is.
- Bench row `make-show-tool` in `backend/tests/showTool.test.ts` (copy `filmTool.test.ts` l.30's shape): offered on a scripted turn whose
  model picks it, not offered on a spoken turn, not offered to a child when `talent.minors.make` is false.

## 10. TALENT-07 and TALENT-08: debate, review, discussion

- `brief.ts` `item`: from `sources[].media_item_id` through `queryItems` for the actor (title, kind, description, and for a podcast episode
  `storedTranscriptForItem(itemId)` cut at 6,000 characters); `documents`: each `file_ids` entry read through the Library file read the
  chat attachment path uses (the function in `lib/attachments.ts` that returns a file's text for the model; if none exists, the
  `pageHtml`-to-text reader in `lib/packageHost.ts` l.1888 `PageReadResult` for HTML and plain `readFileSync` for text), cut at 8,000
  characters per document and 24,000 in all, oldest cut first.
- `debate` adds to the segment prompt one line: "Two sides argue the question in the brief; each side keeps its position; the moderator
  gives equal time and sums up without picking a winner." `review` adds: "Flag a spoiler before it is said." `discussion` adds: "Walk
  through the material in order, question each other, and end with three things to remember."
- Tests `backend/tests/talentFormats.test.ts`: a `review` of a seeded Library film carries its title in the brief; a `discussion` of two
  text files carries both and cuts at the cap; a `debate` outline has two `side` parts and a `moderator` closing.

## 11. TALENT-09: any synth on air and on screen

- `ensureSubject` already exists from TALENT-04 (section 6.1, `real` from `based_on`, sharing with `shared_to`); this slice adds the
  two other callers below and nothing to it.
- `made-artist` members: `band.ts` member draft gains optional `synth_id`; a "Make this member a synth" route `POST
  /api/music/bands/{id}/members/{index}/synth` that calls `createSynth` from the member's name and role and the band's backstory.
- Films: `lib/films/engines.ts` narration and spoken lines: when a cast entry resolves to a subject with `synth_id`, the voice for its
  spoken line is `voiceForSpeech({ actor, companionVoice: synth.persona.voice_id })`.
- Tests: a show cast with a catalog companion makes its subject once and shares it with the show's people; a band member becomes a
  synth with the band's backstory; a film plan line for a synth cast entry renders with the synth's voice (stubbed `synthesizeSpeech`).

## 12. TALENT-10, 11, 12

- TALENT-10 is built inside 4.3 (`household` source) and tested there; this row only adds the per-show switch on the show page (a kit
  toggle bound to `PATCH /api/talent/shows/{id}` `household_facts`) and the test "a shared show never carries a list name".
- TALENT-11: `lib/music/djLines.ts` `writeDjLine` input gains `life_card: string | null` from `synthCard(personaId)` when the DJ's persona is
  a synth with beats; the prompt gets one line: "You may mention one thing from your own life card if it fits, once an hour at most."
  (the hour rule is code: a `last_life_mention_at` in the DJ cache). Test: a scripted DJ line prompt contains the card.
- TALENT-12: `lib/films/run.ts` `FilmEngines.makeNarration` gains a `synth_id` option read from the plan's cast; `plan.ts`'s spoken line
  gains `part: string` so two synths can speak in one film through `renderLines` and `media.mix` laid under the stitched video with one
  `media.edit` `audio_overlay` per shot (the film's existing voice overlay path). Test: a two-line film plan renders two clips with two
  voices and the assembled film has both.

## 13. TALENT-13: the Synths page and screens

Design: sections 2.5, 9. Frontend, docs. After TALENT-00.

- Rail and heading: the Companions app's label and heading become "Synths" wherever the string is declared (`frontend/src` i18n catalogs
  for en and the other languages; the icon stays); the ambient companion strings keep "companion".
- The list page: each synth row shows portrait, display name, tagline, "Your companion" when `persona.active_id` equals it, "Based on
  <name>" when `based_on.kind != "none"`, "Yours, from <base name>" on a fork, and the shows it is cast on (`GET /api/talent/shows`
  filtered by cast). Existing list element, new subtitle fields only. Private forks of other people are not listed (`listSynths`).
- Chat: a "Chat" action on every synth's page opens a new conversation with `companion_id` set to that synth (the existing
  per-conversation persona path, `conversationPersona(actor, companionId)` in `turnNext.ts`, and the conversation's `companionId`
  column), with no fork; the chat shell's "new conversation with a companion" route is reused (grep `companionId` in
  `frontend/src/apps/chat` for the entry point). A synth hidden by `synths.real_people` has no Chat.
- Picking a companion: the "Make this my companion" action on a base synth calls `POST /api/companions/{id}/fork` (`forkSynth`) and the
  page then shows the fork as "Your companion"; on a fork's page "Share with the household" calls `POST /api/companions/{id}/share`
  (`shareFork`) and "Start fresh from the base" forks the base again and retires the old fork (`DELETE /{id}`, which deletes its beats).
  The old direct pick (setting `persona.active_id` to a base) is removed from the page; the robot's companion setting (`robot.companion.id`) accepts only synths with `private_to` null (a base or a
  shared fork): a robot is a shared surface and a private persona must never be heard by other speakers (rule 0).
- Create and edit (the three screens of companion-three-screens): screen one gains the "Based on" choice (nobody, a household member
  from the roster, a real person by name; hidden for a child or teen actor); the edit screen gains Style (the dials the persona already
  shows, plus the `examples` list with a source line and a pin toggle per entry; pins are kept in `synth.pins: { dials: string[],
  examples: string[] }`, additive field in TALENT-00's record, default empty), History (the `GET /{id}/life` list with date and text,
  add, edit, forget) and On air (shows and parts). Every piece is a shipped kit Element, named in the slice's brief by its import name. Chat cards are registered in
  `frontend/src/apps/chat/elementBindings.ts` (`FilmToolRender` at about l.86; that file holds chat tool cards only). For the pages
  (rule 9b) the brief takes the names from the `@maipai/ui` imports of the existing pages: the "Based on" choice is the Element the
  Settings `select` selector renders through `SettingsShell`; the pin and the household-facts toggle (TALENT-10) are the Element the
  Settings `boolean` selector renders; the History list and the Style phrases list are the list Element the Companions detail page
  imports for its sections today; the Synths list rows are the row Element the Companions list page imports (find both pages with
  `grep -rl "companions" frontend/src/shell/pages frontend/src/apps`). The brief copies the exact import names; if a needed prop is
  missing, it lands in `commons` first (condition 9).
- Credits (the IMDb-style page, owner 2026-11-07): `GET /api/talent/synths/{id}/credits` in `routes/talent.ts` returns `{ shows:
  Array<{ production_id, title, part, episodes: Array<{ item_id, title, aired_at, duration_s }> }>, films: Array<{ production_id, title,
  part, file_id, made_at }>, bands: Array<{ made_artist_id, name, role }> }` from every Production the actor may see (`canSeeProduction`)
  whose `cast[].synth_id` is the synth (shows are those with `show != null`; their episodes are the media items of the production
  source the actor may read through `queryItems`; films are the other productions' `finished_cut_file_ids` the actor may read), plus
  the bands from `listMade("made_artist", actor, { scope: "all" })` (`lib/music/madeRecords.ts`, which applies `mayRead`; never a direct
  table read) filtered by `members[].synth_id`; the route answers 404 unless `getSynth(actor, id)` returns the synth (an adult synth is
  404 for a child); each group newest first. The synth page renders Credits above Life with
  the list Element the Companions detail page imports; an episode row plays through the shell's media host (`MediaHostProvider`, the
  `play` action a media app page uses) and a film row through the kit `VideoPlayer` route `/api/files/{file_id}/content`; an empty group
  is not drawn. Test: a synth cast on one show with two episodes and one film answers both groups, a child sees only the episodes its
  band allows, a child does not see an adult member's band in `bands`, a child gets 404 for an adult synth's credits, and a synth with
  no credits answers empty arrays.
- `docs/user/companions.md` is renamed in content to Synths (file name kept; the words change) in the same commit; captures at 1440 and
  390 in both themes opened and judged.
- Tests: `frontend` render tests for the list row with "Your companion" and "Based on"; a child's list has no real-person synth;
  `lint:ui-rules` passes.

## 14. TALENT-14: the researcher

Design: section 3.5 and the based_on bullet of 2.2. After TALENT-01 and 13. Load `docs/PRIVACY.md` and `docs/THIRD-PARTY-SERVICES.md`
before building; add the budget row to `docs/THIRD-PARTY-SERVICES.md`.

### 14.1 Migration `<next>_memory_confidence.sql`

```sql
ALTER TABLE memory_records ADD COLUMN fact_confidence REAL;
ALTER TABLE memory_records ADD COLUMN confidence_evidence TEXT NOT NULL DEFAULT '[]';
ALTER TABLE memory_records ADD COLUMN conflicts_with TEXT NOT NULL DEFAULT '[]';
```

(`context.ts` l.389 reads `r.fact_confidence` already; confirm the field name on `MemoryRecord` and keep it.) `RememberInput` gains
`fact_confidence?`, `confidence_evidence?: Array<{ source: string; at: string; kind: string }>`.

### 14.2 `backend/src/lib/talent/researcher.ts`

```ts
export const RESEARCH_SOURCE = "talent.research";
export async function researchSynth(synth: SynthRecord, actor: PersonRow, opts: { since: string | null; complete?; search?; reference? }): Promise<{ facts: number; style: boolean; views: number; skipped: string | null }>
```

- Table: migration `<next>_talent_research_runs.sql`: `CREATE TABLE talent_research_runs (id TEXT PRIMARY KEY, synth_id TEXT NOT NULL,
  ran_at TEXT NOT NULL, day_key TEXT NOT NULL, facts INTEGER NOT NULL, views INTEGER NOT NULL, style INTEGER NOT NULL); CREATE INDEX
  talent_research_runs_day ON talent_research_runs (day_key);` with the matching `db/schema.ts` table (`talentResearchRuns`).
- Every query and filter below uses `based_on.name`, never `persona.display_name` (a fork may be called Donnie). Research runs
  once per base synth (`forked_from == null`): a fork is never researched itself; the recall for a fork (3.3's companion branch and the
  show brief) also reads the base's `talent.research` records (`list(actor, { scope: "companion", companionId: fork.forked_from })`
  filtered to `source` starting `talent.research`), and the style step is applied to the base and to each of its forks under each
  synth's own pins (`updateSynth` per synth).
- Gates, in order, each returning `skipped` with a reason string: `forked_from != null`; `based_on.kind != "real_person"`;
  `webSourcesFor("adult", false, false).length == 0` (web search off); the daily budget (a counter in the DJ-cache style table
  `talent_research_runs`, cap 20 runs a day per household); a run already today for this synth unless `opts.since` is null (the first
  run).
- Reads: (1) the News shelf: `releaseShelfItems("adult", 200)` whose title or summary contains `based_on.name` (plain substring, case
  folded; this is a filter on already-fetched local data, not a classifier); (2) `searchPickedWebSources({ args: { q: "<based_on.name>" + (since ?
  " after:" + since : "") }, band: "adult", role: actor.role, spoken: false, temporary: false, searxOpts: <the defaults the chat tool
  passes>, deadlineAt: now + 20000 })` and, on the first run only, a second query `"<based_on.name> interview"` and a third `"<based_on.name> speech
  transcript"`; (3) `searchReference(actor, based_on.name)` top 3 hits with `loadArticleFor` cut at 6,000 characters (first run only).
- One `completeBackground` call per run with the schema `RESEARCH_SCHEMA = z.object({ facts: z.array(z.object({ date: z.string(), text:
  z.string().max(200), source: z.string().url(), confidence: z.number().min(0).max(1) })).max(5), style: z.object({ dials: <the ShowFormat
  dials object, all optional>, examples: z.array(z.object({ phrase: z.string().max(140), source: z.string().url() })).max(6) }).nullable(),
  views: z.array(z.object({ topic: z.string().max(60), position: z.string().max(200), source: z.string().url() })).max(6) })` and the
  system prompt, verbatim:

  > You research a real public figure from the material given (news items, search results, pages, reference articles) for a household
  > app that lets people talk with a synth based on that person. Return JSON only, checked against the schema. Facts: at most five dated
  > events since the given date, each with the address of the page it came from and your confidence. Style: how the person actually
  > talks, as the speaking dials (how formal, how complex, how much they wander, how much they hedge, how warm, how funny, how much they
  > take the lead), and up to six short phrases they are known to say, each at most one sentence, each with its source address. Views: up
  > to six topics with the person's stated position, each with a source. Use only the material given; when the material does not show
  > something, leave it out. Never copy more than one sentence from any page.

- A real-person synth may have audience `teen` or `all` (owner ruling 2026-11-07); `rememberBeat` floors every fact and view at that
  audience before it is stored (condition 4), and the style phrases pass `checkText` at it too. When a fact gives a date of birth that
  makes the person under 18 today, the researcher sets `based_on.minor = true` on the base and its forks (never cleared by hand; cleared
  by a later fact that corrects the date).
- Writes: each fact through `rememberBeat` with `category: "event"`, `tier: "durable"`, `valid_from: date`, `source: "talent.research:" +
  url`, `fact_confidence`, `confidence_evidence: [{ source: url, at: now, kind: "web" }]`, after `embedQueryForRecall` plus
  `similarByVector` against the synth's records: cosine above 0.9 with a different date means `supersede(actor, oldId, {...})`, above 0.95
  with the same date means skip; a record the person forgot (the memory "forget" marks `deleted_at`) is matched the same way and never
  re-added. Each view through `rememberBeat` with `category: "preference"`, text `"On <topic>: <position>"`. Style: `updateSynth` with the
  dials not in `synth.pins.dials` and `persona.examples` replaced by the phrases not pinned (the phrase alone, since `examples` is copied
  into speech; rule 14), the manifest `examples` cap of 5 kept (the newest five), and each phrase's source kept in the meta block's
  `phrase_sources` (phrase to url) for the Style block to show.
- If the person dies (owner ruling, 2026-11-07: nothing changes): the death is one more dated fact; no memorial mode, no freeze, the
  synth keeps being researched (the run finds nothing new and writes nothing), cast and chatted with.
- Logs: `talent.research facts=<n> views=<n> style=<0|1> ms=<n>`; never a fact and never the synth's id (rule 6a: an `hc-` id can be a name slug).
- Jobs and routes: `CORE_JOBS["talent.history.refresh"]` every `1d`: for every real-person synth whose `based_on.refresh` is due
  (`1d` always, `7d` when seven days since the last run), `researchSynth(..., { since: <last run date> })`. `createSynth` with
  `real_person` schedules the first run at once (`researchSynth(..., { since: null })` in the background) and the create response carries
  `{ researching: true }`; the Synths page shows "Researching <name>" through the existing one-job-progress row, read from the page's own data load (the
  synth detail answer carries `researching: boolean`), no polling loop (S6), until `talent_research_runs` has the first row for it. `POST /api/companions/{id}/research` (owner or admin) runs it now.

### 14.3 Tests: `backend/tests/talentResearch.test.ts`

Fake search (`searchPickedWebSources` stubbed through its module), fake reference, scripted completer. Cases: (1) the first run on a
scripted result writes 3 facts with sources and confidence, 2 views, and sets 3 dials and 3 examples; (2) a second run with a corrected
date for one fact supersedes the old record (one active, one superseded); (3) a fact the owner forgot is not re-added on the next run;
(4) a pinned dial and a pinned phrase survive a run that returns different values; (5) web search off means `skipped: "web search is
off"` and no search call; (6) a `household_member` synth is skipped; (7) the log line carries counts only (capture the logger); (8) a real-person synth with audience `all`: a fact the child floor
refuses is not stored, a birth date under 18 sets `based_on.minor`; a child with `synths.real_people` `off` gets 404 for it and does not
list it; at `ask` the child's `getSynth` answers `pending_ask: true` with no beats until a parent's Allow lands the id in
`synths.real_people_allowed`, after which chat and fork work; a teen at `all` needs no Ask; a child's `synths.real_people` cannot be set
to `all` (400 from the settings write); (9) an admin cannot list or read an adult member's private fork
(404, no beats), a parent can read a child's.

## 15. Decisions the coder dry run asked for (2026-11-07)

A Sonnet dry run tried to build TALENT-01 and TALENT-04 from this file against the worktree and listed where it would have to guess.
Each point is settled here; where the fix is structural it is also written into the section above.

TALENT-01:
1. The `synth` block is an optional top-level manifest property added by TALENT-00 (2.1a); nothing is written outside the manifest.
2. `owner.json`: migrated on first read, no longer written (3.2).
3. The migration is `0182_memory_companion_id.sql`; produce the `meta/_journal.json` entry and `meta/0182_snapshot.json` with the
   `backend/package.json` script that runs `drizzle-kit generate`, the way 0181 was produced.
4. `remember` is a wrapper over `ingestMemory` (`lib/memoryIngestion.ts` l.203): `IngestInput` and `RememberInput` both gain
   `companion_id?: string | null`; the scope gate for `companion` goes into `ingestMemory`'s own scope check (which casts scope to
   `self | person | household` today) and into `assertCanWrite` (`memory.ts` l.140, which returns "unknown scope" for anything else).
5. `findActiveByKey(scope, person, key)` (`memoryIngestion.ts` l.30 to l.47, used at l.229 and l.377) gains `companionId` in its key so
   two synths with the same beat text never collapse into one record.
6. The `companion_id` filter goes into `activeStatusScopePersonWhere` (`memory.ts` l.683), the JS filter in `list` (l.400) and
   `similarByVector` (which takes `ListOptions`); `RecallOptions extends ListOptions` so it gets `companionId` for free.
7. `sensitive` applies to companion records exactly as to household ones (the writers never set it). To avoid a circular import,
   `memory.ts` does not import `synths.ts`: it exports `registerCompanionReadGate(fn: (actor: PersonRow, companionId: string) => boolean)`
   with a default that returns false, and `lib/talent/life.ts` registers `(actor, id) => { const s = synthById(id); return !!s &&
   maySeeSynth(actor, s); }` at import time (one predicate, section 3.2) (imported from `index.ts` beside the scheduler seeds).
8. `synthCard` builds its `ProfileCard` itself: `ruleLine` is the literal `<display_name>'s life so far:`; `lines` from the synth's
   active records with `category` in `identity, event, state, relationship` (not `instruction, preference, fact`), `at = valid_from ??
   createdAt`, `disclosure = child_disclosure`; it never calls `isProfileCardCategory` or `profileCardRuleLine`; then `renderProfileCard`.
9. `ownerActor(synth): PersonRow | null` loads the person by `synth.owner_person_id` and returns null when gone or disabled (the job
   skips the synth). The enumeration is `listHouseholdCompanionIds()` plus the ids from `allCompanions()` (`robotCompanion.ts` l.43).
10. "Already has a beat dated today" compares `createdAt` through `localDayKey(createdAt, hubTimeZone())` with today's key.
11. `createSynth` takes `Companion` from `@maipai/spec/gen/ts/manifest.js` (3.2).
12. `synthPersona` passes `allowDraft = true`; null means skip in jobs and 404 in routes (3.2).
13. `companion_id` is accepted on any scope and stored; the person and household read paths ignore it (COMP-05 uses it later). Test (8)
    stands.
14. `rememberBeat`'s `actor` is always the synth's owner (`ownerActor(synth)`, jobs and the episode writer alike) except on the
    `POST /{id}/life` route, where it is the caller; `assertCanWrite` for scope `companion` always requires a `talent.` source prefix
    (condition 3, never a role bypass) and, given the prefix, accepts the actor when `actor.id === synth.owner_person_id` or the actor's
    role is owner or admin (the route's 403 handles the rest).
15. The refuse text: "That line is not suitable for this synth's audience, so it was not saved."
16. The life routes live where `routes/companions.ts` is mounted (grep its mount in `app.ts`; it is `/api/companions` unless that grep
    says otherwise). Body: `{ text: string 1..200, date: YYYY-MM-DD }` validated with zod; 404 "That synth is not here anymore."; 403
    "Only the synth's maker or an admin can change its life."
17. The context items use the exact object shape of the `profile-rule` push in `context.ts` l.402, with ids `synth-card` and `synth-<id>`.

TALENT-04:
18. Home columns and the `Production` type changes are section 6.0 (new); `show.state` is only ever written by `setShowState`.
19. `validSubjectIds` accepts a synth's subject for anyone who may use the synth (6.0).
20. Shots carry no clip or voice-line ids; line clips are working files deleted after `keep` (6.1).
21. The source row uses `newMediaSourceId()` and the pinned `kind: "production"` (6.0, 6.1).
22. The media item goes through `MediaItem.parse` and `itemToRow` as `recordFor` does; `bandOkAtIngest` is not used (6.1).
23. Chapters are `{ start_s: number >= 0, title: minLength 1, source: "manual" }`; artwork is `{ file_id }` or null (the spec's oneOf).
24. The transcript uses `NewTranscript { itemId, language, segments, provenance, author }` with segments from the layout (6.1).
25. `storeFile`'s provenance `show:<json>`: the Library's `origin: "made"` derivation (where `video-edit:` and `picture-gen:` prefixes are
    mapped; grep `origin` in `lib/library.ts` and `lib/attachments.ts`) gains the `show:` prefix in this slice.
26. The Podcasts data is `showRows` and `episodesOf` in `lib/media/podcastApp.ts` (6.2).
27. `pages/shows.json` is a `media_shelf` block; only the News briefing row is a `list` (6.2).
28. Buttons use the `call` action form from `backend/packages/news/pages/index.json` with a full `/api/talent/...` target (6.2).
29. No picker or time block: the new-show page is a text input plus one button per format (6.2).
30. News: a `briefing` data id in the manifest, served beside `today`; playing mirrors `story.json`'s `play` mechanism (6.2).
31. `GET /api/talent/briefing/today`: a show the actor owns, else a show shared to the actor, else nothing (there is no household
    fallback: an unshared show is private); an adult gets `news_briefing`, a teen gets `news_briefing` at audience `teen`, a child gets `kids_news`;
    "today" means the episode id's day key equals `localDayKey(now)`.
32. The episode id is `ep-<YYYYMMDD local>-<6 random>`; `show.state.last_make_ms` is in the schema (2.3); `schedule.days` uses 0 for
    Sunday, from the date in the hub's zone.
33. Household keys are read with `getHouseholdSettingValue(key)` (`lib/settings.ts` l.805).
34. Error texts: unknown format "That show format does not exist. Pick one from the list."; audience above the actor's band "You can
    only make shows for your own age group or younger."; `inventCast` failure "The cast could not be invented. Try again in a moment.";
    `length_s` is clamped silently; `min_audience` above the band "This format is not for your age group."; a source kind the format
    does not allow "This format cannot use <kind> as a source."; `cast` with a synth above the audience: the sentence in 6.1.
35. While a make is running, `POST /shows/{id}/episodes` answers 409 "An episode is being made right now. Wait for it to finish."; a
    `state.started_at` older than two hours with a stage before `done` is treated as failed and the next due run restarts at that stage.
36. The stage functions are as in sections 4.3 to 5.3; `makeEpisode`'s `opts` is `{ now?: Date; complete?: typeof completeBackground;
    stack?: ReturnType<typeof stackClient> }`.
37. The absence recap is written in `keep`: for each cast member with `absent`, one beat on the lead synth, text "<name> was away this
    episode; <lead> told listeners.", `category: "event"`, `tier: "episodic"`, `source: "talent.episode:<id>"`.
38. Test (5) reads "at or after" and `dueShows(now)` takes the clock (6.3).

## 16. Order and what each slice shows

| Order | Slice | Shows the owner |
|---|---|---|
| 1 | TALENT-00 | a spec tag and a pin, nothing on screen |
| 2 | TALENT-01 | a companion in chat mentions its life; Life on its page |
| 3 | TALENT-02, 03 | tests only (the writer and the studio) |
| 4 | TALENT-04 | the first briefing, heard in the Podcasts app and from News |
| 5 | TALENT-13 | the Synths page and screens |
| 6 | TALENT-BENCH-01 | the overlap listening test |
| 7 | TALENT-05 | the round table with the trip storyline |
| 8 | TALENT-06 | "make me a show" in chat |
| 9 | TALENT-14 | a synth based on a real person, researched |
| 10 | TALENT-07, 08, 09, 10, 11, 12 | the rest, in any order |
