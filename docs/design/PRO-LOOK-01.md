# PRO-LOOK-01: one professional look for every screen (2026-11-08)

Status: proposed, for Jesse's review. Design only; no frontend code changes in this note. Implementation is a list of slices
(section 11), each landed after he approves.

Why: Jesse, 2026-11-08, after putting Home next to YouTube, Apple News and Suno on his iPhone: Home looks trivial and
unprofessional. He wants a global redesign for desktop and mobile. His eight reference screenshots are not committed (they show
real creators and outlets); every measurement below was copied from them or from the research file named in section 2.

Mockups (HTML rendered by headless Chrome, not the image model; section 8): `docs/design/assets/pro-look-2026-11-08/` (the reference set, committed; the generator is `build.py`).

## 1. What makes the references feel professional

Measured from Jesse's eight screenshots (a 402 pt phone, dark mode), then compared with the other apps in section 2.

1. **One big idea per screen, image first.** Suno's Library, Search and profile open with large gradient tiles (about 160 pt
   squares at a 12 pt gap, 16 to 20 pt radius, the label inside the tile in 24 pt regular), the Zeckniel profile opens with the
   hero art running under the status bar, and YouTube's feed opens with a full-bleed player. A picture or gradient is the
   largest thing above the fold; text sits on or under it.
2. **Type is few sizes with big jumps.** A screen title 34 to 40 pt bold (Suno "Library", the profile name), section headers 24 pt
   regular-to-medium (Suno "Best Of", "For You", "Recent Songs"), row titles 20 pt medium, metadata 17 pt in a muted gray, tiny
   uppercase badges (the "V6-MINI" tag) in a monospace face at 14 pt. Apple News adds a 24 pt semibold headline over a 20 pt
   muted dek. There is no 13 pt body text anywhere on a phone; our kit's body is 13.5 px.
3. **A strict edge margin and a steady rhythm.** Every screen has the same 16 pt gutter (Suno profile: 16 pt, tile rows bleed to
   the screen edge so the next tile peeks in). Sections are separated by about 32 pt, rows inside a list by about 16 pt, a title
   to its first item by 12 pt. Nothing sits at an odd offset.
4. **Corner radii come in three sizes and are used everywhere.** Controls are full pills (Follow, Edit Profile, the chips, the
   search field), cards and tiles are 16 to 20 pt, thumbnails are 8 to 12 pt, avatars and play buttons are circles. Our app mixes
   4, 6, 10, 12 and 16 px with borders.
5. **Surfaces are layered, not outlined.** Dark pages are not black: the page is a near-black (about 6 percent lightness), a card
   is one step lighter (about 11 percent: the "Comments" box, the "Complete your profile" step card, the "Creators to Follow"
   cards), a pressed or selected item is one more step (about 17 percent). There are no borders on cards. Depth comes from the
   step, and from translucent blur where something floats.
6. **Round icon buttons float over hero art.** Back, share and More are 44 pt translucent circles (a dark scrim at 40 to 50
   percent with blur) placed over the picture, not in a toolbar. Apple News does the same on a light page with a white-glass
   back circle and one pill holding Like, Dislike, Share and More. The hero art needs no header bar.
7. **The bottom bar floats and is made of glass.** A rounded-pill container with frosted blur, inset from the screen edges (Suno
   about 16 pt each side, YouTube about 40 pt), and the active item is a second, lighter pill drawn behind its icon (Suno, YouTube)
   or a tinted icon and label (Apple News). Icons are 28 pt line icons; Apple News adds 12 pt labels. Content scrolls behind it.
8. **The section header plus "See All" row** is the repeating unit: a 24 pt title on the left, a muted "See All" or "More >" on
   the right, then a horizontal shelf (tiles peek at the right edge) or a vertical list of 3 to 5 rows.
9. **List rows are one pattern.** A 64 pt square thumbnail with a 10 pt radius and a duration badge drawn inside its bottom-left
   corner, a title line (20 pt), a muted line (play count, artist), and a trailing three-dot button. Row height about 76 pt with a
   12 pt gap. No dividers.
10. **Buttons: one primary, many quiet.** The primary action is a full-width cream or white pill (Follow, Join) with dark text,
   everything else is a translucent dark pill or a circle. Never two filled primaries on a screen.
11. **Density is deliberate.** Large touch targets (44 pt minimum) and big type mean fewer things per screen, but every item is
   image-led, so the screen still feels full. Cards hold a picture, a title and one muted line, nothing else (YouTube row:
   avatar, 2-line title, one meta line).
12. **Motion hints.** Active tab pill slides, the mini player expands from the bar, the hero art parallaxes and fades into the
   page color, the small page indicator dots on a carousel (Suno profile cards, YouTube Comments card), the red progress thumb on
   the video. They tell the person the thing is live and swipeable.

## 2. What the other apps agree on

Source file: the research note in this session's shared notes folder (`pro-look-research.md`); Apple HIG pages did not load, so
the iOS type sizes are from memory and the numbers marked "estimate" are third-party. Treat every number as a hypothesis to
measure in a prototype (section 11, slice 1 does that).

- **Desktop sidebar:** Linear 240 px, Spotify a collapsed, regular and expanded library column, Arc about 240 px, Notion about
  240 px and resizable. Grouped sections with small muted group titles, one selected row in a tinted pill. This is the
  consensus width: 220 to 280 px.
- **Home:** an optional hero then horizontal shelves (Spotify, Apple Music, Netflix, Apple TV, Plex), each with a header and a
  "Show all". Cards peek at the right edge to show they scroll.
- **Detail page:** a hero gradient built from the artwork's own color, one dominant Play button, then 48 to 64 px rows
  (Spotify, Apple Music, Plex). Netflix and Apple TV put a short description and a row of quiet buttons under the hero.
- **Settings:** a left list of groups with icons and a right column of grouped cards, one card per group, a short muted
  description under each title (Linear, Notion, ChatGPT).
- **Chat:** ChatGPT's centered column (about 720 px) with a floating pill composer (28 px radius) and a quiet history sidebar.
- **Rules they share:** a 4 px grid, 16 px phone and 24 px desktop margins, body 14 to 17, titles 28 to 40, one font family,
  radii 4 to 6 / 8 to 12 / 16 to 28 / full, dark elevation by lighter surfaces not shadows, three or four neutral layers with text
  at 100, 70 and 50 percent, one accent color per app, bottom tabs with a docked player on a phone.

## 3. Audit of what we have (seeded dev hub, 2026-11-08; Home, Chat, Media, Library, Settings at 1440 and 402 wide)

Concrete reasons Home looks amateur:

1. **The page is a white form, not a product.** In the default look the page is near-white with white cards on it; Home is a
   stack of bordered boxes (weather, News, Shopping list, Coming up) of unequal heights with empty text inside ("No news lists
   are turned on for you", "Your shopping list is empty") centered in a big card. Pro apps never show an empty card on the front
   page; they drop the shelf.
2. **Type is flat.** One weight and one size dominate (13.5 px body, 18 px section); a 30 px title is used once. Nothing is large.
   There is no 24 pt section header, no 34 pt screen title, no muted metadata tier.
3. **Controls are outlined rectangles, not pills.** The "Ask" box, the suggestion chips, "Updates" and "Repairs" are 1 px
   bordered shapes with different radii and heights (chips 36 px, buttons 32 px, field 40 px). Pro apps use filled pills of one
   height.
4. **Pictures are second class.** The Media home draws the shelves inside a white card with a black accent bar beside each
   title, the thumbnails are flat color blocks with a stray circle, and the card sits in a card. The tiles are 16:9 slabs with
   a title below; there is no square tile, no gradient tile, no badge.
5. **Cards inside cards, borders everywhere.** Library, Media and Settings put a bordered card on a bordered page; the dark
   look draws the same boxes as outlines on near-black. No layering, so no depth.
6. **Chrome crowds the content.** Desktop: a 56 px rail plus a 140 px app column plus a header bar before the first picture.
   Phone: a shell bar (menu circle, icon, title, gear, companion ring), then page controls (Library: Upload button, tab strip,
   search box, Mine, sort, grid toggle, Select, on four rows) before any item.
7. **Empty states are plain text and an outline icon.** The Library and Chat welcome screens have a paragraph and nothing to
   do; Chat's greeting is drawn at about 10 percent contrast on white (unreadable in the screenshot).
8. **The rail is a row of 16 px outline icons with no labels** and a tiny gray gear and grid icon pair at the bottom; the active
   state is a pale square. The phone has no tab bar at all, only a drawer behind a menu circle.
9. **Dark mode is a bolt-on.** With the dark class forced on, cards become black-on-black with no step between page and card,
   and the suggestion chips stay white. A dark palette needs three surface layers, not one.
10. **No hero, no color.** No screen has a gradient, a large picture, an accent or a call to action; every screen is gray.
11. **Spacing is irregular.** The three chips stack in a column on the phone with 12 px gaps while the title sits 8 px from its
   text; cards in the Home grid are 160, 160 and 120 px tall.

Not captured (empty in the seeded demo household): News, Synths and the Companions pages. They get the same treatment by
section 9.

## 4. The design in one paragraph

Designed and judged in dark first, image-led and layered. "Dark-first" means the author checks dark before light; the default
theme and the person's own light or dark choice are unchanged (phone-minimal P9), and every surface follows it. Three surface steps instead of borders, a five-step type scale with big jumps, one 16 pt
phone gutter and 24 pt desktop gutter on a 4 pt grid, three radii (pill, card, thumb), a floating glass sections bar on a phone,
a hero header with round floating buttons on every detail page, and one row, one tile and one shelf pattern reused by every app.
It changes values and kit variants, not the product's structure: the rail, the drawer, the ambient companion and the settings
shell stay as `RULES.md` has them (section 10 lists the one place a rule would need Jesse's decision).

## 5. Tokens

All of these are tokens in the kit's `tokens.css` (rule 9b: tokens first, then an additive kit variant, never Home CSS on a
kit part). **Every color is a theme token; this note names roles, never a hex** (owner rule 2026-10-19). Any value written as a
percentage below is a guide for the token's dark derivation, and the light theme derives from the same hues.

### 5.1 Type (one family, the kit's `--font-sans`, tabular figures for time and counts)

| Role | Phone | Desktop | Weight | Token |
|---|---|---|---|---|
| Screen title | 34 | 40 | 700 | `--font-size-title` (today 30) |
| Section header | 22 | 24 | 600 | `--font-size-section` (today 18) |
| Row and card title | 17 | 16 | 600 | new `--font-size-row` |
| Body | 17 | 15 | 400 | `--font-size-body` (today 13.5, weight 500) |
| Metadata | 14 | 13 | 400, muted color | `--font-size-supporting` (today 12) |
| Badge (duration, model tag) | 12 | 12 | 500, mono, uppercase | new `--font-size-badge` |
| Hero name (profile, album, film) | 40 | 56 | 700 | new `--font-size-hero` |

Line height 1.25 for titles, 1.4 for body. Text color tiers: primary, secondary (70 percent), tertiary (50 percent): the kit's
existing `foreground`, `muted-foreground` and a new `subtle-foreground`. Minimum 44 pt hit area stays (P8 of the phone note).
Phone body 17 pt is what Apple News and Suno use; the person's `ease.text_size` setting scales every row.

**Children, teens and the ease settings (rule 0, P4a, KID-MODE-02).** Nothing here loosens a child's protections or layout.
P4a holds: one column for a child, 52 and 76 pt targets, 22 pt reader text; the 44 pt minimum is an adult floor. The new
scale goes through the existing ease generator: `tokens.css` computes `--font-size-body` per `data-ease-text` step (13.5, 16.2,
18.9, 21.6 today) and the new sizes become steps of that same generator, so the person's text size scales every row. The
`data-mode` child values of KID-MODE-02 (body 18, 7:1 contrast) are not overwritten; the new scale is the adult default only.

### 5.2 Space (4 pt grid)

Steps: 4, 8, 12, 16, 24, 32, 48. Phone gutter 16, desktop gutter 24 (28 at 1280 and up). Between sections 32, between a section
title and its first item 12, between rows 12, between cards 12 on a phone and 16 on desktop, inside a card 16. Shelves bleed to
the screen edge on the right so the next tile shows; the first tile starts at the gutter. Tokens: `--space-1..7` plus
`--gutter` (phone and desktop values).

### 5.3 Radii

Three plus the circle: `--radius-thumb` 10 (thumbnails, chips inside cards), `--radius-card` 20 on a phone and 16 on desktop
(cards, tiles, sheets), `--radius-pill` full (every button, chip, field, tab bar, composer), circle (avatar, play, round icon
buttons). The kit's `--radius-card` is 16 and `--radius-control` is 10 today; `--radius-control` is retired in favor of the
pill for buttons and the thumb radius for small boxes. Kit changes are additive with the default unchanged (rule 9b):
`--radius-control` stays as an alias of the thumb radius and nothing is retired by this note.

### 5.4 Elevation and surfaces (dark first)

Four layers, each a token and each derived one step from the page in both themes:

| Layer | Use | Dark guide |
|---|---|---|
| `surface-0` | page | about 6 percent lightness (navy-tinted, from the kit's navy reference) |
| `surface-1` | cards, rows on hover, search field, composer | about 11 percent |
| `surface-2` | selected row, active tab pill, pressed, chips | about 17 percent |
| `surface-glass` | floating bar, round buttons over art, mini player, sticky headers | surface-1 at 70 percent plus 24 px blur |

No borders on cards; a divider is used only between a settings card's rows. Shadow only under floating glass (one soft shadow
token). A scrim token darkens hero art behind text (a bottom gradient to `surface-0`).

### 5.5 Color roles

Existing: `background`, `foreground`, `muted`, `primary` and the seven luminous accents (the kit's navy palette). New roles, all
derived: `accent-hero` (a per-item color pulled from the artwork or from the app's own accent, used for a hero gradient behind
a detail page, at most 40 percent strength fading to `surface-0` by the first screen height), the kit's existing `--art-foreground` and `--art-scrim` (light text over art, section 24 item 2; no
new name), `primary-action` (the cream pill: the inverse of the page, which the kit's `Button variant="inverse"` already is), and one
accent per app (Music, Video, News, Chat, Photos) drawn from the seven existing accents. Contrast: text on `surface-1` meets
WCAG AA; the check is the one the kit already runs for tokens. Gradient tiles use two adjacent accents plus a mesh blend; they
are generated from tokens at render time, so a theme change recolors them.

## 6. Navigation model

### 6.1 Desktop (640 and up)

Stays as `RULES.md` S1 and S2: the 56 px permanent icon rail (brand, search, apps, More, profile) and each app's own layout to
its right. What changes inside that:

- The rail's icons grow from 16 to 22 px line icons with a filled, tinted pill behind the active app (surface-2), and the rail is
  `surface-0` with no right border. Both are the kit's sidebar tokens and a kit variant, never Home CSS.
- **Each app keeps its own native layout (S2).** The shared look reaches every app by tokens, not by one imposed layout. Chat
  keeps ChatGPT's history sidebar (an assistant-ui Element, tokens only, rule 9), Videos follows YouTube, Settings is the kit
  `SettingsShell`, Library and Media keep their own columns. Only where the native app has it does the app column take the
  Spotify and Linear look (Music, Media home): `surface-0`, 240 px, 12 pt tertiary group titles, 40 px rows with a 20 px icon, the
  selected row a surface-2 pill, no border to the content. The content then sits on a `surface-1` rounded panel inset from the
  window edge, drawn by the kit's existing `Sidebar variant="inset"` and `SidebarInset` (`src/ui/sidebar.tsx`), not by Home.
- The header row (S2) is kept: page title left, that app's buttons, the companion avatar last. A kit variant makes it transparent
  over the page and glass once the page scrolls under it; Home draws none of it (rule 9b).
- The right pane (S2) is unchanged, restyled by tokens.

### 6.2 Phone (under 640)

Stays as S1: no rail, the round menu button opens the drawer with the app switcher, profile and settings. The new part is each
app's own sections as a **floating glass pill bar**, which the phone-minimal note (P2) already decided for News, Videos,
Podcasts, Books and Shows: the kit's `PhoneNav`, with additive props for the floating look, the filled active pill and a trailing
search item. This note extends that rule to **every app that has sections** (Media: Home, Videos, Music, Library; Library:
All, Pictures, Videos, Songs; Home itself has none and shows none). The bar is 64 pt tall, inset 16 pt from the side edges and
12 pt above the home indicator; the active item is a surface-2 pill 52 pt wide behind a 26 pt icon; labels only on the app's
primary sections (Apple News style) and only when five or fewer. The mini player docks directly above the bar (Spotify, Suno).
The drawer's round menu button keeps its place; it becomes glass and 44 pt.

This means the app switcher is still in the drawer, not in the bar. If Jesse wants the main apps in the floating bar (as the
YouTube and Suno screenshots show), that is a change to S1 and is reported in section 10, not made.

### 6.3 The companion is in every screen's upper right corner

S2 already fixes this and the redesign leaves it exactly where it is: the person's companion as a small avatar, last in the
shell's one header row, at one fixed size and spot on **every** page (the front page and Chat included), on desktop and phone. The
design makes it part of the look instead of an add-on:

- **Spot and size:** top right, 36 pt on a phone, 36 pt on desktop (the 32 to 36 pt S2 range), 16 pt from the right edge, centered
  on the header row's 44 pt line. The row is reserved: no title, chip or button is ever under it. Hero art may show behind the transparent row,
  with the avatar on a thin ring (the mockups show this), under the reading of S2 that section 10 asks Jesse to confirm; if he
  reads it literally, the hero starts below the row. The app's own buttons are to its left (Share, More, Search).
- **Same place on every layout:** the header row on a detail page, a studio, Library, Settings, sign-in-adjacent screens; only the
  S2 overlays (photo viewer, voice call, setup, immersive) differ, and they carry their own Close.
- **Look:** the companion's own character with no background of its own (the companion-media-transparent ruling), in a circle
  crop only because a header needs a stable shape. States are the S2 ones and nothing else: a dim still ring while listening, a
  gentle ring while thinking, a ring while speaking; never a count, dot or badge. The ring color is the `accent-companion` role
  (derived from the person's chosen accent, so it follows the theme) and meets 3:1 against the page and against hero art.
- **Behavior stays as S2 and `ambient-companion-2026-10-27.md` have it:** hover or keyboard focus (desktop) opens the compact
  preview with the quick ask, drawn as a glass popover (`surface-glass`, radius 20, 320 pt wide, a 44 pt pill field, one Review
  button only while the viewer's own task needs them); a click opens the standard right pane, whose first tab is always the
  companion (the stage). On a touch screen there is no hover: a tap opens the pane directly, and the pane keeps the layout the
  shell gives it today. Only the surface look changes (glass, radii, tokens); a bottom-sheet pane on a phone would be a
  separate change to the pane and is not proposed here.
- **The ask pill and the avatar are one family:** Home's ask box and the studios' docked prompt bar are the kit `PromptBar` (9a);
  Chat's composer stays the kit Element (rule 9) and shares the pill look through tokens only, so a person who types anywhere sees
  a familiar control.
- **Stacking order on a phone, from the screen edge up:** sections bar, mini player, then any Listen dock (phone-minimal P2);
  the avatar is in the top row, never in this stack, so nothing competes with it.
- **Turn off:** the person can turn the ambient companion off in settings (S2); the header row then keeps its height so no page
  jumps, and the wake-word listening indicator still draws alone with its Turn off button where S2 says.
- **Children and teens:** the avatar, its preview and pane follow the same age and surface rules as today; this note changes none.
- **How it is built:** the avatar, preview and pane are the existing shell component and its kit parts; this note adds only a
  token (`accent-companion`) and the glass popover surface, as kit variants (rule 9b). Home draws none of it.

## 7. Patterns (each is one kit part reused by every app)

**Shelf** (section header and a row): header = section title (22 pt) left, "See All" (14 pt, secondary) with a chevron right;
below, tiles in a horizontal strip (steady strip rules P7: no fade, no scrollbar), tile 156 pt square on a phone (about 2.3 per
row so the third peeks), 176 on desktop; 12 pt gap. Tiles: picture 1:1 with 20 pt radius, optional label inside (gradient
tiles) or title and one muted line below.

**Row** (media, files, results): 64 pt square thumbnail (radius thumb), duration badge in its bottom-left, title, muted line (plays,
artist, date), a trailing three-dot icon button 44 pt; 76 pt tall, 12 pt gap, no divider; hover or press is surface-1. A
now-playing row shows an animated equalizer glyph over the thumbnail.

**Card** (a summary on Home, a story, a household item): surface-1, radius 20, padding 16, no border, picture on top where there is
one; title row 17 pt, one muted line, one optional quiet pill. Empty cards are not drawn: a shelf with nothing in it is removed
(the front page shows an invitation only when the whole page is empty).

**Hero header** (detail pages: album, playlist, film, person, companion, article): the art or the `accent-hero` gradient runs
from the top edge, **under the shell's one header row** (S2). That row stays the only header: back and the page title on the
left, the app's own buttons (Share, More) then the companion avatar last, at its fixed size and spot. Over a hero the row is
transparent with its buttons as round glass 44 pt targets, and it turns to glass when the page scrolls. It is the same row, never
a second bar, and nothing sits under the avatar. Below the art: a 40 pt name at the bottom-left on the scrim, a muted line
(counts, owner, date), then the actions: **one cream pill primary** (Play, Follow, Open) the width of the content minus a 44 pt
round secondary (Shuffle, More). Stats row: three numbers, label muted. Only the overlays that `ambient-companion-2026-10-27.md`
already names (photo viewer, voice call, setup, immersive screens) are full-bleed with no header row. The phone mockups draw
Back and Share over the art for readability; they show where the row's buttons sit, not a second header.

**Buttons:** pill, 44 pt tall on a phone and 36 on desktop; primary (the inverse cream pill), secondary (surface-2 pill), quiet
(text), round icon (44 circle, glass over art, surface-2 elsewhere). Never two primaries on a screen.

**Chips and tabs:** a steady strip of 40 pt pills (surface-1; selected = inverse), same radius as buttons.

**Fields:** pill search field (surface-1, magnifier, 48 pt) with the same height as buttons; the chat composer is the kit's own
Element and stays as it ships, and its pill form is the kit's variant (rule 9).

**Settings:** the kit's `SettingsShell` as it is (S4): left group list on surface-0, content column 720 px wide max, one
`surface-1` card per group with a 24 pt title, 14 pt secondary description, rows 56 pt with the control right-aligned, dividers
only between rows. Group titles are plain words. This is a restyle by tokens of the shell as it ships; it does not change
`SETTINGS-LOOK-01` (the ChatGPT settings anatomy, owner 2026-10-07), which stays the authority for the settings layout. A failed
save keeps the S6 "form or action failed" row.

**Chat:** stays the kit's Elements (rule 9). The look comes from tokens: 720 px column, `surface-0` page, user message in a
`surface-2` bubble with the 20 pt radius, assistant text with no bubble, a pill composer in `surface-1` with its model chip and a
round send, the welcome greeting at 34 pt in the primary text color (today it is drawn nearly invisible) with four suggestion
chips under it as surface-1 pills. The history sidebar stays ChatGPT's own, restyled by tokens only.

**Empty states:** a 96 pt gradient glyph tile (the app's accent), a 22 pt title, a 14 pt muted line and one pill action, centered
at the optical center; never a bare paragraph. Copy follows STYLE.md (what is wrong, then what to do).

**Loading:** the kit's `Skeleton` at the exact size of the final tile or row, with the slow shimmer (`tw-shimmer`); never a
spinner on a page. One job's progress stays on that job's own card, and background setup stays on `InstallStrip` (S6); this note
adds neither. Images fade in over the skeleton in 150 ms. **Removing an empty shelf never hides a not-ready or failed state:**
that state keeps its S6 surface, and the Home ask pill keeps `InstallStrip`.

**Motion (all reduced when the person asks for less motion):** active pill slide 200 ms, hero parallax at 0.5 speed and fade to
the page color, mini player expands from its bar in 300 ms, sheet rise 250 ms, hover lift on desktop tiles 2 px with the
scrim lightening.

## 8. Mockups

HTML pages rendered to PNG by headless Chrome from `data-scratch/design/pro-look/` (labelled as such: the household image engine
could not be used, see section 12). The second version (v2, after Jesse said the first looked fast and unfinished) uses the kit's own
icon set (lucide), generated cover art with grain, glass edges, shadows, a status bar and home indicator, and the labelled narrow rail;
the first version is kept in `v1/`. They use theme-token-shaped CSS variables, persona names only (Sage,
Marlow, Nova, Clover Tempo, Indigo Rivet), no real people or outlets: `phone-home`, `phone-detail`, `phone-library`,
`desktop-home`, `desktop-detail`, `desktop-chat`, `before-after` (v2 draws the labelled narrow rail, which is the section 14 item 1 change, not what section 6.1 builds today; `phone-apps` is section 16). Every mockup draws the companion avatar in the upper right
(a gradient disc stands in for the companion's character).

Large page titles under the header row in the phone mockups ("Library", "Today", "Videos") show section 14's rule-change option (e);
under today's S2 the title sits in the header row itself, larger through tokens, and no second title block is drawn. Phone-minimal P1
("the page title is in the scroll flow") is stale where S2 (2026-10-27) says otherwise; S2 wins.

Note on the phone mockups: their floating bar lists the main apps (Home, Chat, Media, Library), the YouTube and Suno look from
Jesse's screenshots, so he can judge it. That is the S1 change of section 10 (a), not what section 6.2 keeps. Under 6.2 the bar
would hold only the open app's sections (for Media: Home, Videos, Music, Library) and the apps stay in the drawer.

## 9. Per-app application list

| App | What changes |
|---|---|
| Home (front page) | Large greeting title; ask pill with suggestion chips as one strip; shelves in place of cards (Today weather card as a hero tile, News, Lists, Coming up); an empty shelf is removed; "New in your library" becomes a square-tile shelf with See All. |
| Chat | Tokens only (rule 9); 34 pt welcome, pill chips, surface layers, history column pattern; phone: header per CHAT-PHONE-01. |
| Media (Home, Videos, Shows and Films, Music, Podcasts, Books) | Native look per app inside the shared patterns: square gradient tiles and rows for Music (Suno, Apple Music), 16:9 thumbnails with a 12 pt radius, avatar and two-line title for Videos (YouTube), poster grid for Shows and Films (Apple TV, Plex). The card around each shelf is removed; the black accent bar beside titles is removed. Phone: floating sections bar. |
| Music, Studio, Stems, Remix | The shipped Create page keeps its flow; gets the hero, tiles, rows, docked prompt bar and mini player. |
| Library | Filter strip becomes one chip row; search becomes the header pill; items as square tiles or rows; storage meter becomes a footer card; empty state per section 7. |
| News | Already specified by the phone-minimal note (P1 to P9); this note supplies the tokens it names. |
| Weather, Clock, Reminders | Hero card per accent, large numerals at hero size, rows per section 7. |
| Family and Companions | Person hero header (avatar 96, name 40, the stats row), companion stage per S2 untouched, restyled by tokens. |
| Settings, Account, Home settings | The kit's `SettingsShell` as is; cards, sizes and group list restyled by tokens only. |
| Files, Photos and detail pages | Hero header pattern; full-bleed viewer with the two glass round buttons. |
| Sign-in and setup | The person's theme, 96 pt person tiles, the brand mark at hero size, one pill primary. |

### 9a. The creation studios (Video, Music, Images): one system, not a second look

Jesse, 2026-11-08: Video, Music and maybe Image generation have a Higgsfield look that feels different from the rest of the app.
That is true: the studios follow Higgsfield-style creation screens (`video-create-ui-2026-11-02.md`, `video-create-one-page-2026-11-02.md`,
`music-studio-2026-10-31.md`) and the Music Create page landed as a dark workspace with a lime accent and a docked prompt bar,
while Home, Library and Settings are pale, boxed and flat. Two looks in one product reads as two products.

Recommendation: **one look, with the studio as a mode of it, not a different design.** What a studio keeps, because it is a
workspace and not a feed: the docked prompt bar and its own flow. It follows the person's theme (P9), so a studio is dark only
when the person's theme is dark. What it shares with the rest of the app, so it stops feeling foreign:

- the same type scale, spacing, three radii and four surface layers (section 5), so a studio card, tile and row are the app's;
- the same pill buttons (one cream primary: Create, Generate), the same chips for model and length choices, the same round glass
  icon buttons, the same header row (S2);
- one `accent-create` role, today's `--hue-yellow` that the Music page already forces into `--primary`, used only for the
  active state of a generation and the focus ring inside a studio (the Create and Generate buttons stay the one cream primary, so
  no screen has two). It is a token, so the theme recolors it, and the page's forced `dark` class (a phone-minimal P9 defect)
  goes away with it; no other screen uses it;
- the docked prompt bar is the kit's existing `PromptBar` Element (`@maipai/ui/src/elements/prompt-bar.tsx`, schema node
  `prompt_bar`, VIDEO-CREATE-02), named as the one shared part and not copied: Music's docked bar and Home's ask box move onto it
  with added props only where needed, and Video keeps VIDEO-UI-01's `placement: "panel"`. Music's page today draws its bar, tiles
  and links itself (`MusicWorkspacePage.tsx`: `bg-card/95 rounded-t-3xl border-t backdrop-blur` and others), which rule 9b forbids;
  slice 4a replaces them with kit parts. The chat composer stays the kit Element (rule 9);
- results are the same tile and row patterns (square or 16:9 tile, duration badge, three-dot menu), and the Library shows
  them identically.

The studios keep their own flow and layout (S2: each emulates its native app, here the Higgsfield-style creation page). This
note changes values, patterns and the accent, not the flow. Open question for Jesse (taste, section 12): keep the lime studio
accent as a recognizable "create" signature (recommended, small), or drop it and use the app's one primary everywhere.

## 10. Rules check

- **Rule 0 and every age gate:** untouched. This changes values and layout only.
- **Rule 9 and 9b (kit as it ships, tokens first):** every item is a token, an additive kit variant or a slot, never a className
  or Home CSS on a kit part. Where a look is not reachable (floating `PhoneNav`, hero header, tile and row variants, pill
  buttons) it is a `commons` slice first, tagged and pinned (PINNING.md). Cards are a kit variant, not a Home wrapper.
- **S1 (rail, drawer):** unchanged. The 56 px rail and the drawer stay; section 6.2 adds the floating sections bar under the
  phone-minimal note's own P2 decision.
- **S2 (each app emulates its native app):** respected and strengthened: the shared patterns are the native apps' own patterns.
  The companion avatar, header row and right pane stay.
- **S4 and S5:** `SettingsShell` and `describeSetting` stay; copy is not touched.
- **S6:** this adds no status surface; skeletons and empty states are not status.
- **Theme (owner 2026-10-19):** no fixed colors; section 5 names roles only; a theme change recolors gradients.
- **Reuse check:** existing mechanisms searched first; each slice makes additive variants on these, and says why when one does
  not fit: `PhoneNav` and `tabs-bottom` (floating bar), `MediaShelf`, `MediaTileOverlay`, `Billboard`, `CardGrid` (shelf, tile,
  hero strip), `EmptyState` and `elements/empty-state`, `Skeleton`, `Carousel`, `elements/character-hero`, `CreationHeader` and
  `PlayerDetails` with the full-bleed phone scrim (MEDIA-DETAIL-01) and the `--art-*` tokens (hero header), `StoryFeed` two-up,
  `ArticleView` floating controls (P6), `Sidebar variant="inset"`, `Button variant="inverse"` (the cream pill), `SettingsShell`,
  `tw-shimmer`. Notes honored: media-detail-pages-2026-10-25, home-layouts-2026-10-25 (its four layouts keep working on these
  tokens). Nothing new is invented for status.
- **Header row (S2):** hero pages keep the shell's one header row, transparent over the art and glass on scroll; only the overlays
  `ambient-companion-2026-10-27.md` names are header-less. Optional rule change (d), Jesse's call only: header-less hero pages,
  which would be an S2 change; this note does not assume it. One reading needs his ruling: S2 says the row is reserved so
  "nothing sits under the avatar". This note reads that as no content or control in the row, so hero art may show behind the
  transparent row. If he reads it literally, the hero starts below the row instead.
- **Needs Jesse (only he changes a rule), none made:** (a) if he wants the main apps in the floating bottom bar on a phone
  (the YouTube and Suno look), S1's "no bar, one drawer" must change; this note keeps the drawer. (b) If he wants the desktop rail
  to show labels or expand (Spotify, Linear), S1's "never expands" must change; this note keeps it icon-only at 56 px. (c) The
  `.github/docs/UI.md` line about `PhoneNav` is already narrowed to the app switcher by the owner (2026-10-25).

## 11. Phased rollout (one slice per screen group, ordered by impact)

Every slice: commons first where the kit lacks a part (own worktree, own tag, then the Home pin), gallery capture at 390 and
1440 in light and dark opened and judged, and the dev hub opened by the author before landing (`bun run dev`). The slices
fold into the open backlog rows instead of running beside them: PHONE-01 (card surface, built in ui-v0.5.336), PHONE-03 (steady
strip), PHONE-05 (sections bar for every package app, built), PHONE-06 and CHAT-PHONE-01 (Chat and Home phone bar), KID-MODE-02
(type scale per mode), MEDIA-DETAIL-01 and 05 (detail pages), MOBILE-SWEEP-01 (the per-app phone sweep), NEWS-LOOK-02 (the News
reading tokens this note supplies), VIDEO-UI-01, VIDEO-CREATE-02, MUSIC-STUDIO-01 (studios) and SETTINGS-LOOK-01 (settings anatomy). A slice names the row it
extends in its backlog item.

1. **PRO-LOOK-TOKENS-01 (commons):** type scale, space, radii, the four surface layers, glass, accent-hero, light and dark; a
   token gallery page. Prototype at 402 and 1440 to confirm the numbers of section 5. Biggest effect for the least risk: every
   screen changes at once with no layout move.
2. **PRO-LOOK-KIT-01 (commons):** pill button and chip, round glass icon button, tile, row, shelf header, card surface variant,
   hero header, floating `PhoneNav`, skeleton.
3. **PRO-LOOK-HOME-01:** front page (greeting, shelves, empty shelf removal) and the shell: rail look, header, drawer button.
2a. **PRO-LOOK-LINT-01:** the three gates of section 19 item 4, with shrink-only baselines, landing right after the tokens so
   no screen can drift back. **PRO-LOOK-JOB-01:** the shared job state treatment of section 20 as additive props on the existing media Elements, folded into CHAT-CARDS-11.
   **PRO-LOOK-APPS-01:** the launcher of section 16.
4a. **PRO-LOOK-STUDIOS-01:** Video, Music and Images creation pages onto the shared tokens and patterns of section 9a
   (`PromptBar`, `accent-create`, tiles and rows), flows unchanged. It extends VIDEO-UI-01 (revision 7, approved, being built),
   VIDEO-CREATE-02 and MUSIC-STUDIO-01, and is built after or inside them, never beside them. It changes nothing VIDEO-UI-01
   decided (the chosen card's accent border, the Generate button) unless Jesse answers the accent question below.
4. **PRO-LOOK-MEDIA-01:** Media home, Music, Videos, Shows and Films, Podcasts, Books, and their detail pages with the hero.
5. **PRO-LOOK-LIBRARY-01:** Library and Photos.
6. **PRO-LOOK-CHAT-01:** chat tokens, welcome, history column, phone bar (rule 9 slice, tokens and kit variants only).
7. **PRO-LOOK-NEWS-01:** News per the phone-minimal note on the new tokens.
8. **PRO-LOOK-SETTINGS-01:** settings, account, family, companions pages.
9. **PRO-LOOK-REST-01:** weather, clock, reminders, sign-in, setup.

## 12. What was not done

- The household image engine did not make the mockups: the ERNIE weights are not on this machine any more (the bakeoff folder's
  `hub/` was deleted; the Hugging Face cache holds a partial 184 MB), and a multi-gigabyte re-download needs Jesse's yes. The
  mockups are HTML in headless Chrome, so they show the layout and type exactly and the pictures are flat gradients, not art.
- Apple's own HIG type table could not be fetched; sizes in section 5.1 are the common iOS values from memory and Jesse's
  measured screenshots.
- News, Synths and Companions screens were empty in the seeded demo household and were not captured.

## 13. Supersedes

Nothing in `RULES.md`. It supplies the token values that `phone-minimal-2026-10-25.md` (P3 card, P6 reader pill) and
`news-app-2026-10-17.md` name, and replaces the kit's 13.5 px body, 18 px section header and bordered cards as the adult
defaults once slice 1 lands (the 10 px control radius stays as an alias). It also changes, by name, if Jesse approves:
phone-minimal P3 (card gap 8 pt to 12 pt) and the P6 picture radius (12 pt to the 10 pt thumb radius where it applies);
`clock-and-reminders-redesign-2026-10-30.md` (hairline rows to no divider; CLOCK-02 is already built that way);
`home-layouts-2026-10-25.md` (summary cards to shelves, on the same four layouts); `companion-three-screens-2026-10-28.md`
(the person hero header is restyled, its mockup-exact screens stay); `library-2026-10-18.md` (the control layout on a phone);
SETTINGS-LOOK-01 is not superseded. Section 9a changes no decision of `video-create-ui-2026-11-02.md`, `video-create-one-page-2026-11-02.md`
or `music-studio-2026-10-31.md` except the Music page's own drawn bar, tiles and forced dark class, which it replaces by kit parts. Desktop layout structure, gates, children's rules and records are unchanged.
Sections 16 to 18 supersede nothing built (the photo editor follows its record exactly): the six-pin cap, the core app list and the News and Videos section sets stay as built
unless Jesse takes options (f) to (h) of section 16 or the section 14 changes.

## 14. The best structure, if Jesse changes the navigation rules (proposal only, no rule is changed here)

Jesse, 2026-11-08: he is open to whatever is the best design for fixed rails, rows, headers and menus. Everything above works inside
today's `RULES.md`. This section is what the evidence in sections 1 to 3 says the top design is, and what it would need. Each
item names the rule it touches; only Jesse changes a rule, and this section is not part of the approved scope until he does.

1. **Desktop, Jesse's choice (2026-11-08, wizard): a labelled narrow rail.** The permanent rail stays narrow, about 80 px, never expands, and each icon gets an 11 pt label under it (Search, Home, Chat, Media, Library, Family, and the person at the foot), with a surface-2 pill behind the active app. The open app keeps its own column beside it. This is the smallest S1 change: "no labels" goes and the 56 px figure becomes about 80 px at the standard target size (S1's "fixed 56 px icon rail" and "The rail is 56 px at the standard target size" both change; the ease clause that makes the width follow the kit target-minimum token stays), and the rail's permanence stays; S3's test then runs at 80 px. Mockup: `desktop-home.png`. The alternative below stays on record as the bigger option he did not pick.

   *Alternative, not chosen:* **one labelled sidebar that collapses to an icon rail, replacing the rail plus app column.** Linear, Notion, Arc, Spotify,
   ChatGPT and Plex all use one sidebar (240 to 260 px) with the product mark and search at the top, the apps as labelled rows, the
   open app's sections nested under it, recent items, and the person (name, role, settings) pinned at the foot. A fold button
   collapses it to the 56 px rail we have now, so nothing the owner already ruled is lost, it just is no longer stuck at 56 px.
   Today's two columns (56 px rail plus a 140 to 240 px app column) cost 200 to 300 px of width and make every app look boxed in.
   Touches S1 ("never expands, no labels"). Mockup: `desktop-home-unified.png`.
2. **Phone: a floating glass bar with the main apps (4 or 5 plus More), the drawer kept for everything else.** YouTube, Suno, Apple
   News and Spotify do this and Jesse's screenshots show it. The bar holds Home, Chat, Media, Library and More; More and the
   profile and settings live in the drawer the menu button opens today. An app's own sections move to a steady chip strip under its
   large title, so there is exactly one bar. The mini player docks above it. Touches S1 ("on a phone there is no rail, the drawer is
   the only app switcher") and supersedes phone-minimal P2 (sections bar becomes a chip strip). Mockups: the four phone pages.
3. **Headers: one row with the title always in it, larger through tokens, transparent over hero art, the companion avatar last.**
   This is S2 as written: the title stays in the row, never in a second title block in the page flow (MOBILE-SWEEP-01 lists two
   top bars as a defect). Needs only the S2 "reserved row" reading of section 10, or (d) if heroes should be header-less.
   **Rule-change option (e), Jesse's call, not built until he rules:** Apple News and Suno Library show a 34 pt title in the scroll
   flow that collapses into the row on scroll. That puts a title outside the row and is an S2 change.
4. **Rows: one row pattern everywhere (section 7), 64 pt thumbnail, two lines, trailing menu, no dividers, 76 pt tall.** No rule
   change.
5. **Menus (the "foot" below is the rail's existing profile control, S1, and the drawer foot):** the three-dot button opens a popover on desktop and a bottom sheet on a phone**, both `surface-glass` with 12 pt radius
   rows 48 pt tall on a phone, destructive items last in the destructive color, at most seven items. The app switcher "More" opens the
   same sheet. The profile menu is the rail foot on desktop and the drawer foot on a phone. No rule change; the companion avatar
   keeps its own preview (S2).
6. **Settings: unchanged shell**, reached from the person row at the rail foot (desktop) and the drawer (phone).

**Recommendation:** do sections 5 to 11 first (tokens, kit parts, patterns), which need no rule change and change every screen's
look at once. Then take items 1 and 2 as one navigation decision (PRO-LOOK-NAV-01, one slice per width), after the S1 text is changed (his labelled-rail choice is recorded; the rule edit itself is his).
Items 3 (without option (e)), 4, 5 and 6 come with the tokens and parts. The rule text to change, matching his choice: S1 gains "the rail carries a text label under each icon" and its width figures change from 56 px to about 80 px at the standard target size (the ease clause stays), and "on a phone the main apps may sit in a floating bar", and phone-minimal P2 is replaced by the chip strip.

## 15. What Jesse's second set of references adds (four desktop dashboards, 2026-11-08)

A smart-home dashboard (dark), a pastel glass dashboard, a dark teal card editor and a light analytics dashboard. What to take and what not:

- **Take, no rule change:** a Household row on Home (round avatars with name, then "Add" for an admin) from the smart-home reference, which is
  the most relevant for a family hub and shown in `desktop-home.png`; filled chips for filters; large numerals for a
  summary card; a small round arrow button in a card's corner as "open" (a kit icon button variant); an ambient soft glow tinted by the
  app's accent behind the page (a token, theme-driven, never a fixed color); a hero card such as a live camera tile or a weather tile
  as the first card.
- **Take, needs the S1 label change above:** the icon-over-label narrow rail (dark teal reference, smart-home reference).
- **Do not take:** the pastel glass page's top tab bar as the main navigation (it suits a business tool with five fixed modules, not
  an apps list that grows); the light analytics reference's flat boxed layout (it is close to today's look); the floating
  rounded outer frame on a colored backdrop, which is a presentation frame in the references, not an app layout.
- **Not adopted:** charts as decoration. A chart appears only where a screen has data worth a chart (usage, storage), as a kit chart
  with tokens.

## 16. Many apps, and favorites for quick access (Jesse, 2026-11-08)

The product has dozens of apps and will have more. The mechanism for favorites already exists and this note keeps it as the one list:
`ui.pinned_apps` (a person setting, a JSON list in pin order), `usePinnedApps`, the star in each app's header row, the All apps page
(`AllAppsPage`), the manifest flag `pinned_by_default` for a person who has never chosen, and the rail drawing the pinned apps
(`docs/app-library.md`, section LEFTNAV-APPS-01). No second favorites list, no second store (org principle 1). What changes is how
the launcher looks (mockup `phone-apps.png`):

1. **Three tiers, one list, the built set.** Core stays as built and as S1 names it (Home, Chat, Library, People/Family, never
   unpinnable); *favorites* are the person's pinned apps in pin order (Media is a default favorite in the mockups); everything else is
   reached through the existing All apps launcher.
2. **Desktop rail:** core, then the favorites (icon over label under section 14's labelled rail, or today's icon-only rail under the
   approved scope), then today's rail grid button (`app-rail-launcher`, "All apps"), then the More button and Incognito and the
   profile control exactly as S1 has them. Nothing in S1's rail list is dropped.
3. **Phone:** the drawer keeps S1's order: brand and Search, then the apps (favorites first, in the "apps" position), then the open
   app's sections, then the profile foot. The launcher screen is the All apps page redrawn: a pill search, one category chip strip
   (the manifests' own category; no new field if one exists), a **Favorites** shelf of rounded-square app icons (64 pt, 28 percent
   radius, the app's accent art, label under, a small filled star), an **Edit** action, then **All apps** as a four-column grid, A to
   Z. Under section 14 item 2 the launcher is the bar's Apps item; under today's S1 it opens from the drawer.
4. **Add and remove:** the star in the app's header row (built), the star on a launcher icon, long press on touch.
5. **The cap stays as built:** at most six pinned, held with a reason while six are pinned (`docs/app-library.md`). Raising it is a
   change Jesse may make (it would supersede that line); this note does not assume it.
6. **Reorder:** the kit has no sortable list, and a part from outside the shadcn registry needs its `UI-DECISIONS.md` row first. The
   Edit mode uses move up and move down buttons until that row exists.
7. **Recents:** only on the launcher, from the navigation history the shell already keeps; if none exists, omitted. A Recent list in
   the drawer is an S1 change and is not proposed.
8. **Access:** an app the person's role, age band, surface or Incognito does not allow appears in no tier and not in search results
   (`GET /api/apps` already filters); pinning never grants access (rule 0). An app that is starting, paused or unavailable shows through
   the S6 mechanisms on its own icon; the launcher adds no indicator.
9. **Rule-change options for Jesse, not proposed as built:** (f) a "Your apps" row of icon tiles on Home (S2 says an app never draws
   a second copy of app switching and `home-layouts-2026-10-25.md` records it as his decision); (g) Recents in the drawer (S1);
   (h) raising the six-pin cap.

Backlog: extends LEFTNAV-APPS-01 (`docs/app-library.md`) and the All apps page; slice `PRO-LOOK-APPS-01` after the nav slice, one
backlog row to be added by that slice.

## 17. News, the encyclopedia and Videos under this look

Mockups: `phone-news`, `phone-news-reader`, `phone-wiki`, `phone-videos`, `phone-video-watch`. They use invented outlets, persona names and
fixture art only (rule V1: nothing here calls a live video service). Each shows the app's **own sections bar** (section 6.2, inside
today's S1 and phone-minimal P2) with the sections the apps have today.

- **News** (the phone-minimal Apple News look on these tokens): date line, the page title, one chip strip, a 4:3 lead card with
  outlet and 22 pt headline, then two-up cards; sections Today, My Mix, Following, Saved, Search (My Mix keeps its rule 0 gating). The
  reader has the header row's Back, one glass pill of Listen, Save, Share and More (P6), the outlet mark centered, a 27 pt headline, a
  19 pt muted dek, a 14 pt byline, the picture inset 16 pt, then serif body at 19 pt and line height 1.55.
- **Encyclopedia (the offline Wikipedia copy, `kiwix-reader-2026-10-29.md`)**: a pill search over the offline library, an article page
  with a serif 40 pt title, the kind and "Offline copy", the lead picture, serif body at 18 pt, an "At a glance" card (the infobox as a
  surface card with hairline rows), then the section list as 56 pt disclosure rows; sections Home, Encyclopedia, Explore, Saved, Search
  as the reader's own saved and random entries allow. The mockup names it "Encyclopedia" for the mockup only; the shipped name is the
  app's own.
- **Videos** (YouTube's layout, S2, over the hub's own saved videos): the page title, one chip strip of categories, full-width 16:9
  cards at 18 pt radius with a duration badge, a 40 pt avatar, a two-line 16 pt title and one muted line, a three-dot menu; sections
  Home, Library, History, Watch later, Search (the built set). The watch page puts the player under the header row with the Back,
  a centered glass control cluster, a red progress thumb, the title, the source line and two quiet pills (Watch later, Share), then a
  description card. Shorts, a Follow button and comments are not built features and are not part of this note.
- **Children:** each app keeps its own child layout and gates (P4a one column; the News and Videos kid rules); this look changes values
  and patterns only.

## 18. The creation and editing screens (Video, Music, Photo)

Mockups: `desktop-video-create`, `desktop-music-create`, `desktop-photo-edit`, `phone-video-create`, `phone-music-create`. They apply
section 9a: one system, the studios' own flows (S2: each emulates its native app, here the Higgsfield-style creation page), no second
look.

- **Video Create (VIDEO-UI-01 rev 7):** a left control panel (the kit `PromptBar`, `placement: "panel"`: prompt, chips for Look,
  Camera and Length in one Style popover, a References group with Picture and Voice slots, the Model cards Standard and Detailed) and a
  results feed of the kit `VideoPlayer` entries (draft, making, done) beside it, with My clips and Watch in the app column. The
  only color accent is `accent-create` (today's `--hue-yellow`), on the chosen Model card's edge and the "Making now" progress ring; the
  Generate button is the one cream primary. On a phone the feed leads and the panel is the docked `PromptBar` above the sections bar.
- **Music Create (MUSIC-STUDIO-01):** the header row carries the app's modes (Create, Studio, Stems, Remix, Library) as the S2 tab strip;
  a large "Make a song" lead, the person's songs as rows with a live waveform (the played portion in `accent-create`), and the docked
  `PromptBar` at the bottom with Style, Voice, Lyrics and Length chips and one cream Create button. Phone: the same, docked above the bar.
- **Photo editor (`media-editors-2026-10-31.md`, layout as that record has it):** a vertical tool strip with the record's v1 tools
  (Describe a change, Erase, Remove background, Adjust, Crop; Upscale, Markup and Before and after follow in the strip or the
  header's More), the picture centered on a checkerboard stage drawn from theme tokens (no fixed color), the `PromptBar` at the
  bottom under the picture with a Painted area chip and a Strength chip, and the right side is the shell's one pane (S2): its first tab
  is the companion, then Versions (the version list) and Info. Undo and Save are the header row's buttons. Layers, Relight, camera
  angle and Expand canvas are deferred in the record and are not shown. The Mask and painted-area control is hidden for a child (no
  mask, no reference, `childOwnCartoonsOnly`); a child's editor is unchanged. Nothing in this section changes what the record decided.
- **Same rules everywhere here:** the companion avatar last in the header row, pill buttons, the four surface layers, the card radius of
  section 5.3 for tiles, no second primary, every color a theme token; the child and teen gates and the CSAM-only adult check are untouched
  (rule 0, rule 10); a studio that cannot make pictures or video right now is disabled with its S6 line, not hidden.
- Backlog: extends VIDEO-UI-01, VIDEO-CREATE-02, MUSIC-STUDIO-01 and the media editors rows via `PRO-LOOK-STUDIOS-01` (section 11).

## 19. One central mechanism, so the look is standard now and stays standard (Jesse, 2026-11-08)

Jesse likes the revamp (cards such as weather, fonts, icons) and wants it in every screen through a central mechanism. The mechanism is
the one the org already runs; this note makes each layer complete and adds the missing gates. Nothing is invented where a part exists.

1. **One token file.** The kit's `tokens.css` (commons `ui`) is the only place a color role, type size, space step, radius or surface
   layer has a value (sections 5.1 to 5.5). Home sets token values in one place and never in a component. Changing the look of the whole
   product is one commons tag plus one Home pin bump (`docs/PINNING.md`), and the per-person ease and theme settings keep driving the
   same tokens (so text size, theme and child mode are one mechanism, not three).
2. **One definition per part.** Every repeating piece is a single kit part used by every app: shelf header and shelf, tile, row, card,
   hero header, pill button and chip, round glass icon button, pill field, `PromptBar`, `EmptyState`, `Skeleton`, the glass floating
   bar, the weather and summary card, the job card of section 20, and the icon set (the kit's one lucide set, one stroke weight, sizes
   16, 20, 22 (rail), 24, 26 (phone bar) and 28; no second icon library and no hand-drawn SVG icons in Home). A second copy is wrong even when faster (org principle 1).
3. **Apps declare data, not layout.** Package apps keep drawing through the schema nodes and `contributes` manifests (pages, sidebar
   groups, header modes, settings areas), so a new app gets the look for free and a look change reaches every app without touching
   the app. The kit gallery documents each node.
4. **Gates that fail the build.** Home already runs `bun run lint:ui-rules` (`colorLints`, `kitElementLints`, `handBuiltChat`, with
   shrink-only baselines) and rule 9b. One slice (`PRO-LOOK-LINT-01`) extends them, never a parallel family: `colorLints` (which already flags CSS
   colors, named colors, palette utilities and arbitrary colors) gains font-size, radius and spacing literals, so type and space come
   only through the token classes; a small icon-import check (nothing but the kit's set); and the "no hand-drawn card, row or tile"
   check is the one rule 9b already assigns to UI-LINT-01 to 03, run when the consolidation lands. Baselines only shrink, so a screen
   that is not converted yet cannot get worse.
5. **One gallery, judged by eye.** The kit gallery renders every part at 390 and 1440, light and dark, and in child mode; a change to a
   token or a part lands only after those captures are opened and judged (the existing rule), and the mockups in this note become the
   gallery's reference pictures for the new parts.
6. **One checklist for a new app or screen** (added to the org standards `PACKAGES.md` and `UI.md` in `getmaipai/.github/docs/` by slice 1, in that repo): use the schema nodes; use
   the kit parts above; take colors, sizes and radii from tokens; show status only through S6; add its row to the per-app list (section 9)
   and its captures to the gallery. A screen that cannot follow this needs a `UI-DECISIONS.md` row with its reason first (rule 9b).
7. **Who may change a token or part:** the look is Jesse's taste, so a change to a token value or a new part gets a design note and
   the architect gate; a bug fix that keeps the look does not.

## 20. "Making now": one job treatment everywhere (Jesse, 2026-11-08)

Jesse likes the Making now card and wants it consistent across apps and screens. Mockup: `making-now.png` (the treatment in five states
and three contexts).

- **It is S6's existing row, not a new surface or a new part.** S6 already says "One job's progress: that job's own card (picture,
  video, download)", fed by the job record, for whoever started it. For a clip that card is the kit `VideoPlayer` Element in its feed
  entry (VIDEO-UI-01 rev 7, K1: statuses `queued`, `generating` and the rest), for a picture it is the shipped `image-generation`
  Element with GENPREVIEW-01's live previews (blurred to sharp picture, video stages, time left, first frame), and for a song it is
  the song card. None of those is replaced and no `JobProgress` generation variant is added beside them (org principle 1).
- **What becomes one:** the **state treatment**, applied through additive props on those same Elements. The same five state words
  (WAITING, MAKING NOW, DONE, COULD NOT FINISH, PAUSED) in small caps, the same order (state word, the person's own prompt
  or title in one line, one muted line), the waiting line from ISOLATION-03 ("Waiting for chat to finish", "Next after another video (about N minutes)"),
  the failure line from `failureCopy` with the next step, one action in the same place and order (Cancel, Open, Try again, Resume), and
  the percent ring where the Element shows no live preview of its own. The mockup's ring card is also the form for a job that has no
  preview (a song, a stem, an edit's pending card where the editor record gives none). Where an Element has a live preview, the preview
  stays and the state words and action sit under it.
- **Downloads and installs wear the same card (Jesse, 2026-11-08: the current strip is ugly):** the kit `JobProgress` Element (queued,
  running, paused, stalled, verifying, failed, done) keeps its job and its data but takes the shared look through an additive kit variant:
  the ring with the percent, the small caps state word (DOWNLOADING, WAITING, PAUSED, STALLED, VERIFYING, COULD NOT FINISH, DONE), the item's name,
  one muted line with the bytes and time left, a thin bar under the text, and one action (Pause, Resume, Cancel, Retry, Open) in the same
  place. Where the progress strip, the dock row and the setup wizard sit does not change (S6's "Background progress" row and its
  surfaces stay); only the card they draw changes. Mockup: `downloads-card.png`.
- **Accent:** outside a studio the ring and the state word use the app's own accent token (`accent-app`, one of the seven existing
  accents); inside a studio they use `accent-create` (section 9a). `accent-create` is used nowhere else.
- **Same words everywhere, no resource words:** no memory, RAM or machine words for a person (the existing rule). When the cause is
  "Pictures and video are not ready", S6's disabled control and its line apply and the card does not invent a second message; a failure
  that coincides with a not-ready state is reported as that state.
- **Privacy and gates:** the viewer's own jobs only (rule 6a); a child sees the child line; the treatment adds no figure of resources and
  no text beyond the person's own prompt.
- **The queue (Jesse's question, 2026-11-08):** where an app already has a feed or list, its own queued and generating entries are the
  queue, in that list's order and unfolded (Video Create: the `result_feed`, newest first, one `VideoPlayer` per row, exactly as
  VIDEO-UI-01 rev 7 has it); a Music or Library list shows them as rows. Where no list exists, each job shows only its own card where it
  was started, with its WAITING line, and nothing groups several jobs (S6: no new panel; the companion's one-line "1 working · 2
  waiting on you" row already summarizes them). The position and the waiting line come from ISOLATION-03 (open: one heavy job per
  person, round robin by person), whose copy wins over any wording here; the queue display of `PRO-LOOK-JOB-01` folds into
  ISOLATION-03. `making-now-queue.png` is a preview of option (i) only. A list of the person's own jobs across apps, with a fold
  past three, is option (i) below and an S6 change for Jesse.
- **What this does not add:** no global jobs tray, banner, badge or toast (S6 rejects a new status UI). Option for Jesse, not proposed as
  built: (i) a single "Making now (n)" entry in the header row that opens the list of the person's own running jobs would be a new
  status surface and an S6 change.
- **Backlog and supersedes:** folds into CHAT-CARDS-11 ("fold the job cards into one `job` block", which needs its own design pass first)
  and VIDEO-UI-01's feed entry, as `PRO-LOOK-JOB-01`: the shared prop set first (commons, additive), then each Element's card. It changes
  none of VIDEO-UI-01's or GENPREVIEW-01's decisions; the previews, statuses and the removal of the old Making now card stay as they are.

## 21. One status card for progress, problems and notices (Jesse, 2026-11-08)

Jesse: the Making now card is really an info card too (a failed generation with Try again, a failed download with Retry, out of
storage). Agreed: the job card of section 20 is one kind of a single status card anatomy, and every message that has a state and
one thing to do next wears it. Mockup: `status-cards.png`.

- **The anatomy (one design, six kinds):** a lead (a progress ring, a thumbnail, or a 56 pt round tinted icon), a small caps state
  word, a one-line title, one muted line that says what happened and what to do (STYLE.md: the problem as the person sees it, then
  the next step), one primary action in the cream pill, and at most one quiet second action (Not now, Dismiss). The kinds differ
  only by lead and tint, both theme tokens: progress, waiting, done, needs a look (warning), could not finish (problem), good to know
  (info).
- **Two S6 surfaces keep their form.** The companion's Review prompt stays the one kit Button as shipped (S6 and S2); only the task card it opens wears the anatomy. The "Pictures and video are not ready" line stays one line (the screen's muted line, or the control's own hint, or the chat composer line), restyled by tokens only and using the state word and copy rules; it does not become a card.
- **It is a look for surfaces S6 already has, not a new surface.** It is the shared anatomy for: a job's own card (section 20), the
  kit destructive `Alert` in a form or action that failed ("A form or action failed" row), the Repairs item with Try again
  (`RepairsPage`), the one recovery notice for pictures and video (S6's single kit toast, as a kit toast variant), the task's own card that the companion's Review button opens, a download
  or install's `JobProgress` (including its out-of-space and stalled copy), and a first-use tip. Each keeps its S6 location, data
  source and audience; only the card they draw is the same. Inside a form the failed-action `Alert`'s action is the quiet or secondary one, so a screen never has two primaries beside the form's own Save. The kit gets an additive anatomy variant for `Alert`, `Status` and
  `JobProgress` (`PRO-LOOK-JOB-01`, section 11), and Home passes data and copy; no new kit part and no new place where status appears.
- **Wording:** the state word names the kind (MAKING NOW, WAITING, DONE, NEEDS A LOOK, COULD NOT FINISH, NOT READY, NEEDS YOUR OK, GOOD
  TO KNOW); the line comes from `failureCopy` or the Element's own copy and ISOLATION-03's waiting lines; a person never sees memory,
  RAM or machine words, and a not-ready line carries no figure (S6's "never a figure"). An out-of-storage line names the storage and
  the next step ("Free up space", opening the existing storage page for a person who may open it; anyone else gets the line with their own next step, such as asking an admin); the byte figures it shows are the `JobProgress` copy as built.
- **Child and gates:** a child sees the child line, the viewer's own jobs only (rule 6a), no resource figure; Review and approvals
  keep their audience rules. Tips are dismissible, appear once, and follow the existing first-use mechanism; this note adds none.
- **Not proposed:** a notification center, a global banner or a toast of this look beyond S6's single recovery toast; those stay
  S6 decisions for Jesse (option (i) for a jobs list).

**Stacking and the phone form (Jesse asked to see stacked cards):** cards sit 12 pt apart on desktop and 10 pt on a phone, in one
column, full width of their container (never side by side). A list keeps the order it has today (Video Create's `result_feed` newest
first and ungrouped, the Repairs page, the notifications list and the Status page each as built); the grouped small caps headings NEEDS A
LOOK, then IN PROGRESS, then DONE apply only to a list that has no order of its own, and no list in the product is that today (the
Activity mockup is such a list only as the option (i) preview). On a phone under 430 pt the card keeps the same anatomy but reflows: the lead and
the text on the first row, the action beneath the text, left aligned, so the title never wraps in a few letters. Stacks appear only in
lists that already exist (Video Create's `result_feed`, the Repairs page, the notifications list, the Status page); a card is never
stacked on top of another card or over content. Mockups: `desktop-status-stack.png` and `phone-status-stack.png` draw one such list
on a page named Activity inside Library; that page is a preview of option (i) of section 20 (a list of the person's own jobs across apps), not
a proposed screen, until Jesse takes that S6 change. The drawer of the top-left menu button is drawn in `phone-drawer.png`.

## 22. No buried error messages: where every error and notice goes (Jesse, 2026-11-08)

Jesse's principle: we should never have buried error messages scattered through the UI. This note makes it a standard with a measured
starting point. A scan of the frontend on 2026-11-08 found 47 files that draw red inline text (`text-destructive`), 78 toast calls, 73
destructive `Alert` uses, 5 places that print a raw `error.message`, and only 7 files that use `failureCopy`. So the same kind of failure
is told in four different ways.

The rule, one place per kind (these are S6's surfaces; the rule is where and how each is drawn):

1. **A failed action shows a status card at the place of the action** (section 21: the kit destructive `Alert`, same anatomy): the
   problem as the person sees it, the next step, one action. It stays until the person fixes it or dismisses it; it never vanishes
   after a few seconds and is never a gray line under a control.
2. **A toast is never the only home of an error.** A toast may confirm a short success ("Saved") or be S6's single recovery toast; an
   error that needs a next step is a card (1), and a failed background job is that job's own card (section 20).
3. **A form's field error sits at the field** (the kit field error), and the form-level failure sits in a card at the top of the form.
4. **A problem that needs an admin is a Repairs item** (S6), a service that is down is the Status page and header pill, a chat that
   is not ready is the composer line: unchanged, drawn with the same anatomy where they are cards.
5. **All wording comes from `failureCopy`** (or the Element's own copy): no screen writes its own error sentence and none prints a raw
   error string, a code or a stack to a person. An admin reaches details through the existing raw-error indicator and the report the
   affected person previews and sends (rules 6 and 6a).
6. **No error inside a muted caption, tooltip or settings description,** and no red text without the state word and the next step.

Out of scope of this section, unchanged: a chat turn's own failures stay under rules 6 and 9 (the model's own words, fresh each time;
the one fixed SEARCH-DOWN-EMPTY-01 line; the `error` event with crisis resources); the admin raw-error indicator and its raw details
(rule 6) are a permanent lint allowance, not a baseline entry; the safety refusal and crisis text stay the hub's own band-shaped copy,
rendered by the kit's `GuardrailNotice` and `MessagePrimitive.Error` (rule 0, SAFETY-NOTICE-01), and are never moved into a
frontend `failureCopy` table.

Enforcement (slice `PRO-LOOK-ERRORS-01`, after the tokens and the card variant): extend the existing lints, not a parallel family,
so that Home source fails the gate on a rendered `error.message`, on `text-destructive` text outside the kit's `Alert`, field error
and card parts, and on an error toast; baselines only shrink. The slice then converts the 47 files, the 78 toasts and the 5 raw
messages screen by screen with the matching app slice, opening each screen's failure state in the dev hub and judging it. Each
failure path also gets a screenshot in the gallery (section 19) so a regression is visible. Nothing here changes what a message may
say to a child (child lines stay) or adds a status surface.

## 23. A job stays visible while you are elsewhere; the bell; the menu button (Jesse, 2026-11-08)

**A job stays visible everywhere (Jesse: "I start music creation, I see the card generating, I can go somewhere else like News and still
see the progress").** Mockups: `phone-news-job.png`, `desktop-news-job.png`. This is the progress strip, not a new surface: S6 already
gives background progress one surface (the shell progress strip, `InstallStrip.tsx`, `InstallDockRow`), and S6 says a change "uses the
surface that already carries that kind of status and feeds its data source a new reason or state". The proposal is to feed that strip
with the viewer's own generation jobs (picture, video, song, stems, edits) as well as installs, drawn with the section 21 anatomy:
one compact card (ring, MAKING NOW, the title, the app's name, Open, and on desktop Cancel) docked like a mini player.

- **Place:** on a phone, directly above the sections bar and under any mini player or Listen dock (the stacking order of phone-minimal
  P2 gains the strip in the position the install strip has today); on desktop, a docked card at the foot of the content panel. It is
  one card at a time for the running job; a second job is reached from the card's own Open (the app's feed) and the companion's
  existing "1 working · 2 waiting on you" line. No tray and no stack (S6).
- **Data and privacy:** the strip's source gains the viewer's own job rows only (rule 6a), through the existing job records and the
  existing polling the strip already does; no new polling loop. A child sees the child line; no resource figures.
- **When it ends:** the card turns into its DONE or COULD NOT FINISH form for a short time, with Open or Try again, then leaves; the
  result is in the app's feed or the Library. It never covers the sections bar, the composer or a player.
- **Allowed under S6 as written** (architect ruling, 2026-11-08: S6 says a change uses the surface that already carries that kind of
  status and feeds its data source a new reason or state), on these conditions: it uses the strip's existing data path (`lib/installStatus.ts`
  and the dock model) with no new polling loop; generation items show only to their owner (rule 6a) while install items keep their "everyone"
  audience; one card at a time, no tray or stack; no resource figure; the child line for a child. A reading of S6 that closes the
  "Background progress" row to installs only would make this option (i) for Jesse.

**The notification bell (Jesse: "are we going to use the notification icon for these status cards?").** No for live progress or for
errors in place: those stay on the job's own card, the strip and the failed-action card (sections 20 to 22). The bell stays S6's
surface for what needs attention away from the screen. One use is proposed: when a job ends while the person is not looking, the
existing notification mechanism (`lib/notifications.ts`, a type declared in `lib/notificationTypes.ts` for the job's owner) carries
one item, "Rainy porch song is ready" or "Your video could not finish", that opens the result or the retry. It uses the section 21
anatomy where it draws a card, adds no badge on the companion and no new surface; it is allowed (architect ruling, 2026-11-08): the S6 row's audience is the audience the type declares, and person-audience job types
already exist (`project.done`, `project.failed`, `jobs.admin_stopped`). Conditions: new declared types with `audience: "person"` and
`configurable: true`; sent only when the job ends while the person is not looking, so it never doubles the strip's DONE form; child copy for
a child; no badge on the companion (S2).

**The top-left round button on a phone** is S1's menu button: it opens the slide-over drawer (the brand and Search, the apps with
favorites and their status dots, the open app's own sections, and the profile and settings foot) and, on an app's detail page, it is
the Back button. The mockups draw a "sidebar" glyph there; the product's glyph must read as a menu (the kit's menu icon), 44 pt, glass
over art. On desktop there is no such button because the labelled rail is always present.

## 24. Themes, Looks and light, dark and auto (Jesse, 2026-11-08)

Everything above must work with the product's theme system: the person's Appearance (`ui.appearance`: system, light or dark; "system"
follows `prefers-color-scheme` and is the auto mode) and their Look (`ui.look`: neutral by default, stone, zinc, mauve, olive, mist,
taupe, navy; the person's accent too). That is 8 Looks times 2 schemes, and the ease and child modes sit on top. Mockup:
`themes.png` (the same screen in Neutral dark, Neutral light, Navy dark and Olive light). Checking the mockup against light themes
found two real defects that the rules below prevent: text over artwork turned dark on dark art, and a hard-coded dark fade at the
bottom.

1. **Every token has a value for every Look and both schemes,** derived from one rule (the four surface layers are steps from the Look's
   page color; glass is surface-1 with alpha; hairlines are the foreground at 8 percent). A new token (section 5) is not done until
   the kit's token file defines it for all 8 Looks in light and dark.
2. **Text over artwork, pictures and gradients uses the kit's one existing art family,** `--art-foreground`, `--art-scrim` and
   `--art-overlay` (ui-v0.5.257; plus `--art-foreground-muted` if a muted tier is needed), re-valued for this look and not renamed. The
   pair is **fixed light text on a fixed dark scrim in every Look and scheme** (a documented token exception, like
   `--hue-violet-foreground`), so a light theme never puts light text on a light scrim; the item 6 contrast gate checks that pair over
   all 16 Look and scheme pairs. A page-level fade at the edge of a screen (behind the floating bar, under a header) is a different
   thing and is built from the page's own surface token; it carries no text of its own. There are no new `on-art` or `on-hero` names.
3. **No per-component theme logic:** no `dark:` class, no `prefers-color-scheme` query and no forced `dark` class in an app or page
   (the Music page's forced `dark` class is a phone-minimal P9 defect that section 9a removes). Components read tokens only.
4. **No flash:** the tokens used before first paint (page, surface-1, foreground) are in the first-paint palette
   (`first-paint.js`, `firstPaintPalette.ts`) so auto mode and every Look paint right on first frame; `theme-debug.html` reports what a
   phone resolved.
5. **Accents follow the Look and the person's accent:** `accent-app`, `accent-create`, `accent-companion` and the generated cover
   gradients are derived from the Look's accents at render time, so a Look or accent change recolors rings, progress and tiles; each
   derived accent meets 3:1 against the page and its text pair meets WCAG AA.
6. **Gates:** a token-resolution test and the existing AA contrast check run over all 16 Look and scheme pairs; the gallery captures at
   390 and 1440 for neutral and navy in light and dark, with the other six Looks sampled by the automated check; each slice opens
   and judges those captures (section 19). Child mode and ease sizes compose with every Look.

## 25. The Activity entry and its indicator (Jesse, 2026-11-08)

Jesse: the Activity menu item should show an indicator when there is something in it, with some animation and color that tell active from
finished. Mockups: `activity-indicator.png` (four states), `phone-drawer-activity.png` (the entry in the phone drawer; it sits under a
"You" heading in the mockup only to stand out, under S1's order it is one of the apps).

This is the destination of option (i) of section 20 (a list of the person's own jobs across apps), so the page and its menu entry are
an S6 change for Jesse and are not proposed as built until he takes it. If he does, the entry is designed so it adds no new indicator
vocabulary: it uses S1's existing status dots on an app entry in the drawer and the rail.

- **Idle:** no dot.
- **Running:** a lime-family ring pulses softly (`accent-app`, `accent-create` inside a studio's own list), 1.6 s, about 1.7 times its
  size, and the pulse stops when the person asks for less motion (the dot stays, steady).
- **Needs a look:** a steady amber dot (the warning kind of section 21). It wins over the others when several apply.
- **Finished, not opened:** a steady teal dot (the done kind) until the person opens the result or the Activity page, then it clears.
- **No number on the dot** (S1's dots carry none) and no badge on the companion avatar (S2); the Activity page shows the counts and
  the cards of section 21, in the order each list already has.
- **Same dot, same colors everywhere the entry appears** (the drawer, the labelled rail, the All apps launcher), as tokens that follow
  every Look and scheme (section 24), meeting 3:1 against the surface.
- **Audience and gates:** the person's own jobs only (rule 6a); a child gets the child line; no resource figures; the entry is absent
  for anyone who has no jobs feature (guest, shared screen), as the app list already filters.

## 26. Corrections from the build audits and the build map (2026-11-08)

Four read-only code audits found points where this note's wording assumed more than the code does. The plan changes are in
[PRO-LOOK-01-BUILD-MAP.md](PRO-LOOK-01-BUILD-MAP.md); the corrections to this note are:

- Section 5.1 and section 11 slice 1: re-valuing `--font-size-*` does not move most screens (the kit sets text with Tailwind
  `text-sm` and `text-base`). The scale is delivered as Tailwind `--text-*` theme variables and semantic utilities, gated by
  `html[data-pro-look]` until Home is converted. "Every screen changes at once with no layout move" holds for color, surface and radius,
  not for type.
- Section 5.4 and section 24: the new surface layers are derived from the Look's own `--background`, `--card` and `--muted`, not from the
  kit's existing `--surface-*` tokens (navy literals that ignore the Look). The 8 Looks live in the kit's `globals.css`.
- Section 24 item 2: the existing `--art-*` family follows the Look today, so re-valuing it to fixed light text on a dark scrim is a
  visible change to Player, Billboard and tiles in light Looks, and needs Jesse's yes.
- Section 19 item 5: the kit gallery does not exist yet; it is built first (GALLERY-01).
- Section 5.1: the kit's touch target is 48; the visible control is 44 with the 48 hit area kept, unless Jesse lowers the floor.
- Section 23: picture, video and song jobs are not in the unified job list today; feeding the strip needs a projector, and the
  "person is not looking" condition cannot be a backend rule (the bell types are `generation.done` and `generation.failed`, and the strip's
  DONE card is the in-page signal).
- Section 16: the six-pin cap is not in Home source and must be located in the kit before APPS-01.

## 27. Text never cramps (Jesse, 2026-11-08)

Jesse pointed at a mockup where a settings row squeezed its label to one word per line because a wide control (six Look swatches) took the
row's width. That is a defect class, not a one-off, and it gets a rule, a gate and a test at the largest text size.

1. **Text has a floor.** A title, label or description block never gets narrower than 200 px (or 12 characters of its own type, whichever is
   wider). Any control that would push it below that wraps beneath the text instead of beside it. The kit settings row, the status card
   (section 21: the action drops under the text under 430 pt), the shelf header and the row pattern all follow this; a row with a wide
   control (swatches, a segmented control, a slider, several chips) stacks the control under the label and description.
2. **No one-word lines.** A label or description that wraps to a line of a single short word beside a control is a failure. Text may
   wrap to at most three lines in a card or row; past that the row stacks or the copy is shortened (STYLE.md).
3. **Large text is the test case, not an edge case.** The ease text size scales to about 1.6 times (13.5, 16.2, 18.9, 21.6 px steps of
   the body token) and the larger-buttons setting raises targets to 76 pt. Every pattern is checked at the largest step and at 320, 402,
   744 and 1440 wide, in child mode (P4a), and in a longer language (Spanish and German strings are measured at about 1.4 times English).
4. **Gate:** the kit gallery renders each pattern with long copy at the largest ease step and 320 wide; a test asserts the text block's
   computed width is at least the floor and that no text node wraps to a one-word line next to a control; slices cite the measured
   numbers (section 3 of the build map). Pictures in the reference set show the stacked forms (`desktop-settings`, `phone-settings`,
   `phone-status-stack`).

## 28. Family and person profile pages (Jesse, 2026-11-08: "more like Instagram or TikTok pages")

A person's page is a profile, not a settings form. The pattern is the social profile every phone user already knows, drawn with kit parts
and the 16 pt gutter, 34 to 40 pt titles and flat surfaces of sections 4 and 5.

- **Person profile** (`phone-profile`, `desktop-profile`): back button, the name centred (phone) or left (desktop), a menu button. Under it a
  92 pt avatar on phone (168 pt desktop) with the person's ring when a companion is active, and three large counts beside it (songs,
  videos, pictures; counts come from the library, never invented). A role chip (OWNER, TEEN, CHILD) sits above the counts on phone and next
  to the name on desktop. One line of bio, then Edit profile (inverse pill), Share and Settings (quiet pills). A row of round highlights
  (the person's companions, favorites and collections). A four-icon tab strip (all, videos, songs, with family) and an edge-to-edge
  three-column grid on phone (five on desktop) of the person's own creations, square, 2 pt gaps, a corner badge for video and song.
- **Family page** (`phone-family`; desktop stays `desktop-family`): the household title with a one-line count, a strip of round avatars
  with an Add tile, a People section of flat cards (avatar, name, role and one count, chevron), the Companions shelf, and a
  "Shared with everyone" grid.
- **Rules that still hold:** what a teen or child profile shows follows the existing age and surface gates (a parent-set view of a teen is
  limited to what P4a allows; teen settings stay private); the grid uses the kit media shelf and tiles, never a Home wrapper; the counts
  and grid read from existing library records. Slice: PRO-LOOK-SETTINGS-01 gains a sub-slice FAMILY-PROFILE-01 (person profile route
  and the family page restyle); pictures `phone-profile.jpg`, `phone-family.jpg`, `desktop-profile.jpg` in the reference set.
