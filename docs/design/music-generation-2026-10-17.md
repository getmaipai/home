# Music generation: songs made and edited in chat (2026-10-17)

Owner scope, 2026-10-17 (relayed by the coordinator): "build it into chat first, the same way image generation and editing work. A
person asks in chat to create a song (words or lyrics, style, mood, length) and can then edit it conversationally (make it slower,
change the chorus lyrics, swap the vocals for instrumental, extend it, make a version in a different genre, cut or trim, fade,
variations), with originals kept, undo, versions as attachments with provenance, progress and a playable result card in the chat.
Save to library into the Music app comes second. A separate music creation and editing studio app is explicitly later." The owner's
earlier approvals for generation stand ("make your owner decisions, you have all approvals from me", 2026-10-17; adults are adults,
minors and the absolute lines blocked). The engine pick was already the owner's (Stack `docs/plans/jev-and-yue-2026-09-20.md`,
STACK-99: ACE-Step 1.5, YuE2 rejected); this note confirms it by measurement.

Every number below was measured on the Studio (Apple M5 Max, 128 GB, macOS 27) under the shared GPU lock while the live Stack ran
(two `omlx-server` processes, about 21 GB resident), so times are upper bounds. Scripts, logs and clips are in the author's scratchpad
(`scratchpad/music`, section 6).

## 1. The pick

| | Pick | Licence | Why |
|---|---|---|---|
| Model | **ACE-Step 1.5**: the 2B turbo DiT (`acestep-v15-turbo`, 8 steps), the 5 Hz planning LM (`acestep-5Hz-lm-1.7B` on p128, `-0.6B` on p64), the Qwen3-Embedding-0.6B text encoder and the music VAE, all from `ACE-Step/Ace-Step1.5` | MIT (code: the repository's LICENSE; weights: the `license: mit` field of every card used). The card states the training set is licensed music, royalty-free or public-domain music, and synthetic MIDI-rendered audio, and that output may be used commercially | Full songs with sung lyrics, structure tags (`[Verse]`, `[Chorus]`), 50+ languages, 10 s to 10 min, and the edit tasks the owner asked for (repaint a section, extend, cover in another style, remake) **in the same model**; an official, in-repository Apple silicon path (MLX DiT, MLX VAE, MLX LM), no fork |
| Runtime | ACE-Step's own Python package (commit `ca1e85f`) driven in-process by a Stack worker (no `acestep-api` server, no port), torch 2.10 on MPS for the text encoder, MLX 0.30.6 for the DiT, VAE and LM | MIT | The video engine's pattern: one managed Python 3.12 environment, one JSON-lines worker, offline at generate time |
| Beds, effects, stings | **Not a second model in v1.** ACE-Step makes instrumentals (`[Instrumental]`) from 10 s; a sting shorter than 10 s is a trim of one (section 4) | | Stable Audio 3.0 needs Stability's Community licence ($1M revenue ceiling), the same revenue bar the video note used to reject LTX; it is a later row (MUSIC-GEN-11) behind that licence gate, never a default |
| Tiers | p128 (quick and detailed, up to 240 s) and p64 (quick only, up to 120 s); p16 and p32 off | | Peak memory measured in section 4.2: 32 GB worst, admitted at 33 GB |

## 2. Candidates and why each lost (licence texts read 2026-10-17)

| Candidate | Licence (read) | Result |
|---|---|---|
| **ACE-Step 1.5 XL (4B DiT)** | MIT | Same family, 20 GB of DiT weights; a later quality profile for p128 (MUSIC-GEN-10), not measured here because the 2B turbo already meets the bar |
| **MiniMax Music 3** (Aug 2026) | MiniMax-Music3 Community License: prior written authorisation above $20M yearly revenue, and "You shall prominently display 'MiniMax-Music3' on the user interface"; the card says "Inference requires CUDA" | **Rejected** on the revenue bar and the branding clause, and it has no Apple path (only a one-person MLX conversion) |
| **YuE2** | CC BY-NC 4.0 weights (commercial use needs the authors' permission) | **Rejected** (non-commercial, CUDA-first), as the Stack's 2026-09-20 research already found |
| **MusicGen / AudioCraft** | CC BY-NC 4.0 weights | **Rejected** (non-commercial), as the Apple silicon plan already recorded |
| **Stable Audio 3.0 / Stable Audio Open** | Stability Community licence, "less than $1M in annual revenue", Enterprise above | Deferred to MUSIC-GEN-11 behind a licence gate; tracks it makes would carry `commercial_use: personal_only` (section 8) |
| **DiffRhythm 2** | Apache-2.0 (search result, not re-read) | Not benchmarked: no Apple silicon path documented, up to 210 s, no edit tasks |
| **Tencent SongGeneration v2** | Not confirmed (the card answers 401 to an anonymous read) | Not benchmarked; an unverified licence is not a candidate |

## 3. Runtime: how the Stack runs it

- **Engine**: a managed Python 3.12 environment `music-gen` built by the Stack's uv builder from ACE-Step's own `uv.lock` resolved for
  `darwin arm64`, hashed, about 1.2 GB on disk (measured). No `nano-vllm` (not installed on Apple silicon by the project's own markers),
  no Gradio server is started, no training extras at run time. One worker speaks JSON lines on stdin and stdout, starts on the first
  music job, keeps its models for the keep-warm window (5 idle minutes: songs come in bursts of edits), then exits and returns its memory.
- **Offline at generate time.** The worker runs with `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1` and
  `ACESTEP_CHECKPOINTS_DIR` set to the Stack's model folder. Source read: the only network paths in the runtime are the model downloader
  (Hugging Face or ModelScope, plus a `_can_access_google` probe that picks between them) and the OpenRouter and external-LM helpers of the
  Gradio UI; the worker never calls the downloader (the Stack installs the pins first) and imports neither UI module. The macOS launch
  scripts' `git fetch` update check is not used. A privacy test asserts zero outbound connections from the worker (MUSIC-GEN-08).
- **Pins (download, never vendor)**: `ACE-Step/Ace-Step1.5` revision `19671f406d603126926c1b7e2adc169acbcade22`: `acestep-v15-turbo/model.safetensors`
  4.79 GB (sha256 `3f6e0797...22d7`), `acestep-5Hz-lm-1.7B/model.safetensors` 3.71 GB (`f161689d...7db8`), `Qwen3-Embedding-0.6B/model.safetensors`
  1.19 GB (`0437e45c...23fd`), `vae/diffusion_pytorch_model.safetensors` 337 MB (`da17edb6...99b0`), `acestep-v15-turbo/silence_latent.pt` 3.8 MB
  (`a778e9dd...358b`), plus configs and tokenizers: 10.09 GB. `ACE-Step/acestep-5Hz-lm-0.6B` revision `148d8ea0225bdab342ee1ae3a354275ccd60ca80`: 1.37 GB.
  Every hash was checked against the Hub's LFS record after download. Full hashes are in the Stack's model catalog.
- **Two things the Stack must not trust from the weights repository.** The checkpoint folder ships `modeling_acestep_v15_turbo.py`; ACE-Step
  overwrites it from its own pinned package (`_sync_model_code_if_needed`), so the code that runs is the pinned package's, never the model
  repository's. `silence_latent.pt` is a pickle; ACE-Step's loader opens it with `torch.load(..., weights_only=True)` (read in
  `init_service_loader.py`), which refuses code objects, and its sha256 is pinned.
- **Memory controls.** On a 128 GB Mac ACE-Step picks an untiled VAE decode and MLX keeps a large buffer cache, which is what drove the peaks in
  section 4's first run. The worker sets `ACESTEP_MLX_VAE_CHUNK=256` (tiled decode) and `mx.set_cache_limit(2 GB)`; section 4 measures both.

## 4. Measurements

### 4.1 First run: ACE-Step's defaults (LM 1.7B, untiled decode), one process, warm after the first job

`scripts/bench.py`, seeds fixed, 8 turbo steps, 48 kHz stereo WAV out. Load once: imports 37.9 s (first import after install compiles
bytecode; later starts are faster), DiT, VAE and text encoder 12.3 s, LM 13.8 s. Times are seconds of wall clock per job; the stage
columns are ACE-Step's own timers.

| Job | Wall | Planning LM | DiT (8 steps) | VAE decode |
|---|---:|---:|---:|---:|
| 30 s instrumental (first job, includes compile) | 26.2 | 10.4 | 2.3 | 2.2 |
| 30 s song with lyrics | 15.7 | 12.3 | 0.7 | 1.3 |
| extend that song by 20 s (repaint past the end) | 7.0 | none | 1.0 | 2.1 |
| cover as a jazz piano instrumental (strength 0.6) | 3.5 | none | 0.5 | 1.3 |
| remake at 84 bpm ("make it slower") | 9.9 | 7.0 | 0.7 | 1.3 |
| 60 s song with lyrics | 21.6 | 16.2 | 1.4 | 2.7 |
| rewrite the chorus (repaint 20 to 40 s with new words) | 6.1 | none | 1.0 | 2.5 |

The planning LM is two thirds of a new song; an edit skips it and takes 3.5 to 7 s. **Memory, sampled every 4 s with `footprint`:** 23 to
25 GB resident between jobs, but the peak footprint climbed with length during each VAE decode: **48 GB** at a 30 s decode, **64 GB** at
50 s, **71 GB** at 60 s. On a 128 GB Mac with chat resident that is unsafe, and it is not the weights (10 GB): ACE-Step picks an untiled
decode when it sees a large unified memory, and MLX keeps freed buffers in its cache. Section 4.2 measures the fix.

### 4.2 The production settings (tiled decode, MLX cache capped at 2 GB), through the Stack's worker

`scripts/drive.py` drives `music_worker.py` exactly as the Stack does (JSON lines, one process, jobs in order), with `ACESTEP_MLX_VAE_CHUNK=256`
and the 2 GB cache cap; output is the AAC file the person gets. Wall is the job from request to reply, LRC timings and the AAC encode included;
footprint is the worker's `phys_footprint` after the job and its `phys_footprint_peak` so far (the peak only ever rises in one process).

| Job (planning model) | Wall | Stages (s from the request) | Footprint after / peak so far | MLX peak |
|---|---:|---|---:|---:|
| 30 s song, cold start (0.6B) | 84.4 | load 21, plan 37, music 6, mix 12, save 8 | 22 / 27 GB | 14.0 GB |
| 30 s instrumental (0.6B) | 9.9 | plan 4.6, music 2.0, mix 2.5, save 0.8 | 21 / 28 GB | 14.0 GB |
| 60 s song (0.6B) | 15.0 | plan 6.9, music 1.8, mix 5.3, save 1.0 | 22 / 28 GB | 14.0 GB |
| rewrite the chorus, 20 to 40 s of that song | 11.3 | music 4.7, mix 5.4, save 1.1 | 22 / 29 GB | 15.0 GB |
| extend the 30 s song by 20 s | 8.6 | music 2.9, mix 4.8, save 0.8 | 22 / 29 GB | 14.6 GB |
| restyle as jazz piano, instrumental | 5.7 | music 2.3, mix 2.6, save 0.7 | 21 / 29 GB | 14.5 GB |
| trim, fade out, louder (no model) | 0.7 to 0.8 | save | 21 / 29 GB | none |
| a 5 s song (refused, `bad_request`) | 0.3 | none | | |
| 120 s song (0.6B) | 26.3 | plan 11.6, music 2.7, mix 10.3, save 1.7 | 24 / 29 GB | 14.1 GB |
| 60 s song (1.7B, model switch included) | 32.0 | load 11.8, plan 11.8, music 1.9, mix 5.5, save 1.0 | 25 / 30 GB | 16.4 GB |
| 240 s song (1.7B) | 66.6 | plan 39.6, music 6.1, mix 18.5, save 2.4 | 31 / 32 GB | 16.6 GB |

**What this settles.** The tiled decode and the cache cap take the worst peak from 71 GB (4.1) to **32 GB** for a four-minute detailed song,
29 GB for anything quick up to two minutes. The Stack admits a song against **33 GB** (Stack `d216374`). **p64 stays on, quick only, up to
120 s:** 29 GB beside the roughly 28 GB resident chat set leaves about 7 GB on a 64 GB Mac (video, at 44 GB, could not fit and is off there);
the governor still refuses a song when the machine cannot grant the admission at that moment, with the plain `no_memory` line. A warm song is
10 to 30 s for one to two minutes of music; the cold start (load and first compile) adds about a minute once per worker. The "mix" stage
includes the lyric timings (LRC) for a sung song, a few seconds. Every result is AAC-LC 48 kHz stereo, about 264 kbps, faststart (`M4A`
brand), about 1 MB for 30 s and 8 MB for four minutes.

## 5. Quality, judged

Every clip is 48 kHz stereo, peak normalised to -1 dBFS, RMS -16.6 to -18.8 dB (`scripts/stats.py`). The sung words were checked by a local
transcription of each AAC file (`mlx-whisper` with `whisper-large-v3-turbo`, MIT, under the GPU lock, `asr.log`):

- **The words are sung, and clearly.** The 60 s and 120 s songs and the 240 s detailed song carry every line of the verse and chorus in order
  ("Morning light on the kitchen floor, coffee steam and an open door ..."); the four-minute song sings the bridge ("Windows open, summer air")
  where the lyrics put it. Mishearings are the transcriber's or small slurs ("our heart's about" for "our home's about").
- **Rewrite the chorus works:** the repainted 20 to 40 s sings the new words ("Turn it up, turn it round ... kitchen ground") and keeps the
  verse before it unchanged.
- **Instrumentals have no voice:** the transcriber hears nothing but its own silence hallucination, as expected for music without vocals.
- **Extend, trim, fade and louder** keep the song and do what they say (the 50 s extension continues the chorus; the trim starts mid-verse).
- **Finding that sets the tool's guidance: when the lyrics are shorter than the song, ACE-Step fills the rest with invented, half-sung
  words** (a 60 s song with 30 s of lyrics ended in nonsense syllables). Two consequences. (1) The `generate_music` tool tells the model to
  write enough lines for the length (about one line per four seconds) and to end with an `[Outro]` or `[Instrumental]` section, and Home sets
  the length from the lyrics when the person gave none. (2) Words the model invents are not words Home checked: the minor line runs on the
  description, lyrics and title, not on the audio. A check of the sung words through the household's own speech-to-text against the same
  minor line is row **MUSIC-GEN-15**; until it exists the gap is stated here.
- Not judged by a person yet: musical quality, mix and voice character. MUSIC-GEN-06 plays them in the built-in browser on the throwaway
  Home and records the verdict here.

## 6. Samples (author's scratchpad, `scratchpad/music`)

`out1/` (LM 1.7B, untiled decode) and `out2/` (LM 0.6B, tiled decode): `inst30`, `song30`, `song60`, `song120`, `slower`, `extend`, `cover`,
`repaint`, each a 48 kHz stereo WAV; `bench1.log`, `bench2.log` with per-stage times; `mem1.log`, `mem2.log` with the footprint every 2 to 4 s;
`asr.log` with the transcripts. Scripts: `scripts/bench.py`, `locked.sh`, `membench.sh`, `stats.py`, `asr.py`.

## 7. In chat (the main surface; mirrors pictures and their editor)

**Make a song.** "Write us a song about Saturday pancakes, folk, about a minute" runs the conditional tool `generate_music`, offered only
on a turn whose person and surface pass the gate (section 9) and when the Stack's `GET /stack/v1/music` answers available. The model decides
when (rule 1). Arguments: `description` (genre, mood, instruments, voice: the ACE-Step caption), `lyrics` (written by the chat model in
ACE-Step's tagged form, or absent with `instrumental: true`), `seconds` (10 to the tier cap), `bpm`, `key`, `language`, `title`, and
`imitates_real_voice` (the model's own statement, section 9). The chat model writes the lyrics, not ACE-Step's planning LM
(`use_cot_lyrics` stays off), so the words a person sees in the reply are the words that are sung and they pass the same checks as any
reply. The tool starts a Stack job with `timeout_ms: 1`, answers at once ("A one minute folk song is on its way"), and the card follows
the job, as `generate_video` does.

**Edit it by asking.** "Make it slower", "change the chorus to be about waffles", "make it instrumental", "make it 20 seconds longer",
"do a jazz version", "cut the first five seconds", "fade it out", "make it louder", "give me another take" run `edit_music` with
`track` ("latest" or a version id) and one `change`:

| `change` | What it does | ACE-Step task | Measured (section 4) |
|---|---|---|---|
| `remake` | the same song made again with what changed (tempo, key, words, description), same seed | `text2music`, stored params plus the change | as a new song |
| `restyle` | keeps the melody and structure, changes genre or instruments (`strength` 0.3 to 1.0) | `cover` | seconds |
| `instrumental` | the same song with no voice | `cover` with `[Instrumental]` | seconds |
| `rewrite_section` | new words or a new feel for one stretch (`from_s`, `to_s`, or the section the model names from the stored lyrics and the stored LRC timings) | `repaint`, explicit mask | seconds |
| `extend` | adds `seconds` at the end (or start) that continue the song | `repaint` past the end (ACE-Step's outpainting pads the source) | seconds |
| `variation` | another take of the same request, new seed | `text2music` | as a new song |
| `trim`, `fade`, `loudness` | cut to `from_s` to `to_s`; fade in or out over `seconds`; normalise to `lufs` | no model: the worker edits the samples (numpy, soundfile) and re-encodes | well under a second |

Stem separation ("give me just the vocals") is **not in v1**: ACE-Step's `extract` needs the 4.8 GB base model, and a separate separator
(Demucs) needs its own pin and licence read. Row MUSIC-GEN-12.

**Versions, originals and undo.** Every result is a new attachment (a new version); nothing overwrites a file. A version's provenance names its
parent, so the chain is the track's history. The card shows "Version 3 of 3" with Previous and Next; **Use this version** makes an older one
the one the next edit starts from (that is Undo: one tap back, the newer version kept). The original is never deleted by an edit; deleting
is the person's own act on the file (household trash, media blend section 12).

**The card.** A kit Element (section 11) with the generation stages while it is made (ACE-Step reports three: "Planning the song" while the LM
writes the structure, "Making the music" across the 8 DiT steps, "Mixing it down" while the VAE decodes), the time left from the Stack's
history (GENPREVIEW-01's mechanism: median of the last seven jobs of that length), Stop, then the player, the title, the lyrics in a
disclosure, the version stepper, Download, Share, Save to Music (section 10) and Make another. While another picture, clip or song holds the
generator, it shows the existing queue line with the place in line; that one line (`backend/src/lib/videos/jobs.ts`, today "Home is busy making
another picture or video. It will start in a minute.") becomes "Home is busy making another picture, video or song. It will start in a minute."
for all three, never a second string.
A failed job is the kit `ErrorState` with Try again; the model says in its own words that the song did not come (rule 6).

## 8. Records, provenance and licence-aware export (spec first)

- **The file.** A song is a `file` with `origin: made`, `kind: audio`, `media_type: audio/mp4` (AAC-LC 256 kbps, 48 kHz stereo, faststart:
  plays in every browser and goes into a text message), owned by the person, retention `kept`; the storage cap applies (`checkStorageCap`
  before a job starts). In a temporary chat it lives in memory for two hours, as videos do.
- **`GenerationProvenance` (new spec record shape, `generation-provenance.schema.json`)**, carried on `file.provenance.generation` (additive):
  `kind` (`music` today; pictures and videos may adopt it later), `job_id`, `task` (`text2music`, `cover`, `repaint`, `extend`, `remake`,
  `variation`, `trim`, `fade`, `loudness`), `model` (`id`, `revision`, `licence`), `engine` (`id`, `version`), `seed`, `duration_s`, `bpm`, `key`,
  `parent_file_id` (the version it was made from), `source_kind` (`none`, `made_here`; `upload` is reserved and refused, section 9),
  `commercial_use` (`cleared`, `personal_only`, `unknown`) with `commercial_basis` (one sentence naming why), and `made_at`. The description,
  lyrics and title are the person's own words and live on the person's job record (`music_jobs`), never in provenance or a log; the Stack
  receives them to make the song and never stores or logs them (its job record holds the stage and timings only).
- **Commercial use, decided per track.** A track is `cleared` when every model in its chain is cleared and its source is `none` or a cleared
  `made_here` track. ACE-Step 1.5 is `cleared`, basis: "MIT weights; the model card states it was trained on licensed, royalty-free and
  synthetic audio and that output may be used commercially (read 2026-10-17)". The Apple silicon plan's warning stands: a weights licence is not
  a promise about every training-data claim, so the basis line says exactly what was read and the person sees it in the card's details. A future
  model under a revenue-capped licence (Stable Audio 3.0) makes `personal_only`; an unknown makes `unknown`.
- **Export blocking.** Download and Share are personal acts and always work. An export for money (the later video assembler's "use in a video I
  will publish", or `GET /api/music/files/:id?purpose=commercial`) is refused with 409 and "This song was made with a model that does not allow
  commercial use, so it can't be exported for money. You can still download it for yourself." whenever the chain is not `cleared`. The check is
  one function over the provenance chain, with tests for each case.

## 9. Who may make music, and the lines no setting lifts

- **Adults**: owner, admin or adult, on their own written chat screen, when `generation.music.enabled` (household, default on) is on and the
  Stack has the music component installed. The absolute lines always apply, and since rule 0's 2026-10-18 text an adult's own per-person
  filters apply too, through `musicProtections` (18.7).
- **Children and teens: replaced by section 18.7 (owner, 2026-10-18).** Originally: off. A parent's per-child switch is a later row (MUSIC-GEN-13) that needs the
  band's lyric ceiling designed first. (The old state, until 18.7: the tool was not offered, the policy node refused a call that arrived anyway, and every route refused.)
- **Never** a guest, a spoken turn, a glance or shared screen, a TV, a robot or a pod (rule 0's surface gate). Playing a finished song on a
  speaker is the media apps' audio session, not generation.
- **Absolute lines, for everyone**: (1) no lyrics or description with sexual content involving a minor: the picture policy's one list
  (`promptViolatesMinorLine`) runs on the description, the lyrics and the title of every request and every edit, before a job exists;
  (2) **no voice cloning of a real, identifiable person.** v1 accepts no uploaded audio at all: a source or reference track must be one this
  Stack made (provenance `music-gen:`, bytes unchanged), the same rule as the video reference pictures. A request to sound like a named real
  singer is refused through the model's `imitates_real_voice` flag (no word list of names, as `depicts_real_person`). Using a person's own
  recording, or a consenting household adult's voice, waits on Jesse (**Decision for Jesse**, MUSIC-GEN-14); until he rules, no feature takes
  an uploaded voice.
- **Rule 6a**: no description, lyrics, title or audio is logged; the worker reports stage, seconds and bytes only.
- **Status (rule S6)**: install progress is the install strip (the Stack's component job), a failed install is a Repairs item, a job's
  progress is its own card. No new status surface.

## 10. The Music app (second) and the studio (later)

- **Save to Music** (from the card) creates a `media-item` with `kind: track`, `location.file_id` of that version, `title`, and the person as
  owner, through MEDIA-LIB-01's record API (the records MEDIA-SPEC-01 landed in `spec-v0.1.162`; no second record). The Music app's Listen now
  page gains a **Created by you** shelf: the person's tracks whose file has `origin: made` (media blend section 1: a generated track "shows
  up in these apps' library shelves, nothing more"). **Share** is household storage's share pointer, the same as any file. This slice waits
  for MEDIA-LIB-01 and MEDIA-MUSIC-01 (MUSIC-GEN-09).
- **Music studio app: later, not designed here.** A stub row (MUSIC-STUDIO-01): a timeline of a track's versions and sections, region select
  for repaint, stems once MUSIC-GEN-12 exists, lyrics editor beside the waveform. It reuses this note's Stack API and records; it is an app
  package with its own design note and architect verdict when it is scheduled.

## 11. Kit Elements and parts (rule 9, 9b)

- **Chat card**: a new kit Element `MusicTrack` in `commons/ui/src/elements/music-track.tsx`, the audio sibling of `VideoPlayer`: the same
  `status` states and `GenerationStage` for the stage line and time left while it is made; when it is ready, playback is the kit `Player`
  primitive (MEDIA-PLAYER-01, `ui/src/primitives/Player.tsx`, landed in `ui-v0.5.257`) with `kind: "audio"` and `layout: "audio"`, its `title`,
  and its `actionsSlot` holding Download, Share, Save to Music and Make another; the lyrics in a kit `Collapsible`; the version stepper inside the
  Element, built on the picture editor's version model (`stepVersion` and the "Version N" cursor in `ui/src/elements/image-editor-state.ts`).
  Home passes the versions (id, label, source), the current id and the handlers; it draws nothing. No network access in the Element; every
  source, handler and string is a prop. Home renders it from `TOOL_BINDINGS` as the Element's use site (rule 9b's exception), never a wrapper.
  The elements-adoption entry and the `ELEMENTS-DECISIONS.md` row land before any Home code; Home's `@maipai/ui` pin moves from `ui-v0.5.250`
  to the tag that carries `MusicTrack` (at or above `ui-v0.5.257`, per `docs/PINNING.md`).
- **Settings**: the existing Home settings section gains the key on the `household.pictures` card, retitled "Pictures, videos and music"; the
  model is a row in Models and storage (COMPONENTS-01's route, group `music`, Install and Uninstall, optional, not installed by default). The
  refusal lines that name the old title ("Settings, Pictures and videos" in `pictures/policy.ts` and `videos/policy.ts`) change in the same slice
  as the retitle (S5: copy follows the spec).

## 12. Stack API (additive; the contract number does not change)

- `POST /v1/audio/music` JSON: `task` (`text2music`, `cover`, `repaint`, `extend`, `edit`), `caption`, `lyrics`, `instrumental`, `duration_s`,
  `bpm`, `key`, `language`, `seed`, `quality` (`quick` or `detailed`, FIX SETUP's plain-word pair: quick is the 0.6B LM, detailed the 1.7B
  where the tier has it), `source` (base64 audio plus `source_sha256`, only for `cover`, `repaint`, `extend`, `edit`), `from_s`, `to_s`,
  `strength`, `edit` (`{op: trim|fade|loudness, ...}`), `timeout_ms`. Answers `200 { created, job, data:[{ url, duration_s, seed, model, task,
  ms, lrc? }] }` or `202 { job }`. Errors carry `error` (what happened, what to do) and `code`: 413, 422 (`bad_range`, `too_long`,
  `source_not_made_here`), 503 (`not_installed`, `no_memory`, `not_available_on_this_computer`), 500.
- `GET /v1/audio/music/{job}`: `state`, `stage`, `stage_label`, `progress_fraction`, `eta_seconds`, `position`, `data` when ready. `DELETE` cancels or
  frees the Stack's copy. Files are held about ten minutes (the six newest), never logged.
- `GET /stack/v1/music`: `{ available, state, limits: { max_seconds, min_seconds }, quality: [...], install }`.
- **Source rule (the voice line's second lock).** The Stack keeps a ledger of the sha256 of every track it made (as `video/provenance.ts` does
  for pictures) and refuses a `source` it did not make with `source_not_made_here`. Home must send the stored bytes unchanged.
- **Admission.** One governor `generator` item for the whole job, sized from section 4's peak; a picture, clip or song never overlap.

## 13. Rules check

- Rule 0: the gates above; minors off; surfaces refused before a job. Rule 1: `generate_music` and `edit_music` are conditional tools, each
  with its bench row (MUSIC-GEN-07); nothing reads wording to decide. What earns each: `generate_music` is offered when the person and surface
  pass section 9's gate and the Stack answers available (the same state check as `generate_video`); `edit_music` only when, in addition, this
  conversation already holds a song made here (a state check on the conversation's attachments, not a reading of the words). The real
  worst-case count is the base ten plus `show_images`, `generate_image`, `generate_video`, `read_link` (OWUI-ADOPT-06, planned) and the two
  music tools: **16, exactly the cap** (`withTurnToolGates` in `turnMachine/budget.ts` throws above it), so nothing more can be added without
  a measured trade. Today, with `read_link` not built and `edit_music` offered only after a song exists, a turn sees at most 15. Rule 2: n/a. Rule 6: a failed job is said in the model's words; policy
  refusals keep their fixed lines. Rule 6a: section 9. Rule 8: nothing gated on a model id; the status route reports capability. Rule 9 and 9b:
  section 11, one new kit Element, no override, no wrapper. Rule 11: only the Stack-installed, pinned environment runs the model. S4: the one
  settings shell. S6: section 9. V1: no request to any streaming or live video service; nothing here fetches music from anywhere.
- **Reuse check (org principle 6).** Considered and used: ACE-Step's own package and its native edit tasks (no hand-built repaint or cover);
  the Stack's uv builder, governor, job list, components route and disk plan; the picture policy's age and surface gate and minor list; the video
  job's polling, attachment store and reference-ledger patterns; the kit `GenerationStage`; the kit `Player` primitive (audio layout) for playback;
  the picture editor's version model (`stepVersion` in `image-editor-state.ts`) for the version stepper. Considered and not used for the stepper:
  `message-branches.tsx`, which pages the text variants of one message, while a song's versions are separate attachments with their own files. Considered and not used: `acestep-api` (a second
  server and port to supervise, with an optional key the Stack would have to hold; the worker calls the same `generate_music` function), mlx-serve
  (MIT, serves ACE-Step, but a second server whose music path is undocumented, as the video note found), ffmpeg filters for fade and trim (numpy
  on the decoded samples is ten lines with no new dependency; ffmpeg still encodes AAC, the binary the video engine already pins).
- Conflict check against RULES.md: none found.

## 14. Slices (rows are in `docs/BACKLOG.md`, section "Music generation")

| Row | What |
|---|---|
| MUSIC-SPEC-01 | commons spec: `generation.music.enabled`, `GenerationProvenance`, `file.provenance.generation`, the area title, `StackJob.kind` names `music`; tag and pin |
| MUSIC-GEN-01 | Stack: `music-gen` environment, worker, pins, install plan, disk plan rows, component `music`, `GET /stack/v1/music` |
| MUSIC-GEN-02 | Stack: `/v1/audio/music` job API, stages and time left, cancel, 202, governor admission, the made-here ledger, trim, fade and loudness |
| MUSIC-GEN-03 | Home: `music_jobs` table (migration), policy (`musicDenial` over `pictureDenial`), `generate_music` and `edit_music`, attachments with provenance, routes `/api/music/jobs/*`, `/api/music/files/:id` with the commercial check |
| MUSIC-GEN-04 | commons ui: the `MusicTrack` Element (on the kit `Player`, with the version stepper inside it); Home: the `TOOL_BINDINGS` entry that passes the versions, the current id and the Use this version handler; Home's ui pin to the new tag (at or above `ui-v0.5.257`) |
| MUSIC-GEN-05 | Home: settings key on the card and the Models and storage row (COMPONENTS-01) |
| MUSIC-GEN-06 | Verify on the Studio end to end: real songs and every edit through a throwaway Home, played in the browser and judged |
| MUSIC-GEN-07 | Chat tool bench rows (rule 1 budget) and the safety review (age, surface, minor line, voice line) |
| MUSIC-GEN-08 | Privacy test: zero outbound from the worker; the privacy page lists the pins |
| MUSIC-GEN-09 | Save to Music and the Created by you shelf (after MEDIA-LIB-01 and MEDIA-MUSIC-01) |
| MUSIC-GEN-10 | Later: ACE-Step 1.5 XL turbo as p128's detailed profile, measured |
| MUSIC-GEN-11 | Later: Stable Audio 3.0 for beds and effects behind the licence gate, measured on Apple silicon |
| MUSIC-GEN-12 | Later: stems (ACE-Step base `extract`, or Demucs with its licence read) |
| MUSIC-GEN-13 | Later: a parent's per-child music switch with a lyric ceiling (design first) |
| MUSIC-GEN-14 | Decision for Jesse: uploaded audio as a source (a person's own recording, a consenting household adult's voice) |
| MUSIC-GEN-15 | The sung-words check: the household's speech-to-text on a finished sung song, against the minor line |
| MUSIC-STUDIO-01 | Later: the music studio app (design stub in section 10) |

## 15. As built and verified end to end (2026-10-17)

Landed: commons `spec-v0.1.165` (`d89db1a`) and `ui-v0.5.260` (`MusicTrack`, `192bd49`); Stack `e14e3a8`, `d216374` (engine, job API,
admission 33 GB) and the directory-model download fix below; Home MUSIC-GEN-03 to -06 (the tools, jobs, gates, card, settings).

**Verified on the Studio** with a scratch Stack (own data folder, port 8895, the music component installed through the Components route,
`qwen3-8b` as its chat model) and a throwaway Home (own data folder, port 8896, its Stack address set to the scratch Stack):

- "Make me a song: a cheerful folk song about Saturday pancakes ..." in chat: the model called `generate_music` with its own lyrics, the turn
  answered in 29 to 42 s (the 8B chat model writing the lyrics), and the Stack made the 40 s song in 45 s on a cold worker. Home stored it as
  `audio/mp4` (1.34 MB, AAC-LC 48 kHz stereo), served it with Range (206), and the commercial export answered 200 (ACE-Step cleared).
- In the built-in browser at phone width the card showed the title, the description line, the kit Player (play, back and ahead 15 s, speed,
  Download, Share), Lyrics and "Version 2 of 2"; Previous switched the player to the original file, which played (time advancing), and Use this
  version appeared. The sung words of the original matched the lyrics (local transcription).
- "Keep the song ... edit only its chorus so the words are about Rover chasing a red ball": `edit_music` with `rewrite_section`, a new version
  whose chorus sings "Oh, Rover chasing a red ball in garden light" (transcribed) while the verse stays.

**Real failures found, each fixed with a regression test:**
1. The Stack's component install asked for `acestep-v15-turbo/Qwen3-Embedding-0.6B/added_tokens.json` (404): a directory model's sibling
   files were resolved from the weights' folder, not the repository root (Stack `modelStore.ts`).
2. Home read `GET /stack/v1/music` flat while the Stack wraps it as `{ music }`, so a real, installed engine looked "not ready" and the tool was
   never offered (`lib/music/stack.ts`).
3. The chat model sent the whole revised song as `lyrics` with `section: "chorus"`; splicing it into the chorus duplicated the verse and the
   repainted part sang no clear words. A whole song now replaces the words; a bare fragment still replaces one section.
4. While this slice was in review, main opened pictures to teens and a child cartoon lane (owner ruling 2026-10-17). Music reused the picture
   gate, so it would have opened to minors too; music now checks its own adult lane (section 9 stands: adults only).

**Open, not code bugs:** with the small 8B chat model the edit was sometimes answered with lyrics alone or a fresh `generate_music` instead of
`edit_music`, one call came back with a namespaced argument (`generate_music.lyrics`, refused as bad arguments and retried by the model), and
the reply to an edit said "I've updated the song" before the song existed. These are model behaviour on the 8B scratch model; the household's
Muse model and the tool bench rows (MUSIC-GEN-07) are where they are measured.

## 16. Quick and Full songs (owner, 2026-10-17)

Jesse: "We probably need quick songs and full songs like videos", then, of the 40 s end-to-end song: "Forty seconds is not full." The same plain
words as pictures and video. **Quick**: about 45 s (10 to 60 s by default, an exact length the person names is kept up to 149 s), for a jingle, a
hook or trying words. **Full**: about 3 minutes (150 to 240 s), the whole structure. Chat makes Quick unless the person asks for a whole or full
song or a long piece (the tool's `length`, or a length of 150 s or more); the household default is `generation.music.length` (quick). The card
offers **Make it full** / **Make it quick** (the same words, description and seed made again at the other length, a new version on the same card).
Full needs a Stack that allows 150 s or more (p128); on p64 a Full request makes a Quick song and the reply says why. Both lengths use the tier's
own planning model (1.7B on p128), because switching planning models between songs costs a model load (measured: a quick song right after a full
one on the 0.6B model took 53 s, 23 s of it loading).

**Measured on a scratch Stack on the Studio (port 8895, its own data, GPU lock held, the live Stack serving chat), one structured lyric (intro,
two verses, chorus three times, bridge, outro; 173 words), transcribed with `whisper-large-v3-turbo` and scored as in-order word recall:**

| Song | Duration (ffprobe) | Wall time | Worker peak | Words sung in order | Sections heard |
|---|---:|---:|---:|---:|---|
| Full, cold worker | 3:30 | 90 s | 31 GB | 98.8 percent | verse 1 96, chorus 100, verse 2 96, bridge 100, outro 100 |
| Full, warm | 3:00 | 31 s | 30 GB | 98.3 percent | verse 1 100, chorus 96, verse 2 100, bridge 100, outro 100 |
| Quick, right after | 0:45 | 53 s (includes the 0.6B model switch, now removed) | 30 GB | 52.6 percent of the whole lyric: verse 1 and the chorus, all that fits in 45 s | verse 1 100, chorus 100 |

**Full holds structure and sung words on this Mac**, so both kinds ship together. A Quick song sings the start of a long lyric; the tool tells the
model to write a short lyric for a quick song and every part for a full one.

**A real failure found and fixed (Stack):** a second song while the worker was still warm was refused "not enough free memory" with 50 GB free:
the admission asked for the whole 33 GB peak again although the warm worker already held about 21 GB of it. A song on a warm worker now asks for
the rest of its peak (12 GB); regression test in the Stack.

## 17. On the live hub (v0.2.20, 2026-10-17)

Shipped in Home v0.2.20 with ISOLATION-01 (heavy workers pause while a chat or voice request is in flight). The release agent installed the
Music component (`ace-step-1-5-turbo`) on the live Stack from Models and storage and made **one Quick song through the live API**:

| Song | Wall time | Available memory | Chat |
|---|---:|---:|---|
| Quick, 45 s with lyrics, cold worker | 55 s | about 97 GB before, 67.8 GB during (about 29 GB drop, inside the 33 GB admission peak) | stayed ready, nothing evicted |

Not yet measured on the live hub: a Full song (FIX SETUP's call) and the in-chat flow (ask, change a part, play, Make it full), which Jesse runs.
The MUSIC-GEN rows that need them stay open until then.

## 18. Jesse's first songs (v0.2.21, 2026-10-18): five fixes

Jesse asked for "a modern heavy metal song about bananas" (Home job `mus-d8n46d1nai`). The evidence is a read-only copy of the live row and turn.
The model called `generate_music` in the first turn. Five things went wrong, and this section decides each one. They are built in this order,
one small landing each: 18.1, 18.2, 18.3 (verify), 18.4, 18.5.

### 18.1 Sung words that are not in the lyrics (MUSIC-GEN-17)

**What happened.** The lyrics were a whole song (22 sung lines, about 98 s by the tool's own estimate of 4 s a line plus 10 s), but a Quick
song is at most 60 s. ACE-Step sang the intro, verse, pre-chorus and most of the first chorus. Its own timed lyrics (`lrc`) then put the rest
of the chorus, the second verse, the bridge, the second chorus and the outro all at 0:59.92: 12 sung lines squeezed into the last second.
Jesse heard garbled words there ("eleven bytes", then "peel and bites": the outro line "Peel, bite, bleed yellow" squeezed into the end).

**Reproduced** on a scratch Stack (port 8895, its own data, GPU lock held) with the live request and seed 670964457. The file is within 0.5
percent of the live size, and the timed lyrics squeeze the same lines into the last second (0:58.56). The words were transcribed with
`whisper-large-v3-turbo` and lined up against the lyrics in order:

| Run (60 s, seed) | Lyrics | Words sung in order | Heard words not in the lyrics | Where |
|---|---|---:|---:|---|
| live request, 670964457 | 22 lines (whole song) | 36 percent of the lyrics | 12 | "heated", "I should" in the last 7 s, where the engine squeezed 12 lines; the rest misheard growls |
| fitted to the length, 670964457, two runs | 11 lines (intro to first chorus) | 44 and 64 percent | 12 and 25 | none squeezed; one run has "I don't know" in the long intro gap |
| fitted, seed 22 | 11 lines | 81 percent | 19 | misheard growls, "thank you" at the end |
| fitted, seed 11 | 11 lines | 36 percent | 21 | "we'll be right back" in the last 3 s |
| fitted plus `[Outro] [Instrumental]`, 3 seeds | 11 lines | 59 to 76 percent | 7 to 14 | a word or two in the gaps |

The transcription uses whisper's anti-loop settings (no carry-over of earlier text, a 2 s silence check). Without them, whisper repeats a
phrase 5 times over the instrumental ending, and that looked like invented singing. With them, most of the leftover extras are growls
misheard ("heal the light" for "peel the night"), plus whisper's well-known endings on music ("thank you", "we'll be right back"). The same
request and seed do not give the same song twice on MLX, so every number is per run. Growled metal is the hardest case. The earlier folk proof (section 16) sang 98 percent of its words in order.

**The fix (Home, deterministic, no new model):**

1. **Fit the words to the length.** Before a song is sent, `fitLyricsToLength` keeps whole sections from the top while their estimated time
   (4 s a sung line plus 10 s, the measured rate: 11 lines filled 55 s) fits the song's length. The song's `lyrics` are the fitted words, so
   the card shows only what is sung. The person's full words are kept as `written_lyrics`, and **Make it full** sings all of them. When even
   the first section is too long, the song keeps that section's lines that fit, at least one.
2. **Trust the engine's timing after the song.** When the engine puts two or more lines on one timestamp in the last 1.5 s of the song,
   those lines (and every line after the first of them) were squeezed in and were not really sung. The card shows the person's words without
   them. The card's lyrics and the karaoke list (18.5) leave such lines out. A regression test reads the live `lrc` from this song.
3. **Quick and Full scale the words, in code.** Fitting (point 1) cuts the words to the length, so the model is given no line count (rule
   5: no instruction tells the model how many words to write). The tool's own result text states the fact: a quick song sings the first
   sections that fit, and Make it full sings every part.
4. **A standing check in the music proof.** `scripts/bench/music-sung-words.py` (Stack, bench lane, on demand) makes a song, transcribes it
   with the settings above and reports, next to each other, words sung in order and heard words not in the lyrics with where they fall. The
   pass or fail signal is deterministic: the check fails when the engine's `lrc` puts two or more lines on one timestamp in the last 1.5 s
   (the squeezed ending, which Jesse's song shows). The extra-word count is reported but does not fail the check: whisper mishears growls.

**Children.** Music stays adults only: `musicViewDenial` refuses a teen or child before any picture lane is consulted (rule 0, tests in
`musicSafety.test.ts`). No child hears a song, so no child hears invented words. This fix adds a **hard precondition** to MUSIC-GEN-15:
any future teen or child music lane must, before the song is offered, transcribe the finished song with this whisper model (measured: 4.9 s
for a 60 s song cold, 3.7 s for a 3:30 song warm, about 2 GB) and run the music floors on what was sung. A hit, or a transcript that cannot
be read, withholds the song. It must also sing only the hook (Quick, note 18.1a), with the length following those words. Until that exists, the adult check in `musicViewDenial`
is the floor, and a test pins it. An independent review checks this reasoning.

### 18.1a The length follows the words (owner, 2026-10-18; replaces 18.1's points 1 and 3)

Jesse, on the 22 lines that were too long for 60 s: "we don't have a hard requirement to time box it". So a song is no longer cut to a
fixed length. **The length follows the words**, and Quick and Full say how much of the song is sung, not how many seconds it lasts.

**Measured** on the scratch Stack (port 8895, bench lock held, the live request's 22 lines, seed 670964457, detailed):

| Length | Wall time | Worker memory (RSS) | Last line at | Lines on one timestamp, gaps under 1 s | Words sung in order | Heard words not in the lyrics |
|---|---:|---:|---:|---:|---:|---:|
| 60 s (as on the live hub) | 45 s | not sampled | 0:58.6 (12 lines there) | 12 | 36 percent | 12 |
| 120 s | 59 s (cold) | 20.5 GB | 1:46.4 | 0, 0 | 76 percent | 15 |
| 140 s | 24 s | 20.8 GB | 2:17.8 | 0, 0 | 90 percent | 15 |
| 160 s | 26 s | 21.2 GB | 2:16.1 | 0, 0 | 89 percent | 19 |
| 240 s (the 128 GB ceiling) | 41 s | 21.7 GB | 3:53.1 | 0, 0 | 92 percent | 38 (the words spread thin, more filler between lines) |

The engine sings about 3 to 9 s a line (median about 5 s) and needs room for an intro and an ending. The folk proof (section 16) sang its
25 lines at 98 percent in 180 s and in 210 s. So the rate is **6 s a sung line plus 10 s**: 142 s for Jesse's 22 lines, 160 s for the folk
song, 76 s for a hook of 11 lines. The 33 GB admission peak (section 4) is unchanged; the worker's own memory stays about 21 to 22 GB up to the 240 s ceiling.

**The rules:**

1. **Every word the model wrote is sung, and the length follows.** `secondsForWords(lyrics) = sung lines x 6 + 10`, at least 30 s. The
   only ceiling is the Stack's own `limits.max_seconds` (240 s on a 128 GB Mac, 120 s on 64 GB), which is a memory limit, not a choice.
   No fixed 45 s or 60 s default applies when there are words.
2. **Quick and Full say how much of the song is sung.** **Full** sings every part. **Quick** sings the hook: the whole sections from the top
   up to and including the first chorus (or the first two sections when there is no chorus). Either way the length follows the words that
   are sung. The household setting `generation.music.length` keeps its one meaning, "the kind chat makes when nobody says which", and its
   **default becomes `full`**, so a song's words are all sung unless someone asks for a quick one (the tool's `length`, which the model sets
   when the person asks for a quick or short song or a jingle). **Make it full** sings every word and **Make it quick** sings the hook, each at
   the length its words need. Without words (an instrumental), quick is about 45 s and full about 3 minutes, as before.
   **This is a spec change, landed first** (MUSIC-SPEC-03): in commons `spec/settings/keys.json`, the entry's `default` becomes `"full"`, and
   its `help`, `copy.does` and both `copy.options` lines say the new meaning (point 7). Then one Home pin, and Home's `musicKeys.ts`
   declaration matches the entry exactly.
3. **A length the person asks for is kept** ("make it 90 seconds", "make it shorter"). If the words do not fit that length, the song sings
   the whole sections that fit (18.1's `fitLyricsToLength`). The tool's result states which sections are sung, and the model tells the person
   in its own words. No fixed line goes into the reply.
4. **Above the ceiling**, the song sings the whole sections that fit the ceiling. The tool's result states that the words are longer than the
   longest song this computer makes (its `limits.max_seconds`), and the model says so in its own words. The card's hint can carry the plain
   line "Longer than this computer's longest song (4 minutes), so it sings the first parts that fit." The person's words are kept for a later
   Make it full on a bigger computer.
5. **If the engine still squeezes lines** (two or more lines on one timestamp in the last 1.5 s, 18.1's signature), Home makes the song
   once more, 30 percent longer, up to the ceiling, before it shows it. The retry is a new Stack job. It goes through normal admission with no
   bypass, so the governor still waits for memory and ISOLATION-01 still pauses it while chat answers. The card's own stage line says "Making
   it longer so every line fits" (rule S6: the job's own card). If the second try still squeezes, the card shows the sung lines only (18.1
   point 2). Memory is measured up to the ceiling (the 240 s row above).
6. **Effort is unchanged.** Both kinds use the Stack's default quality for this computer (detailed, the 1.7B planner, on 128 GB). Switching
   planners between songs costs a model load (measured 23 s in section 16), so the effort setting stays the engine's, not the kind's.
7. **Copy** (spec copy fields, rule S5, read through `describeSetting`): help "What chat makes when nobody says which. Anyone who can make
   songs can still ask for the other kind. A song is as long as its words."; does "Picks whether chat sings every part or only the hook when
   nobody says which."; quick "Quick: the hook, the first verse and chorus."; full "Full: every part of the song." The computer's own longest song
   (`limits.max_seconds`) goes in the card's hint, not the setting. The guide and the card's hint say the same. The phrases "Quick songs are about 45 seconds" and the 60 s default are gone,
   except for instrumentals.

The model is still given no line count (rule 5): it writes the song it wants, and Home sizes the length. The standing check in the music
bench (18.1 point 4) is the proof that the length is long enough for every line: no lines on one timestamp, and words sung in order.

### 18.2 A card while the song is made (MUSIC-GEN-18)

**What happened.** The song's part (`song`) is added to the message only at the turn's final `done` event
(`frontend/src/apps/chat/chatModelAdapter.ts`). The streamed `tool_result` already carries `musicJobId`, but the client drops it. The reply
then ran about 1500 characters of lyrics. With the Stack pausing the song while chat writes (ISOLATION-01), `done` came only seconds before
the song was ready, and the card appeared under all that text. Pictures and videos have the same `done`-only path, but their one-line
replies hide it.

**The fix (rule S6, the existing card).** When a streamed `tool_result` carries `musicJobId`, the adapter adds the same `song` part (same id
as the one at `done`, so `done` keeps the card) at once. The kit `MusicTrack` then shows stage, time left, the bar, Stop and "Paused while chat
is working" from the job record, polled as now. Before the first poll returns, `MusicToolRender` draws the queued card instead of nothing. No
new status surface, banner or polling loop. Pictures and videos can take the same streamed part later (a separate row).

### 18.3 A short reply (FIX SETUP's 74a2516f, verified here)

FIX SETUP landed the short tool answer: no lyrics, no style or tempo, never "is ready", plus one re-ask when a song request is answered with
lyrics only. This note adds a turn test for the case seen live: the reply after a `generate_music` call carries no lyric line and no "is
ready", and the `song` part arrives during the stream (18.2). The `quality: "detailed"` in the Stack job is the engine setting chosen for this
computer (the Stack's `default_quality`), not the song's length. Quick and Full are the only words a person sees, and the reply and card never
name a quality.

### 18.4 Cover art (MUSIC-GEN-19)

Every finished song gets a cover made with the Quick picture model (`flux2-klein-4b`).

- **When.** After the song is stored (in the music job's `finish`), never alongside it. A picture asked for while the song worker runs waits
  at the Stack's governor and can time out. Starting after the song means the cover queues behind it, the warm song worker's memory is
  counted by the governor's free-memory check, and chat is never evicted (the governor never evicts, ISOLATION-01 pauses generators for chat).
- **Prompt.** Built on the hub from the title, the style and the first lyric lines: "Album cover art for a song called <title>: <style>.
  Theme: <first two sung lines>. No text, no letters." The text passes `refusePrompt` and the absolute lines like any picture.
- **Gate.** The person's own picture audience (`routeAudience`, as the pictures route does), so `pictureDenial` and the household switch apply.
  If pictures are off or refused, the song keeps a plain note icon and no error is shown. Music is adults only (18.1), so the kids picture lane
  is never reached; if a teen or child music lane ever opens, its covers use that lane's picture rules (cartoon style for children).
- **Stored** as the song's `cover_file_id` (new column, migration) pointing at an image attachment. Its versions use the existing picture
  version chain (`saveVersion` in `lib/imageEdit.ts`).
- **New cover** makes another cover from the same prompt with a new seed, as a new version. **Edit cover** opens the existing picture editor
  pane (the kit `ImageEditor`, `useImageEditor`) on the cover. Its prompt box goes through `/api/image-edit/pictures/:id/comment` with every
  editing floor, and the applied edit is the cover's next version.
- **Shown** on the card and as the player's artwork: the kit `MusicTrack` gets a `cover` prop (commons first, rule 9) that it passes to the
  kit `Player` as `poster`, which also feeds the media session artwork. Where the song is in the media library, the record's `artwork`
  is `{file_id}`.

### 18.5 Karaoke (MUSIC-GEN-20)

ACE-Step already returns timed lyrics, and Home stores them in `music_jobs.lrc`, so no alignment model is needed.

- **Home** parses `lrc` into `timed_lyrics: [{ t, line, section }]` on the card route: sung lines only, per 18.1.
- **Kit (commons first, rule 9).** `MusicTrack` takes `timedLyrics`. Its existing Lyrics toggle shows the lines as buttons. The line being
  sung is highlighted (`aria-current`), following the player's own media element (`timeupdate` through the Player's `mediaRef`). Tapping a line
  seeks to it. The list scrolls the current line into view, without smooth scrolling under `prefers-reduced-motion`. It works at phone width.
  Without timed lyrics it shows the plain words, as now. One tag through the tag agent, then one Home pin.
- **Reuse check.** `react-lrc` and `liricle` parse LRC and scroll a lyric list, but each draws its own list and styling outside the kit
  (rule 9). The kit `Player`'s `captions` (WebVTT) show one cue over the media, not a lyric list you can tap. ACE-Step's timing removes the
  need for whisper or a forced aligner. So the kit Element adds the list from its own primitives, and Home parses LRC (one timestamp and one
  line per row) in a few lines. Cover art reuses `startPictureJob`, the picture version chain and the `ImageEditor` pane unchanged. Fitting
  the lyrics reuses the tool's measured estimate (`secondsFromLyrics`).

### 18.7 Teens and children make songs; a child's request is rewritten, not refused (owner, 2026-10-18; MUSIC-GEN-22)

Jesse: "kids can only make kid friendly content - this applies to everything including music, for example if a kid typed 'make a heavy rock
song about scary halloween' we just modify that prompt to perhaps 'kid friendly happy light rock wiggles type song about scary halloween (but
not too scary)'". This replaces section 9's "Children and teens: off" and opens music in the same lanes as pictures and videos, as RULES.md rule 0
now says (Owner-approved 2026-10-18, Home 9ae5698a: "Picture, video and song generation under this rule"). The age gate is not loosened: the absolute lines, the surface gate and every check below stay
fixed, and no setting reaches them.

- **One set of protections, one seam (rule 0: "one set of content protections per person, set by age, covers everything Home makes").**
  Every music floor goes through one function, `musicProtections(audience)` in `lib/music/policy.ts`, which returns the checks for this
  person: the absolute lines, the person's lane, and their per-person filters. Today it delegates to the existing functions
  (`promptViolatesMinorLine`, `refusePrompt` with the lane, `teenPromptUnsafe`, `childPromptUnsafe`, and the music floors). When the
  shared `contentPolicyFor(person, band)` exists (FIX SETUP owns its design), the seam calls it instead: one change, nothing music-only. The
  seam runs on the prompt, the lyrics, the title and the words as sung. **No music-only word list is added.** Swearing, drugs, gambling and
  gore filters per person have no shared text check today (`lib/pictures/lane.ts`'s child list has drugs, gambling and gore but no
  swearing; `teenPromptUnsafe` covers only sexual and unclothed words, not gore or drugs; `lib/contentCeiling.ts` sets profanity off for a
  child only as guidance to the model, not as a check).
- **The teen and child song lanes stay off until the shared text check exists (CONTENT-POLICY-01, FIX SETUP).** Songs carry words, so
  rule 0's "a person who has swearing, drugs, gambling or gore filtered gets none of it in ... a song" needs a deterministic text check
  that takes the person: in its one shared place (never in `lib/music`), blocking swearing, drugs, gambling and gore for a child and gore
  and strong profanity for a teen by band default, and failing closed. Until CONTENT-POLICY-01 lands, `musicViewDenial` keeps refusing
  teens and children as today. Everything else in 18.7 (the seam, the rewriter, the as-sung transcription, cartoon covers) is built behind
  the closed lane, and the lane opens in one commit when the seam calls the shared check on the rewritten words and on the as-sung
  transcript.
- **Family.** Anyone in the household may make songs with or about household members, as rule 0's household option (on by default) allows
  for pictures and videos. No real person outside the household and no public figure (rule 0's absolute line; the existing
  `imitates_real_voice` flag and the picture real-person rule).
- **Who and where.** The lane is the picture lane (`laneOf`, the stricter of the turn's band and the person's own). A teen or child may make
  songs exactly when they may make pictures (`pictureDenial` for their audience): the home's switch and each child's own switch (`kidLaneOn`),
  on by default, with no new setting. Written chat only; never a guest, a spoken turn, a glance, a TV, a robot or a pod (rule 0, as before).
- **Teens.** A teen's song has nothing adult or sexual. The description, lyrics and title pass the teen lane's floor (`refusePrompt` with
  `lane: "teen"`) and the music floors. A refusal is the teen lane's one short policy line (rule 6). Otherwise as adults.
- **Children: rewrite, not refuse.** Before any floor, a child's request (description, lyrics, title) goes to a **kid-friendly rewriter**:
  the household's own chat model, called by Home with a fixed instruction (make it a happy, light, gentle children's song: bouncy, simple, sing-along preschool songs; soften anything scary to "not too scary"; keep the child's topic; nothing violent, sexual, cruel, about real people, or about
  self-harm) and a JSON answer (`description`, `lyrics`, `title`, `changed`). The rewritten words then pass the child lane's floor
  (`refusePrompt` with `lane: "child"`, `childPromptUnsafe`) and the music floors. The tool result states what was made instead, and the
  model tells the child in one kid-friendly sentence, for example "I made it a happy, not-too-scary Halloween song.".
  - **Hard lines are never rewritten into a song.** When the child's own words, or the rewrite, hit the absolute lines or the child floor
    (sexual content, graphic violence, self-harm, a real person), no song is made: the child gets the child lane's existing safe redirect
    line, as pictures do.
  - **Fail closed.** If the chat model is not ready, times out (10 s) or answers anything but valid JSON, the song uses a **fixed gentle
    template**: description "a happy, gentle children's song, light and bouncy, not scary", the child's words dropped, the song instrumental.
    The tool result says the words could not be checked, so the song has music only. If even the template fails a floor, no song.
  - The rewritten text is the song's stored request. The child's original words are never sent to the Stack, never put in the music job, its
    provenance, a log line, a trace or an admin view (rule 6a). They stay only where the child's own chat already keeps them: the child's
    message and the model's tool-call arguments in that chat, which the child and their guardians see, as for every other tool.
- **Every minor's song is checked as sung (MUSIC-GEN-15, now built for this lane).** After the Stack makes a teen's or child's song, the
  music worker transcribes it with `whisper-large-v3-turbo` (MIT, part of the Music component; measured 4.9 s for a 60 s song and about
  2 GB, section 18.1) using the settings of the standing check, and returns the transcript to Home only. Home runs the lane's floor and the
  music floors on it. A hit, or a transcript that cannot be made or read, **withholds the song**: the card shows the lane's safe line, and the
  file is deleted. The transcript is never stored or logged (rule 6a). Adults' songs are not transcribed.
- **Child songs are Quick** (the hook, 18.1a), with the length following those words, which keeps squeezed or invented words least likely.
- **A child's cover is a cartoon.** The cover (18.4) uses the person's own picture lane, so a child's cover is the child lane's cartoon
  picture (forced cartoon look, child topic gate) and a teen's has nothing adult. A song's cover does not count toward a child's daily picture
  allowance; the song itself counts as one picture against it (`reserveKid`), so the existing daily limit also limits songs.
- **Edits.** A teen or child may change only their own songs made in this chat, through the same rewrite (child) and floors (both), and the
  sung check runs again on the new version.

### 18.6 Rules check

S6 (18.2 feeds the existing job card). Rule 9 (cover and karaoke are props on the shipped `MusicTrack`, added in commons first, with no Home
wrapper). Rule 0 and docs/SAFETY.md (teens and children make songs only in the picture lanes, 18.7, with a check as sung that withholds; this
needs the rule text named in 18.7's escalation, Owner-approved by Jesse). Rule 6 (a failed cover never fails the song). S6 (a withheld minor's song shows the lane's safe line on its own card). Rule 5
(no line count is given to the model; fitting is in code). No rule changes.

## Supersedes

- `hub-on-apple-silicon-2026-09-17.md`'s music table rows marked `(?)`: ACE-Step 1.5 runs on Apple silicon through its official MLX path, with
  the times in section 4; MusicGen stays rejected; Stable Audio moves to MUSIC-GEN-11.
- MEDIA-HOST-03 is carried by MUSIC-GEN-01 to -03 and -08 (the benchmark, provenance and export blocking); CHAT-MEDIA-01's music part is
  MUSIC-GEN-03 and -04. Stack STACK-99 is carried by MUSIC-GEN-01 and -02.
- **STACK-99's server choice is replaced.** STACK-99 named ACE-Step's REST server `acestep-api` as the engine; this note runs ACE-Step in process
  in a JSON-lines worker (section 3), so the Stack supervises no second server or port and holds no API key for it.
- The backlog row "Verdicts for the features absent from both this file and the rebuild" (its "Music Studio, karaoke and stems" item): generation
  is this note, the studio is MUSIC-STUDIO-01 and stems are MUSIC-GEN-12; karaoke keeps its own verdict line there. The row is annotated.
  Section 18.5 now decides karaoke for songs made in chat (timed lyrics on the song card). That verdict line still covers karaoke for other music.
- **Section 16's fixed lengths are replaced by 18.1a** (owner, 2026-10-18): with words, a song is as long as its words (6 s a sung line plus 10 s, up to the Stack's ceiling); Quick sings the hook and Full every part. The 45 s and 3-minute defaults remain only for instrumentals. 18.1's points 1 and 3 (fit the words to a fixed quick length) are replaced by 18.1a.
- Section 5's guidance that a song without a given length is as long as its words is kept. Section 18.1 adds the reverse case: words that are
  too long for the length are fitted to whole sections, not sent whole.
- **MUSIC-GEN-13 (a parent's per-child music switch) is superseded by 18.7**: songs use the picture lane switches (`kidLaneOn`), with no
  new setting.
- **Section 9's "Children and teens: off" is replaced by 18.7** (owner, 2026-10-18): teens and children make songs in the picture lanes; a
  child's request is rewritten into a kid-friendly song, not refused; every minor's song is transcribed and checked as sung before it is shown.
- Nothing in `RULES.md` changes.
