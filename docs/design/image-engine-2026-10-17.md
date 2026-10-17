# Image engine: the pick, the runtime, LoRAs and generative edits (2026-10-17)

Status: decision record for the engine half, written from a real bench on the Studio. The person-facing half (who may make what, the
gallery, provenance, settings keys, the architect's earlier verdict) is [image-generation-2026-10-17.md](image-generation-2026-10-17.md); where the two
meet, that note's names win (`adapter` records with `audience`, `generation.enabled`), and this note's slices are its engine side. Nothing is built yet; the rows are in `docs/BACKLOG.md` under
"Image engine (2026-10-17)". Owner approval for the picks: Jesse, 2026-10-17 ("make your owner decisions, you have all approvals
from me. Determine what image gen we should use and add it to the app and chat. Fast generation with high quality. Ideally LoRA support
from the community."), then two additions the same day: adults get adult-only LoRAs by default, and a ChatGPT-style editor (Edit button
on a picture, canvas with Markup, Comment, Remove BG, Erase, Resize). The non-generative tools are in
[image-tools-2026-10-17.md](image-tools-2026-10-17.md) and are already built (IMGTOOLS-03 to 05, kit `ImageEditor` in the chat canvas); Comment waits on the generative
edit path decided here. This note covers generation, generative edits, LoRAs, memory and the Stack API.

Hardware for every number: Apple M5 Max, 128 GB unified memory, macOS 27. The live Stack was running (chat model resident, other agents'
tests and a video bench in the same time window), so the load average was 15 to 20 for part of the session. Where a run was visibly
disturbed it says so; the steady numbers are the ones to plan with. Scratch environments only (uv, Python 3.13); the live Stack, its
launchd services and `/usr/local/maipai-home` were not touched. Weights came from Hugging Face once, then every run used
`HF_HUB_OFFLINE=1`; the sd.cpp server runs were also under a sandbox profile that denies outbound network, and the server worked.

## 1. The decision

**Superseded for a 128 GB computer by section 16 (owner ruling, 2026-10-17): Z-Image-Turbo is the default there; Klein stays for quick pictures, edits and every smaller tier. The rest of this section is the original pick.**

| Slot | Pick | Runtime | Licence | Why in one line |
|---|---|---|---|---|
| Default (every tier that can hold it: p32 and up) | **FLUX.2 Klein 4B distilled**, 8-bit, 4 steps | mflux 0.23.0 on MLX, in a Stack-managed worker | Apache-2.0 | 4.0 s per 1024 px picture warm, 13.5 GB peak, text rendered correctly, and the same weights do reference edits (8.4 s) |
| Community-LoRA model (p128 now, p64 after a 4-bit measurement) | **Z-Image-Turbo** (6B), 8-bit, 9 steps | same worker | Apache-2.0 | 12.9 s warm, most photoreal skin and texture of the set, 879 adapters on Hugging Face against Klein's 81 |
| Smaller-tier floor and largest-LoRA-library model | **SDXL-Lightning 4-step** (SDXL 1.0 derivative, merged checkpoint) | stable-diffusion.cpp `sd-server` (MIT, Metal) | CreativeML Open RAIL++-M (use restrictions, no territory, revenue or adult-content clause) | about 8 s per picture, 6.6 GB; weakest text and prompt adherence; its value is the largest LoRA library; flagged because it is not Apache-2.0 |
| Runtime | **mflux (MLX)** supervised by the Stack as a JSON-lines worker, the same pattern as the image-tools worker | | MIT | 4x faster than the only other runtime tried on the same weights |
| Generative edit (Comment, Erase by description, "make the sofa green") | **FLUX.2 Klein 4B reference edit** through the same worker | | Apache-2.0 | 8.4 s warm; kept the rest of the room; see section 5 |
| Mask erase | LaMa (image-tools note) first, Klein edit composited through the mask second | | Apache-2.0 | LaMa is 1.3 to 4 s; Klein is the choice when the fill must match a complex scene |

A LoRA belongs to one base model, so the picture tool never asks the person which model to use: the default is Klein, and choosing a
LoRA selects the base that LoRA was trained for (section 6). The household can therefore keep three installed models without ever
seeing the word "model". One model is resident at a time.

No candidate failed the licence and speed bar together. The one compromise is stated in section 7: Klein's community LoRA library is
smaller than Z-Image's and far smaller than SDXL's, so the strongest adult-LoRA ecosystem sits on the two slower or older bases.

## 2. Licence screen (criterion 1, read from each card, repository file or licence text)

| Candidate | Licence as read | Verdict |
|---|---|---|
| FLUX.2 Klein 4B | Apache-2.0 (`LICENSE.md` in the repo is the Apache text). The card's "Out-of-Scope Use" list names non-consensual intimate imagery and illegal pornography, exploiting minors, unlawful use, and states it is not a modification of the licence | **Pass.** The two sexual lines match our two absolute lines; nothing forbids adult content that is lawful and consensual |
| Z-Image-Turbo, Z-Image | Apache-2.0 on the card and on the GitHub repository; the Hugging Face repo has no separate LICENSE file, so the pin job records the GitHub licence text. The card lists limitations, no use restrictions | **Pass** |
| SDXL 1.0 and SDXL-Lightning | CreativeML Open RAIL++-M. Attachment A bars: harming or exploiting minors, personal information used to harm, defamation and disinformation, discrimination, legal-process prediction, unlicensed medical advice, military use. No clause on sexual content, no territory or revenue term. The restrictions travel with every derivative | **Pass with a caveat.** It is use-based, not Apache. The law-enforcement and medical clauses are field restrictions; we ship no feature in those fields. Flagged for Jesse in section 9 |
| FLUX.3 Image Klein (released 2026-10-15) | FLUX Kommunity License v1.0: commercial output only below US$5M annual revenue, no commercial self-hosting or fine-tune distribution above it | **Reject** (revenue term) |
| FLUX.2 Klein 9B | FLUX Non-Commercial License | **Reject** |
| Krea 2 (Raw, Turbo) | Krea 2 Community License: revenue threshold, model-name and redistribution terms, content-filtering measures required | **Reject** |
| Qwen-Image-2.1 and Turbo | Qwen Research License (research or evaluation only) | **Reject** (as the earlier review already found) |
| Stable Diffusion 3.5 | Stability AI Community Licence (revenue threshold) | **Reject** |
| Lens, Microsoft, 3.8B | MIT on the community mirror's card; press coverage says Microsoft marks the release research-only. The official repository could not be read | **Not usable until the official card is read.** Eleven downloads on the mirror |
| Qwen-Image 20B, Qwen-Image-Edit-2511 | Apache-2.0 | Pass; not benched (section 8) |
| Chroma1-HD, ERNIE-Image(-Turbo) | Apache-2.0 | Pass; not benched |
| HiDream-I1 | MIT | Pass; 17B, not benched |
| MiniMax H3 (video, for the record) | Territory exclusion | Reject (backlog already says so) |

Third-party LoRAs are a separate licence question per file; section 6 records it per LoRA.

## 3. Measurements (criterion 2)

Prompts: eight fixed prompts at 1024 x 1024, seed 42: a portrait of a fictional woman with hands under her chin, a product bottle, a flat
illustration, a neon sign reading "OPEN 24 HOURS", a mountain landscape, a kids' cartoon fox, a red panda, a Scandinavian living room.
"Warm" is the mean of the second to eighth image in one process. "Process start to first image" is load plus the first image, with the
weights already in the OS file cache; a truly cold disk read was not measured (row IMGGEN-BENCH-01). Peak is MLX's own peak allocation
(sd.cpp: process RSS). Every output was opened and judged.

### 3.1 mflux (MLX) on this Mac

| Model and setting | Load | First image | Warm, per 1024 px | Peak memory | Notes |
|---|---:|---:|---:|---:|---|
| Klein 4B bf16, 4 steps | 2.4 s | 10.8 s (disturbed) | 5.1 to 6.3 s disturbed; 3.7 s quiet (LoRA run, same weights) | 16.4 GB | the first run overlapped other work |
| **Klein 4B 8-bit, 4 steps** | 2.0 s | 4.8 s | **4.0 s** (3.9 to 4.1 on all eight) | **13.5 GB** | the pick |
| Klein 4B 4-bit, 4 steps | 2.9 s | 8.4 s | 3.9 s | 12.0 GB | the p32 choice: text still reads (the O of OPEN slightly lopsided), hands and faces fine |
| Z-Image-Turbo bf16, 9 steps | 10.2 s | 20.7 s | 16.8 to 43.5 s, mean 28.3 s (disturbed) | 33.7 GB | too noisy to plan with |
| **Z-Image-Turbo 8-bit, 9 steps** | 5.7 s | 15.2 s | **12.9 s** (12.8 to 12.9 on all eight, 1.37 s per step) | **30.1 GB** | steady |
| Klein 4B edit (reference image), bf16, 4 steps | 0.7 s | 13.8 s | **8.4 s** (8.3 to 8.6 on four edits) | 16.5 GB | five edits, section 5 |
| Klein 4B edit, 8-bit | 0.7 s | 8.6 s | 8.2 s | 13.6 GB | faster only by memory, and "remove the plant" kept the plant at 8-bit (same seed as the bf16 success), so edits run at bf16 |

Klein's step is about 1.0 s at 1024 px and Z-Image's about 1.4 s with 2.25x the steps, so Klein is 3.2x faster end to end and uses
less than half the memory.

### 3.2 Quality, judged by opening every image

- **Klein 4B (8 images, bf16 and 8-bit):** the portrait is a convincing, naturally lit woman with freckles and curly hair; the folded
  hands are anatomically fine (five fingers each, believable overlap). The neon sign reads "OPEN 24 HOURS" exactly. The product bottle
  carries the leaf logo as asked. The flat illustration, the cartoon fox (clean outline, correct backpack, one raised arm per side) and
  the interior are clean; the landscape has a plausible mist layer and lake. No visible artifacts at normal zoom.
- **Z-Image-Turbo (8 images bf16, 4 at 8-bit):** the most photographic skin, hair and fur of the set (the red panda's fur and the portrait's
  freckles are better than Klein's). The sign is spelled correctly and laid out as a lit sign on a wall. Weaknesses: the folded hands
  render as two fists rather than overlapping hands, and the product prompt added a wrist strap that was not asked for. 8-bit looked the same as bf16.
- **SDXL-Lightning 4-step (8 images):** clearly the weakest. The portrait and the red panda are good; the neon sign reads "OPENS 4" with garbled
  lines under it, the bottle's label is nonsense text and the leaf logo became a loose leaf on the floor, the lighthouse is attractive but busy, and the
  "kids' cartoon fox" prompt returned a tiled pattern of twenty foxes instead of one character (the same with the LoRA on the base checkpoint, so it is the model, not the file). Text and single-subject adherence are SDXL's known limits.
- **Adherence:** Klein and Z-Image followed all eight prompts. Klein followed small details (the leaf logo, the raised arms) more literally; Z-Image
  composed more freely.
- **Safety-tuning check (owner's rule: do not pick by the model's filter):** no explicit prompt was run, by design. The evidence on
  adult capability is the adapter listings in section 4 and the licences in section 2, not outputs. Klein's card tells deployers to add NSFW and protected-content filters, and
  the public adapter lists show far fewer adult LoRAs for it than for Z-Image or SDXL, so its adult use depends on a LoRA ecosystem that is still small; Z-Image's
  public adapter list already includes many adult LoRAs.

### 3.3 sd.cpp on the same Mac (the other runtime tried)

stable-diffusion.cpp `master-973-f0aac52` (macOS arm64 Metal build from the GitHub release, MIT, one 5 MB server binary plus a 90 MB
dylib; no outbound URLs in the binaries; the server ran under a profile that denies network and worked).

| Run | Result |
|---|---|
| Klein 4B Q8_0 GGUF text to image, 4 steps | 16.3 s warm (sampling 12.2 s, VAE decode 3.8 s), first image 24.5 s, 8.1 GB resident |
| Klein 4B reference edit | 35.2 s (4x the MLX edit) |
| Klein 4B true mask inpaint (init image plus mask, strength 0.9) | 18.7 s; erased the plant but whited out part of the window beside it |
| LoRA by request (`lora: [{path, multiplier}]`) | no reload, 16.5 s, visible effect (pixel-art fox) |
| Cancel a queued job | works (immediate `cancelled`); cancel of a generating job answered 409 and the job ran on |
| Z-Image-Turbo Q8_0 GGUF, 9 steps | 42.6 s warm (53.9 s on the text prompt), first image 85 s, 11.4 GB resident: 3.3x slower than the same model on MLX (12.9 s) |
| SDXL-Lightning 4-step full checkpoint (6.9 GB, fp16), 4 steps | 8.3 to 9.3 s per picture as one process per image (about 1 s of it model load; sampling 3.2 to 4.1 s, VAE decode 4.1 s), 6.6 GB of weights; quality below, section 3.2 |
| SDXL 1.0 base with the Lightning 4-step LoRA | works only with `--lora-apply-mode at_runtime`: 10.5 s (sampling 5.2 s). The default mode (`immediately`, chosen automatically for fp16 weights) segfaulted in the server on the first request and in the CLI (exit 134). The Stack must pass `at_runtime` for every SDXL launch |
| SDXL 1.0 base, 20 steps, CFG 7 | 29.0 s (1.5 s per step plus a 4.1 s decode) |

Verdict: sd.cpp's HTTP API is the better built (async jobs with queue position and preview, structured LoRA array, mask and reference
images, a compatibility layer for OpenAI's route), but on identical Klein weights it is 4x slower than MLX and cannot cancel a running
job. Speed is criterion 2, so mflux wins the runtime and sd.cpp stays as the SDXL path (mflux does not run SDXL) and the template for our own
job API.

## 4. Community LoRA ecosystem (criterion 3)

Counts are Hugging Face models filtered by `base_model:adapter:<base>` (a count of 1000 means the listing cap). CivitAI's bulk listing
refused anonymous requests with 403 on the first pass; the later pass in section 16 got through with an ordinary browser User-Agent and counted CivitAI properly. **Hugging Face undercounts every base whose community lives on CivitAI** (Chroma: 7 here, 1,105 there), so section 16, not this table, decides criterion 3.

| Base | Hugging Face adapters | Notes |
|---|---:|---|
| SDXL 1.0 | 1000 or more | Largest by far. The SDXL family (Pony and Illustrious derivatives) holds most community character, anime and adult LoRAs |
| FLUX.1 dev / schnell | 1000 or more / 283 | Not a pick (dev is non-commercial); LoRAs do not transfer to Klein |
| Z-Image-Turbo | 879 (plus 152 on Z-Image base) | Growing fast; several adult LoRAs among the top downloads |
| Qwen-Image / Edit-2511 | 506 / 191 | Not benched |
| FLUX.2 Klein 4B | 81 (plus 110 on the Klein base, which also load on the distilled model) | Young; styles, edit helpers (try-on, background removal, outpaint) |
| Chroma1-HD, ERNIE-Image, HiDream-I1 | 7, 29, 30 | Too small |

Loading support in the Apple runtime: mflux loads LoRAs (including ComfyUI-format files) for Klein and Z-Image; both tests below worked.

### 4.1 Real LoRA tests (permissively licensed, from Hugging Face)

| LoRA | Base | Licence | Size | Load time | Speed effect | Visible effect |
|---|---|---|---:|---:|---|---|
| `Limbicnation/pixel-art-lora` (trigger "pixel art sprite ... game asset") | Klein 4B bf16 | apache-2.0 | 325 MB | 3.9 s baked (2.5 s unbaked, against 2.0 s with none) | baked 3.7 s per image (no change); unbaked 4.4 s (+0.6 s) | strong: all eight prompts became clean pixel art, portrait included |
| `Sawata97/flux2_4b_koni_animestyle` | Klein 4B bf16 | apache-2.0 | 185 MB | 3.2 s baked | 3.7 s | small on generic prompts (softer faces); needs its own prompt style |
| `renderartist/Technically-Color-Z-Image-Turbo` (trigger "t3chnic4lly") | Z-Image-Turbo 8-bit | apache-2.0 | 255 MB | 11.2 s baked (against 5.7 s with none) | 11.5 s per image (no change) | strong: a 1960s Technicolor look on portrait, product, illustration and sign, text still correct |

Peak memory while baking a LoRA into Klein bf16 was 24.2 GB against 16.4 GB unbaked, so the Stack runs LoRAs unbaked (about 0.6 s per image
slower, 8 GB less peak, no reload to change scale). Changing which LoRA is loaded rebuilds the model in the worker (2.5 to 4 s); the queue
groups jobs by model and LoRA set to avoid that.

## 5. Edit, Comment and Erase (the editor's generative tools)

Klein's reference edit took instructions on a generated living room and a portrait. Outputs (opened):

| Edit | Time | Result |
|---|---:|---|
| "Remove the potted plant by the window" | 13.8 s first, then 8.4 s | plant gone, window and wall filled plausibly; the rest of the room unchanged to the eye (mean pixel change 4.7 of 255 outside the plant) |
| "Change the sofa to dark green velvet" | 8.5 s | correct sofa, fabric and shadows believable, room unchanged |
| "Make it evening with warm lamp light" | 8.5 s | convincing global relight, furniture kept |
| "Change her sweater to bright blue" | 8.6 s | sweater changed; face, pose and hands preserved (slight crop shift) |
| "Add round yellow sunglasses on the fox" | 8.3 s | sunglasses added, cartoon style kept |

At 8-bit the same five edits took 8.2 s and 13.6 GB, but "remove the plant" kept the plant, so the Stack runs edits at bf16 (18 GB admission).

The model has no mask input in mflux, so the editor's mask tools use two measured routes:

1. **Erase by painting (preferred when the fill is simple):** LaMa from the image-tools note, 1.3 to 4 s.
2. **Comment or Erase with a description (the brush or a point plus words):** Klein reference edit, then the result is composited back through
   the feathered mask with a 12 px blur. Tested: pixels outside the mask are bit-identical to the original (maximum difference 0), the
   masked region carries the edit. This is the guarantee the person needs: "only what I painted changed". For Comment (point at a region and
   describe a change) the prompt names the change, the region is the mask, and a crop of the region plus padding is sent when the mask is
   under a quarter of the picture so the edit has more pixels to work with (to measure in IMGGEN-EDIT-01).
3. sd.cpp's native mask inpaint exists for Klein and also works (18.7 s) but was slower and left a seam; it is the fallback only if the compositing
   route disappoints in IMGGEN-EDIT-01.

Z-Image has no released edit model (Z-Image-Edit and Omni are "to be released" on the card), so the editor's Comment and Erase are Klein's.
When the picture came from Z-Image or SDXL, Comment loads Klein for the edit (about 3 s model switch) and says nothing about it.

## 6. LoRA policy (adults get adult-only LoRAs by default)

Owner ruling, 2026-10-17: adult-only LoRAs are available and usable by adults by default, with no off-by-default switch for adults. The
only absolute lines no setting can lift are the two below. Age band and surface gates outrank everything (rule 0, SAFETY.md).

**Where LoRAs live.** The household LoRA library is files under the Stack's data directory, `data/loras/<sha256>.safetensors`, one per
sha256, downloaded and verified by the Stack's existing download job (pinned by hash once added, never fetched at generation time). Home owns
the records, which are the `adapter` records of the person-facing note (PICTURES-01, spec first in `commons`; a catalog package or a household-added file is the same
record): id, sha256, size, name, base model, trigger words, licence text and source URL, who added it and when, `audience` (`all_ages` or `adult_only`), `enabled`, and `kind`
(`style`, `concept`, `character`).

**How one is added.** An adult (an admin by default; a setting lets other adults add) adds it by Hugging Face URL, CivitAI URL or file
upload. The Stack fetches (by URL with a per-host pace, never anything else), computes the sha256, reads the safetensors header for the
base-model hint, and reports size and metadata. Home then classifies:

- **Audience** comes from the LoRA's own metadata and tags (a CivitAI NSFW flag, a Hugging Face `nsfw` tag or card text, the base model
  family's adult tags) and from the adder's answer to one plain question; an unclear answer is treated as `adult_only`. A child or teen never reaches the
  add form.
- **Licence** is recorded as text with its source. A LoRA with no licence is stored with "no licence stated" and shown that way; it is
  usable locally by the household (nothing is redistributed), and a catalog package that wants to ship it needs the licence.
- **Base model** decides where it can run; a LoRA for a base that is not installed shows "needs <model> (a download)" and offers it.

**Who can use what.** An all-ages LoRA works for any person who may generate pictures. An adult-only LoRA works for an adult's own written
chat on their own screen. It is never reachable from: a child or teen profile (the tool call is refused before the model sees the LoRA list; a
minor's tool never receives adult-only ids), any spoken turn, a glance or shared screen (including a screen a child could be near), a guest,
or a picture made for a shared album without an adult confirming. The admin can restrict adult-only LoRAs household-wide with one setting
(`generation.adult_adapters`, default `allowed`; a new household key beside `generation.enabled`); that is an optional control, not a default. This keeps the adult-visual rules of RULES.md rule 0 and
rule 10 intact: nothing here loosens a protection for a child or a spoken turn.

**The model never picks an adult-only LoRA by guessing.** The person chooses a LoRA in the composer's picture options or by naming it ("in
my pixel style"); the tool lists only enabled LoRAs the person's band allows, with their trigger words added by Home, not by reading the
prompt (rule 1: no wording rule decides a tool). Settings pages never render a LoRA's example images for a person who cannot use it.

**The two absolute lines (no household setting reaches them):**

1. **No sexual content depicting a minor or anyone who looks like one.** Enforced at three points: the prompt passes the existing
   deterministic `detectCsam` floor in `@maipai/spec` (`spec/safety/ts/signals.ts`) before the job is queued, for everyone; the LoRA add step refuses
   a LoRA whose card, tags or filename declare a minor-looking or child subject; and every finished picture and clip passes the finished-output check (section 15) before it is stored or shown. Owner's
   policy, 2026-10-17: adults get adult content and adult-only styles by default; the one absolute line is nothing sexual involving a minor
   or a minor-looking person, so the prompt floor treats bare girl, boy, woman and man as ordinary words and this second, independent check
   on the pixels is what catches a phrasing the word list does not know. It is built (IMGGEN-SAFE-01, section 15); it is a learned
   component under `docs/RULES-AND-LEARNED-COMPONENTS.md`.
2. **No non-consensual imagery of a real, identifiable person.** SAFETY.md already says no feature has the purpose of generating imagery of
   identifiable real people, and MEDIA-HOST-01 puts identifiable non-members out of scope. A LoRA of a real person's likeness (CivitAI
   labels these "person" or "celebrity") is refused at the add step, for adults too. RULES.md is silent on one case, flagged as a
   design question in section 9: a likeness LoRA of a consenting household member of their own face.

**Unchanged:** child profiles restricted by default; teen gate by the admin's choice; the output gate; crisis resources; the marketing rule
(never pitch generation as "uncensored" or "unfiltered").

## 7. Memory, keep-warm and the governor

- **Load on demand, one model resident.** The image worker starts on the first picture request and holds one model. A request for another
  base unloads the first and loads the second (Klein from page cache 2 to 4 s; Z-Image 6 to 11 s).
- **Idle unload:** 10 minutes by default (setting `generation.keep_warm_minutes`; 0 unloads right after each job). The worker exits after the
  idle time and returns its memory; the first picture after that costs the load plus a slower first image (4.8 s against 4.0 s at 8-bit, 15.2
  against 12.9 s for Z-Image).
- **Admission through the governor** (STACK-06): each job asks for the measured peak plus 10 percent: Klein 8-bit 15 GB (16 GB with LoRAs), Klein 4-bit 13 GB, a Klein edit at bf16 18 GB, Z-Image-Turbo 8-bit 34 GB, SDXL 10 GB (to measure). The Studio's budget while the live Stack keeps about 28 GB resident is
  about 50 GB, so any single job fits on p128 and Klein plus a LoRA fits on p64. A refusal is a plain 503 telling the person what to do ("pictures need
  15 GB free; close the video job or wait"). On memory pressure the worker unloads at once (the chat model has priority).
- **Tiers:** p128 all three; p64 Klein and SDXL, Z-Image after a 4-bit run; p32 Klein 4-bit (3.9 s, 12 GB peak, measured) and SDXL; p16 SDXL only, or off. The
  sizing page already lets a person turn `image` off to give chat the memory.

## 8. Runtime evaluation (criterion 4) and what was not benched

| Runtime | Result |
|---|---|
| **mflux 0.23.0 (MLX)** | Picked. MIT. Klein 4B, Z-Image, Qwen-Image, FLUX.3 and a dozen more models, LoRA, edit models, quantization (3 to 8 bit), Python API with a per-step callback and an interrupt exception. No HTTP server, so the Stack wraps it in a worker. Pre-1.0 and fast-moving: pin the version and hashes. Its environment is 1.1 GB because it pulls torch and transformers (a 4 s import, one-time per worker start); the only outbound calls in the package are the weight downloads (Hugging Face) and release tooling, none on the generation path. Python 3.11 or newer; Pillow must be pinned below 13 (13.0.0 failed on `numbers._IntegralLike` in this environment) |
| stable-diffusion.cpp | Section 3.3. Best API, 4x slower, no cancel mid-job. Used for SDXL only |
| ComfyUI on MPS (what IMAGE-01 and MEDIA-HOST-01 planned) | Not benched here: PyTorch MPS was not needed once MLX met the bar. ComfyUI stays the CUDA URL-tier engine for tier 1 (STACK-13b, SD 1.5 today) |
| Draw Things local API | Not evaluated: GPLv3, GUI-first |
| `mlx-serve` | The repository from the field survey could not be found (the guessed GitHub path answered 404); no evidence of maturity, not evaluated |
| DiffusionKit, diffusers on MPS | Not benched: mflux covers the same MLX path with more models and active releases |

Not benched, with the reason: Qwen-Image 20B and Qwen-Image-Edit-2511 (Apache; about 40 GB of weights, over the download budget; they
remain the quality-tier candidate), Chroma1-HD, ERNIE-Image-Turbo, HiDream-I1 (Apache or MIT, but 7 to 30 adapters each, so they lose
criterion 3 on listings alone). Row IMGGEN-BENCH-01 measures Qwen-Image-Edit-2511 and Z-Image base.

## 9. Stack API (additive; the contract number does not change)

`POST /v1/images/generations` keeps its shape (OpenAI-style `data[].b64_json`, `job` id, 200 within `timeout_ms`, 202 past it, 499
cancelled, 500 failed). New optional request fields:

`model` (a pinned image model id; default the role's pick), `size` (`1024x1024`, 256 to 2048 per side, multiples of 16), `n` (1 to 4),
`seed`, `steps` (default per model), `loras` (`[{ sha256, scale }]`, scale 0 to 2; every entry is verified present and for the chosen base, else 422), `init_image` (base64) with
`strength` for image to image, and `preview` (boolean). Result items add `{ seed, width, height, model, steps, ms }`; prompts and images are never logged (rule 6a).

`POST /v1/images/edits` (the route the image-tools note already adds) gains two operations: `edit` (instruction plus one to three reference images)
and `edit_masked` (same plus `mask`, white means changeable, and `feather` in pixels, default 12; the Stack composites the result through the
mask so pixels outside it are unchanged, and `region` as normalized `{x, y, w, h}` to crop with padding before editing). The existing
`remove_background`, `erase`, `upscale` and `resize` are untouched.

Jobs: queue position on the job, `percent` from the worker's per-step callback (step over total steps; a decode phase is 95 to 100 percent), a
low-resolution preview on `GET /stack/v1/jobs/{id}` when `preview` is set (from the worker's stepwise output), `DELETE /stack/v1/jobs/{id}`
cancels a queued job at once and a running one between steps through mflux's interrupt (to prove in tests: sd.cpp could not do this, mflux's
interrupt exception exists but was not exercised here). `GET /stack/v1/image` reports `{ state, models, loras_supported, edit, limits, idle_unload_s }`
so Home enables the tools and the settings page. The deadline default stays 2 minutes; edits 2 minutes; Z-Image 4 minutes.
LoRA download and hash is the existing model download job with `kind: lora`.

## 10. Rules self-review (RULES.md by number) and flags

The `architect` agent exists in the org plugin but is not callable from this session; verdict still owed (row IMGGEN-SAFE-01 carries it).
A careful self-review against `docs/design/RULES.md`:

- **0 (age and surface gates):** unchanged and enforced by section 6; adult-only LoRAs refused for minors, spoken turns, shared or glance surfaces, guests.
- **1 (the model decides):** the picture tool is a conditional tool offered only on a turn that earns it, with its own bench row (IMGGEN-HOME-01); the
  tool arguments are the person's choices; trigger words are added by record, not by reading wording. No conflict.
- **2, 3, 8:** no model-id gating in Home; the Stack reports capabilities. No conflict.
- **6, 6a:** a failed picture never fails the answer; logs carry model, step counts, timing and counts only, never prompts, LoRA ids or filenames. No conflict.
- **9, 9b:** the chat UI is the shipped `image-generation` and `image` Elements; the canvas editor is a named gap the image-tools row IMGTOOLS-05 already records. No conflict.
- **10:** an adult's picture follows the adult's gate; nothing in this note touches text gating.
- **11:** only the Stack's pinned worker (mflux, sd.cpp) runs the models. No conflict.
- **No RULES.md rule is changed or broken.** Two design questions for Jesse (only he changes a rule): (a) a likeness LoRA of a consenting household
  member's own face, which SAFETY.md's "no feature whose purpose is identifiable real people" does not clearly allow or forbid; the note refuses it
  until he rules; (b) accept SDXL's use-based OpenRAIL++ licence for the small tier, or leave the small tier on Klein 4-bit only.

## 11. Samples and evidence

All in the scratchpad `/private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai-home/fba2f4f9-9b1a-4dc5-ae7f-b12315c3b680/scratchpad/imagegen/`:
`out/klein4b_bf16`, `out/klein4b_q8`, `out/zimage_bf16`, `out/zimage_q8` (eight images each, `result.json` with the numbers),
`out/klein4b_edit` (five edits plus `remove_plant_masked.png`), `out/klein4b_pixel`, `out/klein4b_lora`, `out/zimage_lora`, `out/sd_klein`,
contact sheets `out/sheet_*.jpg`, logs in `logs/`, scripts in `bench/` (`bench.py`, `edit.py`, `sdtest.py`, `locked.sh`). The scratchpad is temporary;
the bench scripts become `stack/scripts/bench/image-*.ts` in IMGGEN-BENCH-01.

## 12. Slices (rows are in `docs/BACKLOG.md`, section "Image engine (2026-10-17)")

IMGGEN-STACK-01 engine and install plan, IMGGEN-STACK-02 job API with LoRA parameters, IMGGEN-EDIT-01 edit job API with mask and region, IMGGEN-LORA-01 the adapter
library on the Stack and Home (after PICTURES-01's spec), IMGGEN-HOME-01 the picture tool and Stack handoff (the engine half of PICTURES-02, which is IMAGE-02 extended:
one slice, not two), IMGGEN-UI-01 chat progress, IMGGEN-EDITOR-01 Comment in the built editor, IMGGEN-SET-01 the engine controls on PICTURES-04's settings page,
IMGGEN-SAFE-01 safety gating and the finished-picture check, IMGGEN-BENCH-01 follow-up benches. IMAGE-01, IMAGE-02 and MEDIA-HOST-01 are superseded where they name ComfyUI on the Mac.

## 13. Stack API as built (Stack d3c4fab, 2026-10-17)

The exact contract is `docs/integrations.md`, "Picture generation", in the Stack repository; this section is what differs from section 9 and what was measured.

**Where it differs from section 9.** Result pictures are fetched by URL, not held in memory: `GET /v1/images/generations/{job}` (state, phase, progress, `data`), `GET /v1/images/generations/{job}/{index}.png` and `.thumb.jpg`, `DELETE` to cancel or delete (kept a day, newest 48 jobs, on disk under `data/images/results/<job>/`). `loras` entries are `{ id | sha256, scale }` (`strength` is an alias); the library id is `lora-` and the first 16 hex of the sha256; the request carries `audience` (`all-ages` or `adult`) as a second lock beside Home's own list. `init_image` takes base64 with `strength`. `GET /stack/v1/image` answers `{ image: { state, models[], edit, limits, install, ... } }`. `POST /stack/v1/image/install` is one job (every pinned file of a family, then the environment). Edits are `operation` `edit` and `edit_masked` on `POST /v1/images/edits` with `instruction`, `mask`, `region` (`x,y,w,h` fractions) and `feather`; the answer is the generation answer. The stepwise `preview` frame is not built. LoRAs are added by file, by path, or by a `huggingface.co` file link (an install job: the file is hashed on arrival, the repository's licence and tags are read from the Hub); CivitAI is not fetched.

**Policy enforced in the Stack.** Refused for everyone at add time: a file that names a child or a minor in a sexual context, and a file that says it reproduces a real person's likeness (a household member's own face stays refused until the owner rules). Adult-only is the default class; a file whose metadata names adult content cannot be set all-ages. An all-ages request never applies an adult-only LoRA. A LoRA selects the base model it was made for; mixed bases are refused. The prompt is never logged or kept in a job record, the event feed or the result store.

**Measured on the Studio (scratch Stack, M5 Max 128 GB, 2026-10-17).** Klein 4B 8-bit, 1024 x 1024, 4 steps, through the real API: 4.07 to 4.19 s in the worker and 4.2 to 4.3 s wall warm (four prompts), 7.2 s for the first picture after a worker start with the weights in the page cache, 10.5 s wall for the first request of a fresh Stack. The pixel-art LoRA (Apache-2.0, 325 MB): +0.3 s a picture warm, about +1 s when the LoRA set changes, mean pixel difference 27 of 255 at scale 1 and 16 at 0.5, and a repeat without it is bit-identical. Edits at bf16: a masked plant removal 5.1 s, a whole-picture recolour 8.0 s, a region edit (crop with context) 1.8 s; zero differing pixels outside the mask and its 12 px feather ring. Not run for real: Z-Image-Turbo (33 GB, over the approved download budget), a 32 GB Mac at 4-bit, SDXL-Lightning (the sd.cpp floor is not built: p16 answers `off`).

## 14. Home side as built (2026-10-17)

The Home half of the slices above is built against the Stack's real API. What exists, and the limits it carries:

- **The tool.** The bundled package `generate_image` is offered (conditional, gate `picturesAllowed`) only to an owner, admin or adult on their own written chat screen, when `generation.adults` is on and the Stack reports a picture model. A child, a teen, a guest, a spoken turn, a glance screen and a TV never see it, and the policy node refuses a call that arrives anyway, with a fixed line, before a job exists. The model passes `prompt`, `size`, `count`, `style` (a name, matched by Home against the styles that person may use) and `depicts_real_person`.
- **The job.** `picture_jobs` rows (memory only in a temporary or Incognito chat), polled from the Stack, stored as the person's own file with the Stack's bytes unchanged and provenance `picture-gen:` (image to video needs the exact bytes). A forgotten turn, chat or person takes its jobs with it.
- **The card.** Kit `JobProgress` while it is made, kit `ImageGallery` with Edit when it is done, kit `ErrorState` with Try again when it failed. Make a variation is in the reply's More menu.
- **Comment.** The kit editor's Comment sends `edit_masked` (or `edit`) to the Stack and returns a preview to apply as a new version (kit `ui-v0.5.245`).
- **Settings.** Home settings, Pictures and videos (spec `spec-v0.1.154`).

Known limits, stated so nobody assumes more than is there:

1. **The prompt line is a word list plus the model's flag.** `promptViolatesMinorLine` pairs a sexual or nudity word with a real minor marker (an age under 18, child, kid, teen, baby, toddler, little or young girl or boy, schoolgirl, loli and the like) and refuses; the bare words girl, boy, woman, man and bikini are not markers, so adult wording passes (owner's ruling, 2026-10-17; one list in `backend/src/lib/pictures/minorLine.ts`); `depicts_real_person` is the model's own statement. A phrasing neither knows reaches the Stack, whose LoRA import refuses styles of minors and real people but does not look at a prompt. The second, independent check on the finished picture (section 15) is built; it is what covers a phrasing the list does not know.
2. **Uploaded photos.** A Comment on a photo the person did not generate here refuses requests that undress or sexualize it (`asksToUndress`), also a word list. Ordinary changes ("change her sweater to blue") go through.
3. **Likeness styles.** Home asks for a tick that a style is not a likeness of a real person and the Stack refuses what its metadata names. Neither can see a face in the weights. A consenting household member's own likeness stays refused until the owner rules (section 10).
4. **Children and teens.** The settings page shows them locked off; no key turns them on. The finished-picture check now exists (section 15), but turning pictures on for a minor is the owner's decision, not part of that slice.

## 15. The finished-output check (IMGGEN-SAFE-01, built 2026-10-17)

The absolute line (RULES.md rule 0, SAFETY.md): nothing sexual involving a minor or a minor-looking person, for anyone, with no setting
that reaches it. Because the prompt floor is a word list, every finished picture and every finished clip also passes a second check on the
pixels before Home stores or shows it. The whole policy is one module, `backend/src/lib/pictures/ageCheck.ts`, tested in
`backend/tests/ageCheck.test.ts`.

- **When it runs.** On every finished picture and every clip, because the vision answer itself says "nobody is in it" (`label: none`) for a
  landscape or an animal, which is safer than a keyword guess about the prompt. A job is **adult-only** when the prompt carries a sexual or
  nudity word or a plain "no clothes" phrase (`minorLine.ts`), or any style used is adult-only, or a style is no longer in the library. A described
  change made with the editor's Comment (`lib/imageEdit.ts`) is checked the same way before it is kept as a preview.
- **Where it runs.** The resident chat model reads the picture through its projector (the Stack's `/v1/chat/completions` on this computer,
  model `chat`; the role must be ready and declare `imageInput`). Zero outbound: no cloud service. The check is a chat request, so it does not
  take the generation lock; the generation worker has exited by the time the Stack answers "done". It waits up to 4 s while
  `/stack/v1/hardware/budget` says `pressure: critical`, and then counts as "could not run". Checks run one at a time in Home.
- **What is sent.** A copy at most 768 px on the long side, re-encoded as JPEG with no EXIF or any other metadata, flattened on white.
  Temperature 0, thinking off, `max_tokens` 160, a JSON schema, a 20 s deadline. The system prompt asks only for a classification and
  forbids describing or naming anyone.
- **The verdict.** `people_count`, `apparent_min_age_estimate`, `label` (`adult`, `possibly_minor`, `child`, `none`; it describes the youngest
  depicted person), `is_nude_or_sexual`, `confidence`. An answer that contradicts itself (`none` with people counted, `adult` with nobody) is
  not a verdict. An `adult` label beside an estimated age under 18, or with a confidence under 0.5, is read as the younger answer.
- **The decision** (`decideAgeCheck`, pure). Any depicted person possibly a minor or a child AND (the image is nude or sexual OR the job is
  adult-only): **withhold**. A check that could not run (no vision model, memory critical, a timeout, an unreadable answer) on an adult-only
  job: **withhold** (fails closed). On an ordinary job a failed check **passes** (fails open, so a busy model never blocks an ordinary
  picture). Everything else passes: an adult, nobody, or a possible minor in an ordinary picture that is not sexual (a cartoon child with
  a balloon). Withholding applies to the whole job.
- **What a withhold does.** The picture is never stored in Home (the check runs before storage), the Stack's copy is deleted, and the job
  ends with the fixed line: "I can't show that picture. It may show a child in a sexual situation, and that is never allowed." (or "video").
  A check that could not run on an adult-only job ends with "I couldn't check that picture, so I can't show it. Try again in a minute."
  A minor finding writes one log line (the verdict and a SHA-256 prefix of the prompt, never the image or the prompt text) and sends the
  admins the `safety.picture_withheld` notification (rule S6: Notifications; names the person and the kind, no image), at most once every
  ten minutes per person. Home has no per-person strike counter today; a repeated prompt hash in the log is where a pattern shows.
- **Clips.** Three keyframes (first, middle, last) are taken by Apple's decoder through a 60-line Swift helper (`keyframes.swift`, compiled
  once with `swiftc`, about 2 s on a quiet Mac, started when the clip is submitted so it is ready when the clip is; `ffmpeg` on the PATH is the
  second choice) and each goes through the same check; one bad frame withholds the clip. A Mac with neither checks the Stack's poster
  (frame 0) alone: an ordinary clip passes on that, an adult-only clip is withheld as "could not check", because frame 0 cannot answer for the rest. The
  Stack serves only that poster, so the middle and last frames need the helper (Stack follow-up: serve keyframes).

**Calibration (2026-10-17, the live Stack's resident Muse Glimmer 30B, scratch Home, innocuous pictures only).**
`backend/scripts/agecheck-calibrate.ts` makes eight pictures from fixed innocuous prompts on the live image engine, then runs the real check.
No explicit imagery was made, opened or needed, and no prompt involves a minor in a sexual context.

| Picture (prompt) | Result |
|---|---|
| middle-aged man, studio portrait | adult, 55, nobody under 18, passes |
| elderly woman reading by a window | adult, 70, passes |
| woman in her late twenties laughing in a park | adult, 25, passes |
| chef plating a dish (3 people) | adult, 30, passes |
| cartoon girl about 8 with a balloon | child, estimated 6; passes as ordinary, **withheld if the job were adult-only** |
| cartoon boy about 7 flying a kite | child, estimated 5, 2 people; same |
| red fox in the snow; mountain landscape | none, 0 people, passes |

8 of 8 labeled as expected; 2.8 to 3.4 s per picture on the live Stack (an earlier run on the llama.cpp build took about 8 s, so the target
of 10 s holds on both). Three keyframes of a synthetic clip: 3 frames in 0.26 s with the compiled helper, none under 18, no people.
The decision rows (child and sexual withholds; adult and sexual passes; possibly minor and not sexual passes; failure and adult-only withholds;
failure and ordinary passes) are unit tests on scripted verdicts. **Not measured here, on purpose:** the false-negative rate on real adult
content with a minor-looking subject, because no explicit or sexual image was made or looked at. A person with a youthful look who is an adult
may be labeled `possibly_minor`; on an ordinary job that costs nothing, on an adult-only job it is withheld, which is the safe side.

## 16. The default picture model, decided on CivitAI as well as Hugging Face (2026-10-17)

Owner ask (Jesse, 2026-10-17): the default picture model should be fast, high quality, have a very large community LoRA ecosystem (CivitAI,
not only Hugging Face) and ideally carry no baked-in filter, so adults get adult output while rule 0's age gates and the two absolute lines
(section 6) still apply in our own code. **Measured** below means a number taken today by a request or a run; **read** means taken from a
card or page; **not tested** means neither.

### 16.1 Comparison

CivitAI: `GET /api/v1/models?types=LORA&baseModels=<base>&nsfw=true`, paged at 100, read-only, no account, one request a second, counting
distinct models with at least one version on that base (the household sent nothing). A count with a plus sign hit the 30-request cap I set
(3,000 models) and is a floor. "Adult-rated" is a model flagged NSFW or rated R and above by CivitAI itself.

| Model | CivitAI LoRAs (measured) | HF adapters (measured) | Licence (read) | Built-in filter | 1024 px speed on this M5 Max | Size / runtime |
|---|---:|---:|---|---|---|---|
| **Z-Image-Turbo 6B** | **8,913** (6,730 adult-rated) | 879 | Apache-2.0, not gated | none stated on the card (read); the community calls it unfiltered (secondary sources, not tested by output) | 12.9 s warm, 8-bit, 9 steps (measured, section 3.1); 30 s through the live Stack under heavy load (owner's number) | 30 GB peak at 8-bit; mflux (MLX), built |
| Z-Image base | 1,224 (926 adult-rated) | 152 | Apache-2.0 | none stated | slower (more steps, guidance); not benched | same family; benchmark row IMGGEN-BENCH-01 |
| FLUX.2 Klein 4B | 205 (153 adult-rated) | 81 | Apache-2.0 | the card tells deployers to add NSFW filters; few adult LoRAs exist for it | 4.0 s warm, 8-bit (measured) | 13.5 GB peak; mflux, built; the only model that edits |
| FLUX.2 Klein 9B | 1,285 | 112 | FLUX Non-Commercial, gated | as Klein | not benched | rejected on licence (section 2) |
| Chroma1-HD 8.9B | 1,105 (962 adult-rated) | 7 (31 on Chroma) | Apache-2.0 | none by design ("not aligned with a specific safety filter", read) | not tested; 40 steps with guidance on the card, so two passes a step: slow | not in mflux's model list (read); no runtime in our Stack |
| Illustrious XL (SDXL family) | 3,000+ (2,845+ adult-rated among the first 3,000) | 14 (770 on the v0 base) | card lists `sdxl-license`; derivatives list `faipl-1.0-sd` (Fair AI Public License, share-alike on derivative models); read the exact text before adding | none stated; trained on tagged booru data | about 29 s at 20 steps, 8 to 10 s with a 4-step Lightning or DMD2 LoRA (SDXL costs, measured in section 3.3 on sd.cpp; Illustrious has the same architecture) | 6.6 GB; sd.cpp, not built here |
| Pony Diffusion V6 XL | 2,996+ | 7 | CreativeML OpenRAIL-M (read) | none stated | as SDXL | as above |
| NoobAI-XL (Illustrious derivative) | 2,996+ | 8 to 30 | not read | none stated | as SDXL | as above |
| SDXL 1.0 / SDXL-Lightning | 2,999+ / 97 | 1,000+ | OpenRAIL++-M | none | 8 to 9 s Lightning 4-step (measured) | 6.6 GB; sd.cpp |
| FLUX.1 dev / schnell | 2,999+ / 550 | 1,000+ / 283 | dev non-commercial; schnell Apache-2.0 | dev has a filtered pipeline | not benched | 12B, about 24 GB bf16; mflux has it; LoRAs do not load on Klein |
| Qwen-Image 20B | 1,661 (the "Qwen" filter also holds edit variants) | 506 | Apache-2.0 | none stated | not benched | about 40 GB of weights |
| HiDream-I1 17B | 65 | 30 | MIT | not read | not benched | 17B |
| Lumina | 43 | not counted | not read | not read | not benched | not read |

What the numbers say. Z-Image-Turbo has 43 times Klein's CivitAI library and three quarters of them are adult-rated by CivitAI's own flags
(6,730 of 8,913). The only models with more LoRAs are the SDXL family, which are older, bigger to run per picture on our
Mac (8 to 29 s on a runtime that is 3 to 4 times slower than MLX for the same weights) and have no engine in the Stack yet. Chroma is the
only model with an explicit "no safety filter" statement, but it has one eighth of Z-Image's library and no Apple runtime in the Stack.

The earlier pick (section 1) counted Hugging Face only and so rejected Chroma at 7 adapters; CivitAI shows 1,105. That does not change the
decision (Z-Image is eight times larger and already built) and it moves Chroma to "worth a bench when mflux supports it".

Typical file sizes matter to the add flow: of the 100 most-downloaded Z-Image-Turbo LoRAs (measured, one request), the median file is 162 MB, 69
percent are over the 120 MB a form upload can carry, the largest is 1.45 GB, none is over the Stack's 2 GB cap. Klein's median is 88 MB.

### 16.2 Decision

| Tier | Default for a request with no model and no LoRA | Also installed by the wizard | Optional in Models and storage |
|---|---|---|---|
| p128 | **Z-Image-Turbo** (8-bit, 9 steps, 34 GB admission, about 13 s measured) | FLUX.2 Klein 4B (quick pictures, every edit and Comment, 15 GB) | Video; later the anime model (IMGGEN-SDXL-01) |
| p64 | FLUX.2 Klein 4B (unchanged) | none | Z-Image-Turbo only after IMGGEN-ZIT-P64 measures it |
| p32 | FLUX.2 Klein 4B at 4-bit | none | none |
| p16 | off | | |

- **Why Z-Image-Turbo wins the default.** It is the only candidate that clears all four of the owner's tests at once: a CivitAI library of
  8,913 (the largest of any model our runtime can run), Apache-2.0 and not gated (a household admin can download it, and the Stack already pins
  and installs it), no filter stated on its card, and 12.9 s a picture on MLX with the best skin and fur texture of the benched set.
  What it gives up: it is about three times slower than Klein, it cannot edit, and its folded-hands anatomy was worse in the bench.
- **What Klein stays for.** Fast photoreal (4.0 s), text in pictures that reads correctly, all edits and Comment, and the only model on
  p32 and p64. It is installed beside Z-Image on p128 (15 GB) because an edit is always a Klein job.
- **The licence caveat that remains.** Z-Image-Turbo's licence is Apache-2.0 with no use restriction on the card, so no licence reason stops adult
  output; the two absolute lines are enforced in our code and unchanged (sections 6 and 15), and the marketing rule (never pitch generation as
  "uncensored") is unchanged.
- **p64 stays on Klein for now.** The only Z-Image memory numbers are 8-bit: 30.1 GB MLX peak (bf16 33.7 GB), so most of the peak is probably the
  load, not the steady state. With the chat model at 18 to 20 GB resident and the other roles, a 34 GB admission does not fit a 64 GB computer, and I could not
  measure 4-bit today: the Stack's weights on the Studio were uninstalled by another session and the earlier bench copy is gone, so a run
  needs a 24 GB download under the bench lock. Row IMGGEN-ZIT-P64 holds the measurement; nothing about p64 is guessed.
- **The second model, anime and illustration.** Illustrious XL (or its NoobAI derivative; Pony V6 is older) is the right second model for the Civitai
  anime and illustration LoRA library, installable in Models and storage, never the default. It needs the sd.cpp worker built (IMGGEN-SDXL-01, Large)
  and the owner's acceptance of its licence (section 9 question b, now a Fair AI Public License share-alike term on derivative models, not only OpenRAIL).
  Until then the Stack refuses these files with a sentence naming the family.

### 16.3 What changed in the code (2026-10-17)

- **Stack** (IMGGEN-DEFAULT-01): `defaultFamilyFor(tier)` picks Z-Image-Turbo on p128 when installed, else Klein; `GET /stack/v1/image` reports it as `default_model`;
  the disk plan marks `pictures-zimage` `recommended` on p128 (label "Make pictures (Z-Image Turbo)") and renames the Klein row there "Quick pictures
  and edits"; a LoRA still selects the base it was made for. LoRA detection reads Civitai-style files: a kohya-named Z-Image file
  (`lora_unet_layers_N_attention`) is no longer mistaken for SDXL because of its `lora_unet_` prefix, a header that declares its base wins, and Pony, Illustrious,
  NoobAI, FLUX.1 and Chroma files are refused with their family named. Not verified against real Civitai files (none was downloaded: the add flow takes a file the admin
  saved, and fetching one was not part of this research); the detection is tested on synthetic headers.
- **Home**: the Stack's plan drives the wizard and Models and storage, so the new default and sizes flow through with no Home change. The one Home gap found
  is the add flow: Civitai is never fetched (no accounts, no phone-home), so an admin downloads the file, and 69 percent of popular Z-Image LoRAs exceed the 120 MB the form
  and Bun's request cap allow. Settings, Pictures and videos now has "A file already on this computer": the admin types the path and the Stack reads it with the same
  checks (audience unclear means adult-only, likeness and minor refusals, hash, base from the tensors).
- **Unverified**: Z-Image-Turbo end to end through the Stack at the new default (the live Studio had its weights uninstalled during this session); a 4-bit/8-bit p64
  run; any Chroma or SDXL speed on this Mac beyond section 3.3; real Civitai LoRA headers; the uncensored behaviour (by design nothing explicit was generated).

