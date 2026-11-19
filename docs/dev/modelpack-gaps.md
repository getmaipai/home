# Model pack gaps: what Home cannot move yet

Written by MODELPACK-HOME-05 (music), 2026-11-19. One section per slice. A gap here is a Stack or spec fact Home needs before it can stop naming a model; Home does not guess it (design note [model-packs-2026-11-17.md](../design/model-packs-2026-11-17.md), section 8).

## MODELPACK-HOME-05: music (`backend/src/lib/music`)

Status: stopped before any Home code change. The slice is blocked on the facts in 1 to 3. No Home source was edited.

What was checked on 2026-11-19, from this worktree and the local Stack:

- `GET /stack/v1/jobs/catalog?audience=adult` answers and lists `song` (part `ace-step-1-5-turbo`, `limits.max_seconds.standard` 120, `limits.max_words` 4000), `song_edit` (same part, 120 s) and `stems` (part `htdemucs`, no limits). Home already has the read: `jobsCatalog` in `backend/src/lib/stack/client.ts`, typed by `jobsCatalogShape.ts`.
- `POST /stack/v1/jobs/make` exists and refuses a call without Home's token (`home_token_required`). Home has no call to it yet: nothing in `backend/src` posts to `jobs/make`.

### 1. The `song`, `song_edit` and `stems` request and result shapes are not readable from Home

The only copy of the spec in this tree is `@maipai/spec` spec-v0.1.422, which has no job shapes. `jobsCatalogShape.ts` says the catalog shape arrived in spec-v0.1.423, and the design note's section 3 lists eight jobs and none of the three music ones. The Stack source was not available to this session, and a trial `make` would start a real job on the live Stack.

Needed from the Stack or spec side (a spec tag at or above the one that carries them, then `bash scripts/pin.sh commons <pkg>-vX.Y.Z`):

- The request fields of `song` and `song_edit`, and which of today's `MusicBody` tasks (`text2music`, `cover`, `repaint`, `extend`, `edit`, plus the trim, fade and loudness edits) map to which job. Home must not guess the field names (`field_map` is the pack's data).
- How a source is sent for `song_edit` and `stems` (today `source` and `source_sha256`, with `origin: "owned_file"` for a person's own file).
- The result: how the song's bytes, `lrc`, `bpm`, `key`, `seed` and `duration_s` come back, how each stem is listed (`vocals`, `drums`, `bass`, `other`) and fetched, and the poll, cancel and delete routes for a `make` job.
- What `made_with` carries for a song, so `GenerationProvenance` can store the Stack's part id, label and pack version instead of looking a model id up in `lib/music/models.ts`.

### 2. Song quality levels have no catalog equivalent yet

Home offers Quick, Detailed and Max from `StackMusicStatus.quality`, with `max_model.installed` and `remaining_bytes` deciding whether Max runs as Max or as Boost (`ready.ts` `musicMaxInstalled`, `musicLength.test.ts`, `musicStackShape.test.ts`). The catalog lists `song` with `levels: ["standard"]` only, and `alternatives` names the larger parts without saying which level each serves, and it has no "needs a download" field. Needed: `song` levels (standard, boost, max) with limits per level, and a Stack-worded way to say a level needs a model that is not installed yet. Until then `musicStatus()` and `max_model` stay.

### 3. Stems availability needs an audience answer

`stemsStatus()` could read `stems.available` from the catalog. Its callers (`prepareStemsJob`, the owned-file stems path in `lib/music/jobs.ts`, and `lib/voiceSamples.ts`) pass no audience. Needed: whether `stems` is in the minor catalog and which audience a voice-sample split should read. Home does not pick an audience for a person here by guess (rule E6).

### What remains naming a model

`lint:no-model-names` does not exist in this tree (no script, test or package entry; MODELPACK-HOME-01 has not landed here), so it could not be made repo-wide and there is nothing green to report. These are the places a music model name still sits in Home source, for the lint to cover once the gaps above close:

- `backend/src/lib/music/stack.ts`: `model: "htdemucs"` in `submitStems`; the `max_model` field and its comment on `StackMusicStatus`.
- `backend/src/lib/music/ready.ts`: `musicMaxInstalled` reads `max_model`; the sound-effects status builder holds a model id and licence text.
- `backend/src/lib/music/models.ts`: `KNOWN_MUSIC_MODELS`, the licence and commercial-use table keyed by part id (ACE-Step, ACE-Step XL, the sound-effects model, the language model). This is pack data the Stack should send as `made_with`.
- Comments naming ACE-Step or the sound-effects model in `types.ts`, `sections.ts`, `soundMaker.ts` and `routes/music.ts`.
- Outside `lib/music`: `routes/aiChoices.ts` (the `htdemucs` alias), `shared/diskPlanMath.ts`, `shared/tierSlotOptions.ts`, `shared/licensedRows.ts`, `frontend/src/apps/settings/aiTierSlots.ts`, and the music pages (`WaveformSeek.tsx`, `MusicSongDetails.tsx`, `MusicLibrary.tsx`).

Order once the facts exist: add a `make` call to the Stack client beside `jobsCatalog`, move `submitStems` and `submitMusic` onto it, read availability from the catalog, move the provenance table to `made_with`, then add the repo-wide lint.
