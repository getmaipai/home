# The hub on a Mac Studio M5 Max with 128 GB

Owner decision, 2026-09-17. The whole hub moves to one Mac Studio M5 Max
with 128 GB unified memory and 2 TB SSD. The eGPU path is closed. The old
two-card note remains a record of measurements, not an installation plan. The
priorities are chat with intelligence, coding, images, then video.

The Studio configuration used here is the M5 Max with an 18-core CPU, a
40-core GPU, and 614 GB/s memory bandwidth. Apple lists 128 GB as the maximum
unified-memory configuration for that chip. Source: [Apple Mac Studio
technical specifications](https://www.apple.com/mac-studio/specs/).

## 1. Runtime per role

### The two runtime families

| Runtime | Chat and coding behavior | Serving and cache behavior | Decision |
|---|---|---|---|
| llama.cpp with Metal | The existing `llama-server` path is exercised by Home. The pinned macOS arm64 binary is verified in `backend/src/lib/engineCatalog.ts`. | OpenAI-compatible `/v1/chat/completions`, `cache_prompt`, explicit slots, and parallel slots are already part of Home's client contract. | Production baseline until another engine passes the same tool, safety, health, and restart checks. |
| MLX with `mlx-lm` | Native Apple Silicon execution and a practical path for the large MoE candidates. | `mlx_lm.server` exposes an OpenAI-like API, prompt caches, prompt and decode concurrency, and a `draft_model` for speculative decoding. Its own documentation says its security checks are basic. | First-class candidate for the selected large model. It becomes the fixed chat engine only after the Studio bench. |

Sources: [MLX documentation](https://ml-explore.github.io/mlx/build/html/index.html),
[MLX LM server](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md),
and [llama-server options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Both runtimes preserve one Home boundary. A role has one selected engine URL,
one model identity, one health probe, and one supervisor. The URL may be a
local child process or a configured local URL for an already-running service.
No automatic cross-engine failover is introduced.

### What is measured and what is not

The old GPU layout measured Qwen3.8-27B on an RTX 5060 Ti at 33.7 decode
tokens per second and 879 prompt tokens per second. Those are workload
numbers, not Apple Silicon numbers. A public M4 Pro MLX report measured
Qwen3.5-27B int4 at 11.8 tokens per second and 22.1 GiB peak at a 4096-token
prompt. Source: the [MLX coding benchmark report](https://github.com/weklund/mlx-coding-bench/blob/main/measurements/llm_benchmarks/Apple_M4_Pro_10P%2B4E%2B20GPU_64GB/2026-03-06__19:47:24/REPORT.md).

There is no trusted, repeatable M5 result for the large candidates in this
record. The first-day bench below owns the decode, prompt, first-token,
two-slot, memory, and tool-call numbers.

### Speculative decoding and slots

The pinned llama.cpp engine is treated as having no usable Metal MTP dependency.
A CUDA-only choice must never be enabled by an Apple catalog entry. MLX's
`draft_model` is a real option, but it consumes unified memory and its
quantized KV mode cannot batch. Start the selected large model with two slots
and no draft model. Add a draft only after a measured speed win that does not
change tool-call or safety behavior.

### Recommendation

Use llama.cpp Metal as the production baseline now. Add an MLX engine entry and
a shared OpenAI-compatible URL adapter for the selected large model. Keep the
guards, memory rules, turn engine, identity checks, and restart semantics in
Home. A model host may own loading, but it may not bypass those boundaries.

`engineCatalog` needs a pinned MLX environment or launcher, model format, URL
port, health probe, and verification status. The supervisor needs the same
generation guard, identity read, process watch, and memory-pressure handling
as `llmSupervisor.ts`. A managed external service is probed and identified but
not spawned or killed by Home.

## 2. Models per role

Memory figures are binary GiB when the source says GiB and decimal GB when the
source says GB. A weight-file size is not a process peak. The latter includes
KV, compute buffers, tokenizer, and runtime allocations. `(?)` means an
estimate or an unverified Apple result.

### One model for chat, intelligence, and coding

The owner decision is one foreground model. There is no permanent 27B coding
copy beside an intelligence model. The first-day bench runs each candidate in
the owner's order: conversation quality, coding on Session C briefs, then
speed. The model must hold two 64k slots without pushing macOS into pressure.

| Candidate | 4-bit weights plus 64k KV | 8-bit weights plus 64k KV | Coding and chat evidence | Apple path and verdict |
|---|---:|---:|---|---|
| Qwen3-Next-80B-A3B | about 43 to 50 GB `(?)` | about 83 to 95 GB `(?)` | Qwen reports 80B total and 3B active, strong long-context and reasoning results against Qwen3-235B; no Session C score is published. | MLX-community and llama.cpp conversions exist `(?)`; first candidate to bench. Apache 2.0. |
| GPT-OSS-120B | about 67 to 78 GB `(?)` | about 125 to 145 GB `(?)` | OpenAI reports 117B total and 5.1B active, tool use, structured outputs, and published reasoning and coding evaluations. | Apache 2.0 plus the OpenAI usage policy. MLX and llama.cpp ports are available `(?)`; runner-up if Qwen misses. |
| GLM-4.5-Air | about 61 to 72 GB `(?)` | about 116 to 132 GB `(?)` | The model card reports 106B total, 12B active, 128k context, and SWE-bench results. | MIT. MLX and llama.cpp conversions are community paths `(?)`; likely slower because 12B is active. Bench, but do not assume 35 to 45 tok/s. |
| Qwen3-235B-A22B | about 126 to 145 GB `(?)` | over 240 GB `(?)` | Qwen reports 235B total and 22B active, with strong reasoning and coding results. | Apache 2.0, but it cannot fit with 64k KV and macOS on a 128 GB Studio at 4-bit. Reject for this box. |
| Qwen3-Coder-Next-80B-A3B | about 43 to 50 GB `(?)` | about 83 to 95 GB `(?)` | Its technical report targets coding with 80B total and 3B active. Chat quality is not the owner's primary evidence. | Apache 2.0, MLX/Metal path `(?)`. Keep as a fallback second slot only if every one-model candidate misses the coding speed floor. |

The arithmetic is a bound, not a benchmark. At 614 GB/s, a 4-bit model with
`N` active parameters has a best-case weight-streaming ceiling of
`614 / (0.5N)` tokens/s: about 123 tok/s for 10B active, 102 for 12B, 241
for 5.1B, and 410 for 3B. Routing, attention, KV reads, kernels, and memory
reuse lower that number. The first target is 35 tok/s decode and 500 tok/s
prompt processing at 4k. A winner may miss that target only if its
conversation and coding scores are materially better and the owner accepts
the wait. All numbers above remain estimates until the M5 bench.

Sources: [Qwen3-Next model card](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct),
[GPT-OSS model card](https://openai.com/index/gpt-oss-model-card/),
[GPT-OSS model page](https://developers.openai.com/api/docs/models/gpt-oss-120b),
[GLM-4.5-Air](https://glmmodel.com/models/glm-4-5-air),
[Qwen3-Coder-Next report](https://arxiv.org/abs/2603.00729), and
[Apple Mac Studio specifications](https://www.apple.com/mac-studio/specs/).

### Judge, embed, and speech

The memory-eval bench compares three judge placements: a third slot of the
foreground model, a dedicated 8B to 14B judge kept warm, and Qwen3-4B as the
floor. Try the dedicated judge first. The third-slot option is allowed only if
it wins the judge score and the foreground run stays above 35 tok/s with two
slots. Qwen3-4B remains the fallback because it is small and already wired to
the background supervisor.

| Role | Estimated live memory | Decision |
|---|---:|---|
| Judge, dedicated Qwen3-8B or Qwen3-14B | about 5 to 9 GB `(?)` | First trial. One warm judge avoids spending a second KV cache on every foreground request. |
| Judge, third foreground slot | another 64k KV and concurrent decode `(?)` | Only if `backend/scripts/bench/memory-eval.ts` shows a quality win and the throughput condition holds. |
| Judge floor, Qwen3-4B Q4 | about 4.4 GB `(?)` | Keep as the memory-safe fallback. |
| Embed, `nomic-embed-text-v1.5.Q4_K_M.gguf` | about 0.4 GB `(?)` | Always available so recall does not wait on a generator. |
| Speech in, Moonshine tiny-en plus Silero VAD | about 0.2 GB `(?)` | Keep the current in-process path; Whisper.cpp and MLX Whisper stay alternatives. |
| Speech out, Qwen3-TTS 1.7B | about 2 to 4 GB at 4-bit `(?)` | Quality and cloned voices. The technical report describes three-second voice cloning and Apache 2.0 weights. Measure time to first audio. |
| Speech out, Kokoro 82M | about 0.2 to 0.5 GB `(?)` | Latency floor. Keep when its first audio arrives sooner and the sentence quality floor passes; it has voices, not Qwen-style reference cloning. Apache 2.0. |

The deciding number for speech is time to first audio for one sentence, not
full-utterance throughput. Use Qwen3-TTS for a consented cloned voice or when
quality wins. Use Kokoro for short ordinary replies when its measured TTFA is
at least 2x faster `(?)` and the voice is acceptable.

Sources: [Qwen3-TTS report](https://arxiv.org/abs/2601.15621),
[Qwen3-TTS model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice),
and [Kokoro](https://github.com/hexgrad/kokoro).

### Voice output criterion: natural disfluencies and nonverbal sounds

The owner wants voice output to produce a natural disfluency or nonverbal
sound on request: "um", "let me think", a throat clear, a chuckle, or a sigh.
The first-day test is one line with a hesitation and a laugh, timed to first
audio. The screen keeps the clean `reply.text`; the composer writes the
model-specific markup into `reply.speech`, which the sentence scheduler can
send phrase by phrase before the reply finishes.

The candidate must accept nonverbal tags in the text. [Orpheus-TTS's official
README](https://github.com/canopyai/Orpheus-TTS) lists tags such as
`<laugh>`, `<chuckle>`, `<sigh>`, and `<cough>`. [Dia's official
README](https://github.com/nari-labs/dia) documents `(laughs)`, `(coughs)`,
`(clears throat)`, `(sighs)`, and related markers. [OpenAudio S1's project
README](https://github.com/fishaudio/fish-speech) documents emotional, tone,
and special markers. [Eleven v3's official documentation](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-alpha)
is the reference behavior, including `[laughs]`, `[clears throat]`, and
`[sighs]`.

Qwen3-TTS remains a cloning and quality candidate, but its [official
repository](https://github.com/QwenLM/Qwen3-TTS) documents natural-language
voice control rather than an inline nonverbal-tag vocabulary. Treat tag
support as unverified until a model probe passes; do not silently count an
instruction prompt as tag support.

The words and markers are the composer's register decision for the companion,
using the register rules in `docs/dev.md`. The voice model never sprinkles
disfluencies into otherwise clean speech. Expressiveness, disfluency,
humour, nonverbal frequency, and pace are companion dials that drive the plan
line, example lines, and a measured steering vector, not a prose paragraph in
the prompt. A child companion may be expressive; a crisp assistant may have
near-zero disfluency. Do not add a separate performance-director model unless
measurement shows that the composer and model controls are insufficient.

The top-two benchmark remains Chatterbox Turbo and Orpheus. Existing live
measurements in `docs/dev.md` record Chatterbox at 1.4 to 1.6x real-time with
no streaming and more than five silent seconds before audio for a 66-character
reply; Orpheus on Metal at 1.26 to 1.53x real-time with about two seconds to
the first chunk and real streaming. A fresh rerun was not possible in this
docs slice because neither runtime nor model files are installed on the
machine. Those numbers are prior measurements, not a new pass claim.

Follow-up: add a model tag vocabulary and time-to-first-audio bench, put the
dials on the companion record, and enforce the composer-owned disfluency rule
under the register backlog item.

### Image generation and editing

The image bar is one 1024 px image, with a LoRA loaded, in single-digit
seconds. The number is a target, not a claim that the Studio already meets it.
ComfyUI is the supervised workflow sidecar; MLX or DiffusionKit is preferred
when it is the faster Apple path. If no local workflow meets the bar after the
bench, the CUDA sidecar is the fallback. The model and adapter licences are
recorded separately before a workflow becomes a catalog choice.

| Candidate | Apple path and LoRA | Memory | 1024 px timing on M5 Max | Licence and verdict |
|---|---|---:|---:|---|
| FLUX.2 Klein 4B distilled | MLX or ComfyUI MPS `(?)`; unified text-to-image and multi-reference edit; LoRA training is documented for the family. | 8 to 14 GB `(?)` | 3 to 9 s warm with four steps `(?)`; 10 to 20 s cold `(?)` | Apache 2.0. First image and edit candidate. It meets the bar only if the M5 measurement is at the low end. |
| Qwen-Image-Lightning 4-step | ComfyUI MPS; LightX2V supplies a 4-step LoRA for generation and Qwen Image Edit. | 12 to 24 GB `(?)` | 5 to 12 s `(?)` | Qwen base is Apache 2.0; verify the Lightning adapter notice before distribution. Adopt with a timing and licence gate. |
| SDXL-Lightning 2 or 4-step | ComfyUI MPS, DiffusionKit, and Draw Things; full UNet or LoRA checkpoint. | 8 to 12 GB `(?)` | 3 to 8 s `(?)` | OpenRAIL++ and SDXL base terms apply. Fast fallback, but commercial terms need a catalog review. |
| FLUX.2 Klein 9B or full Qwen Image Edit | ComfyUI MPS or MLX conversion `(?)`; reference editing and LoRA where the selected base supports it. | 18 to 30 GB `(?)` | 15 to 40 s `(?)` | Klein 9B is non-commercial; Qwen Image Edit is Apache 2.0. Quality path, not the speed-bar path. |
| RMBG-2.0 | Small segmentation worker on MPS or Core ML `(?)`; no generation LoRA needed. | under 1 GB `(?)` | under 1 s `(?)` | CC BY-NC 4.0 weights. Use only for non-commercial previews, or replace it with a commercially cleared segmenter. |

Official references: [FLUX.2 Klein](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B),
[FLUX.2 training and LoRA](https://docs.bfl.ml/flux_2/flux2_klein_training),
[Qwen Image Edit](https://huggingface.co/Qwen/Qwen-Image-Edit),
[Qwen Image Lightning](https://github.com/ModelTC/LightX2V-Qwen-Image-Lightning),
[SDXL-Lightning](https://huggingface.co/ByteDance/SDXL-Lightning), and
[RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0). Published Apple timings
are not available for this Studio, so every timing above is `(?)`.

### Video generation

"Somewhat fast" means minutes, not tens of minutes: the bar is at most five
minutes for a five-second animated clip and at most ten minutes for a
five-second photorealistic clip, including a warm local run `(?)`. The UI
shows progress, an honest estimate, and a notification when the clip is ready.

| Kind | Model and Metal path | 5-second clip on M5 Max | Licence and verdict |
|---|---|---:|---|
| Animated children's video | LTX-2 distilled, or its compatible current revision, through the community MLX Apple-Silicon port; the model produces synchronized audio and accepts LoRAs. | 1 to 5 minutes at 540p or 720p `(?)` | LTX-2 community licence. Adopt first if the local licence review permits the planned household use and the M5 timing meets the bar. |
| Photorealistic trailer | Wan2.2 TI2V-5B through ComfyUI/PyTorch MPS. It supports text-to-video and image-to-video at 720p. | 5 to 10 minutes at 720p `(?)` | Apache 2.0 weights. Adopt as the quality path, subject to the MPS bench. |

The LTX repository publishes distilled checkpoints, LoRA training, and spatial
and temporal upscalers. The [LTX-2 model card](https://huggingface.co/Lightricks/LTX-2)
and [LTX-2 repository](https://github.com/Lightricks/LTX-2) support that plan;
the [community MLX port](https://github.com/baisampayans/ltx-mlx) is an Apple
path, not an upstream performance guarantee. The [Wan2.2 card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)
supplies the 720p and licence facts. Run the LTX spatial upscaler or a
separately verified Real-ESRGAN MPS workflow after generation, never as an
unmeasured promise.

Each multi-shot piece stays in chat: the request becomes a shot list, each
shot is generated and accepted or retried, then a local assembler joins shots,
adds titles, lays in the approved music track, and stores the shot list and
source ids. LTX is the animated path because it can carry a voice and sound
track. Wan is the photorealistic path, with music and narration added in the
assembly step.

### Music generation

The music request, result, variation, and provenance stay in the chat thread.
The hub records the model, prompt, seed, duration, source audio if any,
licence, and video ids that use the track. The weights licence is not a promise
about every training-data or platform claim, so a monetized export requires a
catalogue licence check to pass.

| Candidate | Apple path | One minute of audio on M5 Max | Video-use decision |
|---|---|---:|---|
| ACE-Step 1.5 | MLX or PyTorch MPS port `(?)`; reference audio and style controls. | 20 to 60 s `(?)` | MIT model and code according to the project. First candidate for monetized household videos, pending the exact weight and data notice. |
| Stable Audio 3.0 Small or Medium | PyTorch MPS `(?)`; current Stability open-weight audio path. | 10 to 45 s `(?)` | Community licence allows commercial use for organisations under $1M revenue; larger or unrestricted commercial use needs the stated Stability agreement. Adopt with that gate. |
| Stable Audio Open 1.0 | PyTorch MPS `(?)`. | 20 to 90 s `(?)` | Community licence and revenue limits apply. Do not mark clean for an unknown future commercial use. |
| MusicGen | PyTorch MPS `(?)`. | 10 to 40 s `(?)` | The model weights are non-commercial. Reject for videos that may earn money. |

Sources: [ACE-Step 1.5](https://ace-step.github.io/ACE-Step-1.5/en/),
[Stable Audio 3.0 licensing](https://stability.ai/license),
[Stable Audio core models](https://stability.ai/core-models),
[Stable Audio Open research](https://stability.ai/news-updates/stable-audio-open-research-paper),
and the [MusicGen repository](https://github.com/facebookresearch/audiocraft).
The Apple timings are estimates `(?)` until MEDIA-HOST-03 measures a fixed
60-second prompt, seed, sample rate, and export format.

## 3. The residency budget

The 128 GB number is shared by macOS, the desktop, the hub, sidecars, and
model allocations. It is not a 128 GB VRAM pool. The governor watches memory
pressure and observed process peaks rather than enforcing a static reservation.

| Resident profile | Estimated live set | Headroom before a generator | Decision |
|---|---:|---:|---|
| Qwen3-Next-80B-A3B, two 64k slots, dedicated judge, embed, STT, TTS | 62 to 78 GB `(?)` | 30 to 50 GB `(?)` | Preferred one-model profile if the first-day bench passes. |
| GPT-OSS-120B, two 64k slots, dedicated judge, embed, STT, TTS | 78 to 96 GB `(?)` | 12 to 30 GB `(?)` | Fits only with strict generator admission and measured KV. |
| GLM-4.5-Air, two 64k slots, dedicated judge, embed, STT, TTS | 72 to 90 GB `(?)` | 18 to 36 GB `(?)` | Fits, but its active-parameter speed estimate is weaker. |
| Qwen3-235B-A22B at 4-bit | over 128 GB with KV `(?)` | none | Reject. |

An image job adds 8 to 30 GB `(?)`. LTX or Wan adds 20 to 45 GB `(?)`.
Only one generator may run, and the governor can stop or queue it when the
observed pressure level leaves less than 20 GB of working margin `(?)`. The
judge, embedder, STT, and selected TTS remain the minimum resident set. There
is no second permanent coding model and no model shuffle that pretends the
full set fits.

## 4. What the Studio changes in the design

The old two-card assumptions go away. There is no internal GPU for chat, no
work card for coding, no display-card penalty to compare, no Thunderbolt link
in the engine path, and no placement decision between the RTX 2070 Super and
the eGPU. A single `HardwareInfo` record reports Apple Silicon and unified
memory. The supervisor records a role's local process and URL, not a GPU
index. Memory pressure and process RSS are the important live signals.

The hub monitor samples every 15 seconds for health and every 30 seconds for
resource state. On macOS it records `memory_pressure -Q`, `vm_stat`, process
RSS for every supervised child, and thermal state from `pmset -g therm`.
Each sample carries command source, timestamp, role, pid, memory bytes,
pressure level, thermal state, and whether a value was unavailable.

ComfyUI is a sidecar on `127.0.0.1`, with a fixed local port, a versioned
Python environment, a health URL, a queue endpoint, and an explicit output
directory. The hub supervises its lifecycle and sends only local workflow
requests. It does not enable remote API nodes or remote model providers.

The migration is a backup and restore, not a live dual-master period:

- Take a final encrypted Home backup from the development copy and current
  laptop data before cutover.
- Restore household SQLite state through the existing staging and restore
  path. Recreate paths on the Studio rather than copying laptop-specific
  absolute paths.
- Re-download macOS arm64 engine binaries and model assets through checksum-
  verified download jobs. Caches are not a backup contract.
- Do not copy Windows or CUDA artifacts into the Studio, and do not copy the
  old eGPU layout or its Thunderbolt assumptions.
- Close the cloned-voice backup gap before a household voice upload is called
  protected by migration.

The external WATCH-01 process starts with the hub through launchd, survives a
hub crash, reads protected settings and credentials, and sends one plain-facts
alert when the hub is down. Neither side claims to solve a simultaneous power
failure.

## 5. The program

1. **ENGINE-HOST-03, S, first-day model and Metal validation.** Record the
   exact hardware and engine identity. For each one-model candidate measure
   conversation-fixture score, Session C coding score, 4k/16k/32k prompt
   throughput, decode speed, first-token latency, cold load, warm cache reuse,
   two slots, tool calls, safety, and peak memory. Run the winning resident
   profile for two hours.
2. **ENGINE-HOST-04, M, engine catalog and host contract.** Add verified
   llama.cpp Metal and MLX launcher entries, a common OpenAI URL adapter,
   health and identity probes, pinned environments, and supervisor tests.
3. **ENGINE-HOST-05, M, resident roles.** Select the one foreground model,
   keep the dedicated judge or Qwen3-4B floor, embed, Moonshine, and the
   measured TTS choice. Expose memory and offline state in Repairs and the
   model page.
4. **ENGINE-HOST-06, M, standalone watcher.** Implement WATCH-01 as a
   launchd-managed process with health and engine probes, pressure samples,
   facts-first alerts, and hub-to-watcher heartbeat checks.
5. **MEDIA-HOST-01, M, supervised images and edits.** Install ComfyUI in a
   pinned local environment, add the local queue and health contract, run the
   chosen 4-step image and edit workflows with a LoRA, and measure warm/cold
   1024 px times and peak memory.
6. **MEDIA-HOST-02, L, local video.** Run LTX animated and Wan photorealistic
   workflows on Metal, record five-second times and peaks, add progress and
   notification state, and keep hosted video services out of the local path.
7. **MEDIA-HOST-03, M, local music.** Benchmark one minute of audio for
   ACE-Step and the selected Stability model, record licences and provenance,
   and block monetized export when the weights or terms are not cleared.
8. **CHAT-MEDIA-01, L, generation in chat.** Add attachments, references,
   edits, undo, variations, provenance, progress, and the household consent
   check without creating a separate generation surface.

No follow-up changes safety, consent, or child-band rules. Image, video, and
music pass the same non-removable safety floor before an asset is shown or
saved.

## 6. Pictures and video in chat

Generation is a ChatGPT-class chat action. An attached image, an image from
ATT-01, or a generated result becomes a thread asset. "Make this sunnier",
"remove the background", "make the car red", "this one", and "the last
picture" resolve against the thread's asset ids. The original remains, the
result appears beside it, undo is one tap, and "more like this" and "try
again" create follow-up jobs. Provenance stores model, prompt, seed, adapter,
source image id, consent decision, and licence review. It is not a visible
watermark on a household image unless the owner enables one.

### Household people and consent

The narrowed rule permits an identifiable household member only in the
household's own picture, with consent recorded once. The setting is a
per-person record with this shape:

`{ person_id, kind: "generation_people", scope: "own_household_photos", status: "granted" | "revoked", granted_by_person_id, recorded_at, source_turn_id, policy_version }`

An adult grants for themselves. A parent grants for a child. A child profile
cannot grant, request, or operate this path. Revocation blocks new jobs and
does not erase already-owned originals; the hub retains the provenance record.
The edit model receives the member's reference image id plus the target image
and a plain instruction. FLUX.2 Klein multi-reference editing and Qwen Image
Edit are the reference paths. Identity consistency and 20 to 90 seconds per
edit on the Studio are estimates `(?)`, so the first-day edit bench decides
whether this is an acceptable household feature.

The detector is the same classifier rule used elsewhere, not a word list. Its
first fixtures cover a named member, a pronoun resolved to a member, and a
reference image whose subject is a member. A request involving a non-member
is answered in chat with: "I can edit a household member's picture when they
have consented. I can change the background, lighting, or objects instead."
There is no path for adding a non-member to a picture.

Anything outside the child ceiling gets the grown-up line. The safety floor
remains before display, persistence, or export.

### Video jobs and two kinds of story

The chat request may be a prompt or a picture. The thread shows queued,
loading, rendering, assembling, and ready states, with a cancel action and a
notification when a long job completes. An animated children's story uses
LTX for stylized characters, a voice track, and short clips. A photorealistic
trailer uses Wan for shots and cuts, then adds titles, narration, and cleared
music. The chat creates the shot list, each shot is accepted or retried, and
the local assembler creates the final piece. No separate generation app is
required.

## 7. The model host

The host decision is split. One platform for language models and image/video
workflows would add more moving parts than it removes.

| Candidate | Licence and source | Engines and operations | Privacy and verdict |
|---|---|---|---|
| llama.cpp `llama-server` | MIT, upstream source. | Metal, OpenAI-compatible API, slots, prompt reuse, health and identity are already in Home. Home owns download, checksum, pin, supervision, and swap. | Passes the zero-phone-home rule when Home controls the binary and network. Adopt as language baseline. |
| `mlx-lm` server | Open source Apple project. | MLX, OpenAI-like API, prompt cache, concurrency, adapters, draft model. It has no complete model catalogue or supervisor and warns that its security checks are basic. | Local URL, no required cloud path. Adopt as a Home-managed engine candidate, not as the whole platform. |
| Ollama | Open-source server and model tooling. | llama.cpp-based local serving, model pull/import, local API, and model switching. Cloud can be disabled with `OLLAMA_NO_CLOUD=1` or `disable_ollama_cloud`. | Passes only in local-only mode with outbound network blocked for the service. Optional developer host, not the production identity or checksum authority. Sources: [Ollama FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) and [import guide](https://github.com/ollama/ollama/blob/main/docs/import.mdx). |
| LM Studio and `llmster` | Closed app and daemon. | llama.cpp and MLX runtimes, model download and pinning, OpenAI-compatible API, JIT load/unload, headless service, and multiple loaded models. | Its privacy page names update checks and model searches/downloads as outbound events, but no named setting makes all of them opt-in. Reject as a product dependency, though a user may point Home at a separately installed local server. Sources: [offline operation](https://lmstudio.ai/docs/app/offline), [headless service](https://lmstudio.ai/docs/developer/core/headless), and [privacy](https://lmstudio.ai/app-privacy). |
| ComfyUI | GPLv3 application. | Apple Silicon/MPS, image and video workflows, local API, queue, custom nodes, and model folders. | Passes as a separately installed local sidecar with remote nodes disabled. Adopt for image, edit, and video generation. Source: [ComfyUI](https://github.com/Comfy-Org/ComfyUI). |
| Draw Things | GPLv3 code. | Metal image generation, LoRAs, scripts, and a local API. | Good interactive Apple worker, but GUI-first and not the Home supervisor. Optional user-installed sidecar, not the catalog host. Sources: [Draw Things docs](https://docs.drawthings.ai/) and [community licence](https://github.com/drawthingsai/draw-things-community). |
| DiffusionKit and MLX image tools | Open-source libraries with separate model terms. | Core ML and MLX Apple image pipelines. No common multi-model service, queue, or launchd contract. | Use as first-party workers when a workflow beats ComfyUI. Not a platform. Source: [DiffusionKit](https://github.com/argmaxinc/DiffusionKit). |
| whisper.cpp, MLX Whisper, existing Moonshine | Separate open-source speech runtimes. | STT workers, but no single model manager or shared media queue. | Keep Moonshine in-process and add Qwen3-TTS/Kokoro through the existing speech supervisor. Do not add a second host just for speech. |

Home keeps the guards, memory governor, turn engine, consent, provenance,
model identity, checksum records, and stable URL contract. Home drops child
process spawning and killing only for an explicitly external host. It does not
drop health checks, request filtering, safety evaluation, or offline state.
Host-managed downloads do not silently become trusted: a model has to carry
its source, revision, licence, checksum, and host identity before selection.

The catalog shape gains a `managedBy` value beside `url`, `spawned`, and
`stub`, for example `managedBy: "ollama"`, `managedBy: "mlx-lm"`, or
`managedBy: "comfyui"`. A managed entry has no Home launcher, but it has a
health probe, identity probe, memory report, expected model revision, and an
explicit `offline_reason` when the host is unavailable. The supervisor starts
and stops only `spawned` entries. This is the migration order:

1. Keep the current llama.cpp URL contract and add MLX as a measured candidate.
2. Add managed language-host entries and prove tool calls, safety, identity,
   memory, and restart behavior against a local test service.
3. Move image, edit, video, and music jobs behind the supervised ComfyUI queue.
4. Add user-facing host settings and the outbound-connection table. Every
   update, catalogue, and download action is opt-in and local data never goes
   to a MaiPai service.

## 8. What the Studio changes in the program

- Keep a CUDA-only path for the Windows catalogue, not for the Studio.
- Do not buy or attach an eGPU, or put Thunderbolt in the engine path.
- Do not substitute a hosted video service when a local role is offline.
- Do not make speculative decoding an Apple dependency before a Metal bench.
- Do not keep a second model resident as an automatic backup.

## Sources and uncertainty

Sources checked 2026-09-17: [Apple Mac Studio specifications](https://www.apple.com/mac-studio/specs/),
[llama-server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
[MLX LM server](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md),
[Qwen3-Next](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct),
[GPT-OSS](https://openai.com/index/gpt-oss-model-card/),
[ComfyUI](https://github.com/Comfy-Org/ComfyUI),
[FLUX.2 Klein](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B),
[Qwen Image Edit](https://huggingface.co/Qwen/Qwen-Image-Edit),
[LTX-2](https://huggingface.co/Lightricks/LTX-2),
[Wan2.2 TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B),
[ACE-Step 1.5](https://ace-step.github.io/ACE-Step-1.5/en/),
[Stable Audio licence](https://stability.ai/license),
[Qwen3-TTS](https://arxiv.org/abs/2601.15621), and
[Kokoro](https://github.com/hexgrad/kokoro).

The three least certain points are the M5 speed and peak-memory numbers for
the large one-model candidates; the Apple timings and licence notices for the
new image, video, and music combinations; and whether the community MLX video
port can meet the animated-video bar at the required resolution `(?)`.
