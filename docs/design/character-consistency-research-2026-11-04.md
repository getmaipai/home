# Keeping a character, pet, person or product the same across pictures and clips (research, 2026-11-04)

Status: research and a bench plan only. Nothing built, nothing downloaded. Companion to
[images-app-2026-11-03.md](images-app-2026-11-03.md) and [images-leader-chatgpt-2-5-2026-11-04.md](images-leader-chatgpt-2-5-2026-11-04.md) (rows 1, 3 and 13).
Rules that bound every answer: everything runs on the Studio (M5 Max, 128 GB), open licence only, no phone-home, likeness and child rules
in [likeness-consent-2026-10-17.md](likeness-consent-2026-10-17.md) and [content-policy-2026-10-18.md](content-policy-2026-10-18.md).
Web claims below come from vendor pages, model cards and community posts found 2026-11-04; "unverified" marks what I could not confirm at the source.

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

- **Real people:** a likeness LoRA is a model of a person's face kept on the Studio. Adults only per the 2026-10-17 ruling; stored in the household LoRA
  library with the household as owner; the Stack proof still binds each use. Nothing here changes the minor line: any possible-minor output
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
5. Should a saved subject (sheet) be shared household-wide or private to its creator? Recommend: private by default, shareable.

## Not checked

Qwen-Image-Edit-2511 date and licence come from HF mirrors; PuLID's own licence text; whether mflux trains Klein 4B directly on this Mac and how fast;
LTX-2.5 reference-to-video specifics; any open Apple-Silicon face-embedding licence. The bench settles the speed and quality ones.
