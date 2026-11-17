# Templates are recipes, not example prompts (2026-11-17)

Owner report (2026-11-16): clicking a template in Images, Create only puts text in the box ("Marlow", "a happy little cloud"). It
should work like a template in other apps.

## Search existing first

- The shared record `media-template` (`@maipai/spec`) already holds a recipe: `prompt` with named blanks
  `{{name|Label|example}}`, `aspect`, `transparent`, `styles`, `references`, `category`, `audience`.
- The make path already honors it: `lib/pictures/make.ts` fills every blank (`blanks`, up to the typed text for the first plain one,
  the example for the rest, a cast id for `cast_*`), and `lib/pictures/tool.ts` applies the template's `aspect`.
- Video templates use the same record plus `video/templates/template-settings.json` (seconds, look, camera, orientation, tier).
- Covers are static files (`lib/templateCovers.ts`), one per template id.
- What is missing is the screen: the Create page has one text box, so the blanks, the aspect and the cast slot are invisible and a
  click can only copy words. Every launch template ships `references: []` and `styles: []`.

## What other apps do (sources fetched 2026-11-17; "snippet" means a search result only)

- Photoroom: a template is a layered design with a replaceable subject layer; the person uploads a photo and it fills that layer
  (help.photoroom.com/en/articles/8544982-templates).
- Runway: a workflow template is a saved graph with image, video and text input nodes and a model node; the person brings their own
  media (runway.com/workflows).
- Adobe Firefly Graph: workflow starting points where the person swaps in their own prompts and sometimes a reference image or garment
  (experienceleague.adobe.com, Firefly Graph template library).
- CapCut: pick a template, describe the request, then edit script, music and captions (capcut.com/resource/ai-templates).
- Pika: a preset effect; upload a photo, pick the effect, generate (pika.art/faq).
- Leonardo and Krea: the unit is a style or preset (a look), model and aspect are separate settings (Leonardo help, krea.ai/docs).
- Midjourney: a style reference is an image or code (snippet only). Canva, Sora and Higgsfield: only thin or blocked sources, not verified.

Common: a template is a stored recipe with input slots (text, a photo to swap in, a person), fixed settings and a real example as
the preview. A bare example prompt is not what any of them ship. The preview source (real output) was not verified for most apps.

## Verdict: REBUILD the screen on the existing record (no new record, no spec change)

The record already is a recipe, so nothing is ported or dropped. The Create page shows it.

## Design

1. Picking a template opens its recipe form above the box: one labelled field per blank (label and example from the blank, the example
   as the placeholder), a person picker for each `cast_*` blank, and a picture slot for each `photo_*` blank (the person's own
   photo, uploaded or chosen from Library). The box keeps the free words for anything the template does not ask for.
2. The recipe's settings show as chips already set by the template: shape from `aspect`, transparent background, and the template
   is the chip value. The person may change them.
3. `photo_*` is a new blank-name prefix inside the prompt grammar (like `cast_*`), so no spec change: it needs one picture, goes to
   the picture edit as the reference, and the prompt names it as "the picture provided".
4. Make picture sends `template` + `blanks` (+ `cast`, + `reference`). The server already fills and validates every blank.
5. Templates without blanks still work: the example sentence fills the box.
6. Covers: a real picture made from the template's own examples by the household picture model, replacing the static files over time
   (one cover per template, a regeneration script, never made on the live hub without the person's say).
7. Videos use the same record and the same form (blanks, settings from `template-settings.json`); the video session builds that on
   this shape.

Not done in this slice: stored user templates ("save this as a template"), a template store, styles (LoRAs) attached to templates.
