# ace-step-ui feature audit (a): features and flows

Repo audited (read-only): /private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai-home/51ec3e7f-849d-471f-a90c-b28549377b45/scratchpad/ace/repo
Paths below are relative to that repo. `CP` = components/CreatePanel.tsx, `GEN` = server/src/routes/generate.ts,
`AC` = server/src/services/acestep.ts, `API` = services/api.ts.

## 0. Architecture in one screen

- Three tiers. React/Vite UI (port 3000/5173) -> Express + SQLite server `server/src` (port 3001, config `server/src/config/index.ts:10-48`)
  -> the ACE-Step 1.5 Gradio app (default `http://localhost:8001`, `config/index.ts:18`). The server drives Gradio through
  `@gradio/client` (`services/gradio-client.ts:11-31`), calling named endpoints: `/generation_wrapper`, `/load_random_simple_description`,
  `/load_lora`, `/unload_lora`, `/set_lora_scale`, `/set_use_lora`, `/training_wrapper`, `/stop_training`, `/export_lora`,
  `/import_dataset`, `/load_existing_dataset_for_preprocess`, `/get_sample_preview`, `/save_sample_edit`, `/load_training_dataset`,
  `/auto_label_all`, `/init_service_wrapper`. Plain REST on the engine: `/v1/models`, `/v1/init`, `/format_input`, `/v1/audio`.
- Last-resort fallback: spawn `server/scripts/simple_generate.py` / `format_sample.py` / `get_limits.py` / `preprocess_dataset.py`
  with the engine's python (`AC:648-851`, `GEN:837-897`). The UI never calls the engine directly.
- Single-user local design, no passwords (section 19). Songs live as files in `server/public/audio` (`config/index.ts:27-30`), metadata in SQLite
  (tables: users, songs, generation_jobs, playlists, playlist_songs, liked_songs, comments, followers, reference_tracks,
  contact_submissions: `server/src/db/migrate.ts:5-116`).
- Views (type `View`, `types.ts:155`): create, library, training, profile, song, playlist, search, news. Sidebar items: Create, Library,
  Search, Training, News (`components/Sidebar.tsx:88-118`). URL routes handled in `App.tsx:252-289`
  (`/library`, `/song/:id`, `/playlist/:id`, `/search`, `/news`, `?song=`).
- Not in this UI at all: extend/continue a song, remix/variation-of-a-song button, stem extraction by the engine (stems are a separate
  in-browser Demucs page), lyric writing by an LLM (only "format"), per-song seed display, retake/regenerate-this-take. See section 20.

## 1. Text-to-music generation (core flow)

UI: `CP` is the left panel. Two modes via toggle (`CP:1131-1145`, default Custom, `CP:136`).

**Simple mode** (`CP:1209-1368`)
- Inputs: song description textarea (h-32, `CP:1236`), vocal language select (default `en`, 52 options `CP:58-110`, first is `unknown` =
  "Auto / Instrumental"), vocal gender toggle (Male/Female, appends the literal line "Male vocals"/"Female vocals" to the style text,
  `CP:969-974`), Duration slider, BPM slider, Key select, Time select, Variations slider (1-4).
- Dice button next to the description loads a random example: `GET /api/generate/random-description` -> Gradio
  `/load_random_simple_description`, returns `[description, instrumental, vocalLanguage]` (`GEN:679-694`; UI `CP:1219-1229`).
- No instrumental toggle is rendered in simple mode (only the random description can set it, `CP:1224`).
- On submit: `prompt = songDescription` (`AC:135`: `customMode ? caption : (songDescription || caption)`); `lyrics` sent as whatever the
  lyrics state holds. The engine's own "simple mode" LLM expansion is not invoked; the description is just used as the caption.
- Known bug: Key/Time selects in simple mode use `onChange={setKeyScale}` / `{setTimeSignature}` and receive the event object
  (`CP:1321`, `CP:1334`); in custom mode they are correct (`CP:1858`, `CP:1871`).

**Custom mode** (`CP:1371-1679`)
- Audio card (reference / cover source, section 9), Lyrics card, Style card, Title card, LoRA card, then Music Parameters (BPM, Key,
  Time) and Advanced Settings. Footer button "Create" (`CP:2772-2786`), disabled while `isGenerating` or not signed in.
- Server requires: simple mode -> `songDescription`; custom -> at least one of style, lyrics, reference audio (`GEN:270-278`, 400 otherwise).
  The UI does not pre-validate; an empty custom form gets a toast "generation failed".
- Title is optional; the server auto-titles from the first non-`[tag]` lyric line (cut at 40 chars + ellipsis), else first 4 words of style
  or description, else "Untitled" (`GEN:26-47`). Multiple outputs get " (v1)", " (v2)" suffixes (`GEN:423`).

**API call chain** (every generation, all modes)
1. UI `onGenerate(params)` -> `App.handleGenerate` (`App.tsx:770-869`): creates a temp "generating" song in the list, opens right sidebar.
2. `POST /api/generate` (`API:333-335`) with ~55 fields (see sections 4-8). Response `{jobId, status:'queued', queuePosition:1}` (`GEN:355-359`).
   Server inserts a `generation_jobs` row (`GEN:340-344`) then calls `generateMusicViaAPI` (`AC:454-473`).
3. Server queue is in-process and strictly sequential (`AC:366`, `processQueue AC:422-451`); one job at a time (comment: "GPU can only handle one job").
4. `processGeneration` (`AC:479-508`): guard for cover without source/codes; if Gradio reachable (`isGradioAvailable`, 5 s timeout probes of
   `/gradio_api/info`, `/info`, `/`) run `processGenerationViaGradio`; on any exception silently falls through to the Python spawn.
5. Gradio path: optional model switch (`AC:516-518`), then `client.predict('/generation_wrapper', args)` with 51 positional args
   (`buildGradioArgs AC:133-208`). The call blocks until all audio is done. Outputs: index 8 = list of files, 9 = details text, 10 = status
   (`AC:549-551`). Files copied to `public/audio/<jobId>_<n>.mp3|flac` (`AC:581-594`); duration read with `ffprobe` (`AC:7-20`);
   BPM/key/time/duration regex-parsed from the details string (`AC:620-642`).
6. UI polls `GET /api/generate/status/:jobId` every 2 s (`App.tsx:703-742`), hard UI timeout 10 minutes -> toast "generation timed out"
   (`App.tsx:747-753`). Jobs in `pending|queued|running` are re-polled after a page refresh from `GET /api/generate/history` (last 50 jobs,
   `GEN:571-587`, resume `App.tsx:871-922`).
7. On first `succeeded` status the server (optimistic-lock UPDATE `GEN:405-409`) downloads each audio file, uploads to storage, inserts one
   `songs` row per file with `is_public = 1` hard-coded (`GEN:435-455`), lyrics saved as `'[Instrumental]'` when instrumental (`GEN:444`),
   full params JSON in `generation_params` (`GEN:453`). UI then reloads `GET /api/songs` and removes the temp row (`App.tsx:646-697`).

**What the user sees while generating:** a placeholder row with blurred cover, title or "Creating..."/"Queued...", amber "Queue #n" when
waiting (`components/SongList.tsx:576-582, 638, 770`), and a pink progress bar. Progress is never reported by the server
(`job.progress` is never assigned; status returns `etaSeconds = 180 - elapsed`, or `queuePosition*180`, `AC:881-897`), so the bar stays in its
indeterminate 40%-opacity state (`SongList.tsx:673`). Stage text is "Starting generation..." / "Loading model X..." / "Generating music via Gradio...".
Failure -> toast `generationFailed: <error>`.

**Own vs engine:** UI/server own: queue, polling, titles, storage, DB rows, Gradio arg mapping. Engine owns: all audio synthesis, the 5Hz LM,
"thinking", metadata inference, normalization.

## 2. Model (DiT) selection

- Pill in the panel header shows a short name (`CP:256-266`: base=1.5B, sft=1.5S, turbo=1.5T, turbo-shift1=1.5TS1, turbo-shift3=1.5TS3,
  turbo-continuous=1.5TC); menu lists models with "Active"/"Ready" badges (`CP:1148-1204`).
- List comes from `GET /api/generate/models` (`GEN:599-676`): fixed registry of 6 names, plus any `acestep-v15-*` folder found under
  `<ACE-Step>/checkpoints`; "Ready" = folder exists; "Active" = first entry of the engine's `/v1/models`. Fallback list used if the call fails (`CP:241-253`).
- Default selection `acestep-v15-turbo-shift3` or the persisted `localStorage ace-model` (`CP:230-232`); on load it re-syncs to the engine's active model (`CP:565-570`).
- Picking a non-turbo model auto-sets steps = 20 and ADG on (`CP:1169-1172`); turbo caps the steps slider at 20, others 200 (`CP:1965`).
- **Defect:** `App.handleGenerate` does not copy `ditModel` into the request (field list `App.tsx:800-855`; the string `ditModel` is absent
  from the call), so the server's `switchModelIfNeeded` (`AC:390-406`, POST engine `/v1/init {model, init_llm:false}`) is never triggered from
  the UI. The model pill is effectively cosmetic; generation uses whatever the engine has loaded. Same drop for `enhance` and `loraLoaded`.

## 3. Lyrics (write / generate / format / instrumental)

- **Write:** plain monospace textarea, default height 144 px, drag handle resizes 96-600 px and persists in `localStorage acestep_lyrics_height`
  (`CP:334-340, 510-555, 1585-1599`). Placeholder "Your lyrics here..." (`i18n/translations.ts:124`). Section tags such as `[Verse]`/`[Chorus]`
  are free text; the UI offers no tag buttons or templates. Trash icon clears (`CP:1577-1582`).
- **Instrumental:** pill toggle Vocal/Instrumental in the lyrics header (`CP:1559-1568`) and a second switch below (`CP:1688-1691`). When on, the
  textarea is disabled/greyed and lyrics are sent as `''` (`AC:136`); saved song lyrics become `[Instrumental]` (`GEN:444`).
- **Generate lyrics:** there is no lyric-writer. Two partial substitutes: (1) AI Format (below), which returns reformatted lyrics, and (2) Whisper
  transcription of an uploaded reference file fills the lyrics box only if it is empty (`CP:807-834`, `setLyrics(prev => prev || data.lyrics)`).
  `services/geminiService.ts` (Gemini lyric/title generator with a mock fallback) is dead code: no importer anywhere.
- **Format (the sparkle buttons):** both the Lyrics and the Style header have a sparkle button (`CP:1569-1576`, `CP:1633-1640`) calling
  `handleFormat(target)` (`CP:689-738`). Disabled unless the Style text is non-empty (even for the lyrics button, `CP:1573`, `CP:690`).
  Request: `POST /api/generate/format` `{caption, lyrics, bpm?, duration?, keyScale?, timeSignature?, temperature, topK?, topP, lmModel, lmBackend}`.
  Server calls the engine REST `POST {engine}/format_input {prompt, lyrics, temperature, param_obj:{bpm,duration,key,time_signature}}`, 5-minute
  timeout (`GEN:773-835`); only on ECONNREFUSED it spawns `format_sample.py` (`GEN:837-897`). Result `{caption, lyrics, bpm, duration,
  key_scale, time_signature, vocal_language}` is written back: caption or lyrics (whichever button), plus BPM, duration, key, time signature
  (`"3"` becomes `"3/4"`), vocal language, and sets `isFormatCaption=true` for the style button (`CP:711-723`). Failure -> `alert()`.
  Engine owns the LLM; the UI owns only the plumbing.
- Language: `vocalLanguage` select, 52 codes incl. `unknown`, `yue`, `zh`, `ja`, `ko` (`CP:58-110`); sent as-is, default `en` (`CP:148`).

## 4. Styles / tags / genres

- Style textarea (h-20, placeholder "e.g. upbeat pop rock, emotional ballad, 90s hip hop", `CP:1643-1648`) is the engine "caption".
- Quick tags: 6 random chips drawn from `MAIN_STYLES` = `data/main_style.txt` (105 lines); dice button reshuffles (`CP:123-133, 1620-1626, 1651-1661`).
  Clicking a chip appends `", tag"` to the style text. Full list `data/all_style.txt` (939 lines) is exported as `ALL_STYLES` (`data/genres.ts`) but nothing
  in the UI reads it (only `MAIN_STYLES`/`GENRE_KEYS` are imported).
- Vocal gender chips add a text line to the style (`CP:969-974`).
- "AI Enhance" ON/OFF chip next to "Style of Music" (`CP:1608-1616`): tooltip says LLM enriches tags and fills BPM/key/time, +10-20 s. It sets
  `enhance`, which `AC:138,151` maps to CoT metas/caption/language flags. **Defect:** `enhance` is not forwarded by `App.handleGenerate` and not read
  by the `/api/generate` handler (`GEN:212-268` has no `enhance`), so this toggle currently has no effect; only `thinking` enables the LLM path.
- Search page has a "Genres" chip strip (the same `MAIN_STYLES`): click = run a search for that genre, hover icon = copy the tag
  (`components/SearchPage.tsx:402-427`).
- Reuse: "Reuse prompt" on any song (`App.handleReuse App.tsx:189-192`) refills only lyrics, style, title and the instrumental flag
  (`CP:490-498`); it does not restore seed, bpm, duration, model or the other settings even though they are stored in `generation_params`.
  A separate "Load Parameters (JSON)" file input in Advanced (`CP:1897-1907`, handler `CP:447-487`) applies snake_case keys
  (`lyrics, caption, bpm, key_scale, duration, inference_steps, guidance_scale, seed, shift, lm_*, task_type, audio_codes, repainting_*,
  instruction, audio_cover_strength...`).

## 5. Duration / length limits

- Sent as `duration` seconds; `-1` = Auto (engine decides; `AC:165` maps `<=0` to `-1`). App strips non-positive values (`App.tsx:808`).
- Simple-mode slider: min -1, max `activeMaxDuration`, step 5 (`CP:1291-1301`). Advanced slider: min -1, max 600, step 5, help text "Auto - 10 min"
  (`CP:1909-1921`). Effective cap: `thinking ? maxDurationWithLm : maxDurationWithoutLm`, defaults 240/240 (`CP:217-218, 610-616`), overwritten from
  `GET /api/generate/limits` (`GEN:705-757` runs `scripts/get_limits.py` -> engine `acestep.gpu_config.get_gpu_config()`: tier, GPU GB,
  `max_duration_with/without_lm`, `max_batch_size_with/without_lm`). Auto-clamps `duration` down when the cap drops (`CP:612-616`).
  The README states 30-240 s (`README.md:394`).
- Python fallback sends 60 s when Auto (`AC:668`).
- The batch-size limits from `get_limits.py` are fetched by the server but ignored by the UI (slider fixed 1-4; server clamps 1-16 at `AC:166`).

## 6. Seeds, variations, batch / takes

- **Seed** (Advanced, `CP:2041-2066`): "Random" toggle (default on) + numeric field (default -1, disabled while random). Sent as
  `randomSeed` and `seed`; Gradio args 8 and 9 (`AC:162-163`, seed is stringified). Hint text: "Random seed recommended" / "Fixed seed reproducible".
  Seeds of finished songs are not shown or recorded separately (only inside the saved `generation_params`).
- **Variations (batchSize):** slider 1-4, default 1 (`CP:159-162, 1923-1930`; also in Simple "Quick settings" `CP:1346-1353`). One engine run yields
  N audio files; each becomes its own song titled "<title> (v1..vN)" (`GEN:421-423`). Server clamp 1-16 (`AC:166`). README says the value is
  remembered in the browser; the code reads `localStorage ace-batchSize` (`CP:160`) but never writes it (no `setItem('ace-batchSize')`).
- **Bulk generate:** chips 1/2/3/5/10 (`CP:1934-1957`), persisted in `localStorage ace-bulkCount` (`CP:163-166`). `handleGenerate` loops and posts N
  separate jobs; job 1 keeps the user seed, later jobs force random (`CP:976-1053`); titles become "<title> (i)". Button label "Create 5 jobs (10 variations)"
  (`CP:2781-2783`). Bulk count resets to 1 after submit (`CP:1055-1058`; the reset is not written to localStorage).
  Jobs are serialized by the server queue; UI shows each as a queued row with "#n".
- No "take picker" or compare view: every output is just another song in the Library list; there is no "make a variation of this song" action
  (Cover/Reference are the closest, section 9-10).

## 7. Advanced generation settings (all are sent in the one request)

Defaults in the UI (`CP:159-218`) differ from the server defaults used when a field is missing (`AC:156-203`); the UI always sends its values.

| Setting | UI default | Range/options | Server fallback | Gradio arg idx |
|---|---|---|---|---|
| Inference steps | 12 | 1-20 turbo, 1-200 other (`CP:1962-1969`) | 8 (`AC:160`) | 6 |
| Guidance scale | 9.0 | 1-15 step 0.1 (`CP:1973-1982`) | 7.0 (`AC:161`) | 7 |
| Shift | 3.0 | 1-5 step 0.1 (`CP:2081-2090`) | 3.0 | 24 |
| Infer method | ode | ode / sde (`CP:1999-2007`) | ode | 25 |
| Audio format | mp3 | mp3 / flac (`CP:1988-1996`) | mp3 | 27 |
| Thinking | off | toggle, disabled while a LoRA is loaded (`CP:2068-2078`) | false | 29 |
| LM backend | pt | pt / vllm (`CP:2013-2022`) | - | (not sent to Gradio) |
| LM model | acestep-5Hz-lm-0.6B | 0.6B / 1.7B / 4B, `localStorage ace-lmModel` (`CP:2027-2037`) | - | (not sent to Gradio) |
| LM temperature | 0.8 | 0-2 step 0.1 (`CP:2120-2129`) | 0.85 | 28 |
| LM CFG scale | 2.2 | 1-3 step 0.1 | 2.0 | 30 |
| LM top-K | 0 | 0-100 | 0 | 31 |
| LM top-P | 0.92 | 0-1 step 0.01 | 0.9 | 32 |
| LM negative prompt | "NO USER INPUT" | text | same | 33 |
| Use ADG | off | checkbox; auto-on for non-turbo, auto-off when LoRA loads (`CP:364-370`) | false | 21 |
| CFG interval start / end | 0.0 / 1.0 | number 0-1 step .01 | same | 22 / 23 |
| Custom timesteps | '' | text | '' | 26 |
| CoT metas / caption / language | on / on / on | checkboxes; only applied when thinking (or enhance) is on (`AC:150-151, 188-190`) | | 34-36 |
| Allow LM batch ("parallel thinking") | on | checkbox | true | 39 |
| LM batch chunk size | 8 | 1-32 | 8 | 43 |
| Auto score | off | "getScores" checkbox | false | 40 |
| Auto LRC | off | "getLrc" checkbox | false | 41 |
| Score scale | 0.5 | 0.01-1 | 0.5 | 42 |
| Autogen | off | checkbox | false | 50 |
| Constrained decoding debug | off | checkbox | false | 38 |
| Is-format-caption | false | checkbox, auto-set by Format | false | 37 |

Hard-coded in `buildGradioArgs` and not user-controllable: cover noise strength 0.0 (idx 19), enable normalization true (46), normalization dB -1.0 (47),
latent shift 0.0 (48), latent rescale 1.0 (49) (`AC:173, 200-203`). The Python fallback also lacks `--lm-backend/--lm-model` (comment `AC:712`)
and defaults guidance to 10.0 (`AC:674`).
Auto-score and auto-LRC results are requested, but the server never reads them back from the Gradio output (only audio list + details string are used),
so the UI cannot show scores or timestamped lyrics.

Music parameters card: BPM slider 0-300 step 5 (0 = Auto, `CP:1841-1850`; README claims 60-200), Key select (Auto + 34 values, C..B major/minor incl.
enharmonic duplicates, `CP:30-49`), Time signature select (Auto, 2, 3, 4, 6, "N/A", `CP:51`).

## 8. Task types: text2music, cover, repaint (inpaint), audio2audio, track controls

Task-type selector lives in Advanced > Transform (`CP:2225-2236`): Text to Music / Audio->Audio / Cover / Repaint. Server maps `audio2audio` to `cover` before
calling the engine (`AC:174`, Python `AC:688`). `taskType` default `text2music`.

- **Cover:** pick a source audio in the Audio card's "Cover" tab (section 9); selecting a source auto-switches the task to `cover` if it was
  text2music (`CP:909-911`). Controls: Audio cover strength 0-1 (default 1.0, number input step .01, `CP:2237-2250`), Instruction text (default
  "Fill the audio semantic mask based on the given conditions:", `CP:197`, always sent, overriding the server default at `AC:171`). Server guard:
  cover/audio2audio needs sourceAudioUrl or audioCodes (`AC:487-492`); and a source that cannot be read from disk raises an error (`AC:144-148`).
  Gradio args: source audio idx 13, strength 18, task 20, instruction 17.
- **Repaint / inpaint a section:** task `repaint` + source audio + two plain number boxes, "Repainting start" (default 0) and "Repainting end"
  (default -1 = to end), in seconds, step 0.1 (`CP:2253-2272`; sent as args 15, 16). There is no waveform region picker; the user types seconds.
  Same source-audio guard as cover (`AC:145-148`). Python fallback only sends repaint bounds when > 0 (`AC:698-699`).
- **Audio codes ("LM codes hint"):** textarea in Transform (`CP:2187-2193`), arg 14. Two helper buttons "Convert to Codes" and "Transcribe" are
  inert stubs that only `console.log` (`CP:2195-2220`); the Gradio lambdas are not exposed.
- **Track controls:** "Track name" select (`woodwinds, brass, fx, synth, strings, percussion, keyboard, guitar, bass, drums, backing_vocals, vocals`,
  `CP:53-56, 2352-2364`) and multi-check "Complete track classes" (same 12, `CP:2366-2390`), sent as args 44 and 45. The task selector has no
  `lego`, `extract` or `complete` options, so these fields only matter if the engine reads them under the four exposed task types.
- **Extend / continue:** not implemented (no task type, no button, no code path).
- **Remix:** not a feature. The closest flows are Reuse prompt, Cover (source audio), and Reference audio.

## 9. Reference audio and source (cover) audio

UI: "Audio" card at the top of Custom mode with two tabs, Reference and Cover (`CP:1374-1550`; tab state `audioTab`). Each tab shows a player
(play/pause, time, clear X: `CP:1417-1520`) or an empty drop zone; buttons "From library" and "Upload" (`CP:1522-1541`).

Ways to set it:
1. Upload (file picker, or drag a file anywhere onto the panel: window-level drag handlers `CP:618-673`, drop `CP:932-960`).
   `POST /api/reference-tracks` multipart `audio` (<= 50 MB; mp3/wav/flac/m4a/mp4, `referenceTrack.ts:19-36`), stored under
   `reference-tracks/<user>/<ts>.<ext>`, row in `reference_tracks`, returns `{track, whisper_available}` (`referenceTrack.ts:153-194`). UI then
   sets it as the current reference or source and, if `whisper_available`, immediately calls `POST /api/reference-tracks/:id/transcribe`
   (spawns the `whisper` CLI, model `base`, `--fp16 False`, txt output; cancel button; `referenceTrack.ts:40-107, 253-289`). Transcript goes into Lyrics only if lyrics are empty.
2. "From library" modal (`CP:2441-2733`): tab "Uploaded" lists `GET /api/reference-tracks` with preview play, "Use track", delete
   (`DELETE /api/reference-tracks/:id`); tab "Created" lists the user's own generated songs. Also a "paste URL" apply path (`CP:890-895`).
3. Drag a song row from the list onto the panel (custom MIME `application/x-ace-audio`, set in `SongList.tsx:518-522`).
4. Song menu actions "Use as reference" / "Cover song" (`App.tsx:1157-1189`, `SongDropdownMenu.tsx:138-154`) switch to Create with the URL pre-filled.
- Sent as `referenceAudioUrl` / `sourceAudioUrl` (+ titles). Server reads the local file from `server/public/audio` (or fetches an http URL) and wraps it
  with `handle_file()` for Gradio args 10 (reference) and 13 (source) (`AC:86-128`). Custom mode also accepts "reference audio only" as sufficient
  input (`GEN:275`). Engine owns how reference/timbre is used.
- Unused: `POST /api/generate/upload-audio` (25 MB, `GEN:157-208`; `generateApi.uploadAudio` has no caller).
- Details of a finished song list its reference/cover sources with a Play button (`components/RightSidebar.tsx:370-448`).

## 10. LoRA use at inference (not training)

- Collapsible "LoRA" card, custom mode only (`CP:1741-1830`): path textbox (default `./lora_output/final/adapter`), Load/Unload button, status text
  (Loaded/Unloaded), enabled toggle, scale slider 0-1 step 0.05 (default 1.0).
- Calls: `POST /api/lora/load {lora_path}` -> Gradio `/load_lora`; `/unload` -> `/unload_lora`; `/scale {scale}` -> `/set_lora_scale`
  (server validates 0-1); `/toggle {enabled}` -> `/set_use_lora`; `GET /api/lora/status` returns an in-memory object (`lora.ts:16-99`; status call has no UI user).
  Loading auto-disables Thinking and ADG (`CP:364-370`); changing the DiT model auto-unloads (`CP:356-362`).
- State is process-memory on the server and the engine, not per user and not persisted.

## 11. Stems

- Not an ACE-Step feature here. "Extract stems" (song menu `SongDropdownMenu.tsx:125-135, 191-192`; right sidebar button `RightSidebar.tsx:318-326`)
  opens a separate browser page `/demucs-web/?audioUrl=<url>` in a new tab (served statically with COOP/COEP headers, `server/src/index.ts:90-106`).
- Page (`server/public/demucs-web/app.js` + `index.html`): Demucs ONNX (htdemucs) fully in-browser via onnxruntime-web, WebGPU if present else WASM
  (`app.js:54-71`). Outputs 4 stems: drums, bass, other, vocals (`src/constants.js:11`), 44.1 kHz, segment 343980 samples, overlap 0.25. Each stem
  gets an audio player and a WAV download; "Download all" loops with 500 ms spacing (`app.js:267-358`). Drag-drop or file picker also works.
- **Network at runtime:** `onnxruntime-web` is imported from `cdn.jsdelivr.net` (`app.js:4`) and the ~172 MB model is downloaded from
  `huggingface.co/timcsy/demucs-web-onnx` (`constants.js:15`, `app.js:111-119`), falling back to `../models/htdemucs_embedded.onnx` (no such file ships).
  The server CSP explicitly whitelists those hosts. Not local-only.
- Stems are not saved to the library or database.

## 12. Audio editor (AudioMass, vendored)

- "Edit audio" opens `/editor?audioUrl=<url>` in a new tab (`SongDropdownMenu.tsx:121`, `RightSidebar.tsx:303`, `SongProfile.tsx:275`), static dir
  `server/audio-editor` with a loosened CSP (`index.ts:85-88`), patched by `audiomass-url-patch.js` to call `engine.LoadURL(audioUrl)`. `audiomass-editor/`
  at repo root is the upstream source copy (README only runs it standalone on port 5055). Listed from string search in the bundle, not exhaustive:
  - Edit: cut/copy/paste, trim, delete, silence/insert silence, select/region, loop, undo/redo, zoom, channel and mono/stereo handling, record from mic.
  - Effects/tools: gain, normalize, fade in/out, reverse, invert, hard limiting, remove silence, compressor, reverb, delay, distortion presets ("Lo Fi",
    "Old Radio", "Spacey", chaotic/dashed distortion), graphic EQ and parametric EQ, change speed/rate, noise reduction (RNN wasm), frequency/spectrum analysis, ID3 tags.
  - Export: whole file or selection as WAV/MP3 (lame.js)/FLAC (libflac.wasm), local drafts, load from URL.
- Edits are not saved back to the library; the editor is a standalone tab, output goes to a browser download.

## 13. Library

- `components/LibraryView.tsx`: tabs All / Playlists / Liked / Uploads (`LibraryView.tsx:52`); "New playlist" button. "All" renders `SongList` with songs plus the user's
  reference uploads merged by date (`SongList.tsx:195-208`).
- `SongList.tsx`: search box (client-side over title, style, tags; `:163-171`), filter dropdown (Liked, Public, Private, Generating; `:174-181`), multi-select mode with
  Select all / Delete (bulk `DELETE /api/songs/:id` each, `App.tsx:1024-1045`), inline title edit (`PATCH /api/songs/:id {title}`, `SongList.tsx:492`; RightSidebar
  `:89`). Each row: cover, title, DiT model badge, lock icon when private, duration, queue/progress state, hover play, like, menu.
- Song menu (`SongDropdownMenu.tsx:120-185`): Create video, Edit audio, Extract stems, Reuse prompt, Use as reference, Cover song, Add to playlist, Download,
  Share, Delete (owner only).
- Right sidebar "Song details" (`RightSidebar.tsx`): cover, editable title, creator link, date, buttons (video, editor, reuse, stems, like, share, download),
  Sources, Tags/Style with copy, Lyrics with copy.
- Song page `SongProfile.tsx` for `/song/:id`.
- Persistence: `GET /api/songs` returns the user's rows (audio URL resolved, optional S3 path unused in local mode, `songs.ts:105-130`); cover images are
  `https://picsum.photos/seed/<id>/400/400` placeholders (`App.tsx:316, 655`); `AlbumCover.tsx` generates gradient art locally (README "Auto-generated gradient covers").
- Delete removes the audio file from storage and the row (`songs.ts:399-440`). Cron at 03:00 removes songs with NULL audio older than 7 days (`index.ts:418-426`, `cleanup.ts`).

## 14. Playlists

- Create: modal with name + description (`PlaylistModals.tsx:33-72`); `POST /api/playlists {name, description, isPublic, coverUrl}`; `isPublic` defaults false (`playlists.ts:20-42`).
  No UI control for public/private at create time; the detail page shows a Public/Private label (`PlaylistDetail.tsx:185`) but no toggle; `PATCH /api/playlists/:id`
  exists (`playlists.ts:207-241`, `playlistsApi.update API:522`).
- Add song: "Add to playlist" menu -> modal listing playlists (`PlaylistModals.tsx:97-150`) -> `POST /api/playlists/:id/songs {songId}` (`playlists.ts:156-186`).
- Detail page: song table (Title, Artist, Date added, duration), remove song (`DELETE /api/playlists/:id/songs/:songId`), delete playlist with `confirm()`.
- Public playlists appear in Search "Featured playlists" (`GET /api/playlists/public/featured`, `playlists.ts:64`) and user profiles. No reorder, no rename UI.

## 15. Search

- Page `SearchPage.tsx` (`/search`): debounced input (`handleSearchChange`, timeout ref) -> `GET /api/search?q=<q>&type=all` (`index.ts:331-398`).
  Server uses `LIKE %q% COLLATE NOCASE`: songs (public only, matching title or style, ordered by like_count, limit 20), creators (username LIKE, ordered by follower count),
  playlists (public, name LIKE). UI slices to a max per section. Empty query shows Featured songs (`GET /api/songs/public/featured`), featured creators (`/api/users/public/featured`
  plus creators derived from the songs), featured playlists, and the Genres chip strip. No lyrics search, no tag/BPM/key filters.
- The user's own songs also have a purely client-side search in the Library (section 13).
- Because generated songs are inserted public (`GEN:439`), they are searchable by anyone who can reach the server unless made private through the (UI-less) privacy endpoint.

## 16. Sharing

- Share modal (`ShareModal.tsx`): link `${origin}/song/<id>`; buttons X (twitter.com intent), Facebook, WhatsApp, Telegram, Reddit, LinkedIn, Email (mailto), Copy link
  (clipboard with `execCommand` fallback) (`ShareModal.tsx:62-125`). Opened from the song menu, right sidebar share icon, list rows.
- Server handler `GET /song/:id` (`index.ts:164-225`): normal browsers get a redirect to `${FRONTEND_URL}?song=<id>`; known social bots (twitter, facebook, slack, discord,
  telegram, whatsapp, etc.) get an HTML page with OpenGraph/Twitter meta tags (public songs only). `GET /api/oembed?url=` returns oEmbed JSON for `/song/<id>` (`index.ts:107+`).
- Only works across devices if the server is reachable (it binds 0.0.0.0 and logs LAN URLs, `index.ts:429-444`).
- Privacy toggle: `PATCH /api/songs/:id/privacy` and `songsApi.togglePrivacy` exist (`songs.ts:523-548`, `API:213`) but no component calls them; the only privacy UI is a lock badge and
  the list filter. Likes: `POST /api/songs/:id/like` toggles (UI heart, `App.tsx:977-1007`), counters like_count/view_count (`POST /api/songs/:id/play`, called from `App.tsx:956`).
- Comments: full API (`GET/POST /api/songs/:id/comments`, `DELETE /api/songs/comments/:id`, `songs.ts:573-653`) but no UI uses it.
- `POST /api/contact` and admin routes exist (`contact.ts`) with no UI caller.

## 17. Player

`components/Player.tsx`: bottom bar and fullscreen mode; play/pause, previous/next, shuffle, repeat none/all/one, volume with mute, seek bar, speed menu
0.25/0.5/0.75/1.0/1.25/1.5/1.75/2.0 (`Player.tsx:530, 738`), like, download, share, video, reuse. Space bar toggles playback outside inputs (`App.tsx:603-623`). Play count POSTed on play.

## 18. Video generator (music video maker, fully client-side)

- Modal `components/VideoGeneratorModal.tsx` (2414 lines), opened from song menu / sidebar / library ("Create video"). Canvas 1920x1080 (`:482-483, 1725`).
- Tabs: Presets, Style, Text, Effects (`:1767-2085`).
  - 10 visualizer presets: NCS Circle (Classic NCS), Linear Bars (Spectrum), Dual Mirror, Center Wave (Shockwave), Orbital, Hexagon (Hex Core), Oscilloscope (Analog),
    Digital Rain (Matrix), Shockwave (Pulse), Minimal (Clean) (`:77-88`).
  - Style: primary colour (default #ec4899), secondary (#3b82f6), background dim 0.6, particle count 50; background type random (picsum seed, `:272`), custom image upload,
    or video (upload or Pexels); custom album art (upload, URL via `/api/proxy/image`, or Pexels).
  - Text layers: default two (title at x50,y85,size52 white; UPPERCASE style at y92,size24 blue); add/edit layers (text, x/y %, size, colour, font).
  - 13 effects with per-effect intensity: shake (on by default 0.05), glitch, vhs, cctv, scanlines, chromatic, bloom, filmGrain, pixelate, strobe, vignette, hueShift, letterbox (`:160-200`).
- Pexels browser: photos/videos search; key stored in `localStorage pexels_api_key` and sent as header `x-pexels-api-key` to `/api/pexels/photos|videos` which proxy to
  `api.pexels.com` (`index.ts:254-329`; per_page 20/15, landscape).
- Export (`:478-909`): loads ffmpeg.wasm core 0.12.6 from unpkg then jsdelivr (`:232-233`), renders offscreen frame-by-frame at 30 fps, JPEG frames written to the ffmpeg FS, offline FFT analysis
  (`analyzeAudioOffline :417`), then `libx264 -preset ultrafast -tune fastdecode -crf 28 -pix_fmt yuv420p`, `aac 128k`, `-shortest`, `+faststart` to `output.mp4`, downloaded as
  `<title>.mp4` (`:852-891`). Progress bar with stages capturing/encoding. No server call except the image/Pexels proxies; no result is stored.
- Own feature (no engine involvement). Network: picsum.photos, unpkg/jsdelivr (ffmpeg core), pexels.

## 19. Training (LoRA), News, Auth/profile

**Training** (`components/TrainingPanel.tsx`, 1175 lines; routes `server/src/routes/training.ts`). Tabs Dataset / Train / Export; pipeline chips Upload -> Edit -> Save -> Preprocess -> Train -> Export (`:36-46`).
Everything trains inside the engine; the UI is a controller around Gradio functions.
- Model config (collapsible): checkpoint, config, device auto|cuda|mps|xpu|cpu, backend pt|vllm|mlx, init LLM, flash attention, CPU offload, DiT offload, compile, quantization
  -> `POST /api/training/init-model` -> `/init_service_wrapper`; returns HTTP 501 with a "use the Gradio UI" hint if the lambda is not exposed (`training.ts:481-530`). `GET /api/training/checkpoints`.
- Dataset: queue files (drag/drop; wav, mp3, flac, ogg, opus; <= 100 MB each, 50 files per call) -> `POST /api/training/upload-audio` (to `<ACE-Step>/datasets/uploads/<name>`, default `my_lora_dataset`);
  or scan a server path `POST /api/training/scan-directory`. `POST /api/training/build-dataset {datasetName, customTag, tagPosition(prepend|append|replace, UI default replace), allInstrumental(default true)}`
  writes a JSON (companion `.txt` per audio file used as lyrics) and loads it via `/load_existing_dataset_for_preprocess`. Genre/prompt ratio slider 0-100.
- Edit: per-sample editor (caption, genre, prompt override "Use Global Ratio", lyrics, BPM 120, key, time sig, language "instrumental", instrumental flag) via `GET /api/training/sample-preview`,
  `POST /api/training/save-sample` -> `/get_sample_preview`, `/save_sample_edit`. Auto-label (skip metas, format lyrics, transcribe lyrics, only unlabeled) -> `/auto_label_all` (501 hint if not callable).
  Save `POST /api/training/save-dataset` (`update-settings` is a no-op stub, `training.ts:721`).
- Preprocess: `POST /api/training/preprocess` spawns `scripts/preprocess_dataset.py --dataset --output --json` (default out `datasets/preprocessed_tensors`). Load tensors `/load_training_dataset`.
- Train: `POST /api/training/start` -> `/training_wrapper`, defaults rank 64, alpha 128, dropout 0.1, lr 0.0003, epochs 1000, batch 1, grad accum 1, save every 200, shift 3.0, seed 42,
  output `./lora_output`, optional resume checkpoint (`TrainingPanel.tsx:143-157`; `training.ts:785-822`). Sliders: rank 4-256, alpha 4-512, dropout 0-0.5, epochs 1-4000, batch 1-8, accum 1-16, save-every 50-1000, shift 1-5
  (`TrainingPanel.tsx:1052-1068`). **The start call is a single blocking `predict`** that returns progress/log/metrics when training ends (`training.ts:794-815`); there is no polling endpoint for live progress. `POST /api/training/stop` -> `/stop_training`.
- Export: `POST /api/training/export {exportPath, loraOutputDir}` -> `/export_lora` (defaults `./lora_output/final_lora`, `./lora_output`). `lora-checkpoints` and `import-dataset` endpoints exist but are unused by the UI.
- Result is then loaded at inference through the LoRA card (section 10).

**News** (`components/NewsPage.tsx`): static `data/news.json` (2 entries, Feb 2025: Gradio migration; LoRA training experimental), tag colours, dismissed IDs in `localStorage ace-dismissed-news`
with restore; GitHub star/link to `fspecii/ace-step-ui`. No network fetch. Not a music-news feed.

**Auth / profile (own, no engine)**
- No passwords. On boot the UI calls `GET /api/auth/auto`, which returns a JWT (365 days, `config/index.ts:44-47`) for the oldest user row without any credential (`auth.ts:21-59`); if none exists the
  username modal appears and `POST /api/auth/setup {username}` creates the user (2-50 chars, `[A-Za-z0-9_-]`) or, if the name exists, returns that user's token (`auth.ts:61-130`). So any client that can reach the server
  can become any user. Default JWT secret `ace-step-ui-local-secret` (`config/index.ts:45`). `PATCH /api/auth/username`, `POST /api/auth/refresh`, `POST /api/auth/logout` (client-side only).
- Settings modal (`SettingsModal.tsx`): account/username, language (en, zh, ja, ko; strings in `i18n/translations.ts`), theme light/dark, edit/view profile, about (version 2.0.0).
- Profile (`UserProfile.tsx`, `EditProfileModal.tsx`): avatar and banner upload (<= 5 MB, `users.ts:22, 165-222`), bio, username change, public songs (Recent/Top tabs), public playlists, follow/unfollow
  (`POST /api/users/:username/follow`), followers/following lists, stats. `GET /api/users/:username[/songs|/playlists|/stats]`.

## 20. Own vs delegated, and gaps (summary)

Delegated to ACE-Step (engine): text2music/cover/repaint audio generation, DiT models and switching (`/v1/init`), 5Hz LM (thinking, CoT, format_input), seed handling, duration/batch GPU limits, LoRA load/scale/toggle,
all dataset/auto-label/preprocess/training/export functions, random example prompts, normalization.
Owned by ace-step-ui: queue and polling, titles, song/playlist/user/like/follow/comment DB, library/search/sharing pages, reference-audio upload and Whisper CLI call, in-browser stems (Demucs ONNX), AudioMass editor,
video generator (canvas + ffmpeg.wasm), i18n, news, profile.

Not present: extend/continue, remix button, lego/extract/complete task types, LLM lyric writer (Gemini file is dead code), per-take seed readout, take comparison, score/LRC display, progress percentage, model switching from the UI
(ditModel/enhance dropped in `App.tsx:800-855`), saved presets, privacy toggle UI, comment UI, contact UI, playlist rename/reorder/public toggle UI.

Defects spotted (verified in code): `ditModel`/`enhance`/`loraLoaded` never reach the server (`App.tsx:800-855`); simple-mode Key/Time `onChange` receives the event (`CP:1321,1334`); `ace-batchSize` is read but never written (`CP:160`);
UI vs server default mismatch table in section 7; Format buttons require Style text even for lyrics (`CP:1573`); generated songs default public (`GEN:439`); auto-login token and username-only login (section 19);
Demucs page pulls code and a 172 MB model from CDNs at runtime (section 11); `picsum.photos` used for default covers and video backgrounds; the training start call blocks (section 19).
