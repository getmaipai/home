# Spotifast spec 1: SHELL and BROWSE screens (rebuild level)

Source: Rust + egui, immediate mode. All sizes are points (pt). 1 pt = 1 px at zoom 1. Paths are under `src/` of the clone.
The reference screenshot (docs/screenshot.png, 1920x1200) is drawn at 1.333 px per pt: sidebar 334 px = 250 pt, tile 80 px = 60 pt, player bar 117 px = 88 pt, card art 197 px = 148 pt. Divide screenshot pixels by 1.333 to get pt.
Earlier shallow notes: ../audit-b-ui.md. This file goes deeper on shell + browse only. Colour role names (window, panel, surface, surface_hover, surface_active, outline, text, secondary, dim, accent, accent_hover, on_accent, overlay, shadow, danger) are the 17-role Palette (theme.rs:17-86). Dark values: window 0f1114, panel 15181c, surface 1d2127, surface_hover 262b33, surface_active 2f353f, outline 2a3038, text f2f4f6, secondary a9b1bc, dim 6e7784, accent 1ed760, accent_hover 3ce87a, on_accent 0a140e, overlay 22272e.
Not covered here (own specs): player bar, queue/lyrics panels, settings, devices popup, dialogs, Winamp mini player.

## 0. Global conventions used by everything below

- Hover/press feedback is mostly instant (egui repaints on pointer move). The only timed animations in these screens: row shift while dragging (0.12 s), egui default state animation 0.12 s (switches), header shadow depth (scroll-driven, 0..24 pt), art crossfades. No hover transitions on fills: a hover fill is on or off the same frame. (motion.rs:14; sidebar.rs:1501)
- Tooltip: egui tooltip after 0.4 s on hover (theme.rs ~330-428). Every icon-only button has one (theme::icon_button sets it, theme.rs:580-612).
- Focus ring (keyboard focus only): 2 px outside, radius 4, selection stroke (accent 1 px). Drawn by `theme::focus_ring` (theme.rs:559-571). Rows with custom hover fill share "hover" with keyboard focus.
- Text truncation: single line, ellipsis at the reading end, RTL aware via `bidi::layout` (`bidi::ELLIPSIS`). Row titles clip (painter clip rect), they do not fade. (sidebar.rs:1571; widgets.rs:2798)
- Cover fallback (no image or not yet loaded): flat fill (dark: surface_hover, light: surface_active) + centred icon at 42 % of the cover (12..64 pt), colour dim. Icon = Music for items, User for artists/people, Mic for episodes. Artist covers are circles (radius = half the side). (widgets.rs:69-115)
- Cover drop shadow only in dark mode: offset (0,10), blur 28, black alpha 120, on cards, top result, page hero. Light mode: none. (widgets.rs:314-327)
- Type scale in use (Inter): 56 bold (hero title), 30 bold (page greeting/titles), 28 bold (library page title), 26 bold (top result title), 17 bold (section title), 15 bold (nav rows, Library heading), 14.5 semibold/medium (track title, tile title bold), 14 (row names, body), 13.5 (menus, subtitles), 13 (secondary), 12.5 (kind label, card subtitle), 12 (table header, hint), 11.5 (copyright lines). (theme.rs:396-403, 1022)
- Radii: 6 (rows, tiles, covers, menu items), 8 (cards, menus, top result, banners), 4 (small covers, focus ring, track-row covers), pills/chips = height/2, circles for play discs and avatars.
- Counts use thousands commas (`format_count`, util.rs:56). Durations `m:ss` or `h:mm:ss` (util.rs:8). Totals "2 hr 13 min" / "45 min 12 sec" / "30 sec" (util.rs:21-40). Dates: relative for the first 30 days ("5 minutes ago", "3 days ago", ticks forward by repaint every 1 s), else "Jan 5, 2024" (util.rs:68-165).

## 1. SHELL

### 1.1 Frame and regions (ui/mod.rs:33-120, 296-373)

```
WIDE (1240x800 default)
+--------------+----------------------------------------------+---------------+
| SIDEBAR      | TOP BAR 56 (not scrolled)                    | RIGHT PANEL   |
| 250 (210-600)|----------------------------------------------| (queue etc.)  |
| panel colour | wash gradient 340 high behind the page hero  | 280..560      |
|              | PAGE (vertical ScrollArea), 24 side padding  |               |
|              |                                              |               |
+--------------+----------------------------------------------+---------------+
| PLAYER BAR 88, full width, 1 px outline on top                              |
+-----------------------------------------------------------------------------+
NARROW (760 minimum): sidebar min 210 or hidden (Ctrl/Cmd+B), right panel closed or squeezes page
+------------+-------------------------------+
| SIDEBAR 210| top bar: search shrinks to 80 |  badges collapse to icons first
+------------+-------------------------------+
```
- Central page colour = window. Sidebar and side panels = panel colour (a notch darker than the page in dark). No divider line between them (`show_separator_line(false)`, sidebar.rs:563). Boundary is the colour step only.
- Page scroll margin: left/right 24, top 4, bottom 48 (ui/mod.rs ~337-349). Item spacing inside a page 8 x 6. Scroll bar: egui floating bar 8 wide, invisible until the page is scrolled or the pointer is near, handle 0.55 opacity (0.85 while dragging). The top bar and banner do NOT scroll; only the area below does.
- Scroll edge fade is disabled (`scroll.fade.strength = 0`, ui/mod.rs ~318). Instead a "header shadow" appears under the top bar once the page is scrolled: depth = scrollY/24 clamped 0..1; 14 pt tall gradient from black alpha 110*depth (dark) or 36*depth (light) to transparent at the top of the scroll area. So the shadow fades in over the first 24 pt of scroll. (ui/mod.rs header_shadow ~590-605)
- Page header wash: vertical gradient 340 pt tall starting at the top of the central panel, moves up with the scroll (scrolls away with the hero). Top colour = blend(window, art_tint, 0.45 overviews | 0.85 cover pages), bottom = window. With no art tint: palette.tint to transparent if the theme defines one, else no wash. Overview pages = Home, Search, Settings, Queue. Liked Songs wash colour is fixed 0x5038c8 (only when "Colour from album art" is on). Art tint = the cover's average colour, HSL lightness forced to 0.30 (dark) / 0.72 (light). Hovering a sidebar row asks for that cover's tint ahead of time (`PrepareTint`, sidebar.rs:237). (ui/mod.rs:255-296, ~540-590; theme.rs:89-106)
- Per-page scroll: each page has its own ScrollArea id `("page", page_key)`, so going Back/Forward restores the scroll offset of that page (egui memory). A window re-created after being hidden restores the last offset (`restore_scroll`, app.rs:1587).
- Sidebar can be hidden (Ctrl/Cmd+B): page widens, the top bar gains two leading round buttons (show-sidebar, Home) before Back/Forward (topbar.rs:239-260). Width persists (250 default) only when the user drags the edge or the panel is not forced to yield to a right panel (ui/mod.rs:121-168; sidebar.rs:587-593).
- Window minimum width is raised while panels are open: sidebar min 210 + right panel min 280 + top bar least width. Least width = lead + 80 (search floor) + right controls + spinner + two collapsed badge chips (topbar.rs:58-71).
- macOS: 28 pt inset above the sidebar's first row and above the top bar for the traffic lights. Windows custom title bar: top bar 48 + 4 padding. Linux custom bar: left controls inset.

### 1.2 Navigation model (app.rs:9963-9981, 10160-10168)
- History is a stack capped at 60 pages with an index. `open(page)` on the page already shown only reloads it. Opening a new page truncates forward history. Closing devices popup on navigation.
- Back/Forward: top bar circle buttons, Alt+Left/Right (not in a text field), mouse back/forward buttons. Back is disabled (dim glyph, no tooltip, no click) when index is 0; Forward when at the end.
- Page caches are LRU capped: 12 playlists, 16 albums, 10 artists, 8 shows, 6 radios; 800 track metadata. A page reopened within the cap shows instantly with its old data while refreshing.
- Loading previews: opening a playlist/album/artist from a card shows the known header (cover, title, byline, disabled actions) immediately, then rows as skeleton lines until data arrives (ui/mod.rs:228-253).

### 1.3 Sidebar (ui/sidebar.rs)

Container: left panel, resizable 210..600 (default 250), fill panel, inner margin L12 R8 T12 B8 (B0 when the large cover is docked), +28 top on macOS (sidebar.rs:542-594).

```
WIDE (250)                              NARROW (210)
+--------------------------+            +--------------------+
|  [house22] Home      (40)|            | [house] Home       |
|  [search22] Search   (40)|            | [search] Search    |
|  ---------------------   |  hline     | -------------------|
|  [lib22] Library  [s][+][grid][<]|    | [lib] Libr [s][+][g][<]  heading drops 15>14>13 then hides
|  (Playlists)(Albums)(Artists)    |    | (Playlists)(Albums)|
|  (Podcasts)                      |    | (Artists)(Podcasts)|   chips wrap, gap 6x6
|  [v Recently played] (By You)    |    | [v Recently played]|
|  [ search in Your Library ]  (opt)|   |                    |
|  [44 art] Liked Songs     [pin]  |   |                    |
|           Playlist - 14 songs     |  |                    |
|  [44 art] Late night focus (vol)  |  |                    |
+--------------------------+            +--------------------+
```

#### a) Nav rows (sidebar.rs:1002-1062)
- Two rows: Home (House icon) and Search (Search icon). Each is full width x 40, no background in any state (not even active). Icon 22 centred at x+22; label bold 15 at x+46, vertically centred.
- Colour: secondary; text when the row is the current page or hovered. States: default / hover / active are colour-only. Home active when page == Home; Search active when page == Search. Focus ring when keyboard focused. No tooltip.
- Click Home -> open Home. Click Search -> `FocusSearch` (opens the Search page, focuses the top-bar field next frame; also bound to Ctrl/Cmd+F and "/").
- Spacing: 4 above first row; after the second row 10, a 1 px outline hline inset 4 each side, 10 below (sidebar.rs:1040, 1063-1069).

#### b) Library header (sidebar.rs:1082-1166)
- One row: 6 left pad, Library icon (22, secondary), 2, then "Library" heading bold 15 (text colour). Right side laid out right-to-left with spacing 2, each an icon_button (16 glyph, 28x28 hit, secondary -> text on hover, scale 0.92 while pressed, tooltip):
  1. rightmost: PanelLeft, tooltip "Hide sidebar (Ctrl+B)" / "Hide sidebar (Cmd+B)".
  2. grid toggle: shows LayoutGrid with tooltip "Show as grid" in list mode; LayoutList with "Show as list" in grid mode.
  3. Plus, tooltip "Create a playlist" (opens CreatePlaylist dialog with empty name, private, no songs; no menu, one item never got a menu).
  4. Search, tooltip "Search Your Library" (toggles the inline filter field; closing it clears the filter text).
- Heading takes the space that remains. Font steps 15, 14, 13 until it fits (room = free width - 6); if none fits it is not drawn at all (the icon still names the section). The icon buttons win over the heading. Order left to right in the screenshot: Library icon, "Library", Search, Plus, Grid, PanelLeft.
- 6 below the header row.

#### c) Filter pills (sidebar.rs:1169-1181)
- horizontal-wrapped, spacing 6 x 6. Four soft chips in fixed order: Playlists, Albums, Artists, Podcasts. Exactly one active (default Playlists, state kept in egui temp data, not persisted).
- Chip spec (theme::soft_button, theme.rs:766-860): height = text height + 14, width = text + 24, fully rounded, font medium 13. Inactive: fill surface, label text colour. Hover: fill surface_hover. Active: fill = text colour (inverted: white pill in dark), label = window colour. No outline. Focus ring. No animation. In the screenshot "Playlists" is the white pill, "Podcasts" wraps to a second line at 250 wide.
- Switching a pill picks that shelf's saved sort (`selected_sort`) and starts loading it (albums/artists/podcasts load on demand when `!loaded_once`; with a sort other than Library order the rest keeps loading until the list is complete). (sidebar.rs:1225-1255)

#### d) Sort row (sidebar.rs:350-416, 1184-1203)
- 4 above. Sort button: surface fill, radius 12, min height 28, ChevronDown icon 15 on the LEFT of the label (text colour), label medium 13. Opens a popup menu (menu frame, items 28 high, selected item has a Check icon at the icon slot). Width = widest label + 52, min 140, capped at window width - 24.
- Items per shelf: Library order (not on Playlists), Recently played (all), Name (all), Recently added (Albums and Podcasts only), Local custom order (Playlists, only when a custom arrangement exists), Spotify custom order (Playlists only). Default for Playlists: Local if a custom order was saved, else Spotify if any folder exists, else Recently played; other shelves default Library order.
- "By You" soft chip (toggle, Playlists shelf only) sits beside the sort button in the same wrapped row; active = inverted pill. Shows only playlists owned by the signed-in user; folders left empty are hidden and folder counts reflect visible rows.
- Sort semantics: Recently played = rank by `recent_contexts`; unranked go last. Name = case-insensitive, within folders. Recently added = newest first, undated last. Pins always float to the top first, in pin order, regardless of sort.

#### e) Inline library search (sidebar.rs:1208-1222)
- Appears below the sort row when the Search icon is on: 4 gap, then `search_field` width = free - 4, hint "Search in Your Library", autofocused when opened. Filters the current shelf by case-insensitive substring (albums also match artist names). With a search active, folders are flattened (matches inside collapsed folders stay reachable).
- search_field spec (widgets.rs:3567-3665): 34 high pill, fill surface, focused fill surface_hover + 1.5 px inset stroke text x0.6. Search icon 16 secondary at x+18. Text 14 regular, inset 34 left / 30 right. Hint colour dim. When non-empty a clear X (15 glyph, secondary->text, tooltip "Clear") sits at right-17; clicking clears and keeps focus. Text menu has native clipboard actions. RTL text is reordered, caret follows glyph order.

#### f) Row list (sidebar.rs:1389-1731)
- Vertical ScrollArea `sidebar-list`, auto_shrink false, virtualised (only visible rows plus one neighbour each side are laid out; `virtual_rows`, widgets.rs:347). Row heights must be uniform.
- LIST row, default: height 60. Layout (x from row left): 8 pad + indent (14 per folder depth) | 44x44 cover radius 6 (circle r22 for artists) | 12 gap | text column. Name medium 14 at cy-9 (colour text, accent when this context is playing); subtitle regular 12.5 secondary at cy+10. Text right edge = row right - 8, or -28 when a right icon is shown. Subtitles: "Playlist • {owner}" / "Playlist • 14 songs" (Liked, once total known; "Playlist" until then) / "{Album|Single|EP|Compilation} • {artists}" / "Artist" / "Podcast • {publisher}" / folders: "{n} playlists". (sidebar.rs:299-326, 973-1000, 1291, 1320, 1355)
- LIST row, compact (Settings > Appearance "Compact library sidebar": "Show names without covers in the sidebar"): height 32, no cover, name only medium 13.5 centred, same 8 pad.
- Row background: radius 6. Active page row (the page currently open) = fill surface (persistent). Hover = surface_hover x0.6. No border. Folders are never "active".
- Cover play overlay: while the row is hovered, or the pointer is over the cover, a black alpha 120 scrim covers the cover (same radius) and a white Play glyph (24 % of cover, clamped 18..26 pt, optically offset left) shows; glyph turns accent when pointer is directly over the cover. If this context is playing it shows Pause. Click: if already the current context -> toggle play/pause, else play the context from the start (Liked Songs plays the collection context). A click on the cover is not a click on the row (no navigation). Folders and compact rows have no overlay. (sidebar.rs:71-142)
- Right marks (16 from the right edge, vertically centred): playing = Volume2 16 accent; else pinned = Pin 13 secondary. Playing wins over pinned. "Playing" means this context is the playing one AND audio is believed playing; a paused context shows normal text colour and the pin (if any) again (sidebar.rs:1542-1546, 1671-1687).
- Folder row: chevron (ChevronRight collapsed / ChevronDown open, 16 secondary) at left+8, Library icon 20 at left+30, text starting left+46. Name medium 14/13.5, subtitle "{n} playlists". Click toggles collapse (Action::ToggleLibraryFolder, state session-only). Collapsed folder hides its playlists unless they are pinned (pins show at top level). Nested depth indents 14 per level. Order mirrors Spotify's root list.
- Liked Songs row: a synthetic first entry on the Playlists shelf (unless filtered out by text). Cover = 64x64 gradient texture (corners TL #450af5, TR #6a3ae8, BL #8e9fe5, BR #c4efd9 bilinear) + white filled Heart at 45 % of the cover (sidebar.rs:2213-2265). Same gradient reused on Home tile, hero, picker row.
- Interactions: click = open page (double-click on a list row also plays the context; not in grid); right-click = context menu; drag = reorder (see g); keyboard Tab focus ring, Enter activates, scroll-into-view on focus. Row is `click_and_drag`.
- States: loading (first load, no rows): "loading_row" = 18 accent spinner + "Loading…" subtle 13 at 8 left. Error: error_row (CircleAlert 16 danger + message 13 secondary; no Retry link in the sidebar for shelf errors). Empty: 12 space then subtle "Nothing here yet." (no filter) or "No matches." (filter text). When more pages exist, `load_more_when_near_end` requests the next page within 900 pt of the bottom.
- Prefetch: for non-compact rows the enlarged "softened" cover preview is prepared before the row is opened (sidebar.rs:1466-1471).

#### g) Drag and drop (sidebar.rs:228-297, 1396-1460, 1500-1514, 1689-1725, 2107-2210)
- Rows are draggable (primary button, egui drag threshold). Payload `DragEntry{uri,title,image}`. A ghost chip follows the pointer at (+16,+6): overlay fill, outline 1, radius 8, margin 10x6, shadow (0,4,blur 16), opacity 0.9, 24 cover r4 + title medium 13 truncated at 280 max width (widgets.rs:2470-2520).
- Reordering: slot = round((pointerY - listTop)/rowHeight). Rows above the slot shift -4, rows below +4 with a 0.12 s ease (value animation, off under reduce-motion), and a 2 pt accent hline inset 6 draws at the slot. Release commits `ArrangeLibrary`. Dropping inside the pinned block reorders pins; dropping below it unpins the row and writes a full local playlist order (switches sort to "Local custom order"); dropping an unpinned item at the end of the pin block while it was pinned keeps it pinned. Right-click menu offers "Sort by recently played" while in Local custom order.
- Edge auto-scroll while dragging: within 48 pt of the list top/bottom, speed up to 900 pt/s proportional to proximity (widgets.rs:2412-2438).
- Dropping SONGS on a row (from a track table): only Liked Songs and playlists the account can edit accept. Target row gets accent x0.18 fill + 1.5 px inside accent stroke (list) or a 2 px accent stroke on the cover (grid); non-droppable rows get a panel x0.5 veil. Drop onto Liked saves the songs; onto a playlist adds them (Action::AddToPlaylist, with duplicate handling). Target rows also shift +-4 like reorder.

#### h) Context menu (right-click a row) (sidebar.rs:2015-2103)
Menu frame = overlay fill, 1 px outline, radius 8, inner margin 6, shadow (0,6,blur 20); width 200..300; items 28 high, radius 6, hover = surface_hover; label regular 13.5, icon 16 secondary at x+10, label at x+36 (x+10 with no icon); disabled = dim and no hover; separator 9 high with 1 px outline line inset 6 (widgets.rs:428-518, 653-675).
- For playlists/albums/artists/shows (`context_menu_items`, widgets.rs:1466-1575): Play; Shuffle play (not artists); Add to queue (albums only); Add to Your Library / Remove from Your Library (Follow / Unfollow for artists; icons CirclePlus / CircleX); for owned playlists: Edit details (Pencil), Delete (Trash) instead of library toggle; separator; Go to playlist/album/artist radio (when a station exists, Radio icon); Copy link; Open in Spotify (ExternalLink). Then the sidebar adds: Pin to top / Unpin (Pin / PinOff), and in Local custom order "Sort by recently played" (Clock).
- Liked Songs: Play, Pin to top / Unpin only.
- Folder rows have no menu.

#### i) Grid mode (Library header grid toggle; setting `sidebar_grid`) (sidebar.rs:1749-2013)
- Columns = floor(width/108) clamped 2..4; card width = width/columns (no gap column); card height = card width + 44; rows virtualised.
- Card: 8 pad all round, cover (card w - 16) square radius 6 (circle for artists), name medium 13.5 at cover bottom+4 (18 high box), subtitle regular 12 secondary at +23 (17 high) = owner / artists / publisher / "14 songs" / "{n} playlists" for folders / blank for artists. One line each with ellipsis. Active page card: surface fill r6; hover: surface_hover x0.6. Folder card: surface square + Library icon at 30 % card width, secondary.
- Pin badge: 20 circle at cover top-left +12, black alpha 170, white Pin 12 (replaces the right-side pin icon).
- Play button (grid_play_button): accent 32..44 disc (30 % of cover) at the cover's bottom-right, inset 8 + half; shadow (0,4,blur 12,alpha 90); shown while the card is hovered, the context is current, or the button has focus; hover fill accent_hover; glyph on_accent 42 % of the disc; Play/Pause per state; accessible label "Play {name}" / "Pause {name}". Accent title colour while playing. (sidebar.rs:144-226)
- Reorder in grid: insertion marker is a 2 px accent vertical line at the card's left (or right of the last card); slot from row/column with half-card hit test. Drop of songs: 2 px accent stroke around the cover.
- Expanded cover docked in grid mode floats over the list end with a 64 pt fade into panel colour (sidebar.rs:617-636).

#### j) Docked large cover (sidebar.rs:596-713)
- When Settings `art_expanded` is on and a track with artwork plays: panel bottom reserves a square = min(panel width, 45 % of panel height), min 80, plus 10 gap; cover painted at radius 8 with a dark shadow (0,0,blur 28, alpha 120 dark / 40 light) via the playing_cover crossfade. Hover shows an 18 circle (panel x0.9) with ChevronDown 14 at cover top-right (-16,+16): click collapses (clears setting). Clicking the cover opens its Album (or Show). Inner bottom margin becomes 0.

### 1.4 Top bar (ui/topbar.rs)

```
WIDE:   [24][<][>] 8 [ (search) What do you want to play?        (x) ]   [Playing on X][Update 1.2]  (spin)[shrink][bars][gear] [avatar36] [24]
NARROW: [24][<][>] 8 [ (search) ........ ] [dev-icon][upd-icon] (spin)[shrink][gear][avatar]
SIDEBAR HIDDEN: [24][panel][house] 2.. [<][>] ...
```
- Height 56 (48 + 4 on Windows custom bar; +28 macOS inset). Left-to-right layout, centred vertically, item spacing 8, left padding 24, right padding 24. Empty bar areas drag the window when a custom title bar is on.
- Nav button (topbar.rs:157-195): 32 circle, fill black alpha 90 (dark) / 20 (light), glyph 20: secondary; hover or focus -> text; disabled -> dim with no click and no tooltip. Tooltips "Back" / "Forward". Sidebar-hidden extras use the same style with tooltips "Show sidebar (Ctrl+B)" / "(Cmd+B)" and "Home".
- Search field = `search_field` (see 1.3e). Hint "What do you want to play?". Width = clamp(room * 0.5, 200, 440) where room is the bar width left after the left cluster; if room - rightControls - labelledBadges < 130 the badges collapse to icons first; then the field shrinks, never below 80. (topbar.rs:88-97)
- Behaviours (topbar.rs:355-396; app.rs:4697-4709, 13299-13335): focusing the field (Tab, click, Ctrl/Cmd+F, "/", sidebar Search row) opens the Search page unless the focus came from the clear button. Typing opens Search and arms a 280 ms debounce; after 280 ms of no typing a "typed" search runs on the trimmed text. Enter submits (`Action::Search`) immediately and records it. A pasted Spotify link is not searched as words: on Enter it opens what it points to; no debounce search runs for it. Esc in the field drops focus. Clear X empties the field and refocuses it, staying on the page, ending the search run (page returns to Recent searches when `committed` is empty and nothing typed). Typing over a selection starts a new run (so history entries from prefixes get replaced, not stacked: app.rs:7770-7795). Search state persists while navigating (field keeps its text).
- There is NO dropdown history under the field and no suggestions list; history is shown as chips on the Search page (section 3).
- Badges (topbar.rs:99-155): height = text + 12, radius 14, fill accent x0.16, icon 13 accent at x+14, label medium 12.5 accent at x+24. "Playing on {device}" / "Playing on another device" (shown only when playback is on a remote device; click toggles the devices popup; collapsed: icon-only chip with tooltip = label). "Update to {version}" / "Downloading update…" / "Update ready" (Info icon; tooltip "Version {version} is available."; click opens update dialog). Order right-to-left: avatar, gear, [MilkDrop], shrink, spinner, device badge, update badge.
- Right buttons: icon_button glyph 19 (31 hit) secondary->text: Mini player (Shrink icon, tooltip "Mini player (Ctrl+M)" / "(Cmd+Shift+M)"), MilkDrop AudioLines only when visualisers exist (accent when open; "MilkDrop visualiser (Ctrl+Shift+K)"), Settings (gear, tooltip "Settings").
- Spinner: 15 secondary arc, only when a background task has run long enough (never flashes); tooltips "Updating your library…" / "Checking for updates…" / "Waiting for Spotify…".
- Offline pill: when offline a 31 circle (blue 28,92,178 dark / 41,121,255 light; hover 38,110,205 / 66,133,244; radius 14.5) with white WifiOff 19, tooltip "Spotifast is offline. Reconnecting automatically when connection returns."
- Avatar: 36 hit, circle fill surface (surface_hover on hover/focus), inner picture 28 round; no photo -> accent disc with the first letter bold 13 on_accent (or "?"). Tooltip = user name. Click opens a popup menu anchored BOTTOM_END, width 200: name semibold 14, plan below it (capitalised product, regular 12 secondary, 2 gap), separator, Settings (gear), Keyboard shortcuts (Info), separator, Sign out (LogOut).
- Banners below the top bar (not scrolled): one at a time (soloist > audio key > slow app); outer margin L/R 24, B 8; surface fill, outline 1, radius 8, inner margin L16 R6 T12 B12; title bold 14 (+ 14 spinner when busy), body regular 13 secondary, buttons are pills (first primary accent, rest outlined), X close icon 16 at top right (tooltip "Close banner"). Hidden on Settings and while a dialog is open. (ui/mod.rs:500-560)

### 1.5 Offline and loading chrome shared by pages
- Offline Home: centred block at (height-160)/2 (min 48): WifiOff 54 dim, 16, "You're offline" bold 28, 8, "Spotifast will reconnect automatically when your connection returns." regular 14 secondary. (home.rs:17-41)
- Track tables offline: with no rows shows the same message as an empty_state (WifiOff 40); with rows the table dims to 0.55 opacity and disables interaction; actions row disabled. Placeholder rows say "You're offline. Reconnect to load more songs."
- empty_state (widgets.rs:3233): 48 space, icon 40 dim, 8, title semibold 16 text, 2, body regular 13.5 secondary, all centred.
- skeletons: static (no shimmer, no animation, zero repaint cost) shapes in surface_hover x0.9 (dark) / surface_hover (light). Row skeleton = 56 high rows: 40 cover r4 at x+12, two bars 10 and 8 high r4 at cover+14, widths = share of min(room,420) cycling 0.62/0.48/0.71/0.55/0.4 (second line x0.7). Card skeleton = 172 wide: art 148 r6 (circle for artists), bar 12 high at +12 (share x148), bar 9 high at +8 below. Accessible label "Loading…". (widgets.rs:3064-3183)
- error_row: 8 left, CircleAlert 16 danger, message regular 13 secondary; any message containing a URL/dns/connection text is replaced by "Network connection error. Check your connection."; optional soft "Retry" chip with Refresh icon -> reloads that page (widgets.rs:3193-3231).

## 2. HOME (ui/home.rs)

```
WIDE (available 1042 pt+)                         NARROW (available ~500)
Good evening                    30 bold           Good evening
+-------------+ +-------------+  tiles 60 high     +--------+ +--------+   2 columns always min
|[60]Liked    | |[60]Discover |  cols=floor(w/300)  |[60]..  | |[60]..  |
|[60]Late nig | |[60]Sunday   |  clamp 2..4, gap 10 (4 rows x 2)
+-------------+ +-------------+
Made for you                    17 bold
[card172][card][card]... horizontal scroll, gap 7, last card clipped (no fade)
Recently played   [card]..   Your podcasts  Your top artists (round)  Your top songs [3 chips] 10 rows
```
- Order: greeting, quick access (8 tiles), Made for you, Your top mixes, New releases (linked title), Recently played, Your podcasts, Your top artists, Your top songs (+ period chips + 10 rows + "Show more top songs" link), Recommended for you (20 rows). Made for you + Top mixes hidden by setting `home.made_for_you.visible`; Recommended hidden by `home.recommendations.visible`. (home.rs:42-61)
- Greeting rules (util.rs:321-327): local hour 5..=11 "Good morning", 12..=17 "Good afternoon", everything else 18..=4 "Good evening". Bold 30, 6 above, 12 below. No name, no emoji.
- Vertical rhythm: after tiles 16; each shelf = 8 + title (bold 17) + 4 + cards + 12 (widgets.rs:3011-3052). Page bottom margin 48.

### 2.1 Quick-access tiles (home.rs:75-325)
- Source: the latest distinct contexts from play history (playlist, album, artist, show, Liked Songs via ":collection" URIs, or a song played alone), newest first, deduped by destination page, max 8; if history is short or still loading, Liked Songs + first Library playlists fill the rest. So before history arrives the grid is already full of library playlists.
- Grid: columns = clamp(floor(available/300), 2, 4); gap 10 both ways (item spacing y 6 from page + row layout; screenshot shows 8 px = 6 pt between tile rows); tile width = (available - 10*(cols-1))/cols; 4 columns needs >= 1200 pt available.
- Tile: 60 high, fill surface, radius 6, hover fill surface_hover (instant). Cover = 60x60 square flush left, radius 6 (art requested at the display's pixel size; 300 px rendition is used so it never looks soft). Title bold 14.5 text, starts cover+12, vertically centred, single line clipped at right-12 (right-52 on hover when a play button shows).
- Hover play button: 40 accent circle (accent_hover on hover, 1.05 scale), play/pause glyph on_accent (46 % of 40), centred at right-28; tooltip "Play" / "Pause". Pause when that context is the one playing. Click on the button: if this context is current -> toggle play/pause; a song tile plays that URI; otherwise plays the context. Tile click elsewhere = open the page (playlist/album/artist/show; Liked -> Liked Songs; a lone song opens its album).
- Right-click: context menu (same item sets as sidebar: playlist/album/artist/show `context_menu_items`; for a lone song `item_menu`). Liked tile has no menu.
- No press state, no focus ring on tiles (they use plain click sense).

### 2.2 Shelves and cards (widgets.rs:2855-3052)
- Shelf = title (bold 17 text; linked shelves "New releases", "Your top songs" are underlined-on-hover links with pointing-hand cursor) + horizontal ScrollArea + 12 gap. Cards spaced 7 (CARD_GAP/2). The scroll area is a plain egui horizontal scroll area: horizontal wheel / shift+wheel / trackpad swipe / dragging its floating 8 pt bar; vertical wheel passes to the page. No arrow buttons, no snap, no edge fade, no "Show all" button. The last card is simply clipped by the page edge (screenshot shows a cut card). Keyboard: Tab focuses a card and scrolls it into view.
- Card (172 wide, height = 12 + 148 + 10 + titleRow(14 semibold) + 2 + 2 x subtitleRow(12.5) + 8; ~ 247). Cover 148 square at (12,12), radius 6 (circle for artists), dark-mode shadow. Title semibold 14 text, 1 line ellipsis. Subtitle regular 12.5 secondary, up to 2 lines with ellipsis; space for 2 lines is always reserved so mixed shelves align. All text clipped to 148 wide.
- Hover: card background surface_hover x0.8 (dark) or x1.0 (light), radius 8. Play disc appears on hover only: 44 accent circle at cover bottom-right inset 26 (centre at art.right-26, art.bottom-26), accent_hover on hover and 1.05 scale, glyph on_accent; Pause while that context plays. Cards with `playable=false` (podcast shows in Search/Library) have no disc. Disc click does not open the page. Focus ring + scroll into view on keyboard focus. Accessible name "{title}, {subtitle}".
- Subtitles per shelf: Made for you / Top mixes = playlist description with HTML stripped (so "Your weekly mixtape of fresh music. Enjoy new…" truncates over two lines), else "By {owner}". New releases = "{Album|Single|EP} • {artists}". Recently played = track name as title, artists as subtitle (opens its album; disc plays that song alone; max 16 distinct tracks). Your podcasts = episode name, subtitle "{time} left • {show}" (started, unfinished) or "New • {show}" (newest unstarted episode released within 30 days), max 16; disc resumes at saved position. Your top artists = round, subtitle "Artist".
- Right-click on any card opens that item's menu (context menu items for contexts; item_menu for songs/episodes).
- Loading: Made for you and Recently played and Top artists show 7 static skeleton cards under the real title; New releases shows an inline loading_row; failures show error_row with Retry (reloads Home). Top songs loading shows loading_row under the chips; a track-list shelf shows 4 skeleton rows.
- Empty shelves are simply absent (Made for you, mixes, new releases, recently played, podcasts, top artists). Top songs section is always present.

### 2.3 Top songs block (home.rs:903-979)
- Title bold 17 link (opens Top songs page), 4, then three chips "Last 4 weeks" / "Last 6 months" / "Past year" (single scroll row, chips spacing 8, active = inverted), 8, then 10 track rows (cover 40 unless compact list), then soft-text link "Show more top songs" (semibold 14 secondary) when more than 10, then 16 gap. Selecting a chip reloads with a loading_row. Compact track list setting makes rows 36 high with no cover.

## 3. SEARCH page (ui/search.rs)

```
EMPTY (no history)                    HISTORY                               RESULTS ("All", width > 720)
        [search 40 dim]               Recent searches 17 bold               (All)(Songs)(Artists)(Albums)(Playlists)(Podcasts)(Episodes)
     Search Spotify  semibold 16      [clock bonobo x?][clock ...]  chips   Top result          Songs
Find songs, artists, albums, ...      wrap, gap 8                           +-----------+      row x4 compact
                                                                            | 96 art    |      Artists  [cards..]
                                                                            | Title 26  |      Albums ...
                                                                            | Artist    | (play 48 on hover)
```
- Page top: 6 space (4 for results). The field lives in the top bar, not the page.
- States (search.rs:15-126): (a) nothing committed and nothing being typed: Recent searches if any, else empty_state "Search Spotify" / "Find songs, artists, albums, playlists, and podcasts." (Search icon 40); offline with no history: "You're offline" / "Connect to the internet to search songs, artists, and playlists." (b) typing/committed: chip row + results.
- Recent searches: section title bold 17, 6, wrapped soft chips (spacing 8x8) with a Clock icon on the left of each query; on hover the clock turns into an X (hit slightly larger than the icon, +3 expand) which forgets that entry; clicking the chip runs the search afresh and focuses nothing special. Max 12 entries, newest first, deduped; entries from prefixes typed in one run replace each other (settings.rs:713-721; app.rs:7770-7795). Only queries that returned results are remembered.
- Filter chips (widgets::chips, widgets.rs:3411-3491): single row, spacing 8, horizontal scroll, scroll bar hidden, mouse wheel scrolls it sideways, a 24 pt fade into window colour appears on the right edge when overflowing, clicking scrolls the chip into view. Labels (SearchFilter::ALL): All, Songs, Artists, Albums, Playlists, Podcasts, Episodes. Default All; not persisted across restarts. 12 gap below.
- Pending: loading_row (accent spinner + "Loading…") while catalogue or playlists requests are still in flight; first load with no results shows 6 skeleton rows. Error: error_row with message, no retry link. No results: empty_state Search icon, title `No results for "{query}"` (curly quotes), body "Check the spelling, or try fewer words.".
- "All" layout (search.rs:128-290): wide (> 720 available): two columns with 24 gap; left column width = clamp(36 % of width, 240, 380) holds "Top result" (section title bold 17, 4, card); right column holds "Songs" with 4 compact rows. Narrow: Top result full width, then 12, then Songs (4 rows). Then 8 and shelves: Artists (round cards), Albums (subtitle "{year} • {artists}"), Playlists ("By {owner}"), Podcasts, then an "Episodes" title with 4 episode rows.
- Top result choice: the first artist if its name equals the query (case-insensitive) or there are no songs; else the first song; else first album; else playlist; else show. Card 232 high, fill surface, radius 8, hover surface_hover. Art 96 at (20,20), circle for artists (radius 48) else r6, with dark shadow. Title bold 26 at y = art.bottom+12+16 (single line clipped). Subtitle regular 13.5 secondary: "Artist"; "Song • " + clickable artist links (comma separated); "Album • {artists}"; "Playlist • {owner}"; "Podcast • {publisher}". Hover shows a 48 accent play circle at bottom-right inset 44 (tooltip "Play"): song -> plays that URI alone (Spotify continues with autoplay), others play the context. Card click opens the item page (a song opens its album); clicking an artist link in the subtitle navigates there instead. Right-click: matching item/context menu.
- Songs rows (search.rs:435-480): track rows with cover; in "All" they are compact (48 high, 36 cover, no album column, no heart/more columns); in the Songs filter they are full 56 rows with an album column. Each row's context is that single song.
- Single-filter views: Artists/Albums/Playlists/Podcasts = wrapping card grid (spacing 7 x 14, `widgets::grid`) with no title; Songs = full rows; Episodes = episode rows (`show::episode_row`). No pagination in search (whatever the API returned).
- Podcast cards have no play disc (navigate-only).

## 4. COLLECTION pages: playlist, album, Liked Songs, Top songs, New releases, artist, library grids

### 4.1 Hero (collection.rs:98-229)
```
WIDE (> 720 wide)                                        NARROW (<= 720)
12
[ 212 cover r6 ] 24  PLAYLIST            12.5 medium      [160 cover] 24  PLAYLIST
[              ]     Late night focus    56 bold          [         ]     Late night focus   40 bold
[              ]     description 13.5 secondary 1 line    [         ]     (shrinks by 6 down to 22 to fit)
[              ]     (o 18) Carmine • 1,845 saves • 14 songs, 51 min
20
```
- Cover 212 (160 when the page area is <= 720 wide). Click opens an "Enlarge cover" dialog (pointing-hand cursor, accessible label "Enlarge cover"); Liked Songs cover is not clickable. Shadow dark only. While the full image loads, the previous/softened thumbnail shows in place so no flash (widgets.rs:130-240).
- Text column: top space = cover x 0.08, item spacing 6. Kind label medium 12.5 text: "Playlist" / "Public Playlist" / "Collaborative Playlist" / "Album" / "Single" / "EP" / "Compilation" / "Artist". Title bold 56 (40 when cover <= 200) shrinks by 6 pt steps until it fits one line, floor 22. Description (playlists only): HTML stripped, 13.5 secondary single line truncated; links inside are text-coloured, underlined on hover, pointing hand; Spotify links navigate in-app, web links open the browser.
- Byline: wrapped row, spacing 4: optional 18 round avatar (owner picture, or placeholder User icon right away), then entries separated by "•" (regular 13.5 secondary). Linked entries (album artists -> artist page) are semibold 13.5 text with hover underline; plain entries regular 13.5 secondary. Playlist: owner, "{n} saves" (when known), "with {name}" / "with {a} and {b}" / "and {n} others" (collaborative), "{n} songs, 2 hr 13 min" (duration only once the whole list is loaded, otherwise just "{n} songs"). Album: artists (links), year (tooltip = full date e.g. "Jan 5, 2024"), "{n} songs, 51 min". Liked: user name, count. Artist: "{n} monthly listeners" (when known), "{n} followers", up to 3 genres joined by ", "; the artist hero is a circle cover.
- Under the hero there is no gradient of its own: the page wash (section 1.1) provides the colour (0.85 blend on cover pages).

### 4.2 Actions row (collection.rs:326-523)
```
( PLAY 56 ) 18 (shuffle 26) 18 (heart/plus/check 26) 18 (... 26) ................ [ (search) Filter  220 ]
14 below
```
- Item spacing 18. Play disc 56 accent (accent_hover + 1.05 scale on hover), play glyph on_accent at 46 %; Pause while this context is playing; resumes where it was if this context is current (no restart); disabled (dim, tooltip "No playable songs in this view") when the filtered view is empty; replaced by a 56 spinner disc with tooltip "Starting…" while a play request is pending. Play uses the shown order (sorted/filtered view) as a plain track list if a sort/filter is active, or shuffle is off; otherwise plays the Spotify context so shuffle/radio continue.
- Shuffle icon_button 26 (38 hit): secondary -> text on hover; when shuffle is on the glyph is accent (accent_hover on hover); tooltips "Shuffle" / "Shuffle off". Global state of the player, not per page.
- Save button 26: playlists you don't own show CirclePlus -> accent CircleCheck ("Add to Your Library" / "Remove from Your Library"); albums same icons ("Save to Your Library" / "Remove from Your Library"); radio pages: "Save as playlist" CirclePlus. Saved state is accent and stays accent on hover. Own playlists have no save button. Liked Songs has none.
- More (Ellipsis 26, tooltip "More"): popup menu = context menu items for the page URI (section 1.3h) plus, on playlists when online, a separator and "Refresh" (Refresh icon; reads "Refreshing…" and is disabled while loading). Radio page: only "Save as playlist".
- Filter field: right-aligned, search_field 220 wide, hint "Filter", id per page (text kept per page in memory; Liked Songs keeps it in egui temp data). Filter matches title, artists, album substrings (case-insensitive). Clear X inside. Albums/artists/top songs pages have no field. While filtering a playlist that is only partially loaded the rest loads automatically.
- Whole row is `add_enabled_ui(false)` while the page is still loading (disabled look) or offline.

### 4.3 Track table (collection.rs:774-1169; widgets.rs:1587-2408, 2543-2795)

```
WIDE (> 920)                                                                                      row 56
#  [cover40] TITLE            ALBUM            ADDED BY   DATE ADDED   PLAYS    (heart)  (clock)  (...)
44  52       flex             28% (140-360)    130        120          120      36       56       36    right fixed = 36+56+36+8
MEDIUM (> 560): album + plays      WIDE (> 760): + date added         EXTRA WIDE (> 920): + added by
NARROW (<= 560): # cover title | heart duration more
```
- Column rules (width of the table area): album if shown and width > 560: clamp(28 % of width, 140, 360); date added if present and width > 760: 120; added-by if collaborative and width > 920: 130; plays (albums/artist popular songs once counts arrive) if width > 560: 120. Right fixed block: heart 36 + duration 56 + more 36 + 8 right pad. Number column 44, cover column 52 (44 compact). Left pad 8.
- Header (34 high, scrolls with the page, NOT sticky): headings regular 12 secondary. Labels (uppercase): "#", "TITLE", "ALBUM", "ADDED BY", "DATE ADDED", "PLAYS", and a Clock icon (15) for duration right-aligned in its column. Each heading is a click target (hit = text + 4 x 8 expanded) with tooltip/accessible name "Sort by {column}"; hover -> text colour; active sort -> accent text + a drawn triangle (8x6, apex up for ascending, down for descending; not a glyph) 8 right of the text. `#` is accent with an up triangle when no sort is chosen ("Original order, reversed" tooltip); duration clock turns accent when sorted. Click cycle (next_sort, collection.rs:1505): ascending -> descending -> back to the list's own order; PLAYS starts descending; clicking # from any sort returns to natural order, and from natural it reverses. A new sort asks the page to load the whole list first. Bottom line: 1 px outline inset 8, then 6 space. Sort order persists per page in the session (`table_sorts`).
- Sorts: title/added-by lower-cased text; album sorts by album name then keeps each album's songs in disc/track order, ties keep first-seen order; date added by timestamp; duration; plays (no count sorts last).
- Row (56 default; 48 compact queue; 36 "Compact track list" setting = no cover, one line "title [E] • artists • date"):
  - Number cell: shows number (regular 14 secondary; accent when it is the current track; positions come from the displayed order when sorted); on row hover or focus it becomes a Play glyph 14 text colour (Pause if playing); playing and not hovered = static AudioLines icon 16 accent; pending play = 16 accent spinner. Without a number column the cover carries the same states under a black alpha 140 scrim (110 for the playing equalizer state).
  - Cover 40x40 (36 compact) radius 4 at x+2.
  - Title: medium 14.5; colour text, accent when current, dim when unavailable. Line 2: optional 15x15 "E" explicit badge (secondary fill, window-colour bold 9.5 letter, radius 2) then artist names as individual links (regular 12.5, secondary -> text when the row is hovered, hover underline, pointing hand; artists without ids are plain text); when no date column fits, "• {relative date}" is appended (separator secondary x0.6). Clipped at the title column's right - 12.
  - Album cell: link regular 13, secondary/text-on-hover, opens album. Added by: regular 13 secondary text. Date: regular 13 secondary (relative for 30 days). Plays: regular 13 secondary, comma formatted, shown only when known.
  - Heart cell: icon_button 16, centred; invisible (opacity 0) unless the row is hovered/focused or the song is saved; saved = filled accent heart that stays accent on hover; tooltips "Save to Liked Songs" / "Remove from Liked Songs". Episodes have no heart.
  - Duration: regular 13 secondary, right-aligned 6 from the cell edge.
  - More: Ellipsis 18 icon_button, visible only on hover/focus/while its menu is open (menu stays alive so moving the pointer to it works). Tooltip "More". Menu = item menu.
  - Hover fill radius 6 surface_hover x0.7 (dark) / x1.0 (light); selected fill secondary x0.20 (x0.30 while hovered), no accent so selection is not mistaken for "playing"; unavailable (local files, unplayable) title dim, no play control.
- Interactions (widgets.rs:2325-2408): single click on the row body selects only that row (click the sole selected row again to deselect; Shift = range from anchor; Ctrl/Cmd = toggle); click on the number/cover cell plays (toggles if already current); double-click anywhere plays from that row. Right-click: single-song item menu, or the multi-select menu if the row is among several picked. Arrow Up/Down moves selection in display order, Shift+Arrows extend; Ctrl/Cmd+A select all (not unloaded or unavailable rows); Esc clears; Ctrl/Cmd+C/X/V copy/cut/paste song links; Delete (and Backspace on macOS) removes picked rows from an editable playlist; Shift+Q add to queue; Shift+N play next (first press only, repeats ignored); PageUp/Down/Home/End scroll. Selection is tied to the view signature (sort|filter|row count|revision) and clears when the view changes.
- Drag: rows are draggable after egui's threshold; payload = the picked songs (or the single row). In an editable playlist unsorted/unfiltered, rows part by +-4 around the nearest slot (0.12 s) with a 2 px accent line inset 8 and drop reorders (`MoveInPlaylist`, or inserts when the source is another list); a row dropped on its own edges moves nothing. Songs can also be dropped on sidebar rows. Dragging near the viewport edge auto-scrolls (900 pt/s, 48 pt zone).
- Virtualisation: only visible rows draw; finite playlists reserve the server's full row count so the scroll bar is true; unloaded slots draw a placeholder row (regular 13 secondary text at x+12): "Loading…", "Unavailable" (removed tracks), "You're offline. Reconnect to load more songs.", or the error with a 64x28 "Retry" button at right-40. Missing windows load on scroll (`LoadWindow`); a sort loads everything.
- Table footers: loading with rows = 8 gap + loading_row; first load = 8 skeleton rows; error = error_row with Retry; empty (no filter) = empty_state Music icon, "Nothing here yet", "Added songs appear here."; a filter with no match and more to load keeps loading.
- Deep link: a pasted song link opens its album and picks + scrolls the row to the viewport centre (loading more until found).

### 4.4 Menus on tracks (widgets.rs:1186-1463, 680-775)
Item menu (min 220, max 300): Play next (SkipForward; disabled unless the local queue can be reordered), Add to queue (ListEnd), [Remove from queue when in queue and removable], Save to Liked Songs / Remove from Liked Songs (Heart/HeartFilled) (episodes: Save episode, Bookmark), Add to playlist (submenu with filter field "Filter playlists", "New playlist" (Plus), separator, 36 high rows with 28 cover + name, scroll max 320, Up/Down/Enter keys, "No editable playlists" / "No matching playlists"), editable playlist only: Move up (not first), Move down, Remove from this playlist (Minus); in Spotify's own mixes Hide/Show in this playlist (EyeOff/Eye); separator; Go to song radio (Radio), Go to artist (single) or submenu of artists, Go to album (Disc) (episodes: Go to podcast); separator; Copy link, Copy details submenu (Song title, Artist, Artist and song title), Open in Spotify. Multi-select menu (picked_menu): header "{n} songs" (medium 12 secondary), separator, Play next, Add to queue, Save/Remove from Liked Songs (for the whole set), Remove from this playlist, Add to playlist.

### 4.5 Playlist page specifics (collection.rs:1862-2074)
- Sequence: hero, actions row, filter, table. Date-added column only if some rows have real dates (epoch 1970-01-01 is hidden); added-by only for collaborative/Blend playlists. Playlist rows keep their server position so removing one copy of a duplicate works. "Hidden" songs in Spotify mixes render greyed and are skipped by playback; plays then use shown rows.
- Loading: known header + disabled actions + 8 skeleton rows; no cached header: 40 space then skeletons. Failure: header + disabled actions + error_row with Retry, or the offline empty state when the error is a network error.

### 4.6 Album page (collection.rs:2076-2281)
- Hero (kind label from album_group; "EP" when confirmed), actions row without filter, table: no cover column, no album column, plays column when counts arrive (requested on open); heart + duration + more. Under the table: 24 space, release date "Jan 5, 2024" regular 12.5 secondary, then copyright lines regular 11.5 dim, one per distinct text with merged marks "(c) (p)" (P-type lines get the sound-recording mark; the same text under both kinds prints once with both marks).
- Pre-release albums show a countdown page instead (prerelease.rs).

### 4.7 Liked Songs (collection.rs:2510-2643)
- Hero with the gradient heart tile, kind "Playlist", title "Liked Songs", byline user name • "{n} songs, duration". No saved button; filter field kept in temp data. Table shows Date added (real dates). Rows prepend as songs are liked elsewhere (revision-based). Page wash colour fixed purple 0x5038c8.

### 4.8 Top songs and New releases (collection.rs:1777-1860; new_releases.rs)
- Top songs: 12 space, "Your top songs" bold 30, 4, period subtitle regular 13.5 secondary ("Calculated from your listening over approximately the last 4 weeks." / 6 months / year), 12, three period chips, 18, table (cover + album; no filter; skeleton 10 rows).
- New releases: "New releases" bold 30, subtitle "The latest releases from artists you follow, newest first.", 18, then a mini action row: Play 56 + Shuffle 26 + "{n} songs, 2 hr 13 min" regular 13.5 secondary, 12, table. Empty: Music icon "No new releases" / "New albums and singles from artists you follow will appear here."

### 4.9 Artist page (ui/artist.rs)
- Sequence: circular 212 hero; actions row (play 56, outline pill "Follow"/"Following", More 26) 20 below; "Popular" section title + 5 rows (number column shows rank, plays column when counts arrive, no album column) + soft chip "See more"/"Show less" (toggles to all, 6 above); 20; optional "Release countdown" card (96 high, max 440 wide, 88 cover, hover fill surface_hover); "Discography" title + 6 + chips (All, Albums, Singles & EPs, Compilations, Appears On) + 10 + card grid (duplicate names by case are collapsed; subtitle "{year} • {Album|Single|EP}"), loader chip "Load more" or loading_row; the grid reserves the previous list height with skeleton cards while a category loads so the page does not jump; "Fans also like" shelf of round cards. Empty popular: "No popular songs to show."; empty category: "Nothing in this category."
- Follow pill: outline 1 dim (text on hover), semibold 13, pad 18x8, fully round; no fill.

### 4.10 Library full pages: Albums, Artists, Podcasts, Episodes (ui/library.rs)
- 8 space, title bold 28, 14, then a virtualised wrapping card grid (`virtual_wrapped_cards`: cards per row = floor((width+7)/(172+7)), row height = card + 14). Albums subtitle artists; artists round with "Artist"; podcasts "publisher", no disc; episodes are rows (EPISODE_ROW_HEIGHT). Footer: loading_row (8 above), error_row Retry, empty_state (icons Disc / Users / Mic / Bookmark: "No saved albums" / "Saved albums appear here.", "No followed artists"/"Followed artists appear here.", "No podcasts yet"/"Followed podcasts appear here.", "No saved episodes"/"Saved episodes appear here."), offline empty state; next page loads within 900 pt of the end. No sort/filter controls on these pages (the sidebar does that).

## 5. Quick reference: sizes

| Thing | Size |
|---|---|
| Sidebar width | 250 default, 210..600, margin L12 R8 T12 B8 |
| Nav row | 40 high, icon 22 at x22, label bold 15 at x46 |
| Library header buttons | 16 glyph, 28 hit, spacing 2 |
| Filter chip | text+14 high, text+24 wide, medium 13, spacing 6 |
| Sort button | min 28 high, radius 12, surface |
| Library row | 60 (32 compact), cover 44, text x = cover + 12, name medium 14 at -9, sub 12.5 at +10 |
| Library grid | min 108/card, 2..4 cols, text block 44, cover pad 8, play 32-44 |
| Top bar | 56 high, nav 32, search 34 high (200..440), icons 19 (31 hit), avatar 36 |
| Page | padding 24, top 4, bottom 48; spacing 8x6 |
| Quick tile | 60 high, cols floor(w/300) in 2..4, gap 10, play 40 |
| Card | 172 x ~247, art 148, pad 12, gap 7, play 44 |
| Top result | 232 high, art 96, title 26 bold, play 48 |
| Hero | cover 212 (160), title 56/40 bold, kind 12.5 medium |
| Actions row | play 56, icons 26, spacing 18, filter 220 |
| Track row | 56 / 48 / 36, header 34, heart 36, duration 56, more 36, number 44, cover 52 |
| Menu | item 28, width 200..300, radius 8, margin 6, separator 9 |
| Debounces/times | search 280 ms, tooltip 0.4 s, drag shift 0.12 s, history 12, nav history 60, relative dates 30 days |

## 6. Things that do not exist (do not invent)
- No history dropdown under the search field; no search suggestions or autocomplete.
- No sticky table header; no scroll-edge fades except the 24 pt chip-row fade and the grid-art mask.
- No carousel arrows or "Show all" on shelves; no snap scrolling.
- No active fill on nav rows; no divider between panels; no hover animation (fills switch instantly); skeletons never shimmer.
- No per-page sort UI on Albums/Artists/Podcasts pages; sort and filter for those live in the sidebar only.
- No separate mobile layout; the narrow form is just the 760 minimum with collapsed badges and fewer table columns.
