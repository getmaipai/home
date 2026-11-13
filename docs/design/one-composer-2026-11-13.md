# One composer: the same prompt box in chat and in every Create page (ONE-COMPOSER-01)

Status: design note, 2026-11-13, architect ruling pending (commit only; nothing built, nothing landed). Owner ask (Jesse, 2026-11-13): one prompt composer that is the same in chat and in Images, Video, Music, Voices and Film Create, shifting subtly to show only what the current task needs. Reference: Artlist's composer (his screenshots of Music, Voiceover, Video and Image). Changes no rule in `RULES.md`; where a part may need one, section 9 says so and stops.

## Findings

1. **Most of the Artlist composer already exists in the kit, unwired.** The kit `PromptBar` (pinned `ui-v0.5.637`) has `layout: "chat"`, `shape: "pill"`, `accent: "create"`, a `modes` prop (a mode menu where each mode carries its own `references`, `options` and `primaryLabel`), in-field reference slots with a Plus button, chip groups that open one popover (`presentation: "popover"`, `group`), a tier control, suggested style chips, a `submit_detail` line and a round submit. UI-DECISIONS rows VIDEO-COMPOSER-01 to 04 (2026-11-10) are the owner's earlier ask for "the Chat composer's mechanism" in Create. What is missing is small: a per-mode placeholder, per-mode chip lists, a presets button, field-end tools (clear, improve), motion between modes, and a way for chat to use the same parts.
2. **The `modes` prop is used by one page only.** `frontend/src/shell/pages/dashboard/AskBox.tsx` (the Home ask box) hard-codes four modes (Ask, Picture, Video, Song) in TypeScript. Every Create page uses the older schema `prompt_bar` node, which has `mode_selector` (Image or Video, two to four options) and `mode_actions`, not `modes`. So there are three vocabularies for one idea.
3. **A half-wired hint.** AskBox sends Picture to `/chat?ask=...&mode=picture`. `AskHandoff.tsx` reads `ask` only; nothing reads `mode`. The words arrive unsent in chat and the mode is dropped. Video Create's `mode_actions.image` does it the other way: it writes "Please create an image using the image generation tool." into the prompt. That is a nudge in the person's own words, visible and editable, and rule 1 allows it; the unread `mode=picture` is the defect.
4. **Chat has its own composer on a different runtime.** The chat composer is the kit `Thread` composer on assistant-ui's `ComposerPrimitive` (attachments adapter, queue, quote preview, dictation waveform, draft restore, voice, send and stop, the Instant, Thinking and Max control, the "+" menu `ComposerAddMenu`, the `@` list `CompanionComposerMentions` through the kit `ComposerMentions`). `PromptBar` is a controlled component with none of that. Replacing the chat composer with `PromptBar` would drop the runtime and break rule 9 (chat is assistant-ui Elements, custom code in the chat path needs a named gap). Replacing `PromptBar` with the Thread composer fails the other way: a Create submit starts a job through a package action, not a message, and `ComposerPrimitive` needs a thread.
5. **Create pages are stubs or one-offs.** Images Create, Music Create, Video voiceover and Film maker are "coming soon" empty states. Video Create is the only real one. Music's planned Create panel (MP-U1) is a separate Simple and Custom form modelled on ace-step-ui. CreatorOS port rows add chips (CREATOR-39), reference and cast slots (CREATOR-40) and `@` cast (CREATOR-05) as three more bars' worth of props.
6. **Presets already exist as data.** `media_template` records (pictures, video, fragments), song styles (`song-style`), and the Styles and Characters popover (`style_suggest`, VIDEO-LORA-09). Artlist's "Presets" button is a button over these, not a new store.
7. **Enhance has a design but no row.** The Enhance chip for video words (and the `video.enhance_prompt` setting, default `ask`) is specified in [ltx-desktop-features-2026-11-06.md](ltx-desktop-features-2026-11-06.md) (LTXD-03), running on the hub's chat model. No `docs/BACKLOG.md` row carries it. Artlist's field-end "enhance" and "lyrics" icons are the same idea.
8. **Reuse search.** Names searched across Home, commons and the pinned tags: Composer, ComposerBar, ComposerToolbar, ComposerAttachButton, ComposerMentions, ComposerTriggerPopover, ComposerModelPicker, MobileComposer, PromptBar, prompt_bar, mode_selector, mode_actions, PromptBarMode, AskBox, composerHref, AskHandoff, PackageScopeContext (the single-shot app scope, unwired by its own comment), page_context, mention_companion_id, enhance, improve, rewrite, lyrics, presets, media_template, style_suggest, handOff. Nothing else does this job; the pieces are listed per part in section 8.

## 0. Rules and rulings that bind this

- Rule 0 and rule 10: age and surface gates outrank everything. A mode appears only where its tool is allowed for that person's band (`videosAllowed`, the Adult lock, the song lanes as ruled). A mode is a choice of tool that the person may already use; it never grants one.
- Rule 1: the model decides. In chat the mode is a hint the model reads; it is never a route. No regex on the words.
- Rule 9 and 9b: kit Elements as they ship; no `className` that changes shape or layout, no Home wrapper. A look that cannot be reached by tokens and props gets a prop in `commons` first, tagged (PINNING.md "Changing a shared kit element").
- Platform principle 6 (assistant-ui Elements for chat) and principle 4 (one definition, one place): modes are data, defined once.
- S6: a slow job reports through Activity. The composer starts the job; it draws no status of its own.
- Owner rulings that name what we drop: [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) (Standard, Boost, Max, model names only under Details), memory "No resource words for users" (2026-11-01), [ai-models-simple-2026-10-25.md](ai-models-simple-2026-10-25.md), the images note's leader table ("credits and prices on buttons, dozens of model names" left out), `submit_detail` "a time, never credits" (VIDEO-UI-03, `docs/design/UI-DECISIONS.md:41`), no fixed colours (2026-10-19), the model-picker gate on the chat page (adults with an active model only), Phosphene rule (a hand-off fills a form and starts nothing).

## 1. Recommendation (the short form)

One composer definition, two bindings, modes as data.

1. **One shape.** A rounded panel. Top row: "+" attach, the reference slots the current mode uses, Presets at the right. Middle: the field (grows), field-end tools at its right edge (clear, improve). Bottom row: mode picker, quality chip, the mode's combined chips (each opens one popover), the one primary button at the right. This is `PromptBar layout="chat"` with the parts it lacks added.
2. **Modes are data, defined once, in the package.** A mode is the `prompt_bar` node of that package's Create page. A new read, `GET /api/composer/modes`, collects those nodes for the signed-in person, drops what their band or the engine state does not allow, and returns the list. Chat, the Home ask box and every Create page read it. The hard-coded list in `AskBox.tsx` goes away.
3. **Two bindings, one set of parts.** The parts (mode menu, chip popover group, reference slot, preset button, field tools, primary button, motion) move into one kit module. `PromptBar` binds them to props (Create pages, Home ask box). The chat `Thread` binds them to the assistant-ui runtime through the slots it already has. Chat keeps its runtime; nothing in the chat stream changes.
4. **On a Create page, the mode picker moves between Create pages** with the draft carried (words, references, cast). Each app keeps its own results feed, library, jobs and rules. No merged feed.
5. **In chat, a mode is a hint.** Default is "Chat" (the model decides everything, today's behaviour). Picking Image shows the reference slot and the Image chips, changes the placeholder, and rides on the next send as one small structured field. The model reads it as "the person chose Image with these settings; this is a hint, not an instruction", and decides whether to call `generate_image`. If it does, the chosen settings fill the arguments the model left unset. It is never a forced route and clears after the turn.
6. **One "+" and one `@` everywhere.** The "+" menu (photos and files, camera on a phone, a song or audio file where allowed) and the `@` list (companions and cast, two item types, filtered by band) are the same pieces in chat and in Create.
7. **Motion from the kit tokens.** A mode change reveals or retracts the slots and chips with `motion-reveal` and `motion-fade`, the placeholder cross-fades, nothing moves the field. Reduced motion and `html[data-ease-motion="calm"]` already zero the durations.
8. **Theme tokens only.** No fixed yellow. Artlist's accent maps to the theme's primary token (`accent: "create"` already reads tokens).
9. **Left out of Artlist:** credits, "Generate free", the "Unlimited" toggle, model names, resource words (section 5).

## 2. The composer, part by part

Artlist element, what Home calls it, what exists, what to add:

| Artlist | Home part | Today | To add |
|---|---|---|---|
| "+" attach | `ComposerAttachButton` and the "+" menu (`ComposerAddMenu`), or the `PromptBar` in-field Plus | both exist, two code paths | one menu definition used by both bindings: Add photos and files, Camera (phone), Add a song or audio file (adults, `AudioUploadsContext`), From my Library, From my cast |
| Reference slots ("Image Reference", "Video Reference") | `PromptBarReference` (`kind` picture, character, place, audio, video; `placement: in_field`) and `modes[].references` | exists | slots come from the mode record (section 3); a cast member fills a picture slot as a chip (CREATOR-39) |
| Presets (top right) | a button that opens the existing Styles and Templates popover (`cards` chips, `media_template`, `song-style`) | the popover exists; no button in the top row | `presets` on the mode: a list of chip ids to show under one button; the popover is unchanged |
| Field with per-mode placeholder | `PromptBar` `placeholder` | one placeholder per bar | `placeholder` per mode, cross-faded |
| Clear, improve icons | none | none | `tools` on the mode: `clear` (always), `improve` (where a mode has a rewrite: LTXD-03 video words, picture words, lyrics for Music) |
| Mode picker | `modes` menu | exists | the same menu in chat |
| Model picker | none (names are not shown) | chat has the adult-only `ComposerModelPicker` and the Instant, Thinking, Max control; Create has the tier control | one **Quality** chip (tier) in the same slot in both places; see section 5 |
| Combined chips, one popover each | `chip.group` plus `presentation: "popover"` | exists (`StyleGroup`) | the mode record lists which chips fold into which group (for example "Landscape / Standard / 1 picture") |
| Primary action | the round submit with `submitLabel` and `submit_detail` | exists | `primary: { label, detail }` per mode; detail is a time, never a price |

### 2.1 The modes, as data

Each row is one mode record. Words are grade 6; "Auto" is the default of every chip so a first run needs only the words (Higgsfield rule already in the Videos note).

| Mode | Page that owns it | Placeholder (draft) | Reference slots | Combined chips | Presets | Field tools | Primary |
|---|---|---|---|---|---|---|---|
| Chat (default) | chat | "Ask anything" (today's) | none | none; the Instant, Thinking, Max control keeps its place as the Quality chip | none | none (dictation stays) | Send |
| Image | Images > Create | "Describe the picture you want. Type @ to add someone from your cast." | Picture (up to 3; a cast member counts as one, its sheet) | Shape, Quality, Pictures (1 to 8) | Templates, Styles | clear, improve | Generate |
| Video | Video > Create | "Describe the video you want. Put each person's line in quotes. Type @ for your cast." | Picture (start), Video (a clip to extend or change) | Shape, Length, Quality; Sound where the tier has it | Styles, Camera | clear, improve (LTXD-03) | Generate, with a time line |
| Music | Music > Create | "Describe the song you want. Add details like instruments or the kind of voice." | none (the "+" menu offers a song to change, adults) | Lyrics (Auto, My own, None), Length, Style and mood | Song styles | clear, lyrics helper | Generate |
| Voices | the page that owns Voiceover (AUDIO-PARITY-01 V1) | "Type what you want said." | none | Voice (face chip), Language, Delivery | none | clear | Generate |
| Film | Video > Create (Film) | "Describe the film. Name the people with @." | Cast (up to 6), Picture | Format (from the format ladder), Length, Quality | Formats | clear, improve | Plan the film |

Sound effects are a Music chip (Kind: Song, Sound), not a seventh mode (AUDIO-PARITY-01 P1 keeps them in Music). Whether Voices is its own mode or the Music mode's Voice chip follows where AUDIO-PARITY-01 V1 puts the page; the mode list is data, so either is one record.

### 2.2 How the shift looks

The panel keeps its width and its field; only the rows around the field change. Changing mode:

- the reference row slides open or closed (`motion-reveal`), the field does not move;
- the placeholder cross-fades (`motion-fade`);
- the chip row swaps its chips (`motion-fade`), each combined chip keeps its position when a mode shares it (Shape and Quality sit in the same place in Image and Video);
- the primary label changes in place.

A mode the person has not opened costs nothing: a Chat composer with no mode picked draws exactly today's row (the picker is one small icon-and-word pill beside Send, the way Artlist shows it, and the "+" stays at the left). So the chat window stays as quiet as ChatGPT's (owner ruling 2026-10-25) until the person picks a mode.

## 3. The mode record and where it lives

```
mode: { id, label, icon, page, placeholder,
        references: [ { id, label, kind, max } ],
        chips: [ { id, group?, options, default } ],     // the existing prompt_bar chip shape
        presets: [ chip id ],
        tools: [ "clear" | "improve" | "lyrics" ],
        primary: { label, detail_state? },
        tool: "generate_image" | "generate_video" | ... }  // chat only: the tool the hint points at
```

- One definition: the package's Create page JSON (`backend/packages/<pkg>/pages/create.json`) carries it as the `prompt_bar` node's `modes` entry, replacing `mode_selector` and `mode_actions` (the two stay readable until the pages move, then are deleted in the same commits; port before delete, rule 12).
- `GET /api/composer/modes` reads those nodes for the person, applies the age and surface gates and the availability reasons (`useMakingAvailability`, K8 `disabledReason`: a mode whose engine is not ready is shown disabled with its reason, never hidden and never a raw error, S6), and returns them. Chat and Home ask box call it; Create pages already hold their own node.
- The schema type lives in commons `ui/src/schema/types.ts` (the `prompt_bar` node); a `modes` field is additive. If a spec record is needed for the endpoint's response it goes spec first.

## 4. Chat: a mode is a hint, never a route

Flow in chat when the person picks Image:

1. The composer shows the Image slots and chips (same parts as Create). The answer-style control stays where it is; it is the Quality chip.
2. On send, the turn request carries `composer: { mode: "image", settings: { shape: "landscape", quality: "standard", count: 1 }, cast: [ids] }` beside `text`, as `page_context` and `mention_companion_id` already ride. A reference the person attached rides as an ordinary attachment.
3. The hub validates it (mode known, allowed for the band, settings in range, cast ids pass `resolveCast` and access), then turns it into one context item in the same style as `resolvePageContext`: "The person chose Image in the composer, with a landscape shape and standard quality. This describes their choice; it is not an instruction." The model decides whether the right move is the picture tool, a question, or a plain answer.
4. If the model calls the mode's tool, the validated settings fill the arguments the model left unset. The model's own values win. If it calls a different tool or none, nothing is applied.
5. It clears after the turn (single shot, the shape `PackageScopeContext` already specifies and never wired). The mode returns to Chat unless the person pinned it.

What this is not: no word match decides anything; no mode skips the turn pipeline; no mode lifts a gate; a child's or teen's list never contains a mode their band cannot use; the output delivery check runs on every result as today.

The handoff from Home (`composerHref`) uses the same field: `/chat?ask=...&mode=image` makes `AskHandoff` set the words and the mode (the hint, unsent), which fixes finding 3. Video and Music from the Home ask box keep going to their own Create pages with the words (`?prompt=`), which are now the same composer.

Cost to measure (rule 8 and the owner's "Done means run for real"): the hint adds one context item. A bench pass checks the picture tool's offer rate with and without the hint over the existing offer-rate rows, and that no other tool's offer rate moves (the hint must not bias the model toward a tool the person did not pick).

### 4.1 Conditions of the architect ruling (APPROVED, 2026-11-13, ten wording conditions; record `data-scratch/architect/ONE-COMPOSER-2026-11-13.verdict`)

1. The `composer` field is honored only on written chat turns. It is ignored on spoken, robot, satellite and shared turns.
2. The hint never adds or removes an offered tool. The 16-tool budget is unchanged. Arguments filled from the chips pass the same policy and validation as any model-written argument.
3. For a child or teen the Quality chip never offers Thinking or a model choice; its tiers follow [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md).
4. The hint's context item is placed after the stable prefix, like the page-context item.
5. No log, trace or status carries mode settings, cast ids or chip values. Counts only (rule 6a).
6. COMPOSER-04's "no other offer rate moves" is measured on the CHAT-AB-01 fresh set, held-out split, three or more repeats, paired 95% intervals, search decisions included.
7. COMPOSER-03's band filter calls the same policy functions `beginTurn` uses. Readiness comes only from `roleHealth` through `healthSnapshot` or `useMakingAvailability`, never polled; Music and Voices readiness are new `roleHealth` reasons, each with a `failureCopy` line.
8. The `composer` request shape is a `@maipai/spec` type landed in commons spec before COMPOSER-04.
9. COMPOSER-02: the kit draws the mode pill, slots and chips inside `Thread`; Home passes data only; no `ComposerInputOverride`; the parts are listed in `frontend/src/dev/elements-adoption.json`.
10. The VIDEO-UI-03 citation is `docs/design/UI-DECISIONS.md:41`.

## 5. What we drop from Artlist, and why

| Artlist | Home | Ruling |
|---|---|---|
| Credits, a credit count on the button, "Generate free" | the button says Generate and, for video and film, a time line ("About 3 minutes") | `submit_detail` is "a time, never credits" (VIDEO-UI-03, `docs/design/UI-DECISIONS.md:41`); images note: credits and prices left out; no plans or purchases in Home |
| "Unlimited" toggle | none; the household's own machine has no quota to toggle | same |
| A model picker with brand names | one **Quality** chip: Standard, Boost, Max, with the one-line verb per category ("Fast", "More detail", "Best quality"; video "Quick clip", "With sound", "Best quality"; music "Quick", "Full song", "Studio quality") | resource-tiers section 3; "No resource words for users"; model names only under Details in Settings |
| The adult-only chat model picker | stays exactly as it is in chat, behind its existing gate, in its existing place (the trailing slot); not added to Create | model-picker gate (adults with an active model) |
| Resource words (memory, room, load) in tooltips or errors | never; a busy machine shows the queued Activity row | no-resource-words rule; S6 |
| Marketplace or community feed links in the composer | none | images note leader table |
| Fixed yellow | the theme primary token | no fixed colours |
| Auto buttons that hide a cost | `Auto` is a visible chip value with its meaning in the popover | grade 6 copy |

## 6. Phone layout

- Create pages in a stacked `split_view`: the existing `placement: "panel"` dock (box, Options button, round submit) and a bottom sheet. The mode picker, quality, chips and presets live in the sheet; reference slots sit above the box as thumbnails once filled. Nothing new is drawn.
- Chat on a phone: the existing compact composer. The mode pill sits beside the "+"; a picked mode reveals one row above the field (slots, then chips as a horizontally scrolling row, the existing `MobileComposer` action strip pattern), never more than one extra row; Options opens the sheet for the rest.
- Targets at least 44 px (`hitArea`), the keyboard never covers the primary button (the `MobileComposer` keyboard-open state), the field keeps focus across a mode change (`preserveField` already does this in `PromptBar`).
- Opened at 1440 and 390, light and dark, as every UI exit.

## 7. How this amends the open rows

One owner row: **COMPOSER-01** (the shared parts and the mode record; COMPOSER-02 is its chat binding). Other rows keep their scope and say what they take from it.

| Row | Change |
|---|---|
| CREATOR-39 (`prompt_bar` shot-card chips, cast `@`, reference slot, takes) | Absorbed into COMPOSER-01 as far as chips, the cast `@` list and the reference slot go (they become part of the mode record); the takes segment stays as a chip in the mode records. Marked "absorbed, do not start" |
| CREATOR-40 (reference and cast slots in the Create panel and film shot cards) | Slots now come from the mode record; the Create panel part is COMPOSER-05; the film shot-card half stays in CREATOR-40 and reads the same parts |
| CREATOR-05 (`cast` on the tools and `@` in chat) | The `@` list stays one kit `ComposerMentions` list with two item types; this note makes it the same list in every Create page too (the `@` in a Create field is the mention popover over the same cast source). The tools' `cast` argument and `resolveCast` are unchanged |
| MP-U1 (Music Create panel: Simple and Custom, lyrics box, style chips, advanced drawer) | The Simple branch is the Music mode of the one composer (words, Lyrics chip, Length, Style and mood, Generate). The Custom branch (lyrics box with structure tags, title, instrumental, language, seed, bpm, key, reference audio) stays a drawer under "More" on the same panel; its fields are chips in the mode record or the drawer. MP-U1 keeps the drawer and the song-specific parts, loses the bar |
| VIDEO-UI-03, VIDEO-UI-06 | VIDEO-UI-06's `pages/create.json` carries a `modes` entry for Video; `mode_selector` and `mode_actions` retire with it |
| IMG-UI-01 and IMG-UI-00 | Images Create is the Image mode on the one composer (the IMG-UI-00 `blanks` prop and the Template popover are its Presets) |
| FILM-06 (a Film entry in Create) | The Film mode record is its entry |
| AUDIO-PARITY-01 V1 (Voiceover) | The Voices mode record is its page's bar |
| LTXD-03 (Enhance chip, design note only) | The `improve` field tool is the slot for it; its behaviour (the rewrite on the hub chat model, the `ask`/`auto`/`off` setting) is unchanged |
| HOME-ALIVE-01h (Home ask box) | Reads `GET /api/composer/modes`; drops its hard-coded list |
| VIDEO-COMPOSER-01 to 04 (shipped, kit) | Kept as the base; this note extends `modes` and `layout: "chat"` |

## 8. Reuse check, per piece

| Piece | Reuse | New |
|---|---|---|
| The panel, mode menu, chips, popover groups, references, tier, submit | kit `PromptBar` as shipped (`layout: "chat"`, `modes`, `shape: "pill"`, `accent: "create"`), `StyleGroup`, `OptionCards`, `TierSegment` | the parts move into one module both bindings import; no second copy |
| Chat binding | the Thread slots `ComposerAddAttachmentOverride`, `ComposerExtraEnd`, `ComposerInputOverride`, `BelowComposer`, `composerPlaceholder`, `composerDensity` | a `composerModes` context on `Thread` (props, not a fork) |
| "+" menu | `ComposerAddMenu`, `ComposerMenu`, `ComposerAttachButton`, `AudioUploadsContext` | the Create binding uses the same menu items (Library and cast entries added to the list) |
| `@` | kit `ComposerMentions`, `ComposerTriggerPopover`, `CompanionComposerMentions`, `GET /api/cast` (CREATOR-04) | the Create field mounts the same popover; cast items are a second item type (already in CREATOR-05) |
| Modes as data | schema `prompt_bar` node (`chips`, `references`, `tier`, `style_suggest`), package Create pages | `modes` field (additive) and `GET /api/composer/modes` |
| Presets | `media_template`, `song-style`, the Styles popover, `suggestedStyles` | a button and `presets` list only |
| The hint | `resolvePageContext` (the "describes the choice, not an instruction" item), `page_context` and `mention_companion_id` request fields, `PackageScopeContext` (single shot) | one validated request field, one context item, defaults-fill on the called tool |
| Home to Create hand-off | `MediaHost.handOff(to, { file })` (EDITOR-HANDOFF), `AskHandoff`, `composerHref` | `handOff` also carries words, cast and `mode` |
| Draft kept | `composerDraftRestore.tsx` (chat), `PromptBar` state in page state | one carried draft shape for words, cast, files |
| Motion | `--motion-*` tokens and `motion-reveal`, `motion-fade`, `motion-list` (MOTION-01, ui-v0.5.633 to .635) | none |
| Improve | the hub chat model, LTXD-03's design and gates | the field tool |
| Not found under any name | a composer-level lyrics writer | the Music `lyrics` tool of the field (hub chat model, same gates); decided in COMPOSER-07 |

## 9. Rows (see `docs/BACKLOG.md`, "One composer")

1. **COMPOSER-01** (commons ui, M): UI-DECISIONS row first, then the shared parts module, the per-mode `placeholder`, `chips`, `presets`, `tools`, `primary`, `modes` in the schema node, motion through tokens, phone layout; `PromptBar` is the controlled binding. Exit: showcase opened at 1440 and 390, both themes, tests, tag.
2. **COMPOSER-02** (commons ui, M; after COMPOSER-01): the chat binding. `Thread` takes `composerModes`; renders the mode pill, slots and chips through the existing slots; runtime state (settings, hint) exposed to the host. Exit: Thread tests and a showcase; the Instant, Thinking and Max control is the Quality chip in the same place.
3. **COMPOSER-03** (Home backend, S): `GET /api/composer/modes` (band, availability, `disabledReason`); the `modes` entries in the package Create pages; delete AskBox's list.
4. **COMPOSER-04** (Home backend, M; needs the architect's answer to open question 1): the `composer` request field, validation, the context item, defaults-fill on the called tool, bench rows for offer rate. Exit: with the hint "Image" a plain "a dog on a beach" gets the picture tool and "what is a dog" does not; no other tool's offer rate moves.
5. **COMPOSER-05** (Home, M; after COMPOSER-01, VIDEO-UI-06, IMG-UI-01): Create pages on the one composer (Video, Images, Music Simple, Voices, Film), mode picker as navigation with the draft carried; Home chat binding wired (COMPOSER-02 pin).
6. **COMPOSER-06** (Home, S): hand-off carries words, cast, files and `mode`: `AskHandoff` reads `mode` (fixes the unread `mode=picture`), `composerHref`, `MediaHost.handOff`.
7. **COMPOSER-07** (Home, S; after COMPOSER-01): the field tools: `clear`, `improve` (LTXD-03 behaviour, per mode wording), Music `lyrics` helper; all on the hub chat model, outputs through the delivery gate, one plain line when the engine is not ready.
8. **COMPOSER-08** (Home, S, last): the dev gallery (a `bun run dev` page or the showcase) screenshots every mode at 1440 and 390; the Create copy sweep (no credit, price, resource or model words) as a test.

## 10. Supersedes

| Replaced or absorbed | By | What stays |
|---|---|---|
| `mode_selector` and `mode_actions` on the schema `prompt_bar` node (Image or Video, `ask` hand-off) | the `modes` list (COMPOSER-01, -03); removed when VIDEO-UI-06 and the other Create pages move | the `ask` hand-off idea: a visible, editable nudge in the person's words, never forced |
| The hard-coded modes list in `AskBox.tsx` and its unread `mode=picture` | `GET /api/composer/modes`; `AskHandoff` reading `mode` (COMPOSER-03, -06) | the Home ask box and its three starter chips |
| CREATOR-39 (chips, cast `@`, reference slot, takes on the bar) | COMPOSER-01 (takes stay as a chip) | its exit check (showcase opened, tag) |
| The Simple branch of MP-U1 (the Music Create panel's bar) | the Music mode record | the Custom drawer, structure-tag lyrics box, title, seed, bpm, key, reference audio |
| Per-page prompt-bar props written separately in each Create page JSON (chips, placeholder, submit label) | the page's `modes` entry | every chip and option that exists |
| `PackageScopeContext`'s unwired app scope in `composerAddMenu.tsx` | the single-shot `composer` hint of COMPOSER-04 (the same shape, now with a reader) | the file's menu items |

Not superseded: `RULES.md`; spec 4.3 of the companions note (the one-turn guest `@mention` keeps its routing); VIDEO-COMPOSER-01 to 04 (shipped kit, extended); the chat model picker and its gate; the IMG-UI-00 `blanks` prop.

## 11. Open questions

1. **Does the `composer` request field need a RULES.md entry?** Rule 9 says custom code in the chat path needs a named gap. The field is a request addition like `page_context` and rides the existing context mechanism, with no stream change, so this note reads it as ordinary. If the architect rules it needs a rule, stop: only Jesse changes a rule.
2. **Defaults-fill (section 4 item 4)**: filling the called tool's unset arguments from the chip values is the part closest to routing. It runs only when the model already chose the tool. The alternative is context text only (the model may ignore a chosen shape). The note recommends defaults-fill; the bench in COMPOSER-04 decides.
3. **Voices as a mode or a Music chip**: follows AUDIO-PARITY-01 V1's page; either is one mode record.
4. **One carried draft across Create pages** (words plus cast, references only where the next page takes that kind): recommended; a mode that cannot take a carried reference says so on arrival in one plain line.
5. **Whether chat shows the mode pill from the first message or only after "+" is pressed**: recommended, the pill is always visible beside Send (Artlist's look); one preview opened at 1440 and 390 settles it before COMPOSER-02 is tagged.

## 12. As built: COMPOSER-03 (2026-11-13)

- **Where the modes live.** The schema `prompt_bar` node has no `modes` field (spec 0.1.378 sets `additionalProperties: false`), so a mode is the Create page's own `prompt_bar` node (placeholder, `references`, `chips` with `group`, `tier`, `submit_label`) plus `backend/packages/<package>/composer.json` for what the node cannot say: id, label, icon, `route`, `engine`, `gate`, `tools`, `presets`. Nothing is written twice. Moving the descriptor into the node is one additive spec change later. The Music entry (`packages/audio/composer.json`) is a words-only placeholder for the music session to fill.
- **`GET /api/composer/modes`** (`backend/src/lib/composer/modes.ts`): Ask first, then each descriptor whose gate passes (`picturesAllowed`, `videosAllowed`, `musicsAllowed` with `routeAudience`, the policy functions the turn's tool gates call) and whose page the person may open (`getAppPage`). Quality lists Standard plus Boost and Max only where `authorizeTier` and `maxOffered` allow it. Readiness is a reading of `collectHealth()` at request time for non-web callers; the web composer reads the live `["health"]` query and the route is read once, never polled.
- **Readiness.** `roleHealth` gains `music` and `voices` (`MakingRole`), health rows `engines.music` and `engines.voices`, and `failureCopy.ts` lines through `makingNotice`.
- **Home.** `frontend/src/shell/composer/composerModes.ts` maps the data to the kit `PromptBar` modes. The Home ask box has no mode list of its own; a Create mode opens its own Create page with `?prompt=` and every chip value, so the chosen mode and settings survive the trip (the unread `mode=picture` is gone). On a Create page the host's `composer` (kit `MediaHost.composer`, ui 0.5.641) turns that page's `prompt_bar` into the kit composer with a mode pill that carries the draft to the next mode's page; chips fold to one popover per `group`, Look and Camera keep their picture cards inside it, and the old `mode_selector` and `mode_actions` are gone from the Video page.
- **Images Create** is a real `prompt_bar` page whose submit is the visible `ask` hand-off to Chat (the same words, shape, count and quality, unsent), because no route starts a picture outside a chat turn yet. The Image Reference slot and the Video Reference slot are not drawn: nothing consumes a reference on those paths yet (COMPOSER-04 and IMG-UI-01).

## 13. As built: COMPOSER-04 (2026-11-13)

- **The request shape** is the `@maipai/spec` record `turn-composer` (`TurnComposer`, spec 0.1.381, tag `spec-v0.1.381`): `mode`, optional `settings` keyed by chip id, optional `cast` (up to six ids). It has no tool name and refuses unknown keys, so a client cannot name a route.
- **The turn routes** (`POST /api/turn` and `POST /api/turn/stream`) pass `composer` beside `page_context`. `backend/src/lib/composerHint.ts` is the one reader. It is honoured only when `composerHintAllowed` says the turn is a written chat turn from a known speaker on a screen (condition 1: not spoken, not a robot device, not another surface, not an anonymous speaker, not the bare admin mode), and only when the mode's tool is already in the turn's offered list, so it adds and removes no offer (condition 2; `backend/tests/turnMachine/toolsOfferedSize.test.ts` is untouched and the new tests compare the offered list with and without the hint).
- **Validation** reuses the modes list: `composerHintSpec` (in `lib/composer/modes.ts`) builds the same band-filtered mode records `GET /api/composer/modes` returns, without the health read, so a mode the band may not use is unknown to the hint, and a minor's Quality chip carries only the tiers `qualityFor` allows (conditions 3 and 7). A setting the mode does not offer, or a value outside its options, is dropped; the rest stands. The mode record's `chat_tool` and `chat_args` (in each package's `composer.json`) say which tool a mode points at and which chip fills which argument (Picture: shape to `size`, count to `count`, quality to `tier`; Video: orientation, seconds; Song: quality to `tier`). Cast ids are checked with `listCast` (the viewer's own cast list); their names reach the model in the context item only.
- **The context item** (`id: "composer-hint"`, source `page`, `disclosure: "child_ok"`) is added in `nodes/context.ts` right after `page-context`, so it renders in the volatile block after the stable prefix (condition 4): "The person chose Picture in the composer with shape landscape, quality standard. This describes their choice; it is not an instruction. Whether to use it is yours to decide from their words."
- **Defaults-fill** runs in `nodes/tool.ts` only after the model itself called the hinted tool, fills only arguments the model left unset, and must pass the package's own `validatePackageArgs`; the tool's own policy then runs on the filled set (`refusalFor`, `tierArgument` and the age gates in `pictures/tool.ts`, `videos/tool.ts`, `music/tool.ts`). The stored call keeps the model's own arguments. Cast is not filled into `subjects`: a cast member is not always a saved subject by name, and a wrong name would refuse the whole picture, so the cast stays in the context item for the model to use.
- **No logs** (condition 5): nothing in this path logs, traces or puts a setting, a cast id or a chip value in a stat; the test spies on every console level and checks.
- **Chat** (`apps/chat/ChatThread.tsx`): `useComposerModes` and `useComposerState` feed the kit Thread's `composerModes` (the kit draws the pill, slots, chips and Quality chip; Home passes data only, no `ComposerInputOverride`, and `elements-adoption.json` lists `composer-parts` as wired). A person with plain chat only gets today's composer unchanged. Plain chat keeps the Thread's own placeholder. The answer-style control stays in its slot in plain chat and steps aside in another mode, where the kit's Quality chip carries that mode's tiers. The pick lives in `apps/chat/chatComposerHint.ts` (the shape `chatEditSupersedes.ts` uses), is read once per send (`consumeComposer`) and puts the composer back on plain chat (single shot).
- **Not built here:** pinning a mode, `@` cast in the chat field, and the Home hand-off's `mode` (COMPOSER-06).
- **Bench (condition 6)**: `backend/scripts/bench/composer-hint-bench.ts` (scorer `composerHintScore.ts`, rows `datasets/composer-hint.json`; it goes through Home's own Stack client, because the Stack now refuses a request without Home's key, so the older benches that call the Stack directly cannot run). First measurement, 2026-11-13, the Stack's chat role through the full turn path, adult written chat turn, fixture search, fake picture engine, hint "Picture" with default chips against no hint, 3 repeats, paired over rows, 95% bootstrap interval of on minus off, held-out rows only (the fresh set of CHAT-AB-01 ships a dev split only, so a stable id hash made the held-out half), 5 rows per group (150 turns, none errored, other sessions' gates ran beside it so only rates are read):
  - the picture tool on a picture request: 100% off, 100% on (the model already picks it from the words alone, so there was no rise to measure);
  - the picture tool on a plain question: 0% off, 0% on;
  - the picture tool on a fresh row: 0% off, 4.4% on, +4.4 [+0.0, +13.3] over 15 rows. Both calls were one row, "how many sides does a hexagon have", in two of its three repeats: a Picture hint can pull a drawable-sounding question toward the picture tool. The interval touches zero at n of 15; it is the thing to watch and to re-measure with more rows before the hint is shown as the default for every person;
  - search on a time-sensitive row: 100% off, 100% on; search on a timeless or hard-negative row (a false search): 16.7% off, 6.7% on, -10.0 [-23.3, +0.0]; search on a picture request or plain question: 0% and 0%;
  - any other tool: 4.0% off, 6.7% on, +2.7 [+0.0, +6.7] over 25 rows (math, convert, almanac-date on a few turns in either arm);
  - the number of tools handed to the model was identical in 75 of 75 paired turns.
  Not measured: Video and Song hints, child and teen bands (their rules are covered by tests, not by a model run), and a larger row set. The raw runs are kept in the git-ignored `data-scratch/composer-hint-bench/results-2026-11-13.json`.
