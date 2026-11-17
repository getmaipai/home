# Character sheets from messy photos on MiniMax H3 (engine for the one sheet builder), 2026-11-16

Status: proposed, needs an architect verdict. Owner ask (Jesse, 2026-11-16): upload not-clean photos (bad light, odd angles, partial bodies) and get nice clean character sheets back; the current code that tries this by hand is "not great". Owner verdict on a real result the same day: "looks great".

## 1. What was measured

One H3 Ref2VA run (Stack engine of H3-SWAP-STACK-01: the pinned mere.run fork) asked for a **frozen 5-frame clip** at 1024x1024 with three of Jesse's messy photos as reference pictures and a person version of the community "character sheet" prompt (JahJedi/MiniMax-H3-Character-Sheet, Apache-2.0: eight panels, four full views front, three-quarter, strict side, back, and four close-ups head, torso, hand, foot, on a neutral background). No LoRA and no new model. Result: a clean 8-panel sheet, the face clearly the person, the clothes invented where the photos showed none (to be fixed by the prompt asking for the photos' clothing). Cost on a busy Studio: 1091 s at 20 steps, 35 GB peak (no turbo adapter for Ref2VA is installed; a turbo recipe is a bench item). Record: `data-scratch/reports/h3-swap-notes-2026-11-16.md` (private).

## 2. Where it lives in the design (nothing new is added next to it)

[creatoros-port-2026-11-13.md](creatoros-port-2026-11-13.md) section 6.3: **one** sheet builder, built once per cast member (CREATOR-06, done: "Capture the look" runs `films/sheetMaker.ts`, 768x448, stores the sheet as the subject's sheet reference and writes the locked sentence; every feature reads it through `resolveCast`). This note changes only the **engine** under that builder when the H3 reference engine is installed and ready; the action, the stored sheet reference, the locked sentence and the readers stay as they are. For a household member the input is their own photos (any quality); for an invented character its portrait; for a synth its rest picture and approved views, as today.

## Supersedes

- CREATOR-06's sheet engine and output: the 768x448 "Reference sheet:" text sheet (`films/sheetMaker.ts`) becomes the **fallback** when the H3 reference engine is not ready (it stays, nothing is deleted: port before delete); with H3 ready the builder asks the Stack for the 1024x1024 eight-panel sheet.
- The sheet step of CREATOR-19 ("Make a character": four faces, pick one, then the sheet) uses the same builder, so it follows without its own change.

## Reuse check

Reuses the one builder (`films/sheetMaker.ts`, `lib/castLook.ts`), `resolveCast`, the face check (YuNet and SFace, REFVIDEO-PARTS-01) to verify the sheet's face against the member's photos and warn, the H3 reference engine and job pattern of H3-SWAP-STACK-01 (the same pinned mere.run, the same heavy gate and admission). No second sheet builder, no new LoRA, no ComfyUI (rule 11). The community prompt is Apache-2.0: kept in our repo as our adapted text with the credit in NOTICE and the comment saying where it came from.

## 3. Design

- **Stack:** an image job `POST /v1/images/sheets` (up to 5 reference pictures, an optional one-line description, a `kind` person or object): runs the 5-frame H3 reference run, takes frame 0 as the PNG, returns the usual picture job (progress, cancel, result, poster); one at a time under the same heavy gate (measured peak 35 GB at 1024x1024; Boost and Max only, otherwise the Home fallback builder runs). `qualities`-style status entry `sheet` (ready, peak, sizes).
- **Home:** `Capture the look` calls the Stack route first when the status says ready, falls back to `sheetMaker.ts` otherwise; the Library gets the sheet as a creation record ("How it was made": engine, source photos); Activity shows "Building a character sheet" with the place in line (a background job, minutes long). A face-match line compares the sheet's face with the member's photos (the existing check) and tells the person plainly when it does not match, with a "try again" (new seed) action.
- **Prompt rules (found in the run):** the clothing comes from the photos when they show it; use at most the photos that show the face and body clearly (a hat in one photo appeared on the person, and mixing all photos made a generic face in the Klein route: the capture picks the best two or three by the face check).
- **Licence and readers:** H3 is reached only after the household licence acknowledgement (LICENCE-ACK-01); no sheet sample goes into docs. The readers that expect the old 16:9 sheet (the film and reference-video paths) are checked against the square 1024x1024 sheet in H3-SHEET-HOME-01 and given a crop or an adapter.
- **Rule 0 and rule 10:** age and surface gates first; a child's or teen's real-person likeness follows the existing refusals (`mediaSubjects.ts`); the output passes the usual finished-picture check; an adult-only source gives an adult-only, locked sheet.

## 4. Build rows

1. H3-SHEET-STACK-01 (Stack, after H3-SWAP-STACK-01's engine): the `/v1/images/sheets` job on the H3 reference engine, status entry, tests with a fake runner, a real run judged by eye.
2. H3-SHEET-HOME-01 (Home): `films/sheetMaker.ts` calls the Stack route when ready (fallback unchanged), face-match line and retry, creation record, Activity text, tests, preview at desktop and phone width.
3. H3-SHEET-BENCH-01 (Stack bench): speed and look with a turbo recipe, 768 and 1024 px, 4 and 8 panels, objects and pets; FLUX 3 Klein and H3-Image single-picture sheets as the comparison.
