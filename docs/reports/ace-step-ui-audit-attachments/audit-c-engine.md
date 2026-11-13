# ace-step-ui: engine side audit (task c)

Repo: `ace/repo` (fspecii/ace-step-ui). Paths below are relative to it. Read-only; nothing executed.
Key fact: this repo contains NO model code. It is a UI + Express/SQLite backend that drives an external ACE-Step 1.5 checkout (`ACESTEP_PATH`, default `../ACE-Step-1.5`) through its Gradio API (port 8001), with a Python-spawn fallback. Engine-level tricks (quantization, compile, flash attn, MPS) live in ACE-Step 1.5, not here.

## 1. Version and model variants

- Targets ACE-Step 1.5 only (`README.md:9`, `server/scripts/simple_generate.py:15` default path `ACE-Step-1.5`; Gradio args labeled "ACE-Step v1.5" at `server/src/services/acestep.ts:173,200-203`).
- DiT variants the UI offers (`components/CreatePanel.tsx:246-251`, server list `server/src/routes/generate.ts:607-614`):
  - `acestep-v15-turbo` (default checkpoint, bundled with main download, `generate.ts:608`; `simple_generate.py:40`)
  - `acestep-v15-base`, `acestep-v15-sft`, `acestep-v15-turbo-shift1`, `acestep-v15-turbo-shift3`, `acestep-v15-turbo-continuous`
  - UI default selection: `acestep-v15-turbo-shift3` (`CreatePanel.tsx:231`).
  - Any extra `acestep-v15-*` dir found in `checkpoints/` is listed too (user-trained/community) (`generate.ts:644-656`).
  - No XL variant referenced anywhere in this repo.
- Turbo detection is by name: `modelId.includes('turbo')` (`CreatePanel.tsx:269-271`). Step slider max is 20 for turbo, 200 otherwise (`CreatePanel.tsx:1965`).
- LM ("5Hz LM", planner/CoT) variants: `acestep-5Hz-lm-0.6B` (default), `-1.7B`, `-4B` (`CreatePanel.tsx:176-177,2033-2035`; `format_sample.py:31`). Backend `pt` (default) or `vllm` (`CreatePanel.tsx:175`; README:417 says PT ~1.6 GB VRAM, vLLM ~9.2 GB).
- Model switching at job time: the server asks `GET {api}/v1/models`, and if the active model differs POSTs `{api}/v1/init {model, init_llm:false}` (`acestep.ts:378-406`, called `acestep.ts:516-519`). This is the REST API of the ACE-Step process, separate from Gradio.
- Model list/availability: `GET /api/generate/models` checks `ACESTEP_PATH/checkpoints/<name>` existence (`generate.ts:599-676`). Download is by ACE-Step itself on init ("auto-downloaded on init", `generate.ts:605-606`; `format_sample.py:34-41` calls `download_submodel`). README: ~5 GB main model download (`README.md:270`).

## 2. Architecture and how the engine is launched

- Three processes: ACE-Step (8001), backend Express (3001), Vite frontend (3000) (`start-all.sh:110-112`).
- Launch command for ACE-Step: README/manual uses `uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1` (`README.md:193,219,329`). `start-all.sh:58` instead runs `uv run acestep-api --port 8001` (REST-only entry point; note mismatch with README, the Gradio path needs `acestep` + `--enable-api`).
- Windows portable: `python_embeded\python -m acestep ...` (`README.md:193`); python resolution order PYTHON_PATH, `python_embeded`, `env/.venv/venv` (`acestep.ts:42-73`).
- Env (`.env.example:1-25`): PORT 3001, NODE_ENV, DATABASE_PATH (SQLite), ACESTEP_API_URL=http://localhost:8001, AUDIO_DIR, FRONTEND_URL, VITE_API_URL, JWT_SECRET, PEXELS_API_KEY. Also read from process env: `ACESTEP_PATH`, `PYTHON_PATH`, `DATASETS_DIR`, `DATASETS_UPLOADS_DIR` (`config/index.ts:38-42`, `acestep.ts:33,44`).
- Gradio client: `@gradio/client`, lazily connected and cached (`services/gradio-client.ts:11-32`). Availability probe tries `/gradio_api/info`, `/info`, `/` with 5 s timeout (`gradio-client.ts:46-65`).
- Engine call: `client.predict('/generation_wrapper', args)` with 51 positional args; blocks until done (`acestep.ts:536`, "predict() blocks until generation is complete" `acestep.ts:535`). This couples tightly to Gradio's argument ORDER in ACE-Step 1.5; any ACE-Step UI change breaks it (a comment at `acestep.ts:205-206` notes hidden state vars must not be passed).
- Fallback: spawn `server/scripts/simple_generate.py` with CLI args, 600 s timeout (`acestep.ts:648-851`; script imports `acestep.handler.AceStepHandler`, `acestep.llm_inference.LLMHandler`, `acestep.inference.generate_music`, `simple_generate.py:20-22`).

## 3. Generation parameters (defaults and ranges)

Sources: server defaults in `buildGradioArgs` (`acestep.ts:133-208`), Python script defaults (`simple_generate.py:47-94,173-223`), UI defaults/ranges (`components/CreatePanel.tsx`). Where server and UI differ both are given. Server does NO range validation except batch clamp and the 25 MB upload limit; the request handler only checks presence of description/style/lyrics/reference (`generate.ts:270-278`).

| Param (JSON name) | Server default | UI default / range | Notes and cite |
|---|---|---|---|
| prompt/caption (`style`; simple mode `songDescription`) | 'pop music' | free text | `acestep.ts:134-135`; customMode picks style vs description |
| lyrics | '' (forced '' if instrumental) | text with `[Verse]` tags | `acestep.ts:136` |
| instrumental | false | toggle | lyrics dropped |
| vocalLanguage | 'en' | 'en'; list incl. `unknown` = auto/instrumental, ar, ... | `acestep.ts:159`; `CreatePanel.tsx:148,2xx VOCAL_LANGUAGE_KEYS` (script default 'auto', `simple_generate.py:56`) |
| duration (s) | -1 = auto | slider min -1 max `activeMaxDuration` (from `/limits`, fallback 240); the advanced slider shows -1..600 step 5, "Auto - 10 min" | `acestep.ts:165`; `CreatePanel.tsx:217-218,1294-1295,1913-1914`. README says 30-240 s; "4+ min" for full song. Python fallback uses 60 when unset (`acestep.ts:668`) |
| bpm | 0 = auto | 0..300 step 5 (README says 60-200) | `acestep.ts:156`; `CreatePanel.tsx:1305-1308` |
| keyScale | '' = auto | dropdown: 12 pitch names incl. sharps/flats, major/minor (KEY_SIGNATURES) | `CreatePanel.tsx:30-50` |
| timeSignature | '' = auto | '', '2','3','4','6','N/A' | `CreatePanel.tsx:52`. Format response normalises to `n/4` (`CreatePanel.tsx:715-716`) |
| inferenceSteps | 8 | UI 12; 1..20 turbo, 1..200 base/SFT | `acestep.ts:160`; `CreatePanel.tsx:173,1960-1965` |
| guidanceScale (DiT CFG) | 7.0 (script 10.0) | UI 9.0; 1..15 step 0.1 | `acestep.ts:161`; `CreatePanel.tsx:167,1970-1974` |
| shift | 3.0 | UI 3.0; 1..5 step 0.1 ("for base model") | `acestep.ts:178`; `CreatePanel.tsx:179,2078-2090` |
| inferMethod | 'ode' | type allows 'ode'/'sde' | `acestep.ts:179,282` |
| customTimesteps | '' | text | `acestep.ts:180` |
| useAdg (adaptive dual guidance) | false | toggle | `acestep.ts:175` |
| cfgIntervalStart/End | 0.0 / 1.0 | 0..1 inputs | `acestep.ts:176-177`; `CreatePanel.tsx:2242-2243` |
| seed / randomSeed | -1 / true | seed number; random toggle | `acestep.ts:162-163` (seed passed as string) |
| batchSize | 1 | UI 1..4 (README 1-4); server clamps 1..16 | `acestep.ts:166`; `CreatePanel.tsx:1349-1358,1926-1927` |
| bulkCount | n/a | 1..10 (independent sequential jobs, frontend-only) | `README.md:416`; `CreatePanel.tsx:163` |
| audioFormat | 'mp3' | 'mp3' or 'flac' (server type); script also accepts wav | `acestep.ts:181,281`; `simple_generate.py:190` |
| thinking (LM CoT, audio codes) | false | false (comment: GPU compat) | `acestep.ts:137,183`; `CreatePanel.tsx:170` |
| enhance ("AI Enhance") | false | false | UI-added; enables CoT metas/caption/language without full thinking (`acestep.ts:138,150-151`; README:405-407) |
| useCotMetas / useCotCaption / useCotLanguage | true, but forced false unless enhance or thinking | true | `acestep.ts:188-190` |
| lmTemperature | 0.85 | UI 0.8 | `acestep.ts:182`; `CreatePanel.tsx:183` |
| lmCfgScale | 2.0 | UI 2.2; slider 1..3 | `acestep.ts:184`; `CreatePanel.tsx:184,2136-2137` |
| lmTopK | 0 | 0; 0..100 | `acestep.ts:185`; `CreatePanel.tsx:2150-2151` |
| lmTopP | 0.9 | UI 0.92; 0..1 | `acestep.ts:186`; `CreatePanel.tsx:186,2159-2160` |
| lmNegativePrompt | 'NO USER INPUT' | same | `acestep.ts:187` |
| lmBackend / lmModel | not sent to /generation_wrapper (only used for format; "not supported by simple_generate.py" `acestep.ts:712`) | pt/vllm; 0.6B/1.7B/4B | the LM actually used is whatever ACE-Step was started with |
| isFormatCaption | false | set true after style format | `acestep.ts:191` |
| allowLmBatch ("ParallelThinking") | true | | `acestep.ts:193` |
| lmBatchChunkSize | 8 | 1..32 | `acestep.ts:197`; `CreatePanel.tsx:2342-2343` |
| getScores (auto score) / scoreScale | false / 0.5 | scale 0.01..1 | `acestep.ts:194,196`; `CreatePanel.tsx:2331-2332` |
| getLrc (timestamped lyrics) | false | | `acestep.ts:195` |
| autogen | false | | `acestep.ts:204` |
| constrainedDecodingDebug | false | | `acestep.ts:192` |
| ditModel | none | default `acestep-v15-turbo-shift3` | triggers `/v1/init` |
| Hard-coded in args | enable normalization true, normalization dB -1.0, latent shift 0.0, latent rescale 1.0, cover noise strength 0.0 | not exposed | `acestep.ts:173,200-203` |

Not present anywhere in this repo: scheduler choice (only `inferMethod` ode/sde), omega scale / ERG ("guidance omega"), guidance for text/lyric separately (APG/lyric guidance), explicit CFG-distillation toggle, sampler step-skipping. ADG, CFG interval, shift and custom timesteps are the closest knobs.

### Parameter-to-arg order (ACE-Step Gradio `/generation_wrapper`, index: meaning)
0 caption, 1 lyrics, 2 bpm, 3 key, 4 time sig, 5 vocal lang, 6 steps, 7 guidance, 8 random seed, 9 seed, 10 reference audio, 11 duration, 12 batch, 13 source audio, 14 LM codes hints, 15 repaint start, 16 repaint end, 17 instruction, 18 audio cover strength, 19 cover noise, 20 task type, 21 ADG, 22-23 CFG interval, 24 shift, 25 infer method, 26 custom timesteps, 27 audio format, 28 LM temp, 29 think, 30 LM CFG, 31 top-k, 32 top-p, 33 LM neg prompt, 34-36 CoT metas/caption/language, 37 is-format-caption, 38 constrained-debug, 39 parallel thinking, 40 auto score, 41 auto LRC, 42 score scale, 43 LM batch chunk, 44 track name, 45 track names (complete), 46 normalization on, 47 norm dB, 48 latent shift, 49 latent rescale, 50 autogen (`acestep.ts:153-207`).
Outputs: 0-7 samples, 8 all files list, 9 details string, 10 status, 11 seed (`acestep.ts:543-551`).

## 4. Tasks

- Supported `taskType` values passed through: `text2music`, `cover`, `repaint`; UI also offers `audio2audio` which is mapped to `cover` (`CreatePanel.tsx:2230-2233`; `acestep.ts:174,688`). UI task dropdown: text2music, audio2audio, cover, repaint only.
- The Python script's CLI accepts `text2music, cover, repaint, lego, extract, complete` (`simple_generate.py:194-196`), and Gradio args include `trackName` (44) and `completeTrackClasses` (45) with a TRACK_NAMES list (woodwinds, brass, fx, synth, strings, percussion, keyboard, guitar, bass, drums, backing_vocals, vocals) (`CreatePanel.tsx:54-57`). So lego/extract/complete are plumbed in types and Gradio args but there is no UI task option for them in the dropdown (checked `CreatePanel.tsx:2225-2236`). No "retake" or "extend" task exists. Extend is only reachable as `complete`.
- Cover/repaint guards: need source audio or audio codes (`acestep.ts:144-148,487-492`); repaint region `repaintingStart` (default 0) and `repaintingEnd` (-1 = end) (`acestep.ts:169-170`); instruction default "Fill the audio semantic mask with the style described in the text prompt." (`acestep.ts:171`; UI default has a different string "Fill the audio semantic mask based on the given conditions:" `CreatePanel.tsx:197`).
- Reference audio (style/timbre), source audio, and `audioCodes` (LM codes hint) all supported. UI auto-switches text2music to cover when source audio set (`CreatePanel.tsx:909-910`). Audio upload limit 25 MB, mp3/wav/flac/m4a/mp4/aac/ogg/webm/opus (`generate.ts:49-80`). Files stored under `references/<userId>/...` (`generate.ts:199`), read from disk and uploaded to Gradio via `handle_file(Blob)` (`acestep.ts:105-128`).
- Stems: not done by ACE-Step. A bundled client-side Demucs ONNX page at `/demucs-web` (static, COOP/COEP, HF + jsdelivr fetched, `index.ts:90-106`) and AudioMass editor at `/editor` (`index.ts:84-88`). Both opened from song menus (`components/SongDropdownMenu.tsx:133`).

## 5. Job queue, polling, progress

- Two layers:
  1. Route layer persists a row in `generation_jobs` (queued -> running) with local UUID, then calls `generateMusicViaAPI` and stores the ACE task id (`generate.ts:338-358`). Response is `{jobId, status:'queued', queuePosition:1}` (hard-coded 1).
  2. In-memory FIFO in `acestep.ts`: `jobQueue` array, `processQueue` runs strictly one job at a time (GPU single worker) (`acestep.ts:365-451`). Job ids `job_<ts>_<rand>`. Old jobs purged hourly (`acestep.ts:362-363`, 1 h TTL). Queue is lost on restart (no recovery).
- `generationQueue.ts` (tiers free/pro/unlimited, max 3 workers, per-user 1, batch window 3 s) exists but is not referenced by the routes (`generate.ts` imports only `acestep.js`); dead code. `server/src/scripts/test-queue.ts` exercises it.
- Polling: client polls `GET /api/generate/status/:jobId` every 2000 ms (`App.tsx:703-742`). Status reads in-memory job and, on success, downloads audio to storage and inserts `songs` rows using an optimistic-lock UPDATE to avoid duplicates (`generate.ts:387-488`). One song row per variation, title suffix `(v1)`, `(v2)` (`generate.ts:421-424`).
- Progress is fake/coarse: no streaming from Gradio. Stages: 'Starting generation...', 'Loading model X...', 'Generating music via Gradio...' (`acestep.ts:485,517,533`). `progress` never set. ETA hard-coded 180 s per queue position / 180 s minus elapsed (`acestep.ts:887,894`). Queued position is real. No cancel endpoint.
- Failure: Gradio error falls back to Python spawn (cold-loads models in a second process; `simple_generate.py:28-45` with `offload_to_cpu=True`, comment "For 12GB GPU", LM not initialized) (`acestep.ts:497-507`).
- Debug: `GET /api/generate/debug/:taskId` returns raw gen details (`generate.ts:759-770`).

## 6. File storage

- Generated audio: first downloaded from Gradio output (filesystem copy of Gradio temp path, else HTTP fetch with tmp+rename, `acestep.ts:215-245`) to `server/public/audio/<jobId>_<n>.<ext>` (`acestep.ts:581-587`), then re-uploaded under `<userId>/<songId>.<ext>` via the storage provider (`generate.ts:429-433`). Duplicate copy of each file remains in `public/audio` (cleanup service is for deletions: `services/cleanup.ts`, cron 03:00 daily `index.ts:418-426`).
- Provider: local only (`config/index.ts:32-36`; `storage/local.ts`), served by Express static `/audio` (`index.ts:82`). Public URL form `/audio/<key>`.
- Format preserved: `.flac` if Gradio name contains flac, else configured format (`acestep.ts:583`). `wav`/`ogg` outputs are not accepted by the storage step: route filters only mp3/flac/wav (`generate.ts:414-417`) but the ext logic maps anything non-flac to `.mp3` (`generate.ts:430`) (minor bug).
- Duration via `ffprobe` (requires ffmpeg on PATH) (`acestep.ts:8-20`).
- DB: SQLite (`DATABASE_PATH`), tables incl. `generation_jobs`, `songs` (stores full `generation_params` JSON; `generate.ts:435-455`). Metadata (bpm, key, time sig) scraped from Gradio "details" text by regex (`acestep.ts:620-642`).

## 7. Lyric / caption formatting helpers (LLM use)

- `POST /api/generate/format` (`generate.ts:773-909`): primary path calls ACE-Step REST `POST {api}/format_input` with `{prompt, lyrics, temperature, param_obj{bpm,duration,key,time_signature}}`, 5-minute timeout, expects `{code:200, data:{caption,lyrics,bpm,duration,key_scale,time_signature,vocal_language}}`. Fallback only on ECONNREFUSED: spawn `server/scripts/format_sample.py` (uses `acestep.inference.format_sample` with `use_constrained_decoding=True`, LM default 0.6B, backend pt, offload_to_cpu, auto-downloads LM via `download_submodel`, `format_sample.py:18-60`).
- So the "LLM" is ACE-Step's own 5Hz LM (0.6B/1.7B/4B), local. No external LLM for lyrics in the server. UI frontend has `services/geminiService.ts` (Google Gemini 2.5 flash, JSON title/lyrics/tags, mock fallback with no key). It reads `process.env.API_KEY`; it would be a phone-home path, not relevant for local-only design.
- `GET /api/generate/random-description` -> Gradio `/load_random_simple_description` returns [description, instrumental, vocalLanguage] (`generate.ts:679-694`).
- Simple mode vs custom mode: simple sends only a description as caption; "AI Enhance"/Thinking lets the LM write caption, lyrics structure, BPM, key, language (README:401-409).
- Auto title: first non-tag lyric line (<=40 chars), else first 4 words of style (`generate.ts:26-47`).
- Lyric conventions: section tags `[Verse]`, `[Chorus]` (README table, `autoTitle` skips `^\[.*\]$`). Instrumental -> lyrics saved as `[Instrumental]` (`generate.ts:444`). Reference audio transcription (`isTranscribingReference` state in `CreatePanel.tsx:275`) exists on the UI side; not traced on server.

## 8. LoRA (inference) and training pipeline

Inference (`server/src/routes/lora.ts`, in-memory state only; `loraState` global, single shared):
- `POST /api/lora/load {lora_path}` -> Gradio `/load_lora`; `unload` -> `/unload_lora`; `scale` 0..1 -> `/set_lora_scale`; `toggle` -> `/set_use_lora`; `GET /status` (`lora.ts:16-97`). UI default path `./lora_output/final/adapter`, scale 1.0 (`CreatePanel.tsx:222-225`). `api.ts:389` comment: "requires ACE-Step training fork".
- LoRA state is global to the ACE-Step process, not per job.

Training (`server/src/routes/training.ts`, 874 lines, UI `components/TrainingPanel.tsx`):
- Flow: upload audio (<=50 files multer, `training.ts:77`) to `ACE-Step-1.5/datasets/uploads/<name>`; `build-dataset` scans audio, reads sibling `.txt` lyrics, writes Gradio-format dataset JSON with custom tag / tag position (prepend), all-instrumental default true (`training.ts:105-135`); `scan-directory`; optional `auto-label` -> Gradio `/auto_label_all` (skipMetas, formatLyrics, transcribeLyrics, onlyUnlabeled; returns 501 with hint if the lambda isn't a named endpoint, `training.ts:441-479`); `init-model` -> `/init_service_wrapper` with checkpoint, config, device, initLlm, lm path, backend, `useFlashAttention`, `offloadToCpu`, `offloadDitToCpu`, `compileModel`, `quantization` (all default false; `training.ts:481-530`).
- Preprocess: spawns `server/scripts/preprocess_dataset.py` (standalone, loads VAE + text encoder, outputs `.pt` tensors, `--max-duration` default 240 s, no Gradio needed) into `datasets/preprocessed_tensors` (`training.ts:306-365`; script header lines 1-26, uses `acestep.training.dataset_builder.DatasetBuilder`).
- Train: `POST /api/training/start` -> `/training_wrapper` with defaults: tensorDir `./datasets/preprocessed_tensors`, rank 64, alpha 128, dropout 0.1, lr 3e-4, epochs 1000, batch 1, grad accumulation 1, saveEvery 200, shift 3.0, seed 42, output `./lora_output`, optional resume checkpoint (`training.ts:785-822`). This call is a blocking Gradio predict, returns [progress, log, metrics]; no live progress stream through this API (UI must poll elsewhere or wait). `/stop` -> `/stop_training`; `/export` -> `/export_lora` (default `./lora_output/final_lora`); `/import-dataset` train/test; `/save-sample`, `/sample-preview`, `/load-dataset`, `/load-tensors`, `/checkpoints`, `/lora-checkpoints` (`training.ts:532-873`).
- Training requires ACE-Step 1.5 with its training module (`acestep.training`); relies on named Gradio endpoints that may not exist (explicit 501 handling).

## 9. Speed tricks and memory

Exposed or configured in this repo:
- `offload_to_cpu=True` always in the Python fallback and LM format helper (`simple_generate.py:42`, `format_sample.py:54`).
- `init-model` passes through flash-attention, CPU offload, DiT CPU offload, `torch.compile` (`compileModel`) and `quantization` flags to ACE-Step, all default false (`training.ts:489-495,500-512`). The generation UI does not expose them; they are set at ACE-Step startup/Gradio service-config section.
- bf16/fp16 dtype: not set here (engine decides; `preprocess_dataset.py` takes dtype from the pipeline).
- Turbo models: 8 steps default server side (`acestep.ts:160`), step slider capped at 20 for turbo; the `--enable-api --backend pt` flags select the PT LM backend (README:417).
- GPU capability tiers: `get_limits.py` imports `acestep.gpu_config.get_gpu_config()` and returns `tier, gpu_memory_gb, max_duration_with_lm/without_lm, max_batch_size_with_lm/without_lm` (`get_limits.py:9-21`), served at `GET /api/generate/limits` and used to cap the duration slider (`CreatePanel.tsx:217-218`).
- Memory requirements stated in README: NVIDIA GPU 4 GB+ VRAM without LLM, 12 GB+ recommended with LLM (`README.md:152`); 4 GB works with batch 1, PT backend, thinking OFF; Thinking auto-disabled under 12 GB (`README.md:253-257,439-440`); 8 GB should keep batch 1 (`README.md:415`); LM PT ~1.6 GB vs vLLM ~9.2 GB (`README.md:417`). CPU RAM unspecified. Model download ~5 GB.
- Batch >1 uses LM batching with `lmBatchChunkSize` 8 (`acestep.ts:197`).

## 10. Apple Silicon / MPS

- The only MPS handling in the repo: device pick cuda -> mps -> cpu in `simple_generate.py:31-36` and `format_sample.py:42-47` (`torch.backends.mps.is_available()`). `init_service` receives `device=` accordingly.
- README never mentions Apple Silicon/MPS; README's requirements list only NVIDIA GPU (`README.md:152`). Scripts assume Linux/Windows. `start-all.sh` uses `ip route ... grep -oP` (GNU only) with `ifconfig` fallback, and `open` for macOS browser, so macOS is a "supported" shell path (`start-all.sh:40-44,137-141`). No MPS-specific flags (no `PYTORCH_ENABLE_MPS_FALLBACK`, no MLX path, no vLLM exclusion). vLLM backend would not work on Mac; PT backend is the default. Whether ACE-Step 1.5 itself runs well on MPS must be checked in that repo, not here.

## 11. Other server routes worth knowing

- `GET /health` and `/api/generate/health` (Gradio reachable) (`index.ts:109`, `generate.ts:696`).
- `GET /api/generate/audio?path=` proxies audio from disk/URL/Gradio (`generate.ts:523-569`); note it reads absolute paths from disk (`acestep.ts:931-941`): path traversal risk for any hardening review. `/api/proxy/image?url=` is an open SSRF fetch proxy (`index.ts:228-252`).
- Auth: JWT (365 d, default secret `ace-step-ui-local-secret`) (`config/index.ts:44-48`), local single-user feel; server listens on `0.0.0.0` (`index.ts:429`).
- Third-party calls: Pexels proxy (video backgrounds), Gemini service (frontend), HuggingFace/jsdelivr from the Demucs page, picsum.photos cover fallback in share metadata (`index.ts:192`). All would need removal for a private/local-only product.

## 12. Takeaways for reuse

1. Reusable idea: thin Node adapter over ACE-Step's Gradio API + REST (`/v1/init`, `/v1/models`, `/format_input`, `/v1/audio`). Fragile because of the 51-positional-arg contract; better to talk to ACE-Step's native REST (`acestep-api`) or Python directly.
2. Progress reporting is absent; a better design should stream Gradio events (client already enables `events: ["data","status"]`, `gradio-client.ts:18`) or use the REST task API.
3. Missing from the UI but available in args: lego, extract, complete tasks, track selection, LRC output, scoring.
4. Dead code and risks: `generationQueue.ts` unused, queue not persisted, SSRF/path-read endpoints, default JWT secret.
