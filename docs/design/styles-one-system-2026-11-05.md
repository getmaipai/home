# Styles: one system for pictures and video (design note, 2026-11-05)

Status: proposed, waiting for the architect verdict. Extends [video-loras-2026-11-02.md](video-loras-2026-11-02.md) (the record, the Adult lock, access, the browser) and
[lora-sources.md](../dev/lora-sources.md). Nothing here is built. Owner rulings that shaped it: 2026-11-04 (suggest with confirm, per-style switch, two per clip) and
"one system, no divergent duplicates" (same day).

## 1. The problem

Since VIDEO-LORA-12 a picture style and a video style are the same `Lora` record (`media: "picture" | "video"`), with one access function and one Adult lock. Everything
around the record is still video only: the search and install flow, the base table, the Create picker, the chat tool text, the plan that adds trigger words. Left alone, each
new style feature would be built twice and drift (the platform rule: one definition, one place).

A real run on 2026-11-04 (search, install, one clip) found one defect in that flow (the Stack's wrapped job reply) that tests missed; a second copy for pictures would have
carried it too.

## 2. What is shared and what is not

| Piece | Today | Decision |
|---|---|---|
| Record, access, Adult lock, adoption | shared | stays |
| Settings, Styles list and editor | shared list | stays one tab; filter by Pictures / Videos |
| Search and install (`lib/loras/source.ts`, `install.ts`, routes) | video only | one flow, `media` is a parameter |
| Base table (`baseFamilies.ts`) | LTX and Wan rows | add picture families as rows; `media` on each family |
| Prompt plan (trigger words, add-ins, 400 character cap) | `lib/videos/promptPlan.ts` | move to `lib/loras/promptPlan.ts`, both Create pages call it |
| Create picker and chips | video | one kit element, both pages |
| Chat tool text (style names) | video tools | one helper, both tools |
| Stack call (install job, apply) | `/stack/v1/video/loras` | two thin adapters behind one `StylesStack` interface; the Stack keeps its two routes |

Rule: a new style feature is built once against the record and the table. Only the Stack adapter and the base rows know whether it is a picture or a clip.

## 3. Search and install for pictures

- `BrowseBody.media` becomes `picture | video` (it is a literal `video` now). Civitai asks `types=LORA` plus the base labels of the chosen media; Hugging Face asks `filter=lora`.
- The base table gets picture families (the engines the picture Stack runs, for example Flux 2 Klein and Z-Image). Each row carries its Civitai label, text patterns, plain words and
  `installable`. Civitai labels for picture bases are unconfirmed and must be read from the live API before the rows ship (as was done for LTX on 2026-11-03).
- `installable` and "supported on this install" stay driven by `setInstalledBasesProvider`, fed from each Stack role's readiness (open item from VIDEO-LORA-12: wire it for both).
- Install posts to the picture route (`/stack/v1/image/loras/install`) or the video route by `media`. The job row, the Repairs item and the record writer are the same code.
- Age rules are unchanged and fail closed: Hugging Face hits are never `normal`, so they stay one lock tile until the unlock is live; an adult hit needs the confirm ticket to go all-ages.

## 4. Suggesting styles from the prompt (owner rulings)

1. Home suggests up to two styles as removable chips under the prompt. The person confirms by leaving them on. Nothing is ever applied silently.
2. New field on the record: `allow_suggesting: boolean`. Default true for an all-ages style, false for an adult-only style. An admin changes it per style in the editor.
3. An adult-only style is a candidate only while the viewer's unlock is valid, and a minor's candidate list never contains one (the access function decides, not the matcher).
4. Matching is local and cheap: the typed words against each style's name, trigger words and a short description, with the base the page can use (picture page: picture bases; clip page: LTX or Wan).
   No model call, no network, no history. If a model is later needed it goes through the turn engine and is classified in the model call-site inventory test.
5. A suggestion never changes the base the clip uses by itself: a style whose base needs a different level shows "Makes it Detailed" like a hand pick does today (section 6.4 of the video note).
6. Limit: two styles per output, one character (unchanged; the Stack allows four, not raised until benched).
7. Chat: the tool description already lists the person's all-ages style names; the same list is used for pictures. The model may pass `styles`; suggestion chips are a page feature.

## Supersedes

- `lib/videos/promptPlan.ts` moves to `lib/loras/promptPlan.ts`; the video-only copy is removed once both Create pages call the shared one.
- Video-only browse and install: `BrowseBody.media` (a literal `video` in `routes/lorasSources.ts`) becomes `picture | video`; `source.ts` and `install.ts` take `media`.
- The picture install path in the Stack (`images/loras.ts`, the Hugging Face install job) and Home's picture adapter routes (`routes/picturesAdmin.ts`, `lib/pictures/adapters.ts`) stay until the shared flow covers each call, then go (port before delete).
- Rows it extends in [video-loras-2026-11-02.md](video-loras-2026-11-02.md): section 5 (install and browse) and section 6.1 and 6.5 (the prompt plan and the two-style limit). Those sections keep their text and gain "for both media".

## Reuse check

- Matcher: the existing `basesNamedIn` and `cleanTriggerWords` in `lib/loras/` plus the record's name and trigger words; no new text library, no model.
- `StylesStack`: the video client in `lib/videos/stack.ts` (`installVideoLora`, `getStackInstallJob`) and the picture adapter in `lib/pictures/adapters.ts` already exist; the interface only names what both do.
- Picker and chips: the kit `prompt_bar` suggestions and chips from VIDEO-UI-03 (commons), used as shipped. Any prop it lacks (for example a chip's remove control or a lock tile) is added in `commons` first, never a Home wrapper (rule 9).
- Browser, job list, Repairs item, lock, access: reused unchanged.

## 5. Rules check

- Age and surface gates outrank everything: suggestions read the same `loraAccess` answer as the picker; no second filter.
- No resource words for people: base names and file sizes stay under Details.
- Shipped parts only, port before delete: the picture picker and Styles tab keep working during the move; the old picture adapter routes stay until the shared flow covers each of their calls.
- No new outbound connection: browsing is the existing rate-limited source layer; matching is local.
- Status: installs use the existing job list and Repairs item; no new status UI.
- Kit as it ships: the shared picker is one kit Element or an Element composition with props, never a Home wrapper with shape classes.

## 6. Build slices (each one lands alone, tests first)

1. **STYLES-01 media parameter.** `media` on browse, install and the base table; picture rows with live-confirmed labels; tests with a fake picture Stack in the real reply shape (`{ job: {...} }`).
2. **STYLES-02 one prompt plan.** Move the plan to `lib/loras/promptPlan.ts`; both Create pages and both chat tools call it; a test that the same input gives the same words for both media.
3. **STYLES-03 readiness provider.** Feed `setInstalledBasesProvider` from the Stack roles so the default search is never empty by accident (it returned nothing on the 2026-11-04 run).
4. **STYLES-04 suggestions** (after ADULT-LOCK-07, so pictures hold the Adult lock before a picture style can be suggested). `allow_suggesting` in the record (spec first, in `commons/spec`), the matcher, the chips on both Create pages, the editor switch. Tests: an adult-only style is never a candidate while locked or for a minor.
5. **STYLES-05 picture install proof.** One real picture style installed and one picture made with it on a dev hub, the output opened and judged.

## 7. Open items (measurements, not owner questions)

- Whether the picture Stack's install job reply matches the video one (it returned nothing readable on 2026-11-04 from the list route); STYLES-01 starts by reading it.
- Civitai base labels for the picture families.
- Which picture styles a base can stack two of without a muddy result (a bench, one sample per pair).
