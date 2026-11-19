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
