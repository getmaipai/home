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
  Stack has the music component installed. No content filter beyond the absolute lines (owner's policy for adults, image-generation note).
- **Children and teens: off.** No setting turns it on in v1 (as video). A parent's per-child switch is a later row (MUSIC-GEN-13) that needs the
  band's lyric ceiling designed first. The tool is not offered, the policy node refuses a call that arrives anyway, and every route refuses.
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

## Supersedes

- `hub-on-apple-silicon-2026-09-17.md`'s music table rows marked `(?)`: ACE-Step 1.5 runs on Apple silicon through its official MLX path, with
  the times in section 4; MusicGen stays rejected; Stable Audio moves to MUSIC-GEN-11.
- MEDIA-HOST-03 is carried by MUSIC-GEN-01 to -03 and -08 (the benchmark, provenance and export blocking); CHAT-MEDIA-01's music part is
  MUSIC-GEN-03 and -04. Stack STACK-99 is carried by MUSIC-GEN-01 and -02.
- **STACK-99's server choice is replaced.** STACK-99 named ACE-Step's REST server `acestep-api` as the engine; this note runs ACE-Step in process
  in a JSON-lines worker (section 3), so the Stack supervises no second server or port and holds no API key for it.
- The backlog row "Verdicts for the features absent from both this file and the rebuild" (its "Music Studio, karaoke and stems" item): generation
  is this note, the studio is MUSIC-STUDIO-01 and stems are MUSIC-GEN-12; karaoke keeps its own verdict line there. The row is annotated.
- Nothing in `RULES.md` changes.
