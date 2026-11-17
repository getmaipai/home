# Audit: model-specific knowledge in Home, 2026-11-17

Evidence for [model-packs-2026-11-17.md](model-packs-2026-11-17.md). Dev tier. Read against Home `main` at 667eeb5 (the live build of 2026-11-17), `backend/src`, `shared/` and `frontend/src`, tests excluded. Search terms: minimax, h3, flux, ltx, wan, ernie, z-image, qwen, pocket, chatterbox, PICTURE_MODEL, H3_MODEL, LTX25, and the Stack field names Home mirrors. Line numbers are from that commit.

Verdicts: **Move** means the knowledge belongs in the model's pack in the Stack and the Home code becomes a generic job call. **Stay** means it is Home's own logic (people, gates, wording, drawing) and only its inputs change. **Label** means the only model reference is a word on a settings card, which HOME-PARTS-03 already replaces with the parts list.

## 1. Video

| File | What it holds | Verdict | Becomes |
|---|---|---|---|
| `backend/src/lib/videos/quality.ts` | `QUICK_BASE`, `DETAILED_BASE`, `LTX25_MODEL`, `LTX25_MAX_MODEL`, `H3_MODEL`, the per-model size tables (`LTX25_DEFAULTS`, `LTX25_MAX_DEFAULTS`, `H3_DEFAULTS`), the per-model ceilings (`maxSecondsFor`), `VideoMaker` union (lines 11 to 40) | Move | the `clip` job's limits from the jobs catalog; `VideoQuality` (quick, detailed) stays as Home's words |
| `backend/src/lib/videos/slotBody.ts` | reads a slot's model id prefix (`ltx25`, `wan`) to decide the level and size (14 to 56) | Move | the slot stores a part id; the Stack maps level to size |
| `backend/src/lib/videos/tool.ts` | picks the maker by model readiness (`h3EndPictureReady`, `ltx25MaxReady`), LoRA base check `runsOn(a.lora, "ltx-2.5")`, end-picture rules per model (254 to 282) | Move | ask the catalog whether `clip` with `end_picture` and these styles is available; the tool keeps the gates, the lines and the cast handling |
| `backend/src/lib/videos/stack.ts` | `StackLtx25Quality`, `StackLtx25Profile`, `qualities.{quick,detailed,ltx25,ltx25max}` mirrors (29 to 142) | Move | the generic jobs catalog shape from `spec`; the file keeps only the HTTP client |
| `backend/src/lib/videos/ready.ts` | `WAN_VIDEO_PART_ID`, `LTX_VIDEO_PART_ID`, adult readiness by model (10 to 50) | Move | the catalog's `available` for `clip` feeds the `video` row of `lib/roleHealth.ts`, which stays the one readiness read (rule S6) |
| `backend/src/lib/videos/loraWire.ts` | LoRA support read from `qualities.ltx25.loras.supported` and Wan's `{id, strength}` wire (2 to 31) | Move | the catalog's `styles` entry per job (max count, bases) |
| `backend/src/lib/videos/createStyles.ts` | tiers gated by LTX LoRA support; `runsOn(l, "ltx-2.5")` (20, 52) | Move | a style carries a base part id; the catalog says which jobs take it |
| `backend/src/lib/videos/jobs.ts` | default size by model (611); quality from `ltx25` and `ltx25max` names (771) | Move | size from the job result's `made_with`; the clip record stores the part id the Stack reports |
| `backend/src/lib/videos/referenceVideo.ts` | the Ingredients adapter route, Max only, model by maker (3, 279, 561) | Move | `clip_from_sheet` job; "adapter missing" becomes `not_on_this_model` |
| `backend/src/lib/videos/ingredientsAdapter.ts` | the LTX Ingredients LoRA: repo, file, licence id, base (14 to 38) | Move | a pack `requires` entry on the LTX pack; Home keeps nothing |
| `backend/src/lib/videos/referenceFirstFrame.ts` | measured note that LTX Ingredients does not keep a face (3) | Move | a pack `notes` line; the first-frame fallback stays Home logic until the catalog says the job keeps likeness |
| `backend/src/lib/videos/editPlan.ts` | `VIDEO_RESTYLES` with `model: "ltx25-max"` and the colorizer LoRA id, prompt template (5 to 11) | Move | the `restyle` job's recipes in the LTX Max pack; Home keeps the person-facing list of restyle names |
| `backend/src/lib/videos/longTake.ts` | ceilings from `LTX25_DEFAULTS` (42) | Move | the `clip` job's `max_seconds` per level |
| `backend/src/lib/videos/editTool.ts` | the swap branch reads `qualities.h3_swap`, fixes `size = "512x384"` with the 112 GB reason, the 10 s window, three references (250 to 290) | Move | `swap` job: Home sends the clip, the cast member's photos and the window; size and segment rules are the pack's |
| `backend/src/lib/videos/stackSwap.ts` | `POST /v1/videos/swap` with `source_video`, `references`, `description`, `size`, `start_seconds`, `seconds` (18 to 54) | Move | the one generic job client; the field names come from `spec` |
| `backend/src/lib/videos/swapReferences.ts` | three reference photos (5) | Move | the pack's `max_references` for `swap`; Home sends the face-marked photos in order |
| `backend/src/lib/videos/swapStart.ts`, `clipEditStart.ts` | the page action, gates, lock, cast resolution, Max-only rule | Stay | unchanged |
| `backend/src/routes/videos.ts` | `TierStatusSchema.model` enum `wan, ltx25, ltx25max`; per-level readiness by model (190 to 205, 431) | Move | the levels answer is built from the catalog; `model` on the wire becomes the part id and label |
| `backend/src/lib/media/videoCreateApp.ts` | `modelWords` map (311); Max entry by `ltx25MaxReady`; level hints by `ltx25VideoReady` (42 to 100) | Move | labels from the parts list; hints from the catalog's limits |
| `backend/src/lib/videos/recipes.ts` | "measured on LTX-2.5" note (39) | Stay | a comment |
| `backend/src/lib/pictures/lane.ts` | `WAN_QUICK_VIDEO_MODEL`, the minor lane's model list (122 to 124) | Stay until VIDEO-WAN-REMOVE-01 | the minor's list from the Stack (rule E6) replaces it; nothing here is removed before the Stack enforces the list |

## 2. Pictures

| File | What it holds | Verdict | Becomes |
|---|---|---|---|
| `backend/src/lib/pictures/quality.ts` | `PICTURE_MODEL = "minimax-h3-image"`, the removed-model set and line, `TEXT_CAPABLE_MODELS`, `qualityOfModel` (1 to 30) | Move | `picture` job; "can spell words" is a catalog capability; the removed-model line stays as Home wording keyed on `not_found` |
| `backend/src/lib/pictures/tool.ts`, `routes/pictures.ts`, `pictures/editTool.ts`, `pictures/stack.ts`, `pictures/slotBody.ts` | send `model: PICTURE_MODEL` on every request (331 to 335; 263; 32; 137; 44) | Move | send no `part` unless the person chose one |
| `backend/src/lib/pictures/policy.ts` | `householdQuickModel()` returns `"ernie"` for the old card (102 to 106) | Move | deleted with HOME-PARTS-03 |
| `backend/src/lib/pictures/ready.ts` | fixture `family: "minimax-h3-image"`, `steps_default`, `peak_gb` (94 to 95) | Move | test fixture of the catalog shape |
| `backend/src/lib/imageEdit.ts` | `reference`, `reference2`, `reference3` fields and the `edit.references` limit (796 to 824) | Move | `picture_edit` job with a `references[]` list and the pack's `max_references` |
| `backend/src/lib/pictures/combine.ts`, `keyframes.ts`, `people.ts`, `pictures/jobs.ts` | reference limit from the engine status; five frames per 10 s; the `model` meta field | Stay | inputs come from the catalog and the result |
| `backend/src/lib/companionArt.ts` | `COMPANION_EDIT_MODEL`, `LTX25_REPORTED_NAMES`, maker to model id map, `stackVideoModel` (3 to 64) | Move | a companion take asks for `picture_edit` and `clip`; the clip record stores the part id the result reports |
| `backend/src/lib/companionTakes.ts` | LTX end-picture rule for pack loops (203 to 206) | Move | the catalog's `end_picture` capability |
| `backend/src/lib/companionClipSize.ts` | Wan keeps the spec size (12) | Move | the pack's shape table |

## 3. Films, sheets and references

| File | What it holds | Verdict | Becomes |
|---|---|---|---|
| `backend/src/lib/films/sheetMaker.ts` | the cut-out reference sheet built to the LTX Ingredients layout: 768x448, panels, the "Reference sheet:" description (1 to 32, 216 to 247) | Move the layout, Stay the builder | `character_sheet` job on the Stack; the Home cut-out builder stays as the no-model fallback until the H3 sheet is measured on real photos (section 6 of the design) |
| `backend/src/lib/films/referenceSheet.ts` | 768x448 as "the one size the LTX 2.5 adapter was trained on" (3) | Move | the sheet's size is the pack's |
| `backend/src/lib/films/sheetViews.ts` | uses the image-edit route for extra views (2) | Stay | calls `picture_edit` |
| `backend/src/lib/films/engines.ts`, `plan.ts`, `run.ts` | waits on the video engine; shot planning | Stay | reads the catalog for limits |
| `backend/src/lib/videos/referenceVideo.ts` | see section 1 | Move | `clip_from_sheet` |

## 4. Styles and LoRAs

| File | What it holds | Verdict | Becomes |
|---|---|---|---|
| `backend/src/lib/loras/baseFamilies.ts` | base families with ids, browse words, Civitai labels and patterns for LTX 2.5, LTX 2.3, Wan, Flux Klein, Z-Image, ERNIE (6 to 43) | Move | each pack lists its `style_base` id, labels and browse patterns; Home builds the family list from the packs |
| `backend/src/lib/loras/access.ts`, `sync.ts`, `readiness.ts`, `install.ts` | the `ltx-2.3` tested-on-2.5 rule and `tested_on_25` field (45 to 66; 81, 133) | Move | the LTX pack's `style_bases` entry carries the retired base and its bench mark; Home reads `compatible_with` as the Stack serves it |
| `backend/src/routes/loras.ts`, `lorasSources.ts` | `base_model` enum and base notes (111; 50) | Move | the enum is the packs' `style_base` list |
| `backend/src/lib/loras/source.ts` | Hugging Face and Civitai browsing | Stay | outside the Stack; see THIRD-PARTY-SERVICES |
| `frontend/src/apps/settings/styles/*` (`stylesApi.ts`, `stylesShared.tsx`, `StyleBrowser.tsx`, `StyleConfirm.tsx`, `StyleEditor.tsx`) | `BaseModelId` type, base words and pills for LTX 2.5, LTX 2.3, Wan | Label | drawn from the base list the backend serves |

## 5. Settings, catalog and install

| File | What it holds | Verdict | Becomes |
|---|---|---|---|
| `shared/diskPlan.json` | 245 model mentions: part ids, labels, sizes, the MiniMax H3 rows (1341 to 1358, 1689 to 1691) | Move | deleted by HOME-PARTS-05; the parts list is the plan |
| `backend/src/lib/modelCatalog.ts` | 58 mentions: chat, vision, picture and video model records | Move | HOME-PARTS-05 deletes it |
| `shared/aiChoices.ts`, `routes/aiChoices.ts` | rows `pictures-ernie`, `video-ltx25`; `LTX_VIDEO_PART_ID`; vision and coding aliases (70 to 72, 214, 304 to 338; 112 to 157) | Move | HOME-PARTS-03 draws the cards from the parts list |
| `shared/licensedRows.ts` | `video-ltx25` to the LTX part id (4) | Move | `licence_needed` on the parts list |
| `backend/src/lib/tiers.ts` | `RECOMMENDED_MAX_IMAGE_MODEL` (162) | Move | `priority` on the parts list |
| `frontend/src/shell/installWords.ts` | install words by model name pattern (38 to 42) | Label | the parts list's `description` |
| `frontend/src/apps/settings/aiTierSlots.ts` | `FAMILY_TITLE` map (96) | Label | parts list labels |
| `backend/src/lib/installStatus.ts`, `settings/videoKeys.ts`, `frontend/src/lib/componentsApi.ts`, `chatToolUis.tsx` | comments and example labels | Label | reworded with the rows above |

## 6. Music, voice and chat (listed so nobody plans them twice)

Music: `backend/src/lib/music/stack.ts` names `htdemucs` (line 114) and a `max_model` entry (line 17); `lib/music/models.ts` holds pins. Verdict Move, by MODELPACK-HOME-05 after the music packs exist.

Voice and chat (out of this note's scope):

`backend/src/settings/voiceKeys.ts`, `lib/voiceCatalog.ts`, `lib/tts.ts`, `lib/clonedVoices.ts`, `routes/voice.ts`, `lib/llm.ts`, `turnMachine/nodes/model.ts`: Pocket TTS presets, the Kyutai voice repo, Chatterbox defaults, chat model names. They are model knowledge too and take a voice pack and a chat pack later (PARTS-SPEC-02 already moved the chat model's sampling and template facts to the part record). `whisperSample.ts`, `whisperTurns.ts` and `whisperLine.ts` are the spoken-whisper feature, not a model.

## 7. Stack routes Home calls today for these jobs

| Job today | Route | Home caller |
|---|---|---|
| picture, picture edit | `POST /v1/images/generations`, `POST /v1/images/edits`, `GET /stack/v1/image` | `lib/pictures/stack.ts` |
| clip | `POST /v1/videos/generations`, `GET /stack/v1/video` | `lib/videos/stack.ts` |
| restyle | `POST /v1/videos/restyle` | `lib/videos/stack.ts`, `editPlan.ts` |
| clip from a sheet | `POST /v1/videos/ingredients` | `lib/videos/referenceVideo.ts` |
| swap | `POST /v1/videos/swap`, `GET`, `DELETE`, `/video.mp4` | `lib/videos/stackSwap.ts` |
| character sheet | none (built in Home, `films/sheetMaker.ts`) | `lib/castLook.ts` |
| contact sheet | none in Home `main` at 667eeb5 (in flight in the creator sessions) | |
| styles | `GET`, `POST /stack/v1/image/loras*`; video LoRAs in the clip body | `lib/pictures/stack.ts`, `lib/videos/loraWire.ts` |

Where Home mirrors the Stack's exact field names: `videos/stack.ts` (the `qualities` tree), `videos/stackSwap.ts` (the multipart field names), `imageEdit.ts` (`reference`, `reference2`, `reference3`), `companionArt.ts` (`LTX25_REPORTED_NAMES`, the Stack's reported quality names), `loras/sync.ts` (`tested_on_25`).

## 8. Counts

| Verdict | Files |
|---|---|
| Move | 38 |
| Stay | 10 |
| Label | 9 |
| Out of scope (voice, chat) | 10 |
