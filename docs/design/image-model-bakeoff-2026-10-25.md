# Image model bakeoff and the create-plus-edit design (2026-10-25)

Status: decision record plus bench result. Built 2026-10-25: slices 1 and 2 (ERNIE as a Stack family with pinned weights, Quick means ERNIE in Home when it is installed and falls back to Klein, edits stay on Klein, the picture pool with the memory note's slice 3) and slice 4 (the markers in the 2026-10-17 note). Open: slice 3, the regression bench that reads the text back, and the person-facing copy of the spec-owned `generation.picture_quality` setting, which still says Quick takes a few seconds (a change to it goes spec first and needs Jesse's tag).
It extends [image-engine-2026-10-17.md](image-engine-2026-10-17.md) and, for the new-picture default only, supersedes its section 16
ruling that Klein is the default on every tier (see section 5 for what stays).

Owner approval: Jesse asked on 2026-10-24 for better text in generated pictures than Quick (FLUX.2 Klein 4B) while keeping the edit
features (add a person, remove a person, make it sunny), then asked for an overnight bakeoff of every candidate, and on 2026-10-25
agreed with the design in section 4 ("Ok I agreed with your design. Record it and all our findings").

Hardware for every number: Apple M5 Max, 128 GB unified memory, macOS 27, mflux 0.23.0 (MOSS-Image and Iris from mflux main, same
version string), 8-bit weights, seed 7, 1024 x 1024, one process per picture, so a time includes loading the model. **The Studio load
average was 25 to 50 during every run** (the chat model and other sessions), so every time here is slower than a quiet machine
(earlier quiet-machine numbers: Klein 4.0 s, Z-Image 12.9 s). Compare the models to each other, not to a stopwatch.

## 1. What was tested

Six text-to-picture models, 22 prompts each: 5 text (a neon sign, a bakery sign, a jazz poster, a chalkboard menu, a birthday card),
3 photo, 2 anime, 2 cartoon, 2 historical figures, 6 pop culture (the Terminator, Mario, Darth Vader, Spider-Man, Pikachu, Batman),
1 adult-content test (a fictional adult in lingerie) and 1 gore test (a horror zombie). The last two exist to see what each model
will draw, refuse and how well; policy for them is unchanged and lives in [content-policy-2026-10-18.md](content-policy-2026-10-18.md).

| Model | Steps | Licence |
|---|---|---|
| FLUX.2 Klein 4B (Quick today) | 4 | Apache-2.0 |
| Z-Image-Turbo (Detailed today) | 9 | Apache-2.0 |
| ERNIE-Image-Turbo (Baidu, 8B) | 8 | Apache-2.0 |
| Boogu-Image 0.1 Turbo | 8 (4 also tried) | Apache-2.0 |
| MOSS-Image SFT | 50 | Apache-2.0 on the card, with caveats on weights |
| Iris-3B | base | Apache-2.0 |

Rejected on licence before any run: Qwen-Image 2.1 (research licence), Ideogram 4 (non-commercial weights), FLUX.3 Klein and Krea 2
(revenue-limited or non-commercial). Boogu Edit exists on Hugging Face but mflux cannot run it, so it was not tested.

## 2. Results: new pictures

| Model | Mean time | Peak memory | Text | Notes |
|---|---:|---:|---|---|
| Klein 4B | 16.9 s | 10.2 GB | errors ("OPFEN", dropped "$") | fastest; weakest Darth Vader |
| Iris-3B | 25.5 s | 5.3 GB | errors ("2HOURS") | smallest memory |
| ERNIE-Image-Turbo | 43.8 s (32.8 s at 4 steps) | 18.8 GB | **all five correct, poster included** | 4 steps look the same as 8 |
| Z-Image-Turbo | 45.8 s | 25.8 GB | all correct (a saxophone covered part of "NIGHT") | most photoreal |
| Boogu 0.1 Turbo | 54.4 s (32.0 s at 4 steps) | 23.9 GB | errors ("244 HOURS", dropped poster words) | best Terminator (the T-800 endoskeleton) |
| MOSS-Image SFT | 141.6 s | 15.5 GB | all correct | too slow to plan with |

Pictures: [text](assets/image-bakeoff-2026-10-25/text.jpg), [pop culture](assets/image-bakeoff-2026-10-25/pop-culture.jpg),
[fewer steps](assets/image-bakeoff-2026-10-25/fewer-steps.jpg). The full 22-prompt page (about 9 MB, every picture with its time
and memory) is `compare.html` in the owner's `data-scratch/bakeoff/`, not in the repository.

- **Text.** ERNIE, Z-Image and MOSS got every string right. Klein, Boogu and Iris garbled at least one. This was the reason for the bakeoff.
- **Pop culture.** Every model knows Mario, Darth Vader, Spider-Man, Pikachu and Batman by name. For "the Terminator" only Boogu drew the
  endoskeleton; ERNIE drew a leather-jacket man who looks like the actor, Z-Image a man in sunglasses and a jacket with garbled text,
  Klein a generic armored figure. The chat model therefore does not have to expand a famous name for the picture model; no
  pop-culture LoRA was needed, and none was found on Hugging Face for Klein or Z-Image (character LoRAs live on CivitAI, not tried).
  Reference pictures are never fetched from the web (privacy promise).
- **Adult and gore prompts.** No model refused or blanked either one; each drew black-lace lingerie and a bloody zombie from the base
  weights alone. The Z-Image adult LoRA changed pose and framing, not much else. It loads in mflux only after its fused attention layers
  are split into query, key and value (the converted copy is `nsfw-zit-split.safetensors`).
- **LoRAs.** A Z-Image portrait LoRA changed almost nothing. A Klein anime LoRA gave a visibly softer, different anime look
  ([pictures](assets/image-bakeoff-2026-10-25/loras.jpg)). No speed LoRA was needed: ERNIE and Boogu at 4 steps already cost about 25% less
  time with no visible loss on the three prompts tried.

## 3. Results: edits and what two people at once cost

Source pictures were made with ERNIE (a man alone on a beach, two friends on a park bench, the bakery sign). Five edits, same seed:
add a woman in a yellow coat, remove the person on the right, make the beach sunny, make the bench scene sunny, change the sign to
"FRESH PIES DAILY". [Pictures](assets/image-bakeoff-2026-10-25/edits.jpg), columns original, Klein, Qwen, ERNIE.

| Editor | Per edit | Peak memory | Result |
|---|---:|---:|---|
| Klein 4B edit (8-bit, 4 steps) | 20 to 28 s | 10.2 GB | all five correct; sign text changed with correct spelling |
| Qwen-Image-Edit-2511 (8-bit, 20 steps) | 330 to 364 s | 39 GB | all five correct; about 15 times Klein's time and 4 times its memory |
| ERNIE image-to-image (strength 0.6) | 25 to 41 s | 14.7 GB | edits ignored (no person added or removed, no sun, text unchanged) |

ERNIE has no edit model (Baidu publishes text-to-image only); mflux offers it only the noise-and-redraw mode. **No model tested both
draws text correctly and edits**, so the design pairs two.

Klein 8-bit passed all five here, although the 2026-10-17 note found one remove-the-plant edit failing at 8-bit; that note's rule
that edits run at bf16 stands until a larger set of edits shows otherwise.

Create then edit, with each step loading its own model (the real cost when a process starts):

| Scenario | Create | Edit | Memory |
|---|---:|---:|---|
| Klein creates, then Klein edits (one after the other) | 12 s | 19 s | 9.4 then 10.2 GB |
| ERNIE creates, then Klein edits (one after the other) | 41 s | 20 s | 13.2 then 10.1 GB |
| Two users at once: ERNIE creates while Klein edits | 44 s | 20 s | about 23 GB together |
| Two users at once: Klein creates while Klein edits | 16 s | 22 s | about 20 GB together |

[Pictures from the two-at-once run](assets/image-bakeoff-2026-10-25/create-then-edit.jpg) (ERNIE create, its edit, Klein create, its edit). Two jobs at the same time barely slow each other at this size (the edit took 20 s, the same as alone). The cost of concurrency is
memory, not time.

Swapping inside one process (the blocking question):

| Step | Time |
|---|---:|
| Load ERNIE | 17 s from cold disk once, 6 to 10 s with the weights in the file cache |
| ERNIE create, loaded | 21 to 22 s |
| Unload a model | 0.3 s |
| Klein edit, first one (it loads inside the call) | 12 to 16 s |
| Klein edit, loaded | 13 s |
| Both models resident | 15.8 GB resting, about 26 GB peak while Klein edits |

A fully cold first load after a reboot was not forced (it needs a cache purge) and will be slower than the table.

## 4. The decision

1. **New pictures use ERNIE-Image-Turbo** (8 steps, 8-bit), because it is the only fast model that got every text prompt right.
2. **Edits use FLUX.2 Klein 4B** reference edit, unchanged from the 2026-10-17 note.
3. **Keep ERNIE resident; load Klein only when an edit arrives, and drop both after the keep-warm window with no picture request.** Edits are rarer than creates, so
   the occasional edit pays one 6 to 12 s load and creates never wait. When memory is tight (the chat model is busy), fall back to
   one model at a time with the job queue absorbing the 6 to 17 s swap; the person sees "queued", never a raw error, per the
   resource priority order (chat, then pictures, then everything else).
4. Peak image-model memory for one create plus one edit at the same time is about 26 GB with the edit at 8-bit, and about 29 GB at bf16 (the 2026-10-17 note measured a bf16 edit at 16.5 GB against 13.6 GB at
   8-bit); plan with 29 GB. The chat model's share is set aside first and
   the picture budget comes from what remains; pictures never shrink the chat context.

## Supersedes

For new pictures only: `image-engine-2026-10-17.md` section 16 ("Klein is the default on every tier") and the done backlog item
IMGGEN-DEFAULT-01's "Klein is the default picture model on every tier". The ERNIE-Image-Turbo default replaces them once slice 1 of
section 6 lands. Also superseded: section 1's "One model is resident at a time" and section 7's "Load on demand, one model
resident": the create model (ERNIE) stays loaded and the edit model (Klein) loads on demand, and one-at-a-time stays as the fallback
when memory is tight. Both models unload after `generation.keep_warm_minutes` (section 7's 10-minute default) of no picture request.
Nothing else is superseded: Klein as the editor, Z-Image-Turbo as Detailed and every gate stay (section 5).

## 5. What stays and what is open

- Stays: Klein is the editor and the Apache-2.0 only rule; Z-Image-Turbo stays as the advanced Detailed choice and the base for the
  adult and community LoRAs it already has (section 16 of the 2026-10-17 note counted 8,913 CivitAI LoRAs for it against 205 for Klein);
  age and surface gates, the two absolute lines and the likeness rules are untouched.
- Open: ERNIE's community LoRA library was not counted (a Hugging Face search for ERNIE LoRAs was not run); until it is, a
  LoRA still selects its own base model, so a LoRA chosen for Z-Image or Klein loads that base for that picture.
- Open: mflux support for ERNIE is current as of this run; the pin job must record the mflux version and the ERNIE weights digest.
- Open: Boogu Edit-Turbo could beat Klein's edits but cannot run until mflux supports it; recheck at the next bakeoff.
- Housekeeping: the downloaded weights (about 250 GB, including Qwen-Image-Edit) are in `data-scratch/bakeoff/hub/` on the Studio and
  can be deleted once the build slices below are accepted.

## 6. Build slices (not yet in the backlog)

1. Add the ERNIE-Image-Turbo model record and worker path (weights pinned by digest), and make it the new-picture default in
   `backend/src/lib/pictures/quality.ts`; Quick and Detailed keep their meaning, and which tier uses ERNIE is the owner's call at build time.
2. Resident-plus-on-demand model lifecycle in the image worker: keep the create model loaded, load the edit model on request, drop
   it after an idle timeout, queue instead of failing when memory is short.
3. A regression bench (`check.sh --bench`, not the gate) that reruns the five text prompts and five edits and fails on a misspelled string,
   using the local vision model to read the text back.
4. Revisit section 16's ruling in the 2026-10-17 note with a one-line supersession marker once slice 1 lands.

Reuse check: mflux already supports ERNIE-Image-Turbo and Klein edit (no new runtime); slice 2 extends the Stack image worker that
already unloads after idle minutes (IMGGEN-STACK-01) instead of adding a second lifecycle; slice 3 reuses `check.sh --bench` and the local
vision model.

## 7. Files

Bench scripts, prompts, raw times and the full comparison page are in the owner's `data-scratch/bakeoff/` (`RESULTS.md`, `prompts.tsv`,
`results.txt`, `compare.html`, `edit/`, `real/`). The pictures kept in this repository are in
[assets/image-bakeoff-2026-10-25/](assets/image-bakeoff-2026-10-25/) (six JPEG contact sheets, about 1.7 MB in all).
