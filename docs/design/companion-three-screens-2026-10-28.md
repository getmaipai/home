# Companions in three screens: create and edit

Status: proposed, revised 2026-10-28 after the architect's first ruling (REJECTED, record `data-scratch/architect/COMPANION-3S-01.verdict`); architect APPROVED with five conditions (section 8; record `data-scratch/architect/COMPANION-3S-01.verdict`, 2026-10-29). Owner row: COMPANION-3S-01 in `docs/BACKLOG.md`.
Source: Jesse's three mockups (Create Character, Animate Character, Customize Companion), 2026-10-28, and his answers through the wizard the same day.
Goal (Jesse): simple, clean screens that are easy to go through. The old editor, wizard and studio were ugly, messy, confusing and overwhelming. Every choice below is tested against "is there more on screen than the mockup".

## 0. Owner decisions (Jesse, 2026-10-28)

1. Teens can use the three screens, with the teen checks. Adults and admins use them as today. Children never see them (the child picture rule, no photos and no references, is unchanged).
2. A style never makes a companion all-ages. It only sets the widest audience the art may reach (section 2). New companions start at the maker's own band; widening stays admin-only with the existing all-ages checklist.
3. An adult's uploads get no check beyond the CSAM floor; teen rules apply to teens.
4. The animation list is 13 (section 3); Angry and Scared are dropped.

Decision 1 edits the line in `companion-video-characters-2026-10-21.md` section 12 ("a teen editor is a later owner question"); this note records the answer: `Owner-approved: 2026-10-28`.

## 1. What changes

One flow, three screens, used for both create and edit (edit reopens the same screens filled in, with a clickable progress bar):

| Screen | Does | Replaces |
|---|---|---|
| 1 Create Character | Name, describe or upload a photo, style, size, background removal, one preview, Approve and Continue | wizard, Identity tab, Look tab |
| 2 Animate Character | 13 animation tiles, Generate Required, Generate Optional, one preview player | Studio tab, State cards |
| 3 Customize Companion | Voice, personality chips, backstory, Test Conversation, Save Companion | Voice and style tab, Identity fields, Publish |

The look and feel is the mockups' exactly: dark dialog, pill buttons, a segmented three-part progress bar, picture tiles. It lands as additive commons kit variants first (rule 9), follows the person's theme tokens (the dark look comes from tokens, never a fixed colour), and Home adds no wrapper and no `className` override. On a phone the flow is the full-screen Dialog variant (S2).
Studio words never appear on screen: key colour, character sheet, take, publish, draft, Review needed, motion sentence. Failures give one plain sentence and a next step.

## 2. Screen 1: one imaging pipeline, reusable

All picture work runs through one shared module, `backend/src/lib/imaging/` (reuse, principle 1). It is a general library: any feature that needs a subject prepared for a frame calls it (News, profile pictures, Splash, robot faces).

`preparePicture(bytes, options)` does, in this order, each step optional and skipped when it has nothing to do:

1. **Upscale** when the short side is under the target (the Stack upscaler the picture editor uses). Never when already large enough.
2. **Restyle** through the Stack's generative edit (Klein, the bakeoff's edit pick) with the chosen style phrase from `companionLookStyles.ts`. "Keep as is" skips it and is the default for an upload.
3. **Remove the background** with the Stack's `isnet` remover.
4. **Find the subject**: the saliency focal point from the News auto zoom (FocalNet), refined by the alpha bounds once the background is gone.
5. **Fit to frame**: centre the subject, zoom to fill the frame with the spec margin (1024 px, 12 percent margin, `companion-media.json`), pad with transparency.

**Reuse check (the module takes over, it does not add a fourth copy).** Existing callers of the Stack's image tools are pointed at `imaging/`: `removePictureBackground` (`routes/companions.ts`, already a real `isnet` call on uploads), `runPictureTool` (`pictures/people.ts`) and `startEdit` (`imageEdit.ts`). The fit-to-frame step replaces `normalizePicture` (`companionLook.ts`), and the missing-tool check is `editToolsStatus` (`imageEdit.ts`), reused. The no-op background remover today sits only in the paths for generated candidates and sheet views (`companionLookJobs.ts`); uploads already remove the background. Each caller moves in IMG-PIPE-01 and its tests stay green.

Rules for the module:
- The focal code moves from `lib/news/focal.ts` to `lib/imaging/focal.ts` and News imports it from there; News behaviour and tests are unchanged (port before delete).
- Every step is a small exported function with its own test and returns the bytes and what it did, so callers record provenance (principle 3).
- A missing tool (no `isnet`, upscaler or edit model) refuses with one plain line naming what to install. No silent skip and no silent downgrade. **One stated exception:** the focal step is advisory, so a missing saliency model gives a centred crop, as News does today.
- Targets live in one table (`imaging/targets.ts`): the companion portrait is 1024 px; generation uses the model's own fast native size and the upscaler brings it up, so generation stays quick. The first bench records measured seconds beside each target; none is claimed until measured.
- Models stay the household's choice through the existing resolver (COMPANION-ART-MODEL-01). Clips keep the spec's 480 by 480 at 24 fps.
- The preview shows the transparent result, with nothing behind it. The size control is a zoom and position on the preview, stored with the picture.
- The green or magenta key colour stays an internal detail of making clips; the person never chooses it.

### Gates on screen 1 (nothing unapproved is animated)

Every picture, upload or generated, runs `companionArtCheck.ts` (COMPANION-ART-CHECK-01, built) before it appears in the preview, and again on the final prepared picture at Approve. Verdicts cache by hash. Uploads keep the existing rights confirmation.

| Maker | Style tiles | Upload | Check |
|---|---|---|---|
| Adult or admin | all | any photo | CSAM check only, fails closed if it cannot run |
| Teen | teen-allowed styles; adult-only styles hidden | any photo | teen floor, fails closed |
| Child | does not use these screens | none | none |

A withheld picture gets one short friendly sentence. A teen-made companion starts with audience `teen` and is never adult.

**Style and audience.** The style picked is stored on the look version. It caps the widest audience the companion may be widened to: Cartoon allows all-ages; Realistic, Anime, 3D and Pixel cap at teen; Custom counts as adult. It never widens by itself. A new companion starts at the maker's band, and widening to all-ages stays admin-only with the existing checklist and a named reviewer (`routes/companions.ts`, `householdCompanions.ts`), because the art check never reads the persona text. The stored `watercolor` style id stays readable.

Styles shown: Realistic, Cartoon, Anime, 3D, Pixel, Custom (Custom takes a typed style).

A name-only draft companion is created when the person first generates or uploads, because look jobs need a companion id. Close asks to keep or discard it. No sweep deletes drafts today (the art sweep never deletes), so LOOK-3S-01 adds `sweepAbandonedDrafts` beside it: it removes only drafts with no picture older than seven days, and logs each removal.

## 3. Screen 2: thirteen animations

Tiles show each state's still (the approved portrait, dimmed, until a clip exists). Clicking a tile plays its full looping transparent clip in the Preview box. Required tiles are locked and Continue stays disabled until all four exist. We pick the best clip per state automatically; "Make another" under the preview redoes the selected state. A waiting tile says "Waiting its turn" on its own tile, from the existing job poll, with no new polling loop (S6). Each clip's still and frames pass the art check before its tile shows. Clips use only the video model the maker's lane allows.

| Group | Animations |
|---|---|
| Required (4) | Idle, Listening, Thinking, Speaking |
| Optional (9) | Working, Researching, Writing, Done, Sleeping, Laughing, Surprised, Sad, Confused |

The shared vocabulary changes spec first (`commons/spec/vocab/companion-media.json`, today 12 states), then the hub. Conditions:
- The manifest `animation.states` keys stay additive: old ids remain valid and nothing is deleted. Already-published companions stay valid under the new required set.
- `presence-states.json` and `emotion-map.json` are not changed. The bot reads only those and plays no companion clips, so robot parity holds.
- Angry and Scared are dropped: no emotion label drives them.
- The fallback below is spec data that the kit's `companion-avatar-machine.ts` (`pickWanted`) reads, landed in commons. Home's `useCompanionSignals.ts` stops working out oops and celebrate itself (S6: a client never recomputes it).

| Event or label | Plays | If not made |
|---|---|---|
| presence thinking, working, done, sleeping, idle | the state of the same name | Working goes to Thinking; Done and Sleeping to Idle |
| presence asking (needs you) | Listening | the companion stage's one state word says "Needs you"; the header avatar carries no count, dot or badge (S2); the Review button stays the action (S6) |
| Researching, Writing | the tile, once presence carries a tool kind | Working, then Thinking (until then they play Working) |
| emotion happy, excited, playful | Laughing | none; `excited` keeps its `cap_to_perk_small` child band and `playful` still needs `person.robot.playful_clips` |
| emotion surprised, confused | Surprised, Confused | none |
| emotion sad | Sad | none; its child band is `primitive_only`, so a child gets no Sad clip |
| presence concerned (adult only) | Confused | none |

Migration: matching ids keep their approved clips (idle, listening, thinking, speaking, working, sleeping); celebrate becomes Done; needs_you, greeting, happy, oops and idle_look stay on disk unused.

## 4. Screen 3

- **Voice:** the existing voice picker and sample. Create or Clone uses the existing cloned-voices path and its consent rules.
- **Personality:** chips set the nine style dials as presets. The free text is style notes only: it becomes short Behavior lines (at most 6) about tone, never instructions or tools (rule 14; `WRITTEN_VOICE_PROSE` stays false; no new path for prompt text).
- **Backstory:** a text box and Generate (the local chat model), at most 400 characters.
- **Hidden fields:** tagline and example lines are generated from the preset and backstory, and each band's examples pass that band's floor before they are stored (rule 0). Pronouns and interests are kept intact on edit and not shown. Audience, Make a copy, Delete and Ready or Draft move to the directory card menu; audience changes keep the admin gate and the checklist.
- **Test Conversation:** the existing temporary "Try it" chat; nothing is saved.
- **Save Companion:** sets the companion ready and publishes the approved appearance in one step, running the existing finished-item check. A block shows one plain sentence and a way back to the screen that fixes it.

## 5. Slices

| Id | Lane | Does |
|---|---|---|
| IMG-PIPE-01 | Codex | `lib/imaging/`, focal moved from news, existing callers pointed at it, `normalizePicture` and tool-status reuse, targets table, tests |
| ANIM-SPEC-01 | Codex (commons) | 13-state vocabulary, fallback table with child bands, migration map, kit `pickWanted` reads it, tests; spec tag needs Jesse's yes |
| KIT-3S-01 | Claude | additive commons variants on the shipped Button, `CharacterTile`, `generation-stage`, `companion-stage`, `toggle-group`, `progress` and `dialog`; a segmented stepper only from the shadcn registry or Kibo UI with a row in `UI-DECISIONS.md`; tag needs Jesse's yes |
| LOOK-3S-01 | Codex | draft at first use and `sweepAbandonedDrafts`, restyle, style list per lane, style stored and audience cap, teen checks, checks on screen 1, Approve |
| ANIM-3S-01 | Codex | generate chosen states, auto-pick best, tile stills, art check, avatar fallback, migration |
| SAVE-3S-01 | Codex | presets to dials, generated tagline and examples with band floors, backstory Generate, Save publishes |
| UI-3S-01 | Claude | the three screens, edit mode, teen access (`canCreateCompanion`), card menu actions; the old screens removed only after the port list below is done |
| VERIFY-3S-01 | Claude | seeded preview at desktop and phone width, generated screenshots opened and judged |

Order: IMG-PIPE-01, ANIM-SPEC-01 and KIT-3S-01 in parallel (different files); then LOOK-3S-01 and ANIM-3S-01; then SAVE-3S-01; then UI-3S-01; then VERIFY-3S-01. Tags and any release need Jesse's yes in the moment.

**Port or retire before the old screens are deleted (rule 12):** clip upload per state (`uploadStateRoute`), change-with-words edits, picking among look versions and deleting them, the character sheet (which `buildAnimationManifest` and clip upload both require, so it is made automatically behind Approve), takes with their measured numbers, the prompt pack for outside tools, and the all-ages checklist screen. Each is ported into the new flow, moved to the card menu, or retired with a one-line reason written here before UI-3S-01 lands.

## 6. Reuse check (principle 6)

Reused as they are: `companionArtCheck.ts`, the Stack picture editor tools, the News focal model, `companionLookStyles.ts`, the household art resolver, the temporary Try it chat, the voice picker and cloned voices, the look store and approval step, the all-ages checklist, `StackedAlphaVideo` (until CMEDIA-PLAYER-02). New: only the `imaging/` orchestration (replacing three callers and `normalizePicture`), the 13-state vocabulary, `sweepAbandonedDrafts` and the three screens.

## 7. Supersedes

- [companions-app-2026-10-21.md](companions-app-2026-10-21.md): the wizard and editor tabs.
- [companions-handoff-revamp-2026-10-26.md](companions-handoff-revamp-2026-10-26.md) section 8a.9 (the Studio UI, slice 8b). Appearance drafts and Publish (8a.1 to 8a.8) stay as the engine under Save.
- [companion-video-characters-2026-10-21.md](companion-video-characters-2026-10-21.md): the 12-state vocabulary (section 7), the teen-editor line and the starting audience (sections 12 and 12.5), and the character sheet, takes and clip-upload screens (their engine stays).
- Open backlog slices overtaken: DOTS-CREATE-01 and DOTS-STATES-01 (COMPANIONS-DOTS-01), and CMEDIA-EDITOR-05 (COMPANIONS-STUDIO-01), whose all-ages checklist stays as described in section 2.

## 8. Architect conditions (approved 2026-10-29)

1. **Teen uploads (LOOK-3S-01).** A teen's uploaded photo passes the existing input screen (`pictures/editSources.ts` `prepareEditSource` then `screenInputImage`, stricter for a teen viewer) before it reaches the Klein restyle. The output check alone does not cover what is sent into the edit model.
2. **One style table (LOOK-3S-01, principle 4).** Each style's audience cap and whether teens see it live in one table in `companionLookStyles.ts`, used by both the teen style list and the audience cap. Custom counts as adult, so teens never see it.
3. **Child bands (ANIM-SPEC-01).** A child gets no emotion clip for any label whose `child_band` is not `same`; the presence state plays instead. That covers `sad`, `excited` and `playful`. A robot motion cap has no clip equivalent, so the no-clip result is what the code does.
4. **Draft sweep log (LOOK-3S-01, rule 6a).** `sweepAbandonedDrafts` writes one typed registry event with a count only. No companion id, name or person id.
5. **Landing.** The BACKLOG and INDEX rows cite this verdict. The commit message names COMPANION-3S-01 and lands within 24 hours of the record.
