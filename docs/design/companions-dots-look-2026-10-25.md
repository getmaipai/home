# Companions: the dots look and feel (2026-10-25)
> Status (2026-10-31): superseded in part by [companion-three-screens-2026-10-28.md](companion-three-screens-2026-10-28.md): the Look and States tab restyle.

> **Superseded in part (Jesse, 2026-10-26, [companions-handoff-revamp-2026-10-26.md](companions-handoff-revamp-2026-10-26.md) section 4):** the gallery, detail page and header follow the handoff mockup, not the round-character look. The Look and States tab restyle and the chat header still stand.

Owner's request (Jesse, 2026-10-25): update the companion design to look and feel like ChatGPT dots, researched from public
screenshots. Scope he chose: every companion screen, including the Look and States tabs. The character stays a generated picture
or video (no parts builder). This is a restyle of what exists (COMPANIONS-APP-01, COMPANIONS-STUDIO-01, COMPANIONS-SHELL-01);
no record, route or setting changes.

## What the evidence shows

Sources: Jesse's three screenshots (a chat with the dot Satori, the first message of the dot Dobby, the desktop "Create your dot"
page) and the research report `data-scratch/reports/chatgpt-dots-research.md`. OpenAI's own pages could not be fetched, so
detail beyond the screenshots is marked as a guess.

Seen in the screenshots:

1. **Chat header.** A round menu button top left and a round phone (call) button top right, both soft dark discs. The dot's
   character floats in the middle at the top, overlapping a rounded pill that holds its name. The thread scrolls under the header
   with a blur fade. The thread has no avatar beside each message: the character lives only in the header.
2. **Messages.** The dot's replies are dark rounded bubbles with no avatar and no name; the person's are muted blue rounded
   bubbles on the right. "Read 10:50" sits under the person's last bubble. A date line ("Today 9:15 AM") centres above the
   first message.
3. **First message** is two short bubbles: "Hey, I'm your dot." then one sentence on how to reach it.
4. **Create page.** One centred column on the page background: a large round character, a large title ("Create your dot"), one
   grey sentence, then three rows of icon tile (rounded square, soft fill), bold line and grey explanation, then one wide white
   pill button "Continue". No card borders, no boxes around the column.
5. **Characters** are simple friendly shapes (a blue cloud with a beret, a pixel robot, a plain grey ring as the default).

Verified by text only: the editor offers name, shape, colour, eyes, glasses and accessories; opening a dot's name or avatar
shows its profile with Computers, Scheduled, Activity and Plugins sections and a pause item in a ••• menu; Call is a button in
the profile.

Not public, so decided here by merit: the gallery layout, the picker, the editor tab layout.

## The design (answers)

1. **Character first, words second.** Every companion surface leads with the character large and round, the name in a pill
   beneath or overlapping it, and one short line. The long dial sentences move one tap down (the detail page), not on the card.
2. **Gallery and picker** (`/companions`): a calm grid of round characters with name pills under them. Tap opens the companion.
   The default shows a small check mark, not a text badge. The card menu stays (set default, delete). Each companion's one
   plain-words line sits under the pill in grey, and the S6 jobs summary line stays on the card under it, in the kit Status
   Element as shipped (rule S6 names the Yours card; it does not move). "New companion" becomes the last tile, a dashed round "+", plus the existing
   button stays in the page header.
3. **Detail** (`/companions/:id`): a centred hero (large character, name pill, one line, two round buttons: Talk and Call where
   the surface allows, and a ••• menu). Tabs below it use the kit's tab primitive. About, example lines, voice sample and
   "Set as my default" keep their content and move under the hero.
4. **Create** (`/companions/new`): a single centred column like "Create your dot": large character placeholder, title
   "Create your companion", one grey sentence, three icon rows (what a companion is, what it can do, what stays private), one
   white pill "Continue" into the existing wizard and editor. Copy follows `brand/COPY.md` and the dad test.
5. **Editor** (Identity, Voice and style, Look, States): the same hero strip stays pinned above the tabs so the character is
   always visible while editing. Fields stay the same; only the layout changes. Any change to a Card's border or fill is a new kit variant (for example a Card
   with no border) added in DOTS-KIT-01, never a className.
6. **Look and States tabs**: the twelve state cards become round character tiles with the state name in a pill; takes and
   approval stay as they are.
7. **Chat header (deferred, named gap).** The overlapping character and name pill has no kit Element and chat is assistant-ui
   Elements only (rule 9), so this is a commons change first and Jesse's yes to a new tag. Until then the header keeps today's
   companion pick. When built, the header character is the only character in the chat area: the corner avatar stays on the other
   areas and keeps its Hide behaviour. Age and surface gates and the no-cap adult chat rule are untouched.
8. **Messages: unchanged in this pass.** The two-bubble greeting and the "Read" line are dropped (the kit has `MessagePair` and
   `DayDivider` but no read receipt, and a canned greeting would need its own rule 10 source). Revisit with the chat header.
9. **Colour and type**: tokens only. Soft fills come from token values or a kit variant, never a className background or border; the white pill button is the kit `Button` default
   variant with no className. No new hue, no new font.

## Supersedes

Of `companions-shared-chat-and-presence-2026-10-24.md`:
- Section 3 (header control "next to the title"): replaced by decision 7 once built; today's placement stands until then.
- Section 4 (Yours and Discover tabs; activity line and two counts on each card; S6 status line): the tabs stay. The activity
  line and the two counts move from the card to the detail page's Activity tab; the gallery card keeps the name pill, one
  plain-words line, the S6 jobs summary line (rule S6, unchanged), the default check mark and the card menu.
- Section 5 (detail tabs Activity, Tasks, Chats, About): the tabs stay and sit under the new hero.
Of `companion-video-characters-2026-10-21.md` and the CMEDIA-EDITOR rows (COMPANIONS-STUDIO-01 was replaced by them): the
editor's field set is unchanged; only the surface layout changes.

## Reuse check (kit `@maipai/ui` ui-v0.5.331)

| Need | Use | Gap and reason |
|---|---|---|
| Character hero with name pill | `CompanionAvatar` (video) and `Avatar` (picture) | No name-pill overlay anywhere. Gap: commons Element `CharacterHero`. |
| Round character tile | `CardGrid` with `Avatar` + label as the item | `FileTile` is file-shaped. Gap: commons Element `CharacterTile` (selected check, menu). |
| Feature rows | `List` + `IconTile` via `renderItem` | None: composed, no new Element. |
| Create intro | `EmptyState` / `EmptyStateGreeting` + `Button` default | None. |
| White pill and round icon buttons | `Button` variant default, sizes default and icon | None; no className. |
| Tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | None. |
| Chat header with centred identity and call | none | Gap: commons Element; deferred (decision 7). |
| Dashed new tile | none | Plain Home markup is barred by rule 9b; make it a `CharacterTile` variant in the same commons change. |
| Date line | `DayDivider` | Unused now. |
| Greeting pair | `MessagePair` | Unused now. |

So two commons Elements (`CharacterHero`, `CharacterTile` with an add variant) unlock steps 2 to 5; a third (chat header) unlocks
step 6. Home markup stays plain layout only (no border, radius, shadow or background of its own, rule 9b).

## Constraints and what needs Jesse

- **Rule 9:** no `className` on a kit Element that changes shape, border, radius, shadow, background, padding, margin, size or
  layout, and no Home wrapper around an Element. Anything below that the kit cannot do by tokens or props needs a commons change
  first (its own worktree; only Jesse says yes to a new tag):
  - `CharacterHero` (round media, overlapping name pill): detail page, editor strip;
  - `CharacterTile` (round tile, selected check, menu, add variant): gallery and state grid;
  - the chat header Element (deferred).
  The reuse check above is the audit of the shipped kit; Jesse's yes is needed for each commons tag.
- The age rule `companionFits`, the admin-only preview switch for shells and every route stay as they are.
- Screenshots: generated against the seeded demo household, opened and judged at 1440 and 390 widths, light and dark.

## Build order (each a landing)

1. **DOTS-KIT-01:** first one `docs/design/UI-DECISIONS.md` row per part (why no kit, shadcn registry or Kibo UI part fits; the
   parts it is built from; Jesse's approval), then commons Elements `CharacterHero` and `CharacterTile` (with add variant) in their own worktree, tests and a
   stories page; Jesse says yes to the tag before any pin.
2. **DOTS-GALLERY-01:** `/companions` gallery, picker and the new-companion tile.
3. **DOTS-DETAIL-01:** detail hero, tabs, editor hero strip.
4. **DOTS-CREATE-01:** the create intro page.
5. **DOTS-STATES-01:** Look and States tabs as round tiles.
6. **DOTS-CHAT-01:** chat header hero (needs its own commons Element and a named-gap line in `RULES.md`, Jesse's yes).

Build notes for DOTS-KIT-01 (architect, 2026-10-25): `CharacterTile` names slots for the plain-words line and the S6 Status line
under the pill, so no Home wrapper is needed; a pinned editor strip is a prop on `CharacterHero` or Home's own plain layout
element, never a `sticky` className on the Element.

## Open questions (none block step 1)

- Whether Call on a companion's page starts the existing voice flow or stays hidden until a companion has a voice installed
  (default: hidden when the voice is not ready).
