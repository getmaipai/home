## Home's pages under the kit (added 2026-09-20)

The owner's ruling (2026-09-20): MaiPai Home follows this
specification's look and feel exactly: the shell, the colors, the
icon tiles, the panel headers, the header, the footer, the pane
headers, the type, the density, the spacing, not only its tokens. The
Overview reference image is the standard for how everything looks.
What Home does NOT copy is the reference's content: its menu items,
its metrics and its pane contents were the Stack console's; Home's
own navigation, routes, records and actions fill the same patterns.
The sections below say what fills each pattern on each Home route;
the exact item lists there are the intended Home content, and where
this section is silent the reference image and sections 2 to 6
decide the treatment.

### The style, exactly

This is the part that is not negotiable and not "in the spirit of".
Every element on every Home page is drawn the way the reference
draws it, and section 1's tokens are the only source of color:

- **Icon tiles.** Every icon that labels a card, a row, a metric, a
  nav group heading or a pane header sits on a 40 px (32 px in rows)
  rounded tile (12 px radius) filled with the element's accent at 18
  percent over the panel and a 1 px border of the same accent at 35
  percent, the icon itself in the accent at full strength; the tile
  carries a soft outer glow of the accent (`0 0 16px` at 25 percent).
  The accent follows the element's kind: blue for models and apps,
  violet for people, adapters and the profile, teal for healthy and
  running, orange for storage, workflows and attention, pink for
  images, red for errors. Never a bare lucide icon on the canvas.
- **Cards and panels.** Panel background over the canvas, 16 px
  radius, 1 px border, the panel shadow from section 1, 16 px inner
  padding, 12 px between cards. Metric cards: the icon tile at the
  left, the number at 28 px semibold with tabular figures, the label
  at 13 px medium, the status line at 12 px in the status color with
  its arrow or dot. Panels: a header row with the icon tile, the title
  at 16 to 18 px semibold, and the right-aligned link in electric blue
  with an arrow; a hairline under the header; rows inside at 13 to 14
  px with 12 px vertical rhythm.
- **Type.** Titles semibold, never regular; the page title 28 to 32 px
  with its subtitle in secondary text at 14 px; section and card
  titles 16 to 18 px semibold; labels 13 px medium; supporting text 11
  to 12 px secondary. Sentence case everywhere; no uppercase eyebrow
  lines (the old "MADE FOR YOUR EVERYDAY" style is gone).
- **Pills and badges.** Status pills 999 px radius, a 6 px dot plus
  the word, tinted with the status color at 15 percent and text in
  the color (Running and Ready in teal, Attention in orange, Error in
  red, Idle in secondary). Type badges are the same shape without the
  dot, tinted with the kind's accent (LLM, Runtime, Image App and so
  on in the reference; App, Plugin, Person, Memory, Engine in Home).
- **Bars and charts.** Progress and resource bars 8 px tall, 999 px
  radius, the track at border color, the fill in the element's
  accent; sparklines in the accent with a translucent area fill under
  the line, no axes, no gridlines.
- **Buttons and links.** Primary buttons filled with the electric
  blue, 12 px radius, 36 to 40 px tall, semibold label; secondary
  buttons as raised panel with a border; row actions as an icon-only
  overflow button; "View all" and "Browse all" as blue links with a
  trailing arrow, right-aligned in their header.
- **Navigation.** The active item filled with violet (the gradient
  from section 1's violet to its deeper stop), white text, 10 px
  radius, inset from the rail edge; inactive items in primary text
  with the icon in secondary; group labels 11 px uppercase secondary
  with letter spacing. The product mark on a gradient tile (blue to
  violet) with the product name bold and the tagline under it.
- **Header and search.** The header on the sidebar surface with a
  hairline below; the search field a raised-panel input with a 12 px
  radius, the search icon inside at the left and the ⌘K pill at the
  right; the avatar a colored circle with initials and a 2 px ring in
  its accent; the bell's count a red badge with white digits.
- **Depth.** Two surfaces only, canvas and panel, plus raised panel
  for hover and inputs; borders always 1 px at the border token; the
  soft glow reserved for icon tiles and the active nav item. No flat
  black, no gray placeholder cards, no drop shadows on text.
- **Light theme.** The same system on section 1's light values: the
  tinted canvas and sidebar, white panels, the same accents, the same
  tiles and glows at lower opacity. Light must look like the same
  product as dark, one design, two palettes.

### The shell, exactly

- **Rail.** Top: the product mark as an icon tile (the MaiPai Home
  glyph on the rounded gradient tile, 40 px) with "MaiPai Home" and
  the tagline "Your AI. On your terms." in secondary text under it.
  Then groups with small uppercase labels: **Home** (Home, Chat,
  Apps), **Household** (People, Memories, Lists), **Manage**
  (Engines, Packages, Updates, Repairs, Backups), **System**
  (Settings, Privacy, Logs). Each item: a 20 px lucide icon and the
  label, 40 px tall, inset 8 px from the rail edge, 10 px radius; the
  active item is the violet fill with white text, exactly the
  reference's shape (never a full-width square bar). Items a person's
  role cannot open are absent, not disabled. Bottom: the **hub card**
  (the reference's machine card): the hub's name, the OS and version,
  a status dot with "All systems healthy" or the count of open
  repairs, tapping opens Repairs. Collapsed rail: icons only, 48 px
  targets, tooltips, the hub card becomes its status dot.
- **Header.** Left: the current destination's title (28 to 32 px
  semibold) and its one-line subtitle in secondary text, both from the
  route's declaration (section "Current destination header rule").
  Center-right: the search field, a real input 360 px wide with the
  search icon and the ⌘K pill (the palette opens on focus or ⌘K; on
  the phone the field collapses to the header's search icon). Right:
  theme toggle (sun or moon icon button), the bell with its unread
  count badge in red, the avatar with the person's name and the menu
  (Profile, Preferences, Help, Sign out), exactly the reference's
  order.
- **Footer.** A fixed 40 px status bar on desktop and tablet: left
  "MaiPai Home v<version>"; center "<n> updates available · <n>
  engines running · <n> repairs open" as links; right a status dot
  and "All systems operational" or the worst open problem's title.
  Hidden on the phone (the tab bar takes that edge).
- **Pane header.** Every right pane (details of a package, a person,
  an engine, a memory) opens with the reference's pane header: an
  icon tile, the name, the type badge, the status pill, then the
  action row (primary, secondary, overflow), then the sections in
  panel cards. The pane is 400 px on desktop, a sheet on the phone.

### The dashboard (route `/`, title "Home", subtitle "Good morning,
<name>. Here is your household today.")

Composed as the reference's Overview, top to bottom:

1. **Metric row**, four cards, each a colored icon tile, a big
   number or state, a label, and one status line: **Chat** (ready or
   the reason), **Voice** (listening and speaking ready), **Updates**
   (count available, "View updates" link), **Repairs** (count open,
   "All good" in teal when zero). Blue, violet, teal and orange tiles
   in that order.
2. **Panel row**, two panels: **Today** (the weather line with its
   icon, the next event or reminder, the date) and **Recent
   memories** (a list of the last five, each a row with the memory
   glyph and a relative time, "View all" in the header). Panel
   headers carry an icon, the title and the link, exactly as
   "System Resources" and "Active Components" do.
3. **Your apps**, the installed-components strip: one tile per
   pinned app with its icon tile and a count or state line, "Browse
   all" in the header; the card-size slider stays as the strip's
   density control.
4. **Household row**, three panels: **People** (avatars with names,
   who is home), **Activity** (the last five events: a chat, a
   package added, an update applied, with colored dots and times),
   **Quick actions** (Ask MaiPai, Add a person, Check for updates,
   Open Repairs as icon tiles).
5. The **ask box** is not a page element: asking lives in the header
   search field (the palette answers with chat) and in Chat.

### Apps (`/apps`, "Apps", "Everything installed on this hub")

The things page: the filter column (kind, category, state), the
things table or grid with icon tiles, type badges and status pills,
the details pane with the pane header, Install and Remove as pane
actions. The store is the same page with "From the catalog" as a
filter, never a second screen.

### People (`/people`), Memories (`/memories`), Lists (`/lists`)

Things pages in the same pattern: a row per person with avatar, role
badge and presence pill; a row per memory with its kind badge and
time; a list as a panel of rows with checkboxes. Each opens its
details pane.

### Engines, Packages, Updates, Repairs, Backups (Manage)

Engines is the Stack's page (HOME-STACK-04): the metric row (tier,
memory in use of budget, engines running, updates), the components
table with type badges and status pills and the per-row actions
(Start, Stop, Restart, Install, Remove), the details pane with the
engine's settings rendered by the settings renderer. Updates and
Repairs are the reference's "Updates & Recommendations" panel grown
to a page: one row per item with the icon tile, the text, and the
one action. Backups is a panel of the last runs and one action.

### Settings (`/settings`) and Privacy (`/privacy`)

The settings workspace from this specification (section "Settings
workspace reference"): the section list on the left, the form on the
right rendered from the declaration, the three disclosure levels as
the workspace's own toggle. Privacy is one page of panels, the
"what leaves the house" table as a things table.

### Phone

Everything above collapses as section 7 and "One product on every
screen" say: the rail becomes the tab bar (Home, Chat, Apps, More),
the metric row becomes a 2 by 2 grid, panels stack, the footer is
gone, panes are sheets, the header keeps the title, the search icon,
the bell and the avatar.

### Acceptance for each page

A capture at 1440 and 390, light and dark, placed beside the
reference image and judged: the same header, rail, footer and pane
header; metric cards and panels with icon tiles, headers and links;
type badges and status pills where the reference uses them; 12 px
gaps and 16 px padding; nothing hand-drawn outside the kit's blocks.
A page that looks like the old Home page with new colors fails.

### Two looks, one setting (owner ruling, 2026-09-20 15:40)

After HOME-UI-01 and 02 the owner placed Home beside the reference
and judged it "nice, not a match". His ruling: keep what shipped as
one look, **Calm**, and build a second look, **Studio**, that matches
the reference image exactly; a person picks the look in Appearance
(Settings, "Look": Calm or Studio, per person, remembered), and the
hub's default is Studio. Both are the same components; the
difference is a theme, so every item below is a token or a variant
the kit already owns, never a second component:

- **Icon tiles.** Studio: rounded squares (12 px radius, 40 px;
  32 px in rows) with the tinted fill, the border and the glow of
  "The style, exactly". Calm: the circles that shipped. Token:
  `--tile-radius`.
- **Product mark.** Studio: the logo on a 40 px gradient tile (blue
  to violet, 12 px radius) beside a bold 18 px product name and the
  tagline in secondary text, exactly the reference's top-left. Calm:
  as shipped.
- **Rail.** Studio: group labels 11 px uppercase, letter-spaced,
  secondary text, weight 600, with a hairline divider above each group
  (the reference's "System", "Resources", "MANAGE" lines); 40 px items
  with 8 px vertical rhythm and 20 px icons; the active item filled
  with the violet-to-deeper-violet gradient, 10 px radius, inset 12 px
  from the rail edge, white text and icon. The rail background one
  step lighter than the canvas. Calm: as shipped.
- **Header.** Studio: the page title at 32 px semibold with the
  subtitle at 14 px directly under it; the right cluster is three
  equal 40 px controls (theme toggle, bell with its red count, the
  avatar) separated by a 1 px vertical hairline between the toggle
  and the bell, exactly the reference; the search field 400 px wide
  between title and cluster. Calm: as shipped.
- **Canvas and content width.** Studio: the content area fills the
  pane edge to edge with a 24 px gutter and no max-width column (the
  reference has no dead margins left or right); the canvas carries the
  reference's subtle radial gradient (lighter navy at the top left
  fading to the canvas color) instead of a flat fill. Calm: the
  centered column that shipped.
- **Cards.** Studio: 16 px radius, 1 px border at the border token,
  16 px padding, 12 px gaps, the panel shadow; metric cards lay the
  tile left and the number and label right on one line with the
  status line under, at the reference's sizes (number 28 px); nothing
  inside a card ever truncates: a tile that cannot fit its label at
  the current width drops to the next row (the quick-action tiles
  "Add a pers..." and "Open Repa..." are a defect in both looks and
  are fixed in both). Calm: as shipped except the truncation fix.
- **Type.** Studio: the reference's family (Aptos Display for titles
  where installed, the kit's fallback stack otherwise), semibold
  titles, 13 to 14 px rows, tabular numbers. Calm: as shipped.
- **Footer, pane header, pills, badges, bars.** Studio: exactly "The
  style, exactly". Calm: as shipped.

Acceptance for Studio: the dashboard capture at 1440 placed beside
the reference and judged by the owner's own list (small-cap group
labels with dividers, rounded-square tiles, gradient product tile,
gradient active item, larger title, no dead side margins, equal
header controls with a divider, gradient canvas, no truncated text,
even spacing inside cards); a reader must not be able to tell which
product's console they are looking at from the chrome alone. Calm
stays green on its existing captures. The look is one setting,
declared once, rendered by the settings renderer, applied by the
theme provider the kit already has for light and dark.

### The collapsed rail (owner finding, 2026-09-20 15:53; both looks)

The collapsed rail as shipped is wrong in both looks: a second
expand toggle inside the rail, the product mark as an oversized
circle, icons neither centered nor on one vertical rhythm, the active
item's fill wider than the icon column, the hub card collapsed to a
lone dot in a circle. The rule: the collapsed rail is 64 px wide;
there is exactly one toggle for it, the one in the header (the
header's rail icon expands and collapses; nothing inside the rail
does); the product mark is the 40 px tile centered at the top; each
item is a 40 by 40 px centered target with its 20 px icon centered,
items on a 48 px vertical rhythm, a tooltip with the label on hover
and focus; the active item is the same 40 by 40 rounded square
(gradient in Studio, flat violet in Calm) centered under the icon,
never wider than the item; each group boundary is a 24 px hairline
centered; the hub card collapses to a 40 px tile with the hub icon
and the status dot at its corner, tooltip with the status text. On
the phone the rail does not exist (the tab bar). Acceptance: the
collapsed rail captured at 1440 in both looks and both themes, every
element centered on the same vertical axis.

### Phone density, and conversations inside Chat (owner findings, 2026-09-20 15:57; both looks)

The phone dashboard as shipped is oversized and not the same product
as the desktop: metric cards half a screen tall with 24 px numbers
and empty space, panel rows at desktop size, and text running past
the right edge of the Today and Recent memories cards (a real
horizontal overflow the capture check did not catch: it must be
caught, so the overflow check runs on every panel's content box, not
only the page). Rules for the phone, both looks:

- **Metric cards** in the 2 by 2 grid are compact: 32 px tile, the
  number or state at 20 px semibold on the same line as the label at
  13 px, the status line at 12 px under, 12 px padding, the card no
  taller than its content (about 84 px).
- **Panels**: header row with a 32 px tile and the 16 px title; rows
  at 14 px with 8 px rhythm; every line wraps inside the card's
  content box or truncates with an ellipsis on its own line; nothing
  ever paints past the card edge.
- **Type on the phone**: 20 px page title in the header, 16 px panel
  titles, 14 px rows, 12 px supporting; never the desktop's 28 px.
- **Header**: title left; search, theme, bell, avatar as 40 px
  controls right; the bell's count badge 16 px.
- **Gutter** 16 px, card gap 12 px, section gap 20 px; the page reads
  as one continuous, dense column the way the reference reads on the
  desktop, the same product, smaller.

**Conversations live inside Chat.** "Conversations" is not a
destination of its own: it is Chat's thread list (the chat section:
a persistent column on desktop, a sheet from the header's list icon
on the phone). Remove the Conversations item from the rail and from
the phone tab bar; the tab bar is Home, Chat, Apps, More (People and
the rest under More). The route `/conversations` redirects to Chat
with its list open so nothing bookmarked breaks.

**What retiring the old Conversations page actually cost** (a code
review's own removed-behavior audit, HOME-UI-02d, 2026-09-20): the
deleted page had a person picker for an admin's oversight of a
child's conversations, a multi-select with batch delete and a clear-
all, a per-row pin/unpin, and server-side search across a message's
own body, not just its title. None of the four survived the move -
the new thread list has single-thread delete/rename and client-side
title-only search, nothing else. Ruled not an accepted loss: all four
move into Chat's own thread list, the same surface Conversations
already was, as HOME-UI-02e (right after 02d lands, before 03).

### Navigation, corrected (owner ruling, 2026-09-20 16:20)

Three destinations leave the rail; nothing they held is lost:

- **Privacy** is not a destination. The "what leaves the house" table
  and the privacy switches become a **Privacy section of Settings**
  (the settings workspace's section list: General, People, Chat,
  Voice, Engines, Notifications, Backups, Privacy, Developer, in that
  order), rendered by the same renderer, with the table as a things
  table inside the section. `/privacy` redirects to
  `/settings/privacy`. The user-tier privacy page in `docs/user/`
  stays and describes that section.
- **Memories** belong to a person, so they live on the person's
  profile: People, a person, the **Memories** tab (a things page of
  that person's memories with the kind badge, the time and the
  details pane; keep, edit, forget as pane actions), and for the
  person signed in, the avatar menu's **Profile** opens their own.
  The dashboard's Recent memories panel stays and its "View all"
  opens the signed-in person's Memories tab. `/memories` redirects
  there.
- **Conversations** are Chat's thread list (already ruled above).

The rail is therefore: **Home** (Home, Chat, Apps), **Household**
(People, Lists when Lists ships), **System** (Settings); Engines,
Packages, Updates, Repairs and Backups appear under **Manage** when
their pages exist (HOME-STACK-04 and after), never as placeholders.
The phone tab bar: Home, Chat, Apps, More (People, Settings and the
Manage pages under More).

### The phone composition (owner reference, 2026-09-20 16:25)

The owner supplied a phone reference (a creative-tools app's home
screen; the image is his, not ours to copy pixel for pixel, and its
look is what the phone rules above must produce). What it does, and
what Home's phone does the same way, with Home's own tokens, icons
and content:

- **Header**: the product wordmark at the left (16 px semibold, the
  accent on the second word as the logo does), a small version pill
  beside it, the avatar at the right; nothing else. Search, theme and
  the bell move under the avatar's menu and into the palette on the
  phone; the bell's count shows as a dot on the avatar.
- **Hero card**: one full-width card at the top with the day's
  headline: the ask box as a card ("Ask MaiPai", one line of
  invitation, a primary button) over a soft gradient of the accent
  (violet to blue at 20 percent), 16 px radius, 20 px padding; or,
  when there is something to say, the day's item (a reminder, a
  repair, an update) in the same card.
- **Section headers**: a title at 18 px semibold with a one-line
  secondary subtitle at 13 px directly under it (no icon tile on the
  phone), 24 px above, 12 px below.
- **Shelves**: recents scroll horizontally (recent conversations,
  recent memories as 160 px cards with 16 px radius, one line of
  text and a time), the first card a "+" tile where adding makes
  sense (a new chat).
- **App cards**: a two-column grid of dark rounded cards (16 px
  radius, 16 px padding), each with a 24 px icon top-left, a bold
  16 px title, one 13 px secondary line, and a small badge top-right
  for a state (NEW, UPDATE, OFF) in the accent; the tile's accent is
  the app's kind.
- **Status**: the four metrics of the desktop become one compact
  strip under the hero (four 32 px tiles in a row with a one-word
  state each), not four cards.
- **Density**: 16 px gutter, 12 px gaps, no empty regions; the page
  scrolls as one dense column; the tab bar stays.

Acceptance: the phone dashboard capture at 390, both looks and
themes, read beside the owner's reference for composition (header,
hero, section headers with subtitles, shelves, two-column app cards,
the metric strip) while every color, icon and type comes from the
kit; it must still be recognized as the same product as the desktop.

### The Studio look, the numbers (owner-supplied analysis, 2026-09-20 18:15)

The owner had a second reading of the live Home page against the
reference done outside the org and handed over its conclusions with
a built page that reproduces the reference's geometry. Its product
half (menus, routes, the machine selector) was written against the
Stack's old console and does not apply; its style half does, and
where a number below differs from an earlier estimate in this doc,
this number wins. The palette it names is the one already in the
kit spec (page canvas `#07111F`, sidebar `#0A1A2E`, panel `#102238`,
raised `#142A43`, border `#294563`, text `#F4F8FF` and `#A9BED7`,
blue `#21A6FF`, violet `#A434FF`, teal `#00E3AE`, orange `#FF8A35`,
pink `#FF3E9A`, red `#FF4B62`); Home's Studio look uses exactly these
values, not approximations, and the light theme derives from them by
the kit's contrast rules.

**The shell is fixed; only the content scrolls.** The rail, the
header and the footer never scroll. Rail 252px expanded, 72px
collapsed. Header 96px tall (the title and subtitle block), footer
40px, one row. The content column scrolls between them with 16px top
padding, 24px sides, 20px bottom. Breakpoints: 960 to 1279px the
rail starts collapsed; below 720px the rail is an off-canvas drawer
(the phone shell), never a narrow rail. The page has a soft radial
gradient at the top right of the canvas (`radial-gradient(circle at
65% -20%, #102C4B 0, transparent 42%)` over the canvas color); the
rail has a vertical gradient (`#0B1C31` to `#091827`) and a 1px
border on its right.

**Rail geometry.** Padding 17px top, 13px sides, 14px bottom. Brand
row 62px tall: a 48px mark with the accent glow, the wordmark 19px
semibold with -0.4px tracking, the tagline 11px secondary under it,
14px below the row. Group labels 10px uppercase with 0.08em tracking
in secondary text, 11px above, 7px below, inset 7px. Items: 10px
vertical and 12px horizontal padding, 8px radius, 2px between items,
14px gap between the 19px icon and the 14px label at weight 520
(the kit's medium); hover fills raised; the active item is the
violet gradient (`#3E1BB2` to `#311893`) with a 1px inset ring
`#6E3DF8` and a soft violet glow, white label. Dividers 1px `#24405F`,
12px above and below, inset 7px. Collapsed: icon only with tooltips
and accessible names, dividers kept, labels hidden, the same 72px
column centered.

**Header.** 24px side padding, 22px gap between the title block, the
search and the right cluster. Title 29px with -0.7px tracking and
6px to the 14px secondary subtitle. Search 39px tall, radius 10px,
raised background with the border color, 12px placeholder, the
keyboard hint as a 10px chip; it is a real input (typing filters at
once), and Cmd/Ctrl+K focuses this same input with results beneath
it, never an empty modal. Right cluster: 39px round controls with a
1px border and panel fill, 12px apart; the count badge is 17px, red,
10px bold, at the control's top right. A 1px vertical divider
separates the cluster from the search.

**Cards and panels.** Card radius 12px, 1px border, a 145-degree
gradient fill (`#11243A` to `#0D1C2D`). Metric card: 16px padding,
17px gap, a 57px icon tile with 14px radius and the role's tinted
fill, the value 25px bold, the label 14px, the status line 12px in
the status color 6px under. Panel title row: 17px bold, 12px 14px 10px
padding, a 1px bottom border, the tile 20px in the accent, the
"View all" link 12px semibold in violet. Grid gaps 12px everywhere;
the two-column row splits 44 / 56. Table header 31px, 11px secondary
text; rows 49px minimum, 12px text, name bold with a 10px secondary
line under it; type pills 11px with 5px 9px padding and 7px radius
in the category's tint. Compact tiles (the installed-components
strip and Home's "Your apps"): icon 23px in the kind's color at the
left, a 12px bold label, a 10px secondary line, 10px padding, 10px
radius; eight across at 1440. Quick actions: two columns, 9px gap,
10px padding, 9px radius, raised fill.

**Footer.** Three columns (1fr, 1.2fr, 1fr), 12px secondary text:
the version plain at the left, the counts centered with 16px gaps and
1px separators, each a link to its filtered view; one aggregate
health line at the right with an 11px dot. Never a sensor strip; at
tight widths the version, the update count and the health survive
first.

**Category colors.** Chat and models blue or violet; images pink;
video cyan; audio amber; engines and runtimes blue; workflows
orange; integrations and extensions teal; training violet; system
teal. Home's kinds map onto these once, in the kit's status and kind
maps, never per page.

**States and standards, restated as the kit's contract.** Every
shared component implements hover, selected, focus-visible,
disabled, loading, success, warning, error, empty, offline and
unknown. Focus is a 2px electric-blue ring with separation, always
keyboard-visible. Status is never color alone: a label or an
accessible name accompanies every dot. Reduced motion is respected.
Skeletons hold layout while loading; spinners only for a local
action. A destructive action is visually separated, red only at its
confirmation step, and states what it affects. A detail pane is a
single floating right pane whose header, tabs and action rail stay
pinned while its body scrolls; the list behind it dims; Escape or the
close control returns focus to the row; below 960px it is a
full-width overlay and below 720px a full-screen sheet with a
visible Back and sticky actions. A things page's controls dock and
table header stick inside the content region, the rows scroll.
