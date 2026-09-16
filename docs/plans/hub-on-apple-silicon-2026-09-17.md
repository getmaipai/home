# The hub on a Mac Studio M5 Max with 128 GB

Owner decision, 2026-09-17. The whole hub moves to one Mac Studio M5 Max
with 128 GB unified memory and 2 TB SSD. The eGPU path is closed. The old
two-card note remains a record of measurements, but it is not an installation
plan. The priorities are a ChatGPT-class experience, coding, then video.

The Studio configuration used here is the M5 Max with an 18-core CPU, a
40-core GPU, and 614 GB/s memory bandwidth. Apple lists 128 GB as the maximum
unified-memory configuration for that chip and 2 TB as an available SSD size.
Source: [Apple Mac Studio technical specifications](https://www.apple.com/mac-studio/specs/).

## 1. Runtime per role

### The two runtime families

| Runtime | Chat and coding behavior on this box | Serving and cache behavior | Decision |
|---|---|---|---|
| llama.cpp with Metal | The existing `llama-server` path is already exercised by Home. The pinned b10797 macOS arm64 binary is verified in `backend/src/lib/engineCatalog.ts`. | OpenAI-compatible `/v1/chat/completions`, `cache_prompt`, explicit `id_slot`, and parallel slots are already part of Home's client contract. The pinned engine treats MTP as CUDA-only for this plan. | Production baseline for chat and coding until an MLX adapter passes the same tool, safety, health, and restart checks. |
| MLX with `mlx-lm` | Native Apple Silicon execution and the only practical path in this comparison for the 122B-A10B candidate. The Apple project describes its shared-memory device model directly. | `mlx_lm.server` exposes an OpenAI-like HTTP API, prompt-cache files, decode and prompt concurrency, and a `draft_model` for speculative decoding. Quantized KV cache saves memory but disables batching. The upstream server warns that its security checks are basic. | First-class `intelligence` engine candidate. It may become the fixed `chat` engine only after the Studio bench proves tool-call correctness and operational behavior. |

Sources: [MLX documentation](https://ml-explore.github.io/mlx/build/html/index.html),
[MLX LM server documentation](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md),
and the [llama-server options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Both runtimes must preserve one contract at the Home boundary. A role has one
selected engine URL, one model identity, one health probe, and one supervisor.
The URL may be `http://127.0.0.1:<port>` for a child process or a configured
local URL for an already-running process. No runtime failover is introduced.

### What is measured and what is not

The superseded GPU layout measured Qwen3.8-27B on an RTX 5060 Ti at 33.7
decode tokens per second and 879 prompt tokens per second. Its Qwen3-8B run
reached 78.7 decode tokens per second. Those are useful workload numbers, not
Apple Silicon numbers.

The public MLX benchmark that is closest to this machine used an M4 Pro with
20 GPU cores and 64 GB unified memory. It reports Qwen3.5-27B int4 at 11.8
tokens per second, 22.1 GiB peak at a 4096-token prompt, and 36.57 seconds to
the first token for that prompt. It reports Qwen3.5-35B-A3B int4 at 25.6
tokens per second and 23.7 GiB peak. Source: the [MLX coding benchmark
report](https://github.com/weklund/mlx-coding-bench/blob/main/measurements/llm_benchmarks/Apple_M4_Pro_10P%2B4E%2B20GPU_64GB/2026-03-06__19:47:24/REPORT.md).

For the 100B-class MoE, Qwen3.5-122B-A10B is the candidate. A public MLX
benchmark reports 42.5 tokens per second and 69.62 GB on disk, but its target
hardware and test method are not sufficiently documented for a placement
decision, so both numbers are marked `(?)`. There is no trusted, repeatable
M5 Max result for its decode or prompt speed in this record. The first-day
bench below supplies those numbers.

For prompt processing, the only directly usable numbers are the 879 tokens
per second 5060 Ti result and the M4 Pro MLX report's 4096-token first-token
time, approximately 112 prompt tokens per second if treated as pure prefill
`(?)`. The 122B prompt rate is unknown `(?)` and must be measured at 4k, 16k,
and 32k.

### Speculative decoding and slots

The pinned llama.cpp engine is treated as having no usable MTP on Metal. A
CUDA-only MTP choice must never be enabled by an Apple Silicon catalog entry.
The current upstream server documentation lists several speculative-decoding
types, and recent upstream discussions show Metal experiments, but that is not
enough to make MTP a Home dependency on the pinned build. A later engine pin
can change this only after a real Metal bench.

MLX offers a smaller draft model through `mlx_lm.server --draft-model` and a
`num_draft_tokens` setting. That is a real option, but it is not a free win:
the MLX server's quantized KV mode cannot batch, and a draft model consumes
unified memory and bandwidth. The first implementation should use one slot
for the 122B intelligence role. The existing llama.cpp chat role keeps two
slots and prefix reuse. A two-slot MLX configuration is a measured follow-up,
not an assumption.

### Recommendation

Use llama.cpp Metal as the production chat and coding baseline now. It is the
only path already connected to Home's guards, tool calls, identity reporting,
prefix caching, two-slot serving, and auto-heal. Add an MLX engine entry and a
shared OpenAI-compatible URL adapter for the intelligence role. Test the
122B-A10B MLX model as the first large reasoning candidate. If the first-day
bench and the ChatGPT-class conversation fixture pass, the owner may select
that MLX engine for `chat`; this is a selection change, not a live fallback.

`engineCatalog` needs a `mlx-lm` entry with a pinned environment or launcher,
model format, URL port, health probe, and verification status. The supervisor
needs the same lazy-start-once state, generation guard, identity read, process
watch, graceful stop, and memory-pressure integration as
`llmSupervisor.ts`. The client contract must remain the same URL contract,
with an adapter for MLX's model-list health response if it has no `/health`
endpoint. `backgroundSupervisor.ts` remains a separate small llama-server
role unless measurement proves that moving it to MLX improves the total
resident set without delaying chat.

## 2. Models per role

Memory figures are binary GiB when the source says GiB and decimal GB when the
source says GB. A model file is not a process peak. The latter includes KV,
compute buffers, tokenizer, and runtime allocations. `(?)` means the figure is
an estimate or a result whose hardware or measurement method is incomplete.

### Chat, intelligence, and coding

| Role and candidate | 4-bit memory | 8-bit memory | Full precision | Placement and decision |
|---|---:|---:|---:|---|
| Qwen3.5-122B-A10B MLX, 122B total and 10B active | 69.6 GB weights; about 65.5 GB peak in a public MLX run `(?)` | about 139 GB `(?)` | about 279 GB `(?)` | One selected `chat` or `intelligence` role, never both copies resident. Best large-model candidate, subject to the Studio bench. |
| Qwen3.5-27B dense MLX | 22.1 GiB peak at 4096 tokens in the M4 Pro report | 35.5 GiB peak at 4096 tokens in the M4 Pro report | about 57 GiB `(?)` | Compact ChatGPT-class candidate. The 4-bit version fits beside the rest and is the safe chat candidate if 122B latency or tool behavior misses the bar. |
| Qwen3.8-27B coder, the current GGUF with MTP head | about 15.4 GB at 64k q8 KV, using the old layout note | about 30 GB `(?)` | about 55 to 60 GB `(?)` | Fixed coding role on llama.cpp Metal. A larger coder is not worth its memory until a coding bench shows a clear quality gain at an acceptable first token. |

The dense 27B figures come from the [published MLX benchmark
report](https://github.com/weklund/mlx-coding-bench/blob/main/measurements/llm_benchmarks/Apple_M4_Pro_10P%2B4E%2B20GPU_64GB/2026-03-06__19:47:24/REPORT.md).
The 122B candidate's model card and configuration are in the
[MLX Community repository](https://huggingface.co/mlx-community/Qwen3.5-122B-A10B-4bit).
The existing coder numbers and the 5060 Ti measurements are in
`docs/plans/gpu-card-layout-2026-09-14.md`.

### Judge, embed, and speech

| Role | 4-bit or existing memory | 8-bit or full precision | Decision |
|---|---:|---:|---|
| Background judge, Qwen3-4B Q4_K_M | 2.50 GB file; about 4.4 GB loaded `(?)` | about 7.5 GB at 8-bit and 14 GB at bf16 `(?)` | Keep separate from foreground chat. The current `backgroundSupervisor.ts` runs it with reasoning off and no prompt cache. |
| Embed, `nomic-embed-text-v1.5.Q4_K_M.gguf` | 84 MB file; about 0.4 GB resident | about 0.8 GB at 8-bit and 1.6 GB full precision `(?)` | Unchanged. Keep it always available so recall does not wait on a generator. |
| STT, Moonshine tiny-en int8 plus Silero VAD | 108 MB Moonshine archive plus VAD `(?)` | about 0.2 GB for a higher-precision speech model `(?)` | Keep the existing in-process Moonshine path. Whisper.cpp and MLX Whisper are alternatives for a later quality or language decision, not a reason to add a second resident stack now. |
| TTS, Kyutai Pocket TTS | 100M model, about 0.3 to 1 GB process working set `(?)` | no useful 8-bit or full-precision resident number measured | Keep the existing CPU process and streaming route. An MLX port is not needed for this machine's minimum set. |

### Image generation

Use ComfyUI as a supervised sidecar, with one queue and one workflow at a
time. The repository's catalog picks FLUX.2 [klein] 4B over Juggernaut XL
when sharper output matters, while keeping Juggernaut XL as the larger-LoRA
alternative. ComfyUI officially lists macOS, Apple Silicon, FLUX.2, and Wan
2.2 support, and it supports offline local execution. Sources: the
[ComfyUI repository](https://github.com/Comfy-Org/ComfyUI) and the existing
`backend/src/lib/modelCatalog.ts` decision.

On Apple Silicon, an MLX 4-bit FLUX.2 Klein path is the preferred first
measurement. A community M4 run reports roughly 4.3 GB of Klein weights and
about 11 GB peak at 1024 by 1024. Its bf16 MPS path reports about 15 GB peak.
These are implementation measurements, not a Home catalog guarantee. Plan
for 11 to 16 GB at 4-bit, 8-bit, or bf16 depending on the chosen pipeline,
then replace that estimate with a full-pipeline peak from the Studio bench.

Expected 1024 by 1024 image time is 30 to 60 seconds warm and 45 to 90
seconds cold `(?)` for a four-step distilled Klein workflow. The estimate
comes from the M4 report of roughly 12 seconds per step and adds model-load
and M5 variance. The UI must say that this is an on-demand job, not imply a
chat-latency promise. MPS FP8 failures are a known path in current PyTorch
ComfyUI usage, so use an MLX quant or convert to bf16 until the exact M5
software stack proves native FP8.

### Video generation

The nearest practical local model is Wan2.2 TI2V-5B. Its official card says
that it supports text-to-video and image-to-video at 720p and reports under
nine minutes for a five-second 720p clip on a single consumer GPU without
special optimization. It does not publish an Apple MPS result. Source:
[Wan2.2-TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B).

For the Studio, budget 12 to 20 GB for a 4-bit or offloaded 5B workflow,
20 to 32 GB for 8-bit, and 35 to 50 GB for full precision `(?)`. A realistic
first product expectation is 8 to 20 minutes for a five-second 720p clip and
15 to 40 minutes for ten seconds `(?)`, including load and decode. The first
bench must measure the exact workflow, resolution, frame rate, steps, peak
resident memory, and total wall time.

The owner's Hailuo-class target is not the same as Wan. Hailuo-02 is a
hosted MiniMax service, not a local checkpoint with a Home-compatible Metal
runtime. The missing pieces are downloadable weights, a supported local
inference implementation, Metal kernels, and a safe supervised API boundary.
MiniMax H3 is a separate open model and ComfyUI now lists it, but it is not a
substitute for Hailuo-02 and its Apple performance and operational maturity
are unmeasured `(?)`. Do not add a cloud Hailuo connection to Home as a silent
substitute. Wan2.2 TI2V-5B on MPS is the nearest model that has a realistic
local path.

## 3. The residency budget

The 128 GB number is shared by the operating system, the desktop, the hub,
the sidecars, and model allocations. It is not a 128 GB VRAM pool. The
governor remains dynamic and watches memory pressure rather than enforcing a
static household reservation.

The following totals show the two useful foreground profiles. They include
the background judge, embedder, STT, and TTS, but not an image or video job.

| Resident profile | 4-bit total | 8-bit total | Full precision total | Against 128 GB |
|---|---:|---:|---:|---|
| 122B intelligence + background + embed + speech | about 71 GB | about 149 GB `(?)` | about 297 GB `(?)` | 4-bit fits; 8-bit and full precision do not. |
| 27B chat + 27B coder + background + embed + speech | about 43 GB | about 75 GB `(?)` | about 145 GB `(?)` | 4-bit and 8-bit fit; full precision leaves no honest operating margin. |

An image job adds roughly 12 to 20 GB `(?)`. A Wan job adds roughly 16 to
32 GB `(?)`. The 122B 4-bit profile can therefore remain loaded while one
generator runs in principle, but the governor may take the generator offline
when macOS reports pressure or the observed process peak leaves too little
room. The compact profile is more comfortable for coding plus one generator.

The minimum resident set is chat or intelligence, embed, judge/background,
STT, and TTS. Coding, image, and video are features. They are loaded only
when selected and when the one-box governor says the observed memory state can
carry them. Image and video never run simultaneously, and neither is loaded
to replace another role. A request that cannot fit is queued or receives the
role's exact offline line from ENGINE-HOST-02. A generator that disappears
stays off until its health probe and hold time say it is back. No secondary
placement, just-in-time model shuffle, or permanent reserved backup is added.

## 4. What the Studio changes in the design

The old two-card assumptions go away. There is no internal GPU for chat, no
work card for coding, no display-card penalty to compare, no Thunderbolt link
to put in the engine path, and no placement decision between the RTX 2070
Super and the eGPU. A single `HardwareInfo` record reports Apple Silicon and
unified memory. The supervisor records a role's local process and URL, not a
GPU index. Memory pressure and process RSS are the important live signals.

The hub monitor samples every 15 seconds for health and every 30 seconds for
resource state. On macOS it records `memory_pressure -Q`, `vm_stat` free and
speculative pages, process RSS for every supervised child, and the thermal
state from `pmset -g therm`. A numeric SoC temperature from `powermetrics`
is not required `(?)` because it may need extra permission and is not a safe
requirement for an unattended service. Each sample carries the command
source, timestamp, role, pid, memory bytes, pressure level, thermal state,
and whether the value was unavailable. The existing `engineStats.ts` 60-second
in-memory ring remains useful for the UI, but it is not the external
watcher's health record.

ComfyUI is a sidecar process on `127.0.0.1`, with a fixed local port, a
versioned Python environment, a health URL, a queue endpoint, and an explicit
output directory. The hub supervises its lifecycle and sends only local
workflow requests. It does not enable ComfyUI API nodes or any remote model
provider. Its child process is watched like the existing engine children and
is subject to the same graceful-degradation and memory-pressure rules.

The migration is a backup and restore, not a live dual-master period.

- Take a final encrypted Home backup from the Mac Pro development copy and
  the laptop's current hub data before the cutover. Restore the household
  SQLite state into the Studio through the existing staging and restore path.
- Move source, launch configuration, package state, settings, people,
  conversations, memories, and notification configuration. Recreate paths
  on the Studio rather than carrying laptop-specific absolute paths.
- Re-download the macOS arm64 engine binary and model assets through their
  checksum-verified download jobs. The 2 TB SSD is enough for the selected
  122B 4-bit model, the compact coding model, ComfyUI assets, and working
  caches, but caches are not a backup contract.
- Do not copy Windows or CUDA engine artifacts into the Studio. Do not copy
  the old laptop's eGPU layout or its Thunderbolt assumptions.
- Home backups cover the encrypted `hub.db` snapshot and its recorded
  household state. They do not back up `data/models`, `data/engines`, logs,
  or other re-downloadable runtime caches. The current code also documents
  cloned voice files as a backup gap. That gap must be closed before a
  household voice upload is treated as protected by the migration.
- The keystore and backup key remain platform-owned secrets. The emergency
  kit is the recovery path. A raw copy of the keystore or an unencrypted
  database is not a migration artifact.

The external WATCH-01 process starts with the hub through launchd, survives a
hub crash, reads the same protected settings and credential store, and sends
the one plain-facts alert when the hub is down. The hub watches the watcher's
heartbeat when it is up. Neither side claims to solve a simultaneous power
failure.

## 5. The program

The following backlog items are in owner priority order. The first item is a
first-day measurement, not a promise derived from a vendor page. The
mechanical queue candidates are ENGINE-HOST-03 through MEDIA-HOST-02.

1. **ENGINE-HOST-03, S, first-day Metal validation.** Record the exact
   identity from `system_profiler` and the engine's `--version`; fill the
   model's 4-bit weights and baseline runtime; measure 27B and 122B decode,
   prompt throughput at 4k, 16k, and 32k, first-token latency, cold load,
   warm cache reuse, and two-slot behavior; then soak each resident profile
   for two hours while sampling memory pressure, RSS, thermal state, and
   output correctness. This mirrors the old GPU validation bench with
   identity, fill, throughput, and soak, replacing `nvidia-smi` with Apple
   Silicon process and system samples.
2. **ENGINE-HOST-04, M, Metal and MLX engine catalog.** Add the verified
   llama.cpp Metal and MLX launcher entries, a common OpenAI URL adapter,
   health and identity probes, pinned environments, and supervisor tests.
   Queue candidate after ENGINE-HOST-03.
3. **ENGINE-HOST-05, M, resident role provisioning.** Add the selected
   122B or dense 27B intelligence model, keep the current 27B coder,
   preserve the judge, embed, Moonshine, and Pocket TTS minimum set, and
   expose measured memory and offline state in Repairs and the model page.
   Queue candidate after ENGINE-HOST-04.
4. **ENGINE-HOST-06, M, standalone one-box watcher.** Implement WATCH-01
   as a launchd-managed process with `/api/health` and engine probes, the
   15-second health hold, 30-second resource samples, Telegram's existing
   privacy-page row, facts-first alerts, and hub-to-watcher heartbeat checks.
   Queue candidate after ENGINE-HOST-05.
5. **MEDIA-HOST-01, M, supervised image generation.** Install ComfyUI in a
   pinned local environment, add the local queue and health contract, run
   FLUX.2 Klein and Juggernaut XL through the child-safety boundary, and
   measure warm and cold 1024-pixel image times and peak memory. Queue
   candidate after ENGINE-HOST-05.
6. **MEDIA-HOST-02, L, measured local video.** Run Wan2.2 TI2V-5B on MPS
   at the supported 720p shape, record five- and ten-second clip times and
   peaks, add the on-demand UI and graceful offline state, and keep Hailuo
   hosted models out of the local engine path. Queue candidate after
   MEDIA-HOST-01.

No follow-up changes safety, consent, or child-band rules. Image and video
must pass the same non-removable safety floor before a generated asset is
shown or saved.

## 6. What we will not do

- Keep a CUDA-only path alive on the Studio. CUDA artifacts remain for the
  Windows catalog only.
- Buy or attach an eGPU for the hub.
- Put Thunderbolt in the engine path.
- Run a hidden cloud Hailuo substitute when a local video role is offline.
- Use MTP as an Apple Silicon dependency before a real Metal validation.
- Keep a second model resident as an automatic backup or shuffle models on
  demand to make a full set appear to fit.

## Sources and uncertainty

Sources checked 2026-09-17: [Apple Mac Studio specifications](https://www.apple.com/mac-studio/specs/),
[llama-server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
[MLX documentation](https://ml-explore.github.io/mlx/build/html/index.html),
[MLX LM server documentation](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md),
[MLX coding benchmark report](https://github.com/weklund/mlx-coding-bench/blob/main/measurements/llm_benchmarks/Apple_M4_Pro_10P%2B4E%2B20GPU_64GB/2026-03-06__19:47:24/REPORT.md),
[ComfyUI](https://github.com/Comfy-Org/ComfyUI), and
[Wan2.2-TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B).

The three least certain points are the 122B MLX speed and peak because the
public benchmark's target hardware is unclear `(?)`; the exact M5 MPS
behavior and wall time of ComfyUI's FP8 or bf16 video and image pipelines
`(?)`; and whether current upstream llama.cpp Metal speculative decoding can
be safely promoted from an experiment to a verified Home engine `(?)`.
