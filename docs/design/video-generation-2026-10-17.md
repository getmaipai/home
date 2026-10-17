# Video generation: the model, the runtime, the policy (2026-10-17)

Owner approval, 2026-10-17: "make your owner decisions, you have all approvals from me. Determine what video gen we should use and add it
to the app and chat. Fast generation with high quality. Ideally LoRA support from the community." Correction the same night: adults get
adult-only LoRAs; only the absolute lines no setting can lift stay (section 7). This note is part 1 of the pipeline (research, bench,
decision, rows). No product code is written yet. Every number was measured on the Studio (Apple M5 Max, 128 GB, macOS 27) while the
live Stack ran (about 28 GB resident) and another agent benchmarked image generation on the same GPU under the shared lock, so times
are upper bounds. Scripts, logs, clips and keyframe sheets are in the author's scratchpad (`scratchpad/videogen`, paths in section 6).

## 1. The pick

| | Pick | Licence | Why |
|---|---|---|---|
| Default (p128 only) | **Wan2.2 TI2V-5B, FastWan DMD 3-step distillation, MLX** (`lBroth/FastWan2.2-TI2V-5B-MLX` weights) | Apache-2.0 (base `Wan-AI/Wan2.2-TI2V-5B` Apache-2.0; FastWan `FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers` Apache-2.0) | A 5 s, 121 frame, 24 fps clip at 832 x 480 in **about 130 to 140 s end to end** (3 denoise steps, 10 to 16 s), text-to-video and image-to-video in one model, the largest community LoRA base of any permissive model, no safety filter in the weights or the runtime |
| Runtime | **mlx-video** (MIT, Blaizzy/mlx-video, commit `87db56a`), Wan2.2 path, run by a Stack-managed Python 3.12 worker | MIT | Native MLX (Apple GPU), `--lora` loading built in, image conditioning built in, no server to expose, no network calls at generate time except one tokenizer lookup the pin removes (section 3) |
| Sound | None from this model. Music and voice already exist as Stack roles (`music`, `tts`); the assembler lays them in | n/a | Wan has no audio. The one permissive model with audio (Kandinsky 6.0) is the fallback below |
| Fallback / second pin, not default | **Kandinsky 6.0 Video Lite distill (3B, MIT)**: text and image to video **with synchronized 44 kHz audio**, 10 steps | MIT on the card | Measured on this Mac through PyTorch MPS: 22.7 s per step, **227 s denoise alone**, and the untiled decode died at a 194 GB peak. Fails the speed bar today; revisit when an MLX port exists. See section 2 |
| Smaller tiers (p16, p32, p64) | **Off.** `video` stays "not available" | | Peak 44 GB at 121 frames. **p64 is off by the owner's call (2026-10-17):** the clip's 44.1 GB beside the roughly 28 GB resident chat set leaves no room on a 64 GB Mac, so every clip there would be refused with `no_memory`; video is offered only where it can run. A smaller-frame, quantized path was not measured; claiming it would be a guess. Row VIDEO-GEN-09 measures a 480p, 61 frame q8 profile for p32 before any promise |

The bar was "5 s at 480p to 720p in under about 3 minutes warm". 480p meets it (122 to 141 s); 720p does not (308 s, 53.9 GB), see section 4.

## 2. Candidates and why each lost (licence texts read; numbers are measured unless marked)

| Candidate | Licence (read) | Result |
|---|---|---|
| **LTX-2.3 and LTX-2.5** (Lightricks, 22B, audio, distilled 8-step, big LoRA scene: 119 adapters on the 2.3 card, 57 on LTX-2) **(reversed 2026-10-17, section 14: the optional Detailed kind, downloaded by an admin, never bundled)** | `LICENSE-2_x`, dated 2026-08-11: "Entities with annual revenues of at least $10,000,000" must buy a paid licence for any commercial use, with a back-fee clause; an Acceptable Use Policy with 20-odd listed uses; New York arbitration. LTX-2.3 sits under the January licence with the same $10M rule | **Rejected on the brief's own bar (no revenue exclusions).** Not benchmarked: a model we cannot ship to a household product that grows past the threshold is not a candidate. No clause bans adult or NSFW output (item 2 bans exploiting or harming minors; item 5 asks that machine-made content be disclosed; item 7 bans deepfakes without consent). Revisit only if the owner accepts a revenue-tiered licence |
| **Wan2.2 TI2V-5B, 40-step reference** | Apache-2.0 | Same weights as the pick, the undistilled sampler. Not run: 40 steps with guidance is 2 forward passes per step, about 13x the denoise cost of the 3-step FastWan run (10 s), no quality gain that justified the wait |
| **Wan2.2 A14B (T2V, I2V), 14B dual-model** | Apache-2.0 | Best quality and the largest LoRA base (331 adapters on I2V-A14B, 52 on T2V-A14B), but two 14B experts: tens of minutes on this chip and about 2x the memory. Kept as a later quality profile (VIDEO-GEN-10), not the default |
| **Wan 2.5, 2.6, 2.7** | API only | No open weights exist (the Wan-AI organisation stops at 2.2). Claims of an open "2.7" come from SEO pages and the Hugging Face model search finds nothing |
| **HunyuanVideo 1.5** | Tencent Hunyuan Community Licence: "DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA", use and output outside the Territory is unlicensed | **Rejected on licence (territory exclusion).** Not benchmarked |
| **MiniMax H3 and FreeVideo** | H3 licence excludes the US, EU, UK, South Korea; FreeVideo is Nvidia-first | **Rejected, not run** (as instructed) |
| **Kandinsky 6.0 Lite distill (3B)** | MIT on the model card, no LICENSE file in the repo (verify against the GitHub repo before shipping; a row asks) | **Real contender, second pin.** Quality not judged (no complete clip: the run died in the decode). Speed: 22.7 s per step times 10 steps on MPS. LoRA: none for 6.0 yet; 8 camera-motion LoRAs for 5.0 only. The pipeline has no LoRA mixin and no safety checker. Dependencies to clear: an audio VAE and vocoder whose weight provenance the card does not state (`sample_audio=False` avoids them), a Qwen2.5-VL 7B text encoder (Apache-2.0), CLIP (MIT) |
| **CogVideoX-5B and 1.5** | Custom CogVideoX licence ("other") | Not benchmarked: custom licence plus older, 480p-class quality |
| **Mochi-1** | Apache-2.0 | Not benchmarked: 10B, 480p only, no Mac path found, no audio |
| **LongCat-Video** (13.6B) | MIT | Not benchmarked: 13.6B, 15 fps native, no MLX port; revisit if one appears |
| **SANA-Video 2B** | Apache-2.0 | Not benchmarked: text to video only in the layout note; no Mac path found |
| **mlx-serve** (ddalcu, MIT, Zig, LTX-Video 2.5 default) | MIT code; LTX weights carry the LTX licence | Rejected as the runtime: LTX is the licence problem above, LoRA support for video is not documented, and it is a second server to supervise. Wan runs through mlx-video with no server |

## 3. Runtime: how the Stack runs it

- **Engine**: a managed Python 3.12 environment `video-gen` (mlx, mlx-video pinned by commit `87db56a`, hashed requirements, the same
  uv builder as the voice engines and the image tools worker). One worker process speaks JSON lines on stdin and stdout (no port),
  starts on the first video job, stays alive for the keep-warm window, then exits and returns its memory. mlx-video's PyTorch need is
  conversion only and the converted MLX weights are pinned, so the environment carries no torch.
- **Two local changes to pin** (kept as a patch file in the Stack, upstreamed if accepted): (a) the **DMD sampler**: mlx-video's Wan path
  has the unipc, dpm++ and euler solvers only, FastWan needs "predict x0, then renoise to the next sigma" over sigmas
  `[1.0, 0.757, 0.522, 0.0]` (a 20-line scheduler, run as `--scheduler dmd --steps 3 --guide-scale 1`); (b) **the tokenizer**: the
  generate script calls `AutoTokenizer.from_pretrained("google/umt5-xxl")` at run time, an outbound fetch. The Stack pins the tokenizer
  files (about 12 MB, Apache-2.0) in the model store and the patch loads them from the local path, so the worker runs with
  `HF_HUB_OFFLINE=1` and the privacy test sees zero requests.
- **Source read**: every `requests`, `urllib`, `snapshot_download` and `from_pretrained` in mlx-video was read before running. Network use is
  Hugging Face downloads in the converter and the helper in `utils.py`, plus the one tokenizer call above. No telemetry.
- **Pins (download, never vendor)**: `lBroth/FastWan2.2-TI2V-5B-MLX` revision `de2998ac446581895089ae363f4dcc0c02ca9ea2`, three files:
  `model.safetensors` 10.0 GB bf16, `t5_encoder.safetensors` 11.4 GB, `vae.safetensors` 2.8 GB (24.2 GB total), plus `config.json` and the
  tokenizer files. Sha256 and bytes recorded by the Stack as for every pin; a conversion script and its provenance are recorded because the
  MLX repo is a community conversion of two Apache-2.0 sources (VIDEO-GEN-01 re-derives it from the Apache-2.0 originals when the Stack can
  run the converter once, so the pin is not one person's upload).
- **Decode is the slow part.** Denoising takes 10 to 16 s; the MLX Wan2.2 VAE decode takes **112 to 170 s** whatever the tiling (section 4).
  A tiny Wan2.2 decoder (TAEW2.2 class) would cut this to seconds at some quality cost; unmeasured, row VIDEO-GEN-11.

## 4. Measurements (121 frames, 24 fps, 832 x 480, seed 1, 3 DMD steps, no guidance)

`peak` is macOS `peak memory footprint` from `/usr/bin/time -l` for the whole process. Time is wall clock for the process.

| Run | Denoise | VAE decode | Total | Peak |
|---|---:|---:|---:|---:|
| Dog on beach, first run (weights cold from disk), tiling auto | 16.4 s | 117.1 s | 141 s | **112.6 GB** |
| Same, tiling aggressive (256 px spatial, 32 frame temporal) | 10.4 s | 140.2 s | 157 s | **44.1 GB** |
| Same, tiling default (512 px, 64 f) | 10.4 s | 170.5 s | 188 s | 112.3 GB |
| Same, temporal only | 10.4 s | 131.3 s | 148 s | 111.4 GB |
| Same, spatial only | 10.3 s | 112.8 s | 137 s | 112.2 GB |
| Cartoon robot (aggressive) | 10.4 s | 115.7 s | 132 s | 44.1 GB |
| Clouds over a city (aggressive) | 10.4 s | 115.1 s | 130 s | 44.1 GB |
| Coffee pour (aggressive) | 10.4 s | 116.9 s | 134 s | 44.1 GB |
| Paper boat in rain (aggressive) | 10.5 s | 115.9 s | 131 s | 44.1 GB |

Finding that sets policy: **only aggressive tiling keeps the peak near 44 GB.** Every other mode reports about 112 GB, which is more than the
machine's unified memory in use at once (macOS compresses and pages it), and would starve the live chat. The job always passes `--tiling
aggressive`, and the governor admits a video job only against the 44 GB figure (50 GB budget minus headroom). Warm versus cold: model load is
2.4 s (text encoder) plus 0.8 s (transformer) once the files are in the page cache, so a repeat process is the "warm" number; a keep-warm
worker saves those 3 s and the 11 GB text-encoder read on a first job, not the decode.

**Time target.** About 130 to 160 s at 480p, inside the 3 minute bar and inside Jesse's earlier "minutes, not tens of minutes".
**720p (1280 x 704), same prompt, aggressive tiling: denoise 35.2 s, decode 269.3 s, total 308 s, peak 53.9 GB.** That misses the 3 minute bar and
exceeds the 50 GB job budget, so **720p is not offered**: the cap is 832 x 480 (480p) on p64 and p128 until the decode is faster
(VIDEO-GEN-11) or a smaller peak is measured. 540p (960 x 544) was not run; the cost scales with area, so it would land near 200 s and 50 GB, not under the bar.

## 5. Quality, judged by opening keyframes

Five keyframes per clip (first, quarter, half, three quarters, last) were read for each. The look is the DMD look: strong contrast and
saturation, a little glossy.

- **Golden retriever on a beach**: one dog throughout, anatomy holds, legs move, spray and waves move, no identity drift across 5 s. Over-saturated gold.
- **Cartoon robot waving**: same robot in every frame (head, headphones, chest vent, colours stable), the hand waves with a believable
  motion, the smile changes. The strongest result.
- **Clouds over a city at sunset**: sharp, stable skyline and sun, but the cloud motion is slow for "time-lapse"; prompt adherence on speed is weak.
- **Coffee pour (fictional, no face)**: pot tilts, a continuous stream, steam rises, the cup fills; no hand artefacts because the hand stays out of frame.
- **Paper boat in rain**: the boat holds its shape across the clip, ripples and falling drops appear; the first frames flash and the boat renders blue
  where the prompt said white (colour adherence is weak under DMD).
- **Image to video** (the first frame of the robot clip as the still, prompt "turns its head, blinks, gives a thumbs up"): 13.6 s denoise, 112.8 s decode,
  132 s total, 44.1 GB. The robot keeps its identity (head, headphones, vent, palette) and ends in a two-handed thumbs up; fine detail such as the vent
  slats is redrawn cleaner than the still. The image conditions the first frame only, as in the Wan2.2 5B design.

## 6. Samples (author's scratchpad, `scratchpad/videogen/out`)

`wan_dog_480_cold.mp4`, `wan_dog_480_tileagg.mp4`, `wan_robot.mp4`, `wan_clouds.mp4`, `wan_coffee.mp4`, each with a `.jpg` keyframe sheet and a
`.log` with the timings; logs of the other tiling modes beside them. Kandinsky: `kd_dog_480.log` (denoise 22.7 s per step, then the untiled decode failure).
Bench scripts: `locked.sh`, `wan.sh`, `kd.py`, `frames.py`.

## 7. LoRA policy (mirrors the image rules; owner correction 2026-10-17)

**What loads.** Standard Wan2.2 5B LoRAs (`.safetensors`, rank up to 64 tested) through `--lora PATH STRENGTH`, applied to the single TI2V model.
Wan2.2 5B has a smaller LoRA base than the 14B models: 33 adapters declare the 5B as their base on Hugging Face, plus the larger Civitai
catalogue (not queried: it needs an account and is not machine-readable without one). A 14B LoRA does not fit a 5B model and is refused with
"this LoRA was made for a different model".

**The household library.** LoRAs live in the household library (one record each: file hash, size, source URL, licence, base model, strength
default, trigger words, who added it, when). The licence is read at import: Apache-2.0, MIT and CC0 import freely; a non-commercial or unknown
licence imports only with the adder's explicit acknowledgement shown on the card (the household is a person, not a business, but the record
stays honest); a LoRA's licence never changes the base model's.

**Classification: all-ages or adult-only.** Each LoRA carries one flag, set at import from its metadata and tags and who added it. Uncertain
means adult-only. A parent or admin can reclassify a LoRA to adult-only; only an adult can reclassify one to all-ages, and an all-ages flag
never overrides the metadata when the metadata says adult.

**Who can use what.**
- Adult-only LoRAs are **available and usable by adults by default** (owner's ruling, 2026-10-17). An owner or admin may restrict them
  household-wide with one optional setting, default allowed.
- A minor never reaches an adult-only LoRA, an adult-only render or its output, whatever any setting says. The age band and surface gates
  outrank everything (RULES.md rule 0, SAFETY.md): a spoken surface, a shared glance screen, a guest or an unidentified speaker gets no
  adult-only output, and the job is refused before it starts.
- The community path is the point: a LoRA the household downloads works the same as one we list. Nothing is bundled.

**Absolute lines (no setting, role or flag lifts them):** no sexual content depicting a minor or anyone who looks like a minor, and no
non-consensual imagery of a real, identifiable person. SAFETY.md already states "no feature is built whose purpose is generating imagery of identifiable
real people"; the video pipeline inherits it as written. **Closed by Jesse on 2026-10-17: yes, an adult may make a video or a likeness style of a consenting household adult**, with the design and
limits in [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md) (consent switch per person, signed proof, photo check, notification and log).
A text-only prompt naming a household member passes the household-name gate the chat already uses and produces an invented person.

**How the lines are enforced without a filter in the model.** The Wan weights and mlx-video carry no safety filter (checked in source: no
checker, no classifier, no word list). Enforcement lives in Home, where the person is known: the age and surface gate before the job exists, the
household-name gate on the prompt, the LoRA flag at admission, and for a minor the video role is off (below). No learned classifier decides a
subject (RULES-AND-LEARNED-COMPONENTS). A post-render check of the output for the absolute lines is a named open gap, VIDEO-GEN-12, because
nothing in the Stack decides it today and a guess is worse than a stated gap.

**Licence clauses on adult generation, checked per candidate.** Wan2.2 and FastWan (Apache-2.0): the model-card paragraph says the user is
accountable for use that "violates applicable laws, causes harm to individuals or groups, disseminates personal information intended for harm,
spreads misinformation, or targets vulnerable populations"; it is a restatement of law, not a bar on adult content, and it is not in the licence
text. LTX-2.x: item 2 of the use list bars exploiting or harming minors, nothing bars adult content. Kandinsky 6.0 (MIT): no clause. HunyuanVideo 1.5
and MiniMax H3: territory exclusions, rejected before this question mattered.

**First tested LoRA.** `AlekseyCalvin/HSToric_Color_Wan2.2_5B_LoRA_BySilverAgePoets` (`HSToric_color_Wan22_5b_LoRA.safetensors`), **Apache-2.0** on its card, 323 MB, rank 64, sha256
`5c2fc21b1e74d5088318fea72c676181650a0f771cc521151edfc43f6ea9ec77`, base `Wan-AI/Wan2.2-TI2V-5B`, style of early 1900s colour photography, trigger
`HST style HD film, early 1900s`. Loaded with `--lora ... 1.0`: "Applying LoRAs to 300 modules", no error. The weights are merged into the model, so the
cost is small: the run took 122 s total against 130 to 134 s for the unadapted runs (a per-run load time was not separated out, it is inside that number).
Effect on the dog prompt, same seed: a wider, more filmic frame, gentler warm tone, a walking rather than running dog, a different shoreline; the sepia
character is real but modest at strength 1.0 (the clip is `wan_dog_lora.mp4`, sheet `wan_dog_lora.jpg`). The adult-only flag defaults to all-ages for this
file (style LoRA, metadata names no adult subject). Also seen and refused by policy: `JonneyWang/AnyID` (cc-by-nc-sa-4.0, non-commercial, would import only with the
acknowledgement). No adult LoRA was downloaded or tested in this session.

## 8. Memory, keep-warm and jobs

- **Load on demand, unload after idle.** The worker starts at the first job and exits after **10 idle minutes** (a person makes several
  clips in a row; the cost of a cold start is 3 s plus reading 11 GB, and holding 24 GB resident is not free). Never resident at boot.
- **Governor admission.** A job holds one pinned admission of **44 GB** for the whole run (denoise and decode). Refused with a plain 503
  ("Not enough free memory for video right now. Close other big jobs, or try again in a few minutes.") when the machine cannot grant it, and while a picture job holds the image admission the
  video job queues behind it (one generator at a time; the image and video roles share the GPU politely and never overlap). Chat is never evicted
  for a video; a kernel-pressure warning cancels the job, not the chat.
- **Jobs are long-running.** `POST` returns a job id; progress is reported by phase (queued, loading, rendering, decoding, encoding, ready) with
  a percentage inside rendering and decoding; **cancel** stops the worker and frees its memory; a job past its deadline answers `202` with the
  id, as the image and tool routes do. Results are held in memory about 10 minutes (the six newest) and Home stores the file as a new
  attachment; nothing is logged with a prompt (rule 6a).
- **Caps per tier.** p128: up to 121 frames (5 s) at 832 x 480. p16, p32 and p64: off.
  Hard ceilings in the Stack, not settings: 121 frames, 24 fps, the pixel area of 832 x 480 (720p measured at 308 s and 53.9 GB, not offered).

## 9. Stack API (additive; contract number unchanged)

- `POST /v1/videos/generations` JSON: `prompt`, `image` (base64 or attachment id resolved by Home, optional), `width`, `height` (multiples of 32, within the cap), `frames` (4n+1, at most 121), `seed`, `loras` ([{`id`, `strength`}], hashes resolved by Home), `timeout_ms`.
  Answers `200 { created, job, data:[{ video_b64 or url, poster_b64, width, height, frames, fps, seed, model, ms }] }` or `202 { job }` past the deadline.
  Errors carry `error` (what happened and what to do) and `code`: 413 too large, 422 cannot be done (bad size, frames, LoRA for the wrong model), 503 not installed or no free memory, 500 failed.
- `GET /v1/videos/generations/{job}`: status (`phase`, `progress`) and, when ready, the file. `DELETE` cancels.
- `GET /stack/v1/video`: `{ state, phase, model, limits, loras_supported, audio: false }` for Home to enable the control.
- Home owns the person-facing routes, calls the Stack through its client, applies the gates (section 7 and 10), and stores the result.
- **Output**: MP4, H.264 (yuv420p, 24 fps), optional AAC audio track added by the assembler from the `music` or `tts` roles (the model makes none), a JPEG
  poster frame from frame 0, and the seed and model recorded as provenance. The file is written once, by `imageio-ffmpeg`'s bundled ffmpeg that mlx-video already depends on.

## 10. Safety posture and rules check

> **Superseded in part (owner, 2026-10-17: "Teens can edit and create picture and video without annoying messages"):** a teen may make pictures and videos and edit pictures, on their own written screen, with nothing adult or sexual (the prompt gate and the finished-picture check refuse it in one short line), all-ages styles only, another person's likeness never (an adult's agreement is for other adults), their own photo for non-sexual edits, and no extra questions or warnings whatever the household setting. The design is the teen lane in [image-editing-2026-10-17.md](image-editing-2026-10-17.md); a child may make cartoon pictures and videos of safe things in a strict lane (owner, 2026-10-17: "Kids can make cartoon images and videos of safe content."), designed in the same note, section 9.


- **Age and surface gates are unchanged and outrank this note (rule 0).** Video generation is **off for children and teens**: RULES.md and SAFETY.md
  name no video allowance for a minor, and the hub-on-Apple plan lists child-safety evaluation as an open item (MEDIA-HOST-01). A parent's
  per-child switch can be a later row; it is not designed here and the default for every minor is off. This is consistent with SAFETY.md (child profiles
  restricted by default, unrestricted generation unlocked per-user by an adult, never inherited).
- Adult video through chat passes the adult acknowledgment already required for unrestricted mode. A spoken turn, a shared screen, a guest and an
  unidentified speaker never get video output the adult-only rules would block.
- **The finished-clip check (IMGGEN-SAFE-01, built 2026-10-17).** Before a clip is stored or shown, three keyframes (first, middle, last) go through the
  same local vision check as a picture, with the same decision (`backend/src/lib/pictures/ageCheck.ts`; the policy and calibration are in
  `image-engine-2026-10-17.md` section 15). A possible minor in a sexual frame, or in any frame of an adult-only clip, withholds the clip: it is never
  stored in Home, the Stack's copy is deleted, and the job ends with "I can't show that video. It may show a child in a sexual situation, and that is
  never allowed." A check that cannot run fails closed for an adult-only clip and passes an ordinary one. Frames come from a Swift/AVFoundation helper
  (`keyframes.swift`); a Mac without `swiftc` or `ffmpeg` checks the poster (frame 0) alone, which passes an ordinary clip and withholds an adult-only one as unchecked.
- Privacy: nothing leaves the home. The pins download on install; the tokenizer pin removes the one runtime fetch; the worker runs offline. No
  prompt, image or clip is logged (rule 6a); the worker reports phase, size and milliseconds only.
- Rule 11: only a Stack-installed, pinned, tested component runs the model. Rule 8: nothing gated on a model id; the status route reports capability.
- Rules 1 to 7, 10, 12 to 14 govern the chat turn and do not change. **Conflict check against RULES.md: none found.** Rule 1's budget: a video tool is
  a conditional tool offered only on the turn that earns it, with its own bench row (VIDEO-GEN-07). Rule 9 and 9b: the player and the progress are kit
  Elements and shadcn primitives with no overrides; the chat wire already names assistant-ui's `image-generation` and a video Element is a named gap to be
  recorded in `elements-adoption.json` before code (VIDEO-GEN-06).
- Architect verdict: the `architect` agent was not available to this session; self-review against RULES.md above found no conflict. Verdict owed on the first row that touches `packageHost.ts` (VIDEO-GEN-05).

## 11. Slices (rows are in `docs/BACKLOG.md`)

| Row | What |
|---|---|
| VIDEO-GEN-01 | Stack: `video-gen` engine, worker, pins (weights, tokenizer, the DMD patch), install plan, status route |
| VIDEO-GEN-02 | Stack: `/v1/videos/generations` job API, progress, cancel, 202, governor admission 44 GB, tests |
| VIDEO-GEN-03 | Stack and Home: LoRA library records, import, hash and licence, adult-only flag, base-model check |
| VIDEO-GEN-04 | Home: settings (`video.enabled`, `video.adult_loras`, caps) and the age and surface gate |
| VIDEO-GEN-05 | Home: package and chat tool (conditional tool, `packageHost` method, attachment store, `checkStorageCap` preflight) |
| VIDEO-GEN-06 | Chat UI: player, progress and cancel; elements-adoption entry first |
| VIDEO-GEN-07 | Chat tool bench row and the safety review (rule 1 budget, age and surface cases) |
| VIDEO-GEN-08 | Verify on the Studio end to end with real clips; privacy check zero outbound |
| VIDEO-GEN-09 | Measure a 480p, 61 frame q8 profile for p32 (the community `Anes1032/Wan2.2-TI2V-5B-mlx-q8` weights) |
| VIDEO-GEN-10 | Later: Wan2.2 A14B quality profile; Kandinsky 6.0 Lite as the sound-capable second pin |
| VIDEO-GEN-11 | Measure a tiny Wan2.2 decoder to cut the 115 s decode |
| VIDEO-GEN-12 | Post-render check for the two absolute lines (design first; a gap today) |

## 12. Stack API as built (Stack commit 1ed4e61, 2026-10-17)

The Stack side of VIDEO-GEN-01 to 03 is built and verified on a scratch Stack. The full contract is the "Video generation" section of the Stack's
`docs/integrations.md`; what Home needs is here.

**Measured on the Studio (real runs through the job API, scratch data directory, GPU lock held):** text to video 132 s wall for 121 frames at 832 x 480
(mp4 4.6 MB, poster 54 KB, H.264 High yuv420p, moov box first, 5.04 s); picture to video 132 s (3.7 MB); one LoRA (the HSToric colour file, 300 modules,
rank 64) 168 s including a 323 MB merge; the idle worker holds about 2.3 GB resident and exits after ten minutes. Progress is real: rendering reports
the three steps, decoding reports tiles, so a poll shows movement every few seconds.

**Stages, time left and the first frame (GENPREVIEW-01, Stack b903251 and eead4a3, kit `ui-v0.5.250`).** Jesse's first look at the card was an empty grey box, a spinner, "0:35 · 0%" and no news for two minutes. Other video tools (Sora, Runway, Veo) show a percent with stage text and sometimes draft frames; ours now shows the real stages, the time left and the first frame of the clip, all from the job status that already exists (rule S6: no new status surface).

- *What the worker reports.* The worker names the stage it is in, with "n of m" inside a stage: `load_text` (T5 loads), `plan` (text encode, or reading the starting picture), `load_model` (transformer), `motion` (denoise step n of 3), `frames` (tiled VAE decode, tile n of 60) and `save`. The Stack turns that into `progress_fraction` (never goes back), `stage_label` ("Putting the frames together, 24 of 60"), `eta_seconds` and, inside a stage that reports no count (a cold model load), a slow creep by time against that stage's median so the bar moves.
- *Where the time goes (measured, scratch Stack, Studio, 832 x 480, 5 s, the live Studio also busy).* Worker spawn 4 s before the first stage; `load_text` 2 s, `plan` under 1 s, `load_model` 1 s, `motion` 13 s (three steps; the first includes the compile), `frames` 113 to 133 s (60 tiles, 2 to 3 s each, slower while another job used the GPU), `save` 1 s; 137 to 165 s in all. A cold start (model files not in the page cache) adds the 35 s Jesse saw to `load_text` and `load_model`. Stage weights are 3, 1, 2, 9, 83 and 2 percent; the built-in seconds (3, 1, 2, 12, 112, 2) give the first clip an ETA of about 130 s until the Stack has its own history (median of the last seven clips of that size and length, `data/gen-history.json`).
- *The first frame.* The moment the motion is finished, the worker decodes the first latent frame alone with the same decoder (a picture-sized decode) and writes `preview.jpg` (up to 480 px); `preview_url` carries it from then on and the clip's poster takes over when the job ends. It shows the real scene (a paper boat on a wet street) about 3 s into the decode stage. Per-step previews of the noisy motion were not built: they would hold the frame decoder in memory for the whole motion stage, which is 9 percent of the clip, and the first frame already arrives before the 83 percent stage starts.
- *The card.* The kit `VideoPlayer` no longer draws a grey box with a spinner: it draws the dotted shimmer with the prompt on it, then the first frame cross-faded in; under the bar are the clock, the percent and the time left ("1:11 · 39% · about 2 minutes left"), the stage line in words, Stop, and the "Videos are 5 seconds at 480p and take about 2 minutes." caption as a quiet line. Home's existing watcher (every second) holds the stage line, ETA and the newest preview in memory (`lib/genLive.ts`) and serves the frame to the job's owner only at `/api/videos/jobs/{id}/preview`.
- *Measured cost.* The first-frame preview costs 1.38 s in the worker (1.378, 1.382 and 1.387 s over three runs; it includes building the single-frame decode graph once per process). Five short clips with the preview took 9.8, 9.8 and 12.1 s (the first after a restart) against 8.3 and 9.0 s without; against a 137 to 165 s clip that is +1 percent, inside the +3 percent budget. The stage events are a line of JSON each (about 70 per clip) and cost nothing measurable. Not verified: a full-length A/B pair (the GPU was shared with other jobs and ran 137 to 165 s clip to clip, wider than the effect); a cold-model run through the new card.

**Calls Home makes.**
- Enable the control from `GET /stack/v1/video` (`available`, `state`, `limits`, `reference_images`, `install`). p16 and p32 answer `available: false`.
- Install: `POST /stack/v1/engines/video-gen/install`, then `POST /stack/v1/models` for each entry of `install.models` (the Stack fills in the folder's file list).
- Make a clip: `POST /v1/videos/generations` `{ prompt, size?, seconds? (1 to 5), seed?, image?, image_source?, loras?, audience?, timeout_ms? }`. Send `audience: "adult"`
  only for an identified adult on a written, private surface; everything else sends `all-ages` (the default). Expect 202 almost always (a clip takes over two minutes) and poll
  `GET /v1/videos/generations/{job}` (`state`, `phase`, `progress`, `phase_progress`, `position`, `data`). Fetch `data[0].url` and `poster_url`, store the file as an
  attachment, then `DELETE /v1/videos/generations/{job}` to free the Stack's copy. Cancel is the same DELETE while it runs.
- LoRA library: `GET/POST /stack/v1/video/loras`, `PATCH/DELETE .../{id}`. Home passes `added_by` as an opaque label, decides who may add, reclassify (only an adult moves a file
  to all-ages) and use a file, and names the allowed ids in each clip request. The Stack refuses wrong-base files (`wrong_base_model`), un-acknowledged non-open licences,
  and any file whose own description names a minor in a sexual context (`lora_refused`); a file whose description names adult content cannot be all-ages. It also refuses an
  adult-only id when `audience` is `all-ages`, as a second lock.

**Reference pictures (VIDEO-GEN-12, ruling 2026-10-17 adds `household_photo` with Home's signed proof).** The Stack accepts `image_source: "generated"` and `"household_photo"` only, and only for bytes whose sha256 it recorded when its own image generator (or one of its clips'
posters) produced them. So Home must send the stored picture unchanged (no re-encode, resize or metadata edit), and an uploaded photo can never start a clip until the real-person check
exists. Home's own gates (age, surface, household names) still run first; Home must not set `generated` for anything else.

**Home still owes:** the `video.*` settings and the age and surface gate (VIDEO-GEN-04; minors off by default), the package and chat tool (05), the player, progress and cancel UI (06),
the bench and safety review (07), the Settings page for models and LoRAs, and the end-to-end verification (08). The image-generation Stack work by another agent shares the one-at-a-time
generator admission (a governor `generator` item blocks another), so a picture job and a clip never overlap; a request can sit in `waiting for memory`.
On a 64 GB Mac the clip cannot fit beside the chat model, so p64 no longer lists video (Stack commit eccc9e9: `VIDEO_TIERS` is `["p128"]` and the p64 profile moves video to not available); Home offers the tool only when `GET /stack/v1/video` answers `available`.

## 13. Home as built (VIDEO-GEN-04 to 08, 2026-10-17)

- **Gate.** `backend/src/lib/videos/policy.ts` reuses the picture policy's age and surface half (one definition, `pictureDenial`) and adds the video switch `generation.video.enabled`. A child, teen, guest, spoken turn, glance screen or TV is refused at the policy node, at the tool and at every route; the Stack is told `audience: adult` only for an allowed adult whose household lets adults use adult-only LoRAs. The prompt passes the picture policy's minor line for everyone; the real-person line is the model's own `depicts_real_person` flag.
- **Tool.** `generate_video` is a conditional tool (gate `videosAllowed`, bench row `video-tool`), offered only when the Stack's `GET /stack/v1/video` answers available. It starts a job with `timeout_ms: 1`, answers at once, and the card follows the job. One clip at a time per person.
- **Reference pictures (VIDEO-GEN-12).** `from_picture` takes "latest" or an id. Home sends the stored bytes unchanged with `image_source: generated`, and only for an attachment whose provenance says the Stack made it (`picture-gen:` or a clip's `video-poster:`). In a temporary chat a picture counts only when Home marked it `generated` at the moment the picture engine made it (a field no upload can set, never a file name), or when it is a clip's own poster.
- **Jobs.** `video_jobs` rows (memory only in a temporary chat, two hours), polled once a second; the mp4 and its JPEG poster are stored as the person's own files with the Stack's bytes unchanged; the Stack's copy is deleted on every finish. Files are served at `/api/videos/jobs/:id/files/:fileId` with Range support.
- **Card.** The kit `VideoPlayer` Element (ui-v0.5.244; ui-v0.5.250 for the shimmer, stage line, time left and first-frame preview). While a clip waits behind a picture or another clip it says "Home is busy making another picture or video. It will start in a minute." with the place in line.
- **Measured through Home** (scratch Stack and Home on the Studio, `backend/scripts/bench/video-clip.ts`): the chat turn ends in about 1.1 s; the first progress shows at about 3 s; the clip is on the card after 127 to 129 s; 5.3 to 6.9 MB. Text to video and poster to video both worked.
- **Sending a clip (VIDEOSHARE-01).** The first clip Jesse downloaded would not go into a text. Facts checked on the file: H.264 High level 3.0, yuv420p, 832x480, 24 fps, faststart, brands isom/iso2/avc1/mp41, 5.07 MB, no audio track, named `video.mp4`; AVFoundation reports it playable and exportable and QuickLook draws it, so the container and codec are standard and Apple documents mp4 and mov with H.264 as accepted. What differs from what a phone makes is the missing audio track, the generic name, and the delivery path (Safari saves it to Downloads, so sending means finding and dragging a file). The cause was not reproduced (a real Messages send cannot be run headless), so the fix removes every difference: Share passes the real file to the system share sheet (Web Share API with `files`, prefetched so the call keeps the click), the Stack writes a silent AAC track and a title into every new clip (the picture stream is copied, never re-encoded; a clip over 20 MB or not yuv420p H.264 within 1280 pixels is re-encoded), and Download names the file from the prompt. An older stored clip is converted by the Stack on first request (`POST /v1/videos/messages`, nothing kept there, the title in a header because it comes from the prompt). HEVC is not needed: H.264 is the form every recipient takes. GIF export was skipped.
- **Open.** Model install button in Settings (the Stack has the install routes); the image-to-video source from a generated picture needs the image engine on the Stack (not on the scratch one); the post-render check (VIDEO-GEN-12) is still a gap.

## 14. Detailed videos: LTX-2.3, sound and speech (VIDEO-LTX-01, owner ruling 2026-10-17)

Owner: "sounds like we should go with LTX, do it", for an action scene where a hero walks in and says "Come with me if you want to live": longer clips, with sound including spoken words, and "something like image gen where we have a super quick video model and then our powerful one with LoRAs". This section supersedes the LTX row of section 2 and the "Sound: none" row of section 1 for the optional second model. Quick (section 1, Wan2.2 FastWan, silent, 5 s) is unchanged and stays the default.

### 14.1 Two plain kinds, the same words as pictures (IMGGEN-QUALITY-01)

**Quick** and **Detailed**, nothing else a person reads. Quick: about two minutes, no sound, up to 5 seconds, can start from a picture. Detailed: sound and spoken words made in the same pass as the picture, up to 10 seconds, a large LoRA library, words only for now. **Detailed is not slower than Quick here** (measured: 42 to 49 s for 5 s against Quick's 130 to 140 s), so the pictures wording "slower" is not used for videos; the honest difference is sound, speech, length, styles, the size of the download (74 GB) and the maker's licence. Whether Detailed should become the default once installed is an owner question, left at Quick (the owner's ruling) and listed in the rows. The model names (Wan, FastWan, LTX, Gemma) appear only under **Details** on the Pictures and videos page. Setting `generation.video_quality` (household select, default Quick, Home-declared in `settings/videoKeys.ts`, in `scripts/settings-ahead-of-spec.json` until a spec tag carries it). The tool argument `quality` (`quick` or `detailed`): the model sets `detailed` when the person wants the people to speak, wants sound, wants it longer than 5 seconds or wants the best quality, and says so in one line; a length past 5 seconds is Detailed on its own (a fact of the two models, not a reading of words); a style (LoRA) made for one model decides (an LTX style makes it Detailed, a Wan style keeps it Quick, each with a note); Detailed that is not installed makes a Quick video and the model tells how an admin gets it; a clip that starts from a picture is always Quick. The card offers **Make it Detailed** or **Make it Quick** (`POST /api/videos/jobs/{id}/another` takes `{ quality }`); a video made with a style or from a picture offers no switch.

### 14.2 The licence, read and verified (2026-10-17)

- **Text (`LICENSE-2_x`, LTX-2.x Community License Agreement, dated 2026-08-11, 34 KB, read in full).** Free for any use by an Entity under USD 10,000,000 annual revenue (affiliates counted together); an Entity at or above that needs a paid Commercial Use Agreement from Lightricks for any use except a Non-Commercial Purpose (a person's own hobby or entertainment, or a business's testing in a non-production environment), with a back-fee clause. A household is under the line. Section 3: redistribution is allowed with the agreement and the use restrictions attached, which is why the Stack never bundles the weights: an admin's own computer downloads them. Section 5: no claim on Output. Section 6: the licensor may restrict use remotely, requires the latest version "reasonable efforts", and the licensee must never remove or disable any watermark, content provenance or latent disclosure the model puts in an Output, and must comply with the EU AI Act and the California AI Transparency Act. Attachment A and the Acceptable Use Policy: no use that violates law, none that exploits or harms minors, none that impersonates a real person without consent (deepfakes), none that spreads verifiably false information to deceive, content shown as human-made when machine-made must be disclosed as machine made, plus the listed professional and decision uses. **Adult content is not barred.** Section 13: the licence ends on a breach and the files must then be deleted. New York arbitration.
- **What Home does about it.** The install shows the points in plain words (`LTX_LICENCE_NOTICE`, Stack `lib/modelCatalog.ts`) and an admin accepts once (the Stack records the id of the notice, never a name: `data/licence-acceptances.json`). Finished clips carry the model's own markings untouched (the worker never touches the engine's disclosure features, `ltx_worker.py` says so). The "machine made" duty is met by the card and the file's provenance (`video-gen:`); Home's share path does not strip it. The use list is covered by rule 0, the two absolute lines, the household-adult likeness rule (LIKENESS-01, impersonation needs consent) and the finished-clip check.
- **Gated?** No. `Lightricks/LTX-2.3` is public (`gated: false`). The MLX layout the runtime reads, **`prince-canuma/LTX-2.3-distilled`** (revision `65b104b9`, the Blaizzy author's conversion), is also ungated and carries no card of its own; its files are Lightricks' weights converted, so the Lightricks licence governs them and redistribution under section 3 is permitted with the licence attached (we do not redistribute at all). No Hugging Face account is needed to download any pinned file (all 49 pinned files and the Gemma files were fetched without a token).
- **The text encoder.** LTX-2.3 reads the prompt with Google's **Gemma 3 12B**; the runtime wants it as a local folder. `mlx-community/gemma-3-12b-it-bf16` (revision `b8b9b412`, ungated, 26.4 GB, bf16) is pinned as its own component under the **Gemma Terms of Use** (use restrictions apply; shown in the install notice). `google/gemma-3-12b-it` itself is gated (manual accept); the mlx-community copy is not, and the Stack never needs an account.

### 14.3 The runtime and what was measured (Studio, Apple M5 Max, 128 GB, macOS 27, GPU lock held, live Stack running)

- **Runtime.** `mlx-video` (MIT, commit `87db56a`, the pin Quick already uses; no new Python package: `cv2`, `mlx-vlm 0.7.8`, `transformers 5.20.1` are in the Stack's hashed requirements already) with the distilled two-stage LTX-2.3 pipeline: 8 steps at half size, the x2 spatial upscaler (`ltx-2.3-spatial-upscaler-x2-1.1`), 3 refinement steps, audio decoded by the audio VAE and vocoder (48 kHz stereo). Its own tiled decode with `--tiling aggressive`. One worker file, `video/ltx_worker.py`, same line protocol as Quick's, started on the first Detailed clip, stopped when the other model is asked for or after 10 idle minutes; never resident at boot.
- **A bug the first run found.** The first clip was black with a silent track and the log said `Mel spectrogram ... std=nan`. Cause (measured by checking NaN at each stage): the shipped text-encoder attention mask fills masked positions with the bfloat16 minimum, which with the pinned mlx-vlm overflows to -inf, so the whole prompt embedding is NaN. A finite -1e9 mask fixes it. The worker applies that as a runtime substitution and says so; the pinned source is not edited. Without it no clip is usable, which is why the first measurement of this model on a fresh install needs this worker, not the stock command.
- **Sizes and speed** (one warm worker, 768 x 448, 24 fps, 8 steps plus 3, seed as listed; wall time from request to the saved mp4 with its sound):

| Length | Frames | Wall | MLX peak | Notes |
|---|---|---|---|---|
| 5 s | 121 | 42 to 49 s | 40.4 GB | first clip of a worker includes loading the 38 GB model from disk (49 s); later ones 42 s |
| 8 s | 193 | 65 to 69 s | 41.3 GB | |
| 10 s | 241 | 79 to 81 s | 41.9 GB | |
| 15 s | 361 | 110 s | 43.5 GB | the longest measured |
| 5 s with a community LoRA | 121 | 49.5 s | 43.3 GB | claymation style, rank 32, 352 MB, merged at load |

  The first stock-CLI run (cold, the process starts and reads everything) was 87 s for 5 s with a whole-process peak footprint of 41.9 GB under aggressive tiling (89.6 GB with the default tiling, so the worker always passes `aggressive`). The governor admits a Detailed clip at **46 GB** (the largest MLX peak 43.5 GB plus the Python process), the same slot Quick holds, so it fits beside the roughly 28 GB resident chat set on a 128 GB Mac and on nothing smaller (p128 only, owner's rule for video).
- **Stages (5 s, median of the runs):** text encoder 3 s, planning the prompt (Gemma) 11 s, loading the model 5 s, motion 20 s (11 steps), frames 11 s, saving 1 s. A 10 s clip: motion 43 s, frames 21 s. These seed the card's built-in estimate (`VIDEO_DETAILED_STAGES`); the Stack's own history replaces them after the first clip of a size.
- **Resolution.** 768 x 448 landscape and 448 x 768 portrait (multiples of 64: the two-stage pipeline needs half size to be a multiple of 32). Larger sizes were not measured and are not offered.

**Does it speak? Measured.** The brief's test, "a hero in a dark corridor says Come with me if you want to live" (generic, fictional), was generated, frames were opened and the sound track was run through the Stack's own speech-to-text (Moonshine tiny, `stt` role) to see whether words are present. The speech is made by the model in the same pass; it is not laid in afterwards.

| Clip | Length | Transcript of the sound track | Reading |
|---|---|---|---|
| Stock command, corridor prompt, seed 7 | 5 s | "Come with me if you want to live." | exact |
| Worker, same prompt and seed | 5 s | "Come with me if you wanna live." | exact words, casual |
| Worker, the clay LoRA merged | 5 s | "Come with me if you want to live." | exact, in the clay look |
| Worker, a different prompt, seed 3 | 5 s | "I'm coming to make you want to live." | most of it |
| Worker, a different prompt, seeds 1 and 2 | 8 s | "Come with me as you wonder." / "I'm calling me if you want to say it." | speech, words only partly right |
| Worker, same prompt, seeds 1 and 2, and the first prompt, seed 7 | 10 s | (nothing) x3 | the track has sound but no words the transcriber found |
| Worker, the first prompt | 15 s | "I must mean if you want to live. If you've been outside of me, I'll get you to keep it warm in you. I'll have a moment to do that happen." | speech, not the line |

What this proves and what it does not. Words are produced, with a human voice, and on a 5 second clip with a plain prompt the exact line comes out (3 of 3 with the first prompt). Past about 8 seconds the speech drifts or does not appear at the point the transcriber listened to; the transcriber is also a small model, so "nothing" is a statement about both. So: Detailed is offered up to 10 seconds because length, motion and sound all work (5 s 42 to 49 s, 10 s 79 to 81 s, 15 s 110 s), the tool tells the model a spoken line is clearest in a clip of 5 seconds or less, and speech reliability past 5 seconds is a named open row (VIDEO-LTX-03), not a claim. The clay clip's opened frames show the claymation look and two characters in a corridor.


### 14.4 LoRA

The 119 community adapters on the LTX-2.3 card are LoRAs trained against the full (dev) model. mlx-video merges a LoRA only on its dev-two-stage pipeline; the worker merges the same file into the distilled transformer as it loads (`weight += (B * strength) @ A`, the engine's own merge) so a community style works with the 8-step model. Measured with a real community file (a claymation style, `vrgamedevgirl84/LTX_2.3_Clay_Mation_Style_LoRa`, 352 MB, written by the LTX trainer 2.3): the clip came out in the clay look and the spoken line was still understood (see 14.3). The Stack reads which model a LoRA is for from its tensors (`transformer_blocks.N.attn1` keys and a 4096 width mean LTX; `blocks.N.self_attn` and 3072 mean Wan; a file that writes `ss_ltx_version` other than 2.3 is refused), never from a name, and a clip applies only LoRAs of its own model (`wrong_base_model`). LoRAs start adult-only unless the importer says all-ages (uncertain means adult-only), exactly as for Quick; the audience second lock, the likeness proofs and the household's switches are the same code. LoRA strength defaults to the record's, 0 to 2.

### 14.5 Install, disk and memory

Component `ltx-2-3-distilled-mlx` ("Video: Detailed (LTX-2.3)"), group `video`, **optional**, **p128 only**, never in the first-run plan and unchecked in the wizard (`video-detailed` row, off by default on every tier). Two pins: the LTX folder (36 files, **47.1 GB**) and the Gemma text encoder (13 files, **26.4 GB**): **73.6 GB** in all, shown as "Get Detailed videos (74 GB)". Every file by sha256 and size at a pinned revision; all 49 sizes and hashes were checked against the exact copies the measurements ran on (0 problems). The component needs the `video-gen` environment Quick already installs (shared; removing the last user removes it). The install asks the admin to accept the licence once (Stack `POST /stack/v1/components/{id}/install` answers 409 `licence_required` until `accepted_licence` carries the notice id; Home's Models and storage page and the Video settings both show the dialog).

### 14.6 What Home and the Stack do (as built)

- **Stack:** `POST /v1/videos/generations` takes `model` `quick` (default, `video`, or the Quick pin's id) or `detailed` (or the LTX pin's id); per-model hard ceilings (`VIDEO_SPECS`: Quick 5 s, 832 x 480, 32-pixel steps, 44.1 GB; Detailed 10 s, 768 x 448, 64-pixel steps, 46 GB); an unknown model is 422 `unknown_model`, a length past the model's is 422 `bad_seconds` (Quick says Detailed goes longer), a picture with Detailed is 422 `reference_unsupported`, an uninstalled model is 503 `not_installed`. Results and the status route say `quality` and `audio`; `GET /stack/v1/video` has `qualities.quick` and `qualities.detailed` (limits, install pieces, whether a clip fits now, the licence id, the LoRA base). The messaging copy copies an AAC sound track untouched. The progress stages, the first-frame preview and Stop work as for Quick (rule S6).
- **Home:** the tool, the setting, the card's switch, the Settings section (**Quick and Detailed videos**: what each is, **Get Detailed videos (size)**, the licence dialog, **What is the difference?**, **Details**), Models and storage (the same dialog), the finished-clip check on every clip of either kind (five keyframes past 6 seconds instead of three; the sound track is stored untouched), likeness consent for household-person videos unchanged.
- **What the finished-clip check does not do.** It looks at frames (five past 6 seconds, three before) with the local vision model; it does not listen. The words a Detailed clip speaks come from the prompt, which passes the same two absolute-line checks and the household-name gate as any prompt, but the model can say words nobody asked for. A check that transcribes the sound track with the Stack's speech-to-text and runs the text through the same minor-sexual line is a named row (VIDEO-LTX-06); until it is built this is a stated gap, not a claim.
- **Picture to video on Detailed does not work yet.** The pinned runtime fails on LTX-2.3 when a picture starts the clip (`broadcast_shapes (1,1024,1,7,12) and (1,2048,1,7,12)`, measured). Rather than half work, a picture always makes a Quick clip (the tool says so) and the Stack refuses a picture with `detailed`. Row VIDEO-LTX-02.

## Supersedes

- `hub-on-apple-silicon-2026-09-17.md`'s video table: the animated path is Wan2.2 TI2V-5B FastWan on MLX, not LTX-2 (licence), and the
  quality path is the same model undistilled or the A14B later, not ComfyUI on MPS.
- MEDIA-HOST-02's ComfyUI route for video: the Stack runs the MLX worker directly. Nothing in `RULES.md` changes.
