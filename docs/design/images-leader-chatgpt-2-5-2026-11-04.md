# Images: what ChatGPT Images 2.5 and 2.6 add, and how each fits our Images app (leader review, 2026-11-04)

Sources: OpenAI "Introducing ChatGPT Images 2.5" (2026-09-08) and "Introducing Images 2.6" (2026-11-04), read in full. Standing rule: review leaders, replicate what fits
(`feedback_benchmark-leaders-then-replicate`). Companion to [images-app-2026-11-03.md](images-app-2026-11-03.md), which already holds Browse, Create by template,
the Studio, the chat tools and the shared media-operation registry. Reuse check: the design note, the registry (`lib/mediaOps`), `lib/imageEdit.ts`, the kit
`ImageEditor` and the video ops were read before this list was made; rows below say what is already covered.

Left out on purpose: usage statistics, pricing, API model names and partner quotes, the public "go viral" feed (rule: nothing leaves the home), latency
claims we cannot measure.

## Features, and the plan for each

| # | Their feature | Ours today | Plan | Slice |
|---|---|---|---|---|
| 1 | Reference photos keep the subject recognisable (2.5) | `picture.change` takes up to 2 references (IMG-OPS-05, landed); likeness consent rules apply | Bench fidelity on 10 household-style cases (face and pet kept, lighting natural) before claiming it; no new code | IMG-BENCH-01 |
| 2 | Edit only what was asked, rest unchanged (2.5) | Comment brush, `picture.change` with region/mask, erase by person (landed) | Add a measurable check: pixel difference outside the edited area, run in the bench | IMG-BENCH-01 |
| 3 | Many edits in a row stay consistent, no quality loss (2.5) | Every edit is a new Library version; chat edits via `edit_picture` (IMG-CHAT-03, not built) | Edit always starts from the latest lossless version (PNG, no re-compress); bench a 6-edit chain for drift | IMG-BENCH-01, IMG-CHAT-03 |
| 4 | Sketch: draw as a guide for the final picture (2.5) | kit `ImageEditor` has brush and Markup; Create has reference slots | A "Sketch" reference in Create: open the kit canvas, the drawing goes in as a reference with "follow this layout". Needs a Stack measure first (does the engine follow a rough drawing?) | IMG-SKETCH-01 |
| 5 | Templates (Poster, Merch, flyer, product photo) (2.5) | Designed: `media_template` record, ~16 templates (IMG-TPL-01, not built) | Add Poster, Flyer, Merch, Product photo, and an "In the 80s" style to the template list; each is a record, not code | IMG-TPL-01 |
| 6 | Comments placed on the image (2.5) | Comment brush (built) | Nothing new | none |
| 7 | Share the prompt with the picture so others redo it with their own photos (2.5) | Nothing | "Recipe": a picture's details show Use this recipe (prompt, template, styles, no photos); household members only, never public. Same record as a template | IMG-RECIPE-01 |
| 8 | Transparent backgrounds and complex layouts (2.5) | `picture.remove_background` (landed); companions already cut out backgrounds with a key colour (CMEDIA-LOOK-01/02) | Reuse, do not rebuild: the companion Look tab moves onto the registry op (already planned in the main note). A template flag `transparent`: generate, then run the registry op; no new engine work | IMG-TPL-01 |
| 9 | Quality and speed choices: Flare fast, Sunburst precise; low/medium/high quality; complexity (2.5, 2.6) | Resource tiers (Reduced/Standard/Boost/Max), design landed | One "Draft / Detailed" choice in Create mapped to the existing tiers; no new model names shown (RULES: no resource words) | IMG-QUAL-01 |
| 10 | Animate a picture into a looping GIF; sprite-sheet trick (2.6) | Companions already make looping, transparent state clips from a picture (CMEDIA-STATES-01 to 03, Stack job `media.companion_clip`: cut-out, loop fit, alpha); video ops (`video.animate` in the registry design, IMG-OPS-04) | Reuse `media.companion_clip` for the loop and alpha; export GIF from its result (ffmpeg); optional later: one prompt makes a 6-frame sheet we split into a GIF | IMG-GIF-01 |
| 11 | SVG export (2.6) | Nothing | `picture.vectorize` registry op using an open-licence tracer (vtracer, MIT) for logos and icons; photos are refused with a plain line | IMG-OPS-10 |
| 12 | Markup in the API (2.6) | Markup built | Nothing new; the registry already lets other apps call it | none |
| 13 | Keep a character, product or brand consistent across a series (2.6) | Companion character sheet (three side views, approval; CMEDIA-LOOK-03) and references | Generalise the companion character sheet: a saved "subject" (a companion or a product picture) usable as the reference for a whole template batch; design after the bench shows references hold likeness | IMG-SERIES-01 |
| 14 | Provenance: C2PA metadata and an invisible watermark (2.5) | Provenance records exist per picture; no standard marking | Owner decision needed: add a C2PA manifest to exported and shared pictures (local, no phone-home). Invisible watermark: not proposed | IMG-PROV-01 (ask Jesse) |
| 15 | Prompt and image safety checks (2.5) | Age and surface gates, CSAM check, finished-picture check | Already stronger; no change | none |

## Order

1. Bench first (IMG-BENCH-01): rows 1, 2, 3 are claims we should measure on our engine before anyone sees them.
2. Already planned and waiting on the video UI slices: IMG-TPL-01 (rows 5, 8), IMG-CHAT-03 (row 3), IMG-UI and IMG-STUDIO slices.
3. Small and independent, can go any time after the registry: IMG-OPS-10 vectorize, IMG-GIF-01, IMG-RECIPE-01, IMG-QUAL-01.
4. Needs a measurement: IMG-SKETCH-01. Needs Jesse: IMG-PROV-01. Needs the bench: IMG-SERIES-01.

## Not decided here

- New backlog rows wait for the architect's ruling on this note (new items on a governed path).
- Whether GIF export is a Videos or an Images action (the registry makes it callable from both).
