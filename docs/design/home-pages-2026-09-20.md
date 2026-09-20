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
