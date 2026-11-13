# Spotifast UI spec (audit b): rebuild-level

Source: native Rust, egui (immediate mode). All sizes are egui points (1 pt = 1 px at zoom 1; `settings.zoom` scales everything, src/settings.rs:381).
Paths are under the clone's `src/`. Cited as file:line. NOT deep-read: ui/friends.rs, artist.rs, show.rs, prerelease.rs, soloist.rs, update.rs, skin_cards.rs, winamp/wmp.rs (Windows Media Player skins), skin/script, mac_menu.rs. They reuse the same widgets below.

## 0. Reference screenshot (docs/screenshot.png, 1920x1200, dark, Home page)

```
+---------------+-----------------------------------------------+----------------------+
| Home          | <  >  (Search: Bonobo      x)   [shrink][vis][gear][avatar] | [Queue][Recent]  [list][x] |
| Search        |  Good evening  (30 bold)                      | Playing from  Late night focus |
|---------------|  [Liked Songs   ][Discover Weekly ]  4x2 tiles| Now playing                  |
| Library  [s][+][grid][panel] | [Late night focus][Sunday morning]| [art] Rosewood (green)  3:00 |
| (Playlists)(Albums)(Artists) | [Running 2026   ][Release Radar ]| Next up                      |
| (Podcasts)                   | [Berlin nights  ][Dinner party  ]| [art] Otomo      3:37 ...    |
| v Recently played            |  Made for you  (17 bold)        |  (rows 56 high, E badge)     |
| [art] Liked Songs  pin       |  [card][card]  (172 wide cards) |                              |
| [art] Discover Weekly        |  Recently played [card]...      |                              |
| [art] Late night focus  (vol icon green)                       |                              |
+---------------+-----------------------------------------------+----------------------+
| [art] Rosewood  (heart green) | shuffle prev (PLAY disc) next repeat | mic queue(green) devices vol-icon [===slider] |
|                               | 1:23 [=====-------------] 3:00       |                              |
|  spectrum bars (translucent green) paint behind the whole 88 px bar, full width        |
+-------------------------------------------------------------------------------------------+
```
Observations: sidebar and queue are a darker panel colour than the central window colour; both panels have no hard divider line (show_separator_line(false), ui/sidebar.rs:561, queue.rs:46). Active page nav row has no fill, only text colour change (sidebar.rs:1002-1020). Playing item is accent coloured (title in queue, sidebar row, plus a Volume2 icon at right). Pills (Playlists active) are filled with the text colour (inverted), others surface fill (theme.rs:839-846). Quick-access tiles 60 high with 60 px square cover (home.rs:76). Player bar fill is tinted by cover art at 12 % (player_bar.rs:15).

## 1. Window and layout skeleton

- Default main window 1240x800 pt; remembered size reused only if >= minimum (entrypoint.rs:894; window.rs:188-192). Minimum 760x520 (window.rs:188). Minimum width is raised dynamically while panels are open: sidebar min 210 + right panel min 280 + top-bar least width (ui/mod.rs:73-110, 201-209 "keep_room_for_panels"). Tiling WMs ignore it, panels then yield.
- Z-order/structure (ui/mod.rs:33-120): bottom player bar (exact 88) -> left sidebar -> right panels (queue | lyrics | friends, each its own `Panel::right`, can stack) -> central panel (top bar, optional banner, vertical page ScrollArea). Overlays: devices popup, dialogs, update dialog, drag ghost, toasts, caption buttons (custom title bar), resize handles.
- Sidebar: resizable 210..600, inner margin L12 R8 T12 (+macOS 28 traffic-light inset, +Linux left controls) B8 (sidebar.rs:542-585). Width persisted in settings only when the user drags or the page does not force it to yield (`yielding_panel`, ui/mod.rs:121-168).
- Right panels: min `SIDE_PANEL_MIN_WIDTH` 280 (theme.rs:246); queue max 560, lyrics max 640; margin symmetric 12 (queue.rs:37-53; lyrics.rs:39-55). They give up width down to min so the page keeps the room its top bar needs. Chosen width remembered and restored when the window widens.
- Central page padding `PAGE_PADDING` 24 (widgets.rs:19); scroll content margin top 4, bottom 48 (ui/mod.rs:350-360). Item spacing 8x6 (ui/mod.rs:330).
- Header wash: 340 high vertical gradient behind page hero; art tint blended into window colour at 0.45 on overviews (Home/Search/Settings/Queue), 0.85 on cover pages; else palette `tint` fading to transparent; scrolls away with the hero (ui/mod.rs:285-300, 448-470). Header shadow under a scrolled page: depth = scroll/24 clamped 0..1, 14 pt tall, black alpha 110 (dark) / 36 (light) (ui/mod.rs:476-492). Scroll-edge fade disabled (`fade.strength = 0`).
- Full-screen lyrics replaces sidebar/panels/central (ui/mod.rs:96-97). Immersive (MilkDrop behind everything) replaces everything except player bar/dialogs (ui/mod.rs:70-84; feature-gated `milkdrop`).
- Not signed in: login screen only (+update dialog, toasts, caption buttons). Soloist onboarding/loading likewise (ui/mod.rs:42-66).

## 2. Design tokens

### 2.1 Colour roles (theme.rs:17-86, `Palette`)
| Role | Use | Dark / Light value |
|---|---|---|
| window | central page bg | 0f1114 / f8f9fb |
| panel | sidebar, queue, lyrics, player bar base, noninteractive widget fill | 15181c / ffffff |
| surface | chips, tiles, search field, banners, settings cards, skeletons base | 1d2127 / eef0f3 |
| surface_hover | hover fill | 262b33 / e3e6eb |
| surface_active | pressed, switch-off track, EQ track | 2f353f / d7dbe1 |
| outline | 1 px borders, separators, grid lines | 2a3038 / dde1e6 |
| text | primary text, active-pill fill | f2f4f6 / 14171a |
| secondary | meta text, inactive icons | a9b1bc / 535b66 |
| dim | disabled text/icons, placeholders, empty-state icons | 6e7784 / 8b939e |
| accent (+accent_hover, on_accent) | playing, liked, active toggles, primary buttons, slider fill when active | 1ed760 (3ce87a, 0a140e) / 15a64a (128f40, white) |
| danger / warning | errors / warnings | f5717f / d63b4c ; f2b85c / b87a14 |
| overlay | menus, tooltips, dialogs, toasts, drag ghost | 22272e / ffffff |
| shadow | black alpha 140 / 50 | |
| tint | optional page-header gradient start (alpha = strength) | transparent |
Applied to egui visuals at theme.rs:328-428: selection bg = accent x0.35, selection stroke accent 1 px, window radius 10, menu radius 8, window shadow (0,6,blur 24), popup shadow (0,4,blur 16), widget radius 6, no widget strokes, slider handle circular, scroll bar 8 wide floating, handle invisible until active (0.55 opacity, 0.85 interacting), tooltip delay 0.4 s.
Hard-coded exceptions: nav circle buttons use black alpha 90 (dark) / 20 (light) (topbar.rs:171); slider track white alpha 50 / black alpha 40 (widgets.rs:3390); cover shadow only in dark; full-screen lyrics always use `Palette::dark()` (lyrics.rs:317-320).

### 2.2 Art tint
`tint_from_art(rgb)`: rescale HSL lightness to 0.30 (dark) or 0.72 (light) (theme.rs:89-106). Player bar fill = blend(panel, tint, 0.12), crossfade 0.45 s on song change, first frame no fade (player_bar.rs:15-17, 395-418). Setting "Colour from album art" (`accent_from_art`) gates page washes.

### 2.3 Palette sources and themes mechanism
- Built-in dark, light, Follow system (a light + a dark pair, `ThemePair`, theme.rs:165). Custom palettes are JSON files in a themes folder (`fastframe_theme::Catalog`): keys are the 17 role names above (theme.rs:117-137). Missing `overlay` derives: dark = lerp(window, text, 0.08); light = panel (theme.rs:146-155). Limits 512 folder entries, 128 themes. Eight shared presets are written as files on first launch; on Linux an Omarchy palette is imported via a packaged template + hook (theme.rs:171-181). `spotifast reload-themes` reloads. Status line under the Theme setting: Loading local themes / selected unavailable / unreadable / too many / Omarchy unreadable (theme.rs:202-233).
- Settings rows: Theme, Light mode theme, Dark mode theme (when Follow system), How to make a theme, Open themes folder, Language, Interface zoom (settings.rs:1226-1360).

### 2.4 Type (Inter, 4 weights; Lucide-style icons; Noto Emoji monochrome companion; system fallbacks for other scripts, theme.rs:430-441)
Base styles: Small 11.5, Body/Button 14, Heading 22, Mono 13 (theme.rs:396-403). Actually used: page greeting bold 30 (home.rs:51); settings title bold 28; hero title bold 56 (or 40 when cover <= 200 wide), shrinks by 6 until it fits down to 22 (collection.rs:150-170); section title bold 17 (theme.rs:1022); settings section bold 18; sidebar nav bold 15; sidebar "Library" bold 15/14/13 by room; row title medium 14-14.5; subtitle regular 12-13; time 11.5; badge E bold 9.5; pill button semibold 13; soft button medium 13; menu item regular 13.5; toast medium 13.5; search field regular 14. RTL text goes through `bidi` layout; truncation with ellipsis at the reading end (theme.rs:953-978).

### 2.5 Spacing / radii / heights
Radii: 8 (cards, banners, menus, toasts) `RADIUS`; 4 `RADIUS_SMALL`; widgets 6; covers 6 (cards, rows) / full circle for artists; tile cover 6; settings card 10; pills and chips: height/2 (fully round); play disc circle.
Heights: track row 56 (cover) / 48 compact / 36 thin (theme.rs:238-241); top bar 56 (48 on Windows custom title bar); player bar 88; menu item 28; nav row 40; sidebar list row 60 default, 32 compact (sidebar.rs:12-13) with 44 cover; search field 34; slider hit 16, track 4; switch 40x22; table header 34.
Cards: width 172, art 148 (width-24), pad 12, gap 14 (grid gap 7 x 14), title gap 10, title semibold 14, subtitle regular 12.5 reserving 2 lines, bottom pad 8 (widgets.rs:15-19, 2856-2900).
Icon button: icon size + 12 padding on each axis (ICON_BUTTON_PAD, theme.rs:577). Focus ring: 2 px outside expand, 4 radius, selection stroke (accent) (theme.rs:559-571).

## 3. Shared controls and states

| Control | Spec | Hover | Active/pressed | Disabled | Focus |
|---|---|---|---|---|---|
| icon_button (theme.rs:580) | frameless glyph, colour secondary | colour -> text (or accent_hover when active toggle) | glyph scale 0.92 while pointer down | n/a (parents use add_enabled_ui; colour dim) | focus ring, same colour as hover |
| circle_button (659) | disc, play glyph optically offset (0.03-1/24 of size) , icon = 46 % of disc | disc grows x1.05, fill -> hover colour | n/a | n/a | ring |
| circle_spinner (694) | same disc with 250-degree arc spinner 55 % | | | | |
| pill_button (725) | 13 semibold, pad 18x8, round; primary = accent fill + on_accent text; else 1 px outline dim | primary -> accent_hover; outline -> text colour | | | ring |
| soft_button / chip (766) | 13 medium, pad 12x7 (+icon 15 + 6 gap), round; fill surface | surface_hover | active = fill text, label window colour | | ring; dismissible variant turns icon into X on hover |
| chips row (widgets.rs:3411-3492) | horizontal scroll, spacing 8, hidden scrollbar, 24 px right fade when overflow | | | | clicking scrolls chip into view |
| wrapped_chips | wraps to rows | | | | |
| link text (981) | underline 1 px on hover, pointing-hand cursor | | | | ring |
| search_field (3567) | 34 high pill, surface; focus: surface_hover + 1.5 px stroke text x0.6; 16 search icon at x=18; field inset 34 left, 30 right; clear X (15) appears when non-empty and refocuses field; hint colour dim | | | | |
| thin_slider (3288) | 16 hit, 4 track radius 2; fill = text colour, accent when hover/focus/drag; 6 px radius white thumb only when active; click commits, drag previews then commits on release; wheel step (volume 5 %), 50 pt per wheel notch; Left/Right keys step 1 % (or wheel step); accesskit increment/decrement/set | | | volume slider via `add_enabled_ui` | key focus lock for arrows |
| switch (3668) | 40x22, knob r 8 white, track lerp surface_active -> accent, animate_bool (0.12 s) | | | | ring |
| menu (428-520, 663) | frame overlay fill, outline 1, radius 8, margin 6, shadow (0,6,20); items 28 high, radius 6, hover surface_hover; icon 16 at x+10, label from x+26, 13.5; disabled = dim text + hover-only sense; separator 9 high line inset 6; keyboard-highlight state supported | | | | |
| text_edit (3494) | native clipboard actions + selection-aware menu | | | | |
| explicit_badge (2524) | 15x15, radius 2, secondary fill, "E" bold 9.5 window colour | | | | |
| spinner (931) | arc 250 degrees, 1.2 rev/s, stroke 2, repaint every 33 ms | | | | |
| loading_row (3185) | 18 spinner accent + "Loading..." subtle | | | | |
| skeleton rows/cards (3064-3182) | static (no animation) shapes in surface_hover x0.9: 40 cover r4 + two bars (10 and 8 high, width shares 0.62/0.48/0.71/0.55/0.4, second line x0.7); cards 148 art + 12 and 9 high bars; accessible label "Loading..." | | | | |
| error_row (3206) | CircleAlert 16 danger + message 13 secondary + soft "Retry" with Refresh icon; URL-ish/network errors replaced by "Network connection error. Check your connection." | | | | |
| empty_state (3233) | 48 top space, 40 icon dim, title semibold 16 text, body regular 13.5 secondary, centered | | | | |
| toast (ui/mod.rs:703-757) | bottom-right, offset (-20, -(88+16)); overlay fill, outline, r8, margin 14x10, shadow (0,4,16); icon 16 (CircleCheck accent / CircleAlert danger) + 13.5 medium text wrapped at 280; stack gap 8; fade in 0.15 s, hold, fade out 2.8-3.2 s; not interactive | | | | |
| banner (ui/mod.rs:565-650) | under top bar: surface fill, outline, r8, margin L16 R6 T12 B12 outer L/R 24 B8; bold 14 title (+14 spinner when busy), 13 secondary body, pill buttons (first primary), X close 16 | | | | one banner at a time: soloist > audio-key > slow-app; hidden on Settings or while a dialog is open |
| drag ghost (widgets.rs:2470) | pointer+(16,6), overlay chip r8, 24 cover r4 + label medium 13, max 280 wide, opacity 0.9, tooltip order | | | | |
| tooltip | egui tooltip after 0.4 s | | | | |

## 4. Top bar (ui/topbar.rs)
```
[panel-left*] [house*] ( < ) ( > )  [ (search) What do you want to play?        (x) ]  [badge: Playing on X] [badge: Update] [spinner] [shrink] [audio-lines] [gear] (avatar 36)
```
`*` only when the sidebar is hidden (topbar.rs:263-296). Height 56 (+macOS 28 inset, built into content height); left padding 24; spacing 8.
- Nav buttons: 32 circle, fill black alpha 90/20, icon 20; colours secondary -> text on hover/focus, dim when disabled (no history), tooltips Back/Forward (topbar.rs:157-195). Mouse back/forward buttons navigate (keys.rs:201-213).
- Search field: hint "What do you want to play?"; width = clamp(room*0.5, 200, 440); min 130 before badges collapse to icons, hard min 80 (topbar.rs:30-100). Typing opens Search page and runs `Search(query)`; Esc/clear ends the search run.
- Badges (12.5 medium accent): "Playing on {device}" / "Playing on another device" (click toggles devices popup), "Update to {version}" / "Downloading update..." / "Update ready" (click opens update dialog). Collapse to a 27x27 icon-only chip when the bar is too narrow; width padding 28 / 32 (topbar.rs:21-27, 88-111).
- Background activity spinner 15: tooltip "Updating your library..." / "Checking for updates..." / "Waiting for Spotify..." (topbar.rs:600-610 region).
- Right buttons (icon 19, hit 31): Full-screen/mini player (Shrink icon, tooltip "Mini player (Ctrl+M / Cmd+Shift+M)"), MilkDrop visualiser (AudioLines, only if available; tooltip with Ctrl/Cmd+Shift+K), Settings (gear). Avatar 36 round; if offline shows WifiOff with tooltip.
- Account menu (avatar click): name/header, Settings, Keyboard shortcuts, separator, Sign out (LogOut icon).
- Responsive: if caption buttons would overlap, bar is pushed down by their height (`controls_reservation`, ui/mod.rs:446-475); when a queue/lyrics panel is open the panel owns the caption-button row. Empty areas drag the window when a custom title bar is on.

## 5. Sidebar / Library (ui/sidebar.rs)
```
[ Home ]       nav row 40: 22 icon at x=22, label bold 15 at x=46
[ Search ]
----------------- (outline 1, inset 4)
[lib icon 22] Library        [search][+][grid/list][panel-left]   (icons 16)
(Playlists)(Albums)(Artists)(Podcasts)  soft chips, wrap, gap 6
[Recently played v] sort menu   [By You] (Playlists only)
[search field "Search in Your Library"] (toggled by the search icon)
rows: pin/liked/playing marks at right
```
- Nav rows: text/icon secondary, text when active or hovered; no fill (1002-1030). Home -> Home; Search focuses the top-bar field.
- Row (default 60, art 44, radius 6 or 22 for artists; name medium 14 at cy-9, subtitle regular 12.5 secondary at cy+10; subtitle format "Playlist . 14 songs" / "Album . Artist"): active page = surface fill r6; hover = surface_hover x0.6; playing = accent name + Volume2 16 accent at right-16; pinned = Pin 13 secondary; drop-hover (a dragged song over an editable playlist/Liked) = accent x0.18 fill + 1.5 accent stroke; non-droppable rows dim (panel x0.5) while a song drags; hover on cover shows a play/pause overlay (cover_play_button). Folder rows: chevron 16 + library icon 20, indent 14 per depth.
- Compact (32 high, `sidebar_compact`): name only medium 13.5.
- Grid view: min card 108, max 4 columns, 44 text block, play button = 30 % of cover clamp 32..44 at bottom-right, pin button 20 at top-left; drag reorder slots (sidebar.rs:1733-1760, 144-156).
- Sort menu, filters: Playlists/Albums/Artists/Podcasts, "By You". Lazy loads shelf on selection. States: Loading rows, Failed -> error_row + Retry, empty list, filter no match.
- Drag reorder: rows shift +-4 pt with a 0.12 s ease (`animate_value_with_time`, reduce-motion aware) and a 2 px accent insertion line (sidebar.rs:1501-1514, 1670-1690).
- Expanded art dock: `art_expanded` docks the now-playing cover large at the sidebar bottom (gap 10); entered by the chevron-up button over the cover in the player bar.
- Context menu per row (entry_menu 2015): play, pin/unpin, delete/remove, etc. (menu widgets).

## 6. Pages (central)
- **Home** (home.rs:15-75): offline state = WifiOff 54 dim, "You're offline" bold 28, body 14 secondary, centered at (height-160)/2. Else greeting bold 30 (time-of-day), 8 quick-access tiles: columns = floor(width/300) clamped 2..4, gap 10, tile 60 high, surface fill r6, hover surface_hover, cover 60 square, title bold 14.5 clipped; hover shows 40 accent play/pause disc at right-28 (text area shrinks 12 -> 52). Then shelves in order (each hideable in settings): Made for you, Top mixes, New releases, Recently played, Podcasts, Top artists, Top tracks, Recommendations. Shelf = section_title 17 bold, horizontal scroll area of 172 cards, spacing 7, 12 below; "linked shelf" titles are underlined links. Skeleton cards while loading; error rows with retry.
- **Card** (widgets.rs:2874): hover fill surface_hover (x0.8 dark) r8; cover r6 with dark-mode drop shadow (0,10,blur 28, alpha 120); circular for artists; play disc 44 accent at cover bottom-right-26 shown on hover (pause icon when playing); focus ring; scroll-into-view on focus; right-click menus.
- **Hero** (collection.rs:98-232): 212 cover (160 if width <= 720), gap 24, kind label medium 12.5, title bold 56/40 autoshrink, description (collapsible html), byline: 18 avatar + "." separators + links semibold 13.5. Cover click opens "Enlarge cover" dialog. 20 below.
- **Track table** (widgets.rs:1672-1750): columns: # (44; 0 compact), cover (52; 44 compact), title/artist, album (28 % clamp 140..360, needs width > 560), added by (130, > 920), added (120, > 760), plays (120, > 560), heart 36, duration 56, more 36. Header 34 high 12 regular, sortable columns draw a drawn (not glyph) arrow, active sort = accent. Row states: hover = surface_hover x0.7 (light x1.0); picked (selected) = secondary x0.20 (hover 0.30); playing = accent title + AudioLines 16 accent in the number/cover cell; hover shows Play/Pause 14; pending = spinner 16 (cover: white 16); unavailable = dim title, no play, no hover; keyboard focus shows row highlight, no outline on mouse focus; subtitle colour text on hover else secondary; "E" badge for explicit; drag payload on cover/title/artist; right-click item menu; Shift+Up/Down extends selection.
- **Search** (search.rs): header "Search Spotify"; before query "Recent searches" with clear; results "Top result", Songs, Artists, Albums, Playlists, Podcasts, Episodes; subtitle forms "Song . {artist}", "Album . {artists}", "Playlist . {owner}"; empty: "No results for "{query}"" + "Check the spelling, or try fewer words."; offline state.
- **Library pages** (Albums/Artists/Podcasts/Episodes, library.rs): card grid with footer load-more / skeleton filling previous height.
- **Queue page / panel** (queue.rs): panel header = chips [Queue][Recent] (spacing 8) left, right side: X close 18, "Save as a playlist" ListPlus 18 (only Queue tab with queue content). Body ScrollArea, right content margin 12. Queue tab: "Playing from {source link}" (13), "Now playing" semibold 14, one track row, "Next up" with rows (compact 48 high in the panel, 56 on the page), section gap 14; Trash "Clear queue" when clearable. Empty: ListVideo icon "Nothing queued" / "Queued songs appear here." Loading row; Failed -> error_row. Recent tab: rows, "No recent plays"/"Played songs appear here.", "Load more" button, Retry. Drag-drop: songs dropped on the panel append (or insert at position if reorderable); rows shift 4 pt with 0.12 s ease; dropping on the player bar queue button queues.
- **Lyrics panel** (lyrics.rs:39-316): header "Lyrics" bold 18, right: X, Expand (full screen), "Follow" pill (only when scrolled away from the sung line). Lines regular 19, gap 10, quiet colour = text x0.45 blending to accent over 0.22 s when active (font flips to bold at lit > 0.5), unsynced lyrics scroll proportionally to song position. Click a synced line = seek + resume following. User scroll turns following off. Sung line sits at 20 % from top (`SUNG_LINE_AT`). Empty/states: Nothing playing/"Play a song to see its lyrics.", offline, loading, "Couldn't fetch the lyrics: {error}" + "Try again" pill, "No lyrics"/"No lyrics found for this track.", "Instrumental"/"No timed lyrics for this track." (music icon). Musical note glyph for empty synced lines.
- **Full-screen lyrics** (lyrics.rs:317-1051): always dark palette; backdrop = blurred cover (glow 0.2, dim 0.2..0.32) or MilkDrop behind (click empty space toggles). Window >= 900 wide: cover large beside lyrics column max 640 (`COVER_BESIDE_MIN_WIDTH`); else single column with 52 cover heading, title semibold 22 white, subtitle 13 grey 235. Header "Lyrics" bold 18, Shrink button (Esc), Follow pill. Line size = clamp(width*0.046, 28, 42) bold; active line grows x1.15 and lights quiet -> accent over 0.3 s (quiet 0.42 or 0.62 with MilkDrop); edge fade by smoothstep over 2 line heights; gap 27; scroll animation 0.45 s; open queue becomes a column 240..380 wide (queue.rs:151-166). Escape leaves.
- **Settings** (ui/settings.rs): title bold 28 + search field (max 400, hint "Search settings"); sections in order: Spotify Soloist, Account, Playback, Appearance, Proxy, Mini player (Winamp / Windows Media Player skins), MilkDrop (feature), Equalizer, Storage, About. Section = bold 18 title, card surface (x0.7 dark) + outline, r10, margin L/R 20 T16 B6, width max 760; rows: label medium 14 + description regular 12.5 secondary + control right (control width 260, text min 140, widgets.rs:3720-3760); row filter matches title or description case-insensitively; sections with no match hidden. Notable controls: theme pickers, interface zoom, frame-rate dial, setting_slider (rail + value box), switches, "Apply and restart playback" button with dirty flag, skin chips/cards with preview thumbnails, EQ (below).
- **Settings EQ** (settings.rs:2798-2905): ten vertical sliders 30x118, 4 px track surface_active, fill accent (dim when EQ off), zero line dim, handle 7 text, value bubble "+x.x" on hover/drag 11 px; double-click resets to 0; labels 11.5 secondary; response curve plot 120 high max 720 wide, grid lines at -12/-6/0/+6/+12 dB and the ten band frequencies, curve 2 px accent (dim if off), 240 samples log 20 Hz..20 kHz, 3 px band dots.
- **Devices popup** (devices.rs:376): anchored above the player-bar devices button, 320 wide, menu frame, header "Connect to a device" bold 16, spinner or Refresh 15; rows: "This computer", network devices ("On your network, click to connect"), "Listening on this device", "Play here", "Set up playback here", "Setting up...", "Connecting...", Restricted; audio-output sub-list: "Audio output", "System default", "Finding audio outputs...", "Couldn't list this computer's audio outputs.".
- **Dialogs** (dialogs.rs:14-210): CoverArt, PersonalAppIntro, CreatePlaylist, EditPlaylist (name, public, image), ConfirmDeletePlaylist, ConfirmPlaylistDuplicates, Shortcuts, PremiumNeeded (+ update dialog, login help). Windows use `window_fill` overlay, 10 radius, margin 16, shadow (0,6,24).
- **Login** (login.rs): centred card; logo disc (the app icon art); title bold 30 (26 in setup steps), tagline "A native Spotify client." 14.5; "Sign in with Spotify" primary pill; states "Connecting to Spotify...", "Waiting for Spotify in your browser...", "Didn't open? Open the sign-in page again", "Your Spotify sign-in expired. Please sign in again."; personal-app guide steps (Register Spotifast: open developer dashboard, Redirect URI copy with "Copy"/"Copied", tick Web API, paste Client ID, "Apply settings"), "Proxy Settings" form, danger-coloured problem text.

## 7. Player bar (ui/player_bar.rs)
```
|<-side(30% of width, clamp 200..420)->|<------ center ------>|<-side->|
| [56 cover] Title (14 medium link)     |  (shuf)(prev)(  PLAY  )(next)(rep)  | [fullscr][vol slider 92][vol icon] [devices][queue][mic][users] |
|            Artist, Artist (12 links) (heart 30)| 1:23 [=== progress 120..620 ===] 3:00 |
```
- Bar: exact 88, margin L/R 16, top 1 px outline hline at y+0.5, fill panel tinted by cover 12 %. Visualizer paints behind the whole bar including margins; click on empty space cycles Off -> Spectrum -> Waveform -> Off (if `player_bar_vis_click`, tooltip "Click to change the visualizer", appears only over empty space) (player_bar.rs:60-85; settings.rs PlayerBarVis 85-100).
- Left: cover 56 at x+4, radius 6; hover on cover (when art is available, sidebar visible, not yet docked) shows 18 circle chevron-up (panel x0.9) at the cover's top-right to dock art; cover/title click opens Album/Show page; cover grabs (drag song). Title is a link; artists comma-separated links (non-link if no id); heart sits just right of the text (30 hit, icon 17): outline secondary -> HeartFilled accent when saved; tooltip "Save to Liked Songs" / "Add to playlist". A click on an already-liked heart opens a checklist popup (playlist_picker with filter field, checks applied on "Done" pill, closes on outside click; first click on an unliked song likes immediately). Right-click cover/title: full song item menu. No heart for episodes. Empty state: Music placeholder cover, "Nothing playing" medium 14 secondary, "Pick a song, album, or playlist" regular 12 dim.
- Transport (cells 29,30,36,30,29; gap 10; cluster centred 8 above the midline): Shuffle (17, accent when on; selected-state accessibility), Previous (18 filled), Play/Pause disc 36 (text fill, window colour glyph, hover white in dark / text in light; spinner variant while loading or any play pending, tooltip "Loading..."), Next, Repeat (17; Off secondary "Repeat", context accent "Repeat one"... tooltips as coded: Off "Repeat", Context "Repeat one", Track "Repeat off" with Repeat1 icon). Icons dim when no control available (not connected).
- Progress row 31 below the cluster midline: time 11.5 right-aligned 8 left of the slider (secondary, dim if idle), slider width = clamp(centerWidth-120, 120, 620), total time left-aligned 8 right of it; drag shows live preview time (seek_preview), commit on release.
- Right band (30 high, right-to-left, spacing 6): Full screen lyrics (Expand/Shrink 18; hides first below width: needs `EXTRAS_WIDTH+18+12+6+10`), volume slider 92 (wheel step 5 %), volume icon 18 (X / Volume / Volume1 / Volume2 by 0, <=33, <=66, above; click = mute/unmute; disabled with tooltip "This device's volume can't be changed from Spotifast" for remote devices that refuse), 4 pt gap, devices (Speaker; remote device kind icon in accent), Queue (ListVideo, accent when panel/page open; accepts drops), Lyrics (Mic, accent when open), Listening activity (Users; first to disappear when narrow).
- Visualizer drawing (player_bar.rs:23-40, 262-395): spectrum bars gap 2, fill alpha 0.28 (foot) -> 0.08 (top), glow 0.12 wider by 3, peak cap 2 px with gap 2 at alpha 0.7, foot pulse with bass^2 at 0.35; waveform = 3 layered strokes (9/4/1.6 px at alpha 0.06/0.16/0.85), shaded fill 0.14, mirrored echo -0.6 at 0.18; amplitude reach 46 % of height; colours swept across cover palette clamped to brightness 0.35 (dark) / 0.2..0.4 (light); light themes paint x1.5 stronger. Frame pacing from `power::visualiser_fps` (user fps, half out of focus, <=30 in saver, none when hidden).

## 8. Mini player: Winamp/skin mode (winamp.rs; ui/winamp/*; skin/*)
A separate borderless window (main window and mini are mutually exclusive; switching closes one and opens the other, ui/winamp/mod.rs:1-8). Toggle: Ctrl+M (Cmd+Shift+M mac), top-bar button, Eject, logo, About area.
```
Full (275x116 skin px):   Shade (275x14):
+----------------------------------+   +---------------------------------+
|[O] title bar (drag) [_][shade][x]|   |[logo]  vis  time |<>|>||[]>|^  pos|
|[clutter O A I D V] [status][time]|   +---------------------------------+
|  visualizer 76x16   marquee 154x6|   EQ window 275x116 (shade 14)   Playlist 275 x 116..696 (step 29; shade 14)
|  kbps khz  mono|stereo           |   MilkDrop pane (any height 116..960, same width)
|  volume 68x13 balance 38x13 [EQ][PL]|
|  position 248x10                 |
| |<  >  ||  []  >|  ^   shuf rep  (about)|
+----------------------------------+
```
Coordinates (skin/layout.rs:30-90): title bar (0,0,275,14); options (6,3), minimize (244,3), shade (254,3), close (264,3) all 9x9; clutter bar (10,22,8,43) with lamps O/A/I/D/V; status (26,28) 9x9; time digits at x=48/60/78/90, 9x13; marquee (111,27,154,6); kbps (111,43), khz (156,43); visualizer (24,43,76,16); mono (212,41), stereo (239,41); volume (107,57,68,13); balance (177,57,38,13); EQ button (219,58,23,12), playlist button (242,58,23,12); position (16,72,248,10); previous (16,88,23,18), play (39), pause (62), stop (85), next (108), eject (136,89,22,16), shuffle (164,89,47,15), repeat (210,89,28,15), about (253,91,13,15).
- Scale: 1..4 (`MAX_SCALE`) whole screen-pixels per skin pixel, nearest-neighbour; default = 2 x display scale for classic skins, 1 x for WMP skins; menu "Size 1x..4x"; clutter D lamp cycles size; window is hard-fitted (min=max=inner size) (winamp.rs:226-239; winamp/mod.rs:104-125).
- Skin mechanism: `.wsz/.wmz/.zip` archive or folder of bitmaps in the skins folder; listed on a worker thread (fresh 5 s); missing sheets fall back to the built-in classic skin; modern `.wal` skins rejected with an error string; skins may be dropped onto any window -> InstallSkin; per-skin preferences JSON for WMP (winamp.rs:48-80, 160-200; skin/mod.rs:1-45). Sprite sheets, `region.txt` masks (non-rectangular windows; painting is clipped per row by the mask, winamp/mod.rs:173-200), `viscolor.txt` palette (24 colours) drives the visualizer, `pledit.txt` colours the playlist/menus, `nums_ex` extended digits, `gen.bmp` generic frame for MilkDrop (TOP 20, BOTTOM 14, LEFT 11, RIGHT 8, min 275x116; skin/generic.rs:15-25). "Random skin each time the mini player opens" setting.
- Controls and states (all emit main-app actions): 
  - Buttons use pressed sprites while the pointer is down; lamp buttons (clutter A/I/D/V, EQ, PL, shuffle, repeat) show a lit sprite when on. Tooltips: A "Always on top" (or Wayland message), I "Song info" (opens album/show in the big window), D "Size: 1x, 2x, 3x, 4x", V "Visualisation".
  - Play: restarts from 0 if stopped else toggles; Pause toggles; Stop = pause + seek 0; Eject = back to big window ("Open the big window"); About = back to big window.
  - Title bar: drag moves window, double-click shades; right-click or clutter O = options menu: Size 1x-4x, Always on top (disabled with Wayland tooltip), Show in taskbar (where supported), MilkDrop checkbox (shortcut tooltip), Choose a skin (opens Settings), Big window, Quit.
  - Status lamp: playing / paused / stopped; work indicator lit while loading; stereo/mono lamps (click to choose; off when stopped).
  - Time display: click toggles elapsed / remaining ("-" sign); paused = blinks at 1 Hz (hidden on odd half-seconds); stopped = blank; seek preview shows the drag target.
  - Marquee: 31 chars wide (30 whole), scrolls one char every 220 ms with "  ***  " gap when text > 30; shows transient text: "Volume: n%", "Balance: n% left/right/center", "Seek to: m:ss/m:ss (n%)", toast notices (no toast window here), default "Artist - Title (m:ss)", idle "Spotifast"; text outside the skin font falls back to a pixel-rendered raster of the system font (marquee_pixels).
  - Sliders: volume (wheel step), balance, position (thumb 29); previews update the marquee.
  - Visualizer 76x16 (full) or 38x5 (shade): click cycles Bars -> Scope -> Off; bars 19 with falling peaks (colour index 23), scope 75 columns; every second pixel dotted in colour 1 when not compact; idle: repaint every 220 ms.
- EQ window (ui/winamp/equalizer.rs): title bar drag/shade/close; ON (14,18,26x12) toggles; AUTO (40,18,32x12) = flatten bands (comment: Spotify has no per-song equivalent); PRESETS (217,18,44x12) opens a skin-styled scrolling menu: 18 Winamp presets (Flat, Classical, Club, Dance, Full Bass, Full Bass & Treble, Full Treble, Laptop Speakers / Headphones, Large Hall, Live, Party, Pop, Reggae, Rock, Ska, Soft, Soft Rock, Techno) | extra: Bass Booster, Bass Reducer, Treble Booster, Vocal Booster, Small Speakers, Spoken Word, Loudness, Night Listening | saved user presets; current one drawn selected. Graph (86,17,113x19) shows the response; preamp slider (21,38,14x63) + ten band sliders, thumb 11, travel 52, +-12 dB; shaded EQ has volume (61,4,97x7) and balance (164,4,43x7) sliders (thumb 3). Tooltips "Roll the equalizer up/down". Frequencies 60, 170, 310, 600, 1k, 3k, 6k, 12k, 14k, 16k (eq.rs:15).
- Playlist window (winamp/playlist.rs): frame tiled (title 20, bottom 38, left 12, right 20, tile 25x29, row height 13), resize grip steps of 29 up to 116+29*20, scrollbar (handle 18), numbered rows "N. Artist - Title" in pixel font, wheel = 3 rows per notch, click selects, double-click plays, running/track time, mini transport at (128,22); menus: ADD (Search Spotify, Liked Songs), REM (Remove selected, Remove all; disabled with tooltips "You can only change/clear this computer's queue."), SEL (All, None, Invert), MISC (Song info, Artist), LIST (Load list of playlists, "No playlists yet", Save list = "Save the queue as a new playlist"). Shade 14 high.
- MilkDrop pane (winamp/milkdrop.rs, src/milkdrop.rs): docked under the stack in the gen.bmp frame; resize grip with vertical-resize cursor (min 116, max 960); button/tooltip "Full screen with lyrics". Visual engine runs as a child process (`--milkdrop-child`, libprojectM, shared-memory audio ring, frames via shm) and is opt-in (feature `milkdrop`, no bundled presets; "Get presets" downloads packs; "Presets", "Time per preset", "Frame rate", "Resolution" settings; default window 640x480). Overlay text (milkdrop/overlay.rs): reference 480 high, margin 14, pad 10, 0.9 s fade, key help box alpha 190 radius 8, shadow offset 1, song title drifts +6 % while fading. Keys in full-screen lyrics: V toggles MilkDrop behind words, N/P next/previous preset.

## 9. macOS notch widget (notch.rs; mac_notch.rs)
Overlay window shown only when: enabled, app NOT in foreground, a track exists, and a display has a notch (notch.rs:49-57). Geometry (notch.rs:183-216): collapsed = 200x(notch inset) wide centred under the top edge (or screen width if smaller); expanded card = 400 x 148 with 8 gap below the notch; total = notch + 8 + 148. Hover enters -> expand after 60 ms delay; leave -> collapse after 400 ms (mac_notch.rs:1203, 1222). Expand animation 0.26 s (card frame + alpha 1); collapse 0.20 s (alpha 0), window frame snaps instantly; track change flash 0.22 s; transitions use 0.30/0.20 s grouping elsewhere (mac_notch.rs:1138-1159, 1516, 1561-1569). Commands: PlayPause, Next, Previous, ShowWindow, ToggleSaved(uri) (hidden for episodes), Seek, ToggleShuffle, CycleRepeat; includes progress bar, elapsed/total fields, artwork file, accent colour from art. No-op stubs on other platforms (notch.rs:260-266). Setting "MacBook notch widget".

## 10. Motion system
Single reduce-motion switch (motion.rs). Source of truth: Windows `SPI_GETCLIENTAREAANIMATION`, macOS `accessibilityDisplayShouldReduceMotion`, Linux desktop portal animations flag (false = reduced). Polled at most once per second, portal change applies immediately (motion.rs:17-50). When reduced: egui `animation_time` -> 0, scroll animation off, `motion::seconds()` returns 0 so every view animation snaps to its end state; `motion::scroll()` jumps (motion.rs:63-95). Applied through `all_styles_mut` and a context flag read by views.
| What | Duration | Easing |
|---|---|---|
| Hover/expand/switch/state changes (egui default) | 0.12 s (`ANIMATION_TIME`, theme.rs/motion.rs:14) | egui linear-ish interpolation |
| Reorder drag row shift (sidebar, queue, collection) | 0.12 s, +-4 pt | value animation |
| Lyric line light-up, side panel | 0.22 s colour blend + bold flip at 0.5 | bool animation |
| Lyric line light-up, full screen | 0.3 s colour + 1.15x grow | |
| Full-screen lyrics scroll to sung line | 0.45 s | egui scroll animation |
| MilkDrop backdrop dim when lyrics shown | 0.5 s (lyrics.rs:607) | |
| Player-bar tint crossfade | 0.45 s, none on first frame / without art | per-channel animate_value |
| Toast | in 0.15 s, out 0.4 s ending at 3.2 s | alpha ramp (own code; not reduce-motion aware) |
| Spinner | 1.2 rev/s, repaint every 33 ms | |
| Icon button press | scale 0.92 instantaneous; circle button hover x1.05 | |
| Winamp marquee step | 220 ms per char; paused time digits blink 1 Hz | |
| Visualizers | display rate or user fps; `repaint_after` compensates egui's 1/60 predicted dt (theme.rs:867-928); beat-based pacing | |
| macOS notch | 0.26 s open, 0.20 s close | NSAnimationContext |
| Skeleton loaders | static, no animation | |
Visualizer animation is not disabled by reduce-motion (only egui and the listed view animations are); the user switches it off with the player-bar mode "Off".

## 11. Keyboard shortcuts (ui/keys.rs; dialog list at 276-355; mac uses Cmd, else Ctrl; "COMMAND")
Global (work everywhere except sign-in/onboarding where only Quit and Close apply):
- Ctrl/Cmd+Shift+A open current artist; +Shift+B open current album/show (keys.rs:58-67)
- Ctrl+Shift+Q queue panel (mac: Cmd+U); Ctrl/Cmd+F focus search; Ctrl/Cmd+B toggle sidebar; Ctrl/Cmd+, Settings; Ctrl/Cmd+Q quit; Ctrl/Cmd+W close window
- Ctrl+H Home (mac Cmd+Shift+H); Ctrl/Cmd+L Liked Songs; Ctrl+M mini player (mac Cmd+Shift+M); Ctrl/Cmd+Shift+K MilkDrop; Ctrl/Cmd+/ shortcuts dialog
- Not while a text field is focused: Space play/pause; Alt+Left/Right back/forward; Ctrl/Cmd+Left/Right previous/next; Ctrl/Cmd+Up/Down volume +-5
- Not in text field and no dialog open: ? shortcuts; Shift+Left/Right seek +-10 s; M mute; S shuffle; R repeat cycle; Q queue panel (unless songs picked, where Shift+Q queues them); L lyrics panel; / focus search; F full-screen lyrics (or MilkDrop full-screen when framed); B like/unlike playing song (not episodes); V/N/P in full-screen lyrics with MilkDrop; Esc closes dialog / leaves full-screen
- Song list: Shift+Up/Down extend selection, Shift+Q add to queue, Shift+N play next, Delete remove from playlist, Ctrl/Cmd+A select all, +C copy links, +X cut, +V paste links; PageUp/PageDown/Home/End scroll page (`scroll_page`, keys.rs:228-270)
- Slider focus: Left/Right step; mouse Extra1/Extra2 = back/forward. Dialog title: "Keyboard shortcuts" lists these rows (key column then description; key names stay English).
Accessibility: every custom widget publishes accesskit info (labelled button, checkbox for toggles, slider with numeric value 0..100 and increment/decrement/set-value), "Loading..." labels on skeletons.

## 12. Density and responsive rules
- Density toggles: `sidebar_compact` (60 -> 32 rows, no cover), compact track list (56 -> 48 rows with 44 cover; `thin` 36, one line no cover), interface zoom (Ctrl+plus/minus; per-window), mini-player scale 1..4.
- Breakpoints: window min 760x520; hero cover 212 -> 160 below 720 content width; quick-access tiles 2..4 columns at 300 px per column; track table drops columns at width 560 (album, plays), 760 (added), 920 (added by); search field narrows 440 -> 200 -> 130 -> 80 then badges collapse to icons; player-bar side regions clamp(30 % width, 200, 420) and drop Listening activity, then Full-screen button, as width shrinks; right panels shrink to 280 min then the page keeps its room; full-screen lyrics splits cover/lyrics at width >= 900; lyric size 28..42 by width; settings content max 760.
- No separate "mobile" layout; the "compact/mini" form is the Winamp mini player (section 8) and the shaded windows. Windows custom title bar changes top bar to 48 and adds 4 top padding; macOS leaves 28 for traffic lights (theme.rs:260-271); Linux custom title bar buttons may sit left of the sidebar.
- i18n: 17 locales (en, de, es, nl, pt-BR, pt-PT, fr, sv, pl, ru, it, ja, ko, zh-Hans, zh-Hant, tr, uk; i18n.rs:10-46) via gettext catalogs; RTL text aware (bidi.rs); strings use `{placeholder}` tokens (e.g. "Playing on {device}"). Headings shrink 15 -> 14 -> 13 for long translations (sidebar.rs).

## 13. Rebuild notes (MaiPai mapping hints)
- Everything is colour-role driven except the few literals in 2.1; a token set of 17 roles is enough to re-skin.
- Interaction model uses "action push" (UI emits `Action`s, app applies them), so the web/React port can keep a similar command layer.
- Anti-patterns to avoid copying: pixel-measured offsets in the player bar (explicit rects because of egui centring), custom drawn controls with manual accessibility; use real elements with the same sizes instead.
