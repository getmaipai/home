# STUDIO-LOOK-01: one professional look on every screen, built from the Artlist and Runway pattern (2026-11-11)

Status: owner-directed; slices 0 and 1 landed (route inventory, Look bundles in the kit). Owner words are the record (RULES.md S1 and S2,
Owner-approved 2026-11-11). Reference screenshots of Artlist and Runway are the owner's and are not committed; every measurement below was
taken from the public pages in a browser or from those screenshots.

What this note holds, in order: the audit of why the built app did not match the PRO-LOOK mockups; the Fable design review (sections A to F);
the owner's later requirements (sections G to M: one look everywhere, the expanding rail and its context states, motion and instant feel, one
composer with a mode menu, the grouped rail, the Activity popover, loading placeholders). It supersedes the mockup-first parts of
[PRO-LOOK-01.md](PRO-LOOK-01.md) where they differ; the tokens, pills and surface steps there still stand.

Build state: the route inventory is `docs/design/ROUTE-INVENTORY.md`; slice order and the check for each slice are in section E; the kit releases carry the slice names (LOOK-BUNDLE, LOOK-TYPE, KIT-ART-FALLBACK, KIT-COMPOSER-MODE, KIT-RAIL-GROUP, KIT-ACTIVITY-POPOVER).

## 0. Audit: why the app did not look like the mockups (2026-11-11)

## What the screens showed

| Screen | Mockup | App now |
|---|---|---|
| Home | Inset rounded canvas, sub-menu (Today, For you, Reminders, Weather), big greeting, Household avatar row, Today cards with gradient art, "New in your library" tile shelf | Flat dark page, plain header row, greeting, ask box, empty "News"/"Shopping List" boxes, no sub-menu, no Household row, no art tiles |
| Media / Music | Square gradient art tiles with the title on them, hero header with album art, 64 px rows with art | Empty gray rounded squares with titles under them; Music Home blank while loading |
| Detail pages | Hero gradient from the art, round glass buttons over it, one cream Play pill | No hero; normal header bar |
| Phone | Floating glass tab bar, large title, art-first | Drawer menu, small title (rule-gated) |
| Light mode | None drawn (all mockups are dark) | Default is light/system, so he sees a white form |

### Causes (in order of weight)

1. **The mockups drew art the app does not have.** Every tile and hero is a generated gradient cover. The app shows the item's real
   cover, and when there is none (seed data, new songs, news video) it shows a flat gray box. The "image first" look depends on art
   that does not exist for most items. No fallback art was ever built.
2. **The foundation was skipped.** The build map said: gallery first, tokens (surface-0..2, glass, accent-hero, text-hero, title,
   section sizes), then screens. In the kit there are no such tokens; type is still Tailwind sizes. What landed were
   per-page "PRO look conversion" slices (HOME-01, LIBRARY-01, NEWS-01 ...) made by Codex runs and checked by lints (font size, radius,
   inline svg), not by looking at the picture.
3. **Parity was never enforced.** The note says each slice compares a capture with its picture and pastes measured numbers. Commits
   carry none. "Done" was lint-green plus my own judgment from small 800 by 500 screenshots.
4. **Rule-gated parts were left out** and never revisited: floating phone bar, hero art behind the header, large titles, the Activity
   page. Those are the biggest visual differences on phone.
5. **Mockup content is invented** (Household row, "Family list" tile, library shelf). Home has no widgets for these, so the page is
   mostly empty cards.
6. **Default appearance is light**; all mockups are dark.

### Fastest way to get there (proposal)

1. One kit slice (commons): `ArtTile` that always paints a deterministic gradient from the item name (so no gray box ever), `HeroHeader`
   (gradient plus scrim plus glass round buttons), inset rounded canvas, glass surface and type tokens. Gallery page shows each.
2. One Home slice per screen in this order: Home, Music (home and album), Media, News, Library, Edit (photo, video, song create).
   Each ends with a scripted capture at the mockup's size and a side-by-side check by a second agent that returns pass/fail per
   difference. No landing without it.
3. Home content: add the Household row and the library shelf as real widgets (data exists).
4. Decide the default: dark Look for everyone, or stay on system.
5. Phone floating bar and hero-behind-header need Jesse's rule edits (S1, S2); these are decisions 5 and 6 in the build map.

### Separate defect found

Dev hub would not start on main ca800e6: backend dies with "Cannot access 'cache' before initialization"
(`backend/src/lib/manifestStat.ts`, circular import via `lib/paths`; from AUDIT-PERF-01 item 6, 6f53d177c). It starts fine at b9ce193.
Not checked whether the live hub is exposed once it ships newer main.


# Design review


Summary

1. The app fights Artlist in structure, not in color: a bordered header row on every page, a second app column, a 12-column widget dashboard as Home, captions under tiles, and gray fallback boxes where Artlist puts art.
2. The mockups chased Apple Music and Suno (gradient tile shelves, a greeting dashboard, invented widgets). Keep their tokens, pills, surfaces and hero idea; drop the shelf-first Home, the fake gradient covers and the inset rounded canvas.
3. Artlist and Runway agree on the safe target: one grouped sidebar, a composer that is the page, pill chips, name-on-art tiles in a shelf or grid, one accent used once, a 36 to 40 px title at weight 400 with tight tracking. They differ on dark versus light, hero versus composer-first home, and radii; for a family app take Runway's composer-first home and Artlist's dark hero for Media. Most parts exist in the kit (PromptBar, Billboard, headerOverArt, PhoneNav glass, segmented tabs); masonry, name-on-art tile and a floating toolbar are the only new parts.
4. Themes that change real styling: give each Look a "bundle" of non-color tokens (font, weight, tracking, density scale, radii, surface step, hairline, glass blur, nav active style, tile aspect, motion), defined once in a spec `looks.json`, generated into the kit CSS beside the 16 color blocks, applied by the existing `body.style-<look>` class. No color literal is added, so the 2026-10-19 rule holds.
5. Fastest path: baseline captures, the Studio bundle, the composer-first front page and the hero Media home, the studio composer, masonry explore, the art fallback, then chrome, editor, phone, extra Looks. Each slice ends in a 1440x900 and 402x874 capture laid beside a named Artlist or Runway screenshot.
6. Needs Jesse: dark default, yellow versus cream as the one primary, self-hosted fonts, S1 (apps in the phone bar), the S2 hero-under-header reading, and compute for cover art.

Facts measured on artlist.io and studio.artlist.io today (public pages, no sign-in): page `rgb(13,13,13)` and `rgb(23,23,23)`, cards `rgb(26,26,26)` at 16 px radius, pills at 40 px radius, body font a custom grotesque (artlistSans) with a serif italic display face for one word, H1 40 px weight 400 with -1.2 px tracking, H3 20 px weight 500, body 16 px, segmented control 42 px tall with `blur(14px)`, hover pill `rgba(0,0,0,.2)` with `blur(2px)`, secondary pill white at 70 percent, one yellow primary.

Facts measured on runway.com and the guest home of app.runwayml.com today (public, cookies declined, no sign-in): the app is light (page white, sidebar `rgb(246,246,248)` at 256 px), a segmented Creative, Ads, Dev control at the top of the sidebar, a "New Chat" split button, rows 36 px tall at 10 px radius with a 5 percent tint when active, title 36 px weight 400 with -0.36 px tracking and one inline picture in the sentence, section headers 24 px weight 600, a centered composer card with soft 62 px Reference and Sketch tiles, a textarea, a "+" and a mode chip, a round submit, a row of 38 px shortcut chips at 12 px radius, category tabs as 34 px pills (selected filled, weight 600), a shelf of 200 px square cards at 8 px radius with the label on the art, two-column feature cards below, font ABC Normal with Inter as fallback, one blue primary used only on Sign up, `blur(12px)` on the marketing header.

## A. What the current build does that fights the target

Cited from the pinned kit `commons-tags/ui-ui-v0.5.574/ui/src` and Home `frontend/src`.

1. **Every page starts with a bordered bar.** `dashboard/layouts/full/FullLayout.tsx:100` draws `rail-page-header` as `sticky h-13 border-b border-border`; the glass and `headerOverArt` variants exist there, but `shell/Routes.tsx:436` passes neither, so no page has art under the top row. Artlist's top row is transparent; the account actions float over the hero (artlist-8) and the editor's Back is a glass circle over the canvas (artlist-6).
2. **Three columns before content.** The 56 px rail (`AppRail.tsx:342`), then `SectionSidebar standalone density="compact"` as a bordered app column (`PackageAppPage.tsx:183`, `FilesPage`, `MediaHubFrame`), then the header. Artlist has one 200 px grouped sidebar with 12 px group labels (Generate, Tools) and 26 px rows, or a 56 px icon rail on Studio explore, and nothing else.
3. **Home is a widget dashboard.** `DashboardPage.tsx:67` lays a 12-column grid of greeting, ask box, shortcuts (`rounded-xl bg-card` links, line 85), Today cards and shelves. Artlist Studio home is one full-bleed hero with a 340 px glass card and a "My Projects" grid below (artlist-8). Nothing on our Home is image first.
4. **Tiles caption below, Artlist names on the art.** `MediaHomePage.tsx:62` and `HomeShelves.tsx:68` render `renderCaption` under a square `SafeImage`; `MediaShelf` has no name-on-art mode. Artlist tiles carry the name bottom-left on a scrim, in a masonry with natural aspect (artlist-9, artlist-10).
5. **No art means a gray box.** `primitives/SafeImage.tsx:64`: the fallback is `bg-muted` with an icon, or a 22 percent tint with letters when `tintSeed` is set. On seed data most tiles hit this path. This is the single biggest reason the app "looks nothing like" any mockup.
6. **The composer is a form.** Home's ask is `InputGroup` plus three outline starter buttons (`dashboard/AskBox.tsx`); the studios use `PromptBar` in `panel` or dock placement. Artlist's composer is the page: a centered 690 px rounded card with a chip row on top (add, image reference, video reference, presets), a 16 px textarea, and an options row of pill dropdowns with one yellow primary at the right (artlist-7); on explore pages the same composer floats glass over the grid (artlist-9).
7. **Empty states are a paragraph.** `MediaHomePage.tsx:52` renders `EmptyState icon="film" text=...`; the kit tile variant is used in only 5 files. Artlist's empty editor is a glowing sample image, a 20 px title, one line, one cream pill (artlist-6); its empty grid leads with a soft "Upload your own" tile.
8. **Type weight and tracking.** The pro-look scale (`tokens.css:2065-2097`: 34/22/17/14 phone, 40/24/15/13 desktop) is the right size but weight 600 to 700 everywhere. Artlist is 400 to 500 with negative tracking on the title; that is most of the "slick" feel.
9. **Color discipline.** Eight Looks each set their own `--primary` (`globals.css:189-740`), Home adds a cyan `--primary` (`shell/tokens.css:517`), and `--accent-create` is `--hue-yellow` (`tokens.css:2048`). Artlist uses yellow once per screen and white at 70 percent for every other filled pill.
10. **Phone.** `PhoneNav` is mounted only by `PackageAppPage.tsx:284` as `variant="docked"`; the glass floating variant (`PhoneNav.tsx:108`, `surface="glass" inset="pro"`) exists and is unused. The drawer is the app switcher (S1).
11. **Against Runway the gap is smaller but the same shape.** Runway's home is a composer under a one-line title with a chip row and one shelf; Home's front page has the ask box but buries it in a 12-column grid beside shortcuts and cards. Runway's sidebar rows (36 px, radius 10, 5 percent tint) are what the kit `Sidebar` already draws; the difference is the bordered app column and the bordered header, not the rows.

## B. The mockups: keep, drop, change

The mockups were the wrong target in three places: they are Apple Music and Suno (consumer media shelves), they promise art that does not exist (every tile a generated gradient), and they add content Home does not have (Household row, Family list, Today cards). The Artlist target is a tool for making things, with the person's own output as the art. That fits Home better, because the things Home really has pictures of are people, companions, made pictures and clips.

| Keep | Drop | Change |
|---|---|---|
| Dark-first, three surface steps, hairline, glass (landed in ui 0.5.574 as `--surface-0..2`, `--surface-glass`, `--hairline`, `--scrim-hero`) | The greeting plus Household row plus Today cards as the front page | The front page becomes composer-first (Runway): one line, the composer, a chip row, one shelf; Media home becomes hero plus "Yours" grid (artlist-8) |
| Pill controls, 44 px control height, round glass icon buttons | Square gradient tile shelves as the main idea of Media, Library, Home | Browse screens become masonry with name on art (artlist-9) |
| Hero header under a transparent top row, cream secondary pill | The inset rounded canvas on desktop (desktop-home.png); Artlist content is full bleed | The ask box and the studio bars become one PromptBar layout (artlist-7) |
| Floating glass phone bar, mini player above it | Mode pills in the header row (desktop-music-create.png) | Music modes become the grouped sidebar's Generate group |
| 64 px row, 76 px row height, no dividers (lists still need it) | Invented gradient covers as the picture | Covers come from section F |
| Companion avatar top right (S2) | Weight 700 titles | Titles 500, tracking -0.03em, section 20/500 |

Blunt call: stop measuring the build against the mockups. Measure it against artlist-6 to artlist-10, the Runway guest home, and three new mockups that use Home's real data (a companion portrait hero, the seeded cast, made clips).

Why Runway's home and not Artlist's for the front page: a family hub's front page must work on day one with no art and for a child, and its center is already the ask box. Runway's pattern needs no picture to look finished; Artlist's needs one big one. Media, Library and the cast have pictures, so they take the Artlist patterns.

## C. The Artlist pattern language as a spec Home can build

Where Artlist and Runway agree is the safe target; where they differ the last column says which fits a family app.

| Pattern | Artlist | Runway | For Home |
|---|---|---|---|
| Scheme | Dark (page 5 to 9 percent) | Light (white page, tinted sidebar) | Both, by the person's choice; the Look bundle must carry a light and a dark Studio (section D). Default is Jesse's call |
| Main nav | 200 px grouped sidebar, 26 px rows, edge marker; icon rail on explore | 256 px sidebar, 36 px rows at 10 px radius, segmented control at the top, "New Chat" button | Runway's row height (44 px targets, children) with Artlist's group labels; S1 keeps the 56 px rail beside it |
| Home | Hero art with a glass card, then a project grid | One-line title, composer, chip row, category tabs, one shelf | Runway for the front page; Artlist for Media home |
| Composer | Centered 690 px card, chips on top, options row below, one yellow primary; floating glass version on explore | Centered card, soft reference tiles, "+" and mode chip, round submit; shortcut chips under it | Agree: the composer is the page. Take Artlist's three zones and Runway's reference tiles; floating glass on browse pages |
| Tiles | Masonry, natural aspect, name on art | Shelf of 200 px squares with some double-wide, 8 px radius, name on art | Agree on name-on-art. Masonry for pictures and cast (Artlist); square shelf for songs and clips (Runway) |
| Chips and tabs | Pill dropdowns, glass segmented control | 34 px pill tabs, selected filled at weight 600; 38 px shortcut chips at 12 px radius | Agree: pills, one selected filled. Height 40 for touch |
| Title type | 40 px, 400, -1.2 px, serif italic word | 36 px, 400, -0.36 px, inline picture | Agree: 36 to 40 at weight 400 to 500, tight tracking. Weight 700 titles are the odd one out |
| Section header | 20 px, 500 | 24 px, 600 | Either; the bundle decides |
| Radii | 16 card, 40 pill, 8 thumb | 8 card, 10 to 12 control, 100 pill | Differ; a bundle value, not a rule (Studio dark 16, Studio light 8 to 12) |
| Accent | Yellow, once per screen | Blue, once per screen (Sign up) | Agree: one accent, one use, everything else neutral pills |
| Glass | 14 px blur on floating controls | 12 px on the sticky header only | Agree on glass for floating things; Artlist uses it more, fine in dark |
| Empty state | Glowing sample picture, title, one line, one pill | Shelf of sample projects with a label each | Runway's: show samples to pick from, never a paragraph |
| Motion | Hover reveals a pill, 150 ms | Tab fill, hover tint, no parallax | Agree: small and fast; keep `--motion-pill` 150 to 200 ms |

| Pattern | Spec | Kit part | Status |
|---|---|---|---|
| Grouped sidebar | 200 px, three top rows (Home, Library, References), group label 12 px muted, rows 26 px with 16 px icon and 14 px label, active row has a 2 px edge marker at the window edge, one external link at the foot | `ui/sidebar.tsx` (inset), `SectionSidebar` | Exists; needs `density="nav"` rows and an `activeMarker="edge"` variant |
| Icon rail (explore) | 56 px, icons in groups split by a hairline, active = edge marker | `AppRail.tsx` | Exists; add group hairline and edge marker variant |
| Back affordance | 36 px glass circle top-left over the canvas; on phone the leading Back in the sections bar | `Button variant="glass" size="icon-control"` (K1), `PhoneNav leading` | Verify K1 landed in 0.5.574; `PhoneNav leading` exists |
| Project tabs | Closeable tabs with a color dot and a plus; folder chips below | `ui/tabs.tsx` line variant | Closeable tabs are new (UI-DECISIONS row); skip in v1 |
| Composer, workspace | 690 px max, radius 24, `surface-1`, hairline; zone 1 chips (add, references, presets right); zone 2 textarea 16 px, 3 lines min; zone 3 pill dropdowns (mode, model, format, style), a toggle, one primary right | `elements/prompt-bar.tsx` (chips, references, tier, submit) | Variant `layout="studio"` with the three zones; chip popovers exist |
| Composer, floating | Same, glass, bottom-center, 640 px, fold chevron, one round submit | `PromptBar placement`, dock CSS `tokens.css:2427` | Add `placement="floating"` |
| Segmented control | 3 items, 42 px, radius 40, glass blur 14, active `surface-2` | `elements/tier-segment.tsx`, `Tabs variant="pill"` | Exists; add glass surface |
| Masonry grid | 4 columns at 1440, 2 at 402, 8 px gap, natural aspect, first tile is the "Upload your own" soft tile | `CardGrid`, `elements/image-gallery.tsx` | New layout `layout="masonry"` (CSS columns); UI-DECISIONS row |
| Name-on-art tile | Picture, bottom scrim, 16 px name 500, hover reveals a glass pill action centered | `MediaTileOverlay` (badge, meta) | Add `label` slot and `hoverAction` |
| Hero card | Art full bleed under the top row, 340 px glass card left: eyebrow pill, 32 px title, meta line, featured avatars row, cream pill | `Billboard size="hero"`, `FullLayout headerOverArt` | Exists; wire `headerOverArt` and a `glassCard` slot |
| Floating bottom toolbar | Icon over 11 px label, groups split by hairline, radius 16, glass; the primary tool tinted | none | New part (shadcn has no toolbar; Kibo UI or own); UI-DECISIONS row |
| Right properties pane | Groups of label plus icon buttons and small fields | the S2 right pane, `SettingsShell` rows | Exists |
| One primary color | Yellow on the make action and the upgrade action only; white at 70 percent for open and upload; everything else ghost | `--accent-create`, `Button variant="inverse"` | Exists; Studio Look sets `--primary` to the yellow hue |
| Type | Title 40/400/-1.2 px, section 20/500, body 16, nav 14, label 12, buttons 12 to 14 at 500; one serif italic word in a hero title | `--font-size-*` (right sizes) | Add `--font-weight-title`, `--letter-spacing-title`, `--font-display` |
| Spacing | Page `surface-0`, card one step (about 5 percent), gutter 32 desktop and 16 phone, grid gap 8, sidebar 200 | `--space-*`, `--gutter` | Exists; gutter desktop to 32 in the Studio bundle |
| Motion | Hover pill fade 150 ms, glass only, no parallax seen | `--motion-pill` | Exists |

## D. Themes that change real styling

Today a Look is 31 color roles in `dashboard/css/globals.css`; type, radii and spacing are global tokens in `tokens.css`; light and dark are `html.dark`; ease is five `html[data-ease-*]` attributes written by `scripts/gen-ease-tokens.ts`. The Look never touches a non-color token, which is why switching Looks only recolors.

**Token model: a bundle per Look, no color in it.** One definition in `commons/spec/ui/looks.json` (name, color roles already there in CSS today, plus the bundle), a generator in the kit (`scripts/gen-looks.ts`, same pattern as the ease generator with BEGIN and END markers and a parity test) writing `body.style-<look> { ... }` into `tokens.css` beside the ease block, and Home's Look picker reading the same JSON for its preview tiles. Bundle tokens:

| Group | Tokens | Read by |
|---|---|---|
| Type | `--font-sans`, `--font-display`, `--font-weight-title`, `--font-weight-body`, `--letter-spacing-title`, `--type-scale` (0.94, 1, 1.06) | the `@theme inline` text utilities; `--font-size-*` become `calc(base * var(--type-scale))` |
| Density | `--density-scale` (0.88, 1, 1.12) feeding `--space-*`, `--row-height`, `--nav-row`, `--control-height` | List, Sidebar rows, PromptBar, Button control sizes |
| Shape | `--radius-card`, `--radius-thumb`, `--radius-pill` (999 or equal to card for a squarer Look), `--tile-aspect` (auto, 1, 16/9) | Card, tile, Button, Input, CardGrid |
| Surface | `--surface-step` (percent mixed into `--surface-1` and `-2`), `--hairline-alpha`, `--card-edge` (none, hairline, shadow), `--glass-blur`, `--shadow-card` | the `--surface-*` derivations, Card, PhoneNav, header |
| Nav | `--nav-active` (pill, edge), `--rail-icon-size`, `--nav-group-label` (caps or normal) | AppRail, Sidebar, PhoneNav through `body[data-nav-active]` set by `useLook.ts` |
| Motion | `--motion-pill`, `--motion-fade`, `--hover-lift` (0 or 2 px) | the parts that already read `--motion-pill` |

Where it lives and how it composes: the class `body.style-<look>` already exists and is set before first paint by `firstPaintPalette.ts`, so a bundle paints on frame one with no extra plumbing except fonts. Fonts: self-host woff2 in the kit (Inter, Fraunces and IBM Plex are OFL; the install path, not vendoring, per RELEASES-AND-DEPENDENCIES) and preload the Look's family from the first-paint cache so there is no swap. Light and dark stay the orthogonal `html` class. Ease must win over the Look: density is `calc(base * var(--density-scale) * var(--ease-spacing-scale))`, so the generator's `html[data-ease-*]` blocks set only the ease factor and never a final value; the child mode block (KID-MODE-02) does the same, so a child's 52 and 76 px targets survive every Look. Contrast and the no-fixed-colors rule: a bundle holds no color literal, so `fixedColors.test.ts` and `appearance-contrast.test.ts` are untouched; extend `looks-resolution.test.ts` to assert, per Look times scheme, text sizes at or above the floors, hit areas 48 or more at every density, hairline alpha visible, and glass text pairs still AA over a worst-case backdrop (the fixed `--art-*` pair already decided).

Three example Looks (every Look keeps its own color roles; a bundle is the same in light and dark, which is why Studio reads as Artlist in dark and as Runway in light):

| Token | Studio (Artlist dark, Runway light) | Soft (Apple-like) | Editorial |
|---|---|---|---|
| `--font-sans` / `--font-display` | Inter / Fraunces italic (one word) | SF-style system sans / none | IBM Plex Sans / Fraunces |
| `--font-weight-title` / body | 400 / 400 | 700 / 400 | 600 / 400 |
| `--letter-spacing-title` | -0.03em | -0.01em | 0 |
| `--type-scale` | 1 | 1 | 1.06 |
| `--density-scale` | 0.9 | 1 | 1.1 |
| `--radius-card` / thumb / pill | 12 / 8 / 999 | 20 / 12 / 999 | 4 / 4 / 6 |
| `--tile-aspect` | auto (masonry) | 1 | 16/9 |
| `--surface-step` | 5 percent dark, 3 percent light | 8 percent | 0 (page and card equal) |
| `--card-edge` | none | none | hairline |
| `--hairline-alpha` | 8 percent | 6 percent | 14 percent |
| `--glass-blur` | 14 px | 24 px | 0 (solid) |
| `--nav-active` | edge | pill | underline text |
| `--hover-lift` | 0 | 2 px | 0 |
| `--motion-pill` | 150 ms | 220 ms | 0 ms |

The one Studio value that differs by scheme is `--surface-step`; it is written as `light-dark(3%, 5%)` so it stays one definition. Prototype first: the Studio bundle only, on Neutral, on two screens (Media home as hero plus grid in dark, the front page as composer-first in light), captured at 1440x900 and 402x874 beside artlist-8 and the Runway guest home. If those two read as their targets, the bundle mechanism is proven and every other screen follows by parts, not by hand.

## E. Fastest path: ordered slices

Each slice ends in a scripted capture (`scripts/screenshot.ts` already does 1440 and 390 with `--look-review`; add a 402x874 phone size and an `--artlist` screen set) laid beside the named target by a second agent returning pass or fail per difference.

| # | Slice | Result on screen | The one check |
|---|---|---|---|
| 0 | ARTLIST-BASE-00 (Home) | Today's six screens captured at both sizes, plus a saved capture of the Runway guest home at 1440 (public page, no sign-in) as the light target | 13 PNGs in `data-scratch/screenshots/artlist-00`, opened and judged |
| 1 | LOOK-BUNDLE-01 (commons, spec) | `looks.json`, generator, Studio bundle, fonts, resolution test | Kit tokens page capture: title 40/400/-0.03em, card radius 12, sidebar row 36, measured by computed style |
| 2 | STUDIO-HOME-01 (Home) | Front page composer-first (title line, `PromptBar`, chip row, one shelf); Media home as hero plus "Yours" grid with `headerOverArt` on | Front page 1440 light beside the Runway home; Media home 1440 dark beside artlist-8 |
| 3 | STUDIO-COMPOSER-01 (commons, Home) | `PromptBar layout="studio"` (three zones, reference tiles) centered on Music, Video and Pictures create | Music create 1440 beside artlist-7; 402 for cramp |
| 4 | EXPLORE-GRID-01 (commons, Home) | Masonry, name-on-art tile, lead "Upload your own" tile, glass segmented control, floating composer; on Library pictures and the cast page | Library 1440 beside artlist-9 |
| 5 | ART-FALLBACK-01 (commons, backend) | Section F: no gray box anywhere, cover job for made items, seeded demo art | Media home on seed data at both sizes: zero `safe-image-fallback` icon boxes |
| 6 | STUDIO-CHROME-01 (commons, Home) | Grouped app column (group labels, 26 px rows, edge marker), glass round Back on detail pages, 36 px circle companion avatar (`Routes.tsx:301` is 48 px square today) | Music browse 1440 beside the left column of artlist-7; S3 rail test green |
| 7 | STUDIO-EDITOR-01 (commons, Home) | Photo editor: canvas, floating bottom toolbar, right pane tabs, glowing empty state | 1440 beside artlist-6 |
| 8 | STUDIO-PHONE-01 (Home) | `PhoneNav surface="glass" inset="pro"` on every app, floating composer, hero under the top row | 402x874 Home and Library beside the mockup redrawn from artlist-9 (Artlist has no phone shot; one must be made) |
| 9 | LOOK-BUNDLE-02 (commons, Home) | Soft and Editorial bundles, Look picker previews from `looks.json` | Three captures of the same Media home differ in font, radius and density by computed style |
| 10 | ARTLIST-SHIP-01 | Default appearance decision applied, ship, live check | Live hub capture equals the slice 9 capture |

Rules that must change (only Jesse): **S1** if the main apps go into the floating phone bar (slice 8 keeps sections only until then). **S2** needs his reading that hero art may sit behind the transparent top row (build map decision 6, still open), and, if the Studio home carries no page title in the row (artlist-8 has none), the "title on the left" sentence. Nothing in the 2026-10-19 color rule changes. Not rule changes but needed rows: `UI-DECISIONS.md` for masonry layout and the floating toolbar (rule 9b).

Decisions for Jesse (short): dark Look default for everyone or keep system (Artlist is dark, Runway is light, so this is taste, not evidence); yellow accent or the cream pill as the one primary make button; self-hosted fonts (Inter, Fraunces, Plex) or system fonts only; S1 phone bar; S2 hero reading; compute budget for a cover picture per made song and clip.

## F. The art problem

Artlist looks image first because every item is an image; Runway too, but its home does not depend on it: the composer leads and the pictures are a shelf of samples under it. That is the first answer for a household with little art. For the screens that are image first, Home's items are songs, chats, lists and seed rows, so they need three layers, in this order:

1. **Real art when it exists.** Pictures, clips, companion portraits, family avatars and podcast covers are real images today. Lead with them: the Studio home hero is the person's latest made picture or their companion, never a song.
2. **A made cover for every made item.** When a song, album, clip or project is created, queue one low-priority picture job (the pictures role already exists; owner only, rule 6a) for a 512 px cover from the item's own prompt, stored as `artwork_url`. Chat threads get the first picture in the thread. Until the job ends the tile shows layer 3, then fades in (150 ms). This is the one thing that makes Home's own output the art, like Artlist's.
3. **A fallback that is still a picture.** Replace `SafeImage`'s gray box with a seeded cover: two of the Look's own accent hues mixed by a hash of the title (tokens, so a Look recolors it), a soft radial glow, fine grain, a small kind glyph bottom-right, and the name bottom-left exactly as on a real-art tile. In a masonry the fallback picks its aspect from the kind (song 1:1, clip 16:9, person 3:4) so the grid still staggers. This is what the mockups drew; it is right as the floor, wrong as the headline.

Two more fixes: ship the demo household with real CC0 cover images in `scripts/seed.ts` (the fixture art folders `frontend/public/setup-art` and `chat-art` already exist) so screenshots and the dev hub never show the floor; and never render an empty shelf or a text-only empty state on a browse page, show the lead "Make your own" soft tile plus the cast or sample tiles instead (artlist-9's first tile).

## G. One look on every screen (Jesse, 2026-11-11, after the review)

"This look and feel needs to carry across every screen: home page, weather, settings, etc. We can't have different UIs or looks."

How the plan enforces it:
1. The look lives only in the shell (one grouped sidebar, one header treatment, one back button, one composer) and in the Look bundle tokens. A page may not carry its own chrome, colors, radii, fonts or spacing.
2. Route inventory: every route in the app (Home, Chat, Media and each media app, Library, Family, Weather, News, Reminders, Settings and each Settings page, Setup, Sign-in, Activity, Status, Repairs, package pages) is listed in one file with the kit parts it uses.
3. Capture sheet: one scripted capture of every route at 1440x900 and 402x874 per Look, opened and judged; a route that is not in the sheet fails the gate.
4. Lint gate (shrink-only baseline, like the PRO-LOOK lints): no page-level font, size, radius, color or spacing utilities outside the tokens; no page-level header or back button; any new page must use the shared page frame.
5. Slice order changes: the shell, page frame and bundle (slices 1, 6) land before any single page; Weather, Settings, Setup and Sign-in join the sweep (new slice 9a) before the live ship (slice 10).

## H. Artlist's expanding sidebar and settings page (Jesse's screenshots 11 to 13, 2026-11-11)

Seen: the same left column in two states. Expanded (about 280 px): brand, a fold button, Home / Library / References, small group labels "Generate" and "Tools", icon plus label rows, a link out at the foot. Collapsed (about 56 px): brand mark and the same icons only, groups split by hairlines. The page sits in a rounded inset canvas. Settings ("My Account") is a second column inside the canvas (title, one pill-highlighted row per page, a promo card pinned at the bottom) beside a single reading column with plain labels, hairline cards and one yellow pill.
Meaning for us: S1's "rail never expands, no labels, no fold control" is replaced on desktop by an expandable grouped sidebar that collapses to the 56 px icon rail (state remembered per person). Settings pages use the same two-column pattern. This needs the desktop S1 edit; Jesse's words are the record.

## I. More references (screenshots 14 and 15, 2026-11-11; ten screenshots, not committed)

- artlist-14 (music library, collapsed rail): a row of five hero tiles (one wide with a serif headline and a white pill, four with name on art), a plain filter row (Genre, Mood, Video Theme, Instrument as text with chevrons, a Highlights switch, Sort, Filters), then rows with 56 px square art, play, title plus muted artist, a genre column, duration, a waveform, and trailing icons; one row lit as hover; a docked player across the bottom of the canvas with the same waveform. Search is a pill at the top left of the rail column.
- artlist-15 (chat/agent): a second column inside the canvas for "New chat" and a "Chats" list, then a centered serif-accent title ("What would you like to create today?", one italic word), a large rounded composer, and a 3 by 2 grid of quiet action cards (icon in a circle plus a label). One yellow pill is the only color.
Meaning for the plan: Music browse and Library lists use this row pattern (waveform column is optional); Chat keeps a history column inside the canvas but in the one shared style; Home's composer-first page uses the 3 by 2 action card grid for "what can I do"; one display-serif accent word per page title is a Look token (`--font-display`).

## J. The rail changes for the open app, only when needed (Jesse, 2026-11-11)

Seen across the ten screenshots: the left column is not one fixed thing.
- Toolkit and Account pages: the full app list (Home, Library, References; Generate group; Tools group).
- Studio pages (artlist-8, 9, 10): the same slim column now holds that studio's own modes (video, characters, locations, 3D, scenes) and a brand mark, with "Explore / My / History" as a segmented control on the page.
- Chat page (artlist-15): the slim app rail stays and a second panel appears beside it (New chat, Chats) only because chat has a list to show.
- Music library (artlist-14): the slim rail only, search as a pill at its top; no second panel because the page needs none.
- Settings (artlist-11, 12): a second panel with the pages of Settings; the rail can be expanded or collapsed.

Proposed rule shape (to be written into S1 when Jesse confirms; his observation is the record): one shell column with three states. (1) Global: the app list, grouped, expandable or collapsed. (2) Context: when an app has its own modes (Create, Photo editor, Settings) the column shows those modes and a clear Back or Home control at the top that returns to the global list; it is never the only way to switch apps. (3) Panel: an app that has a list (chat threads, settings pages, playlists) opens a second panel beside the column, in the one shared style; an app with no list opens none. The app picks its state from a declared field in its manifest, not by drawing its own navigation (rule 9b), so every screen still reads as one product.

## K. Motion, instant feel, and one real composer (Jesse, 2026-11-11)

1. **Rail auto-collapse.** Opening a screen that needs a panel beside the column (chat threads, settings pages) collapses the global column to icons, and the panel slides in; leaving restores the person's own expanded or collapsed choice. One animation (about 200 ms, ease-out, width and opacity only), driven by the same state as section J. Respect reduced motion (instant).
2. **Never flash, never wait.** Every click animates from the current view to the next; no blank screen, spinner page or layout jump between routes. Build rules: route changes use view transitions (cross-fade the canvas, keep the shell still); the shell, columns and composers are mounted once and never remount on navigation; each route prefetches its data on hover or focus and on idle for the visible links, and renders from the query cache first (the tab-return cache already persists lists for 30 minutes; extend it to a stale-while-revalidate default); loading shows the final layout with quiet placeholders of the real size, never a centered spinner; actions are optimistic (a like, a pin, a send shows at once and reconciles). A gate in the capture script records layout shift and the time to first painted content for every route and fails a route that flashes (blank frame) or shifts.
3. **One composer, not parts in a box.** Artlist's Image, Video, Voiceover, Music and Chat inputs are the same component with a mode that changes its zones (reference tiles, option pills, primary button label), not a container with loose dropdowns and buttons. For us: one kit `Composer` (the existing `PromptBar` grown into it) with a declared mode schema: `modes: { image, video, voice, music, chat }`, each listing its reference slots, option pills (model, ratio, length, style) and the primary action, all rendered by the same three zones (attachments row, text area, option and action bar), the same focus ring, the same floating placement, the same keyboard behavior (Enter sends, Shift+Enter newline, @ mentions). Pages pass a mode and handlers; they cannot add their own controls inside it (rule 9b: no wrappers, no className overrides). Chat's composer stays the assistant-ui Element (rule 9), fed by the same mode schema so it looks identical.
Slice impact: new slice 3a "COMPOSER-01" before Music, Video and Pictures create (they are three copies today); motion and prefetch become slice 1b (shell and transitions) and a gate in every later slice.

## L. Mode switch inside the composer, grouped rail, thumbnail Activity (Jesse, 2026-11-11, three more screenshots)

1. **One composer, switched in place.** The composer carries its own mode menu at its bottom-left (a pill showing the current mode with an icon, opening a small glass list: Image, Video, Voiceover, Music, 3D). Picking a mode changes the zones in the same component (the reference tiles, Start and End Frame for video, the option pills such as model, size and length, the primary label); the text and attachments stay. So Create is one page with one composer, not four pages. In Home this is `Composer mode` with the five modes plus Chat, and the mode is also reachable from the rail's Create group.
2. **Grouped rail.** The left column is split into groups by hairlines; the first group has no heading (Home, Library, References), the lower groups have small muted headings (Generate, Tools). Collapsed, the headings disappear and the hairlines stay. Our groups: Main (Home, Chat, Media, Library, Family), Create (Pictures, Video, Music, Voice, Edit), then Tools or Household as needed. Group membership comes from each app's manifest, not from page code.
3. **Activity with pictures and live work.** A bell in the header opens a glass popover titled Activity. Finished items show a thumbnail, a title ("Image ready", "Video ready") and the prompt as a muted one-liner; a click opens the item. Running work shows at the top with a progress bar and the step ("Generating Shot 2...") and the project name on the right; the bell carries a count badge while work runs. This is the "making now" surface already in the PRO-LOOK build map (JOB-01 and ACTIVITY-01) in Artlist's shape: thumbnail rows, live progress first, quick access to the result. It reads the same job store the progress strip reads; no second list.
Slice impact: COMPOSER-01 gains the mode menu; STUDIO-CHROME-01 gains the grouped rail and the Activity popover (with the thumbnail rows); the Activity page (S6 option i) is the same surface when Jesse wants a full page.

## M. Loading placeholders (Jesse, 2026-11-11)
Artlist shows soft pulsing boxes where tiles and rows will appear while a page loads (seen once). Our version: every shelf, grid, list and hero shows placeholder boxes of the final size and shape (tile aspect and radius from the Look), pulsing slowly (a 1.2 to 1.6 s fade between two surface steps, tokens only), never a centered spinner and never a blank frame. The kit already has `RouteSkeleton` (hidden for its first 200 ms so a fast load never flashes one); extend it into a `Skeleton` part used by `MediaShelf`, `CardGrid`, `List`, `Billboard` and the new masonry. Reduced motion or the ease motion setting turns the pulse into a static box. Gate: the route capture records the first frame and fails a route whose first frame is blank or whose placeholders differ in size from the loaded content (layout shift).

## N. Rail proportions and the brand-to-expand swap (2026-11-11)

See section N in the review above where present; in short: a very narrow collapsed rail with small, loosely spaced icons in hairline-split groups; at the top the brand mark turns into the expand icon on hover or focus when collapsed (cross-fade, instant under reduced motion, accessible name "Expand navigation"); target about 48 px visible width with 18 px icons at the standard ease step, keeping the 48 px hit area through padding that does not widen the rail.


## O. Checkpoint 1 (Fable, 2026-11-11)

### (a) On track?

Partly. The token layer is right: bundle per Look, no color in it, 12 px cards, density 0.9, title weight from the Look. The two screens are not the design yet; both read as the old app with new tiles. Three drifts:

1. The composer is not the page (B, C, K). Home still leads with a 40 px greeting, a subtitle and the Repairs card; the ask is a one-line input at 8 of 12 columns, left aligned, with text-link chips. Artlist-15 is one title line, a centered 690 px three-zone card, then a 3 by 2 quiet grid. Ours is 3 plus 2 because "Edit a picture" was filtered out.
2. Name on art lives in the fallback only (F). Only fallback tiles carry the name; every tile with seed art shows a caption underneath. The seed art is a circle-and-hatch placeholder, worse than the fallback.
3. Chrome unchanged (A1, A2, G): bordered header row, 56 px rail plus a bordered Media column, no hero on Media home. This is what Jesse means by one look everywhere, and nothing on screen shows it yet. The built rail and Activity parts are right; they wait on the S1 edit.

### (b) Next three slices

1. STUDIO-HOME-01b: one title line, PromptBar `layout="studio"` centered at 690 px, a fixed 3 by 2 grid, Attention below the grid. Check: 1440 dark beside artlist-15, composer width and centering by computed style.
2. STUDIO-TILES-02: label scrim moves from SafeImage to the tile (MediaTileOverlay `label`); seed real CC0 covers; Billboard hero on Media home. Check: zero captions under tiles, one hero, no placeholder art.
3. STUDIO-CHROME-01 after the S1 edit: grouped sidebar replaces rail plus app column, header border 0, Activity bell wired. Check: Media home beside artlist-8, one left column, header border 0 by computed style.

### (c) Change before more screens depend on it

- Card must read `--card-edge` (bundle says none; the action cards draw a hairline). Kit fix, not per page.
- Move name-on-art off the SafeImage fallback path now, or every page passing `label` gets redone.
- Replace the seed placeholder PNGs before any capture is judged.
- Not verified: that `--space-*` and row heights consume `--density-scale`, and that Inter and Fraunces are served.

## P. The Home front page (Fable review, 2026-11-11)

Owner: the front page should give quick access to common things and information, inspire and inform, and let people customize the order and what they see; Artlist's front page is a hero then shelves of real pictures, not a chat box.

Summary
1. The shipped page is a chat landing, not a home: a composer, six icon buttons, status cards, not one picture.
2. A hub front page shows what is here, art first, and gets you to the next thing in one tap. The composer is a tool on the page, not the page.
3. Order: art hero, composer pill with a mode menu, Make shelf (name on art), Continue, Today module (ranked rows plus preview), library shelves, Family and companions, admin cards last.
4. Every section has data today except covers for songs and chats (ART-FALLBACK-01); rule 6a forbids ranking other people's plays, so news is the chart.
5. Keep Arrange and `ui.home_layout`; Arrange grows from Today cards to sections (reorder, hide, pick the hero), with role defaults below.

### A. Is it the right idea?
No. Runway leads with a composer because generation is its only product; Home's products are the family's things. The complaints in code:
- Limited composer: `AskBox` is a plain `Input` that navigates to `/chat?ask=`; the kit `PromptBar` mode menu (KIT-COMPOSER-MODE) is unused.
- Empty-chat buttons: `ActionCards.tsx` sends "Make a picture" to `/chat`, "Ask or plan" only focuses the box, the rest are bare links.
- Not appealing: every tile is an `IconTile`, while the hub holds portraits, made pictures and clips, covers, avatars and a weather scene.

### B. What people come for, most often first
1. Pick up where I left off.
2. Ask or make something (age gates apply).
3. Today: weather, next up, timers, shopping.
4. What is new or made at home.
5. News (never a child).
6. People and companions.
7. House devices.
8. Look after the hub (owner, admin).

### C. Recommended page
| # | Section | Kit part | Data today |
|---|---|---|---|
| 1 | Hero: picture, eyebrow, title, one pill | `Billboard size="banner"` | latest `made_at_home` picture or clip, else companion, weather scene, news lead |
| 2 | Composer pill, mode menu, three starters | `PromptBar` | `STARTER_SUGGESTIONS` |
| 3 | Make shelf, tall tiles, name on art | `MediaShelf aspect="poster"` plus label slot | latest made item per kind, else seeded cover |
| 4 | Continue, square tiles with progress | `MediaShelf aspect="square"` | `/api/continue`, `media/home.continue` |
| 5 | Today: ranked rows left, preview right | `List` index slot, `WidgetCard`, `weather-card` | the widgets: weather, next up, shopping, timers, news, devices |
| 6 | New in your library, Made at home | `MediaShelf` square, See all | `media/home.new`, `.made_at_home` |
| 7 | Family and companions | `Avatar` row, `CharacterTile` | `/api/people`, companions |
| 8 | Hub care, Getting started | `StatusCard` | repairs, updates, setup |

Above the fold at 1440: sections 1 to 3; phone: a shorter hero, the pill, the Make shelf peeking. The composer is one pill, not a 180 px box. A Make tile opens its studio with the mode preselected and starters shown (`/pictures/create`, `/apps/videos/create`, `/apps/audio/create`); "Ask or plan" opens Chat with starter text filled, never blank. A mode chip sends the prompt to that studio.

### D. Pictures
Real first: made pictures and clips (`artwork_url`), companion portraits, avatars, podcast and book covers, news images, the weather scene. Floor: the seeded gradient cover with the name on it (KIT-ART-FALLBACK), never the gray box. Missing: covers for songs and chats; ART-FALLBACK-01 item 2 (one low-priority picture job per made item) fills it. Seed the demo with CC0 art.

### E. Look rule
All parts exist. Additive props only: `MediaTileOverlay label`, a ranked index slot on `List`, Billboard hero-source wiring. No new status UI; admin cards stay the S6 `StatusCard`. Tokens only.

### Customization
Keep `ui.home_layout` (shelves, ask, board) as presets of one section list and the Arrange sheet (`/api/widgets/home/arrange`: order, hidden, reset), grown to sections: reorder, hide, pick the hero source.

| Section | Adult | Teen | Child |
|---|---|---|---|
| Hero | latest made | companion | companion or weather |
| Composer, Make | on | gated modes hidden | cartoons only |
| Continue, New, Made | on | on | own items |
| Today | on | no shopping | weather, timers |
| News rows | on | if lists on | not offered |
| Family, companions | on | on | on |
| House devices | on | off | not offered |
| Admin cards | on | not offered | not offered |

### F. Build order
1. HOME-HERO-01: Billboard banner with the hero source picker. Check: seeded capture at 1440 and 402 shows art, zero `safe-image-fallback`.
2. HOME-COMPOSER-02: PromptBar mode menu plus the Make shelf. Check: a test asserts "Make a picture" lands on the Pictures create route, not `/chat`.
3. HOME-SHELVES-02: Continue, New, Made at home on the seeded cover. Check: no gray box on seed data.
4. HOME-TODAY-02: ranked rows plus preview. Check: five ranked news rows with a preview on the seeded feed.
5. HOME-ARRANGE-02: sections, hero source, role defaults. Check: a child loads without News and admin; a saved order survives reload.

## Q. Build state (2026-11-12)

Live on the hub: Look bundles and title wiring (kit 0.5.592 to 0.5.600), one-line titles, a hero, a composer pill with a mode menu, the Make shelf, name-on-art tiles with seeded covers, the Media hero. Held for the owner's word: the Today ranked list and the Arrange sheet that manages sections. Built in the kit, unused by Home: the expanding grouped rail, the Activity popover, self-hosted fonts (parked on a flaky kit test). Blocked: the RULES.md edit for the phone bar, one shared look and the expanding rail, which only lands through the full suites (the rush route refuses rule edits).
