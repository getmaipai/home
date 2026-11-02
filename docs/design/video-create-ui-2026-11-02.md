# Videos Create: the Higgsfield-style screen (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending. No code. Item: VIDEO-CREATE-02. Amends
[video-create-2026-11-01.md](video-create-2026-11-01.md) section 3 (the Make page layout); the menu, the shot model, consistency, chat
parity and safety there stand. Tiers and sizes follow [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md).

Owner direction (Jesse, 2026-11-02): the Make page as built (a prompt bar with dropdown chips) is too plain; he wants it "just like a
modern Higgsfield" and approved this layout from an inline mockup.

## Supersedes

- [video-create-2026-11-01.md](video-create-2026-11-01.md) section 3, item 2: the chip list changes. The Recipe chip becomes two card grids,
  Look and Camera; the Character, Place and Start frame chips become the reference slots; the Shape chip (landscape or portrait, `shape`
  in commons `spec/ui/pages/videos-make.json`) stays as a chip; Length keeps its chip, now 5 s and 10 s.
- Section 6 (Recipes): one list splits into two lists, Look and Camera, each in one place; the rule that a card ships only after a bench
  shows it changes the clip on the engine carries over to every card.
- Section 7 and slice V2: `recipe` becomes `look` plus `camera`, and `voices` is new on `generate_video`; each needs the offer and
  false-offer measurement of bench row 10 (rule 1); [video-chat-2026-11-02.md](video-chat-2026-11-02.md) declares them.
- The landed V1b Make page (`backend/packages/videos/pages/make-video.json` and the page fill in `lib/media/videoCreateApp.ts`) is rebuilt
  on the new nodes in slice U3; the per-person fill (recipes, looks, tiers, lengths from their single lists) is kept.

## 1. The screen

Left panel:
- **Prompt box** with one hint line: write what you want to see; put each person's line in quotes.
- **Reference slots**: picture, character, place. Dashed squares that take a Library picture or an upload; a filled slot is the first
  frame. This is the Start frame of the Create design.
- **Look**: a grid of picture cards (Natural, Classic cartoon, Anime, 3D animated, Film). Each card plays a short silent loop made by our
  own engine. One choice; the chosen card has the accent border.
- **Camera**: a grid of picture cards (Still, Dolly in, Orbit, Handheld, Slow motion, Time-lapse, Aerial, Close-up), same behaviour.
- **Level**: the kit tier segment (Standard, Boost, Max). Max shows only for a person who may use it.
- **Length**: a stepped control (5 s, 10 s, later 15 s) showing the estimated time from the tier's measured numbers.
- **Voices**: a small toggle (keep it clean, or with music and effects).
- **Make**: one button.

Stage column (inside the app's content, beside the controls; nothing draws to the right of an app's content but the companion pane): a large **preview stage** (the kit player) with progress while a clip is made and the actions Another take, Continue and
Download, then a **shot strip** of recent clips with a dashed slot for the next one. On a phone the panels stack and the card grids
scroll sideways.

## 2. Reuse check (org principle 6, one definition each)

| Part | Decision | Why |
|---|---|---|
| Look and Camera cards | a `variant: "cards"` of the `prompt_bar` chips, with an optional `media` per option (additive, in spec then ui); the options come from the same per-person fill | the prompt bar submits only its own chip state, so the cards must be chips of it to arrive in one submit; a chip already carries up to 24 options, so Look (5) and Camera (8) fit (the `picker` node caps leading options at 4 and writes page state the bar does not read). One definition, one submit |
| Reference slots | an optional `references` list on `prompt_bar` (additive) | the slots submit with the prompt in one action; a second node would split the submit |
| Preview stage | reuse the `player` node (with its actions and `empty_state`) plus the `progress` node | exists in the schema |
| Shot strip | reuse `media_shelf` (it now carries `row_actions`, spec 0.1.299); not a new strip; `ClipTimeline` (EDITOR-12) stays the editor's own | exists |
| Option card look | compose from shadcn `Card` and `ToggleGroup` semantics (radio group, keyboard arrows), theme tokens only | no shadcn or Kibo card-picker with video exists in the registries |
| Loop playback | one muted `<video>` per card, `loop`, `playsInline`, play on hover or when in view on phone | the kit video primitives |

Existing tile nodes considered and not used: `category_tiles` and `quick_tiles` (the music blocks) and `card_grid` draw tiles that open or play
something through `on_select`; none writes a chosen value into a form submit, which is what a Look or Camera card must do.

Each addition gets its UI-DECISIONS.md row in commons before the Element is written (rule 9b); no Home wrapper, no className that
changes shape (rule 9).

## 3. The sample loops

Looks and cameras need real samples or the cards are empty boxes. We make them as a build step, not at run time, with our own engine (LTX-2.5 q8 distilled at 512x288,
2 to 3 s, silent, one prompt per card, about 30 s each, 13 clips), keep each under 300 KB (mp4 or webp), and ship them as package
assets. Nothing is fetched at run time; no outside images. Rule 11 is not touched (a build step, not Home calling an engine); they are regenerated with the Stack-pinned runtime once there is one. Asking the owner before generating (about 13 clips on the Studio).

## 4. Chat

No new chat tool. The Look, Camera, Length, Level and Voices are arguments of `generate_video` (V2 of the Create note); the chat video
card is the same Element as the preview stage's player and actions.

## 5. Safety and privacy

Unchanged: adult-only Create, gates in the tool, zero outbound connections (the loops are local files). A Look card never names a real
person or a brand character; the cartoon IP examples live only in prompts the person types.

## 6. Slices

| # | Size | Slice | Done when |
|---|---|---|---|
| U1 | M | Spec: `prompt_bar` chip cards variant and `references`; ui Elements with tests; UI-DECISIONS rows; tags | commons tests and tsc pass; tags pushed |
| U2 | S | Make the 13 loops (owner yes first); package assets | each card shows its loop; each under 300 KB |
| U3 | M | Home: pin the tags; rebuild the Make and Create pages on the new nodes (stage, strip, cards, slots) with the per-person fill | preview on desktop and phone opened and judged; a clip made and shown in the stage |
| U4 | S | Phone pass and keyboard/focus pass | cards scroll sideways; arrow keys move the choice |

## 7. Open points

None block U1. Later: a storyboard tab, a character gallery, and the cards' loops regenerated when the engine changes.
