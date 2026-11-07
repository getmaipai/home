# LTX Desktop features in Home videos (LTXD)

Design note, 2026-11-06. Status: proposed, awaiting architect (revised after the first architect ruling, REJECTED; fixes listed in Supersedes). Owner answers recorded 2026-11-06 (section 8). Owner direction (Jesse, 2026-11-06):
take four feature groups from the open-source app Lightricks/LTX-Desktop (Apache-2.0 app code) into Home's videos. This note covers
what each one is, where it lives in Home, what the Stack needs, the gates, and the build order. No code is written here.

Reuse check: grepped home, stack, commons and catalog for retake, enhance, rewrite, audio_to_video, a2v, ic-lora, iclora, camera, dolly, jib,
transition, recipes, edit_video, extend and join. Found: Stack `video/ltx25Edit.ts` and `ltx25_worker.py` already run extend and retake (LTX25-EDIT-01,
verified on a real Max clip); the Stack LoRA library (`video/loras.ts`, base `ltx-2.5`, adult-only classes, audience second lock) already installs
LoRAs; Home `videos/recipes.ts` already has Dolly in and Aerial camera wording; `editTool.ts` already has `continue` and `join` with a crossfade
transition field; VIDEO-INPUTS-01 added the start and end picture; VIDEO-INPUTS-04 and -05 plan the bench and input for a2v and the window bench; VIDEO-INPUTS-06's Home side landed.
Home already has `edit_video` `extend` and `retake` (980e0c43f; the file's top comment is stale), 11 plain `effect` values (`speed_ramp`, `reverse`, `freeze`, `loop`, `fps_boost`, `flip`, `rotate`, `sharpen`, `denoise`, `pip`, `kenburns`), `film_look` presets (FILM-LOOK-UI-01), and the kit `GenerationStage` with `transparency="checker"`. Not found anywhere: prompt rewrite for video, any IC-LoRA run, a camera-move LoRA. This note extends those rows and adds
only what is missing. Rechecked against `origin/main` (918b30ace): `video-loras-2026-11-02.md`, `styles-one-system-2026-11-05.md` and STYLES-04 (f37c523f9) are on `main`, so
the style rules below are quoted from them, not from briefs.

## Owner ruling 2026-11-06: our own way

Jesse, 2026-11-06, in chat: "We don't care about the license, just review the code and implement the same features just coded our own way." So no feature here depends on a gated Lightricks IC-LoRA or camera file, and nothing waits on the licence report. The same user features are built with our code on engines we already run. This section sits near the top on purpose; where it disagrees with text below, it wins. Measured facts (bench 2026-11-06, `data-scratch/reports/ltxd-01-claymation-on-25-2026-11-06.md`):

1. The 2.3 Claymation style LoRA changes a 2.5 Max clip (1024x576, seed 7), visibly and cleanly. The Stack TS refusal of a 2.3-labelled file on a 2.5 clip is therefore too strict for at least this file. New row LTXD-18B relaxes it to a warning plus a per-file "tested on 2.5" mark. The googlyeyes finding stands: that 2.3 file did nothing.
2. `ltx-2-mlx enhance` refuses our Gemma 4 pack. LTXD-02 (Stack route) is dropped; LTXD-03 is Home-only, on the hub's chat model, plus the commons `prompt_bar` prop.
3. The ungated Lightricks Dolly In camera LoRA (an LTX-2 19b file) runs on the 2.5 Max pack and pushes in harder than the engine's own drift (1.9x against 1.4x, one clip). The gated 2.5 IC-LoRA files (Day to Night and the rest) cannot be obtained without an accepted account agreement, so nothing is planned around them.

What changes in section 7: LTXD-LIC-01 done; LTXD-02 dropped; LTXD-03 Home-only; LTXD-07A, 07, 08, 09 and 17 replaced by LTXD-E1 to E3; LTXD-10 limited to ungated tested files; LTXD-18B added; the order line rebuilt. Marks inheritance, Max-only for model-guided work, and `allow_suggesting` false for effects all stay.

## 1. Where each piece stands today

| Piece | Stack engine (ltx-2-mlx 0.18.0 on the Max tier) | Home |
|---|---|---|
| Retake | Built: `retake_from_seconds` (1 to 9), from that second to the clip end only | Home calls it: `edit_video` `retake` and `extend` landed (980e0c43f, with `from_s` and `to_s`). The comment at the top of `editTool.ts` still says "`retake` is not here"; it is stale and the first slice that touches the file fixes it |
| Prompt rewrite | The runtime has `ltx-2-mlx enhance` (Gemma 3 12B); Stack does not expose it | None |
| Audio to video | Runtime has `a2v` (validated on 2.5 by its author); Stack worker has no mode for it | VIDEO-INPUTS-05 plans the `audio` reference |
| IC-LoRA effects | Runtime has `ic-lora` and `hdr-ic-lora`; Stack worker has no mode; LoRA library takes style LoRAs, not IC-LoRAs | None |
| Camera moves | Style LoRA path exists; the Lightricks camera LoRAs are listed for the older LTX-2 base | Camera cards use prompt wording only |
| Transition | Start and end picture on LTX-2.5 (VIDEO-INPUTS-01) | `end_frame` waits on VIDEO-INPUTS-03 |

Whether the runtime's `ic-lora` command runs the Lightricks IC-LoRA files (Day to Night and the rest) the way LTX Desktop runs them is **unknown**:
the runtime README says it runs "the IC-LoRAs Lightricks has published for 2.5" but lists depth, pose and edge control as its example. Slice
LTXD-01 settles it before any Home work.

## 2. The four groups

### 2.1 Retake and prompt rewrite

- **Retake, plain words:** pick a part of a finished clip (2 to 10 seconds in LTX Desktop) and make that part again with new words, keeping the rest.
- **Home surface:** none of its own. "Redo from here (Max)" already has its place in VIDEO-STUDIO-11 (the Studio tool) and `edit_video` `retake` (VIDEO-CHAT-01 C6, VIDEO-INPUTS-06). This note changes only the window: the existing `from_s` and `to_s` arguments (kept, not renamed) get a 2 to 10 s range chosen with the kit two-thumb `Slider` (LTXD-14) and the Stack gets an end (LTXD-04); today the Stack retakes from `from_s` to the clip end. Placement: the clip card's More menu (VIDEO-UI-02 icon row) and the chat video card, both calling the same `makeVideoFor` path; the result is a new version and the old clip is kept.
- **Stack change:** the Stack's retake is "from a second to the end". LTX Desktop's is a window. `ltx-2-mlx retake` takes `--start` and `--end`, so the worker
  passes an end latent too (`retake_end_seconds`, additive field on `POST /v1/videos/generations`). Existing measured footprints (59 GB at 768x448,
  56.5 GB at 1024x576, 202 to 422 s) were for retake to the end; a window should be cheaper but is **unmeasured** (LTXD-02 measures it).
- **Prompt rewrite, plain words:** turns "a dog on a beach" into the long scene, motion and sound description LTX does best with.
- **Home surface:** an Enhance chip in `prompt_bar` (shows the rewrite in the field, the person edits it, the first words stay in history) and a
  household setting `video.enhance_prompt` (`ask`, `auto`, `off`; default `ask`, which is the chip). Chat `generate_video` gets the same through the
  model deciding (rule 1), never wording matching. Style trigger words and recipe wording are kept: Home sends them to the rewrite as "must appear
  unchanged" and checks they are still in the result, falling back to the typed words if not (LTX Desktop does the same check).
- **Superseded by the ruling near the top:** the rewrite runs in Home on the hub's chat model, not on the Stack (the engine refuses our Gemma 4 pack). The next bullet describes the first plan and is kept for history; the safety screens in the Gates bullet still apply.
- **Local only:** the rewrite runs on the Stack with the same Gemma folder LTX-2.5 already installs for text encoding (Gemma 3 12B per the runtime
  README; **unknown** whether our pinned folder is the same file the enhancer wants, LTXD-01 checks). If it is missing, the typed words go through and
  the page says so. No Gemini or any other cloud path, ever (LTX Desktop offers a Gemini API choice; Home drops it).
- **Gates:** the rewrite output passes the CSAM screen for adults and the age band's content floor for minors (RULES rule 10) before the clip starts (a rewrite can add content). Under age bands, Create stays adult-only as today (`MINOR_MAKE_LINE`); chat video for minors keeps the existing
  policy and the rewrite adds nothing a minor could not already say. Retake inherits the source clip's mark (section 3).
- **Tiers:** retake and extend are Max only (measured 56 to 59 GB). Rewrite runs on Standard, Boost and Max when the Gemma folder exists.

### 2.2 Audio to video

- **Plain words:** give a sound (a song, a voice, a recording from the microphone) and the picture follows it. Optional start picture.
- **Home surface:** none of its own. Videos owns audio-driven video (AUDIO-PARITY-01), and the `audio` reference kind and Voice clip slot are VIDEO-INPUTS-05 and VIDEO-UI-09. This note adds to those two rows: microphone record in the slot (browser `MediaRecorder`; nothing leaves the device before the upload to the hub), trim with the kit two-thumb `Slider` (LTXD-14), minimum 2 s, maximum 20 s (10 s at the largest size). Chat: the `voice_clip` argument with a Library audio file.
- **Stack change:** an `a2v` mode in `ltx25_worker.py` (`ltx-2-mlx a2v`, plus the `--distilled` variant, which the runtime calls experimental).
  Duration follows the audio. Time and footprint **unmeasured**; VIDEO-INPUTS-04 already owns that bench and the retake window `--end` and these audio lengths (2 s, 10 s, 20 s)
  join that same bench (no separate LTXD bench row).
- **Gates:** an uploaded sound can be someone's voice. The proof is a Home-to-Stack check that asks the person nothing: Home signs the clip hash and the Stack refuses a clip without it, the way `POST /v1/voices` already works (voices-2026-10-18.md, "Stack proof", line 217). The finished clip's speech is checked the way VIDEO-LTX-06 plans (transcribe, then the CSAM screen for adults and the age band's content floor for minors, rule 10). Same audience and Adult lock rules as any clip.
- **Tiers:** Standard to Max if the bench passes; Max only if it does not.

### 2.3 IC-LoRA effects on a clip

- **Superseded by the ruling near the top:** no IC-LoRA is installed. Effects are ffmpeg looks plus bench-gated prompt-guided restyle (LTXD-E1 to E3). The package table and Stack IC-LoRA bullets below describe the first plan and are kept for history.
- **Plain words:** take a finished clip and change one thing while the motion stays: day to night, sharpen a blurry clip, colorize black and white,
  restore old footage, remove people and cars (clean plate), turn water into simulated water, or render a rough layout in the look of a picture.
- **Home surface:** an "Effects" group on a clip's action menu (Creations and the card) and an `edit_video` change that is **not** the existing `effect` (that already has 11 plain ffmpeg values, `editTool.ts` line 53, and a second list under the same name would be a duplicate). The choice: a distinct change name `restyle`, an additive value in the `change` enum with one new field `restyle` (an enum of the IC-LoRA effect ids), so the two lists never mix and no existing call changes. The list is data, one place (like `recipes.ts`): `VIDEO_EFFECTS` with id, label, hint, the IC-LoRA package id, whether it needs a
  look picture, and the maximum source length. Input limit is 10 s (240 frames) from LTX Desktop's own list. The result is a new clip; the source stays.
- **Stack change:** an `ic_lora` mode in the worker taking `source_video`, the IC-LoRA file id, strength (0 to 2), optional look picture, audio
  choice (source or none). The LoRA record `kind` is `style`, `character`, `motion` or `other` today (video-loras-2026-11-02.md, record table). An IC-LoRA is none of these (it needs a source video), so a new kind `ic` needs a `commons/spec` change first (row LTXD-07A, its own row) so an IC-LoRA is never offered as a style and the reverse. Does the engine run these on Apple Silicon? The runtime lists `ic-lora` and `hdr-ic-lora` and `--low-ram`; the Lightricks files were not
  tried by us: **unknown** until LTXD-01.
- **Packages (sizes and licences, from LTX Desktop's catalog; every Lightricks file is gated on Hugging Face):**

| Effect | Repo (Hugging Face) | LTX-2.5 file size | Licence | Gated |
|---|---|---|---|---|
| Day to Night | Lightricks/LTX-2.5-22b-IC-LoRA-Day-To-Night (2.3 twin listed) | 327 MB | LTX-2 Community License | yes |
| Clean Plate | Lightricks/LTX-2.5-22b-IC-LoRA-Clean-Plate | 327 MB | LTX-2 Community License | yes |
| Deblur | Lightricks/LTX-2.3-22b-IC-LoRA-Deblur (2.5 variant listed) | 906 MB | LTX-2 Community License | yes |
| Colorization | Lightricks/LTX-2.3-22b-IC-LoRA-Colorization (2.5 variant listed) | 906 MB | LTX-2 Community License | yes |
| Water Simulation | Lightricks/LTX-2.3-22b-IC-LoRA-Water-Simulation (2.5 variant listed) | 906 MB | LTX-2 Community License | yes |
| Layout to Render | Lightricks/LTX-2.5-22b-IC-LoRA-Layout-To-Render | 1,309 MB | LTX-2 Community License | yes |
| Restore | Lightricks/LTX-2.5-22b-IC-LoRA-Restore | 1,712 MB | LTX-2 Community License | yes |

  Community IC-LoRAs in the same catalog (3D render to real, upscale, greenscreen avatar, cross-view prompt) are **out of scope**: mixed licences
  (Other, MIT, Apache-2.0) and no ask for them.
- **Licence:** the Lightricks files are under the LTX-2 Community License, the same family as the LTX weights Home already installs behind a recorded
  licence acceptance (`licence_required`, `accepted_licence`). Reuse that exact step; read the licence text for commercial limits before the slice
  that ships it (I have not read its terms for this note: the code repo's LICENSE is Apache-2.0, the weights' licence is a separate file). Gated means
  the admin signs in to Hugging Face and accepts on its page; the admin accepts the licence on the model's Hugging Face page in a browser, and the download uses the one Hugging Face token Home already stores (`voice.hf_token`, section 4).
- **Gates:** see section 3. In short: the effect clip inherits the source clip's mark and audience, never lowers it.
- **Tiers:** Max first (a 22B pass with a reference video is at least as heavy as retake); lower tiers only after a measured clip. **Unknown** footprint.

### 2.4 Camera moves and Transition

- **Superseded in part by the ruling near the top:** only ungated, tested camera files are used (Dolly In is tested), and only if they beat the wording cards (LTXD-10).
- **Plain words:** dolly in and out, jib up and down (the camera rises or sinks), drone fly-through; and Transition, which makes a clip that morphs
  from one picture into another.
- **Today:** Home's Camera cards already add wording (Dolly in, Aerial). The question is whether LoRAs do better than wording.
- **Home surface:** no new card. The existing Camera cards (`recipes.ts`) gain optional `lora` ids: when the LoRA is installed and passes its bench, the card uses it with the wording; otherwise wording alone. The camera LoRAs are library records of kind `motion` (no spec change). New cards Dolly out, Jib up, Jib down. Transition (Morph) is not a row here: it is the Start and End frame slots of VIDEO-INPUTS-03, and a transition LoRA is added only if that bench shows the plain two-picture clip is worse.
- **Stack change:** none new for wording. LoRA use rides the existing LoRA path. Notes: the Lightricks camera LoRAs (Dolly In, Dolly Out 327 MB; Jib
  Up, Jib Down 2,215 MB each) are listed for the older **LTX-2 19B** base in LTX Desktop's catalog although its table says LTX-2.3 and 2.5 support them.
  Same base question as the claymation one below: bench before shipping. Gated, LTX-2 Community License. The community Transition LoRA
  (joyfox/LTX-2.3-Transition-LORA, 390 MB, Apache-2.0, not gated) is listed for LTX-2.3 only. Drone fly-through and FPV Motion
  (chsengni/ltx2.3-fpv-motion, 309 MB, Apache-2.0) are community LoRAs for 2.3.
- **Tiers:** with the base-model they are made for; Standard to Max once benched.

## 3. Age, surface and Adult lock

- **One rule:** age and surface gates outrank everything (RULES.md rule 0). Nothing here adds a way to make or reach content a gate refuses.
- **Create stays adult-only** for minors (`MINOR_MAKE_LINE`). Chat video follows the existing `policy.ts`. A retake, effect or audio clip made from a
  minor's own clip is allowed only where making that clip was allowed; the new lanes are not looser.
- **Marks inherit.** A retake, an extend, an effect, an audio clip, a reverse, a flip and a grade made from a source clip call `newItemMark(sources, addsAdultStyle)` with the source clip as a source, so the new clip is at least as marked as the source (an Adult-locked source gives an Adult-locked result). An effect never clears a mark. A new Adult-only LoRA used for the edit raises it. Reverse, flip and grade go through `editTool.ts`, which already calls `newItemMark`. Three more places must carry a mark and are named so no slice forgets them:
  - **Ingredients (LTXD-16):** the clip takes the mark of every reference picture, not only one. Today `backend/src/lib/videos/jobs.ts` (line 444) calls `newItemMark` with `input.adultOnly` alone; the slice must pass every reference picture's mark as a source and carry a test with one adult-only picture among ten.
  - **Save frame to Library (LTXD-13):** the saved still takes the clip's mark and audience.
  - **Morph start and end pictures (VIDEO-INPUTS-03):** each picture's mark is a source of the clip's mark; the same fix in `jobs.ts` serves both.
- **Styles and effects obey the style system.** New LoRAs (camera, effects) are library records with `classification`, so the `audience`, `allow_suggesting` and lock rules of `styles-one-system-2026-11-05.md` (on `main`; STYLES-04 landed in f37c523f9) apply with no second path. The IC-LoRA list is not suggested from words (an effect is something a person picks), so `allow_suggesting` is false for every effect; camera LoRAs (kind `motion`) follow the style rule if they are suggested at all.
- **Audio input:** a recorded or uploaded voice is checked per open question 3; the output speech check is VIDEO-LTX-06.
- **Prompt rewrite output** passes the CSAM screen for adults and the age band's content floor for minors (rule 10), exactly as typed words do.
- **Absolute line:** minor-sexual content stays refused everywhere; no setting lifts it (the Stack LoRA library already enforces it at import).

## 4. Privacy and downloads

- Zero phone-home. The rewrite and every pass run on the household's Stack. LTX Desktop's Gemini rewrite, its API video models and its analytics
  are not taken.
- Downloads happen only when an admin chooses them, one at a time, with the size and the licence shown first (the existing Models flow). Nothing
  downloads on first use of a tool, which is what LTX Desktop does and Home must not.
- **Superseded by the ruling near the top:** no gated Lightricks file is planned, so the next bullet applies only if a later row installs a gated file; nothing here does. Kept for history.
- Gated Hugging Face downloads need an access token. It already exists: the household secret setting `voice.hf_token` (`settings/voiceKeys.ts`, stored encrypted by `lib/secrets`, read by `lib/loras/source.ts`; VIDEO-LORA-07 and VIDEO-SETTINGS-08 own its wording). One definition, no new token store and nothing added to the Stack's disk by this note. The admin creates the read token on Hugging Face, accepts the file's terms there in a browser, and pastes the token once in Settings; it is write-only (never shown again, never in a log, URL or query string), per the org `docs/CREDENTIALS.md` rules. The install route that VIDEO-LORA-07 built passes it to the download call; LTXD-07 reuses that route.
- Total if all seven Lightricks effects and four camera LoRAs were installed: about 5.5 GB (effects) plus about 4.9 GB (camera). Each is a separate
  optional package; none installs by default.
- Audio recorded in the browser goes to the hub only, stored in the Library under the person's own scope.

## 5. The claymation question (LoRA made for 2.3 on the 2.5 engine)

LTX Desktop's catalog lists Claymation (`vrgamedevgirl84/LTX_2.3_Clay_Mation_Style_LoRa`, 353 MB, LTX-2 Community License, no gate) as supported
on both LTX-2.3 and LTX-2.5, but the file says `ss_ltx_version 2.3`. Our Stack's `video/loras.ts` says a 2.3 file (googlyeyes) loaded on the 2.5 pack
and changed nothing (measured 2026-11-02). They disagree. The same question applies to almost every community style LoRA in that catalog
(Cozy Felt, Fantasy, Paper Cut-Out, Wild West, Transition, FPV) and to the Lightricks camera LoRAs.

Bench (LTXD-01, one clip each): pick one prompt that names the Claymation trigger words, the same seed, the same size on the Max tier. Make one
clip without the LoRA and one with it at strength 1.0. Open frames 0, 24 and 72 of each, side by side, and judge with Jesse's eye, plus a number:
mean frame difference between the two clips (a difference near zero means the LoRA did nothing, as with googlyeyes). Repeat for one Lightricks
2.5 file (Day to Night IC-LoRA) to settle the IC path. Record both in `video-speed-bench-2026-11-01.md`.

## 6. Micro features and workflows

Row names in this section that read LTXD-02, -07, -08, -09 or -17 follow the owner ruling near the top: they now map to LTXD-03 (Home-only rewrite) and LTXD-E1 to E3 (own-way Effects), and an item whose only own-way version is dishonest is dropped as listed under LTXD-E3.

Source: `data-scratch/reports/ltx-desktop-inventory-2026-11-06.md` (339 items). The 19 items flagged `[CLOUD]` or `[DESKTOP]` are left out (cloud
services and the Electron shell have no place in Home). Each of the other 320 items has one line and one verdict:

- **HAVE** is already in Home or the Stack, or already designed and owned by a named row (the row is named; a planned item is not new work here).
- **NEW** is a gap. It names the Home surface and the kit prop or page it touches; "commons first" means a kit change and a tag come before Home.
- **SKIP** gives the reason.

Reuse check for this section: Home today has the Create and My clips design (`video-create-one-page-2026-11-02.md`, VIDEO-UI-01 to -09: feed with
Favorites, Group by words, Type filter, day groups, size slider, Cancel, Try again, Another take, Remix, Download), the kit `VideoPlayer`, `Player`,
`MediaGrid`, `MediaShelf`, `CardSizeSlider`, `RunningNow`, `message-queue`, `stopped-run`, `command-palette`, `stacked-alpha-video`, `Toast`,
`DestructiveConfirm`, `AsyncState`, the household job queue (`lib/jobs/householdQueue.ts`, `jobQueueCopy.ts`, the Queues page), the Library
(`library*.ts`, trash, shares, provenance), the Stack `media.edit` job (trim, concat, mute, frame, audio_overlay, fade, crossfade, gain, reframe,
grade, speed, captions, transition, title_card, credits), and the job record already stores the seed. Grepped by several names each (seed, favorite,
lightbox, compare, curtain, undo, reorder, cutout, alpha, waveform, filmstrip, motion path, outpaint, copy prompt); a name not found anywhere is NEW.

### 6.1 Workflows (generation tools)

- Text to Video: HAVE (Create, `generate_video`).
- Image to Video with optional end frame, aspect follows the start frame: HAVE (VIDEO-INPUTS-01; End frame is VIDEO-INPUTS-03).
- Audio to Video, 2 s minimum, 20 s maximum: HAVE (planned: VIDEO-INPUTS-05 and VIDEO-UI-09, which absorb the microphone, trim and 20 s limit).
- Retake of 2 to 10 s with replace, video-only or audio-only modes: HAVE (planned: VIDEO-STUDIO-11 and VIDEO-INPUTS-06 for the surface, LTXD-04 for the Stack window). The audio-only and video-only modes are SKIP: the Stack runtime does not list them.
- Extend 4 to 12 s: HAVE in the Stack (LTX25-EDIT-01, 1 to 6 s); Home side is VIDEO-INPUTS-06. Extending before the clip is SKIP (not in the runtime).
- Retake and Extend never upscale: HAVE (the Stack fits the source to its measured size table and refuses outside it).
- Stitching the retake or extend seam without a jump: HAVE (the runtime keeps the source in latent form and decodes the whole clip, measured no seam).
- Letterbox fit to a multiple of 32: HAVE (the Stack re-makes the source on its 64 grid).
- Day to Night: HAVE (planned: LTXD-08).
- AlphaGen cutout (alpha WebM, matte, GIF): SKIP as a new feature; folded into existing work: Stack `media.companion_clip` already cuts a background out into an alpha matte (CMEDIA-STACK-01) and LOCAL-BENCH-01 benches BiRefNet and SAM 2.1 cutouts. Alpha-Gen is added to LOCAL-BENCH-01 as one more candidate (LTX-2.5 only, LTX-2 Community License), and any result is shown by the kit `GenerationStage` with `transparency="checker"`.
- Deblur, Colorization, Clean Plate: HAVE (planned: LTXD-08).
- Decompression: NEW (one more entry in `VIDEO_EFFECTS`, same IC-LoRA lane, 906 MB, under the `restyle` change). Folded into LTXD-09.
- Water Simulation, Layout to Render, Restore: HAVE (planned: LTXD-09).
- Ingredients (1 to 10 images into one video via a sheet): NEW (References group takes many pictures; Stack builds the sheet; the clip takes every reference picture's mark, section 3). LTXD-16.
- Refine Details: NEW (an Effects entry, LTX-2.5 only, needs a high-res flag; sharpen a soft clip). LTXD-17.
- Motion Track Control (draw paths on a picture): NEW as research only (LTXD-16): the commons `ImageEditor` already draws freehand strokes with undo over a picture, so a new kit block is not assumed. Largest item here.
- Video Guide (pose, depth, Canny guide): SKIP (expert control; no household use case; revisit if asked).
- Cozy Felt, Claymation, Fantasy Painterly, Paper Cut-Out (style LoRAs): HAVE (STYLES-0x, subject to the 2.3-on-2.5 bench, section 5).
- Cinemagraph: HAVE through styles once installed (gated Lightricks file, picture start).
- Camera moves Jib Up, Jib Down, Dolly In, Dolly Out, VBVR: HAVE (planned: LTXD-10, bench of the camera LoRAs only; VBVR is SKIP: unclear purpose, LTX-2 Community License).
- Drone Flythrough, FPV Motion, OpenWheel T-Cam: HAVE (planned: LTXD-10; OpenWheel is SKIP: a niche motorsport look).
- Transition: HAVE (planned: VIDEO-INPUTS-03 Start and End frame; LTXD-10 does not carry Morph).
- Variant menu per LoRA: SKIP (one file per base in our library).
- Style strength slider (0 to 3 and 0 to 2): HAVE (VIDEO-LORA-09 built Less, Normal, More strength in the Create style picker; `MAX_LORA_STRENGTH` 2 in the Stack).
- Custom LoRAs from disk with ComfyUI key remap: HAVE (LoRA library import, base detection from tensors; remap exists for `diffusion_model` keys).
- Custom IC-LoRA dev flag and advanced panel: SKIP (developer flags).
- Resolution ladder 270p to 1080p, 1440p and 4K: HAVE (tiers: Standard, Boost, Max). 1440p and 4K are SKIP: unmeasured on our memory limit.
- Aspect ratios: HAVE for landscape and portrait; 21:9, 3:2, 4:3, 1:1, 4:5 are SKIP (LTX trained on 16:9 and 9:16; lower quality; its own warning icon).
- Frame rates 24, 25, 48, 50: SKIP (the runtime measured at 24; a separate interpolation row exists, LOKI-PORT-02).
- Durations 2 to 20 s: HAVE (`seconds`, per tier).
- Model pick LTX 2.5 or 2.3: HAVE (tier picks the model).
- Image generation and editing (Z Image Turbo): HAVE (Pictures lane, image edit).
- Gen Space multi-keyframe timeline with strength rail: SKIP for now (needs VIDEO-EVAL-03 later-frame bench first).
- Gen Space camera presets Dolly In, Out, Left, Right, Jib Up, Down, Focus Shift, Static: HAVE for Dolly in and Still; NEW for Dolly out, Dolly left, Dolly right, Focus shift as wording cards in `recipes.ts` (no kit change). LTXD-15.
- Gen Space outpaint canvas: SKIP (needs the In-Outpainting IC-LoRA and a canvas editor; no ask).
- Gen Space Last frame button: HAVE (EDITOR-15, `continue`).
- Gen Space projects with named gallery: SKIP (Home's Library and My clips are the gallery; a project concept is a platform decision).
- Reference-image drop zone: HAVE (`references` slots, Library upload).
- Windowed long clips: SKIP (engine internals; tiers cap the length).
- Skip stage 2 and distilled keyframe guiding: SKIP (engine internals; the Stack already uses distilled).

### 6.2 Editing

- Multi-track timeline V1 to V3, A1 to A2, add tracks, mute and lock: SKIP (a pro NLE; Home's editors are the simple `media.edit` ops, `media-editors-2026-10-31.md`).
- Tools Selection, Blade, Ripple, Roll, Slide, Slip, Track Select Forward: SKIP (pro NLE).
- Split at playhead: SKIP (Trim twice does it; pro NLE).
- Insert Edit, Overwrite Edit, Match Frame: SKIP (pro NLE).
- In and Out marks, Loop In and Out: SKIP (pro NLE); the trim control in LTXD-14 has its own handles.
- Source monitor and Program monitor: SKIP (pro NLE).
- Playback resolution menu: SKIP (the browser player streams one file).
- J, K, L shuttle, frame step, edit-point jumps: SKIP (pro NLE); `VideoPlayer` keeps Space and arrow seek.
- Snapping toggle: SKIP (pro NLE).
- Zoom timeline: SKIP (pro NLE).
- Speed presets 0.25x to 4x on a clip: HAVE (Stack `media.edit` `speed` op; Home surface is the editor's op list).
- Reverse playback, Flip H and V, Volume, Opacity: HAVE for Reverse and Flip (Stack `EDIT_OPS` `reverse` and `flip`; Home `edit_video` `effect` values, commit 51662dbc8); Mute and Volume are HAVE (`mute`, `gain`); Opacity is SKIP.
- Bulk toggles on multi-select (Mute All, Reverse All): SKIP (BatchBar already does bulk delete and share; bulk edit is not asked for).
- Transitions In and Out (Dissolve, Fade, Wipe): HAVE (Stack `transition`, `fade`, `crossfade`; `join` has the transition field).
- Colour sliders (Brightness, Contrast, Saturation, Temperature, Tint, Exposure, Highlights, Shadows): HAVE (Stack `grade` op; sliders in the editor).
- Effects browser with Filters, Stylize, Color Presets: SKIP as a browser; Sharpen and Denoise are HAVE (`effect` values); the Color Presets are HAVE as the seven `film_look` presets (`FILM_LOOK_PRESETS`: 70s_color, noir, teal_orange, bleach_bypass, technicolor, faded_vintage, cool_thriller) with the picker in FILM-LOOK-UI-01.
- Adjustment layer: SKIP (pro NLE).
- Text overlays, captions, lower thirds: HAVE (Stack `captions`, `title_card`, `credits` ops).
- Subtitle tracks with style editor, SRT import and export, burn-in: HAVE in the Stack (`captions`); SRT import and export are NEW (Library upload of an `.srt`, Download of one) and wait on a request. Not sliced.
- Takes (group several generations of a clip, set active): NEW (feed Group by words shows versions together; an active take flag needs a Library record field, spec first). LTXD-13.
- Regenerate and Cancel Regeneration: HAVE (Another take, Cancel).
- AI clip actions in the context menu (Image to Video, Create Video, Retake, Extend, Use Frame As): HAVE (the feed entry's icon row, `edit_video`; Use Frame As is `continue` and the Library).
- Timeline gap fill with AI: SKIP (needs the timeline).
- Bins and colour labels: SKIP (Library has folders; colour labels have no ask).
- Multiple timelines, Duplicate timeline: SKIP (pro NLE).
- Layout presets and saved layouts: SKIP (Home has fixed responsive layouts).
- Menu bar with menu search: SKIP (Home uses `command-palette`).
- Keyboard shortcut presets (Premiere, Resolve, Avid): SKIP (pro NLE).
- Export H.264, ProRes, VP9, resolution, fps, burn-in: SKIP beyond HAVE (Stack outputs MP4 and `reframe`); ProRes and VP9 have no ask.
- Export FCPXML package: SKIP (no NLE round trip in Home).
- Export FCP7 XML and SRT: SKIP (same).
- Import timeline XML with relink: SKIP.
- Import media into the editor: HAVE (Library upload, Uploaded tab).
- Multi-track flatten for export: SKIP.
- Audio mix on export: HAVE (`audio_overlay` with ducking and loudness).
- Clip trimming (Trim In and Out): HAVE (`trim` op, `edit_video` `trim`).
- Generation info in clip properties (model, prompt, takes): HAVE (feed entry tags, More menu; provenance record). The compact meta bar is in LTXD-13.
- Playhead-driven audio sync: SKIP (player internals).
- Drag onto timeline: SKIP.
- Trim modal with filmstrip, handles, seek bar: NEW but small: the kit two-thumb `Slider` next to `Player` (not over it) for a window on a clip card or in the Voice slot; inside the Studio the trim handles are `TrackStudio`'s (VIDEO-STUDIO-05), not rebuilt. LTXD-14.
- Audio trim with waveform and minimum length: NEW but small: the same two-thumb `Slider` with the min and max clamps; peaks come from the one definition (`peaksOf`, moved into `TrackStudio`, video-studio-2026-11-02.md line 316) if a waveform is drawn at all; no separate waveform lane. LTXD-14.
- Video trim minimums and the 10 s IC-LoRA cap: HAVE as rules in the Stack (422 plain lines); the clamp is the Slider's min and max. LTXD-14.
- Retake region selector clamped to the clip end: HAVE (planned: VIDEO-STUDIO-11 and VIDEO-INPUTS-06 with the LTXD-14 Slider clamp, 2 to 10 s).
- Retake and Extend panels in Gen Space: HAVE (planned: VIDEO-STUDIO-11).
- Motion path editor modal (Pen, Free draw, Bend, Undo, pace curve): NEW as research (LTXD-16); `ImageEditor` covers free draw and undo, the rest is the design note's question.
- Freehand to Bezier path with a golden-file sampler: NEW (Stack step, LTXD-16; one sampler shared by preview and job, tested against a golden file).
- Image batch field, up to 10 images: NEW (Ingredients, LTXD-16).
- Source versus Result toggle: NEW (feed entry, `VideoPlayer` additive `compare` prop, commons first). LTXD-13.
- A/B compare curtain with paired playback: NEW (same prop; `variant: "curtain"`). LTXD-13.
- Compare view per tool with examples: SKIP (the recipe cards already play a sample loop).
- Cutout background strip and colour picker: HAVE in part (`GenerationStage` `transparency="checker"`, used by the companion flow's AnimateStep); the colour picker is SKIP. No new `stacked-alpha-video` prop unless a bench result shows `GenerationStage` cannot show it.
- Extract frame as a new image: HAVE (Stack `frame` op, `continue`; Save frame to Library is one More-menu entry in LTXD-13, and the saved still takes the clip's mark).
- Trim route producing a derived asset: HAVE (`media.edit` trim produces a new Library item).

### 6.3 Library and assets

- Assets library screen, persists: HAVE (Library, My clips VIDEO-UI-06).
- Filter by media type: HAVE (planned: VIDEO-UI-06 Type filter).
- Sort by date, Newest and Oldest: HAVE (day groups newest first); an Oldest toggle is SKIP.
- Search with debounce: NEW (a search box in My clips; the Library has search elsewhere, reuse its query). LTXD-11.
- URL-synced filters: HAVE (`navigate` state and page state; K6).
- Infinite scroll with skeleton tiles: HAVE (`MediaShelf`, `RouteSkeleton`, feed limit 30 with paging).
- Video tile with hover preview, one at a time: NEW (`media_shelf` additive `hover_play` prop with one playing tile; commons first). LTXD-11.
- Audio tile with hover preview and progress: SKIP (audio clips are in the Voice slot list, not browsed).
- Video meta badge (duration and resolution chip): NEW (a corner chip on `media_shelf` tiles; same commons change as hover play). LTXD-11.
- Lightbox with arrow keys and swipe: HAVE (`media-viewer`, `MediaGrid` lightbox).
- Delete file with confirm, blocked when used as an input: HAVE for the confirm (`DestructiveConfirm`, Library trash); the in-use block is NEW (Library delete refuses a clip that a queued or running job reads, with a plain line). LTXD-11.
- Download (phone): HAVE (`VideoPlayer` Download).
- Ask assistant about an asset: HAVE (attach to chat from the Library and the feed entry).
- Empty state "Your library is empty": HAVE (`EmptyState`).
- Filtered empty state with Start again: HAVE (`EmptyState` with an action).
- Error state with Try again: HAVE (`AsyncState`, `error-state`).
- Asset picker inside any tool: HAVE (`FolderPicker`, Uploaded tab for references).
- Drag an asset into a tool field: SKIP (the picker covers it; drag between panes is desktop-only).
- Drag-drop files onto a field: HAVE (`prompt_bar` and Library upload accept drops).
- Keyframe image drop: HAVE (Start frame slot).
- Origin tag per asset (uploaded or generated): HAVE (provenance writer, Uploaded tab).
- Server-side thumbnails and audio posters: HAVE (`fileThumbnails`, `video-poster`).
- Smart output names from the prompt: HAVE (Library names from the words; verify the Download filename in LTXD-15).
- Media validation, size caps, orientation: HAVE (upload stream limits, Stack source checks).
- Asset-in-use guard: NEW (the delete block above). LTXD-11.
- Results feed per tool, newest first, Scroll to newest, deep link to a result: HAVE for the feed (K10 `result_feed`); the "Scroll to newest" button and a link from a queue row into the feed are NEW (feed prop, commons first). LTXD-13.
- Result meta bar (prompt, model, size, seconds, fps, relative time, copy prompt): HAVE for tags and time (feed entry); Copy words is NEW (feed entry More menu entry, `VideoPlayer` built-in handler, commons first). LTXD-12.
- Result actions Download, Reveal, Remove from history: HAVE (Download, More menu delete); Reveal in folder is SKIP (browser).
- Delete generation: HAVE.
- Retry generation in place: HAVE (Try again, `another`).
- Favorites (absent in LTX Desktop): HAVE in Home's design (VIDEO-UI-05 and -06).
- Activity Dashboard with ranges, GPU time, keep rate, LoRA panels: SKIP (resource and usage numbers are admin-only and the family is not shown resource words; the Performance page covers the admin view).
- Dashboard refresh when a job finishes: SKIP (follows the dashboard).
- Recent workflows and recent projects in sidebar: SKIP (Home Recents exist per app).
- Project storage migrations: SKIP (not our data).

### 6.4 Queue

- One shared generation queue for all surfaces: HAVE (household queue, `householdQueue.ts`; resource priority order).
- Queue panel with Running, Pending, Done, Failed: HAVE (Queues page, `RunningNow`, `jobQueueCopy.ts`).
- Drag to reorder pending jobs: NEW (Queues page row handle; a `reorder` action on the household queue; the resource priority order stays the floor, so a person reorders only their own pending video jobs). LTXD-11.
- Cancel a running or pending job: HAVE (Cancel on the feed entry; Queues page).
- Cooperative cancel between denoise steps: HAVE (Stack worker cancel).
- Done tray with unread dot, Clear all, per-row Remove: NEW only as a Clear action on the Queues page (LTXD-11). The Done section, unread dot and any `RunningNow` dot prop are SKIP: RULES S6 allows no new dot, banner or panel; `Toast` already tells when a clip finishes.
- Failed tray with Clear: HAVE (Try again line on the entry); the Clear is the same Queues page action as above.
- Row detail with thumbnails: HAVE (feed entry reference chips).
- Progress text and percent: HAVE (`job-progress`, "Making your video, 42% done").
- Phase and step counters: HAVE (Stack progress).
- Queue link opens the result, "no longer in this list" message: NEW (the feed link above). LTXD-13.
- Resume after restart, jobs marked interrupted and retryable: HAVE (Stack and Home job recovery; verify in the delivery notes).
- Durable queue in SQLite: HAVE.
- Attempt counter on retry: SKIP (internal).
- Error codes stored per job: HAVE (plain error kinds, `messagesCopy.ts`).
- Shared GPU slot: HAVE (Max chat lease, one clip at a time).
- Auto-refresh library when a job succeeds: HAVE (feed polling `poll_while`, K9).
- Polling with backoff on remote: HAVE (K9).
- Generation recovery watcher after reload: HAVE (feed shows in-flight entries by job id).
- Over-budget handling at execute time: HAVE (admit rules, S6 health rows).
- Evict and retry once: HAVE (resource tiers, Max lease).
- ETA from measured hardware only: HAVE (`etaWords`, measured tables).
- Progress heartbeat log: SKIP (Stack logs).

### 6.5 Prompting aids

- Auto-enhance on local generation: HAVE (planned: LTXD-02, LTXD-03).
- Manual Enhance button, works from a start frame alone: HAVE (planned: LTXD-03); start-frame-only is NEW inside that row (the Stack takes the picture; Gemma 3 12B is text only, so image-aware rewrite is unknown: LTXD-01 checks).
- Enhance via menu (local or Gemini): SKIP (no cloud provider, ever).
- Local Gemma enhance: HAVE (planned: LTXD-02).
- Image-aware enhance for IC-LoRA and Retake: SKIP (needs a vision step; retake and extend never rewrite).
- A video can stand in for the prompt: SKIP (blank prompt on some IC-LoRAs; Home's effects supply their own template).
- Catalog-aware system prompts and trigger phrase kept: HAVE (planned: LTXD-03, trigger words checked after).
- Typed versus enhanced provenance (an enhanced, unedited prompt is not rewritten again): NEW (prompt state in `prompt_bar`: a flag that the words are a rewrite; commons first if the bar has none). LTXD-12.
- Prompt history undo and redo: NEW (`prompt_bar` additive Undo and Redo of the words; the kit composer already has draft restore, so reuse `draft-restore` state before adding). LTXD-12.
- Prompt provenance preview: SKIP (backend debug).
- Copy prompt on every result: NEW (see 6.3). LTXD-12.
- Demo prompt seeded per tool: HAVE (`VIDEO_STARTERS`, recipe loops); per-effect demo prompts are NEW inside `VIDEO_EFFECTS`. LTXD-08.
- Templated prompts for Deblur, Colorization, Decompression, Water Simulation: NEW (a template and short fields per effect in `VIDEO_EFFECTS`). LTXD-08.
- Seed field, New seed button, Lock seed: NEW (the job record keeps the seed and Another take uses a new one; add a Seed chip with a lock in the panel's More options, `prompt_bar` additive chip, commons first). LTXD-12.
- Seed lock shared across screens and phone: NEW (stored as a person setting, spec first, so phone and desktop agree). LTXD-12.
- Same seed reproduces the enhancement too: NEW (the Stack rewrite takes the seed). LTXD-02 detail.
- Seed resolved at create: HAVE.
- Seed injected into the saved spec: HAVE (the job record).
- Typewriter placeholder in quick search: SKIP (decoration).
- Reuse previous settings when none named (assistant): HAVE (Remix refill; chat keeps the last settings in the turn).
- Prompt bar resize by dragging: SKIP (the composer auto-sizes).
- Reopen last settings: HAVE (Remix; the panel keeps the last look and tier in page state).
- Mute toggle remembered per form: SKIP.
- Prompt budget tiers ("May exceed your GPU memory", "Generate anyway?"): SKIP (people never see memory wording; tiers and S6 availability replace it, owner rule 2026-11-01).

### 6.6 Settings and setup

- First-run Setup screen: HAVE (Home setup wizard).
- Model download list with sizes and Installed tag: HAVE (setup wizard, Models page).
- Disk space requirement stated: HAVE (Recommended free space on the tier, VIDEO-LTX-07).
- Download progress with speed and ETA: HAVE (Models page).
- Download queue for several models: HAVE (Stack component installs).
- Hugging Face downloader progress adapter: HAVE (install routes of VIDEO-LORA-07).
- Hugging Face sign-in and gated access checks: HAVE for the accept-licence step (`licence_required`); the token is the existing `voice.hf_token` setting, and the admin accepts a file's terms on its Hugging Face page in a browser.
- Download error with Back and Retry: HAVE (Models page retry).
- Rejected API key prompt: SKIP (no API key).
- Text encoding choice (cloud or local): SKIP (local only).
- Settings modal and page, Cmd-comma: HAVE (Settings app; shortcut is SKIP).
- General Appearance System, Light, Dark: HAVE.
- Auto-enhance switches: HAVE (planned: `video.enhance_prompt`, LTXD-03).
- Fast decode switch: SKIP (engine setting).
- CUDA performance options: SKIP (not Apple Silicon).
- Reckless mode (allow over-budget jobs): SKIP (the machine limit is a safety floor, not a toggle).
- Budget readout badge (14/12 GB): SKIP (resource wording, admin Performance page only).
- Assistant provider choice: SKIP (Home picks its chat engine by its own records).
- Anonymous analytics opt-out: SKIP (Home has zero analytics).
- Models tab with folder, base models, LoRAs, IC-LoRAs, encoders: HAVE (Models page); IC-LoRAs join it with LTXD-07.
- Change models folder with layout migration: HAVE (storage location field, disk map).
- Official versus community disclaimer and Hugging Face link on catalog entries: HAVE (licence and source shown on LoRA records); the community disclaimer line is NEW but tiny, inside LTXD-07.
- LoRA download on first use ("Download and generate"): SKIP (downloads only by the admin; this is the opposite of the privacy rule).
- Model download SHA-256 and size check: HAVE (Stack pins by sha256).
- LoRA library modals with per-LoRA strength: HAVE (STYLES-0x, LoRA library).
- Legacy tab (project folder, default base model, lock seed): SKIP; Lock seed is LTXD-12.
- About tab, version, update switch: HAVE (Updates page).
- LTX model upgrade prompt with dismissals: HAVE (`UPDATES.md` flow; a "new LTX model available" notice is SKIP until a bench says so).
- Dev Panel feature flags: SKIP.
- Log viewer: SKIP (the Stack and Performance pages hold logs for the admin).
- Support menu (Help center, Report an issue, Diagnostic logs): HAVE (Home feedback dialog, `feedback-dialog`).
- Legal links and license disclaimer: HAVE (licence acceptance record).
- Telemetry docs: SKIP (no telemetry).
- Performance runner: SKIP (developer tool; our bench lane exists).

### 6.7 UI polish and micro-interactions

- Gallery home with live preview cards: HAVE (Camera and Look cards play a loop, VIDEO-CREATE-02).
- Cinematic showreel card: SKIP (marketing).
- Reduced-motion respect: NEW to verify (the kit loops and hover play must stop under `prefers-reduced-motion`; a kit test, commons first). LTXD-15.
- Home sidebar rail, compact, drawer: HAVE (shell rail, phone drawer).
- History back and forward buttons and keys: SKIP (the browser has them).
- Quick search with "/" and keyboard navigation: HAVE (`command-palette`).
- Quick search hover preview: SKIP.
- Example media per tool, empty feed shows an example: HAVE for Camera and Look loops; the empty feed example is part of VIDEO-UI-04.
- Packaged seeds ("try with the example input"): NEW (the empty feed offers a starter that loads a sample picture or clip; `VIDEO_STARTERS` exists for words only). LTXD-15.
- Tool details modal and hero player: SKIP.
- Gallery of LoRA examples: HAVE (style cards with a sample loop, STYLES-04).
- Toasts with action and auto-close: HAVE (`Toast`).
- Modal system with confirm hook: HAVE (`DestructiveConfirm`, dialogs).
- Banner, DotsLoader, LoadingPulse, PageLoader, ResultStatus, Progress: HAVE (`AsyncState`, `loading-state`, `Progress`, `job-progress`).
- Video player (Space, arrows, mute, progress): HAVE (`VideoPlayer`, `Player`).
- Audio player with waveform and lightbox: HAVE for playback (`Player`, `music-track`); a waveform, if wanted, reuses the one peaks definition in `TrackStudio`. LTXD-14.
- Audio source menu Upload or Record: HAVE (planned: VIDEO-INPUTS-05 and VIDEO-UI-09).
- Overlay buttons Replace, Remove, Trim on a media monitor: NEW (additive `actions` on the reference slot thumbnail; verify the slot already has Replace and Remove). LTXD-14.
- Sliding segment control, checkbox, tooltip with shortcut text: HAVE (`Chip`, kit `ui` checkbox, tooltip; shortcut text is SKIP on phone).
- Design system parts (Button, Badge, DropdownMenu, Picker, EditableLabel, Skeleton, Stepper, Tooltip, Thumbnail, Avatar): HAVE (kit; one item).
- Theme tokens light and dark: HAVE.
- Skeleton loading states: HAVE (`RouteSkeleton`).
- Text auto-size for the prompt box: HAVE.
- Copy-to-clipboard helper: HAVE.
- Fixed-position menus: HAVE (kit dropdown).
- Aspect-fill and flex primitives: HAVE.
- Cutout checkerboard preview: HAVE (`GenerationStage` `transparency="checker"`).
- Sidebar support FAB: SKIP.
- Unread done dot on the queue: SKIP (RULES S6, no new dot).

### 6.8 Remote and phone UI

Home is already one responsive web app on the household network and Tailscale, signed in per person, so most of LTX Desktop's phone plumbing has no equivalent need.

- Phone browser app (separate SPA): HAVE (Home responsive; one app, no second site).
- QR pairing with one-time grant: HAVE (Home sign-in and the devices page; `qr-code` kit piece).
- Pairing link actions (Copy, Open): SKIP.
- Connected devices list and revoke: HAVE (Devices page).
- Re-scan keeps one device row: SKIP.
- Bearer session in localStorage, no cookies: SKIP (Home has its own session rules, `CREDENTIALS.md`).
- Signed short-lived media URLs: HAVE (shares and attachment reads are checked per request).
- Failed pairing rate limit: HAVE (sign-in lockout per `CREDENTIALS.md`).
- Remote on and off switch: SKIP (Home is always served on the home network).
- Remote hidden when local generation is not viable: HAVE (S6 availability).
- Device activity indicator: SKIP.
- Remote error screens: HAVE (`error-state`, connection state).
- Browser file picker and multipart upload (phone images only): HAVE, and better (Library upload stream takes video and audio too).
- Safe DTOs for the phone (no file paths): HAVE (Home API never sends paths).
- Phone prompt enhancer endpoint: HAVE (planned: LTXD-03; one endpoint for every device).
- Phone LoRA list and catalog preflight: SKIP.
- Phone Hugging Face status: SKIP (admin only).
- Phone quick search: HAVE (`command-palette`).
- Phone download button: HAVE.
- Phone dev panel: SKIP.
- Host-bound runtime adapter: SKIP (one app).
- Remote-only attribution for Reckless mode: SKIP.
- Planned Connect host seam: SKIP.
- LAN address detection: SKIP (Tailscale and the hub address are in Settings).
- Assistant stream stops for a revoked device: HAVE (sign-out ends the session's streams).

### 6.9 Assistant

Home's chat already queues video jobs through `generate_video` and `edit_video` and the model decides (rule 1). Items below are HAVE unless marked.

- Chat that queues local jobs: HAVE.
- Full-page and docked panel share one chat: HAVE (chat app and dock).
- Provider choice: SKIP (no Gemini).
- Local model runtime (llama.cpp, checksum-verified): HAVE (Stack engines).
- Model picker in the composer: HAVE (`composer-model-picker`).
- Attach menu (upload or choose from assets, up to 8): HAVE (`composer-attachments`).
- Ask assistant on an asset tile: HAVE.
- Show assets tool (up to 30 assets in a reply): HAVE (`image-gallery`, `media-viewer`, video card).
- Image and thumbnail viewing sent to the model: HAVE (vision path, small previews).
- Tools list_assets, get_asset, list_generations, list_video_models, list_lora_recipes, extract_frame, wait_for_generation, retry_failed_job: HAVE in part (Library tools, `edit_video`, `continue`); a `retry` change in `edit_video` is HAVE (Another take).
- Job cards in chat: HAVE (the `VideoPlayer` card).
- Up to 12 jobs per request with idempotency: SKIP (Home runs one clip at a time per person by rule).
- Dependent edits wait for their sources: HAVE (planned: VIDEO-CHAT-01 chaining).
- Setting validation with named retries: HAVE (tool argument checks, plain refusals).
- Recipe nudge when the user names a recipe: SKIP (wording matching is banned, rule 1).
- Message queue (Enter queues, reorder, remove): HAVE (`message-queue`).
- Stop with Esc and hold the queue: HAVE (`stopped-run`).
- Continue and Retry request buttons: HAVE (`stopped-run`, `tool-error`).
- Conversation menu, up to 100 chats: HAVE (thread list).
- SSE event stream with heartbeat: HAVE.
- Durable runs in SQLite: HAVE.
- History compaction: HAVE (context never breaks).
- Markdown replies with tables: HAVE.
- Assistant model download and delete: HAVE (Models page).
- Hidden Gemini parallel setting: SKIP.
- Local model waits for a running video: HAVE (Max chat lease).

### 6.10 Hardware and errors

- Compatibility matrix by hardware: HAVE (tiers table, S6 rows).
- Floors (RAM and OS): HAVE (tier admit rules).
- "Coming soon to your device" notice: HAVE (S6 not-ready line with a reason).
- API-only mode: SKIP.
- Picker greys out cells that will not fit, with the reason: HAVE (disabled controls with a reason, K8).
- Streaming offload modes: SKIP (engine).
- Diffusion stage cache: SKIP (CUDA).
- Model eviction and GPU cleaning: HAVE (lease and eviction).
- Pinned-pool fix (Windows): SKIP.
- MPS leak work and prebuilt attention: SKIP (the Stack carries its own runtime).
- VAE decode patch: SKIP.
- Low-performance machine detection and slow warning: HAVE (tier ETA words).
- Measured-only 1440p and 4K: HAVE in spirit (only measured sizes are offered, `LTX25_MAX_EDIT_MEASURED`).
- Error copy for out of memory: HAVE (plain refusals without memory wording; users see "try a shorter or smaller clip").
- Error copy for job too large: HAVE (same).
- Error copy for prompt encoding failed: HAVE (rewrite falls back to typed words).
- Generation error dialog: HAVE (`tool-error`, entry failed line).
- Failure explanations on the dashboard: SKIP (no dashboard).
- Result error cards with Retry and Request access: HAVE (Try again; the Hugging Face request is admin only).
- Edit preflight before submit: HAVE (`ready.ts`, 422 plain lines).
- Offerings gate: HAVE (S6 availability).
- Security headers, path validation: HAVE (Hono middleware, media path guards).
- Logging policy and redaction: HAVE.
- GPU info probe: SKIP (Apple Silicon unified memory; the Performance page).
- Storage info: HAVE (`StorageBar`, disk map).
- Migrations: HAVE (Drizzle).
- Tile-based high-res decode and tiled IC-LoRA: SKIP (engine).

### 6.11 Counts and the best new items

Counted by the first verdict on each line: 189 HAVE (already in Home, the Stack, or owned by a named row), 29 NEW, 98 SKIP, in 316 lines (a few
closely related items share one line, so 316 lines cover the 320 items). A line that is part HAVE and part NEW is counted by its first verdict and
the NEW part is still sliced below.

The ten best new ones, in order of value to a household for the least work:

1. Seed lock with a Seed chip (LTXD-12): the same look twice, a request people make constantly.
2. Prompt undo and redo (LTXD-12): the rewrite makes this necessary.
3. Copy words on a clip (LTXD-12): one More-menu entry.
4. Compare curtain and Source versus Result (LTXD-13): the way to judge an effect.
5. Drag to reorder pending jobs (LTXD-11): within a person's own jobs.
6. Delete blocked while a clip is in use (LTXD-11): prevents a broken running job.
7. Hover play on clip tiles, one at a time, with a duration chip (LTXD-11).
8. Two-thumb window pick for Redo from here and the Voice slot (LTXD-14): the kit Slider, nothing new.
9. Ingredients, many pictures into one video (LTXD-16).
10. Alpha-Gen as one more candidate in the existing cutout bench (LOCAL-BENCH-01): clean subject clips for slides and stickers.

## 7. Build order (backlog rows)

Format is `docs/BACKLOG.md`. Each slice lands alone. Owner-set order (2026-11-06): LTXD-LIC-01 and LTXD-01 first, then the small wins LTXD-12, 11, 13,
14, then the engine slices. Rows that duplicated an existing row are folded into it (list at the end of this section); this note adds no second row for
the same work.

- [x] **LTXD-LIC-01: LTX-2 Community License** (DONE: owner waived on 2026-11-06, "We don't care about the license"). Home's existing licence step stays for the weights it already installs. One duty remains because the 2.x licence asks that AI-disclosure marks and metadata stay in outputs: a task in LTXD-E1 verifies that our ffmpeg conversion keeps them.
- [ ] **LTXD-01: bench the unknowns** (S, Stack bench, owner judges frames). One measured clip each on the Studio: the Claymation 2.3-on-2.5 test of
  section 5; `ltx-2-mlx enhance` with our Gemma folder (and whether it can use a start picture); one IC-LoRA (Day to Night, 327 MB) through `ltx-2-mlx
  ic-lora`; one Lightricks camera LoRA (Dolly In) on 2.5. Time, footprint and true size recorded the video-tiers way. Exit: a verdict row for each in
  `video-speed-bench-2026-11-01.md`; slices below marked go or no-go. The retake `--end` window and the audio lengths are measured under
  VIDEO-INPUTS-04, not here. The gated file needs the existing `voice.hf_token` (section 4).
- [ ] **LTXD-12: prompting aids** (M, commons then Home; pairs with LTXD-03). Seed chip with New seed and Lock seed in the panel's More options
  (`prompt_bar` additive chip; the lock is a person setting, spec first); Undo and Redo of the words (reuse `draft-restore` state first); a typed-versus-
  rewritten flag so a rewrite is not rewritten again; Copy words on every clip (`VideoPlayer` More menu); the same seed seeds the rewrite. Exit: a locked
  seed gives the same clip twice on the Max tier (frames compared); undo steps back through a rewrite.
- [ ] **LTXD-11: queue and library touches** (M, commons then Home). Drag to reorder a person's own pending video jobs on the Queues page (the resource
  priority order stays the floor); a Clear action on the Queues page (no Done section, no unread dot, RULES S6); `media_shelf` `hover_play` (one tile
  plays) with a duration chip; a Library delete refused while the clip is an input to a queued or running job; a search box in My clips. Reuse check:
  household queue, `RunningNow`, `media_shelf`, Library trash, VIDEO-UI-05 and -06. Exit: each exercised on desktop and phone; the refusal line tested.
- [ ] **LTXD-13: compare and result views** (M, commons then Home). `VideoPlayer` additive `compare` prop (Source versus Result toggle and a draggable
  curtain with paired playback); feed "Scroll to newest" and a queue-row link into the feed with a plain line when the clip is gone; Save frame to Library
  in the More menu (the still takes the clip's mark); the active take flag for a group of versions (Library record field, spec first). Exit: Day to
  Night shown as a curtain at 1440 and 390, light and dark.
- [ ] **LTXD-14: window pick** (S, commons then Home; feeds VIDEO-STUDIO-11, VIDEO-INPUTS-05 and VIDEO-UI-09). Reuse, not a new block: the kit two-thumb `Slider` (Radix, takes an array value) placed next to `Player`, not over it; an overlay on the video needs a `Player` slot, which is a commons change first (rule 9(c)) and is not planned here. Min and max clamps: 2 to 10 s for Redo from here, 2 to 20 s for a voice clip, 10 s for an IC-LoRA source. `TrackStudio` (VIDEO-STUDIO-04 and -05) does not fit because it is a full multi-lane studio page, not an inline control on a clip card or in a reference slot; inside the Studio its own trim handles are used. Any waveform uses the one peaks definition (`peaksOf`, moved into `TrackStudio`); no separate waveform lane. Exit: both clamps tested; opened at 1440 and 390.
- [x] **LTXD-02: prompt rewrite on the Stack** (DROPPED by the owner ruling: the engine refuses our Gemma 4 pack; LTXD-03 is Home-only).
- [ ] **LTXD-03: prompt rewrite in Home, with the hub's chat model** (M, commons then Home; no Stack route). The engine's `enhance` refuses our Gemma 4 pack (measured 2026-11-06), so the rewrite runs in Home on the hub's own chat model. Commons first: `PromptBarChip` only picks a value (rule 9(c)), so an Enhance action that rewrites the field is an additive `prompt_bar` prop, tagged. Then Home: the `video.enhance_prompt` setting (spec first, default `ask`), the chat `generate_video` rewrite flag chosen by the model, trigger words and recipe wording sent as "must appear unchanged" and checked after, and the rewrite output through the CSAM screen for adults and the age band's content floor for minors (rule 10). Failures reach the person through the failing call's own response read by `failureCopy`, or the existing muted line under the field (RULES S6); no new banner. Reuse check: `prompt_bar`, `recipes.ts`, the prompt screen in `policy.ts`. Exit: desktop and phone click-through; recipe wording kept; a failed rewrite falls back to the typed words and shows the muted line.
- [ ] **LTXD-04: retake window on the Stack** (S, Stack; needs the VIDEO-INPUTS-04 retake bench). `retake_end_seconds` beside `retake_from_seconds`, 2 to
  10 s window, footprint table row, 422 plain lines. Exit: one real 10 s clip with a 3 s middle window, kept parts within 40 dB of the source as the
  earlier retake was.
- [x] **LTXD-07A, LTXD-07, LTXD-08, LTXD-09: DROPPED, replaced by LTXD-E1 to E3 below** (owner ruling 2026-11-06). No IC-LoRA file is installed, so the `ic` LoRA kind, the `ic_lora` worker mode and the gated-download path are not built.
- [ ] **LTXD-E1: plain looks from what already exists** (S, Stack then Home; no model, no download, one new op). Reuse check, verified in the code 2026-11-06: Stack `editOps.ts` already has `film_look` (`FILM_LOOK_PRESETS`, seven presets, `filmFilters` map), `grade` with a `warmth` field, `sharpen` (`sharpenArgs`, `unsharp` scaled by `amount`) and `denoise` (`denoiseArgs`, `hqdn3d` scaled by `amount`); Home `editTool.ts` already exposes `film_look`, `grade` (with `warmth`) and the `effect` values `sharpen` and `denoise`. So: (1) **Night look** is an 8th `film_look` preset (`night`: darker, cooler, lifted contrast), added to both `FILM_LOOK_PRESETS` lists (Stack `editOps.ts` and Home `editPlan.ts`) and to the picker of FILM-LOOK-UI-01; honest line: it does not turn lights on or add moon shadows. (2) **Warm tone** maps to `grade` `warmth`; no new op; it is a tint, never called colorize. (3) **Sharpen+** is a stronger preset of the existing `sharpen` op (a higher `amount` in `sharpenArgs`); it sharpens edges and cannot recover detail that is not there. (4) **Restore** adds an optional deblock step to the existing `denoise` (an additive `deblock` flag on `DenoiseOp`); it cleans noise and compression blocks, it does not repair scratches or missing pieces. (5) **Ripple** is the only new op: one more `effect` value and one `EDIT_OPS` entry, a whole-frame water-like distortion; a look, not simulated water. Output keeps the source's audio and the AI-disclosure marks and metadata (see LTXD-LIC-01). Exit: each look run on one real clip with frames opened; marks inherited; the metadata check passes.
- [ ] **LTXD-E2: Effects menu in Home** (M, Home; needs LTXD-E1; the model-guided entries need LTXD-E3). An Effects group on a clip's action menu. Entries for the plain looks call the existing changes (`film_look` with `night`, `grade` with `warmth`, `effect` `sharpen` and `denoise`, and `effect` `ripple`); they add no `restyle` value. The `restyle` change of `edit_video` (additive: one new value in the `change` enum and one new `restyle` field) holds only the model-guided entries of LTXD-E3. `VIDEO_EFFECTS` is the one list (id, label, hint, honest quality line, which existing change it calls or `restyle`, templated and demo prompts for the guided ones). Mark inheritance through `newItemMark` with the source as a source, Max-only for the guided entries (the plain looks run on every tier), `allow_suggesting` false. Exit: each shipped effect runs for real from the menu and from chat; a marked source stays marked.
- [ ] **LTXD-E3: model-guided restyle bench** (S, bench, then Home entries; the one row that owns the restyle bench, folded with LOCAL-VIDEO-GAPS-01 in `docs/BACKLOG.md`, whose "restyle of footage" gap it answers). Day to Night, Water and Clean Plate as prompt-guided regeneration through the existing 2.5 `retake` and `extend` source-video path with a templated prompt, no LoRA. Each needs a bench row with frames opened beside the source (one clip, then three if the first holds). No ship if it does not hold the source's composition (subjects, layout and camera path recognisably the same). An entry that fails stays out of `VIDEO_EFFECTS`; Clean Plate (removing people and cars) is the likeliest to fail and is dropped on a failed bench. Exit: a verdict row per entry in `video-speed-bench-2026-11-01.md`.

  Effects with no honest own-way version, dropped (one line each):
  - Colorization: dropped as a real colorizer; only Warm tone (`grade` `warmth`) ships, named as a tint.
  - Water Simulation: dropped as simulation; Ripple (a look) and the Water guided entry (bench) stand in, and neither claims to simulate water.
  - Decompression: folded into Restore (the optional deblock step on `denoise`); no separate effect.
  - Layout to Render: dropped (needs a control model and a look picture; no honest own-way version).
  - Refine Details: dropped (LTXD-17); Sharpen+ is the honest part.
  - Deblur: kept only as Sharpen+ (a stronger `sharpen` amount), not as a deblur model.
- [ ] **LTXD-10: camera LoRA bench** (S, bench then Home; needs LTXD-01, which is done for Dolly In). The ungated Lightricks Dolly In file (an LTX-2 19b file, measured to run on the 2.5 Max pack, 1.9x push-in against 1.4x for the engine's own drift, one clip) is used only if it wins a bench of several clips against the wording-only card; then it is added as a `lora` id (kind `motion`) on the Dolly in card of `recipes.ts`. Dolly Out and the Jib files are added only if each is also ungated and passes the same bench; a gated file is never planned. Morph is VIDEO-INPUTS-03, not here. Exit: a bench row each; no card changes when the LoRA does not beat the wording.
- [ ] **LTXD-15: phone and polish** (S, commons then Home). Verify and test reduced-motion for loops and hover play; wording cards for Dolly out, Dolly
  left, Dolly right and Focus shift in `recipes.ts` (no kit change; `recipes.ts` gains cards, see Supersedes); an empty-feed starter that loads a sample
  picture; check the Download filename follows the words. Exit: opened at phone width; no new kit prop beyond the test.
- [ ] **LTXD-18B: relax the 2.3-on-2.5 LoRA refusal** (S, Stack then Home; supersedes D12 of `video-loras-2026-11-02.md`, see Supersedes). Owner (Jesse, 2026-11-06) wants Claymation-class 2.3 files usable and the bench shows Claymation works. `video/loras.ts` and the TS layer refuse a 2.3-labelled file on a 2.5 clip. Change it to a warning plus a per-file `tested_on_25` mark: a file is marked only after a bench clip changed the output (Claymation did; googlyeyes did not and stays marked as doing nothing). Untested 2.3 files still run with the warning but are not offered by default. The Claymation and googlyeyes results are recorded in VIDEO-LORA-04 (`docs/BACKLOG.md`, proof B6, "a 2.3 LoRA on 2.5"), not in a second bench. Home shows the mark through the existing LoRA record, spec first if a field is needed. Exit: Claymation runs on a 2.5 clip through the Stack route, not the worker directly; googlyeyes keeps its no-effect note; refusal and warning lines tested.
- [x] **LTXD-17: Refine Details** (DROPPED by the owner ruling; no model pass). The honest part is the Deblur/Sharpen look of LTXD-E1. Cutout is not a row: Alpha-Gen stays a candidate in LOCAL-BENCH-01 (its licence is no longer a blocker) and results use `media.companion_clip` (CMEDIA-STACK-01) and the kit `GenerationStage` `transparency="checker"`.
- [ ] **LTXD-16: Ingredients, and research for Motion Track** (L, own design pass first; Stack, Home, possibly commons; no other LTXD row is needed; VIDEO-INPUTS-01 landed). Ingredients: 1 to 10 pictures in the References group, the Stack builds the reference sheet; the clip takes every picture's mark (fix `jobs.ts` line 444, test with one adult-only picture among ten). Motion Track is research only, no commitment to a kit block. Reuse check done now: commons `ui` has the `ImageEditor` Element (`image-editor.tsx`, `image-editor-state.ts`, `image-editor-surface.tsx`) with freehand strokes, brush, undo and redo over a picture; a grep of commons `ui` for path, sketch, signature and draw tools found nothing else; shadcn, assistant-ui and shadcndashboard registries have not been searched by this note. The exit is a design note that (1) reads those registries, (2) decides whether `ImageEditor` strokes can supply the path with the stroke-to-motion conversion in the Stack (one sampler tested against a golden file) or a new block is justified (UI-DECISIONS.md row, rule 9b), and (3) is ruled on by the architect. Exit for Ingredients: one real clip from Create and chat.

Recommended order (owner ruling 2026-11-06): LTXD-12, 14, 13, 11, 03, 04, 18B, then the Effects rows (LTXD-E1, E2, E3), then LTXD-10, 15, 16 last.

Folded into existing rows (no row of their own):
- Redo a part (was LTXD-05): into VIDEO-STUDIO-11 and the landed `edit_video` `retake`, with the 2 to 10 s window from LTXD-04 and the Slider from LTXD-14.
- Audio to video (was LTXD-06): microphone, trim and 20 s limits into VIDEO-INPUTS-05 and VIDEO-UI-09.
- Retake `--end` and the audio lengths bench (was in LTXD-01): into VIDEO-INPUTS-04.
- Morph and the transition (was in LTXD-10): VIDEO-INPUTS-03.
- Style strength control (was in LTXD-15): already built in VIDEO-LORA-09.
- Reverse, flip and grade presets (was LTXD-18, ruled DUPLICATE): reverse and flip are in Stack `EDIT_OPS` and Home `edit_video` `effect` (51662dbc8); the seven grade presets are the seven `film_look` presets, picker FILM-LOOK-UI-01.
- Cutout (was in LTXD-17): CMEDIA-STACK-01, LOCAL-BENCH-01 and `GenerationStage` `transparency="checker"`.

## Supersedes

Rows and lines this note replaces or adds to (each is edited in the slice that builds it, with `Owner-approved` only where a rule is touched; none is):

- `video-studio-2026-11-02.md` line 184 ("Redo from here (Max)", "regenerate from the playhead to the end handle"): for the window only, 2 to 10 s
  chosen with a two-thumb `Slider` instead of "to the end"; placement on the clip card's More menu and the chat video card. The `tier.max` grant stays.
- `video-chat-2026-11-02.md` line 56 (the `retake` row) and line 97 (C6): the retake gains a window; the arguments stay `from_s` and `to_s` (no rename) with `to_s - from_s` between 2 and 10 s; still one `edit_video` change through `makeVideoFor`. The `editTool.ts` top comment ("`retake` is not here") is stale and is corrected by the first slice that touches the file.
- VIDEO-INPUTS-05 limits: microphone record, trim, minimum 2 s, maximum 20 s (10 s at the largest size). VIDEO-INPUTS-06 (Home side landed in 980e0c43f): only the retake window above is added.
- Library delete (Library trash and `libraryTrash.ts`): refused while the clip is an input to a queued or running job (new, LTXD-11).
- Household queue order (`lib/jobs/householdQueue.ts`, resource priority order of 2026-10-21): a person may reorder only their own pending video jobs;
  the order across kinds and people is unchanged.
- `recipes.ts` camera cards: gain optional `lora` ids (kind `motion`) and four wording cards; the card text and ids already there stay.
- `video-loras-2026-11-02.md` D12 (line 36, "A 2.3 file is used on 2.5 only after the bench marks it compatible"): changed by LTXD-18B to "A 2.3 file is used on 2.5 with a warning; a file the bench has shown to change the output carries a `tested_on_25` mark and may be offered; an untested file runs but is not offered by default." The first clause of D12 (use only with the file's own base) stays for Wan and for an unknown base. The record table gains no `ic` kind (LTXD-07A is dropped; no IC-LoRA is installed); a `tested_on_25` field is added only if the existing record cannot hold the mark.
- `edit_video`: gains the `restyle` change (LTXD-E2), additive; the existing `effect` list is not changed.
- VIDEO-INPUTS-03 gains the mark rule for its start and end pictures (section 3).

## 8. Owner questions

Answered by Jesse, 2026-11-06:

1. Max only for retake and the first effects: **answered, OK.** Lower tiers need their own bench later.
2. Prompt rewrite default: **answered, ASK.** An Enhance chip; setting `video.enhance_prompt` defaults to `ask`.
3. LTX-2 Community License for the Lightricks effect and camera files: **answered, waived (Jesse, 2026-11-06, see the ruling near the top).** LTXD-LIC-01 is done; the plan no longer depends on any gated Lightricks file.
4. Build order: **answered.** LTXD-01 bench first, then the small wins LTXD-12, 11, 13, 14, then the engine slices.

Still open (my recommendation in brackets):

5. Voice clip proof: worded as a Home-to-Stack check that asks the person nothing (voices-2026-10-18.md line 217). Confirm that is all that is needed. [Yes.]
6. Drop the community IC-LoRAs and the LTX Desktop styles (Cozy Felt and the rest) from this plan? [Yes; styles are STYLES-0x's.]
7. Seed lock: a person setting shared on phone and desktop, or per page only? (LTXD-12) [Shared person setting.]
8. Reordering the queue: only inside a person's own pending video jobs, or may an adult move any job? Chat and images keep the resource priority
   order either way. (LTXD-11) [Own jobs only.]
9. Compare curtain and Source versus Result: every edited clip, or only effects and retakes? (LTXD-13) [Effects and retakes only.]
10. Motion Track is now a research row inside LTXD-16 (reuse check and design note, no kit block promised): confirm it is worth the research, and in what order against audio to video? [Last, after the Effects rows.]
11. Cutout: folded into the existing cutout bench (LOCAL-BENCH-01); should Alpha-Gen join that bench? The licence no longer blocks it (waived 2026-11-06). [Yes.]
12. Pro-editor features (multi-track timeline, XML export and import, keyboard presets): confirm skip. (section 6.2) [Skip.]
