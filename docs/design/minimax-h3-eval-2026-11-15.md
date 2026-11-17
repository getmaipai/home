# MiniMax H3-Image and H3 video on the Studio: evaluation (started 2026-11-15)

Status: **decided 2026-11-15 (Jesse: "Yes, both")**: H3-Image takes the picture slots and H3 video at 8-bit takes a video slot; the
build rows are in section 5. Architect verdict pending on the slot changes. Row MODEL-VET-MINIMAX-01 (owner's ask, 2026-11-15: "vet new image and video models; the newer MiniMax for image and
video should work well"). Method and pass bars are section 14 of [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) (E3 video,
E4 pictures) and the October picture bakeoff [image-model-bakeoff-2026-10-25.md](image-model-bakeoff-2026-10-25.md) (same 22 prompts,
same 5 edits, seed 7, 1024 by 1024, one process per picture). Scratch: `data-scratch/minimax-eval/` (runners, logs, pictures, clips).

Owner ruling on licences (Jesse, 2026-11-15): a licence is never a reason to skip a model; the person accepts it in Settings before the
download, as for every other model. The facts below are recorded, not weighed.

## 1. The two models

| | H3-Image (pictures) | H3 (video with sound) |
|---|---|---|
| Released | 2026-11-11, open weights on Hugging Face (`MiniMaxAI/MiniMax-H3-Image`) | 2026-08-02, open weights (`MiniMaxAI/MiniMax-H3`, FL2VA and Ref2VA checkpoints) |
| Size | 33.1B dense DiT, BF16 66 GB plus 2.3 GB VAE; text encoder is the Qwen3-VL-32B encoder from H3 (67 GB) | 33B dense omni transformer, BF16 62 GB; same 32B text encoder; video VAE 9.7 GB, audio VAE 0.6 GB |
| Output | up to 16 MP, 6 steps, no CFG; text to picture, up to 16 reference pictures, edits | 4 to 15 s at 24 fps, short side 768 px, stereo 32 kHz sound in the same pass; 2K upscale is hosted only |
| Licence | MiniMax-H3-Image Community License; US, EU, UK and Korea need a separate application; written permission above about US$1M revenue; outputs may not train other models (third-party readings; the LICENSE file itself was not read) | MiniMax H3 Community License; the same territorial application form; above US$20M revenue needs authorisation |
| Apple Silicon route used here | `h3-image-mlx` 0.1.0a8 (PyPI, Apache-2.0 code, MLX 0.32.4), INT8 ConvRot weights from `Comfy-Org/MiniMax-H3-Image` at `b8ebf14`: DiT 21.0 GB, text encoder 27.1 GB, VAE 1.2 GB, 49.3 GB on disk | `ComfyUI-MiniMax-H3-MLX-SolAttn` at `55bb7dd` (Apache-2.0 code), used through its CLI `scripts/generate_staged.py`, profile `4` (4-bit transformer about 25 GB, 8-bit Qwen3-VL-32B subset 32 GB, turbo adapter), about 60 GB on disk |
| Community numbers before this run | M5 Pro 48 GB, 1024 px, 6 steps: 18.9 s, peak 21.7 GB resident; 2048 px: 57 s, 22.3 GB | M3 Ultra, 864 by 480, 124 frames (5 s), turbo 4 steps, 4-bit: 226 s, peak footprint 35 GB; the 24 GB preset 239 s at 16 GB |

Other Apple routes seen and not used: `minimax-h3-image-mlx` (BF16 streamed from disk, 94 GB download, about 3 min at 2048 px on an
M4 Pro), `devin-lai/MiniMax-H3-Image-mlx` (packed12 27 GB plus a 62 GB unquantized encoder), ComfyUI on MPS (INT8, 31 GB at 1024 px, slower),
GGUF builds through stable-diffusion.cpp. For video: `minimax-h3-mac` (MLX streaming), `h3.c`, MLX Serve packs, unsloth GGUF.

## 2. Pass bars (from section 14)

- **Pictures, Standard:** peak at or under the Standard cap (24.9 GB on the Studio today) and faster than or close to ERNIE (43.8 s under
  load in October; 8 steps), with text as good as ERNIE and Z-Image on the five text prompts.
- **Pictures, Boost or Max:** beats Z-Image-Turbo on the 22 prompts by a margin worth minutes of wait; edits at least as good as Klein's.
- **Video:** clearly better than today's Boost (LTX-2.5 with sound) on our prompts, fits its level's cap, time stated. A clip must be
  opened and watched whole, with its sound.

## 3. Results

### Video, Studio, 2026-11-15 evening (load average about 11, live hub running beside it)

| Clip | Prompt | Wall | Peak footprint | Max RSS | Steps | Output |
|---|---|---|---|---|---|---|
| v1 | ginger cat asleep by lemons, golden hour, camera push, yawn; kitchen sounds, clock, soft piano | 193 s (text 4 s, denoise 125 s at 29.5 s a step, the rest decode and encode) | 34.0 GB | 14.2 GB | 5 (turbo adapter) | 864 by 480, 124 frames at 24 fps, h264 plus stereo 32 kHz aac; `video/out/v1.mp4` |

| v2 | woman in a yellow raincoat at a bakery door, looks at the camera, smiles, says "Fresh bread daily, come in out of the rain"; rain, shop bell | 187 s | 34.0 GB | 17.6 GB | 5 | same shape; `video/out/v2.mp4` |

| v3 | close-up of a woman with curly hair and round glasses at a kitchen table, looks into the camera, says "Hi Nova, welcome home. Did you remember your homework?", kettle whistles at the end | 178 s | 34.0 GB | 17.2 GB | 5 | same shape; `video/out/v3.mp4` |

v3 as read from the frames (the companion case): a close-up that holds eye contact the whole clip, the same face and glasses in every frame,
the mouth clearly shaping words with changing expressions (open smile, pursed lips, raised brows), hands and mug steady, a kettle on the
stove behind. This is the shot a talking companion needs. Sound at a normal level (mean -25 dB, peak -7 dB); the words and the lip timing are
Jesse's ear. Three clips, three times 34.0 GB and 178 to 193 s: the footprint and the time do not move with the subject.

**Jesse's judgement of the three clips (2026-11-15, watched with sound):** v2 "fresh bread" is spelled wrong and the raincoat woman's face
is messed up; v3 the kitchen mom's mouth clips a few times (lip sync breaks). v1 drew no complaint. So at 4-bit with the 5-step turbo
adapter, H3 video is not yet clearly better than LTX-2.5 Boost on faces and lips; a check at 8-bit and more steps is the one thing that
could change that (section 4).

v2 as read from the frames: a convincing rainy brick street and bakery front, she steps out of the door and stands in the yellow coat, steady
across the sheet, no flicker. Two misses: the prompt asked for a look to camera and a smile and the shot stays wide with a small face; the
shop sign reads "FRESH BREAD DAILVE" (the model invented sign text and misspelt it, the same failure class as Klein's "OPFEN"). Sound track at
a normal level (mean -27 dB, peak -9 dB); whether the words are spoken clearly is Jesse's ear (the Stack's listening engine only answers Home).

v1 as read from the frames: a coherent, sharp kitchen at golden hour, lemons in a bowl, the cat lifts its head and yawns mid-clip, the push-in is
subtle, no flicker across the contact sheet. The sound track measures quiet (mean -50 dB, peak -31 dB); whether it is piano and a clock is
Jesse's ear. The command-line path makes text-to-video only; reference-to-video (two character pictures kept across shots) and the shot
chaining through the last 22 frames exist only as ComfyUI nodes in this port.

Against today's video slots (Stack `lib/tiers.ts`, measured on this Studio): Wan 2.2 Standard, 832 by 480, 49 frames, 25.4 GB; LTX-2.5 Boost
with sound, 768 by 448, 5 s, 45.8 GB; LTX-2.5 Max, 1024 by 576, 10 s, 51 to 61.5 GB. H3 made a sharper 864 by 480 clip with sound at a
34 GB footprint, so it sits between the Standard and Boost caps (24.9 and 35.3 GB today) and under Boost once the room is counted right
(TIER-ROOM-01). The catalog records no wall time for the LTX-2.5 Boost clip, so speed is compared by a later side-by-side run.

### Pictures, Studio, 2026-11-15 evening (load average 5 to 7, live hub running beside it)

Resident mode (`--dit-mode resident`), one process per picture, time includes the model load:

| Model | Pictures | Mean wall | Range | Steps | Peak memory |
|---|---|---|---|---|---|
| MiniMax H3-Image INT8 (this run) | 22 | 13.3 s | 9 to 23 s | 6 | measured separately below (the runner stages the text encoder and the DiT in child processes, so the in-process meter read zero) |
| ERNIE-Image-Turbo (October, load 25 to 50) | 22 | 43.8 s | | 8 | 18.8 GB |
| Z-Image-Turbo (October, load 25 to 50) | 22 | 45.8 s | | 9 | 25.8 GB |
| FLUX.2 Klein 4B (October, load 25 to 50) | 22 | 16.9 s | | 4 | 10.2 GB |

The October machine was far busier, so the time columns are not a fair race; the pictures are. My reading of the H3 column (Jesse judges):

- **Text: 5 of 5 right.** "OPEN 24 HOURS" neon, "FRESH BREAD DAILY" sign, the jazz poster with both lines, the chalkboard with the three prices
  and dollar signs, "HAPPY BIRTHDAY MOM" in coloured letters. Clean letterforms, no extra marks. This matches ERNIE and Z-Image and beats Klein.
- **Photo: photoreal.** The fisherman portrait has real skin and eye detail; the perfume bottle and the cat kitchen read as photographs.
- **Pop culture: 5 of 6.** Darth Vader, Pikachu, Batman, Mario and Spider-Man drawn as themselves; "the Terminator" became an anime woman
  (the model does not know the name without more words; Boogu and ERNIE did better on that one in October).
- **Anime and cartoon:** key-visual quality anime; the cartoon fox and robot are clean flat illustrations.
- Adult and gore prompts: not refused (as the other models). Policy unchanged; see content-policy-2026-10-18.

**Streaming mode** (`--dit-mode stream`, same 22 prompts): mean 32.6 s, range 29 to 38 s. Pictures identical to the resident run (the
author's claim; spot-checked on t1 and k3).

**Peak memory, whole process tree** (`peakwatch.sh`, 0.5 s samples, one 1024 px picture): resident **19.7 GB** in 11 s; streaming
**1.8 GB** in 27 s. So Standard can run H3-Image on every computer size in streaming mode, and the Studio can keep it resident under
the 24.9 GB Standard cap at 13 s a picture.

**Edits** (same five as October, `--reference` with "Using <Picture 1>: ..."): 51, 41, 59, 48 and 32 s. My reading: e1 added the woman in a
yellow coat beside the man with the beach, the man and the light untouched; e4 rewrote the sign to "FRESH PIES DAILY" cleanly with the
street unchanged; e2, e3, e5 (remove a person, make it sunny) in the compare page for Jesse. Klein's edits in October took 20 to 28 s at
10 GB; Qwen-Image-Edit took 335 to 364 s at 39 GB.

### Video, 8-bit check (after Jesse's verdict on faces and lips)

| Clip | Build | Wall | Peak footprint | Max RSS |
|---|---|---|---|---|
| v4 | the v3 prompt again at 8-bit, 25 steps, no turbo adapter | 641 s (24.5 s a step) | 42.1 GB | 26.1 GB |

v4 as read from the frames: the same woman, steadier and more natural expressions than v3, no clipping visible on the sheet; the lips and the
words are Jesse's to judge against v3 (`video/out/v4.mp4`, sent 2026-11-15 evening). The cost of that quality is 3.4 times the time and
8 GB more memory than the turbo 4-bit clip.

To be filled by the runs: `data-scratch/minimax-eval/results.txt` (pictures), `edit/results.txt` (edits), `video/results.txt` (clips).
Compare page: `data-scratch/minimax-eval/compare-h3.html` (sent to Jesse 2026-11-15 evening). On Jesse's word the same evening ("add
MiniMax to the bakeoff") the H3 pictures and rows joined the October bakeoff set (`data-scratch/bakeoff/out/h3`, `results.txt`,
`compare.html` first column, `RESULTS.md`) and section 8 of [image-model-bakeoff-2026-10-25.md](image-model-bakeoff-2026-10-25.md).

**One family, two models, not one load.** H3-Image and H3 video are two separate 33B transformers (the picture one was trained on from the
video one with the sound layers removed), so serving both means two sets of weights: about 21 GB (pictures, INT8) and 25 GB (video, 4-bit).
What they share is the text encoder, Qwen3-VL-32B. Today the two Apple ports each download their own copy in a different format (27 GB
INT8 ConvRot for pictures, 32 GB MLX 8-bit for video), so nothing is shared yet. If both earn slots, the Stack can keep one encoder copy
and load it once for both, which saves about 27 GB of disk and one load of about 4 s; that is an integration task, not a property of
the models.

## 4. Verdict (my reading, 2026-11-15 evening; Jesse rules)

**Pictures: H3-Image earns a slot on the numbers and on my eye.** Text 5 of 5, photoreal photos, edits that keep the scene, 13 s a picture
resident at 19.7 GB or 33 s streaming at 1.8 GB, one model for new pictures, edits and references. Against the pass bars: it fits Standard
on every computer size (streaming), it is as good as Z-Image and ERNIE on text and better on photos, and its edits are at least as good as
Klein's. The pop-culture miss ("the Terminator") is the one weakness seen. Proposed, pending Jesse: H3-Image as the Standard and Boost
picture model (streaming on small computers, resident on the Studio) and as the edit model, replacing ERNIE, Z-Image and Klein in those
slots; Max becomes "H3-Image at 2048 or 4096 px" (to measure: about 57 s and 22 GB at 2048 px, 5 min and 7 GB at 4096 px by the author).
Disk 49 GB in place of 109 GB. Integration: a Stack `image-gen` family on the `h3-image-mlx` runtime (Apache-2.0 code), the INT8 weights
pinned and hashed, licence accepted in Settings (the MiniMax community licence, with its US application clause, shown as a fact).

**Video: promising, not yet a clear win.** At 4-bit with the turbo adapter (190 s, 34 GB, 5 s with sound at 864 by 480) Jesse found a
misspelt sign, a messed-up face and clipping lips; at 8-bit with 25 steps (641 s, 42 GB) the frames look right and the lips are his to
judge. If v4 passes his eye: H3 at 8-bit is a Boost candidate (42 GB, under the Boost cap once TIER-ROOM-01 lands, with sound and a bigger
frame than LTX-2.5 Boost at 46 GB) and the 4-bit turbo build a Standard candidate only if the faces hold on more prompts. Max (1344 by
768, 10 to 15 s) is unmeasured and needs a quiet window. Reference-to-video and shot chaining exist only as ComfyUI nodes in the port used.

**What this does to the audit's fix plan:** nothing in the queue or level fixes changes; the model slots they feed would change, and the
Standard video cap question from section 6 of the audit report goes away if H3 streaming or 4-bit earns Standard.

## 5. Owner ruling and build rows (2026-11-15)

Jesse, after watching the four clips and the compare page: "Yes, both." Clip 4 (8-bit, 25 steps) fixes the lips, and the pictures earn
the slot. His one condition on video (same evening): **"video is soft, needs upscaling or sharpening."** The open weights stop at 768 px on
the short side and MiniMax's own 2K step is hosted only, so the Stack's existing frame-by-frame upscale (Real-ESRGAN x4v3 through the
`media.edit` upscale op, the same tool the Picture editor uses) runs after every H3 clip as part of the job, to 1728 by 960 or 1920 by
1080, and the slot is judged on the upscaled clip. SeedVR2 (the "Best" clearer) on video is a separate bench if Real-ESRGAN is not enough. Rows for `docs/BACKLOG.md` (Stack first, then Home; no fix brief from the audit is needed before these):

- **H3-IMAGE-STACK-01 (Stack, M):** a `minimax-h3-image` family on the `h3-image-mlx` runtime (0.1.0a8 pinned, Apache-2.0 code; the
  INT8 ConvRot weights from `Comfy-Org/MiniMax-H3-Image` at `b8ebf14`, 49.3 GB, pinned and hashed), serving `/v1/images/generations` and
  `/v1/images/edits` (references in, up to 16), resident on p128 and streaming below it, measured peaks 19.7 GB and 1.8 GB, 6 steps, no
  CFG, licence shown and accepted in Settings before the download. Tier candidates: standard, boost, max (max at 2048 or 4096 px, to
  measure). Rules: one implementation for new pictures, edits and references; the three current families stay installed until Home's slots
  move (port before delete).
- **H3-VIDEO-STACK-01 (Stack, M):** a `minimax-h3` family on the yshenaw MLX port's command line (commit `55bb7dd`, Apache-2.0 code), the
  8-bit transformer (33 GB), the 8-bit Qwen3-VL-32B encoder subset (32 GB; one copy shared with the picture family when the formats are
  reconciled), 25 steps, 864 by 480, 5 s with stereo sound, measured 42.1 GB and 641 s; tier candidate boost (fits once TIER-ROOM-01 lands).
  The 4-bit turbo build is kept as a measured candidate (34 GB, 190 s) but takes no slot until faces hold on more prompts.
- **H3-SLOTS-HOME-01 (Home, S):** the picture Standard, Boost and edit slots point at the H3 family with `recommended` resolving to it on
  p128 and streaming on p16 to p64; the video Boost slot offers H3 8-bit beside LTX-2.5; the AI and models page names the model
  (OPTION-NAMES-02). Nothing is removed in this row.
- **H3-MAX-01 (Stack bench, S):** measure H3-Image at 2048 and 4096 px and H3 video at 1344 by 768 for 10 s on a quiet Studio window;
  fill the Max cells from the numbers.
- **H3-REFS-01 (Stack, M, after the above):** reference-to-video and shot chaining (the last 22 frames and the sound carried into the next
  shot), today ComfyUI nodes only in the port; the route for companions and the long-clip design.

Scratch kept for the build: `data-scratch/minimax-eval/` (venvs, 146 GB of weights, runners, clips, pictures).

## 6. The 24 GB streaming preset, measured (2026-11-16, after the "MiniMax at every tier" question)

Same kitchen-mom prompt, seed 7, 864 by 480, 5 s, turbo adapter, 5 steps, on the Studio with the live hub running beside it (load average about 10).

| Clip | Build | Wall | Peak footprint | Max RSS |
|---|---|---|---|---|
| v3 | 4-bit, resident | 178 s | 34.0 GB | 17.2 GB |
| v4 | 8-bit, 25 steps, no turbo adapter | 641 s | 42.1 GB | 26.1 GB |
| v5 | **24 GB Core4 stream2, offset streaming** | **170 s** | **14.8 GB** | 14.4 GB |

Streaming is not slower here: 170 s against 178 s resident, and the footprint is less than half. By the frames (v5 sheet) the same woman, steady glasses and
kitchen, open smile and mouth shapes across the clip with no visible clipping; the lips and face against v3 and v4 are Jesse's eye. So H3 video fits the 24.9 GB
Standard cap at 14.8 GB and can run as Reduced beside a Max job (62 GB Max plus 15 GB plus chat Reduced 5 GB fits 128 GB). Build cost: the preset is built
locally from the 40 GB BF16-pruned source (needs torch for the build step) into an 11 GB streaming bundle. Not measured: the same preset on a real 24 GB Mac,
and the GPU contention beside a running Max job.

Jesse's judgement of v5 (2026-11-16): the voice is a tiny bit robotic and the mouth has a tiny sign of tearing, "but not as bad as originally" (v3). So the 24
GB streaming preset is good enough for the Standard and Reduced video tiers, with the 8-bit build at Boost as the quality step up; the robotic voice is the
next thing to measure (the H3 audio path, and Chatterbox as a dubbing alternative, are the candidates).

## 7. Licence territory (found 2026-11-16, owner chose private testing)

Both MiniMax H3 licences (video and H3-Image, Community License) define "Excluded Territories" as the European Union, the United Kingdom, the Republic of Korea and the United States of America, and grant rights "solely within the Applicable Territory" (worldwide minus those). MiniMax grants a licence on request. Until MiniMax grants one or the owner decides otherwise in writing:

- H3 clips and pictures stay private (tailnet only), never published, never in releases, docs or marketing.
- H3 is not a default or recommended slot in a shipped product. H3-IMAGE-STACK-01 is already on the live household hub as the family picture model: a US use outside the licence that needs an owner decision (request a licence, or return to a model licensed for the US).
- H3-VIDEO-STACK-01, H3-SLOTS-HOME-01 and H3-MAX-01 carry the same flag.

## 8. Image bench: H3-Image against FLUX 3 Image Klein, with pop-culture characters (2026-11-16)

Owner ask: the same bench as the October picture bakeoff plus pop-culture characters, ten animated and ten live-action, side by side; speed and memory; the daily quick-picture default matters most. Same prompts and seed 7, 1024x1024. Prompt set: the 22 bakeoff prompts (18 used here: no adult or gore ones) plus 15 added (`data-scratch/flux3-bench/pop15.tsv`: Homer, Fred Flintstone, Mickey, SpongeBob, Bugs Bunny, Shrek, Elsa, Optimus Prime, Scooby-Doo; Iron Man, Indiana Jones, Jack Sparrow, a sitcom lead, a Star Trek captain, Frankenstein's monster). The earlier six pop prompts (the Terminator, Mario, Darth Vader, Spider-Man, Pikachu, Batman) were reused. Private contact sheets in `data-scratch/flux3-bench/sheets/`.

| | H3-Image (h3-image-mlx, INT8, resident) | FLUX 3 Image Klein (diffusers, MPS, bf16, 16 steps, no rewriter in the pipeline) |
|---|---|---|
| Speed | 9 to 11 s a picture | 15.9 to 25.2 s, average 18.8 s, plus 4.8 s average for the caption written by the hub's own chat model |
| Peak memory | 19.7 GB (resident; 1.8 GB streaming at about 33 s) | 34.4 GB process footprint on this generic route |
| Text | 5 of 5 right; a gibberish label on the perfume bottle | 5 of 5 right |
| Characters from words alone | Recognised: Homer, Mario, Pikachu, Mickey, SpongeBob, Bugs, Shrek, Elsa, Optimus Prime, Darth Vader, Spider-Man, Batman, Iron Man, Indiana Jones, Jack Sparrow, a sitcom lead, a Star Trek captain, Frankenstein's monster, a real Einstein. Missed: the Terminator (an anime girl), Fred Flintstone (a generic man in a car); Scooby-Doo weak | Recognised: Homer, Mario, Mickey, SpongeBob, Bugs, Elsa, Optimus Prime, Scooby-Doo, Darth Vader, Spider-Man, Batman, Iron Man, the Terminator, Indiana Jones (no likeness), Star Trek, Frankenstein's monster. Missed: Shrek (a brown ogre), Pikachu (a plush toy), Einstein (a generic man), Fred Flintstone |
| Look | rougher, varied | more polished and cinematic |

Notes. FLUX 3 Image Klein is a 5.6B transformer with a Qwen3-VL-4B encoder, distilled to 16 steps, gated on Hugging Face (accepted by the owner), the FLUX Kommunity licence. The README says to always run a prompt upsampler, a separate 9B model run before every picture; the hub's own chat model with the upsampler's published system prompt (`flux-3-image-klein-pup/system_prompts.json`, `t2i`) did that job in 2 to 6 s with no extra weights. The pipeline's built-in upsampler failed to load with transformers 5.23 (a config error), so the caption step was ours. The speed figures are a floor: they come from a generic route, not the dedicated MLX engines other projects publish (not yet measured here). Verdicts: H3-Image is the faster, leaner picture model and knows more of the characters people ask for; FLUX 3 Klein is more polished and as good at text, but needs a caption writer and missed several famous faces. Owner reaction: "9 to 11 seconds is super fast to me." Open: the quick-draft pass (FLUX.2 Klein 4B at 4 steps, the dedicated FLUX 3 MLX engine, H3-Image streaming on a small computer) and the slot decision (H3-SLOTS-HOME-01 for pictures).
