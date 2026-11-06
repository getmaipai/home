# Higgsfield-style video features: open-weight models for MaiPai Home (Mac Studio, 128 GB)

Date: 2026-11-05. Method: web searches plus direct fetches of GitHub and Hugging Face pages. Anything marked
"unverified" was not confirmed on a primary page. Nothing here needs a cloud API. All weights are downloaded once
and run offline.

Global caveats that apply to every section:

- No source found a measured speed on Apple silicon for the big Wan-family video models (Wan 2.2 Animate, S2V,
  VACE, Phantom, InfiniteTalk). Only a third-party note: Wan 2.2 GGUF on an M1 Max 64 GB took about 82 minutes
  for a 832x480, 33-frame clip (different runtime, much weaker machine). Treat all Wan-family speeds on the Studio
  as unknown until benched.
- The official repos for all of these target CUDA (flash-attn, CUDA 12.x). Mac use means PyTorch MPS patches,
  ComfyUI/GGUF community ports, or an MLX port. MLX ports exist for Wan 2.2 (AbstractFramework weights for
  "mlx-gen", RockTalk Wan2.2-VAE-MLX) and LTX-2 (community "ltx2-mlx-av", about 45 GB RAM for generation); neither
  was timed in anything I could read.
- Licence layering matters. Apache-2.0 code can still depend on a non-commercial detector (InsightFace) or a
  custom-licence base model. The household use case allows personal use, but "redistribution of the downloader"
  means the downloader must not bundle weights and should show each licence at download time.

---

## 1. Lip sync and talking portraits (still image + voice track)

| Candidate | Code / weights licence | Size | Apple silicon | Last release | Maturity |
|---|---|---|---|---|---|
| InfiniteTalk (MeiGen-AI) https://github.com/MeiGen-AI/InfiniteTalk | Apache-2.0 (repo says models are Apache-2.0); base Wan2.1-I2V-14B-480P is Apache-2.0 (from memory, unverified on a page) | Wan2.1 14B base plus audio adapter; fp8 variant exists; exact GB unverified | No Mac mention. CUDA flow. Low-VRAM flag exists. No speed numbers | 2025-08-19 (successor LongCat-Video-Avatar 1.5 listed 2026-05-21) | Active, ComfyUI branch, image-to-video and video-to-video |
| Wan2.2-S2V-14B (Alibaba) https://huggingface.co/Wan-AI/Wan2.2-S2V-14B | Apache-2.0 per model card | about 14B, GB unverified | Not stated; same MPS/GGUF caveats as Wan 2.2 | 2025 (exact date unverified) | Official, good image+audio to video, full-body capable |
| MuseTalk 1.5 (Tencent Lyra) https://github.com/TMElyralab/MuseTalk | Code MIT; card says weights usable for any purpose including commercial; test data is research-only; whisper, dwpose, S3FD have own licences | small (under 2 GB, unverified) | No Mac mention. 30 fps on a V100 | 2025-03-28 | Mature, but it is video-to-video mouth inpainting, NOT a still-image animator |
| LivePortrait (KwaiVGI) | Code and weights MIT, BUT default face detector uses InsightFace buffalo_l models that are non-commercial research only (flag). Secondary source, unverified | small | Community MPS support exists (unverified here) | 2024 | Mature; animates a still from a driving video, not from audio |

Notes: SadTalker, Hallo3 and HunyuanVideo-Avatar were not verified. HunyuanVideo-Avatar's licence name and any
territory exclusions could not be read (page only links a LICENSE file); treat as "custom Tencent licence, read it
before use" and do not rely on it. Minimum 24 GB VRAM, 96 GB recommended per its README.

Recommendation: InfiniteTalk first (Apache-2.0, handles both still-to-talking and video dubbing, long clips), with
Wan2.2-S2V as the second candidate. MuseTalk is the cheap fallback for lip fixes on existing video.
First benchmark: InfiniteTalk fp8 low-VRAM, one portrait plus a 5 s voice clip at 480p, on MPS; record seconds per
generated second and peak memory, and check the mouth against the audio.

---

## 2. Video-to-video lip-dub (translate speech with matched lips)

Pipeline = translate/clone voice (section 10) + re-animate the mouth on the original video.

| Candidate | Licence | Size | Apple silicon | Last release | Maturity |
|---|---|---|---|---|---|
| InfiniteTalk video-to-video mode | Apache-2.0 | see section 1 | unknown | 2025-08-19 | README: "Given an input video and audio track, InfiniteTalk synthesizes a new video"; supports unlimited length |
| LatentSync 1.6 (ByteDance) https://github.com/bytedance/LatentSync | Code Apache-2.0; weights on HF card show openrail++ (sources conflict: one blog said Apache-2.0). OpenRAIL++ allows use with use-based restrictions; read before redistribution | not stated | Not mentioned; 18 GB VRAM minimum for 1.6 (8 GB for 1.5), 512x512 | 2025-06-11 | Purpose-built dubbing model, widely used |
| MuseTalk 1.5 | see section 1 | small | not mentioned | 2025-03-28 | Fast, lower fidelity at the mouth than LatentSync |

Recommendation: LatentSync 1.6 for quality, MuseTalk 1.5 for speed, InfiniteTalk when the face is large or the shot
moves. Keep the LatentSync weights licence on the download screen.
First benchmark: LatentSync 1.6 on a 10 s, 512-px talking-head clip with a re-recorded voice track; MPS fallback
errors are the main risk (it uses CUDA-targeted ops, unverified on Mac).

---

## 3. Motion transfer (reference video body motion onto a new character image)

| Candidate | Licence | Size | Apple silicon | Last release | Maturity |
|---|---|---|---|---|---|
| Wan2.2-Animate-14B https://huggingface.co/Wan-AI/Wan2.2-Animate-14B | Apache-2.0 per model card (preprocess models ViTPose and SAM 2 carry their own licences) | 17B params BF16 (about 34 GB bf16 on disk, my arithmetic) | Not stated. Supported in ComfyUI. torch >= 2.4 | 2025-09-19 | Official, two modes: animate (character follows video) and replace (swap character into video). Strongest single answer for features 3 and 4 |
| VACE (Wan2.1-VACE-14B / 1.3B) https://github.com/ali-vilab/VACE | Apache-2.0 for Wan2.1-VACE; LTX variant is RAIL-M | 1.3B and 14B | Not stated | 2025-05-14 (weights), 2025-10-17 last news | Pose/depth controlled video generation; older than Animate |
| MimicMotion, UniAnimate | not checked: unverified | | | | Older, skip unless Animate fails |

Recommendation: Wan2.2-Animate-14B. Use the 1.3B VACE as a smaller fallback.
First benchmark: Animate in "animate" mode, one character picture plus a 3 s dance reference at 480p, via ComfyUI on
MPS; record time and whether the Apple build can run the preprocessing (ViTPose/SAM 2) at all.

---

## 4. Video face swap / character recast keeping the performance

| Candidate | Licence | Apple silicon | Notes |
|---|---|---|---|
| Wan2.2-Animate-14B "replace" mode | Apache-2.0 (card) | unknown, see 3 | Replaces the whole character, with relighting; best fit for "recast" |
| FaceFusion https://github.com/facefusion/facefusion | Conflicting reports: MIT in one comparison, a responsible-AI-style licence in another (unverified; read the LICENSE). Its swap models (inswapper_128) are non-commercial per the same sources | Lists CoreML support (unverified) | Mature, fast, face-only, but depends on non-commercial swap weights. Household personal use only, do not redistribute weights |
| Roop | Original repo archived March 2026; forks live on | n/a | Skip |

Safety flag (product, not licence): face swap of real people is a consent and child-safety surface. Anything built
here needs the safety gate review in `docs/SAFETY.md` before it is even benched on real family photos. Use
roster/demo faces for benches.

Recommendation: Wan2.2-Animate replace mode as the licence-clean path; FaceFusion only as a personal tool, not shipped.
First benchmark: Animate replace on a 3 s clip with a demo persona image.

---

## 5. Object, outfit or text replacement inside existing video (mask and replace)

| Candidate | Licence | Size | Apple silicon | Notes |
|---|---|---|---|---|
| VACE (Wan2.1-VACE 1.3B / 14B) | Apache-2.0 | 1.3B / 14B | unknown | Supports masked video inpainting and reference swap; official; the natural fit |
| SAM 3 (masks) https://github.com/facebookresearch/sam3 | "SAM License" (custom, Meta). Reading the LICENSE: worldwide royalty-free, redistribution only under that agreement with a copy included, bans military and weapons uses, indemnity clause, no explicit commercial grant or ban. README requires CUDA 12.6+ | 848M params | CUDA only per README; no Mac path found | Latest update 2026-03-27 (SAM 3.1). Text-prompted video segmentation |
| SAM 2 / 2.1 (masks) | Meta; Apache-2.0 from memory, unverified | small to 224M | MPS use reported by community (unverified) | Safer licence than SAM 3 for masks |
| Wan2.2-Animate | Apache-2.0 | 17B | unknown | Only for whole-character replacement |

Recommendation: SAM 2.1 masks fed into Wan2.1-VACE inpainting. Treat SAM 3 as optional because of the custom licence
and CUDA requirement.
First benchmark: SAM 2.1 tracking a shirt over 3 s on MPS (seconds per frame), then VACE-1.3B repaint of that mask.

---

## 6. Prompt-based video editing (restyle, change background)

| Candidate | Licence | Size | Notes |
|---|---|---|---|
| Wan2.1-VACE (1.3B / 14B) | Apache-2.0 | see 5 | Edits with control video plus prompt; most permissive |
| Lucy Edit Dev (Decart) https://huggingface.co/decart-ai/Lucy-Edit-Dev | Custom "lucy-edit-dev-model-non-commercial-license" per the HF card: NON-COMMERCIAL (flag). Third-party sites claim otherwise; trust the card | 5B (Wan 2.2 5B base) | Text-guided instruction edit. Personal household use plausible, but its licence conflicts with redistribution and any commercial plan. Not recommended to ship |
| Ditto (QingyanBai) https://huggingface.co/QingyanBai/Ditto_models | CC BY-NC-SA 4.0, "academic research purposes only" (flag) | finetune of Wan2.1-T2V-14B (VACE-14B for use); about 11 GB GPU with quantised ComfyUI | Research only. Do not use |
| Wan2.2 base editing via video-to-video | Apache-2.0 | | Weaker; fallback |

Recommendation: VACE with Apache-2.0 weights. Skip Lucy Edit and Ditto for anything beyond private evaluation.
First benchmark: VACE-1.3B background change on a 3 s 480p clip (fastest Wan-family edit).

---

## 7. Frame interpolation and 2x/4x upscaling on Apple silicon

| Candidate | Licence | Size | Apple silicon, measured | Notes |
|---|---|---|---|---|
| rife-mlx / mlx-community RIFE-4.25 https://github.com/xocialize/rife-mlx | MIT (inherits Practical-RIFE) | 22.7 MB, 5.66M params | Torch-free MLX. M5 Max fp32: 480p 168 ms, 720p 260 ms, 1080p 554 ms, 4K 2.1 s per mid-frame (author's README) | Young repo, 6 commits, no releases, no dates. Weights are official RIFE 4.25 converted |
| venhance (npm CLI) | licence unverified | | PyTorch MPS fp16: RIFE v4.7 about 51 ms/frame; Real-ESRGAN x4plus about 8.5 s/frame (4x is the bottleneck) (listing, chip unknown) | Wraps RIFE and Real-ESRGAN, VideoToolbox encode |
| Real-ESRGAN (xinntao) | BSD-3-Clause from memory, unverified here | about 64 MB x4plus | MPS works via PyTorch (per venhance). realesr-animevideov3 has a Core ML export in MetalVideoPlayer | No MLX port found |
| SeedVR2 (ByteDance) | Apache-2.0 from memory, unverified | 3B / 7B | not checked | Diffusion video upscaler, higher quality but heavy; unverified on Mac |
| Video2X, enhancr | Vulkan/NCNN based; Mac support weak | | | Skip |

Recommendation: RIFE 4.25 on MLX for 2x/4x frame rate (cheap, measured, MIT). For upscale use Real-ESRGAN
realesr-animevideov3 or x4plus on MPS first; evaluate SeedVR2 only if quality is not enough.
First benchmark: rife-mlx 24 fps to 48 fps on a 5 s 720p clip (expect about 0.26 s per inserted frame on the author's
M5 Max; Studio chip may differ), then Real-ESRGAN 2x on 720p.

---

## 8. Background removal and depth for video

| Candidate | Licence | Size | Apple silicon | Notes |
|---|---|---|---|---|
| BiRefNet (incl. video variants) | MIT per two secondary sources | about 220M params (from memory, unverified) | PyTorch MPS reported; unverified here | Best still-frame matting; run per frame, flicker needs smoothing |
| RMBG-2.0 (BRIA) | Non-commercial CC BY-NC 4.0 from memory, unverified: flag | | | Check; likely avoid |
| SAM 2.1 | see 5 | | MPS community reports, unverified | Tracks one subject across frames, best for video cutouts |
| Video Depth Anything https://github.com/DepthAnything/Video-Depth-Anything | Small (28.4M): Apache-2.0. Base 113M and Large 382M: CC-BY-NC-4.0 (flag) | small | Not mentioned; benches on A100 only | Last model 2025-08-28 |
| Depth Anything V2 | Small Apache-2.0; Base, Large, Giant CC-BY-NC-4.0 (official wiki; one aggregator disagrees) | | Core ML builds exist (Apple) | Per-frame depth |
| Depth Anything 3 | Conflicting: apache-2.0 on one listing, CC BY-NC 4.0 for main checkpoints on another: unverified, read each checkpoint card | | | |

Recommendation: BiRefNet for stills and key frames, SAM 2.1 for video subject masks, Depth Anything V2 Small or
Video Depth Anything Small (both Apache-2.0) for depth. Do not ship the Base/Large depth weights.
First benchmark: BiRefNet and Video Depth Anything Small on a 5 s 720p clip on MPS; measure frames per second and
temporal flicker.

---

## 9. Reference-images-to-video (character consistency)

| Candidate | Licence | Size | Apple silicon | Last release | Notes |
|---|---|---|---|---|---|
| Wan2.1-VACE (14B / 1.3B) | Apache-2.0 | 14B / 1.3B | unknown | 2025-05-14 | Reference images via `--src_ref_images`; pairs with Stand-In |
| Phantom-Wan https://github.com/Phantom-video/Phantom | Apache-2.0 | 1.3B and 14B (GB unverified); needs Wan2.1-T2V-1.3B VAE/text encoder | unknown | 14B released 2025-05-27 | Up to 4 reference images; wiki says 14B trained on 480p and suggests about 70 GB VRAM |
| Stand-In https://github.com/WeChatCV/Stand-In | Apache-2.0 | 153M adapter on top of Wan2.1-14B-T2V; Wan2.2 version listed 2025-12-22 | unknown | v1.0 2025-08-12; "V2 coming soon" | Best face similarity in the paper's table (0.724 vs VACE 0.647, Phantom 0.519), author-reported only |
| LTX-2 image conditioning | LTX-2 licence unverified | | MLX path exists | | Not a multi-reference tool; for the existing LTX lane only |

Recommendation: Stand-In on Wan2.1/2.2 (tiny adapter, Apache) for one-face identity; Phantom for multi-subject
scenes; VACE as the glue. Needs the Wan base (about 28 GB bf16 for 14B, my estimate).
First benchmark: Stand-In with one demo persona face, 3 s at 480p; measure time and identity drift.

---

## 10. Local TTS and voice cloning for dubbing narration

Existing: Fish Audio and others (not re-evaluated). Only "clearly better" items noted:

| Candidate | Licence | Apple silicon | Note |
|---|---|---|---|
| mlx-audio (Blaizzy) https://github.com/Blaizzy/mlx-audio | MIT library; each model has its own licence (check per model) | Native MLX, "optimised for M series", no benchmark numbers on the page | One loader for Kokoro, Qwen3-TTS, Chatterbox v2/v3, VoxCPM2 (48 kHz, cloning), OmniVoice (zero-shot cloning, 646+ languages), Higgs Audio, MOSS-TTS, Voxtral TTS and more. Good as a bench harness |
| Qwen3-TTS | Apache-2.0 (secondary source) | MLX via mlx-audio | Multilingual, voice design and cloning; strong candidate for translated dubbing |
| OmniVoice | model licence unverified | MLX via mlx-audio | The widest language coverage; worth one bench |
| VoxCPM2 | unverified | MLX via mlx-audio | 48 kHz, cloning |
| Chatterbox (Resemble AI) | MIT from memory, unverified; secondary source says licence suits products | MLX via mlx-audio | Expressive, multilingual |
| XTTS-v2 | CPML (non-commercial) vs MIT: sources conflict, flag, avoid | | Skip |

Recommendation: do not replace Fish Audio unless a bench shows a gain. For dubbing specifically, bench Qwen3-TTS and
OmniVoice through mlx-audio against the current voice for cross-language clone similarity and duration control.
First benchmark: clone one 10 s reference into Spanish and German; measure real-time factor and listen for accent leak
(cross-lingual drift is the usual failure).

---

## Ranking: what to bench first on the Mac Studio, cheapest wins first

| Rank | Bench | Feature | Why cheap / valuable | Licence status |
|---|---|---|---|---|
| 1 | rife-mlx RIFE 4.25, 2x frame rate | 7 | MLX native, 23 MB, speeds already published; minutes to run | MIT, clean |
| 2 | Real-ESRGAN 2x on MPS (venhance or direct) | 7 | PyTorch MPS reported working; small weights | BSD-3 (unverified), likely clean |
| 3 | BiRefNet + Video Depth Anything Small | 8 | Small models, direct MPS | MIT / Apache for Small; avoid Base/Large depth |
| 4 | SAM 2.1 video masks | 5, 8 | Prereq for replacement and cutouts | Apache (unverified) |
| 5 | mlx-audio: Qwen3-TTS, OmniVoice clone to other languages | 10 | Already MLX; fastest route to dubbing audio | Per-model, check |
| 6 | MuseTalk 1.5 / LatentSync 1.6 lip fix on a short clip | 2 | Small models; LatentSync needs 18 GB and MPS port risk | MuseTalk MIT; LatentSync openrail++ |
| 7 | InfiniteTalk fp8 low-VRAM, still + audio | 1, 2 | Covers two features with one model; heavy (14B) | Apache-2.0 |
| 8 | VACE 1.3B (edit, inpaint, reference) | 5, 6, 9 | Smallest Wan-family model that does three features | Apache-2.0 |
| 9 | Stand-In adapter on Wan2.1/2.2 | 9 | Tiny adapter but needs a 14B base | Apache-2.0 |
| 10 | Wan2.2-Animate-14B (animate + replace) | 3, 4 | Biggest payoff, biggest cost; run last, likely overnight per clip | Apache-2.0 (card) |

Avoid shipping: Lucy Edit Dev (non-commercial), Ditto (CC BY-NC-SA, research only), Depth Anything Base/Large and
Video Depth Anything Base/Large (CC-BY-NC), FaceFusion swap weights and LivePortrait's InsightFace detector
(non-commercial), XTTS-v2 (CPML), RMBG-2.0 (unverified, likely non-commercial). SAM 3 and HunyuanVideo-Avatar carry
custom licences that need a human read.

Unverified list (not confirmed on a primary page): SAM 2 licence, SeedVR2 licence and Mac behaviour, BiRefNet size and
MPS, RMBG-2.0 licence, Chatterbox licence, Qwen3-TTS licence (secondary), OmniVoice and VoxCPM2 licences, Real-ESRGAN
licence, venhance licence and chip, HunyuanVideo-Avatar and SAM 3 commercial terms, LatentSync weight licence (HF
card says openrail++ while one blog says Apache-2.0), all Wan-family Apple silicon speeds, file sizes in GB for most
14B checkpoints, MuseTalk/LatentSync/BiRefNet MPS compatibility.

Sources: GitHub and Hugging Face pages named inline above, plus search summaries from sync.so, creativeainews.com,
studio.aifilms.ai, lilting.ch, nathanshipley.github.io/banodoco-kb, wavespeed.ai, scriptbyai.com.
