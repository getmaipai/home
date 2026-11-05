# Keeping a character, pet, person or product the same across pictures and clips (research, 2026-11-04)

Status: research and a bench plan only. Nothing built, nothing downloaded. Companion to
[images-app-2026-11-03.md](images-app-2026-11-03.md) and [images-leader-chatgpt-2-5-2026-11-04.md](images-leader-chatgpt-2-5-2026-11-04.md) (rows 1, 3 and 13).
Rules that bound every answer: everything runs on the Studio (M5 Max, 128 GB), open licence only, no phone-home, likeness and child rules
in [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md) and [content-policy-2026-10-18.md](content-policy-2026-10-18.md).
Web claims below come from vendor pages, model cards and community posts found 2026-11-04; "unverified" marks what I could not confirm at the source.

## Supersedes

- The approved `video-reference` and `video-project` records and the V4 "Characters and Places" step (video-create-2026-11-01.md, VIDEO-CREATE-01): replaced by the single saved-subject record (character, prop, place) and `media_production` below. Migrate before delete (port-before-delete rule).
- Companion pictures stay in the companion store; a companion can also be cast as a character.

## Owner decisions (Jesse, 2026-11-04)

1. Per-subject training is allowed for invented characters, pets, mascots and products; real adults go through the household likeness option like any likeness LoRA (no extra consent prompt, rule 0).
2. Real children: the architect ruled (2026-11-05) this is allowed as an added child protection with these conditions: applies to every minor; off by default; per child; only a parent or admin can switch it on, never the child or teen; revoking it deletes the trained LoRA; every output counts as a known minor for the CSAM check (rule 10); children never get it in their own lane. Jesse chose "parent opt-in only".
3. An opt-in slow "Careful" re-render (about 6 minutes, 39 GB) is allowed. Training and Careful progress show on the job's own card (S6), never a raw error.
4. Saved subjects are private to their creator; sharing is an explicit per-item Share. The container for shows, movies and YouTube is a Production.
5. `media_production` and the saved-subject record carry id, provenance and clock stamp from first boot (principle 3) and are defined in `commons/spec` first (additive).

## 1. What we already have

- **Picture engine (Stack, mflux):** FLUX.2 Klein 4B (Quick, Apache-2.0), Z-Image-Turbo (Detailed), ERNIE-Image-Turbo (text-to-picture only).
  Qwen-Image-Edit-2511 was tried in the 2026-10-25 bakeoff but is not in the catalog.
- **Reference editing, measured:** Klein 4B edit takes 20 to 28 s and 10 GB; all 5 edit cases correct. Qwen-Image-Edit-2511 (8-bit, 20 steps)
  also correct and kept subjects, but 330 to 364 s and 39 GB. ERNIE image-to-image ignored the edits. Source: `home/data-scratch/bakeoff/RESULTS.md`.
  Klein reference edit is 8.4 s warm in the companion note. Klein holds scene identity; characters and people are unmeasured.
- **Home:** `picture.change` takes up to 2 references (IMG-OPS-05, landed). Klein itself accepts up to 4.
- **Companion character sheet (CMEDIA-LOOK-01..04, built):** per-companion picture store, background removal, four candidates, a rest picture,
  three-quarter left and right by Klein reference edit, a person approves. Every clip starts from the rest picture; best of N seeds picked by a
  measured colour and embedding check (`companion-video-characters-2026-10-21.md`). Its own table says sheet views by Klein hold identity: "to measure".
  That note also names a small LoRA on approved views as "drift insurance for later, training on the Mac unmeasured".
- **LoRA use (not training):** `lib/pictures/adapters.ts` lists the household's styles from the Stack (IMGGEN-LORA-01). The bakeoff found the Z-Image
  portrait LoRA changed almost nothing and the Klein anime LoRA changed the look. Video has a LoRA path (clay LoRA measured on LTX, VIDEO-LORA rows).
  There is no per-subject LoRA trainer anywhere in Stack or Home.
- **Video:** LTX-2.3 22B distilled on MLX (LTX-2.x Community Licence, 2026-08-11). VIDEO-INPUTS-01 adds a start picture and optional end frame;
  VIDEO-INPUTS-03 the slots; End frame needs a bench. Not built yet.
- **Likeness rules:** an adult may make pictures, videos and a likeness style of a household member; the household option replaced per-person
  agreements (LIKENESS-SIMPLIFY-01). Lines that stay: nothing sexual involving a minor or minor-looking person; child and teen lanes keep their
  filters and the no-real-people rule; the Stack checks an Ed25519 proof bound to the picture hash.

## 2. What the field offers (late 2026)

| Method | Subject types | Training? | Mac speed (our data or estimate) | Open licence | Main failure | Fit to our rules |
|---|---|---|---|---|---|---|
| Reference edit: FLUX.2 Klein 4B, up to 4 refs ([BFL docs](https://docs.bfl.ai/flux_2)) | Cartoon, pet, product, person (weakest on faces) | No | 8 to 28 s, 10 GB (measured) | 4B Apache-2.0; 9B is FLUX non-commercial | Small face and logo detail drifts; text garbled | Best fit: already shipped, local |
| Reference edit: Qwen-Image-Edit-2511, 20B, multi-ref ([HF card, Dec 2025, date unverified](https://huggingface.co/maxcreates/Qwen-Image-Edit-2511)) | All; card claims better person identity than 2509 | No | 330 s, 39 GB (measured) | Apache-2.0 | Slow; sign text changed in our test | Fits; use as the quality tier, not the default |
| FLUX.1 Kontext dev | Characters, products | No | Not measured on our Stack | FLUX non-commercial (household use only; same worry as FLUX 9B) | Less identity than newer models | Weak: licence, and superseded by Klein |
| Identity adapters: IP-Adapter-FaceID, InstantID, PuLID(-FLUX) | Real faces only; useless for pets and products | No | Needs ComfyUI/torch path, not in mflux; unmeasured | Code Apache/MIT, but they load InsightFace weights, which are research and non-commercial only ([InsightFace](https://github.com/deepinsight/insightface/wiki/Tutorial), [discussion](https://huggingface.co/h94/IP-Adapter-FaceID/discussions/77)); PuLID mirror tags Apache ([unverified](https://github.com/ToTheBeginning/PuLID)) | Plastic "pasted face"; licence risk | Poor: licence, a face-embedding model of real people, extra stack. Skip |
| Character sheet as reference (our Look tab; Kontext turnaround LoRAs by [Scenario](https://help.scenario.com/en/articles/generate-character-turnarounds/)) | Cartoon, mascot, product; photos work less well | No | One Klein edit per view, about 10 to 30 s | Same as the editor | Sheet-copy: model repeats the layout; tell it one figure per picture | Good: human approves, already designed |
| Per-subject LoRA, Klein 4B base via mflux / [mflux-lora](https://pypi.org/project/mflux-lora/) (wrapper asks 32 GB+, 48 GB recommended; third-party) | All; strongest for pets, products, cartoon; person likeness strong | Yes, 15 to 30 clean pictures for a focused subject, 40 to 60 if robust ([RunComfy Z-Image guide](https://www.runcomfy.com/ja/trainer/ai-toolkit/z-image-character-lora-dataset-guide); a Reddit user preferred about 60, anecdotal) | **Unmeasured on our Mac.** Klein LoRAs are not cross-compatible between 4B and 9B ([lilting.ch](https://lilting.ch/en/articles/flux2-klein-4b-mflux-iris-m1-max)) | Klein 4B Apache; trained file is the household's | Overfit (copies the training pose and background); needs bench | Needs care: real people (consent), children (see section 4) |
| Video: start picture at frame 0 on LTX-2.3 ([LTX guide](https://ltx.io/blog/how-to-maintain-character-consistency-in-ai-video)) | Cartoon, mascot, pet; face drifts once the person moves | No | Measured in video bench (about 15 s clip, 43 GB peak) | LTX community licence (free under the revenue limit) | A GitHub issue reports face and clothes changing from the start picture ([LTX-2 #255](https://github.com/Lightricks/LTX-2/issues/255)) | Fits; reference-sheet IC-LoRA is gated on HF and needs a licence click, check before use |
| Video: character LoRA on LTX | All | Yes (LTX trains LoRAs, [Lightricks](https://ltx.io/blog/training-your-first-lora-on-ltx)) | Unmeasured; video training is much heavier than picture training | As LTX | Identity drift across cuts is the listed typical failure | Later; only after the picture LoRA works |

OpenAI: Images 2.5 (2026-09-08) and 2.6 (2026-11-04) claim reference photos keep a subject recognisable, edits change only what was asked, and
many edits in a row stay consistent. These are vendor claims on a closed cloud model; we copy the idea, not the model. A search for independent
2.6 numbers found none. One independent benchmark found the best of 15 models averages 3.89 of 5 on character consistency over 3 scenes
([img.ly](https://img.ly/ai-benchmarks/findings/consistency.md)), so expect gaps and plan a person-approves step.

## 3. Drift in repeated edits

Papers report repeated edits lose high-frequency detail, brighten the picture and "beautify" it ([FreqEdit, CVPR 2026](https://cvpr.thecvf.com/virtual/2026/poster/39055),
[low-frequency drift, NeurIPS 2026](https://neurips.cc/virtual/2026/poster/151149), [multi-turn survey](https://arxiv.org/pdf/2604.03400)). Cheap fixes we can use without new models:
1. Keep PNG, never re-compress between steps (already in the plan).
2. Every edit also receives the original approved picture (or the sheet) as a second reference, so identity is pulled back each turn.
3. Where the edit is local, paste the changed area back onto the untouched picture using the mask, so the rest is byte-identical.
4. Batch several wishes into one edit instead of a chain; after 3 chained edits offer "start again from the original".
5. Measure drift, do not trust the eye: no-reference quality scores miss it (same sources).

## 4. Safety and rules notes

- **Real people:** a likeness LoRA is a model of a person's face kept on the Studio. Under the household likeness option (SAFETY.md); stored in the household LoRA
  library; the Stack proof still binds each use. Nothing here changes the minor line: any possible-minor output
  in sexual media is withheld.
- **Children:** a child's face must never train a LoRA by default (no-real-people rule for child and teen lanes; a parent-owned decision at most).
  Cartoon characters a child invents are fine; reference edits of a child's photo stay inside the child lane filters. This needs Jesse (question 2).
- **No phone-home:** trainers (mflux, ai-toolkit) must be pinned and run offline; weights fetched through the Stack catalog like other models.
- **Face-embedding scores** (for our bench) use a local model; check its licence first (InsightFace's are research only; prefer an Apache or MIT one).

## 5. Recommended ladder (cheapest first)

0. **Edit chain hygiene** (section 3). No model work.
1. **References:** Klein 4B with 1 to 4 pictures of the subject, original always included. Default for everything. Works today.
2. **Character sheet:** a saved "subject" (companion, pet, product): approved front, three-quarter left and right (plus back for products), one
   figure per picture, plain background. Sheet pictures become the references. Generalises CMEDIA-LOOK-03 (IMG-SERIES-01).
3. **Quality tier:** Qwen-Image-Edit-2511 as an opt-in "Careful" re-render when Klein fails the likeness score (about 6 minutes).
4. **Per-subject LoRA on Klein 4B:** only when step 1 and 2 fail the score on a subject the household keeps using (family pet, mascot, product line).
   Dataset built from the sheet plus real photos; the household approves; stored as a labelled style.
5. **Video:** start picture from the approved rest picture on every clip (re-pin each time, as the companion plan already does); End frame once benched;
   video LoRA last.
Skip identity adapters (licence and fit).

## 6. Bench plan (IMG-BENCH-01 extension, runs on the Studio, one model at a time, seeded, load logged)

Ten cases, 3 seeds each, subjects and scenes use demo-household personas and stock or generated pictures only (no real family in the repo):
1. Cartoon mascot (2 refs), new scene.   2. Cartoon, new pose and outfit.   3. Dog from 3 photos, new scene.
4. Cat, indoor to outdoor.   5. Product (bottle with logo), new background and angle.   6. Product, on a shelf with other items.
7. Adult demo face, new scene (generated person, not a real one).   8. Two subjects together (2 refs).
9. Six-edit chain on one picture.   10. Sheet build: front to three-quarter left and right, then use as refs.
Arms: Klein 1 ref, Klein 4 refs, Klein with sheet, Qwen-Image-Edit-2511 with sheet, Klein plus a trained LoRA (cases 1, 3, 5 only).

Scoring:
- **Likeness:** (a) local image-embedding cosine to the reference (DINOv2 for objects and animals, an openly licensed face model for faces),
  (b) logo and text check by reading the picture with the Stack's chat model, (c) a blind A/B by Jesse on a contact sheet, 1 to 5. (c) decides.
- **Edit locality:** mean pixel difference outside the edit region (target near 0).
- **Drift:** in case 9, embedding distance and mean brightness of each step to step 0; flag if the distance grows each step or brightness moves more than 5 percent.
- **Cost:** seconds, peak memory, load average.
- **LoRA trial (once, Klein 4B):** 20 sheet-plus-photo pictures, record minutes, peak memory, whether it overfits (copies background across 5 prompts).
  A real-person test uses only the demo adult; a real person's LoRA waits for Jesse.
Pass bar: an arm is the default for a subject type when it scores at least 4 of 5 blind on 8 of 10 cases and drift stays flat over 6 edits.

## 7. Open questions for Jesse

1. **Is a trained per-subject LoRA wanted at all** (pets, mascots, products, family adults), given training cost is unmeasured and it stores a model of a face on the Studio? Recommend: bench one, decide after.
2. **Children:** may a child's photos ever train a LoRA or be a long-lived "subject" (parent-approved), or never? Recommend: never for real children; cartoon characters they invent are fine.
3. **Is a 6 minute "Careful" re-render (Qwen-Image-Edit-2511, 39 GB) acceptable** as an opt-in, or only Klein speeds?
4. May the bench use CivitAI-style character LoRAs or only models in the Stack catalog? Recommend: catalog only.
5. ~~Shared household-wide or private?~~ Decided by Jesse 2026-11-04: private to the creator, never in a family library; sharing only as an explicit per-item Share. Household companions (CMEDIA) keep their own household store.

## 8. Per-shot consistency for video (characters, objects, scenery)

Jesse's addition (2026-11-04): a shot must keep its character, its objects and its scenery. Sources are dated as found 2026-11-04.

### 8.1 What we already have for shots

- **Designed, not built:** `video-create-2026-11-01.md` plans `generate_video` inputs `start_frame`, `end_frame`, `character`, `place`, `recipe`; backlog
  VIDEO-CREATE-01 V4 "Characters and Places, spec first" and V5 Storyboard, stitch, voice overlay. Its pick: a character is saved reference pictures, no training first.
- **Built or queued:** `continue` (last frame of a clip, then a picture start; EDITOR-15), `join` (cut or crossfade, up to 6 pieces), the Studio edit
  surface (VIDEO-STUDIO-*), VIDEO-INPUTS-01 picture start and optional end frame on LTX-2.5, VIDEO-INPUTS-03 Start and End slots (End needs a bench),
  VIDEO-INPUTS-06 extend and retake. Companion clips already work from one approved rest picture (CMEDIA-STATES). `media_template` is one record for
  images and later videos (IMG-TPL-01).
- **Missing:** a saved object or scenery, one shot list that says who, what and where, and any measure of sameness from shot to shot.

### 8.2 One shared concept: the personal Cast, Props and Places library

One definition (principle 4), used by Create (images), the Studio, templates, chat tools and video shots. V4's "Characters and Places" becomes this, with Props added.
- **A saved subject** has: a name; a kind (character, prop, place); who owns it; **private to its creator, never listed for the household** (owner ruling 2026-11-04: custom video characters are not a family library); sharing is an explicit per-item Share to named people, off by default; a one-line look
  description (words the tools start from); approved reference pictures; for a character a voice (optional); a "real" flag when it is a real person or
  animal (a label only; the household likeness option and the minor line decide what is allowed, no consent prompt blocks an adult request); the pictures' provenance and clock stamp like every record; optionally a trained style (LoRA) from step 4 of the ladder.
- **References by kind:** character = front, two three-quarters, back, one close face (section 5, step 2). Prop = front, side, top, one in-use picture, on plain background.
  Place = one wide establishing plate, plus 3 to 4 angles of the same room or spot (made by editing the plate), no people in them, plus a time-of-day variant if needed.
- **Where it lives:** a spec record in `commons/spec` (additive, spec first, like `media_template`); the files in the Library; companions are characters
  that also have states. Home owns it; the Stack only receives pictures.
- **How a shot picks subjects:** a shot lists its subjects (who, what, where) by name. Chat resolves names ("Rex on the beach with the red kite") the way it resolves
  styles today; Create shows chips. The shot's first frame is built from at most 4 references: the place plate first, then the characters, then the prop.
  More than 4 subjects in one frame is refused with a plain line (split the shot).

### 8.2a Three scopes: house, person, person per production (owner model, 2026-11-04)

Jesse's example: using video generation to make TV shows, movies and YouTube content. Each show has its own characters; one character (an "actor") can appear in two shows.

| Scope | What lives there | Who sees it | Today |
|---|---|---|---|
| **House** | household companions (CMEDIA), household styles, shared templates | everyone, by household rules | exists |
| **Person** | that person's saved characters, props and places (their "talent pool") | only them; Share is an explicit per-item action to named people | new, section 8.2 |
| **Person per production** | a **Production** (a show, a movie, a YouTube channel or series, a one-off video) with its **cast, props and places for that production**, its shot list / storyboard, its finished clips | only the creator (and anyone they Share the production with) | new |

Rules:
- **Reference, not copy.** A production's cast is a list of references to the person's saved subjects. An actor in two shows is one saved character cast in two productions:
  fix the face once and both shows follow. A change to the character's approved pictures is offered to each production that uses it, never forced into a finished episode.
- **Role in a production** is a small per-production layer over the actor: role name, wardrobe or look variant (extra approved references), voice choice, notes. So the same
  actor can wear a different costume or age in show B without changing show A. A look variant belongs to the production unless the person promotes it to the actor.
- **Production-only subjects** can be created inside a production (a one-off monster); they live in that production and can be "moved up" to the person's pool later.
- **Places and props** work the same way (a set used in two shows is one place).
- **Deleting** a production never deletes the actors in the person's pool; deleting an actor that is cast in a production asks first and names the productions.
- **Privacy:** nothing in a production is visible to the household by default; the Library shows a production's finished files to its creator only until shared.
- **Name (Jesse chose "Productions", 2026-11-04):** "Project" already means a background harness job, and "Studio" already names the editor page in Videos, Music and Images, so neither is used. The record is a `media_production`.
- **Fits the storyboard:** the Storyboard strip (video-create-2026-11-01.md, EDITOR-12) belongs to a production; its shots name their subjects from the production's cast.
- **A production holds:** script (episodes, scenes, shots), cast, sets and props, clips and first-frame pictures in order, music and voice lines, and the finished cuts. Other media (pictures for a comic or thumbnails for a channel) can live in it too.
- **Images use it too:** a production can hold pictures (a comic, a poster set) with the same cast.

Open question for the architect: one `media_production` record shared by Videos and Images, or Videos first. Recommend one record, kind-agnostic (like `media_template`).

### 8.3 Per-shot method, cheapest first

1. **Keyframe first.** For each shot, make its first frame as a picture (Klein 4B, subject references, place plate as one reference), the person approves it, then
   animate that frame. This moves the hard consistency problem into the image engine we already measured, and a person can fix one picture cheaply.
   LTX's own guide calls anchoring to a reference at frame 0 the most accessible method and says to reuse the same reference in every clip
   ([LTX](https://ltx.io/blog/how-to-maintain-character-consistency-in-ai-video)).
2. **Re-pin every clip.** A continued clip starts from the approved reference or a re-edited last frame, never from the raw last frame alone (the raw last frame carries the
   previous clip's drift). Chunk long shots into short segments and chain by keyframe; sources agree consistency over time is the weak point
   ([review of LTX-2.3 modes](https://www.mindstudio.ai/blog/ltx-2-3-video-to-video-modes-results)).
3. **First and last frame pinning.** LTX-2.3 takes guide images at chosen frame positions in ComfyUI workflows ([RunComfy](https://www.runcomfy.com/comfyui-workflows/ltx-2-3-first-last-frame-in-comfyui-keyframe-to-smooth-video));
   a community post saw the last frame come out blurrier without re-conditioning at the upscale stage ([post](https://t.me/s/rStableDiffusion/61914)). We have it only as a
   plan (VIDEO-INPUTS-01/03); bench first. Pinning both ends of a shot also locks the scenery start and end.
4. **Scenery lock.** Make the plate once; every shot's keyframe is an edit of the plate (character added to it), so walls, light and layout come from one source. Moving
   camera shots: pin a first frame from a new angle of the plate. Pure video models do not remember a room between clips; the plate is the memory.
5. **Objects.** A prop is held in the keyframe (reference edit places it). Inside the clip the model may morph it, so keep prop shots short (about 4 s) and
   the prop large in frame; check with the object score. Fallback: composite a cut-out prop over a generated clip (we already cut out backgrounds). No open
   LTX reference-to-video for objects was found.
6. **Open reference-to-video exists on Wan, not LTX.** Wan2.1 VACE (Apache-2.0) takes reference faces, animals and objects; Phantom (up to 4 references) and MAGREF do
   multi-subject ([VACE](https://arxiv.org/html/2503.07598v1), [summary](https://nathanshipley.github.io/banodoco-kb/kb/wan/index.html)). Jesse rejected Wan on quality
   (2026-11-01), so this stays a comparison bench arm only, not a plan. Wan 2.7 R2V is hosted; its open status is unconfirmed.
7. **LTX today, honestly.** LTX-2.3 (what the Stack runs): start picture and first/last guides; an official reference-sheet IC-LoRA (character, props, locations on a
   sheet) is gated on Hugging Face ([card](https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Ingredients)) and its licence terms must be read before use; users report
   image conditioning can change face, hair and clothing ([LTX-2 issue 255](https://github.com/Lightricks/LTX-2/issues/255)). LTX-2.5 claims native multi-shot scenes,
   but the only source is one third-party guide (unverified). Treat reference-sheet and multi-shot as "to bench", not "can".
8. **Length and seed.** Short shots (4 to 6 s) hold identity better; one third-party comparison saw face drift past about 6 s on Wan
   ([comparison](https://magichour.ai/blog/ltx-2-3-vs-wan-2-2)), and LTX shows similar behaviour in user reports. Keep a seed per shot; run best of 3 seeds scored by the
   section 8.5 score, as the companion pipeline does. Crowded, many-subject prompts hurt consistency ([same sources](https://www.eachlabs.ai/ltx/ltx-v2-5/ltx-2-5-audio-to-video-pro)).
9. **Voice.** LTX makes sound, and its audio-to-video path holds a given voice across shots (vendor claim, untested by others). Safer for us: make dialogue with our own
   speech tool in the character's voice and lay it over silent or lip-synced shots, as VIDEO-STUDIO already does (`synthesizeSpeech`, `mix`). Same voice from the library record.
10. **Careful mode (opt-in, slow):** Qwen-Image-Edit-2511 for the keyframe (6 min each), more seeds, a post-render score with automatic retry up to 3 times, and a person approves
    each keyframe. Offered when the quick score fails.

### 8.4 Drift across a chain of clips, and how to measure it

Drift grows each hand-off (last frame to next start). Measure on every clip: compare sampled frames (first, middle, last) to the subject's approved references.

### 8.5 Per-shot score

For each shot, 1 to 5 each: **character match** (face-embedding or DINOv2 cosine to the sheet plus a chat-model check of clothes and colours), **object match** (DINOv2
crop similarity plus the model reading logo/text), **scenery match** (global-embedding and colour-histogram distance to the plate, layout check by the chat model),
and **motion sanity** (no morphing, flicker; frame-difference spike count). The blind A/B by Jesse on a contact sheet (three frames per shot) decides; the numbers
flag regressions. Chain drift = the slope of character and scenery scores across shots 1, 2, 3.

### 8.6 Video bench cases (add to section 6; cheapest first)

- **V0 (minutes, picture engine only):** build the keyframes for the 3-shot sequence below with Klein and the plate; score them. If keyframes fail, video cannot pass.
- **V1:** 3-shot sequence, one cartoon character, one prop (red kite), one place (beach plate). Shot 1 wide, shot 2 close-up of the prop in hand, shot 3 a new
  angle of the same beach. Arms: (a) text only, (b) keyframe-first from references, (c) keyframe plus last-frame pin, (d) raw last-frame chain with no re-pin.
- **V2:** same with a pet from 3 photos.   **V3:** same with a product (bottle) as the prop.
- **V4:** 6-clip continue chain, measure the drift slope with and without re-pinning.
- **V5:** the reference-sheet IC-LoRA (once its terms are read) against keyframe-first; Wan VACE as a comparison arm only.
- **V6:** voice: one character speaking in 3 shots, our speech tool against LTX audio-to-video, listen blind.
Run V0 and V1 first (one LTX clip is about 15 s at 43 GB peak, so only one at a time, chat unloaded per the resource order). Two seeds each, then best of 3 for the winner.

### 8.7 Rules for the video part

Local only, nothing fetched at run time (the IC-LoRA needs a one-time licence accept, a Jesse step). Real adults: household option and the Stack proof as today. Real
children: the owner chose a real child's photos only with parent opt-in, and the architect rules on that first, so the library blocks a "real" child subject until it does;
invented characters are fine. The adult/teen/child gates stay in front of every shot. A prop or place with a real person visible counts as a real-person subject.

### 8.8 New open questions

1. Rename V4 "Characters and Places" to Cast, Props and Places and add Props now (recommended: yes, one record, spec first)?
2. Is a shot limit of 4 references per frame and 4 to 6 s per shot acceptable for the first release?
3. Read and accept the gated reference-sheet IC-LoRA terms for the bench (your step, one click)?

Unverified in section 8: LTX-2.5 native multi-shot, LTX audio voice holding across shots, any LTX reference-to-video for objects, and whether the IC-LoRA runs in our MLX build.

## Not checked

Qwen-Image-Edit-2511 date and licence come from HF mirrors; PuLID's own licence text; whether mflux trains Klein 4B directly on this Mac and how fast;
LTX-2.5 reference-to-video specifics; any open Apple-Silicon face-embedding licence. The bench settles the speed and quality ones.
