# Video speed and quality bench (2026-11-01)

Measurement only. No engine code, pin or live-install file was changed. Question from the owner: can our own Stack components match the
speed and quality of a ComfyUI video (MiniMax-H3 plus a 6-step add-on, a 2x latent upscale and a refiner; claimed 1440p in about 440 s on a 16 GB
CUDA card). Rule 11 rules ComfyUI out, so each lever is tried in our own runtime.

## Setup

- Mac Studio, Apple M5 Max, 128 GB, macOS 27. The live hub stayed up, so one-minute load was 12 to 17 the whole time. Every figure below
  carries that load: the Wan decode here (214 s) is slower than the 112 to 140 s in `video-generation-2026-10-17.md` section 4.
- Engine: a scratch copy of the pinned mlx-video `87db56a` engine (`~/video-bench/engine`); the live install was only read (weights). Each run held the
  machine gate lock at normal priority (the `heavy` wrapper runs at background priority and doubled the first decode, so it was not used for timings).
- Clips: 121 frames, 24 fps. Wan 832x480, prompt "ginger cat asleep on a kitchen table ... gentle camera push in", seed 7. LTX 768x448, same prompt (seed 7) and a
  rainy neon street (seed 8). Peak is `mx.get_peak_memory` in the process (MiniMax: whole-process footprint from `time -l`).
- Downloads (scratch, owner-approved): TAEHV decoders (github.com/madebyollin/taehv, MIT) 87 MB; Wan 5B q8 `Anes1032/Wan2.2-TI2V-5B-mlx-q8` model file 5.4 GB;
  `dgrauet/ltx-2.3-mlx-q4` and `-q8` transformer files 11.3 and 20.6 GB (plus unused extras); MiniMax-H3 set below, 109 GB.
- Drivers are in `docs/design/video-speed-bench-2026-11-01/`.

## 1. Tiny Wan decoder (VIDEO-GEN-11, VIDEO-EVAL-01)

`taew2_2` (the file made for the Wan 2.2 5B VAE: 48 latent channels, 16x spatial, 4x temporal) fits our latents. `taew2_1` is the 16-channel Wan 2.1 VAE and does
not fit the 5B model. The reference code is PyTorch and the owner declined a torch install, so the decoder was ported to MLX (about 130 lines, `taehv_mlx.py`,
weights read straight from the `.pth`). The decoder takes the latents the diffusion model emits, before the VAE's own mean/std step.

| Decoder (121 frames, 832x480, same latent) | Decode | Peak | PSNR against the original decoder (mean, worst frame) |
|---|---:|---:|---:|
| Original Wan2.2 VAE, aggressive tiling (as shipped) | 213.6 s | 25.6 GB (whole clip) | reference |
| `taew2_2`, fp16 | 0.58 s | 7.4 GB | 32.2, 30.8 dB |
| `taew2_2_super`, fp16 | 0.71 s | 10.5 GB | 33.1, 31.3 dB |
| `taew2_2`, fp32 | 3.73 s | 13.9 GB | 32.2, 30.8 dB |

Opened frames 0, 60 and 120 side by side (original left, tiny right): same layout, colour, lighting and pose. The tiny decode is slightly softer in
fur, curtain and window-glass texture; no new artefacts, flicker or colour shift seen. A clip is then about 24 s (load, text, 3 steps) plus under 1 s of
decode plus the mp4 save, against 238 s here (130 to 140 s unloaded). Pass bars: decode 30 s or less (met by 50x), clip 60 s or less (met).
**Verdict: adopt `taew2_2_super`** as Quick's decoder. It needs an MLX port in the Stack (new row; the port here is a working starting point), the weights
(41 MB, MIT) pinned, and the original decoder kept as the fallback. Not tested: 61-frame clips, picture-to-video, prompts other than the cat.

## 2. Wan 5B: FastWan 3-step bf16 against q8, q4 and 20-step

The Anes1032 build is the base Wan2.2 model (not the FastWan DMD distillation), so it was run as a base model (20 steps, guidance 5). FastWan q8 and q4 were made
here from the shipped FastWan weights with the same recipe (group 64, attention and feed-forward linears). Times exclude decode (the tiny decoder follows).

| Run (seed 7) | Frames | Time without decode | Peak | Weights file |
|---|---:|---:|---:|---:|
| FastWan bf16, 3 steps (today's Quick) | 121 | 24.0 s | 25.6 GB | about 10.8 GB |
| FastWan q8, 3 steps | 121 | 17.3 s | 25.4 GB | 5.4 GB |
| FastWan q4, 3 steps | 121 | 16.6 s | 25.5 GB | about 3 GB |
| FastWan q8, 3 steps | 61 | 10.9 s | 25.4 GB | 5.4 GB |
| Wan base q8, 20 steps, guidance 5 | 121 | 186.0 s | 25.6 GB | 5.4 GB |

Peak did not move with weight size or frame count, so it is set by something other than the transformer (cause not isolated; the text encoder load is the suspect).
That means **q8 does not by itself give VIDEO-GEN-09 a smaller footprint** (61 frames q8 peaked at 25.4 GB, as 121 frames bf16 did).

Quality, one frame from each clip (tiny decoder, frame 60; same seed, so the content differs because weights differ): bf16 sharp, one cat, clean; q8 coherent
but a second cat head appears beside the cat; q4 softer, one cat, no artefacts seen; base q8 at 20 steps blurrier fur and a smeared pose, worse than 3-step FastWan.
One clip per setting, so the q8 artefact may be seed luck.
**Verdicts:** 20-step base: skip (8x slower, worse). q8: needs-more (saves 7 s, no memory gain, one artefact in one clip; test 4 seeds). q4: needs-more (same, softer). Not run:
base bf16 at 20 steps (no bf16 base weights downloaded), because it only separates quantisation from distillation.

## 3. LTX-2.3 distilled: bf16 against q8 and q4 (121 frames, 768x448, with sound)

The pinned LTX loader has no quantised path; the bench patches the model load (scratch only, `bench_ltx.py`) to read the dgrauet files. Clip 1 includes loading from a cold file cache.

| Build | Clip | Wall | Load | Peak | Frames (decode) stage |
|---|---|---:|---:|---:|---:|
| bf16 (today's Boost) | kitchen | 72.2 s | 20.0 s | 40.4 GB | 22.1 s |
| bf16 | street | 62.4 s | 13.1 s | 40.4 GB | 19.7 s |
| q8 | kitchen | 62.7 s | 16.6 s | 33.8 GB | 20.1 s |
| q8 | street | 71.2 s | 19.5 s | 33.8 GB | 20.0 s |
| q4 | kitchen | 48.5 s | 5.4 s | 33.8 GB | 17.8 s |
| q4 | street | 48.6 s | 4.9 s | 33.8 GB | 17.3 s |

Per-step time is the same in all three (about 1.2 s at half size, 4.6 to 5 s at full size), so quantisation saved load time and 6.6 GB, not step time. Peak is the
same for q4 and q8, so a floor outside the transformer (the Gemma encoder phase) is likely. Sound was produced; speech was not transcribed (VIDEO-LTX-03 stays open).
Quality pairs (frames 60 and 116, bf16 left, quantised right; same seed, different composition): q8 kitchen has two cats where bf16 has one; q8 street and both q4 clips are
sharp, single subject, correct neon and wet-street look. The licence's same-terms rule for quantised derivatives applies (`resource-tiers-2026-10-27.md` section 5.3).
**Verdicts:** q4: adopt as the Boost build (needs a loader patch in the worker, the licence text shipped with it, and a speech check first). q8: skip (slower than q4, same peak, one duplicate subject).

## 4. LTX 2x upscale on and off (VIDEO-EVAL-02, partly)

The distilled pipeline always runs two stages, so "off" is not selectable without engine edits. Timeline of the bf16 clips (kitchen, street): 8 half-size steps about 8.2 s;
upscaler plus 3 full-size steps 14.5 to 14.7 s of the 22.9 s motion time (63 percent), 23 percent of the 62 to 72 s clip. q4 and q8 match within 1 s. The quality pair (half-size output
against two-stage) was **not run**. The other half of VIDEO-EVAL-02, a pixel upscaler on Wan Quick clips, was **not run**: it needs `realesrgan-mlx`, which was not approved for download,
and the LTX latent upscaler cannot take pixel clips. **Verdict: keep as is for Boost; needs-more for Quick.**

## 5. MiniMax-H3 (last, as ordered)

Set up as the community did: Argus MLX port (github.com/Argus-AiTeam/minimax-h3-mac, Apache-2.0) run in our engine's Python (mlx 0.32.4, no new package), calibrated INT8 DiT
(`water1234/MiniMax-H3-MLX-Argus-Calibrated-INT8`, 37.8 GB), the upstream BF16 text encoder, video VAE and audio VAE (`MiniMaxAI/MiniMax-H3` FL2VA folder, 66.7 + 10.4 + 0.6 GB), and the
LightX2V 4-step 768p Turbo LoRA (`lightx2v/Minimax-h3-Turbo`, 1.4 GB). Total download 109 GB. 768x448, 124 frames, 5.17 s with stereo sound, seed 7, 4 denoiser steps, no stream-blocks.

| Stage | Time |
|---|---:|
| Denoiser steps 1 to 4 | 41.8, 40.4, 39.7, 34.8 s (39.2 s mean) |
| Whole run (text encoder, steps, both VAE decodes, mux) | 239 s |
| Peak memory footprint | 14.8 GB (max resident 5.3 GB) |

This is far under the community figures (23 min on an M4 Pro, 8.8 min per step at a 768 short edge on an M3 Ultra) because the canvas is 768x448 (12,873 tokens), the DiT is INT8 and the chip is newer.
Two earlier attempts ended in a muxing error (no ffmpeg path given) after the same steps; their step times were 37.7 to 49.7 s, so the figure is repeatable. One clip only.
Quality, frames 0, 60 and 120: a single ginger cat asleep on a table beside lemons, golden window light, a smooth push-in as asked, plausible shadows and detail, no duplicate subject or flicker seen.
It is the best picture of the clips in this bench, with sound, in a quarter of the memory of Boost. The model was trained for a 768 short edge, so 768x448 is below its design size; larger canvases and the
speech were not tried. **Verdict: needs-more, leaning adopt as a Max-tier video candidate** (4.0 min for 5 s, 14.8 GB): check licence terms (MiniMax-H3 community licence), sound and speech, a 5-prompt
set, 1536x864, and a 2-stage latent upscale. Not run: BF16 DiT, the 8-step Turbo, the 2x latent upscaler and refiner the video used (no MLX path found).

## Ranked verdict

1. Tiny Wan decoder `taew2_2_super`: adopt. Quick drops from about 240 s (130 to 140 s unloaded) to about 25 s; the largest single gain measured.
2. LTX q4 build for Boost: adopt after a speech check. 48.5 s against 62 to 72 s, 33.8 GB against 40.4 GB.
3. MiniMax-H3 INT8 plus Turbo: needs-more, promising. 239 s, 14.8 GB, best picture, with sound.
4. FastWan q8 and q4: needs-more. 7 s faster, no memory change.
5. LTX q8, Wan base 20-step: skip.
6. Upscale on/off: partly measured, no change proposed.

None of these reach "1440p in 440 s"; the ladder here is 480p in 25 s (Quick, silent), 768x448 with sound in 49 s (Boost) and 4 min (MiniMax-H3).

## Not run, and why

Wan base bf16 at 20 steps (weights not approved); `realesrgan-mlx` pixel upscale (not approved); stage-1-only LTX picture for the upscale pair (needs engine edits); LTX speech check; more than one
seed per setting; 1440p and the refiner (no MLX path); `taew2_1` (does not fit the 5B VAE).
