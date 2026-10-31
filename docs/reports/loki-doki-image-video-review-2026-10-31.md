# Loki Doki image and video enhancements: what to port (2026-10-31)

Owner ask (2026-10-31): review the image and video enhancements Loki Doki had and decide whether Home can and should port them.
Read-only research. Nothing was built or changed. Verdict words follow the org's review style: **port**, **redesign**, **drop**, **already built**.

Sources read: the archived tree `/Users/jessetorres/Developer/github.com/loki-doki` (working tree only, it has no `.git`, so no history was available)
and, in Home, the design notes `image-editing`, `image-tools`, `image-generation`, `image-engine`, `video-generation`, `video-speedup-and-control-eval`,
`companion-video-characters`, `live-video`, `live-video-lessons`, `media-apps-blend`, the BACKLOG sections for pictures, the editor, video and the image engine,
and the Stack's `docs/integrations.md` and `docs/components.md`. The legacy mirror `legacy-backups/home-legacy.git` does not exist in the Home checkout
(`ls legacy-backups` fails), so the archived Loki Doki tree was the only legacy source. Licences quoted from memory are marked "verify" and must be read
from the model card before any pin.

## One-line answer

Almost everything Loki Doki did for pictures is already rebuilt in Home on better engines (Klein edit, LaMa erase, Real-ESRGAN, Apple Vision cut-out, Wan and LTX video)
with far stronger age gates. What Loki Doki had that Home lacks is small: **a video "make it smoother" (frame interpolation), a video "make it sharper" finish,
a clarity pass on saved videos, an Adjust and Auto-tone editor tool, and background blur.** Photo and face restore are the one case that needs Jesse's ruling first.
Loki Doki's ComfyUI plumbing, style presets, face-swap, hi-res pass and video studio should not be ported.

## 1. Inventory: what Loki Doki had

All paths are under `/Users/jessetorres/Developer/github.com/loki-doki/`. Not found anywhere in the tree: colourise, stabilisation (no vidstab or deshake), a dedicated denoise,
depth maps, segmentation beyond the background cut-out, ControlNet, LoRA training. The tree grep for these words found nothing relevant. Loki Doki's LoRA feature was a catalog plus a router, never training.

### 1.1 Video enhancement (ffmpeg and ncnn Vulkan tools, no ComfyUI)

| Feature | File | Tool or model | Exposed as | Hard-won logic worth keeping |
|---|---|---|---|---|
| Clarity pass (auto on downloaded videos) | `backend/src/lib/media/enhance.ts`, `enhanceJob.ts`, `enhancePolicy.ts`, `videos/enhance.ts` | ffmpeg `cas=0.5,unsharp=5:5:0.6:3:3:0.25,vibrance=intensity=0.15`, same resolution | Background job after a save; a derived "mp4:enhanced" sibling asset; playback prefers it when the user opted in; settings: admin default, user always/never, per-source override | Deliberately **no denoise or deblock** (modern codecs deblock in-loop, denoise smears hair); CAS held at 0.5 to look natural; the original is never touched; a failed enhance leaves the original serving; freshness check (height match means already derived); progress from ffmpeg `-progress` out_time and speed |
| Hardware-aware HEVC encode for the pass | `media/encoder.ts` | `hevc_nvenc`, VideoToolbox, `libx265` fallback | internal | `-tag:v hvc1` or Safari, QuickTime and Plex refuse HEVC in mp4; verify the ffmpeg binary really lists the encoder before committing; a CPU verdict is cached only 5 minutes (a transient probe miss pinned an RTX box to CPU); filters on CPU, only the encode on hardware |
| AI upscale (manual) | `media/upscale.ts`, `media/ncnn.ts` | Real-CUGAN ncnn Vulkan, `models-pro`, 2x, tile 256 | Imaging "Enhance" tab and the video app, via `POST /api/image/enhance-media` (SSE progress, 30 minute owner-scoped download) | Blend the AI frame over the original at **strength 0.12** after `scale2ref`, then the clarity recipe (a full-strength result looks like the "anime GAN look"); refuse video above 1080p (about 7 s per 4K frame); frames as PNG with `-vsync 0`; tile size bounds VRAM; audio copied back with `-map 2:a:0?`; bt709 tags set; returns false (no throw) when the tool cannot be provisioned; temp frames always removed; abort kills the child |
| Frame interpolation (manual) | `media/interpolate.ts` | RIFE ncnn Vulkan, model `rife-v4.6`, target 60 fps (clamped 30 to 120) | same Enhance tab | Output frame count `round(nIn * targetFps / srcFps)` passed as `-n`; probe source fps from `r_frame_rate` (fallback 30); progress by polling the output folder; audio muxed back with `-shortest` |
| Image clarity and image AI upscale | `media/enhanceMedia.ts` | the same ffmpeg chain; Real-CUGAN 2x then clarity | Enhance tab for stills | Same fallbacks; image gets a safety screen before processing |
| Tool provisioning | `media/ncnn.ts` | nihui releases pinned by URL (RIFE 20221029, Real-CUGAN 20220728) | internal | Download whole release folder (binary plus model dirs), in-flight de-dup, chmod, lazy and best-effort |

### 1.2 Image editing and enhancement (ComfyUI workflows, PIL)

All workflows are in `backend/src/lib/comfyWorkflows.ts` (1,076 lines); the edit route is `POST /api/image/edit` in `backend/src/routes/image.ts` (ops list at line 1935);
the UI is `frontend/src/pages/ImagingPage.tsx` (tabs Generate, Edit, Enhance, Recognize, Logo) and `frontend/src/components/imaging/CleanUpDialog.tsx`.

| Feature | Workflow function | Model or tool | Exposed as | Hard-won logic |
|---|---|---|---|---|
| Remove background | `buildBgRemoveWorkflow` | BiRefNet Lite ONNX, CPU only (339 MB) | Edit tab "Remove BG" | CPU so no Metal impact; availability check returns a plain "not installed" 422 |
| Background blur | `buildBgBlurWorkflow` | BiRefNet mask, ImageBlur radius 1 to 31, masked composite | "BG Blur" | Subject taken from the mask output 1, original composited over blurred copy |
| Upscale 4x | `buildUpscaleOnlyWorkflow` | ESRGAN `4x_NMKD-Siax_200k` | "Upscale 4x" | No checkpoint, no sampler |
| Face restore | `buildFaceRestoreWorkflow` | CodeFormer (fidelity 0 to 1, default 0.5) or GFPGAN v1.4, retinaface detection, Impact Pack nodes | "Face Restore" | Fidelity slider; model choice |
| Old-photo restore | `buildPhotoRestoreWorkflow` | face restore then ESRGAN, chained | "Old Photo" | **Cap the upscaler input to 1 megapixel** (`ImageScaleToTotalPixels`) so large inputs do not spike VRAM |
| Enhance (img2img) | `buildImg2ImgWorkflow` | SDXL img2img, denoise 0.05 to 0.95 | "Enhance" with strength | Strength clamped |
| Auto colour and Adjust | PIL scripts `autoColorImage`, `adjustImage` in `routes/image.ts` | `ImageOps.autocontrast(cutoff=0.5)`, `ImageEnhance` brightness, contrast, saturation, sharpness (-100 to 100) | "Auto Color", "Adjust" (no GPU, no ComfyUI) | Values coerced to finite numbers before they enter the script string (no code smuggling); 30 s timeout |
| Clean Up (inpaint) | `buildInpaintWorkflow` | SDXL inpaint with a painted mask, `VAEEncodeForInpaint` | `CleanUpDialog` | Blank prompt means context fill; everything outside the mask is preserved byte for byte |
| Face inpaint (smile, eyes, mouth) | `buildFaceInpaintWorkflow` | Impact Pack FaceDetailer, `face_yolov8m`, dilation by region | Chat prompt path, not a tab | Per-region guide size and bbox dilation |
| Multi-character compose | `buildComposeInpaintWorkflow`, LoRA hooks | two-pass regional inpaint | Generate | Per-character regions so the stronger LoRA does not win both bodies |
| "Put me in the picture" | `buildFaceIdWorkflow`, `POST /reference-face` | IP-Adapter FaceID Plus v2, InsightFace | Generate | n/a (see gates) |
| Hi-res pass | in txt2img | 2x img2img, denoise 0.15 to 0.4 | automatic | n/a |
| Style presets | `lib/imageStyles.ts` | nine prefix and negative-prompt pairs | Generate | n/a |
| LoRA catalog and router | `lib/loraRouter.ts`, `loraTokens.ts`, `loraFiles.ts`, `routes/adminImageLoras.ts` | LLM tool call picks LoRAs from the catalog (`when_to_use`, examples); default-deny grants per user or category | Generate | `sanitizeTriggerTokens` strips A1111 `<lora:...>` junk from CivitAI trigger lists; two character LoRAs both saying "solo" make one body, so the plan removes conflicting tags and adds a count tag |
| Sampler profile by checkpoint name | `detectSamplerPreset` | Lightning, LCM, Hyper, Turbo detected from filename | internal | Distilled SDXL needs steps 2 to 6 and cfg 0 to 2 |
| Prompt helpers | `/enhance-prompt`, `/auto-enhance`, `/preview-check` | chat LLM; vision check of a 30 percent preview | Generate | Preview was safety-screened mid-run |
| Vectorize (logo) | `lib/vtracer.ts` | vtracer trace of the PNG to SVG, fail-soft to the PNG | Logo tab | Falls back to the PNG if the tracer errors |
| Recognize | `useImageAnalyze.ts`, `tools/videoAbout.ts` | vision model: description, scene, objects, OCR and plates, vehicles | Recognize tab | n/a |
| Image-to-video and text-to-video | `buildImageToVideoWorkflow`, `buildVideoWorkflow` | Stable Video Diffusion XT (motion bucket 127, augmentation level 0 is most faithful); AnimateDiff-XL (16 to 24 frames) | `tools/videoGen.ts`, `VideoPage.tsx` | Video stall timeout 20 minutes against 30 s for stills |
| Image-stack memory plan | `docs/internal/image-stack.md` | fp8 on CUDA, bf16 on MPS, `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0`, VAE tiling, `--medvram` | ops | ComfyUI-specific; not reusable |
| Safety around edits | `routes/image.ts` (lines 769 to 785, 888 to 910, 2022, 2147) | `csamGuard`: prompt screen, "input image plus minor cue" block, output screen for face swaps, face inpaints and minor-cue txt2img (fails closed), upload screen on every edit and enhance | server | All of it is superseded by Home's lanes (section 2) |

### 1.3 Other video features that touch enhancement

| Feature | File | Note |
|---|---|---|
| Video studio (timeline, trim, speed, mute, export) | `backend/src/lib/videostudio/*`, `frontend/src/components/videostudio/*` | EDL zod schema with DoS caps (60 clips, 30 minutes, 320 to 3840 px, 15 to 60 fps, speed 0.25 to 4) |
| Transcripts, translate, auto-chapters, ask the video | `lib/videos/transcribe.ts`, `translate.ts`, `aiExtras.ts`, `askVideo.ts` | Whisper over the same pipeline as podcasts; subtitle translation only, no dubbing (no multilingual TTS) |
| Trickplay and media segments | `lib/videos/trickplay.ts`, `mediaSegments.ts` | keyframe-only sprite sheets (`-skip_frame nokey`); chapter-derived intro and credits |
| Image proxy resize | `lib/imageResize.ts` | vips thumbnails in buckets 240, 480, 960, 1280, webp Q80, fall back to the original |

## 2. What Home has today, and what the Stack can run

| Capability | Home | Stack |
|---|---|---|
| Image generation | Quick (Klein 4B) and Detailed (Z-Image-Turbo); `backend/src/lib/pictures/*` (`tool.ts`, `jobs.ts`, `stack.ts`, `policy.ts`, `lane.ts`, `laneGate.ts`, `ageCheck.ts`, `finishedCheck.ts`, `minorLine.ts`, `quality.ts`); gallery per person | `backend/src/images/*` (mflux worker, LoRA library `loras.ts`), `POST /v1/images/generations` |
| Edit in words, masked edit, add a person, remove chosen people, freeze people | `lib/pictures/editTool.ts`, `editSources.ts`, `people.ts`; `lib/imageEdit.ts`, `routes/imageEdit.ts` (Comment) | `POST /v1/images/edits` operations `edit`, `edit_masked`, `find_people`, `erase_people`, `people_mask` (Klein bf16; Apple Vision person finder) |
| Remove background | `lib/imaging/subject.ts`, `backdrop.ts`; editor tool `remove_background` | `remove_background`: Apple Vision foreground mask (`fgmask.swift`), IS-Net ONNX fallback |
| Erase | editor tool `erase` | `erase`: Big-LaMa ONNX (hole filled at 512 px; IMGTOOLS-07 open for large holes) |
| Upscale 2x and 4x | editor `resize` tool; chat `kind: upscale` | `upscale`: Real-ESRGAN general x4v3 ONNX (6 MP in, 36 MP out, so 4x tops out near 1500 px square) |
| Resize, crop, fit, outpaint body, head swap | `lib/imaging/crop.ts`, `fit.ts`, `outpaint.ts`, `headSwap.ts`, `fill.ts`, `focal.ts` | Lanczos and area (image-tools) |
| Markup and the editor shell | kit `ImageEditor` (commons ui-v0.5.243). Tool keys are a closed list: `markup`, `comment`, `remove_background`, `erase`, `resize` (`commons/ui/src/elements/image-editor.tsx` line 102) | n/a |
| Live preview during a render | GENPREVIEW-01 (none for teens or children) | per-step 256 px preview |
| Video generation | Quick (Wan2.2 FastWan, silent, 5 s, picture-to-video) and Detailed (LTX-2.3, sound, 10 s); `lib/videos/*`, `lib/pictures/keyframes.ts` for the finished-clip check | `backend/src/video/*`; p128 tier only |
| Media service | saved copies in the media apps | `backend/src/media/*`: kinds `media.probe`, `media.fetch`, `media.transcode` (H.264 and AAC), `media.preview` (thumbnail, storyboard, short clip), `media.companion_clip` (chroma key), `media.setup`; one idle-priority lane; jellyfin-ffmpeg 8.1.3 |
| LoRA library | Stack half built (IMGGEN-LORA-01 in the Stack's backlog); Home half open | `images/loras.ts`, `video/loras.ts` |
| Reading pictures (describe, objects, OCR) | chat model reads attachments (VISION-02), no sidecar | `look` service for household objects |
| Transcripts | later (media-apps-blend row 94) | `stt` role |
| Not present anywhere | video upscale, frame interpolation, clarity pass, Adjust, Auto tone, background blur, face restore, vectorize, a video editor | no torch in the Stack; ncnn and ComfyUI are not part of the picture engines (ComfyUI remains only a fallback for the `image` role when no family is installed) |

Already open as evaluations: **VIDEO-EVAL-02** (2x upscale on Quick clips with pinned mlx-video or `xocialize/realesrgan-mlx`, BSD-3-Clause per its page) and **VIDEO-EVAL-06**
(frame doubling with `xocialize/rife-mlx`, MIT per its page, 168 ms per inserted frame at 480p on an M5 Max per its page; arithmetic gives about 20 s added to a 5 s Quick clip).
Both are bench rows with pass and kill lines in `docs/design/video-speedup-and-control-eval-2026-10-20.md`. They cover the Loki Doki ideas with MLX engines instead of ncnn.

Home's gates that every port below must stay inside: rule 0 (age and surface gates outrank everything); the teen lane (`lane.ts`, `laneGate.ts`: hard gates only, no one else's likeness,
no preview, finished-picture check fails closed); the child cartoon lane (cartoon look forced, edits only in words and only on the child's own generated cartoons, no photos, daily ledger,
finished check including a vision question, Quick video model only, three-second clips); the likeness rules (a photo of a person is changed only for one consenting household adult with a signed proof;
a child's photo or anyone else's is refused; non-generative tools such as Erase and Upscale are allowed on any picture the person has).

## 3. Verdict table

Size: S is one to three files for one task, M is a slice with a Stack change or kit change first, L is a new engine plus UI.
"Gate" is what rule 0 and the lanes require; "child/teen" cells say what the port would have to do.

| Feature | Loki Doki had | Home has | Verdict | Why (one line) | Size | Needs a Stack engine | Child and teen gate implications |
|---|---|---|---|---|---|---|---|
| Clarity pass on saved videos | yes, auto and per-source policy | no | **redesign** | Cheap and was liked, but it doubles disk per video and Home plays saved copies as made, so make it opt-in per household and person, one setting not three tiers | M | none new: a `media.enhance` kind on the existing media lane (jellyfin-ffmpeg already has `cas`, `unsharp`, `vibrance`; verify) | The derived copy inherits the source item's audience and approval exactly (a child's saved copy stays adult-approved only); no new content is created, so no finished-picture check; never auto-run for a child profile's items unless the parent turned it on |
| Video frame interpolation (RIFE, 60 fps) | yes, manual | no (VIDEO-EVAL-06 open) | **redesign** | Same idea, MLX engine instead of ncnn Vulkan; the frame-count formula and audio remux are the keepers | M | **rife-mlx** (candidate, new pin in the video or media environment, no torch) | Output is a new clip made from a gated clip: for a teen or child it must pass the same finished-clip keyframe check (fail closed) and stay in the Quick-only, three-second child limit; counts against the child's daily video allowance or is refused for children (decision for the design note) |
| Video AI upscale (Real-CUGAN, blended 12 percent) | yes, manual, 1080p cap | no (VIDEO-EVAL-02 open) | **redesign** | Drop Real-CUGAN (second runtime, anime-leaning, Vulkan); keep the blend-over-original idea and the "refuse tall sources" rule; engine comes from the bench | M | mlx-video upscale or **realesrgan-mlx** (bench decides) | Same as interpolation: derived clip rechecked for teens and children, children only on their own cartoons |
| Image AI upscale / 4x | yes (ESRGAN, Real-CUGAN) | yes | **already built** | Stack `upscale` (Real-ESRGAN x4v3) with a 6 MP input cap; Loki's 1 MP pre-cap lesson is already met by limits | none | existing image-tools | Non-generative, allowed on any picture the person may open; children only on their cartoons |
| Image clarity / Adjust (brightness, contrast, saturation, sharpness) / Auto tone | yes (PIL, ffmpeg) | no | **redesign** | Cheap, no model, no GPU; becomes one editor tool in the kit (client canvas or `sharp` in Home), not an Enhance page | S (kit `ImageEditor` tool key first in commons, then a Home pin) | none | Non-generative edit of a picture the person already has: same photo gate as the editor (`photoUploadsAllowed`); children only on their own cartoons; save as a new version with provenance |
| Remove background | yes (BiRefNet CPU) | yes | **already built** | Apple Vision mask with IS-Net fallback, 0.2 to 0.8 s; BiRefNet measured at 11.5 to 16 GB peak and rejected | none | existing | Non-generative; same as above |
| Background blur | yes | no | **redesign** | Falls out of Remove BG: blur the original and composite the cut-out over it in Home with `sharp`, no new model | S (kit tool key in commons first) | none (uses `remove_background` output) | Non-generative; same photo gate |
| Erase / Clean Up (inpaint) | yes (SDXL inpaint) | yes | **already built** | Big-LaMa erase plus Klein masked edit (cleaner, 2.6 s) | none | existing | Erase is allowed on any picture; masked generative edit follows likeness rules; child gets words only, no painted mask |
| Face inpaint (smile, eyes, mouth) | yes (FaceDetailer) | partly (Klein masked edit with a box) | **drop** | A brush or box plus Klein does it; a face-specific detector adds a model for a rare ask | none | none | A face change is a person edit: one consenting household adult only; a child's or stranger's photo refused |
| Face restore (CodeFormer / GFPGAN) | yes | no | **redesign, owner ruling first** | CodeFormer's licence is non-commercial (verify, S-Lab), and GFPGAN needs torch which the Stack does not carry; first measure whether Klein instruction edit plus Real-ESRGAN restores a face well enough | M (bench first) | none if Klein works; otherwise a torch worker (owner question) | **Blocking:** a face restore redraws faces, so under the likeness rules it is a person edit and is refused for a child's photo or any non-household person, which is most old family photos; Jesse must rule whether restoration of a photo the person owns counts as non-generative (like upscale, which already "invents detail") before any work; teens only on their own photo; children never |
| Old-photo restore (chained) | yes | reachable in words ("fix this old photo") with Klein, plus Upscale | **redesign, same ruling** | The one hard-won piece is the chain order (faces, then upscale with a 1 MP cap); the rest is already a Klein edit | S after the ruling | none | Same as face restore |
| Enhance via img2img | yes | Klein `edit` | **already built** | "Make it sharper, fix the light" measured at 5.6 s | none | existing | Likeness rules |
| Style presets / style transfer | yes (9 prefixes) | styles via adapters and words | **drop** | Already ruled dropped (image-generation note: presets curated toward a use are not shipped) | none | none | The teen and child lanes already force all-ages and cartoon |
| Hi-res second pass | yes | no | **drop** | Klein and Z-Image render to 2048 natively; a second SDXL pass has no purpose | none | none | none |
| "Put me in the picture" (FaceID) | yes | Klein reference edit and likeness proofs | **already built** (differently) | Replaced by LIKENESS-01 and the add-a-person edit; the legacy verdict "not built" is superseded in practice | none | existing | Adults with a consenting household adult's proof only; teens: own photo only; children: never |
| LoRA catalog, router, trigger hygiene | yes | Stack library built; Home half open | **redesign** (already queued as IMGGEN-LORA-01) | Keep two lessons: strip `<lora:...>` junk from trigger words, and drop "solo" when several character adapters are on; the model chooses from the catalog (rule 1) | M (already a row) | existing | Audience flag per adapter, uncertain means adult-only; teens and children get all-ages adapters only |
| Sampler profile from checkpoint name | yes | no | **drop** (revisit with IMGGEN-SDXL-01) | Klein and Z-Image have fixed schedules; only matters if an SDXL family is added | none | sd.cpp worker if IMGGEN-SDXL-01 happens | none |
| Text-to-video (AnimateDiff), image-to-video (SVD) | yes | Wan2.2 and LTX-2.3, picture to video included | **already built** | Strictly better engines, silent and with sound | none | existing | Quick only for teens and children; three seconds for children |
| LoRA training | no | no | not applicable | Loki Doki never trained | none | none | none |
| Prompt rewrite, preview screening | yes | the model writes the prompt; GENPREVIEW-01 | **already built** | Home hides the half-drawn frame from teens and children (a finding Loki Doki's mid-run screen did not need to face) | none | existing | Teens and children get no preview |
| Vectorize to SVG (Logo tab) | yes (vtracer) | no | **drop** | No ask; a Rust CLI is easy later (S) if Jesse wants "make this a vector" | S if asked | image-tools op (vtracer, MIT; verify) | Non-generative |
| Recognize (objects, OCR, plates, vehicles) | yes | chat model reads pictures; `look` for the household | **already built** | VISION-02 retired the sidecar design | none | existing | Plates and faces handled by existing vision rules |
| Video transcripts, subtitle translation, chapters, ask the video | yes | planned: transcripts "later", chapter skip kept | **already planned** (media-apps-blend) | Not an enhancement; tracked there | M | `stt` role | Child sees approved items only |
| Trickplay and media segments | yes | Stack `media.preview` storyboard; chapter skip | **already built** | Port done through the Stack media service | none | existing | none |
| Video studio (EDL timeline, export) | yes | no | **drop** here | media-apps-blend already says "studio ... drop here"; large, no ask; keep the EDL caps (60 clips, 30 minutes) if it is ever rebuilt | L | ffmpeg render kind | would need the full lane treatment |
| Image proxy width buckets | yes | News picture route `?w=480\|1280` designed | **already built / designed** | Same idea (NEWS-02) | none | none | none |
| ComfyUI workflows, fp8 and MPS memory flags, hardware encoder probe | yes | Stack governor admission, no ComfyUI image path | **drop** | Not portable to the MLX engines; the governor owns memory | none | none | none |
| Loki Doki's CSAM guard layers | yes | `pictures/ageCheck.ts`, `minorLine.ts`, `finishedCheck.ts`, lanes | **already built, stronger** | Home covers prompt, input, output, teen and child lanes with an admin log | none | none | n/a |

## 4. Recommended order for the ports worth doing

Nothing here is urgent and nothing changes a rule. Each item is one to three files per task and goes to Codex or the local lane per the org order; every item needs the architect gate
before dispatch only where a design note is new.

1. **Editor tools: Adjust, Auto tone, Background blur** (S, three small slices, no engine, no new gate). Commons first: add the tool keys to `ImageEditorToolKey` (the list is closed),
   then a Home pin and status wiring (IMGTOOLS-04 style). Design note: extend `image-tools-2026-10-17.md` with a section for the three tools (non-generative, client or `sharp`, new version with provenance);
   no new note. Why first: the only gap a person will notice in the editor today, cheapest, lowest risk.
2. **Video "smoother" and "sharper" on a finished clip: run VIDEO-EVAL-06 (interpolation) then VIDEO-EVAL-02 (upscale) as already written** (S each, bench), then build the winner (M).
   Design note: `video-speedup-and-control-eval-2026-10-20.md` (sections E2, E6 and 5) plus **one new short note** "finishing a clip" that fixes what the eval notes leave open:
   a derived clip repeats the finished-clip keyframe check for teens and children (`lib/pictures/keyframes.ts`), what counts against a child's daily allowance, and one chat action
   (the model decides, rule 1). Keep from Loki Doki: frame-count formula, audio remux, refuse tall sources, blend over the original. Needs owner's answer to the open "is 48 fps wanted" question.
3. **Clarity pass on saved videos** (M). Design note: a short section in `media-apps-blend-2026-10-17.md` (sections 8, 12 and 14 cover the media service) saying: one household setting plus a person override (not Loki Doki's three tiers),
   off by default, derived rendition kept beside the original, storage cost shown in Models and storage, runs last in the resource order (chat, images, video, everything else). Keep Loki Doki's no-denoise, CAS 0.5 and
   original-never-touched rules. Owner question: is a second copy per video worth the disk?
4. **Old-photo and face restore** (bench, then maybe S). Do not start until Jesse rules on the likeness question in section 3 (does restoring a photo you own count as non-generative, like upscale,
   or as a person edit under the likeness rules?). Then bench Klein edit plus Real-ESRGAN on a licensed or public-domain damaged-photo set (the IMGTOOLS-09 test-set row can be shared). Design note: new,
   "restore old photos", built on `image-editing-2026-10-17.md` and `likeness-consent-2026-10-17.md`; the architect gate is required (risky surface: faces and consent). Loki Doki keeps: the chain order
   and the 1 MP cap on the upscaler input.

Not recommended: Real-CUGAN or RIFE ncnn (a second runtime), CodeFormer (licence), ComfyUI workflows, FaceDetailer, style presets, hi-res pass, vectorize (unless asked), video studio, a separate "Enhance" page.

## 5. Open questions for Jesse (to go through the wizard)

1. Is restoring a photo you own (old family prints, faces included) allowed as a non-generative tool like Upscale, or must it follow the likeness rules (which refuse most family photos)?
2. Is 48 or 60 fps wanted at all on generated clips (VIDEO-EVAL-06's own open question)?
3. Is a second, sharper copy of each saved video worth the disk, and should it ever be on by default?
