# Model pack gaps: what Home cannot move yet

One section per slice. A gap here is a Stack or spec fact Home needs before it can stop naming a model; Home does not guess it (design note [model-packs-2026-11-17.md](../design/model-packs-2026-11-17.md), section 8). Answered gaps are deleted; only what is still true stays.

## MODELPACK-HOME-05: music (`backend/src/lib/music`)

Status 2026-11-19, against `@maipai/spec` spec-v0.1.424 and Stack `f5a696b`: **stems are moved** (a song made here goes to the generic `stems` job; availability is read from the jobs catalog; no model id is sent). **Songs are not moved**: `song` and `song_edit` on the make door cannot yet carry what Home's songs need (1 to 3 below). A person's own audio file still splits on the stems route (4).

What moved, where:

- `submitStems` (`lib/music/stack.ts`) posts `{ job: "stems", audience: "adult", song: "data:audio/mp4;base64,...", stems: [vocals, drums, bass, other] }` to `POST /stack/v1/jobs/make` for a song made here, and reads the job id from the result's `id`. The `model` field is gone from every stems call (the stems route defaults it).
- `stemsAvailable(audience)` replaces `stemsStatus` and reads the catalog's `stems` entry (`GET /stack/v1/jobs/catalog`). The music features run only for an adult (`musicViewDenial`), so the song-card and owned-file split ask the adult catalog. The voice-sample split has no person, so it asks the minor catalog: that list is the narrower one, so a yes there holds for anyone.
- Tests: `tests/musicRoutes.test.ts` (the generic stems request, a refused make, the owned-file route, catalog availability); `tests/musicFixture.ts` answers the catalog and the make route.

### 1. The make door picks a song's part before it looks at the level

`planMake` (Stack `lib/makePlan.ts`) takes the first runnable part that has a `song` job, in the audience's order, and only then checks the level against that part's pack. The song parts split the levels (the standard part serves `standard`, the larger turbo part `boost`, the larger SFT part `max`), so a request for `boost` or `max` is refused `level_not_served` whenever the standard part is first and ready. Home cannot work around it: it would have to name a `part`, and it knows only ids and labels from the adult catalog's `alternatives`, never which level each serves (a minor's catalog has no `alternatives` at all). The same holds for `song_edit`.

Needed from the Stack: when a request names a `level`, plan among the parts whose pack serves it; and, for Home to drop `max_model` (`StackMusicStatus`, `ready.ts` `musicMaxInstalled`, `musicLength.test.ts`, `musicStackShape.test.ts`), a catalog `song` entry whose `limits.levels` covers every part's levels, with a Stack-worded way to say a level needs a part that is not installed yet (today Max runs as Boost when it is not).

### 2. The `song` and `song_edit` requests lack fields Home's songs use

- `song` has no `bpm`, `key` or `language` (Home sends them from the tool, the Create form and the style card: `MusicRequest`, `routes/music.ts`). `style_words` is free text joined into the caption; turning a tempo or a key into words in Home would be Home writing a model prompt, so it is not done.
- `song_edit` `cover` carries only `strength` and `style_words`; Home's cover also sends the new description and the lyrics. `repaint` and `extend` fit.
- Trim, fade and loudness edits are not in the spec by design (no model runs); they stay on `POST /v1/audio/music` with `task: "edit"`, which names no model.

### 3. A make call cannot return the job id at once

Home queues a song, shows its position and progress, and lets the person cancel it, all keyed by the Stack's job id, which it gets with `timeout_ms: 1` from `/v1/audio/music`. The make request is strict and has no wait field, so the door waits the route's default (60 s for songs, 30 s for stems) before it answers 202 with the id. Stems moved anyway (a split is short, the wait is 30 s at most, and a cancel inside the wait is dropped when the id arrives); a queued song would sit with no id for up to a minute. The song result also carries no `lrc`, `bpm`, `key` or `seed`, which Home reads from the music job poll (`GET /v1/audio/music/<id>`, the id the make result returns). Needed: an optional wait (or an "answer at once" flag) on the make request, and either those fields on the result or a poll route for make jobs. Until then Home polls `/v1/audio/music/<id>` and `/v1/audio/stems/<id>`, which name no model.

### 4. The generic `stems` job splits only songs this Stack made

`dispatchStems` forwards no `origin`, so a person's own audio file (an upload, or a voice sample) is refused `source_not_made_here`. Both stay on `POST /v1/audio/stems` with `origin: "owned_file"` and no model id. Needed: `origin: "owned_file"` (or a spec field for a person's own file) on the `stems` request, carried through to the route.

### 5. Provenance still reads Home's own model table

`GenerationProvenance` for songs and stems is stamped from `lib/music/models.ts` (`modelStampFor`). The make result's `made_with` (part id, label, pack version) is the replacement, but a song cannot move until 1 to 3 close, and Home does not yet store `made_with` for the stems it now starts. Order once they close: store `made_with`, delete `KNOWN_MUSIC_MODELS`.

### What remains naming a model

`lint:no-model-names` does not exist in this tree (MODELPACK-HOME-01 has not landed, so there is no script, test or package entry), so it was not made repo-wide: it could not be green. After this change `htdemucs` is gone from `lib/music/stack.ts`. Still in Home source:

- `backend/src/lib/music/stack.ts`: the `max_model` field (1).
- `backend/src/lib/music/ready.ts`: `musicMaxInstalled` reads `max_model`; the sound-effects status builder holds a model id and licence text (the sound-effects job, `sound_effect`, is not wired on the make door yet).
- `backend/src/lib/music/models.ts`: `KNOWN_MUSIC_MODELS`, the licence and commercial-use table keyed by part id (5).
- Comments naming ACE-Step, XL SFT or the sound-effects model in `types.ts`, `sections.ts`, `soundMaker.ts`, `tool.ts` and `ready.ts`.
- Outside `lib/music`: `routes/aiChoices.ts` (the `htdemucs` alias), `shared/diskPlanMath.ts`, `shared/tierSlotOptions.ts`, `shared/licensedRows.ts`, `frontend/src/apps/settings/aiTierSlots.ts`, and the music pages (`WaveformSeek.tsx`, `MusicSongDetails.tsx`, `MusicLibrary.tsx`).

## MODELPACK-HOME-04: style bases (rechecked 2026-11-19 against Stack `f5a696b`, spec-v0.1.424)

**No code changed.** `backend/src/lib/loras/baseFamilies.ts`, the `ltx-2.3` rule in `access.ts` and `sync.ts`, and the frontend base pills are still in place. Two earlier questions are answered; three gaps remain.

### Answered (removed as gaps)

- **What the wire shape is.** `@maipai/spec` spec-v0.1.424 has it: a pack's `style_bases` is `[{ id, label, browse: string[], retired?: { mark } }]` (`stack/ts/stack-model-pack.ts`), and each jobs catalog entry carries `styles: { bases: [{ id, label }], max }` (`stack/ts/stack-jobs-catalog.ts`). Home's hand copy `backend/src/lib/stack/jobsCatalogShape.ts` can be replaced by these types.
- **Which route serves it.** Only `GET /stack/v1/jobs/catalog`, through `styles.bases` (from `lib/jobsCatalog.ts`: the serving pack's non-retired `style_bases`, as `{ id, label }`). The Stack has no route that serves packs or style bases on their own.

### Gap 1: no pack has any style bases yet

None of the nine packs under `backend/src/packs/` (`ace-step-*`, `flux3-image-klein`, `htdemucs`, `ltx-2-5-*`, `minimax-h3`, `minimax-h3-image`) has a `style_bases` entry, and `style_bases` appears in no Stack file except `lib/jobsCatalog.ts`. So every job in the catalog answers `styles: { bases: [], max: 0 }`. Reading it today would leave the Made for dropdown and the base pills empty. The Stack's `styles[]` field on the `picture` and `clip` make requests is accepted by the schema and read by no dispatch code (`makeDispatch*.ts`, `routes/jobsMake.ts`).

### Gap 2: the spec shape is smaller than what `baseFamilies.ts` holds

| Home holds today, per base | In spec-v0.1.424 |
|---|---|
| id | `id` |
| plain label | `label` (one label; Home has `words` and `short`, which differ: "LTX 2.5" and "LTX-2.5", "Flux" and "Flux.2 Klein 4B") |
| text patterns, Civitai `baseModels` labels, browse value | `browse: string[]` only; the spec does not say whether these are Civitai labels, text patterns or browse values |
| media (video or picture) | not in `style_bases`; only implied by which job's catalog entry lists it |
| family generic labels (`LTXV2`: a hit that names no version) | none |
| `installable` | none (a base is listed when its serving part is on and ready, so "installable" may be answered by presence; the Stack should confirm) |
| retired base with the base it was tested on | `retired: { mark }` only: one string, no "tested on" base id, and the catalog drops retired bases from `styles.bases` |

### Gap 3: the retired-base bench mark lives on the LoRA files, not on the pack

Home's `ltx-2.3` rule reads each file's `tested_on_25` mark (`tested`, `no_effect`, null) from the Stack's LoRA routes (`/stack/v1/video/loras`). The Stack's own source still names `ltx-2.3` and `tested_on_25` in those routes, and the pack's `retired.mark` is a single string. Home cannot tell which base a retired base is judged on, or what the marks mean, from the pack.

### What unblocks it

From the Stack session (pack data) and the spec owner (shape), in this order:

1. Fill `style_bases` in the packs (LTX 2.5, the Flux, Z-Image and ERNIE picture parts), with the values `baseFamilies.ts` holds, so the catalog's `styles.bases` is not empty.
2. Extend the spec shape to carry the missing fields per base: media, Civitai labels, text patterns (named apart from `browse`), the family's generic labels, plain words, short name, and for a retired base the id of the base it is tested on and the meaning of each bench mark. Tag the spec and say which Stack commit serves it.
3. Or state in the design note which of these stay in Home as data about Civitai and Hugging Face (they are about the sources, not the models) and which move.

### The plan once it is unblocked

1. Replace `jobsCatalogShape.ts` with the spec types and add a `styleBases()` reader in `backend/src/lib/stack/client.ts`.
2. Replace `baseFamilies.ts` with a reader that keeps the exports `source.ts`, `install.ts`, `sync.ts`, `readiness.ts`, `routes/lorasSources.ts` and `videos/stack.ts` use, fed from the Stack's answer, with the last good answer kept when the Stack is down (a Stack hiccup never makes the browser silently empty). Delete `baseFamilies.ts` and `setInstalledBasesProvider`.
3. Move the retired-base rule in `access.ts` and `sync.ts` to the Stack's retired flag and bench mark, with no `ltx-2.3` string left in Home.
4. Frontend: `stylesApi.ts` (`BaseModelId`, `BrowseQuery.base`, `baseWords`), `StyleBrowser.tsx` (`BASE_PILL`), `StyleConfirm.tsx` and `StyleEditor.tsx` (the two hard-coded base choices) take their ids and labels from the backend (`GET /api/loras/bases` exists already and returns `{ id, label }` per base for one media).
5. Tests: `lorasBases`, `lorasHfBrowse`, `lorasPictureBrowse` and `lorasReadiness` keep their behavior checks against a scripted Stack answer; new tests cover the Stack-down fallback and a retired base.

## MODELPACK-HOME-02: pictures

### What Home does now

- No `PICTURE_MODEL` and no `TEXT_CAPABLE_MODELS`. A part is an opaque id the Stack gave, and "this part spells words" is the catalog's
  `capabilities.text` (`lib/pictures/catalog.ts`, `lib/pictures/stack.ts`).
- A picture or an edit that names no part is sent to the part the catalog says serves it: the adult list for an `adult` picture, the minor list
  for every other one and for edits (rule E6). When the catalog cannot be read, no part is named and the Stack uses its own default.
  A part the household picked for a level (a Boost or Max slot) is still sent as the part to ask for (rule E5).
- Rule W1: a picture with words is never made on a part the catalog does not mark `text: true`. When the part shown does not spell but another
  one in the list is on, the first take is asked of the generic `picture` job so the Stack picks the part. Rule W2 reads the same flag.
- Rule W4: the spelling re-make asks the generic `picture` job with `words`, naming the next part after the one that ran (the part shown first,
  then the alternatives, wrapping). The Stack refuses a part that cannot spell (`not_on_this_model`, and its `alternatives` list only parts that
  do; with no part named it picks the first one that does), so Home needs no per-part flag and skips a refused part. When no part takes it, or
  the picture is more than the generic job carries, the re-make goes to the size-and-prompt route as before.
- A child's or teen's picture keeps its cartoon wording and Home's own checks. `CHILD_NEGATIVE_PROMPT` is still sent on the size route, but the
  Stack says the picture models run without guidance and a negative prompt has no effect, so the generic job needs none and the protection is
  Home's (the cartoon wording, the prompt checks and the output check, rules 0 and E6). What keeps a child's first take on the size route is gap 1,
  not the child lane.

### What stops the rest

Read again on 2026-11-19 against the Stack's `origin/main` (`f5a696b`: `routes/jobsMake.ts`, `lib/makeDispatch.ts`, `lib/makePlan.ts`,
`lib/jobsCatalog.ts`, the packs `flux3-image-klein` and `minimax-h3-image`, `lib/recipe.ts`) and the spec shapes of `spec-v0.1.424`. Home now
takes its request, result and catalog types from the spec (`lib/stack/makeShape.ts`, `lib/stack/jobsCatalogShape.ts`), no hand copies of the enums.
These are the gaps that are still true, and each one keeps a slice of Home on the older route:

1. **The make route cannot answer at once.** `pictureBody` sends no `timeout_ms` and the request has no field for one, so the picture route
   waits its default 120 seconds before it answers 202 with the id. Home needs the id at once to show progress and previews and to stop a job, so
   first takes stay on `POST /v1/images/generations`; only the spelling re-make, which runs inside a job that already watches, asks the generic
   job. Wanted: a way to ask for the job id now (an `immediate` flag in the request, or the route always answering 202 first).
2. **No generic job read.** `POST /stack/v1/jobs/make` is the only route of the door. The result `id` of a `picture` is the old picture job id,
   and Home polls `GET /v1/images/generations/{id}`, its `/{n}.png` files and `/preview.jpg`; a `picture_edit`'s files are
   `/v1/images/edits/{id}`. The Stack row that deletes `POST /v1/images/*` must keep those reads or give the generic job its own (state, percent,
   preview, files, cancel).
3. **Pictures serve only `square`.** Both picture packs list `square` alone at all three levels. Home sends landscape, portrait, wide (16:9) and
   tall (9:16) sizes today, so it asks the generic job only for a shape the catalog lists and keeps the size route for the rest. Wanted: the
   shapes the engine really serves, and a place for wide and tall (more shapes, or an aspect field).
4. **No styles.** `picture.styles[]` is in the spec, but `pictureBody` ignores it and the catalog says `styles.max: 0`. A picture with a style
   (a LoRA) stays on the size route.
5. **`words` is one string.** Home has up to six exact strings (chat rule W3). The recipe puts the whole value inside one pair of quotes
   (`The exact words: "{words}"`), so how several strings are joined changes what the model is told. Home joins them with a newline, which is a
   guess. Wanted: the Stack takes `words: string[]` and quotes each one, or says how to join.
6. **`picture_edit` is missing what Home's edits use.** The request has no `seed` (companion looks keep one seed per companion), no
   `image_source` (the route sends `uploaded` for every picture, so the `reference_not_generated` retry and the generated-or-uploaded mark
   cannot be told), and it requires an `audience`, which the edit form leaves out on purpose (ADULT-LOCK-07); the reply has no immediate id
   (gap 1). References can travel as `data:` URLs, which the route reads, so that part is fine. Edits stay on `POST /v1/images/edits`, with the
   part from the catalog.
7. **`all-ages` has no audience of its own.** The generic request has `adult` or `minor`; Home's picture has `adult` or `all-ages`, and an
   adult can make an all-ages picture. Home maps `all-ages` to the minor list, so an adult's all-ages picture uses the Stack's own priority and
   not the household's order. That mapping needs an owner ruling.
8. **Readiness and counts still come from `GET /stack/v1/image`.** The catalog's `limits` carry levels, shapes, `max_references`, `max_words`
   and `max_seconds`, but no maximum picture count, no LoRA support flag and no edit-ready flag, so `pictureEngineStatus` stays for those and
   the Stack cannot delete that route yet.

### Names still in Home source

`lint:no-model-names` does not exist yet (MODELPACK-HOME-01 writes it), so it is not widened here. What is left, and which row owns it:

- `lib/pictures/quality.ts`: the set of removed picture models, read only to refuse an old style. Style bases are MODELPACK-HOME-04.
- `lib/tiers.ts`: `RECOMMENDED_MAX_IMAGE_MODEL`, the Max slot's fallback. Levels and slots are MODELPACK-HOME-03.
- `lib/music`: covers and band and album pictures now name no model (they ask the picture job); the rest of music is MODELPACK-HOME-05.
- `lib/pictures/policy.ts` and the AI card still speak of two Standard choices by name (`ernie`, `klein`); the card is replaced in the settings follow-up.

### Picture tests that already fail on main

Five tests in `tests/picture*.test.ts` fail on this branch and fail the same way on `origin/main`: neither the code they run nor the
tests changed here. They are left alone for the row that owns each cause.

- `pictureTool.test.ts` "picture card waiting labels come from the shared copy table": `phaseLabel` in `routes/pictures.ts` reads
  `job.request.waited_note`, and the test passes a job with no `request`. Fix the test or read `job.request?.waited_note`.
- `pictureMake.test.ts`, three tests (prompt-only Create job, CREATOR-16 set, USE-AS-REFERENCE limit line): TEXT-PIC-04 made
  `makePictureFor` ask the chat model whether the prompt has words. The test Stack answers with plain text, not JSON, so the notice "I couldn't
  check whether you want words on the picture..." is added to every reply. These tests need `__setWordsQuestionCompleterForTests`.
- `pictureTemplateCreate.test.ts` "fills every bundled picture template...": two bundled templates (`mtpl-nostalgia-80s`,
  `mtpl-productplacement`) have a `photo_*` slot (added in eb409b864). The test sends no photo, so the answer is "This template needs your own
  photo", not the cast line. The test needs to send a reference for those two or accept that line.
