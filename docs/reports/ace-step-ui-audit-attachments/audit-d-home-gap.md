# Audit D: what Home's Music (Audio) app does today, and what the Stack gives it

Read-only. Date 2026-11-13. Home = `/Users/jessetorres/Developer/github.com/getmaipai/home` (main at 4bd96fad4), Stack = `.../getmaipai/stack` (main 67d396b), commons = `.../getmaipai/commons`. Paths below are relative to that repo unless noted. The live Stack was probed at `http://127.0.0.1:8770` and its disk at `/usr/local/maipai-home/stack/data`.

## 0. Headline (what a new ACE-Step feature plan must know)

1. The Music app is the catalog/bundled package **`audio`** (display "Audio", v0.3.15, `backend/packages/audio/manifest.json:2-6`), not a package named `music`. Its pages are JSON stubs; the real Create, Studio, Stems, Remix and Sound-maker UIs are Home TSX drawn by `frontend/src/shell/pages/MusicStudioPages.tsx` (routed from `frontend/src/shell/pages/PackageAppPage.tsx:32,295`).
2. Far more is built than the 2026-10-31 design note says. Built: songs, nine-plus edit changes, versions, covers, timed and word-level lyrics, stems (Demucs) with a DAW-style Studio view, parts mix (remove vocals, keep drums), voice swap (SoulX-Singer), bands, albums, song styles, a Sounds maker (sound effects made with ACE-Step, not Stable Audio), add-a-sound-to-a-song, and "Add music to a clip" for video. Not built: lego, extract, complete (ACE-Step base-model tasks), tempo and pitch edit, an audio editor with region select, Stable Audio, teen and child lanes.
3. Everything makes songs through ONE Stack endpoint family `POST /v1/audio/music` with tasks `text2music, cover, repaint, extend, edit(trim|fade|loudness)`. Home maps its edit names onto these (see section 3).
4. Teens and children cannot make or edit songs today. Only adults, on a written own-screen chat. `musicViewDenial` returns `"minor"` unless `laneOf(audience) === "adult"` (`backend/src/lib/music/policy.ts:26-35`).
5. Live Stack state: ACE-Step 1.5 turbo + 0.6B planning LM are on disk, but the Stack reports music `state: needs-setup` because the sung-word-check model (Whisper) is not installed, and `model.installed: false` in `GET /stack/v1/music`. No XL turbo (Boost), no XL SFT or 4B LM (Max), no 1.7B LM on disk.

## 1. Home backend

### 1.1 Files (all `backend/src/lib/music/`, line counts at read time)

| File | Lines | Job |
|---|---|---|
| `jobs.ts` | 578 | job start, poll, finish, provenance, covers, stems, parts mix, queue provider; reads `registerQueueProvider` at 38-53 |
| `tool.ts` | 344 | chat tools `generate_music` (`generateMusicArgs` at 34) and `edit_music` (`editMusicArgs` at 37); length rules `QUICK_SONG` 45 s default/60 max, `FULL_SONG` 180 default/240 max |
| `stack.ts` | 208 | Stack HTTP client: music, stems, voice-convert, align, beats |
| `policy.ts` | 47 | age and surface gate, household switch `generation.music.enabled`, CSAM-only prompt refusal |
| `lock.ts` | 44 | Adult lock for songs (SONG-LOCK-B) |
| `sound.ts` | 41 | NOT sound effects: resolves a saved song style, band or album into style defaults (`resolveSound`) |
| `soundMaker.ts` | 54 | the Sounds maker tool `make_sound` (`MAKE_SOUND_TOOL_ID`, args at 12-18) |
| `soundAudio.ts`, `soundTakes.ts` | 116, 70 | seamless-loop crossfade (`crossfadeLoopWav`), `mixSoundAtWav`, `addSoundToSong` |
| `mixParts.ts` | 108 | ffmpeg or afconvert mix of kept stems |
| `songEdit.ts`, `sections.ts`, `studioTools.ts` | 68, 139, 78 | section finder for repaint, edit prep |
| `band.ts`, `bandActions.ts`, `album.ts`, `madeRecords.ts`, `styleCard.ts` | 213, 88, 272, 342, 96 | made bands, albums, song styles (spec `song-style`, `made-artist`) |
| `timedWords.ts`, `lyricsAlign.ts`, `libraryAlign.ts`, `lyricsTranslate.ts`, `lyricsWriter.ts` | | karaoke timing through Stack `/v1/audio/align` |
| `djLines.ts` | 174 | AI DJ lines |
| `models.ts` | 26 | provenance table of known models (see 1.6) |
| `commercial.ts`, `ready.ts`, `store.ts`, `types.ts`, `cover.ts`, `m4a.ts`, `objects.ts`, `trackItem.ts` | | commercial flag, engine readiness, SQLite store (`music_jobs`, migration `0113_music_jobs.sql`), cover art via picture job |

Routes: `backend/src/routes/music.ts` (590 lines) mounted `/api/music`; made records in `backend/src/routes/musicMade.ts` mounted `/api/music/{styles,bands,albums}` (`backend/src/app.ts:364-366`). Music route paths: `/status /jobs /jobs/{id} /jobs/{id}/{cover,revise,details,stems,use,length,quality,delete,files/{fileId}} /songs /sounds /sounds/{id}/save /sounds/takes/{group} /sounds/{id}/add-to-song /stems/from-file /from-file/edit /library/{id}/lyrics-realign /files/{fileId} /dj/prepare /dj/line`.

### 1.2 Chat tools (all `min_role: adult`, `backend/packages/*/manifest.json`)

`generate_music`, `edit_music`, `make_sound`, `make_song_style`, `edit_song_style`, `make_band`, `edit_band`, `make_album`, `edit_album`. Edit changes (`tool.ts:37-38`): `remake, restyle, instrumental, rewrite_section, extend, variation, trim, fade, loudness, make_full, make_quick, stems, parts, voice_swap`. `generate_music` accepts `description, lyrics, instrumental, length quick|full, tier standard|boost|max, seconds, bpm 20-300, key, language, title, song_style, band, album` (`tool.ts:28-35`). Sounds: `make_sound` takes `description, seconds 1-60, loop, takes 1-3, stick_to_words` (`soundMaker.ts:12-18`); it submits an ordinary `text2music` job with the prompt prefixed "sound effect, no melody, no singing" and `quality: "quick"` (`soundMaker.ts:35-39`). Under 10 s it is made at the 10 s minimum and trimmed (`request.sound.trimTo`, `types.ts` `sound?`).

### 1.3 Chat cards

Kit `MusicTrack` (`commons/ui/src/elements/music-track.tsx`, edit panel in `music-edit.tsx`) drawn by `frontend/src/apps/chat/MusicCardView.tsx` with `useMusicTrackProps` (line 44), `useMusicCard.ts`, `useMusicBlock.ts`. Version stepper, Use this version, Make it full/quick (`musicApi.setLength`), Boost (`/jobs/{id}/quality`), new cover, share, download. A sound opened from Create is drawn by the same card (`MusicWorkspacePage.tsx:299-313`). Frontend API client: `frontend/src/lib/musicApi.ts` (94 lines).

### 1.4 Frontend pages

- `shell/pages/MusicWorkspacePage.tsx` (339): Create hero, Make types `song | band | album | song_style | sound | voice` (line 37), `SoundMaker` (113-141), song gallery, `SongDetail` with Open in Studio, Extract stems, Remix (176-222), saved sounds carousel and starter styles (326-330). Address helpers at 46-50: `/apps/audio/create?song=`, `/apps/audio/studio?song=`, `...&split=1`, `...&remix=1`.
- `shell/pages/MusicStudioView.tsx` (256): the DAW view of one song. Rows = full song plus 4 stems; per-row waveform (`MusicWaveform.tsx`), mute, solo, volume; ruler with section flags from timed words; transport; six-band EQ and a compressor built on browser Web Audio (`buildChain`, EQ_BANDS at ~line 50; compressor at 62). Listening only, never the saved file (header comment lines 1-6). The BPM knob only sets the ruler bar length (`MusicStudioView.tsx:118,187,230`), it does not change audio. The header says the MIDI roll, warp markers and "ask me to add a part" bar are not built.
- `MusicStudioPages.tsx` (212), `MakeSongPage.tsx` (193), `MusicRemix.tsx` (58), `BringSong.tsx`, `MusicVoiceCreate.tsx` (156), `SoundExtras.tsx` (86: Add to a song, takes), `MusicLikeThisPage.tsx`.
- Package page JSON are stubs. `pages/sound-effects.json` and `pages/sound-library.json` still say "This page is coming soon", while the working Sounds maker is the Create tab (`MAKES`, `MusicWorkspacePage.tsx:37-38`). `studio.json`, `create.json`, `stems.json`, `remix.json`, `edit.json` are "needs the Home app" empty states.
- Theme: `music-surface` utility (`frontend/src/shell/tokens.css:721`) sets near-black fixed oklch tokens. `docs/design/video-studio-2026-11-02.md:83` says the Music section forces the `dark` class whatever the person's theme. (My grep found no TSX using the class name `music-surface`; the forced look may be applied in a wrapper I did not trace.)

### 1.5 Backlog rows (`docs/BACKLOG.md`)

- **MUSIC-STUDIO-01** (line 893, open, L): the umbrella Music Studio row (Songs, Create with recipes, Song page with versions, Edit: trim, loop, tempo, pitch, swap vocals, lyrics; Stems mixer, Sounds maker, Export). Record `docs/design/music-studio-2026-10-31.md`, status "proposed, architect ruling pending, six owner questions open (Q1 and Q6 design-blocking)". Amended by `music-listen-create-2026-11-01.md` (one Music app with Listen and Create; stems for anyone's own files; no licence gating). Slices S1 to S10 at note section 5 (lines 215-231); "Foundation landed" (note line 244) covers spec `song-style`, `made-artist`, kit `Band` (ui-v0.5.459), Home `song_styles`/`made_artists` stores.
- **MUSIC-STUDIO-ADOPT-01** (line 3120, open, M): move the Studio onto kit `TrackStudio`, delete `music-surface` and the duplicate peaks code, EQ and Compressor become `panels`. Blocked on VIDEO-STUDIO-04 and 05 and on the owner's answer about Music's forced dark theme.
- Related rows: MUSIC-GEN-01..07 done (852-859); MUSIC-GEN-08 privacy check (860), -09 Save to Music/Created by you shelf (861), -10 XL turbo (862, absorbed by TIER-EVAL-06), **-11 Stable Audio 3.0 for beds and effects, licence gate first (863, open)**, **-12 stems (864, absorbed by TIER-EVAL-07/TIER-STEMS-01)**, -14 uploaded audio (866, ruled yes 2026-11-05), -15 sung words check (867), -16 Quick/Full (868, done), -17 (870), -20 karaoke (887), -20b word-by-word aligner (888), -21 length follows words (871), **-22 teens and children (873, open)**, MUSIC-CARD-EDIT-01 (892), **MUSIC-REMIX-01** (894, record `song-remix-2026-11-05.md`, architect APPROVED 2026-11-05, slices R0..R6), **AUDIO-PARITY-01** (895, record `audio-parity-2026-11-05.md`, APPROVED; P1 Sounds maker, P2 Add music to a clip, P3 beats and Cut to the beat, P4 MUSIC-VIDEO-01), TIER-STEMS-02 done (967), MUSIC-ADDMUSIC-RESTART-01 done (898), MUSIC-DJ-01 (891), MUSIC-KIT-01 (880), **CONTENT-POLICY-04 songs consume policy** (188).

### 1.6 Provenance and licence table gap

`backend/src/lib/music/models.ts:10-13` lists only `ace-step-1-5-turbo` and `ace-step-1-5-lm-0-6b` as cleared (MIT). A song made by the Stack's XL turbo (`ace-step-1-5-xl-turbo-bf16`, Apache-2.0 conversion) or XL SFT (`...xl-sft-bf16`) is stamped `model.id` unknown and `commercial_use: "unknown"` by `modelStampFor` (lines 21-26). Any new ACE-Step model needs a row here, or its songs are not cleared for commercial export.

## 2. Jobs, activity and queue

- Music has its own job store, not the unified `lib/jobs.ts` table: `music_jobs` (migration `0113`), `store.ts`. `lib/jobs.ts` has no music code.
- Queue: `backend/src/lib/music/jobs.ts:37-53` calls `registerQueueProvider` on `lib/jobs/householdQueue.ts`, giving each job `jobClass: "other"`, `category: "music"`, `tier: requestTier(job.request)` (standard, boost, max), persisted holds (`PERSISTED_HOLDS`). Scoring weight music = 30 (`lib/jobs/jobScore.ts:11`: picture 60, video 40, music 30, tools 20, background 5). Admission wording in `lib/jobs/admissionFit.ts:36,43`. The tier slot body (`slotRun("music", tier, band)`) is read at `music/jobs.ts:63`. Per-person single-heavy-job rule is ISOLATION-03 (BACKLOG:3280, open).
- Activity: `backend/src/lib/activity.ts:134-152` `songItems` lists only `task = text2music` rows, so sounds (also `text2music`) appear as songs titled from the request; edits (cover, extend, stems, trim) never appear. Locked songs are skipped (`musicJobLockState`, line 142). Links to `/apps/audio/create?song=<id>`.
- Stems and voice-swap jobs poll the Stack's own job ids; `jobs.ts:11` imports `submitStems`, `getStemsJob`, `fetchStem`.

## 3. How Home edit changes map to Stack tasks

| Home change (`tool.ts:37`) | Stack call | Notes |
|---|---|---|
| new song | `text2music` | LM plans, `thinking` on |
| restyle | `cover` (`strength` 0.3-1) | needs source |
| rewrite_section | `repaint` (`from_s`, `to_s`) | `sections.ts` finds the lyric section |
| extend | `extend` (`add_s`, `at` start or end) | implemented in the worker as a repaint past the end |
| variation, remake, make_full, make_quick, revise | `text2music` with new seed, length or words | |
| trim, fade, loudness | `edit` op (`music_worker.py` 241-271) | CPU, no model |
| instrumental | `cover` or text2music with instrumental | |
| stems | `/v1/audio/stems` (Demucs `htdemucs`) | separate engine |
| parts (keep/drop) | stems, then `mixParts.ts` ffmpeg mix, then a `trim`-task file | |
| voice_swap | `/v1/audio/voice-convert` (SoulX-Singer SVC) | household voice reference clip |

## 4. Rulings: teen, child, Adult lock, real voices

- **Rule 0 in `docs/design/RULES.md:32`** (Owner-approved: Jesse, 2026-10-26; record `docs/design/adult-content-model-decides-2026-10-26.md`): "Picture, video and song generation access remains governed by age and surface gates. Children and teens retain their age-based content filters and finished-item checks. For an adult, Home blocks content only to prevent CSAM; all other content decisions belong to the model... This applies to ... music, edits and companion media." Family clause: anyone may make songs with or of a household member. No real-person-voice restriction for adults (`music-studio-2026-10-31.md` section 4 cites the adult-content note, line 9).
- **RULES.md rule 10 (line 300)**: delivery gate checks CSAM plus the child or teen floor; an adult gets CSAM-only.
- **Code**: `refuseMusicPrompt` refuses only `minor_sexual` (`policy.ts:43-47`); `musicViewDenial` (`policy.ts:26-35`) comment: "Music is for adults only (design note section 9). Pictures and videos now open a teen lane and a child cartoon lane (owner ruling 2026-10-17); music does not inherit them." Denial lines: guest, minor ("Making songs is off for children and teens for now."), spoken, shared_screen, household_off (`policy.ts:9-15`).
- **MUSIC-GEN-22 / design note 18.7** (`docs/design/music-generation-2026-10-17.md:610-631`, owner Jesse 2026-10-18): teens and children make songs in the picture lanes; a child's request is rewritten kid-friendly (fixed gentle fallback, fail closed), Quick only for children, cartoon covers, every minor's song transcribed (MUSIC-GEN-15) and withheld and deleted on a hit. "The teen and child song lanes stay off until the shared text check exists (CONTENT-POLICY-01, FIX SETUP)"; the lane opens "in one commit when the seam calls the shared check". The seam is `musicProtections(audience)` in `lib/music/policy.ts` (note says it should exist; I did not find a function of that name in `policy.ts`, which is 47 lines). Backlog: MUSIC-GEN-22 (873, open), CONTENT-POLICY-04 (188, open), MUSIC-GEN-13 per-child switch superseded (865). Studio note section 4 table repeats it (lines 190-213). Related: MUSIC-REMIX-01 R5 teen and child transcription lane (894) and AUDIO-PARITY-01 V4 (voices cloned for every member incl. child, Owner-approved change to SAFETY.md pending, 895).
- **Adult lock**: `backend/src/lib/music/lock.ts:1` is headed `SONG-LOCK-B`. `musicJobLockItem` reads the song file's provenance (`lockItemOfProvenance`) or `request.adultOnly`/`adultLock`; `musicJobLockState` -> `lockState` from `lib/adultLock.ts`. Locked songs are hidden: activity (`activity.ts:142`), sound takes, covers, `songEdit.ts`, `routes/music.ts`, Add music (`videos/musicBed.ts:34`), film music (`films/engines.ts:211,216`). `redactLockedMusicOutcome` hides a locked song's tool reply (`lock.ts:30-38`). The design is `docs/design/video-loras-2026-11-02.md` (lines 110, 233: "The same rows apply to pictures and songs; their slices call the same function"); backlog rows ADULT-LOCK-02 done (3149), -05 done (3153), -06 done (3154), **ADULT-LOCK-07 pictures and songs adopt the lock, open (3155)**. Any new audio output (stems, sounds, new edits) must go through `musicJobLockState`.
- Songs, sounds and stems of an owned upload follow `TIER-STEMS-02` (BACKLOG:967): adults only, local, no filename in any log, stems of an owned file never enter the Stack ledger or feed a cover, edit or voice.
- Rule 6a: nothing logs titles, lyrics, band names or style words (note comments in `madeRecords.ts`, `sound.ts`).

## 5. Where film and video can take a song as a music bed (hooks that exist today)

1. **`edit_video` mix with a music track** (`backend/src/lib/videos/editTool.ts:103,704-722`): `sound: "music"` with either `track` (an own music job or file, checked by `ownTrackFile`, with the Adult-lock mark carried) or `make_music` (a text request, 3-600 chars).
2. **`make_music` path**: `backend/src/lib/videos/musicBed.ts` (56 lines, AUDIO-PARITY-01 P2): `startMusicBed` makes an instrumental `text2music` fitted to the clip length (`quality: "quick"`, clamps to the Stack min and max seconds), `whenMusicDone` polls (30 min cap, locked = fail), `setPendingMix`/`takePendingMix` store the waiting mix in the song's `request.pendingMix` so a Home restart can finish it (MUSIC-ADDMUSIC-RESTART-01). The edit never waits on the song because the queue ranks video above music (header comment).
3. **Film score**: `backend/src/lib/films/engines.ts:205-215` `makeMusic` calls `runGenerateMusic` as the film's own chat turn, polls the job, refuses a locked result, then `assemble` mixes `musicFileId` with the clips through `runStackEdit` (`engines.ts:215-256`, ffmpeg `ops`). `changeFilmMusic` in `films/background.ts:5,52,109` redoes only the music. Design `docs/design/make-film-2026-11-06.md` (music step at line 48, after the clips so they never wait on each other; "music before or after the clips, never beside them", line 74).
4. **TrackStudio add_music**: kit `TrackStudio` has tool `add_music` and `onAdd("music")` (`commons/ui/src/elements/track-studio.tsx:37,69`); the video Studio backend is `backend/src/lib/videos/studio.ts`, `studioPlan.ts`, `media/videoCreateApp.ts`. Home's own frontend does not import `TrackStudio` yet (grep found it only in `elements-plan.json`, `elements-adoption.json`: "nothing in Home draws it yet").
5. **Not built**: Cut to the beat (Home has only the Stack client `StackBeatsData` at `music/stack.ts:122`; no caller), MUSIC-VIDEO-01 (a music video from a song, AUDIO-PARITY-01 P4, gated on lip-sync benches). Ownership: Videos owns the media.edit path; Music calls it and never adds a second one (`audio-parity-2026-11-05.md:71`).

## 6. Sound effects

Exist, made with ACE-Step, not a separate model:
- tool `make_sound` (`soundMaker.ts`), route `POST /api/music/sounds` (`routes/music.ts:321`), up to 3 takes, save to Sounds (`/sounds/{id}/save`, `/sounds`), `GET /sounds/takes/{group}`, add a sound to a song at a start second (`/sounds/{id}/add-to-song`, `soundTakes.ts` `addSoundToSong`, pure-TS WAV mix `mixSoundAtWav`), seamless loop by 0.5 s equal-power crossfade (`soundAudio.ts` `crossfadeLoopWav`, `LOOP_FADE_SECONDS`).
- provenance `kind: "sound"`, `task: "sfx"` (`jobs.ts:291`, `types.ts` `generationOf`).
- Quality limit: ACE-Step's own minimum is 10 s, so short sounds are trimmed from a 10 s song; weak for foley (design note 3.4 says so).
- Stable Audio (Open Small / 3.0) is only a catalog "later" entry in the Stack (`backend/src/lib/modelCatalog.ts:1525`), Home row MUSIC-GEN-11 (BACKLOG:863) behind a licence gate (Stability Community licence, `personal_only`). Nothing installed.

## 7. Settings, wizard, AI and models

- Keys: `generation.music.enabled` (adult household switch, default on), `generation.music.length` (quick|full, default full via spec-v0.1.178) in `policy.ts:14-19`; media lookups keys in `backend/src/settings/musicKeys.ts` (lyrics online, MusicBrainz, Wikimedia, Cover Art Archive). Card: Settings, Pictures, videos and music.
- Model listing: `shared/aiChoices.ts:72-73,336-344`, jobs `music` rows `["music","voice-convert"]` and `stems` rows `["stems","stems-ft","stems-6s"]`; `music.make` switch, `music.voice` switch, `stems.standard|finer|more` switches (the Stems card hides until the spec pin carries its words, line 281-282). Home reads the Stack plan through `backend/src/routes/setup.ts:160-178` and `backend/src/lib/stackComponents.ts` (ComponentGroup includes `music`, `stems`, line 8). Stack side rows: `stack/backend/src/lib/diskPlan.ts:206-209` (`music` "Make music (ACE-Step 1.5)", `music-transcribe` "Check sung words (Whisper)", `music-boost` "Clearer songs" p128+, `music-max` "Best songs" p128+).
- Status: `GET /stack/v1/music` via `lib/music/ready.ts` and `roleHealth` row.

## 8. The Stack (read only)

### 8.1 Engine and models

- Engine `music-gen`, ACE-Step 1.5 source commit `ca1e85f` (MIT), uv env from `backend/src/music/music-gen.darwin-arm64.requirements.txt`, JSON-lines worker `backend/src/music/music_worker.py` (503 lines), runtime `backend/src/music/musicGen.ts` (498). Offline env, tiled VAE (`ACESTEP_MLX_VAE_CHUNK=256`), MLX cache capped at 2 GB (`musicGen.ts:93`), worker runs under `taskpolicy -b` (`music_worker.py:494`), idle exit 300 s (status `worker.idle_exit_seconds`).
- Pins in `backend/src/lib/modelCatalog.ts`:
  - `ace-step-1-5-turbo` (2B DiT, MIT, `ACE-Step/Ace-Step1.5` rev 19671f4, ~10.09 GB) at 936-1000, role `music`, directory `ACE-Step-1.5-checkpoints`.
  - `ace-step-1-5-lm-0-6b` planning LM (~1.37 GB), 1003-1018.
  - `whisper-large-v3-turbo` (mlx-community, MIT, ~1.61 GB) sung-word check, 1019-1025.
  - Boost: `ace-step-1-5-xl-turbo-bf16` (community conversion, Apache-2.0, 9.97 GB) + `ace-step-1-5-xl-turbo-config` (MIT) at ~1031-1073; 1.7B LM.
  - Max: `ace-step-1-5-xl-sft-bf16` + config + `ace-step-1-5-lm-4b` (~1078+, `STACK_MUSIC_MAX_MODELS`).
  - Stems: `htdemucs`, `htdemucs_ft`, `htdemucs_6s` (all MIT, engine `stems`, 1159-1184).
  - Catalog "later" list names ACE-Step XL and Stable Audio 3.0 (1523-1526).
- **Installed on disk (live hub `/usr/local/maipai-home/stack/data/models`)**: `ace-step-1-5-turbo` (9.4 GB), `ace-step-1-5-lm-0-6b` (1.3 GB), `htdemucs`, `mms-fa-align` (1.2 GB, forced aligner), `soulx-singer-svc` (2.6 GB), `soulx-singer-rmvpe`, `soulx-singer-whisper-base`, `fish-audio-drama-3-4bit` (22 GB, recorded speech), `chatterbox-turbo-fp16` family, `pocket-tts-english` + voices alba and javert, `parakeet-tdt-0.6b-v2-int8`, `moonshine-tiny-en-int8`, `silero-vad`, `smart-turn-v3.2`. NOT on disk: Whisper large-v3-turbo (so `transcribe.available: false` and state `needs-setup`), XL turbo, XL SFT, 4B LM, `htdemucs_ft`, `htdemucs_6s`, any Stable Audio. Engines present: `music-gen, stems, align, beats, voice-convert, recorded-speech, mlx-audio, pocket-tts, ffmpeg, ...` (`.../stack/data/engines`).

### 8.2 Routes (`backend/src/app.ts:134-140`)

`/v1/audio/music` (`routes/musicGenerations.ts`: `POST /`, `GET /{job}`, `GET /{job}/file` with Range, `DELETE /{job}` cancel or free), `/v1/audio/stems` (`routes/stems.ts`), `/v1/audio/align` (`routes/align.ts`), `/v1/audio/transcriptions` (+ WS stream, `routes/speech.ts`), `/v1/audio/mouth-timings`, `/v1/audio/beats` (`routes/beats.ts`: tempo, meter, beats, downbeats, sections), `/v1/audio/voice-convert` (`routes/voiceConvert.ts`), recorded speech (`routes/recordedSpeech.ts`, Fish Audio Drama 3). Status: `GET /stack/v1/music`, `/stack/v1/stems`.

### 8.3 Params the music route exposes (`musicGenerations.ts:47-71`)

`task` (`text2music|cover|repaint|extend|edit`), `caption`, `lyrics` (tagged [Verse] [Chorus]), `instrumental`, `transcribe`, `duration_s` (10 to tier max, default 60; 240 on p128, 120 on p64), `bpm` (30-300), `key`, `language`, `seed`, `quality` (`quick|detailed|max` = Standard|Boost|Max), `source`+`source_sha256` (base64 m4a "this Stack made", max 40 MB, or `origin: owned_file` for stems), `from_s`/`to_s`, `add_s` (5-120), `at`, `strength` (cover 0.1-1, default 0.6), `edit` {op trim|fade|loudness, from_s, to_s, seconds, where in|out|both, lufs -30..-8}, `tier`, `title`, `timeout_ms` (default 60 s then 202 + job id; max 30 min). The worker also reads `steps`, `guidance`, `codes`, `lm`, `dit` (internal; `steps` 8-100 default 70 and `guidance` 1-15 default 3 only on the SFT Max model, `music_worker.py:305-309`).

### 8.4 Tasks the worker actually supports

`music_worker.py:280-282` rejects anything but `text2music, cover, repaint, extend`. `extend` is a repaint past the source end (`:323-330`). So **repaint, extend, cover: yes. lego, extract, complete: no** (ACE-Step's base model tasks are not wired; the base DiT is not in the catalog). **Stems: not ACE-Step**: Demucs in its own engine (`/v1/audio/stems`, Home sends `model: "htdemucs"`, `music/stack.ts:84`). Edit ops trim, fade, loudness run no model and take no memory admission (`jobs.ts` header). A source must be a song this Stack made (`provenance.wasMadeHere`), except owned-file stems.

### 8.5 Speed, queue and memory

- Turbo (2B) runs on ACE-Step's MLX path; XL models run on torch MPS in float32 (`music_worker.py:147-148`, bf16 compute made noise on the Studio 2026-11-02). Distilled turbo = 8 inference steps (`:412` is the transcription alignment call; turbo text2music uses the library's turbo default); SFT Max 70 steps guidance 3. `TEXT2MUSIC_SHIFT = 3.0`, DCW off, planner codes 1.0 on 2B turbo and 0.0 on XL turbo (`:274,302-310`; 2026-11-02 listening test).
- Measured by Home notes: new 30 s song 16 to 26 s, edit 3.5 to 7 s, stems on 40 s song 1.8 to 4.5 s at 1.2 GB, Full song 31 to 90 s (BACKLOG MUSIC-GEN-16, studio note 1.1).
- Queue: kinds `music_generation` (generator queue, holds the governor admission for the whole song) and `music_edit` (CPU), both through one service chain so the worker is never shared concurrently (`music/jobs.ts:1-9`); `MUSIC_QUEUE_MAX = 4` (`musicGen.ts:57`); live status reports `queue_max: 4`. Home's household queue sits on top (section 2).
- Memory: admission 33 GB for Standard (peak 27 to 32 GB), 52 GB for XL Boost or Max (measured 45.1 and 50.3 GB), +2 GB if transcribing; warm resident 21 GB (`musicGen.ts:61-69`). Tiers: p128 offers quick, detailed, max (default detailed); p64 offers quick only, to 120 s (`:76-89`). The live host is p128.
- LM per quality: `quick` 0.6B, `detailed` 1.7B, `max` 4B (`musicGen.ts:86`).

### 8.6 How a new audio model is registered in the Stack

1. Pin it in `backend/src/lib/modelCatalog.ts` as a `CatalogModelLike` (`id, role, component, repo, license, revision, engine, sizing{profile,quantization}, download{url, sha256, approx_bytes, directory, files[]}`) and add it to the role's list (e.g. `STACK_MUSIC_MODELS`, `STACK_STEMS_MODELS`).
2. If it needs a new runtime: add a managed engine row in `backend/src/lib/engineCatalog.ts` (music-gen at 280, stems 367, beats 365, align 366, voice-convert 368; also the `ENGINE_ROLE` map at 358) and its uv requirements.
3. Add a component and group in `backend/src/lib/components.ts` (`ComponentGroup`, line 55; music env helpers imported at 35) and disk-plan rows in `backend/src/lib/diskPlan.ts` (206-209 for music) plus `diskPlanMeasured.json`.
4. Add a route and a job kind with `registerJobRunner` (`lib/jobs.ts:125`), mount in `backend/src/app.ts` (134-140), with a `GET /stack/v1/<role>` status envelope (`{ music: {...} }`, which Home reads at `music/stack.ts:68-75`).
5. Home side: a model row in `lib/music/models.ts` (licence stamp), the settings tiles in `shared/aiChoices.ts` (`rows` map lines 72-73), and a Home client in `lib/music/stack.ts`.
6. Stack docs rule: Home's design note for music (`docs/design/music-generation-2026-10-17.md`) sections 3 (pins) and 12 (API) are the contract; a `bash scripts/check.sh` in the Stack gates the change.

## 9. Gaps versus a fuller ACE-Step feature set (facts only)

- Tasks not wired in the worker: lego (add a track), extract (stem from a mix by the base model), complete (autocomplete one stem). Base model not pinned. Stems come from Demucs (4 stems on disk; 6-stem and fine-tuned pins exist in the catalog but are not downloaded).
- Not exposed: `steps`/`guidance` for Standard and Boost (turbo is distilled and fixed), `batch_size` (worker sets 1), per-request model choice (quality tier picks it), reference audio or style audio for `text2music` (only the source-song tasks take audio), `repaint` strength/blend, lyric language beyond a string.
- Home-only gaps: tempo and pitch edit (design S6, none built), region-select audio editor `AudioEditor` (design S5, none; commons has only `TrackStudio`), export formats beyond AAC m4a (S9), Save to Music shelf (MUSIC-GEN-09), karaoke on the card (MUSIC-GEN-20), teen and child lanes (MUSIC-GEN-22), activity rows for non-`text2music` jobs, XL models not in `models.ts`.
- Kit: `TrackStudio` (commons `ui/src/elements/track-studio.tsx`, 968 lines, ui tags up to `ui-v0.5.631`; Home pins `ui-v0.5.627`, `frontend/package.json:35`) supports `kind: "audio"` (line 54, no video monitor), tools `split | delete | add_clip | add_voice | add_music`, and panels `volume | fades | crossfade | level` (lines 37-40). It has no EQ or Compressor panel: `StudioPanel` is a closed union, so MUSIC-STUDIO-ADOPT-01's "EQ and Compressor become panels" needs a commons change first. Its model has lanes video, voice, music (`laneWord`, line 89), not stems; stem lanes would need a lane-set change too.
