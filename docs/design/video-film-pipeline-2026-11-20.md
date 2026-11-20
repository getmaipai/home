# Video and film pipeline: one clip pipeline for LTX and H3, characters, films, swap, speed (2026-11-20)

Status: proposed, for the architect; no product code in this note's commit. Saves the design from the video proof of concept (POC) of
2026-11-19 and 2026-11-20 and several rounds of outside review. Owner ask (Jesse, 2026-11-20): "ok save the design and its details".
Where an earlier note in the repo and this one disagree, this one wins for the points listed in Supersedes.

**Five lines.**

1. An M5 Max Mac with 128 GB makes a postable HD clip with LTX 2.5 Max at native 1920x1088 in 6.5 to 8.1 minutes (74 GB peak). No enlargement step is needed.
2. Our clip path is the weak part, not the models: the H3 path runs the turbo adapter by default, a saved character reaches a clip as one raw photo, nothing records what a job really ran, and a film cut once lost all its speech and nothing checked.
3. The fix is one generic clip request (typed roles, structured dialogue, explicit intent), a capability row and profile per pack, a planner in the Stack, and a receipt on every job. LTX works alone; H3 is an optional pack.
4. A film is approved once as a timed storyboard with voices, rendered riskiest shots first, repaired within a bound, and checked as a finished file before it is called done.
5. Face-only swap failed the owner's likeness bar ("awful"); whole-head swap cannot carry the new head yet; the old compositor fails its own preservation check. Swap stays an open experiment.

Numbers are as of 2026-11-20. Three test runs were still going when this was written; section 13 lists what is coming.
H3 is an optional Stack pack: not a default and not a recommended slot. Its licence territory is recorded in [minimax-h3-eval-2026-11-15.md](minimax-h3-eval-2026-11-15.md) section 7 and is not repeated here. Every "postable" verdict below is about LTX.

Related notes this fits and does not duplicate: [model-packs-2026-11-17.md](model-packs-2026-11-17.md) (the Stack knows each model, Home asks generic jobs; this note adds the clip job's shape),
[make-film-2026-11-06.md](make-film-2026-11-06.md), [video-create-2026-11-01.md](video-create-2026-11-01.md), [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md),
[h3-tier-slots-2026-11-16.md](h3-tier-slots-2026-11-16.md), [h3-character-sheet-2026-11-16.md](h3-character-sheet-2026-11-16.md), [h3-swap-2026-11-16.md](h3-swap-2026-11-16.md),
[swap-composite-lessons-2026-11-17.md](swap-composite-lessons-2026-11-17.md), [long-clips-2026-11-09.md](long-clips-2026-11-09.md), [creatoros-port-2026-11-13.md](creatoros-port-2026-11-13.md),
[disk-guard-2026-11-19.md](disk-guard-2026-11-19.md), and [RULES.md](RULES.md) (the authority).

## Supersedes

- [h3-character-sheet-2026-11-16.md](h3-character-sheet-2026-11-16.md): its eight-panel H3 sheet stays a candidate maker, not the answer. The character becomes a reference set of separate full-size views (section 5); the sheet maker is chosen by the bake-off in section 11 (VF-EVAL-01).
- [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md): Boost stays the fast default for ordinary clips, but Max at native HD becomes a named quality profile the hub must be able to run (section 4), and the Max memory figure there (about 69 GB) is replaced by the measured 74 GB peak at 1920x1088.
- [h3-tier-slots-2026-11-16.md](h3-tier-slots-2026-11-16.md): the turbo adapter is no longer a default; it is an explicit preview profile (section 6.2).
- [make-film-2026-11-06.md](make-film-2026-11-06.md): the film flow gains the voiced storyboard, the shared look, bounded repair and the finished-file checks (section 7); its shot plan, cast and assembly stages stand. FILM-ANIMATIC-01 is extended, not replaced.
- [h3-swap-2026-11-16.md](h3-swap-2026-11-16.md) and [swap-composite-lessons-2026-11-17.md](swap-composite-lessons-2026-11-17.md): the preservation check and target selection are replaced as in section 8; the principle (footage is never regenerated) stands.
- Not superseded: the model pack record, the generic jobs and "Home names no model" in the model packs note; this note is the clip job's shape inside them.

## Reuse check

Searched 2026-11-20 in Home and Stack (names tried: receipt, profile, capability, planner, role, reference set, storyboard, animatic, take, retake, enhance, check, preserve, swap).
Extended, not duplicated: the model pack record and generic jobs (MODELPACK-SPEC-01, -STACK-01, -JOBS-01, -SWAP-01, -SHEET-01, -HOME-01 to -03, rows listed in section 11 of the model packs note); the Stack's job queue, heavy gate and admission (`lib/jobs.ts`, `lib/heavyGate.ts`) and disk admission (DISK-GUARD-02);
`video/videoGen.ts` (`VIDEO_SPECS`), `video/ltx25.ts` (size table), `video/h3.ts` (`H3_VIDEO_CAPABILITIES`), `video/jobs.ts` (finish step), `video/ltx25Edit.ts` (extend, retake), `clip_from_sheet`; Home `lib/videos/tool.ts`, `lib/films/plan.ts`, `films/sheetMaker.ts`, `films/referenceFirstFrame.ts`, `castLook.ts`, `resolveCast`;
the existing rows FILM-ANIMATIC-01 (animatic), FILM-GRADE-01, VIDEO-TAKES-01 and CREATOR-10 (take scoring and face match), CREATOR-25 (shot card and takes), CREATOR-01 (locked sentence), H3-REFS-01, H3-ONE-RUNTIME-01, H3-SHEET-STACK-01 / -HOME-01 / -BENCH-01, H3-SWAP-STACK-01, CREATOR-57-LIVE-01, FILM-UPSCALE-01 (done), VIDEO-MASK-01 (done).
New: the typed clip request, capability rows, the job receipt, the planner, the finished-file checker, the voiced storyboard, the reference-set approval and the repaired swap check. Nothing here adds a second queue, store or model table.

## 1. Evidence (POC, 2026-11-19 and 2026-11-20)

Sources: the POC results of 2026-11-19 and 2026-11-20 (video, swap and H3 speed tests), the owner's ratings of about 250 H3 clips (recomputed 2026-11-19), and the Stack at `f5a696b`. One fictional adult character, seeds 1101 to 1103 and 2101, one job at a time on one Mac. Sound checked by loudness and by the Stack's speech-to-text.

### 1.1 What each recipe cost and looked like

| Recipe | Native size | Wall | Peak memory | Words | Result |
|---|---|---|---|---|---|
| H3 FL2VA 8-bit, turbo adapter, 7 steps (6 ran) | 864x480 | 3.9 min | 45 GB footprint | exact ("Please put the blue mug back.") | Face and freckles hold; soft; quiet sound |
| H3 FL2VA 8-bit, no adapter, 24 steps | 864x480 | 13.0 min | 43 GB | exact | A little cleaner than turbo; nearly the same motion |
| LTX 2.5 Boost (Stack, q8) | 768x448 | 1.2 min | about 22 GB | exact | Owner: "had the best performance". One eye-squeeze glitch |
| LTX 2.5 Max bf16 | 1024x576 | 1.6 min (95 to 195 s under load) | 49 GB | exact | Owner: "a little soft"; face drifts in a medium shot |
| LTX 2.5 Max bf16 plus detail pass (DFR) | 1024x576 | 3.3 min | 71 GB | exact | Skin much sharper; a new take, not the same performance; 1.2x time |
| LTX 2.5 Max bf16 | 1280x704 | 2.4 min | 55 GB | exact | |
| LTX 2.5 Max bf16 | 1536x832 | 3.6 min | 61 GB | exact | |
| **LTX 2.5 Max bf16** | **1920x1088** | **8.1 min** (6.5 to 8.1) | **74 GB** | exact | Owner: "that looks great", then with a light sharpen "really good, acceptable - not tack sharp but I'd still post it" |
| LTX 2.5 Max bf16 plus DFR and 2x upscale | 2048x1152 | 9.1 min | 71 GB | exact | One eyes-closed run (face score 0.02) |
| H3 FL2VA, 8-step 768p adapter, Metal engine (vpipe) | 1344x768 | 13.7 min (14.7 without the model preloaded) | not logged | exact | Owner: "teeth are better, sharpness is the same as ltx" |
| Same, 4-step adapter | 1344x768 | 8.0 min (8.0 preloaded) | not logged | exact | Same mouth words; quality not yet rated |
| H3 FL2VA, h3.c engine, exact mode, 12 steps | 864x480 | 4.6 min (277 s) | not logged | not yet checked | Run by the H3 speed test; recorded in its clip receipt only, so ratings are pending |
| H3 singularity Ref2VA, 20 steps, one face and one body reference | 864x480, medium shot | 26.6 min | 38 GB | exact | Real walk and turn; face by SFace 0.54 at 103 px |
| H3 FL2VA 24 steps, first frame at 1088x608 | 1088x608 | 20.1 min | 47 GB | exact | No better than 864x480 (1.7x cost, no gain) |

Resolution and speed, LTX against H3: at 1344 to 1920 wide LTX Max takes 8.1 min at 1920x1088; H3 takes 13.7 min at 1344x768 with an 8-step adapter. The owner rated their sharpness equal and H3's teeth better. H3 costs more per pixel and has not matched LTX Boost's 1.2 min at any size. Loading H3 into memory first saved little (90 s a step against 94).

Where H3's time goes (864x480, 5 s): turbo 7 steps 235 s total = 179 s denoise (about 26 to 30 s a step) + 42 s decode + 14 s other; plain 24 steps 779 s = 716 + 42 + 21. Decode plus overhead is a 56 to 63 s floor before any step. The owner's earlier ratings put the turbo recipe at 1.8 to 2.2 stars against 4.0 for 20 to 24 steps, but the POC found the 24-step clip nearly the same as turbo on a good start picture (one clip; sound not rated). That tension is open (section 13).

### 1.2 Face identity by recipe (SFace cosine against the reference, median over frames; about 0.3 or more is the same person)

| Shot | Recipe | Face height | Median | Min |
|---|---|---|---|---|
| Close-up | H3 turbo / H3 24 steps | 365 / 369 px | 0.65 / 0.64 | 0.59 / 0.58 |
| Close-up | LTX Boost / LTX Max | 337 / 432 px | 0.61 / 0.64 | 0.48 / 0.47 |
| Close-up | LTX Max 1920x1088 | not logged | 0.51 | 0.30 |
| Medium | LTX Boost (first frame) | 114 px | 0.28 | 0.05 |
| Medium | H3 24 steps (first frame) | 122 px | 0.34 | 0.27 |
| Medium | LTX Max / LTX Max + DFR | 196 / 200 px | 0.27 / 0.30 | 0.16 / 0.15 |
| Medium | **H3 Ref2VA, face and body references** | 103 px | **0.54** | 0.45 |

Reading: close-ups hold on every recipe (0.6 and up). In medium shots every first-frame route scored 0.27 to 0.35 and the reference route 0.54, so references earn their 26 minutes when identity in medium shots matters. Faces under about 120 px give weak scores for everyone, and the face height of about 100 px was the measured warning level.

### 1.3 Failures and their causes

| Failure | Cause (confirmed unless marked) | Where it goes |
|---|---|---|
| Film A (all LTX) had no speech, repeated footsteps, looked like different camera crews, teeth problems (owner) | One `loudnorm` over six audio inputs in a single ffmpeg graph made every shot carry the first shot's audio (correlation 0.999 between shots). Only the parts were checked; the speech-to-text returned empty on the final file and was blamed on length. Silent shots had a -53 to -71 dB floor that loudness leveling raised to speech level. Crews and footsteps: independent stills and independent voices per shot (inference, not tested) | Finished-file checks (7.7); one room tone bed per location (7.5) |
| H3 opens every clip with a noise burst and a small mouth movement in the first 130 ms | Found by the owner ("her lips move with that odd sound"); in every engine; no official fix. Our start picture had parted lips and our prompt did not follow H3's official format | Start pictures with closed lips for speaking shots; trim or cover the first four frames at 24 fps; H3 prompt grammar (6.3) |
| Teeth merge on wide-open mouths | At every LTX size and on H3 at 1088x608 in a medium shot; close-ups with calm delivery are clean on every recipe. The detail pass neither fixes nor causes it. All three seeds of the original prompt had a wide-open stretch; "speaks quietly, lips parting only slightly" cut it to one small stretch in one take (one take: not proof). Refine Details could not be run (the adapter's repo is gated behind accepting its model terms) | Close-ups for speech; the wording above; a mouth check per take (7.6); no automatic mouth repair |
| Identity in medium shots | Face under 120 px; first-frame routes score 0.27 to 0.35 | Reference route on a capable pack (6); close-ups for faces |
| The live Stack cancelled LTX Max three times | Memory governor, "too busy", at 9 percent, 9 percent and 12 percent (2026-11-19). Max needs 49 to 74 GB peak, above what the governor left free. Not proven whether another job was running | Open (section 13); the hub must be able to admit Max HD (VF-PROFILE-01) |
| The old swap compositor fails its own check | Its mask covers about 48 percent of a two-person dialogue clip (a color rule tuned to one clip) and the check grades the mask against itself. Repaired independent check: 41,694 persistent changed pixels (largest blob 15,877) outside the true face region; 51,723 as written; 10.6 percent of pixels changed outside the region on the dialogue clip | Section 8 |
| Face-only swap fails likeness | Passes every preservation check and swaps the right person, but the swapper rewrites only the inner-face template (brows to chin); hair, hairline, beard and head shape stay the actor's, so it reads as a third person. Owner: "faceswap is awful" (2026-11-20). Models, boost sizes and face restore changed nothing | Section 8 |
| Head-swap adapter reverts within 5 frames | The LTX head-swap adapter fed a good anchor still: frame 0 carries the anchor, frame 5 scores -0.07, then about 0 to the end; the guide video's own head wins. The paste-back worked (0 pixels outside the region); the result is nearly the original again | Section 8; V3 mode not yet run |
| An earlier POC run used an empty prompt | A script changed folder before reading its prompt file; discarded and rerun | Receipt records prompt bytes (3.4) |

### 1.4 Teeth, finish and sound facts that shaped the decisions

- Finish test on the 1920x1088 clip: a light sharpen (unsharp 5:5:0.4) or a contrast-adaptive sharpen at 0.3 is a hair crisper with no ringing; enlargements to 2560, 2880 and 3840 wide add no detail, only file size (6 MB per 5 s native with sharpen, 9.5 MB at 2560x1440).
- The owner's earlier ratings of after-steps (H3, 864x480): 1.5x lanczos with light sharpen 3.4 (15 clips); Real-ESRGAN 2x 3.0 (what ships); SeedVR2 pure 1.5, mixed 2.3; 48 fps interpolation 2.2. No after-step lifted a clip more than about half a star.
- The owner rated H3 turbo clips at 8 steps or fewer as robotic in voice (ratings of 2026-11-19); LTX 8-bit speech is muffled against bf16.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | HD recipe: LTX 2.5 Max bf16 native 1920x1088, crop four rows top and bottom to 1920x1080, light luma sharpen (or contrast-adaptive sharpen 0.3), crf 15 for the upload copy | Owner called it postable; sharpen adds what enlargement cannot |
| D2 | No enlargement at 1920 width. A 2560x1440 upload copy is an owner choice, never a detail claim | The owner could not tell native with sharpen from the 1.5x version; enlargements add no detail |
| D3 | Retire SeedVR2 and frame interpolation from the video path; keep one cheap finish | Rated down (1.5 and 2.2 stars) |
| D4 | No draft mode (a fast preview clip followed by a new final take). A kept Boost clip already is a final; approving a preview cannot promise a later render. "Keep" and "Another take" do that job. Stills drafts inside Films stay (Films only) | outside review, 2026-11-19; the POC's 71 s Boost takes agree |
| D5 | "Enhance this take" (Refine Details on a kept clip, original kept) ships only if its test passes (section 9) | Unverified here; the repo is gated |
| D6 | ComfyUI is not adopted on the Mac. It stays a Stack-owned engine for images. What would change that: a measured matched run of a Mac Comfy graph against our runner on equal inputs that is not slower than our MLX runner and loads the INT8/NVFP4 weights correctly on this chip; or an NVIDIA machine (24 to 32 GB) that the owner chooses to add | The workflows worth importing rely on NVIDIA-only parts; Mac nodes cover one generator node; every Mac report found was 12 to 90 minutes |
| D7 | One reference picture per character to start (a sharp face, plus a full-body or outfit picture only when it measurably fixes a failure) | A reference costs 19.5 min for one photo and 59.1 min for three on a published Mac run; ours cost 26.6 min |
| D8 | Models are not mixed inside one film until each works alone. Film A and B each used one family per shot type; mixing waits for a test | Different looks per shot were part of the "different crews" failure |
| D9 | LTX Max is the house camera; H3 is a specialist for a visible speaking close-up if its mouth wins in the actual edit; Boost stays the fast default for casual clips | Evidence in 1.1 and 1.2; LTX-only install must do the whole workflow |
| D10 | The turbo adapter is an explicit preview profile. A file on disk never selects quality | Today it switches on by itself when its file exists (a defect) |
| D11 | Face-only swap first and only after its check is repaired; whole-head swap and fast-H3 as products are held until each wins a test | Section 8, section 10 |

## 3. The clip pipeline (one for LTX and H3)

Principle: save the shot, the cast and the approval once; render per engine. Home names no model, steps, checkpoint or adapter (model packs note). The Stack decides how a pack's model is driven. All changes are additive; job ids, polling, permissions, cancel and queue accounting keep working.

### 3.1 What Home sends

| Field | Meaning |
|---|---|
| words | The shot description |
| dialogue | Structured lines: speaker, text, optional timing; never free text inside the words |
| inputs, each with a role | `start`, `end`, `identity`, `wardrobe`, `voice_reference`, `edit_source`. Roles are typed and optional. Old jobs with `image` and `end_image` still mean endpoints; identity is never inferred from an old image |
| intent | "open exactly on this picture" or "this person, new shot" |
| profile | `preview` or `quality` |
| operation | `new`, `retake_from`, `extend`, `enhance` |

Home owns cast access, age and audience rules and face checks. The Stack owns checkpoint, adapter, prompt rendering, runner arguments, sizes and admission.
Approved cast views are stored once, versioned and role-tagged; derivatives (an LTX sheet, a composed first picture) are made from them; a new approval invalidates future derivatives, and a queued take keeps the inputs it was approved with.

### 3.2 What a pack declares

Typed fields the code reads (no prose-only recipes; a pack note the code ignores is a defect):

| Field | LTX 2.5 | H3 (optional pack) |
|---|---|---|
| Profiles | preview: Standard (512x256); quality: Boost 768x448, Max 1024x576 up to 1920x1088, two-stage | preview: turbo adapter with its own schedule (1000, 750, 500, 250, 100, 40, 0 for the Pika adapter); quality: FL2VA 24 steps, Ref2VA 20 steps |
| Identity routes | first frame for real faces; Ingredients sheet for fictional characters and objects (Max only, 768x448 landscape, 4 to 8 s, one or two sheets) | separate reference pictures (up to 9, `<Picture N>` labels) and first frame |
| Start picture with references | not applicable | to be tested; refused plainly until a full job passes |
| Prompt grammar | one flowing paragraph of 4 to 8 sentences; dialogue in quotes | sectioned format; `<d>` dialogue tags with speaker ids; six sections for Ref2VA |
| Negations | none; rewrite as positive scene words | none (H3 has no negative prompt; "no X" pulls X into frame) |
| Native detail pass | DFR detail pass (1.2x time; chosen before generation) | experimental refiner, unadvertised |
| Continuity | cuts inside one prompt (2 to 4), extend and retake on Max | tail of the last shot as a video reference |
| Sound | bf16 for speech; audio-to-video exists upstream (unverified here) | quiet first second needs gating; its voice reference steers timbre, it does not copy the recording |
| Finish | light sharpen, native file kept | same |

### 3.3 Capability rows, planner, admission

- **Capability rows.** One row per operation and profile: allowed input combinations and counts, sizes, seconds, orientation, sound behavior, required files, measured memory. Built from the validators and measured tables that exist. Home filters what it offers; the Stack revalidates. An explicit model choice is honored; nothing is downgraded in silence (an unsupported request gets a plain reason before any expensive work).
- **Planner (Stack).** For "this person, new shot": if the pack has a reference route, send the approved views with their roles; if not, build the first frame with the picture model from the cast views (the route of `referenceFirstFrame.ts`, with its face gate), then animate it. The route is per task and measured, not a universal default: a fictional character on LTX tries the Ingredients sheet first; a real adult uses a composed first picture and the face check. A picture the person attached is the opening frame, full stop; a referenced cast alongside it needs a tested combination, and a cast is never dropped or their photo replaced in silence.
- **Plan first.** Today Home turns a saved character into a start picture (`references[0]`, `videos/tool.ts` 221 to 237) before it picks the model (268 to 281), which loses the difference between "who appears" and "what frame zero looks like". The plan comes first; a picture is derived only if the chosen route needs it.
- **Three kinds of again.** Another take (a new full render), retake from a time (keep the start; Max), extend (continue). Rerunning the same seed at a larger size is a new take on both models.
- **Sound, three controls.** Generated sound, a reference voice, and kept source audio are separate. A model that speaks does not prove voice-reference support.
- **Admission.** Reuses the heavy gate, the governor and disk admission (DISK-GUARD-02). Max HD needs 74 GB; the hub's governor must be able to admit it or refuse it with a plain reason (VF-PROFILE-01).

### 3.4 The receipt

One record per job, the same for every run, written by the Stack: revisions, mode, weights, real steps and schedule, adapter hash and strength, input roles and files, size, frames, seed, prompt bytes, phase times, peak memory, finish status, and a probe of the delivered file (real width, height, frames, audio present). It tells Ingredients apart from other adapter jobs. Native and finished files are both kept. Today the finish step overwrites the native clip, the LTX file is rewritten in place, and width and height come from the generator, so two "ready" jobs can hold different finishes (`video/jobs.ts` 173 to 187).

### 3.5 Rules

1. Plan before deriving a start picture.
2. Never drop a control in silence.
3. An LTX-only install does its whole workflow with H3 never installed; each engine ships and is verified on its own.
4. One prompt per engine from the same shot; never copy H3 speaker tags, steps or the turbo adapter into LTX.
5. The native file is kept; a failed finish leaves the original.
6. Existing ids, polling, permissions, cancel and queue keep working; a retry or cancel cannot overwrite a first take.
7. Home never writes "no X" for H3; a negation sent to an engine without one is rejected, not dropped.

## 4. Today's clip path, traced (`origin/main`; the live hub may differ)

| Item | Today | Fix |
|---|---|---|
| H3 checkpoint, steps | FL2VA through the yshenaw port; 7 steps when the turbo adapter file exists, else 12 | Profiles (3.2, VF-PROFILE-01) |
| H3 size | 864x480 or 480x864 only | Pack numbers |
| H3 reference pictures for clips | not possible (`reference_pictures: false`); `VIDEO_SPECS.h3` says no image input while `H3_KEYFRAMES` says first and last work | One capability row (VF-CAPS-01) |
| Saved character into a clip | its first raw reference photo as the start picture, plus look words; the sheet is stored last, so never the one sent | Reference set and roles (section 5) |
| Pack notes | the H3 pack says 24 steps, 1.5x lanczos, an audio chain; the code does 7 or 12, Real-ESRGAN 2x, no chain | Implement or delete (VF-PROFILE-01) |
| Runtimes | clips on the yshenaw port; swap and sheets on the mere.run fork with different weights | H3-ONE-RUNTIME-01 |
| Negative prompt | accepted and silently dropped | Rule 7 |
| LTX | two-stage 8 + 3 steps matches the maker; sizes Standard 512x256 (10 s), Boost 768x448 (5 s), Max 1024x576 (10 s); LoRAs fused on Max only; extend and retake Max only; sheet adapter Max only | Add native HD Max profile, detail pass profile |
| Finish | H3: Real-ESRGAN 2x then lanczos to 1728x960; LTX: file rewritten in place | One cheap finisher per pack and operation (VF-FINISH-01) |
| Shot to shot | each still and clip made on its own | Section 7 |

## 5. Characters and locations

### 5.1 The reference set

A character is a reference set, not one composite: a sharp face close-up, a full-body front in the outfit, and a side or three-quarter view only when a planned turn needs it, each at full size. The composite sheet stays as the picture the person sees. One face photo establishes a likeness; wardrobe, body and the unseen side of the head may be creative guesses, shown together as a "Proposed look" with the original photo kept. Only the extra views the shot list needs are generated; each drawn view passes the face check (SFace 0.4 or more) or is dropped. A face score cannot verify an invented outfit or profile. Real people keep the rule: pixels from their own photos, minors never sheeted.

Once approved, the look is stored once and each engine gets what it can use: separate views for a reference-capable H3 route, an Ingredients sheet (generated in LTX's exact layout, 768x448) for an eligible fictional LTX character, a composed opening still for the LTX real-person route. The locked sentence is written by a vision model from the approved views. A wardrobe sentence per character is repeated word for word in every picture prompt.

Mechanism evidence: LTX does not keep a real face from a sheet (face match 0.02 to 0.22 against 0.36 for the same person, measured 2026-11-12); a sheet face is about 100 px, and a 200 px face gives a good likeness in our swap work. A square H3 sheet is not a drop-in for LTX's landscape Ingredients layout.

### 5.2 Which user action reaches which path today

| User action | Path | What carries the character |
|---|---|---|
| Clip with a saved character (chat `generate_video`) | ordinary clip | the first reference photo as the start picture, plus look words |
| Films: a shot with a saved character | still, then clip | the first reference photo into the still |
| "Make a video from pictures", fictional or object | LTX Ingredients, Max | a sheet built from the attached pictures at request time |
| The same with a real person | LTX first-frame route | a composed first picture, face-checked |
| "Capture the look" / "Save as a character" | none | makes and stores a sheet that no path above reads |

Four sheet makers exist; only Home's `films/sheetMaker.ts` is wired, and it follows the LTX layout (768x448 composite). The Stack `character_sheet` job (eight pictures) has no Home caller; the H3 eight-panel sheet is proposed only (1,091 s and 35 GB for five frozen frames at 1024x1024, with invented clothing).

### 5.3 Gaps and target

| Gap | Target |
|---|---|
| The sheet never reaches video | Clip job takes the approved reference set with roles (VF-CAST-01, VF-PLAN-01) |
| One small composite | Store separate full-size views; keep the composite for display |
| Stale sheet never rebuilt; film capture failure swallowed | Rebuild when photos change and ask again; show the failure on the film card |
| Locked sentence is typed words | Vision model writes it from the approved views |
| No check after the clip | Face check against the set, one retake, plain note if it still fails (CREATOR-10 scores the take) |
| Locations: none | Section 7.3 |

## 6. Per-engine rendering

### 6.1 Prompts

Hand-written prompts in each official grammar first, as golden fixtures; the local rewriter (official guides as its system prompt) is compared against them before it is switched on (VF-PROMPT-01). LTX: one flowing paragraph, 4 to 8 sentences, motion, camera and audio with a start image. H3: sectioned format, dialogue in `<d>` tags, no negations. H3's start-of-clip defect gets a quiet lead-in in the prompt and the picture/audio trim of section 7.5.

### 6.2 Profiles

| Profile | LTX | H3 |
|---|---|---|
| Preview | Boost 768x448, 1.2 min | turbo adapter at its own schedule; a "fast H3" profile only if a test shows 120 s or less and within half a star of the 24-step clip on face, mouth and speech |
| Quality | Max bf16 1920x1088, 6.5 to 8.1 min, 74 GB; DFR detail pass for detail-sensitive shots | FL2VA 24 steps 864x480 (13.0 min) or 768p with an 8-step adapter (13.7 min); Ref2VA only for identity in medium shots |

### 6.3 Finish and sound

Native against 1.5x lanczos with light sharpen against the current Real-ESRGAN finish, same source and display size, paired; then one finisher per pack and operation. Native 1920x1088 is conformed to 1920x1080 by cropping four rows top and bottom; H3's 1344x768 is cropped to 1344x756 and resized once to 1920x1080. Keep the source frame rate (24 fps for a film). Silent shots get a real room tone bed, not a leveled noise floor.

## 7. Films

### 7.1 Approval flow

The person gives as little as they like (a sentence, a photo). The product fills in the rest, shows what it filled in, and asks only where a wrong guess is expensive. Nothing the person supplied is replaced in silence. Every filled-in piece is shown and editable (look paragraph, wardrobe sentence, floor plan, shot list).

1. **The timed storyboard with voices** is the one main approval before rendering: the start pictures played in order at real lengths with the recorded line readings and room sound. The person talks back to it ("make the kitchen less fancy", "use the first reading", "that reverse angle looks wrong"). It extends FILM-ANIMATIC-01.
2. **"Save this look"** is a separate approval for a new recurring character.
3. **Final review**: accept the film or revise a shot.

Order: script, approved line readings, shot list and floor plan, reference plates and cast, timed still edit with the actual dialogue, the riskiest two clips, the remaining clips, the final picture and sound check. Render the speaking close-up and the doorway medium first, since they expose the two most expensive uncertainties. The storyboard shows the estimated render time beside "Render film" (six native LTX shots are 39 to 48 minutes for first takes alone), so approval covers the real cost.

The product asks the person for: whose face may be used (existing cast and age rules), the first approval of a real person's reference set, anything that would replace a picture they attached, and a wait longer than a stated number of minutes.

### 7.2 What the product fills in

| The person gives | The product does | Approved in |
|---|---|---|
| A sentence | Script, shots with one observable beat each, framing so faces are large when someone speaks, lengths, cutaways for actions the models do badly | the storyboard |
| No setting detail | Builds only the scenery the camera sees (7.3) | the storyboard |
| No style | One look paragraph (time of day, light, lens feel, colors, texture) repeated word for word in every start picture; the porch may be cooler than the kitchen | seen in the start pictures |
| One face photo or a made-up character | The reference set and Proposed look (5.1) | "Save this look" |
| Nothing about voices | One voice per character, every line recorded once, those recordings used for every shot | the storyboard |
| Nothing about sound | One room sound under each location; footsteps, knocks, clicks as independent cues; bridges across cuts | the storyboard |
| Nothing | A start picture for every shot from the location, cast and look; closed lips for speaking shots | the storyboard |
| Nothing | Chooses the engine and recipe per shot (the planner), writes the engine's own prompt | none; it says which engine it used |
| Nothing | Renders riskiest shots first; checks and repairs (7.6); matches exposure and color; sharpens; crops; real-text titles and credits; mixes; exports | final review |

### 7.3 Location and look rules

- **Build only the scenery the camera sees.** One kitchen close-up needs one location plate. A two-person conversation with a reverse is when the far wall, a simple overhead floor plan and positions get made. "We fill in the details" must not become minutes of invisible work on a room nobody sees.
- A location is a clean wide plate, a simple overhead sketch and one approved reverse plate if the edit reveals the other wall. Keep both singles on the same side of the line between two characters. A crop of a wide spends resolution; make a close-up from its own sharp face reference plus the approved background plate. Hard cuts return to clean plates, which avoids carrying accumulated drift.
- The still maker fixes physical light, palette, framing, skin and costume; the video model gets that image plus only the motion, performance and essential continuity cues; the edit matches exposure and color to an approved hero frame, then one restrained film-wide treatment. Describe light relative to the actor ("sink-side cheek"), not "from screen left".

### 7.4 Shot design rules

Each shot has one observable beat: the wide for geography, the medium for posture or a short stop, the close for the emotional choice, inserts for evidence. Do not ask LTX to orbit an actor while inventing the unseen half of a room, and do not rely on H3 for crossing a room (it under-acts there; B2 barely walked). Preserve screen direction. For handling an object, show the reach beginning, cut to the observer, play the click, then show the changed state. Spoken shots are close-ups or medium close-ups with a target face of 160 to 200 px or more in the native frame (100 px is the measured warning level; the upper range is a proposed margin, not a model specification), and use the "speaks quietly, lips parting only slightly" delivery wording. Do not put tooth anatomy in prompts. An open-mouth shout or laugh is carried in sound with a cutaway to the listener.

### 7.5 Sound and edit

- One voice per character and one sound world per location. Record or synthesize the lines in one directed session (same voice, pacing, perspective, pronunciation); keep clean line files and a continuous dialogue edit independent of the video tracks. Drive visible speaking shots with the approved audio when the backend supports it (LTX audio-to-video is documented upstream, unverified here). If H3 only matches its own audio, approve that take's line as the master if the voice fits, move the line off camera, or use LTX audio-driven coverage. Overlaying a new recording on incompatible lips is not a repair.
- A continuous room bed under all shots of one room; bridge between rooms (J-cuts and L-cuts); short fades at waveform discontinuities; voice centered; mono and phone audibility checked. Start without music.
- H3's 130 ms start defect: at 24 fps three frames cover 125 ms, four cover about 167 ms. Cover the first four frames with the preceding picture while the dialogue or room bed plays, or trim four picture frames plus the generated audio. Never trim speech onset or offset the remaining lips.
- Straight cuts between shots; a dissolve only for a lapse of time; titles and credits as real text; export an editing master (intra-frame, PCM) plus an upload copy (H.264 High, 4:2:0, BT.709, AAC-LC 48 kHz, color tags correct; 8 Mb/s for 1080p SDR).
- Effects worth shipping: per-shot exposure and white balance match, small crop, adjustable luma sharpen with bypass, audio fades and level automation, held stills, simple masked exposure changes. Skip skin smoothing, per-frame face enhancement, a LUT per scene, global interpolation and transition packs.

### 7.6 Checks, repair, local edits

**Checks on each clip:** the spoken words heard back against the script; the face against the reference set; the mouth for merged teeth; the first frames for an opening blip; the face height; first, middle and last usable frame (a first frame alone cannot qualify a take). A face under about 120 px is flagged, not scored.

**Bounded repair rule.** Match the repair to the fault: a missing line in the exported mix is a remix; a noise burst in a silent lead-in is a trim; a wrong spoken line is a new take; an uncertain teeth or likeness check flags the moment for review. One automatic generation retry per shot, then show the best take and the remaining issue. A retake is prompted when a take has wide-open or merged-teeth frames or a face median under about 0.45.

**Edits are local and predictable.** Change the porch light and only the porch shot regenerates. Change one line and its audio updates, plus any visible speaking performance that depends on it. The kitchen and the other accepted performances stay.

### 7.7 Finished-file checks

Before a film is called done, on the exported file, not the parts: every scripted line is heard once, at its time (speech-to-text shot by shot, never skipped because the file is "too long"; an empty result is a failure); no shot shares another shot's audio (waveform correlation between shots); the picture is not frozen or black; size, length and frame rate are what was asked; a nonempty audio stream alone is not a pass.

Three deliberate-break tests of the checker: mute one line; copy another shot's audio into its place; freeze a shot that calls for motion. It must catch all three, and it must PASS an intentionally held still (a porch lamp that comes on and holds). That is why the exporter needs the approved shot list and dialogue timings as its reference, not just the file. Normalize each shot's audio in its own call, then join; never one shared filter graph.

### 7.8 Status per capability (2026-11-20)

| Capability | Status |
|---|---|
| Plan shots from a sentence | works from Films (without the framing rules) |
| Start pictures per shot ("Draft all") | works from Films |
| Titles and credits as real text, transitions, mixing ops | works from Films |
| Retake from a point, extend | engine supports it; Films does not use it |
| Reuse a sheet for a fictional character (Ingredients) | engine supports it; Films does not use it |
| First-frame composition with a face check for real people | engine supports it; Films does not use it (chat tool only) |
| Audio-to-video against an approved line | engine supports it upstream, unverified here; still to build |
| Enhance a take (Refine Details) | engine supports it upstream, being tested; still to build |
| Timed storyboard with voices | still to build |
| Location plates, floor plan, shared look paragraph, wardrobe lock | still to build |
| One voice per character | still to build |
| Per-engine prompt writer and planner | still to build |
| Checks after each clip, bounded repair, finished-file checks | still to build |
| Local, predictable edits | still to build |

## 8. Face swap

Review of the compositor (Stack `f5a696b`, `composite_swap_worker.py`): the contract (generated clip is a donor, footage never regenerated, report out) is right; the engine room is not.

| # | Finding | Effect |
|---|---|---|
| 1 | The head mask is a color rule tuned to one clip; no head segmentation | A beige room, other actors, darker skin or a red shirt break it |
| 2 | "Which person" is the largest warm blob; nothing tracks the target | The wrong actor or the wall can be chosen |
| 3 | Occlusion is handled only where the occluder differs in color from skin | A hand, phone or hair across the face is not an occluder |
| 4 | No landmark alignment of donor to original | Doubled jaws and edges |
| 5 | Haar cascade face finding, frontal only | Profiles missed; the YuNet and SFace in Home are better |
| 6 | Donor is 384x288 or 512x384 enlarged by bicubic | Soft face on a sharp body |
| 7 | Grain uses one fixed seed on every frame | Fixed-pattern "dirt on the lens" |
| 8 | Absolute pixel thresholds | Behavior changes with resolution |
| 9 | Color state and blend restart each 2.33 s segment | Possible tone jump every 56 frames |
| 10 | The temporal blend keeps 60 percent of the previous frame | Smears fast mouth shapes |
| 11 | The preservation check recolors original skin outside the mask on purpose, then exempts skin from the failure count; the encoded check allows 1 percent of pixels to differ by more than 24 | A second actor's face is exactly what it can miss; a wrong mask passes a check against itself |
| 12 | Two swap routes (legacy `video/swap.ts`, the generic job) with different limits | One should go (H3-ONE-RUNTIME-01) |

**Repaired preservation check** (prototyped outside the repo, not in the Stack): no skin exemption; a declared edit region that does not come from the compositor's own mask (the target face box grown by a margin); before encoding, every pixel outside the region equals the source; after encoding, the delivered file is compared with a source-only encode made with the same settings, with a control encode that has a violent edit inside the region only; real edits persist at the same pixels frame after frame while encoder drift does not, so "persistent changed pixels outside the region" decides (a blob of 50 pixels or more fails). An exact-equal rule after a lossy encode is impossible: 12,511 pixels drifted over 70 untouched frames.

**Face-only against whole-head.**

| | Face-only (classic per-frame swapper, FaceFusion 3.9.2 with hyperswap, GPU via CoreML) | Whole-head (generative, on a stabilized head crop) |
|---|---|---|
| Result on a two-person dialogue clip with cuts and a turn | 230 of 300 frames swapped; wrong person in 0 frames; 0 pixels outside the region before encoding; original sound identical; mouth proxy correlation 0.48; 0.10 machine minutes per footage second (43 s swap for 10 s) | LTX head-swap adapter (768 square crops, 102 s, 76 GB): the new head is lost within 5 frames |
| Likeness | Identity score 0.52 against a consenting adult's own photos, but reads as a third person: hair, hairline, beard, head shape stay the actor's. Owner: "awful". Models 1a, 1b, 1c at boost 512 and 1024, inswapper, simswap, and face restore gave the same man | Anchor still from the picture model scored 0.22 to 0.29 (below the 0.36 same-person line) and reads heavier and older |
| Verdict | Valid only where hair, beard and head shape are close to the actor's | Not yet: V3 mode (reference photo kept in a side strip on every guide frame), tight margin, strength above 1.0 and the r128 file are untried |

Paste-back comparison on seven frames: the swapper's own aligned paste is cleaner at the jaw and follows an occluder through its occlusion model; our compositor's hull ignores the mask and cuts across the nose bridge. Decision: the swapper's own paste is the default; keep our footage handling, per-frame grain, color state across frames, review strip and report. Face restore (GFPGAN) sharpened skin (Laplacian 76 against 30) with heavy eye outlines, took 219 s against 43 s, and did not change the likeness: optional for sharp 1080p sources only.

**Decisions.**

1. Face only first, only after the check is repaired; the actor's hair, body, blocking and original soundtrack stay. Voice conversion is a separate operation and a separate owner decision.
2. The repaired check (above) replaces the old one before any further swap work.
3. **Target selection.** The person picks the actor once; the identity is followed through the clip (accept at similarity 0.45, or 0.30 when continuing the same face from the previous frame; a face after a cut must match alone). When the target leaves, turns beyond recognition or is hidden, keep the source frames; reacquire after cuts. A missed swap can be reviewed; swapping the other actor is an immediate failure. Carry color and tracking state across chunks inside a shot; reset at real cuts. The thresholds were tuned on two clips only.
4. Whole-head stays an experiment: keep hair, jaw, neck and the foreground occluder in the guide; compare two margins on the same turn.
5. Likeness as the owner judges it is the bar, not the preservation numbers. Adults only, the person's own unlocked clip, existing cast and audience gates, nothing published.
6. Weight licences block a product default: the swap model is research-only, the identity embedding non-commercial, the occlusion and face-detector weights GPL-3.0 (per the tool's own metadata); no commercially usable swap weight set has been found.

Decisive test still owed: one two-person exchange with a cut, a turn and a stretch where the target is absent, plus one hand-over-face shot; target, other actor and occluder marked by hand on a few frames; fail on any wrong-person edit, a changed foreground hand or visible mouth drift at normal speed (listened to with the original soundtrack); record total time per accepted second; ceiling one machine minute per footage second for now.

## 9. "Enhance this take" and the other adapters

Test (reusing LTX Boost clips, no new base renders): (1) one clip as a compatibility check of the Refine Details adapter on our runner; stop and record if it cannot take the clip at a larger size; (2) if it works, finish five more and show the plain resize and the finished clip side by side, sides randomized; (3) the owner answers two questions per pair: did the performance change, and which would you deliver. Pass: all six keep speaker, words, identity and timing, and at least five of six are preferred to the resized original. If it passes: one optional action after a clip is ready, with its own capability row per engine and profile, the approved clip as a typed input, a child receipt linked to the original, the original kept if the finish fails. LTX ships it alone; H3 earns its own row. It may sharpen a wrong tooth rather than repair it.

Priorities for LTX capabilities in the product, in order: audio-to-video ("use this line reading"; one voice across shots, exact timing; verify first); retake from here (in the Stack, Max only; surface it where a shot is reviewed); Ingredients for fictional characters and props; Refine Details; then one Union Control blocking test (pose, depth or edges from a guide clip; promote only if the actor hits the turn and placement more reliably than a plain take). Deferred until a specific need: restore, deblur, HDR, frame interpolation.

## 10. H3 speed

Question: can H3 match LTX Boost's 71 s with speech? Not shown by anyone on a Mac; the timings show parity has not been demonstrated, not that it is a hardware limit. The goal is the fastest recipe the owner would publish, measured as minutes per accepted, delivered shot including rejected attempts (a 4-minute recipe needing three tries costs 72 minutes for six shots; an 8-minute recipe that lands first time costs 48).

| Lever | Evidence | Status |
|---|---|---|
| Current runner, turbo 7 steps | 235 s (denoise 179 + decode 42 + other 14) | baseline |
| Metal engine (vpipe) at 768p with an 8-step or 4-step adapter | 13.7 and 8.0 min at 1344x768 (preloaded) | measured; ratings pending |
| h3.c engine, exact mode | 277 s at 12 steps, 864x480 (clip receipt); upstream 75 s figure has no stated size or steps | words not yet checked |
| Fewer tokens (small then enlarge inside the model) | about 2x on NVIDIA; upscaler file on disk, never run here | open; time the whole delivered clip |
| Distilled adapters | 3 to 5x fewer steps; Pika needs its own schedule; turbo rated lowest on voice and teeth | already in use at 7 steps |
| Fast decoder (StreamRender-H3) | decode 15 s to 1.6 s on authors' hardware; removing all 42 s still leaves turbo at 193 s | not verified here |
| Block cache | 20 to 27 percent faster, softer, speech lost or changed on both test clips (2026-11-01 bench) | bottom of the list; never for dialogue |
| Sparse attention (Sol-Attn) | 16 percent faster step, same total, four times the memory | ruled out |
| FastH3-Omni (references) | published: one reference 19.5 min on an M5 Max 64 GB, 4.7 min with a reduced reference size (framing and action changed), three references 59.1 min | unverified here |
| Pika sampler (own schedule), Regenerate-2K refine | published Mac implementation in vpipe; refine costs 12 to 48 min | experimental profile only |

Why a step is slow (estimate, not measured here): about 12,555 picture tokens for H3 against about 5,376 for LTX at full size and 1,344 in its half-size first stage; a larger model (33B against 22B). Log real tensor shapes before blaming tokens. A two-minute H3 profile (1.69 times LTX's time), not parity, is the realistic goal. The answer is likely routing: LTX for speed, H3 where it clearly wins a task; the owner's blind ratings decide whether H3 wins by enough to justify 3 to 10 times the wait. The wait is compared directly with LTX Boost, with sound, on three scenes and two seeds.

## 11. Evaluation harness

Scenes: a talking close-up, a medium shot with two steps and a turn, a wide two-person shot where only the second person replies. One fictional adult, two fixed seeds per scene. Scoring: blind, same player and size, with sound; 1 to 5 each for identity, skin and eyes and teeth in motion, movement, composition, speech; first takes rated before favorites. Pass: 4.5 or more on two of three scenes and identity recognizable in five of six; a split between two seeds is inconclusive and gets another pair. Report minutes per accepted take, face size in frame and first-take pass rate.

| Arms | Decide |
|---|---|
| A: what ships through Home with its finish; B: same FL2VA build without the adapter at 24 steps; C: stock Ref2VA, one face and one outfit picture; D: Singularity V2 matched to C; E: the winner at about 0.65 then 0.9 to 1.0 megapixel | H3 route and size |
| L-A: Standard; L-B: Boost; L-C: Max bf16; L-D: best of B or C with the detail pass; L-E: a composed first frame against words only | LTX route and size |
| Sheet makers head to head (today's composite, the Stack's eight panels, H3 eight-panel, separate full-size views), then six scenes with each | the reference-set maker |
| Same-seed number across model families is bookkeeping, not the same noise | |

Acceptance cases kept as release evidence: replay a legacy start and end job on each engine (role order, crop, orientation, sound, real delivered size; same for a loop); Ingredients with one sheet then two and the failures (missing adapter, three sheets, wrong size, portrait, Max unavailable), each failing clearly before any expensive work; the same approved fictional adult in six scenes (LTX Ingredients against a composed LTX first picture; H3 references against separate views); real-adult fixtures through the existing placement and face check; child, teen and adult-only limits hold through derivatives, retries and receipts; a voice reference asked of an install that only generates sound gets an actionable answer; extend an LTX clip and retake a suffix with the original, the kept part and its sound surviving and retry or cancel unable to overwrite the first take; quality compared at equal playback size with sound; everything repeated with LTX alone, H3 alone and both installed.

## 12. Build order and work packages

Order (from the outside review, adopted): (1) typed roles, receipts and capability tests around the current runners, no behavior change; (2) route ordinary Home clips and film shots through one planner, exercising LTX with H3 absent; (3) H3 reference conditioning and explicit H3 profiles; (4) compare quality and promote a default per task and per tier, separately. For films: voiced storyboard, finished-export checks, approved character and location references through Films, bounded repairs. Swap: repair the preservation check, then the face-only decisive test. First milestone in the person's words: "I give MaiPai a sentence and a photo, watch a 30 second version with voices, change one thing, and approve what it is about to spend time rendering."

Shared shapes go spec first (`commons/spec`), then Stack, then Home. Packages touching child or audience gates take the full gate and a review. Each is sized for one session.

| Row | Package | Repo | Depends on | Note section |
|---|---|---|---|---|
| VF-RECEIPT-01 | Receipt and native-file retention for every video job; delivered file probed; LTX in-place rewrite and H3 overwrite fixed | Stack | none | 3.4 |
| VF-ROLES-01 | Typed roles and structured dialogue on the clip request, additive; legacy `image` and `end_image` unchanged | commons spec, then Stack | none | 3.1 |
| VF-CAPS-01 | Capability rows per operation and profile from the validators and measured tables; discovery, validation and command construction tested together | Stack, spec | VF-ROLES-01 | 3.3 |
| VF-PROFILE-01 | Typed profiles (preview, quality) for H3 and LTX, including LTX Max native HD and its admission; a file on disk never selects quality; pack notes implemented or removed | Stack | VF-CAPS-01 | 3.2, 4, 6.2 |
| VF-PLAN-01 | Home planner: plan before deriving a start picture; honor explicit pictures; route clips and film shots; plain refusals | Home | VF-ROLES-01, VF-CAPS-01 | 3.3 |
| VF-CAST-01 | Approved cast views: versioned, role-tagged, derived sheet or first picture per engine; stale and failed capture shown; locked sentence by vision | Home | VF-ROLES-01 | 5 |
| VF-PROMPT-01 | Per-engine prompt rendering with golden fixtures (H3 base and reference grammars, LTX paragraph) | Stack | VF-ROLES-01, VF-PROFILE-01 | 6.1 |
| VF-H3REF-01 | H3 reference route behind a capability that stays off until a full job passes (extends H3-REFS-01) | Stack | VF-CAPS-01, VF-PROFILE-01 | 3.2 |
| VF-FINISH-01 | Finish and sound: paired comparison, then one finisher per pack and operation; the H3 start trim | Stack | VF-RECEIPT-01 | 6.3, 7.5 |
| VF-EVAL-01 | Evaluation harness: three scenes, arms A to E and L-A to L-E, sheet-maker bake-off, blind scorecard, receipts attached (bench, no product code) | bench | VF-RECEIPT-01 | 11 |
| VF-TAKES-01 | Takes and continuity: another take, retake, extend, shot chaining; surface retake and cast controls in Films (extends VIDEO-TAKES-01, CREATOR-25) | Stack, Home | VF-PLAN-01, VF-H3REF-01 | 3.3 |
| VF-CHECK-01 | Finished-export checker with the three deliberate-break tests and the held-still case; export fails on a missing or inaudible line | Home, Stack ffmpeg | none | 7.7 |
| VF-STORYBOARD-01 | Voiced storyboard: one voice per character, line recordings, timed still playback with room sound, estimated render time, edit-in-place (extends FILM-ANIMATIC-01) | Home | VF-CHECK-01, VF-CAST-01 | 7.1 |
| VF-LOOK-01 | Shared look paragraph, wardrobe lock, location plates and floor plan, built only for what the camera sees | Home | VF-CAST-01 | 7.3 |
| VF-REPAIR-01 | Per-clip checks and the bounded repair rule; local, predictable edits (extends CREATOR-10) | Home | VF-CHECK-01, VF-TAKES-01 | 7.6 |
| VF-ENHANCE-01 | "Enhance this take" test and, if it passes, the action (LTX first) | Stack, Home | VF-RECEIPT-01 | 9 |
| VF-SWAPCHECK-01 | Repair the swap preservation check in the Stack (independent region, source-only encode, persistence rule) | Stack | none | 8 |
| VF-SWAP-01 | Face-only swap job on the repaired check: target selection and tracking, swapper's own paste, per-frame grain, color state across chunks; decisive test; weights licence resolved first | Stack | VF-SWAPCHECK-01 | 8 |
| VF-SPEED-01 | H3 speed matched tests (runner against runner, references separately, decoder, Pika schedule) and the verdict on a fast-H3 profile | bench | none | 10 |

Packages VF-RECEIPT-01, VF-ROLES-01, VF-CHECK-01, VF-SWAPCHECK-01 and VF-SPEED-01 can start at once. Existing rows to cite rather than duplicate: MODELPACK-* (the pack record and generic jobs these rows ride on), H3-ONE-RUNTIME-01, H3-REFS-01, H3-SHEET-*, FILM-ANIMATIC-01, FILM-GRADE-01, VIDEO-TAKES-01, CREATOR-10, CREATOR-25, DISK-GUARD-02.

## 13. Open questions and what is not verified

Results still coming (a follow-up updates this note):

- The H3 speed test's blind ratings and words checks: vpipe 8 and 4 step at 768p, h3.c exact mode, FastH3-Omni with one reference, Pika's real schedule, the preview and fast decoders, Regenerate-2K as the finish, and whether the 24-step clip is worth its minutes over turbo.
- The swap test's whole-head V3 mode, tight margin and r128 runs, and the decisive two-actor test with a hand over the face.
- The video test's Refine Details compatibility check (needs the maintainer's model terms accepted), the Union Control test, and medium and wide shots at native 1920x1088 (only a close-up was tested at that size).

Open decisions and unknowns:

| Item | State |
|---|---|
| Whether the 24-step H3 clip beats turbo on a good start picture | One clip, sound not rated; the owner's earlier ratings say it does |
| Why LTX Max took 161 s once and 95 s another time | Likely another job on the GPU; not proven |
| Whether the memory governor should admit LTX Max HD (74 GB) on a hub that also holds a chat engine | The live Stack cancelled it three times; threshold and admission rule undecided |
| Max memory at 1024x576: 48.6 GB (pack) against about 69 GB (tiers note) | Measured 49 GB peak footprint here; docs disagree |
| Whether H3 can take a start picture and references together | Untested; refuse plainly |
| Audio-to-video on our LTX runner | Documented upstream, unverified here |
| LTX compression ratio and the 12,555 versus 5,376 token estimate | Estimate only |
| Swap weights licence | No commercially usable swap weight set found |
| Voice conversion in a swap | Separate owner decision |
| Reference and approval rules for audience gates through derivatives | Packages touching them take the full gate |
| Film continuity cause ("different crews") | Inference that independent stills and voices cause it; the storyboard test can disprove it |
| Tests were one take or one seed per cell; owner's ratings of H3 clips are about 250 clips, effect sizes small | Treat as direction, not proof |
| H3 as a product part | Optional pack, never a default; no H3 clip is described here as publishable |
