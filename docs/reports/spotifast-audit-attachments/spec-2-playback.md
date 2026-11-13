# Spotifast playback UI: rebuild-level spec

Source: `repo/` (Rust, egui, tag fastframe v0.16.1). All paths are under `src/`. Units are egui points (1 pt = 1 logical px; the reference screenshot is 2x). "PB" = `ui/player_bar.rs`, "Q" = `ui/queue.rs`, "LY" = `ui/lyrics.rs`, "WA" = `ui/winamp/mod.rs`, "W" = `ui/widgets.rs`, "T" = `theme.rs`.
Things I looked for and did NOT find are marked **ABSENT** so the rebuild does not invent them. Things not read in depth are marked **UNVERIFIED**.

## 0. Shared foundations

### 0.1 Type and icons
- Font: Inter (Regular, Medium, SemiBold, Bold) via `theme::regular/medium/semibold/bold(size)` (T:273-290). Icons: Lucide glyphs through `theme::Icon` (Shuffle, SkipBackFilled, SkipForwardFilled, PlayFilled, PauseFilled, Repeat, Repeat1, Volume, Volume1, Volume2, VolumeX, Heart, HeartFilled, Mic, ListVideo, Users, Speaker, Expand, Shrink, ChevronUp, X, ListPlus, Trash, Ellipsis, Clock, Music, WifiOff, AudioLines, CircleAlert, Refresh).
- Pixel font for Winamp playlist/marquee fallback: system Arial-equivalent (pledit face) at 11 px, monochrome hinted, no anti-alias (`ui/winamp/pixel_text.rs:15,32`).

### 0.2 Palette roles (T:42-86). Dark / Light
| role | dark | light | use here |
|---|---|---|---|
| window | #0f1114 | #f8f9fb | play-disc glyph, spinner arc, fullscreen base |
| panel | #15181c | #ffffff | player bar fill, queue/lyrics panel fill |
| surface | #1d2127 | #eef0f3 | chip (tab) rest fill |
| surface_hover | #262b33 | #e3e6eb | chip/row hover |
| outline | #2a3038 | #dde1e6 | bar top hairline |
| text | #f2f4f6 | #14171a | titles, active icons on hover, slider thumb |
| secondary | #a9b1bc | #535b66 | subtitle, idle icons, times |
| dim | #6e7784 | #8b939e | disabled icons, outline-button idle stroke |
| accent | #1ed760 | #15a64a | liked heart, active toggles, active lyric, current row |
| accent_hover | #3ce87a | #128f40 | hover of an accent control |
| on_accent | #0a140e | #fff | text on primary pill |
| overlay | #22272e | #fff | dialog fill |
Radii: `RADIUS` 8, `RADIUS_SMALL` 4. Row heights: `ROW_HEIGHT` 56, `COMPACT_ROW_HEIGHT` 48, `PLAYER_BAR_HEIGHT` 88 (T:233-242). `SIDE_PANEL_MIN_WIDTH` 280.

### 0.3 Primitives (T / W)
- **icon_button(icon, size, color, hover, tooltip)** (T:580): square hit box `size+12` (`ICON_BUTTON_PAD`), glyph centred. Idle `color`, hover or keyboard focus `hover`. While the pointer is down the glyph scales to 0.92. No background, no hover plate. Tooltip = egui default hover text. Focus ring: 2 px `selection.stroke`, 4 px radius, expanded 2 px outside (T:559).
- **circle_button** (T:660ish): diameter D, fill `fill` -> `fill_hover` on hover, whole disc grows 1.05x on hover, glyph = 0.46 D, play triangle shifted left by `icon*(0.03-1/24)` for optical centring.
- **circle_spinner**: disc D filled, 2 px arc spinner 0.55 D in the glyph colour.
- **pill_button(label, primary)** (T:725): SemiBold 13, padding 18 x 8, fully round. Primary: fill accent (hover accent_hover), text on_accent. Secondary: 1 px inside stroke dim (hover text), text colour text.
- **soft_button / chip** (T:766-870): Medium 13, padding 12 x 7, pill. Rest fill surface, hover surface_hover, active fill `text` with label colour `window`. Optional 15 px icon + 6 gap.
- **theme::link**: truncated single line, hand cursor, on hover a 1 px underline at `rect.bottom()-1` in the text colour. **theme::text**: truncated single line, not selectable. RTL goes through `bidi::layout` with ellipsis at the left reading edge.
- **thin_slider** (W:3288), used by seek and volume: hit rect = `width x 16`, track 4 px tall, radius 2, track colour white a50 (dark) / black a40 (light). Fill = `text` at rest, `accent` while hovered/focused/dragged; thumb = 6 px radius circle in `text`, only drawn while active (hover/focus/drag). Press previews at once (before egui's drag threshold); release or click commits. Arrow keys when focused: +-step (1 % default, 5 % where wheel step is set). Wheel only if a wheel step is given (volume 5 %; **seek has none**). Also an accessibility slider node 0-100.
- **empty_state** (W:3233): 48 pt top space, centred 40 px icon (dim), 8 gap, SemiBold 16 title (text), 2 gap, Regular 13.5 body (secondary).
- **Motion rule** (`motion.rs`): `motion::seconds(ctx, s)` returns 0 when the OS asks for reduced motion (macOS Reduce motion, Windows animation effects, GNOME animations); egui's own 0.12 s hover/expand ease is also zeroed, scroll animations become instant. Every duration below is therefore "N s, or 0 with reduce-motion".

## 1. Player bar (`ui/player_bar.rs`)

### 1.1 Frame
- Bottom panel, exact height 88, not resizable, no separator, inner margin 16 left/right, 0 top/bottom (PB:49-57). A 1 px hairline in `outline` is drawn across `rect.x_range()` at `top+0.5` (PB:90).
- Fill = `panel` blended 12 % toward the playing art's tint (`TINT_STRENGTH` 0.12, opaque result) (PB:14,395). Tint only when Settings "accent from art" is on and the art accent has been computed (`app.rs:2657`). Song change cross-fades R, G, B each over **0.45 s** (`animate_value_with_time`, per-channel ids), starting from the currently visible colour if interrupted. First frame after sign-in shows the tint with no fade (session id; `end_tint_session` resets on the sign-in screen). Without art the fill eases back to plain `panel` (alpha preserved for translucent custom themes).

### 1.2 Layout (W = bar width minus 32)
```
|16| [cover 56][12][title / subtitle ........][heart] | [shuf][prev][ (O) ][next][rep] | ...[users][mic][queue][device][vol-icon][vol slider 92][expand] |16|
|  <------------- side ------------------------>|   <------ center ------>   |<------------ side ---------------------------------->|
side = clamp(0.30*W, 200, 420). left = [rect.left, +side]; center = between; right band = [right-side, right], 30 tall, centred on the bar midline.
```
Wide (about 1500+): everything above incl. users + expand buttons. Screenshot width (960 content, side 288): the Users button and Expand button are dropped (see 1.7).
Vertical: bar 0..88, midline 44. Transport row centre y = 36 (midline-8, 36 tall: 18..54). Progress row centre y = 67 (cy+31), slider 16 tall (59..75).

### 1.3 Now-playing block (left)
- **Cover** 56 x 56 at `left+4`, vertically centred, radius 6. Nothing playing: placeholder with Music icon. Song change: the previous art is held as a stand-in for up to `PLAYING_COVER_HOLD` 2.0 s until the new art has a GPU copy (W:84, `playing_cover`), so no blank flash.
- Cover is `click_and_drag`: click opens the album (or podcast show); cursor Grab; drag starts a `DragTrack` payload (title, 64 px image) so the song can be dropped on a playlist/queue button. Episodes: click opens Show. Right click on cover or any text opens the same item menu as a track row (with the current editable playlist as context).
- **Expand-art chip**: while hovering the cover, if art exists, not already expanded and the sidebar is visible: an 18 pt circle at the cover's top-right (centre `right-10, top+10`), fill `panel` x0.9, ChevronUp 12 px `text`. Click sets `art_expanded` and docks big art at the sidebar bottom (PB:475-507). Clicking the chip does not open the album.
- **Text**: starts `cover.right+12`, width `region.right - text_left - 42` (42 reserved for the heart; 0 for episodes), min 40. Title Medium 14 `text` as a link (underline on hover, hand cursor, opens album/show). Subtitle: Regular 12 `secondary`, each artist an individual link joined by plain ", " (item spacing 0); an artist without an id is plain text; with no artist list the subtitle is one link (shows). Line gap 2 px; block 36 tall centred on midline (top = cy-18). **No marquee**: overflow is clipped by the 36 px info rect and truncated with an ellipsis (`Label::truncate`). Hover over a clipped title shows nothing extra (**ABSENT** tooltip).
- **Nothing playing**: Music placeholder, "Nothing playing" Medium 14 `secondary` over "Pick a song, album, or playlist" Regular 12 `dim`.
- **Heart** (tracks only, not episodes): 30 x 30 box, 17 px icon (hit 29), centre x = `text_left + min(actual text width) + 21`, clamped to `region.right-21`, so it hugs the title. Unsaved: Heart `secondary`, hover `text`, tooltip "Save to Liked Songs". Saved: HeartFilled `accent`, hover `accent_hover` (stays green under the pointer), tooltip "Add to playlist". **No pop/scale animation** other than the generic 0.92 press scale (**ABSENT** like animation). First click on an unliked song likes it at once. Click on a liked song's heart opens a popup menu (`CloseOnClickOutside`, id `player-bar-liked-playlists`): search field (auto-focused on first open), checklist of Liked Songs + playlists (checks change nothing until Done; click outside discards), menu separator, right-aligned primary "Done" pill. Done: if Liked unchecked, toggles saved; plus playlist add/remove changes; "New playlist" also closes it.

### 1.4 Transport (centre)
Total width 194 = widths [29,30,36,30,29] + 4 gaps of 10 (PB:707). Centred on the centre region. All glyph boxes are explicit 36 tall rects centred at y = 36.
| # | control | glyph px | box | idle | hover | active | tooltip | action |
|---|---|---|---|---|---|---|---|---|
| 1 | Shuffle | 17 | 29 | secondary (dim if no device) | text | accent, hover accent_hover | Shuffle | ToggleShuffle (also exposed as a checkbox to a11y) |
| 2 | Previous (SkipBackFilled) | 18 | 30 | secondary/dim | text | - | Previous | Previous |
| 3 | Play/Pause disc | 36 disc, glyph 16.6 | 36 | fill `text`, glyph `window` | fill white (dark) or `text` (light), disc x1.05 | - | Play / Pause | TogglePlay |
| 4 | Next | 18 | 30 | secondary/dim | text | - | Next | Next |
| 5 | Repeat | 17 | 29 | secondary/dim | text | accent, hover accent_hover | see below | CycleRepeat |
- Loading (song loading or any play pending): the disc becomes a non-interactive spinner disc with tooltip "Loading...".
- Repeat states Off -> Context -> Track -> Off: Off = Repeat icon, tooltip "Repeat"; Context = Repeat icon accent, tooltip "Repeat one"; Track = Repeat1 icon accent, tooltip "Repeat off" (the tooltip names the next click's result).
- "dim" (`palette.dim`) is used for Previous/Next/Shuffle/Repeat idle colour only when no device can be controlled; they stay clickable (no disabled state painted beyond colour).

### 1.5 Progress row
- Times: Regular 11.5, colour secondary (dim when idle). Elapsed right-aligned at `slider_left-8`, duration left-aligned at `slider_right+8`, both centred on y = 67. Format `m:ss` (`util::format_duration_ms`).
- Slider width = clamp(centre width - 120, 120, 620), centred. thin_slider (see 0.3): 4 px track, fill text -> accent on hover/drag, 6 px thumb on hover/drag only. Label for a11y "Playback position (%)".
- Behaviour: pressing previews instantly (`seek_preview`), elapsed text follows the drag value (`fraction*duration`), release commits `Action::Seek(ms)`; click without drag commits too. No-duration media: slider is inert (value 0, commit ignored). Arrow keys when the slider has focus: 1 % steps.
- **Hover scrub / hover time bubble: ABSENT.** The only preview is while dragging. Shift+Left/Right seeks 10 s anywhere.

### 1.6 Right cluster (`extras`, PB:953)
Layout is right-to-left in a 30 px band, item spacing 6. Left-to-right visual order: Listening activity (Users), Lyrics (Mic), Queue (ListVideo), Device, Volume icon, Volume slider (92 x 16), Full screen. All icons 18 px (30 box), idle `secondary`, hover `text`.
- **Full screen lyrics** (Expand / Shrink when inside; tooltips "Full screen lyrics" / "Leave full screen (Esc)"): the last to appear. Shown only if `room >= EXTRAS_WIDTH(240) + 30 + 6 + 10 = 286` where room = right band edge minus transport right edge (PB:945-951).
- **Volume slider**: 92 wide, wheel step 5 % per notch (50 pt of trackpad = 1 notch), arrow-key step 5 %. Dragging pushes `PreviewVolume` live and `SetVolume` on release. Disabled (greyed via `add_enabled_ui`) when the device refuses volume or the player is still waiting; a hover-only overlay says "This device's volume can't be changed from Spotifast".
- **Volume icon / mute**: glyph by displayed percent: 0 = VolumeX (tooltip "Unmute"), 1-33 Volume, 34-66 Volume1, 67-100 Volume2 (tooltip "Mute"). ToggleMute remembers the pre-mute level (restore max(prev,5), default 50).
- 4 px extra gap after the volume icon, before Device.
- **Device**: Speaker icon, accent when playing on a remote device (not own soloist) and then the icon becomes that device's kind (phone, computer, etc.). Tooltip "Connect to a device". Click toggles the devices popup (anchored to this button's saved rect).
- **Queue**: ListVideo, accent while the queue panel or page is open; tooltip "Queue"; a dragged song released on it appends via QueueMany.
- **Lyrics**: Mic, accent while the lyrics panel is open; tooltip "Lyrics".
- **Listening activity**: Users, accent while the friends panel is open; tooltip "Listening activity"; drawn only if `left - transport_right >= 10` (first to disappear in a narrow window).
- Queue, Lyrics and Listening activity are mutually exclusive right panels (opening one closes the other two; `app.rs:13425-13447`).

### 1.7 Narrow behaviour
side shrinks to the 200 minimum, slider width falls to 120, then the right band drops in order: Full screen, Users. Left text truncates; heart tracks the visible text, never past `region.right-21`. Nothing wraps.

### 1.8 Faint visualizer behind the bar (PB:123-391)
- Painted first, across the whole bar including the 16 px margins, clipped to the bar. Setting `player_bar_vis`: Off (default) / Spectrum / Waveform. Empty space is a click target (setting `player_bar_vis_click`, default true, and only if visualizers are available): click cycles Off -> Spectrum -> Waveform -> Off; tooltip "Click to change the visualizer" follows the pointer and only shows over empty space. Controls drawn later take their own clicks.
- Source = same post-EQ, pre-volume tap as the mini player, delayed by `visualizer_lag` (200 ms: `vis::LAG`) so it matches the speaker. Silent for remote devices. Frame pacing from `visualiser_fps` (setting default 60; 0 = display vsync); stops requesting frames when settled.
- **Spectrum**: 75 bands (Winamp's 75 semitone columns), 512-sample Hann FFT, bar gap 2, bar width = (W-2*74)/75, max height `88-2-2-1 = 83`. Bars rise instantly, fall at 3.0 heights/s (Winamp's 12/16 row per 1/60 s over 15 rows). Peak caps: 2 px tall, 2 px above the bar, alpha 0.7, held 0.35 s then fall with gravity 2.4 heights/s^2. Each bar: vertical gradient alpha 0.28 at foot -> 0.08 at top (scaled by level); glow = bar expanded (2,3) px, alpha 0.12 foot / 0.036 top; bass pulse = bottom-half gradient transparent -> colour0 at alpha `0.35*bass^2` where bass = mean of the lowest 1/8 of bands. Light theme multiplies all alphas by 1.5.
- **Waveform**: points = clamp(width/8, 75, 320); Winamp scope (every 7th sample), reach 0.46 of the bar height around the midline; neon line in 3 layers (9 px a0.06, 4 px a0.16, 1.6 px a0.85), shading to the midline a0.14, mirrored echo at -0.6 scale, 1 px, a0.18; colour swept in 8-point runs.
- **Colours**: with art, the cover's palette hues (vivid ones first in cover order, then greys), saturation >= 0.55, value 1, then clamped into a luminance band so text stays legible: dark theme linear luminance <= 0.35; light theme 0.2..0.4. Without art: accent for bass and accent hue +60 deg for treble. Colour swept bass -> treble with gamma lerp.

### 1.9 States summary
Nothing playing: placeholder cover, dim times "0:00", seek slider inert, controls enabled only if a device is connected. Loading: spinner disc. Paused: Play glyph, visualizer settles to rest. Episode: no heart, cover click opens show. Remote device: Device icon accent.

## 2. Queue (`ui/queue.rs`)

### 2.1 Containers
- **Side panel** (`side_panel`): right panel, resizable, range 280..560 (yields width to keep the top bar's least width; remembered `queue_width` only updates from the user's own drag), fill `panel`, margin 12 x 12, no separator. Top spacing reserves room for window controls on custom title bars. Contents scroll in a vertical area with 12 pt right content margin so rows clear the scroll bar.
- **Page** (`Page::Queue`): H1 "Queue" Bold 28 `text`, save icon right-aligned, 8 above, 12 below, then `contents(compact=false)`.
- **Fullscreen column** (inside lyrics fullscreen): width clamp 240..380 (`FULLSCREEN_COLUMN_MIN/MAX`), 12 pt gutter, 8 pt invisible drag strip on its left edge (cursor ResizeColumn; a 1 px `text`-colour line fades in over 0.15 s while hovered/dragged); writes the same `queue_width`.
```
wide side panel (about 400):
| [ Queue ][ Recent ]            [+=] [x] |   chips left (4 indent), save icon + close right
| Playing from  Late night focus           |   13 regular secondary + 13 semibold link, then 10 gap
| Now playing                              |   14 semibold, 4 gap
| [cov36] Rosewood                   3:00  |   compact row 48: title accent (current)
| ...14 gap                                |
| Playing next                      [trash]|   only if user-queued songs exist
| rows (draggable) ... 14 gap              |
| Next up                                  |
| rows (not draggable) ...                 |
narrow (280): same, chips can scroll horizontally with a fade; subtitle truncates.
```
### 2.2 Header (panel + fullscreen column)
`egui::Sides::shrink_left`: left = 4 indent + chips "Queue" / "Recent" (soft pills, 8 gap, selected = filled `text` with `window` label, horizontal scroll with right fade `CHIP_FADE` when clipped); right (RTL) = X (Close, 18 px) then ListPlus "Save as a playlist" (18 px; only on the Queue tab and when there are songs). Then 8 pt space.
- Save: `Action::SaveQueueAsPlaylist` creates a private playlist named by `queue_playlist_name()` containing now playing + upcoming. No dialog.
- Opening the panel refreshes the queue; opening Recent lazily loads history once.

### 2.3 Queue tab sections (`contents`)
1. State: loading row, error row (with retry via `error_row`), else content.
2. **Playing from** (only when a song plays and the context is known): "Playing from" Regular 13 secondary + context name SemiBold 13 `text` as a link (Liked Songs, playlist, album, artist, podcast, or radio station name as plain text because a station has no page; unknown names fall back to "Playlist", "Album", "Artist", "Radio"). 10 gap.
3. **Now playing**: SemiBold 14 `text`, 4 gap, one track row (number 1, current = accent title and AudioLines over a scrim when audibly playing), 14 gap (`SECTION_GAP`). Prefers the player's current track over the (laggy) Web API one.
4. **Empty**: if nothing is queued: `empty_state(ListVideo, "Nothing queued", "Queued songs appear here.")`.
5. **Playing next** (rows the user queued by hand): heading SemiBold 14, trash icon (Clear queue, 18 px) right-aligned (only on this computer's own queue, `can_clear_queue`). Rows numbered continuing the whole queue (index+1). 14 gap after.
6. **Next up** (context rows): SemiBold 14 heading, 4 gap, rows. Plays from the context; never rewritten, never a drop target.
"Two tiers" = Playing next (manual, editable) vs Next up (context, read-only). **Queue options (clear/shuffle/etc. menu): ABSENT** beyond the trash button and the per-row menu.

### 2.4 Row anatomy (`widgets::track_row`, W:1717-2330)
- Row height: compact (panel) 48, page 56. Row is click+drag. Hover fill `surface_hover` (x0.7 in dark) radius 6; selection fill `secondary` alpha 0.20/0.30.
- Compact columns (panel): cover 44 cell (36 px art, radius 4, +2 inset), no number column, no album, no heart, no More button, duration cell 44 (right aligned, 6 pt in, Regular 13 secondary). Page: number 44, cover 52 (40 px), album = clamp(0.28*width, 140, 360) when width > 560, heart 36, duration 56, More (Ellipsis 18) 36; heart/More appear only on hover/focus (opacity 0 otherwise, More stays while its menu is open).
- Text: title Medium 14.5, subtitle Regular 12.5 (links to artists; Explicit "E" badge before artists). Current row title `accent`; unavailable `dim`; subtitle `secondary`, `text` when row hovered. Vertical pad = max(4, (rowH-37)/2).
- Play affordance: in the page, the number cell turns into PauseFilled/PlayFilled 14 on hover, AudioLines 16 `accent` for the playing row, spinner 16 while play is pending. In compact (no number) the cover gets a black scrim (a140 hover, a110 playing) with a 16 px white play/pause glyph or accent AudioLines.
- Double-click or accessible click plays from that row (`PlayFromRow` with `RowContext::Queue`/`Uris`). Queue rows are "positions": the playing song is only marked on the Now playing row, never on a queue copy.
- Menus: right-click (and the More button in the page) open the item menu; for user-queued rows on this computer it includes "Remove from queue" (`RemoveFromQueue{rows:[(index,uri)]}`); also Add to queue, Save to Liked Songs, etc. **Keyboard Delete/Backspace for queue rows: not found.**

### 2.5 Drag reorder (Playing next only; Q:487-572)
- Enabled only when `queue_locally_reorderable()` (local playback active on this computer). Otherwise no reorder: any drop on the panel appends (QueueMany), and the player bar's Queue button always accepts drops.
- Drag payload `DragTrack{from:("queue", index)}` set after egui's drag threshold, only for a single non-picked song in the manual section.
- While a `DragTrack` exists: `scroll_during_drag` autoscrolls the panel; the drop slot = round((pointer.y - list_top)/(rowH + gap)) clamped to 0..queued_len, only while the pointer is inside the section rect (queued rows plus 14 below).
- Rows above the slot shift **-4 px**, rows at/below **+4 px**, animated **0.12 s** (per-row `animate_value_with_time`, 0 with reduce-motion), row painting translated by `shift`.
- Insertion indicator: 2 px `accent` horizontal line at `list_top + slot*(rowH+gap)`, inset 8 px each side.
- Drop: internal row -> `MoveInQueue{from,to}` (verifies the recorded index still names that URI, else searches; ignored when dropped onto its own edges `to==from` or `to==from+1`); external song -> `InsertInQueue{items, position: slot}`. Nothing queued yet: any drop on the panel inserts at 0.
- Reordering rewrites the local engine's queue only; Web API/remote queues cannot be reordered (hence the gating).

### 2.6 Recent tab
`recents_contents`: loading row; error with CircleAlert (danger) + message + soft "Retry"; empty `empty_state(Clock, "No recent plays", "Played songs appear here.")`; else compact rows (no numbers, shows relative "played at"), merged local history + Spotify history; footer "Load more" soft button with Refresh icon and automatic load when the list end is within 900 px of the clip bottom; loading row while fetching.

## 3. Lyrics (`ui/lyrics.rs`, `lyrics.rs`)

### 3.1 Data (lyrics.rs)
- Sources in order: (1) local file: `.lrc` sidecar with the same stem (`local_tags.rs:97`; UTF-8 BOM stripped), then the file's embedded USLT/Vorbis lyrics (ISO-8859-1 tags with lost newlines are re-split before each `[..]` stamp); (2) Spotify `color-lyrics` transcription when the playback session is signed in (`LINE_SYNCED` => synced); (3) LRCLIB (`https://lrclib.net/api`): exact `/get` with cleaned artist/title/album/duration, falling back to `/search` ranked by `score`: title must match loosely, +1000 artist match, +(30-|drift|)*10 for duration within 30 s (further = rejected), +200 synced / +50 plain.
- Cache 30 days per query; a "none" answer is trusted 7 days; a stale positive answer is still served during an outage. Timeouts: request 5 s, lookup 20 s; up to 3 rate-limit retries; Retry-After respected up to 5 s. In-app retry schedule on failure 5 s, 15 s, 45 s, 120 s (`LYRICS_RETRIES`).
- Model: `Lyrics{lines:[Line{at_ms:Option<u32>, text}], synced, instrumental}`. `active_line(pos)` = binary search on `at_ms <= pos`, `None` before the first line or when unsynced. LRC parser: `[mm:ss.xx]`, multi-stamp lines duplicated, tags skipped, sorted. Title/artist cleaners strip "(Remastered...)", " - Live...", "feat." and similar.
- Episodes and offline: immediately "no lyrics".

### 3.2 Side panel (`side_panel`)
- Right panel, range 280..640, margin 12, fill `panel`, yields width like the queue. Header (4 indent): "Lyrics" Bold 18 `text`; right (RTL): X Close, Expand "Full screen lyrics" (18 px icons), and a **Follow** outline pill (only when synced lyrics are loaded and following is off). 8 gap.
- Body states: nothing playing = `empty_state(Mic, "Nothing playing", "Play a song to see its lyrics.")`; loading = loading row, or `WifiOff` "You're offline" empty state when unreachable; failed = "Couldn't fetch the lyrics: {error}" Regular 13 secondary + outline "Try again"; none = Mic "No lyrics"; instrumental = Music "Instrumental / No timed lyrics for this track."
- Lines: 12 pt lead space, each line Regular 19 (switches to Bold 19 once `lit>0.5`, no size change), gap 10. Colour = `lerp(text*0.45, accent, lit)` where `lit` animates 0->1 over **0.22 s** (`animate_bool_with_time`, 0 with reduce-motion). Past and future lines look identical (quiet); only the active one is accent+bold. Empty timed lines render a music note (U+266A). Synced lines are clickable (seek to `at_ms`, then following on); unsynced lines are hover-only.
- RTL lines go through `bidi::layout` (paragraph direction = first strong char; runs reordered) with the Label's own wrapping.
- **Auto-scroll rule**: when following and the active line changed (`lyrics_line_shown != active`), `scroll_to_rect` (instant, no animation) so the line's middle sits `SUNG_LINE_AT = 0.2` of the viewport height from the top (above = 0.2*H - lineH/2). Before the first line: scroll to top. Unsynced text: follow the clock, centring at `position/duration` of the content height. Bottom pad = max(60, 0.8*H) so the last line can rise to the 20 % mark.
- **User-scroll pause**: any wheel/trackpad scroll over the panel (`smooth_scroll_delta.y != 0`) sets following = false; the **Follow** pill (or clicking a line, or reopening) turns it back on and re-centres. Middle-click autoscroll (Windows/Linux) is wired (`autoscroll::lyrics`).

### 3.3 Fullscreen (`fullscreen`, LY:317-1004)
- Entered by the Expand buttons, key `F`, or from MilkDrop; the window goes OS-fullscreen (restores the previous mode on exit; Esc, Shrink button, `F`). Opening fullscreen turns the lyrics panel on unless the queue panel is on (then the queue becomes a right column).
- Surface: `CentralPanel` fill dark `window` (the view is always dark; `apply_local(dark palette)`), backdrop = small cover art (large as fallback) object-fit-cover (`cover_uv`) tinted gray 180, plus a flat black a120 overlay, plus a vertical gradient black a0 -> a95; or MilkDrop dimmed (`dim = clamp(0.2/glow, 0.2, 0.32)`, animated 0.5 s; white text still > 7:1) with quiet lines at 0.62 instead of 0.42. Click on empty backdrop toggles MilkDrop (feature `milkdrop`).
- Top inset = macOS titlebar inset (28) + 24. Header: "Lyrics" Bold 18 white, RTL: Shrink icon (text colour, tooltip "Leave full screen (Esc)") and the Follow pill.
```
wide (>= 900):                                   narrow (< 900) single column
| 48 | Lyrics                      [Follow][ ><] |   | Lyrics            [Follow][ ><] |
|    |                                           |   | 20                              |
|    | [  cover   ]   64   lyrics (max 640)      |   | [52px cover] Title 22 semibold  |
|    | [  520 max ]        line                  |   |              Artist 13          |
|    | Title 22 semibold   LINE (active, x1.15)  |   | 16                              |
|    | Artist 14           line                  |   | lyrics, width = clamp(0.72*W,    |
|    |                     (queue column 240-380) |   |  400, 960) min(W-48)            |
```
- With cover (>= 900 and a song): outer margins 48 left/right, 40 bottom, header then 24 gap. Cover side = clamp(0.38*width, 200, 520) capped to height-90 (with queue docked: 0.42 of the room, 160..520). Cover radius 10 with shadow offset (0,18), blur 48, black a140; click enters immersive MilkDrop when available (pointer cursor). Under it (18 gap, 4 line gap): Title SemiBold 22 white (truncate), subtitle Regular 14 gray 225. Group (cover + 64 gap + lyrics) centred; with queue the lyrics are centred in the space between. Lyrics column <= 640. No words: the cover is centred alone (side = clamp(h-140, w*0.5, 560), min 200/160), heading SemiBold 13 gray 200 ("Instrumental", "No lyrics", "Loading...", or the error) + Regular 13 gray 170 detail, "Try again" pill if failed.
- Line type: size = clamp(0.046 * column width, 28, 42), **Bold** always; active line grows to **x1.15** (wrap width is computed for the grown size so it never re-wraps), colour `lerp(text*0.42, accent, lit)`, **0.3 s** transition. Unsynced text: all lines full `text`, size not animated. Line gap 27. Top pad = max(12, 0.2*H - size) when synced; bottom pad = 0.8*H.
- Edge fade: each line's opacity = smoothstep(clamp(distance to nearest viewport edge / (2*size), 0..1)) (`edge^2*(3-2*edge)`), so lines dissolve at the top and bottom. Scroll bar fade disabled.
- Auto-scroll: same 20 % rule but animated **0.45 s** (`motion::scroll`); manual scroll detection includes wheel and primary-button drag; when manual and following was on, `PauseLyricsFollow`. Click a line = `Seek(at_ms)` + `FollowLyrics` (untimed lines swallow the click so it cannot toggle the backdrop). A repaint is scheduled for the next line's timestamp while playing.
- Keys inside fullscreen: `Esc` leaves, `F` toggles, `V` MilkDrop behind words, `N`/`P` presets (only while MilkDrop is behind). Cursor hides in immersive mode after idle (`immersive_controls`).

## 4. Mini player (Winamp / WMP skins)

### 4.1 Window model (`winamp.rs`, `ui/winamp/mod.rs`)
- One main window at a time: entering the mini player closes the big window and opens a borderless, transparent-capable window sized to the skin (`fit_window` sets min = max = inner size; retries at most 1x per second if refused). Shortcut Ctrl+M (Cmd+Shift+M on macOS), the Shrink icon in the top bar ("Mini player (...)"), tray, or Settings "Switch to it". Back: logo, close X, eject, About button, Big window menu item, or the same shortcut.
- Scale: pixels per skin pixel = `settings.skin_scale` (1..4) else `round(2 * pixels_per_point)` for Winamp skins (the remembered double size) and `pixels_per_point` for WMP skins; nearest-neighbour; one skin pixel is a whole number of screen pixels. Clutter "D" cycles 1x -> 2x -> 3x -> 4x -> 1x (lit when >= 2x); menu "Size 1x 2x 3x 4x".
- Vertical stack in one window, top to bottom (WA:57-83): main 116 (shade 14) + equalizer 116 (shade 14) + playlist (min 116, steps of 29, max 116+29*20, shade 14) + MilkDrop panel (min 116, max 960). Window width is always 275 skin px.
- All pieces are drawn from the skin's sprite sheets by `View::paint` (UV rect of the sprite cut from the bitmap; skins with `region.txt` get per-row clipped spans so nothing paints outside the shape). Sprite coordinates are Webamp's table (`skin/sprites.rs`).

### 4.2 Sheets (`skin/sprites.rs:11`)
main, cbuttons, titlebar, shufrep, posbar, volume, balance, monoster, playpaus, numbers, nums_ex, text (5x6 bitmap font), pledit (+`pledit.txt` colours), eqmain, eq_ex, gen, genex, `viscolor.txt` (24 colours), `region.txt`. Missing files fall back to the built-in skin. Modern `.wal` skins error "this is a modern Winamp skin...". Winamp skin = `.wsz` or unpacked folder; WMP skin = `.wmz`/`.zip` (script runtime in `skin/wmp`, **UNVERIFIED** beyond: views map to windows, primary view in the mini window, other views as undecorated transparent viewports, pictures capped to 192 MB of textures).

### 4.3 Main window layout (275 x 116 skin px; `skin/layout.rs`)
```
y0   [O]                title bar 275x14 (active/inactive sprite)         [_][^][x]  (244,254,264; 9x9 at y3)
y14
y22  [clutter O A I D V]  x10 y22 8x43 (O y25, A y33, I y40, D y47, V y55)
y26  [status 9x9 @26,28][ time M M : S S  digits 9x13 at x48,60,78,90 ]   marquee 154x6 @111,27
y41  [visualiser 76x16 @24,43]   [kbps @111,43 15x6][kHz @156,43 10x6]   [mono 27x12 @212,41][stereo 29x12 @239,41]
y57  [volume 68x13 @107,57][balance 38x13 @177,57]   [EQ 23x12 @219,58][PL 23x12 @242,58]
y72  [seek bar 248x10 @16,72]
y88  [prev 23x18 @16][play @39][pause @62][stop @85][next 22x18 @108][eject 22x16 @136,89]  [shuffle 47x15 @164,89][repeat 28x15 @210,89]  [about 13x15 @253,91]
```
Shade mode (275 x 14): visualiser 38x5 @79,5; time 30x6 @127,4 (small font, "-" prefix when remaining); mini transport prev 7x10 @169, play 10x10 @176, pause @186, stop @195, next @204, eject @215; seek 17x7 @226,4 (3 px thumb); buttons same x as above; double-click bar = unshade.
- **Title bar**: drag = window move; double-click = roll up/down; right-click = options menu (Size, Always on top, Show in taskbar, MilkDrop, Choose a skin, Big window, Quit). Logo = back to big window; minimize; shade "Roll the window up/down"; close = back to the big window (not quit). Active vs inactive title sprite follows window focus.
- **Clutter bar**: O = options popup; A = always on top (lit when on; hover text or "unavailable on this system"); I = "Song info" (opens the album/show page in the big window); D = size cycle "Size: 1x, 2x, 3x, 4x"; V = "Visualisation" menu (Spectrum analyser / Oscilloscope / Nothing; MilkDrop check with shortcut hint). Each lamp lights while held, A and D also while on.
- **Status lamp**: playing/paused/stopped from `now`; **stopped = loaded, paused, position 0**. Work indicator lit while loading. MONO/STEREO lamps are real switches (mono folds channels; tooltips "Play in mono"/"Play in stereo"); both unlit when stopped.
- **Time**: digits m:ss (minutes capped 99). Click toggles remaining (leading minus sprite). **Blinks at 2 Hz while paused** (`floor(time*2) % 2`). Blank cells painted when stopped/nothing. Uses `nums_ex` (blank + minus) if the skin has it else `numbers`.
- **Marquee** (WA:1214-1376): text = `Artist - Title (m:ss)` (title only if no artist; "Spotifast" idle); takes over for slider feedback (`Volume: 57%`, `Balance: 25% left/right/center`, `Seek to: 2:12/4:24 (50%)`) and the latest toast notice. 31 glyph cells visible (5 px glyphs); text <= 30 chars is static; longer scrolls one character per 220 ms with the gap `"  ***  "` wrapping. Glyphs the bitmap font lacks (CJK, etc.) switch the whole line to the pixel face scrolled in 5*unit steps.
- **Rates**: kbps = chosen bitrate setting (right-aligned in 3, only for local playback), kHz fixed "44"; hidden when stopped.
- **Sliders**: volume 28 sprite frames (track drawn at level, thumb 14x11 rides at `+1`), wheel +-5 per notch, thumb pressed sprite while held; balance 28 frames by |balance|, snap to 0 within 0.08; seek track + 29x10 thumb (pressed variant while dragging), thumb exists only while something plays and is not stopped. A press only grabs the slider if it began inside its own rect (#804). Seek commits on release.
- **Transport semantics** (Winamp's): Play on a playing song restarts it (`Seek(0)`), else TogglePlay; Pause toggles; Stop = pause + seek 0; Prev/Next; Eject = back to big window. Play sprite stays pressed while playing, Pause pressed while paused, Stop pressed while stopped. Shuffle on/off sprites (pair with pressed variants); Repeat is on/off only, "on" = whole list.
- **Visualiser** (WA:1013-1092): 76x16 area, click cycles bars -> scope -> off. Background = `viscolor[0]`, dotted pattern `viscolor[1]` every 2 px (full size only). Bars: 19 bars, stride 4 (3 wide + 1), height 0..15 rows, row colour index `2+row` (shade/5-row table [4,8,11,14,17] in shade mode), peaks `viscolor[23]`; scope uses indices 18..22 by distance from centre; same Winamp falloff (12/16 row per 1/60 s, peak 1.1). Flat when sound is remote.
- **Menus** (`WA:825`): square popups in the skin's playlist colours (`normal` text, `current` hover text, `normal_background`, `selected_background`), no shadow/radius, font = clamp(5*unit, 9, 14), scrolls if taller than the window.
- Skins and files can be dropped on any mini window to install (`.wsz .wmz .zip`).

### 4.4 Equalizer window (`ui/winamp/equalizer.rs`; 275 x 116, shade 14)
- Frame from `eqmain.bmp`; title drag, double-click shade, shade button (254,3), close (264,3). ON 26x12 @14,18 (toggle EQ), AUTO 32x12 @40,18 (here: **sets all bands flat**; Winamp's per-song presets have no Spotify equivalent), PRESETS 44x12 @217,18 opens a skin-styled menu.
- Graph 113x19 @86,17 draws the response curve in the skin's 19 colour rows with the preamp line under it. Preamp slider 14x63 @21,38; ten band sliders 14x63 @78+18*i,38. Thumb 11 px, travel 52, 28 frames, thumb pressed sprite while held; range +-12 dB; bands 60, 170, 310, 600, 1k, 3k, 6k, 12k, 14k, 16k Hz (`eq.rs:15-19`).
- Presets (22): Flat, Classical, Club, Dance, Full Bass, Full Bass & Treble, Full Treble, Laptop Speakers / Headphones, Large Hall, Live, Party, Pop, Reggae, Rock, Ska, Soft, Soft Rock, Techno, then Bass Booster, Bass Reducer, Treble Booster, Vocal Booster; user presets saved in Settings follow after a separator. The matching one shows selected.
- Shade bar: volume mini slider 97x7 @61,4 and balance 43x7 @164,4, 3 px thumbs with 3 looks each (low/middle/high; left/middle/right).

### 4.5 Playlist window (`ui/winamp/playlist.rs`; width 275, height 116..696 in 29 steps)
- Frame from `pledit.bmp`: title 20, bottom 38, left 12, right 20, tiles 25x29; list area x12, y20, width 243, 13 px rows; colours from `pledit.txt` (normal, current, normal bg, selected bg).
- Rows: "n. Artist - Title" + right-aligned duration, pixel font 11 px (cut with ellipsis), first row = now playing (current colour), then the queue. Click selects a row; Ctrl/Cmd-click toggles; double-click plays a **queued** row. Wheel = 3 rows per notch (Windows default), trackpad = one row per row-height, page events = page. Scroll handle in the right tiles (18 px handle at x260); the bottom-right grip stretches by 29 px steps (`playlist_resize` carry-over).
- Bottom bar: running time and selected-song time in the small font (@132,10 and @191,23); mini transport 6 cells of 10x10 @128,22 (prev, play, pause, stop, next, eject); menu buttons 22x18: ADD @14 ("Search Spotify", "Liked Songs"), REM @43 ("Remove selected" / "Remove all", only on this computer's queue, tooltip "You can only change this computer's queue."), SEL @72 (All / None / Invert), MISC @101 ("Song info", "Artist"), LIST @231 ("Load list" submenu of the user's playlists or "No playlists yet", "Save list" = "Save the queue as a new playlist").
- Shade (14 high): left cap + 25 px tiles + right cap; shows the song title and time, unshade button, X.

### 4.6 MilkDrop panel (`ui/winamp/milkdrop.rs`, feature `milkdrop`)
Winamp-5 generic-window frame (`gen.bmp`: title tiles 25 px, top 20, bottom 14, left 11, right 8) with the title "MILKDROP" spelt in the skin's letters. Body shows the projectM frame stream (or bars on the skin's background until it arrives). Double-click or the full-screen glyph button (tooltip "Full screen with lyrics") goes to lyrics fullscreen; right-click or `N` = next preset, `P` previous, `Esc` closes; close button; bottom-right grip (vertical resize cursor) in whole skin pixels, 116..960 high. Opened from Settings, the top bar, Ctrl+Shift+K (Cmd+Shift+K) or the V menu; presets from `milkdrop_dir`, downloaded on first open with an empty folder.

### 4.7 Skin selection (Settings, `ui/settings.rs:1790-2060`, `ui/skin_cards.rs`)
- Section "Mini player": rows "Show the mini player" (+ "Switch to it" primary pill), "Skins folder" (+ "Open folder" soft button, `skins_dir`), sub-sections "Winamp" (note, "Skin Museum" soft button -> https://skins.webamp.org/, card grid) and "Windows Media Player" (note, "Windows Media Player Skins Collection" soft button -> archive.org, note "Installed skins are in {folder}. None of this kind yet." if only shipped skins exist, grid), "Random skin" switch (picks another skin each time the mini player opens; a chosen skin turns it off), "Size" 1x-4x soft buttons (active = filled), "Always on top" switch, "Show in taskbar" switch (only where supported). The listing re-reads the folder every 5 s on its own thread (classifying archives opens each one).
- **Card grid**: min card width 148, gap 10, columns = floor((W+10)/158) (>=1), card width fills the row exactly; padding 8; picture area height = 0.5 * card width; label cell 26; card height = 0.5w + 26 + 16. Card radius 8; fill `window` (rest) / `surface_hover` (hover) because the section behind is `surface`; selected = 2 px `text` ring inside, and the label becomes a filled `text` pill with a `window` label. Label Medium 13, centred, truncated with an ellipsis (RTL aware); tooltip = full name. Picture: preview PNG drawn once off-thread (<= 480 px longest side), nearest magnify in whole-number steps, linear minify, centred in the picture box; placeholder = `surface_hover` rounded 4 until ready; failed = name only, centred. Only visible cards ask for a picture or paint; the grid height is arithmetic (hundreds of skins stay cheap).
- First Winamp card is the built-in "Spotifast" skin (key empty). Current skin = `settings.skin` name (the file or folder name). Selecting a card sends `SetSkin(Some(name))` (also clears random). Shipped skins: `assets/skins/spotifast.wsz` (built-in classic), `spotifast-ribbon.wmz`, `spotifast-wide.wmz`.
- Skin files are cached in `skins_dir`; WMP skins keep their own preferences JSON in `skin-preferences/`.

## 5. Keyboard (`ui/keys.rs`)
`Cmd` = Ctrl on Windows/Linux. A text field with focus keeps Space, Ctrl/Alt/Cmd+arrows; plain-letter keys are off while a dialog is open or a field is being edited. A focused song row or button still gets Space and the arrow chords. Shift variants are matched before the plain ones (egui ignores extra Shift).
| keys | action | gate |
|---|---|---|
| Space | play/pause | not editing text |
| Cmd+Left / Cmd+Right | previous / next | not editing |
| Shift+Left / Shift+Right | seek -/+10 s | not editing, no dialog |
| Cmd+Up / Cmd+Down | volume +5 / -5 | not editing |
| M | mute | plain |
| B | like/unlike the playing song | plain, tracks only |
| S / R | shuffle / cycle repeat | plain |
| Q (Shift+Q on Win/Linux with Cmd) | toggle queue panel; with songs picked in a list, Q is the list's "add to queue" | Mac queue chord Cmd+U (Cmd+Shift+Q = logout) ; Win/Linux Ctrl+Shift+Q |
| L | toggle lyrics panel | plain |
| F | lyrics fullscreen (or MilkDrop fullscreen when MilkDrop is framed) | plain |
| V, N / P | (lyrics fullscreen) MilkDrop behind words; next/prev preset | feature |
| Esc | close dialog -> close devices popup -> leave lyrics fullscreen | in that order |
| / , Cmd+F | focus search | |
| ? , Cmd+/ | keyboard shortcuts dialog | |
| Cmd+B | sidebar | |
| Cmd+, | Settings | |
| Cmd+H (Mac: Cmd+Shift+H) | Home | Cmd+H is Hide on macOS |
| Cmd+L | Liked Songs | |
| Cmd+Shift+A / Cmd+Shift+B | go to the playing artist / album (or show) | |
| Cmd+M (Mac: Cmd+Shift+M) | mini player | Cmd+M minimises on macOS |
| Cmd+Shift+K | MilkDrop under the mini player | |
| Alt+Left / Alt+Right, mouse Back/Forward buttons | history | |
| Cmd+W / Cmd+Q | close window / quit | works in setup too |
| Page Up/Down, Home/End | scroll the page by a viewport / ends | `scroll_page`, off in text fields and open popups |
| Shift+Up/Down, Shift+Q, Shift+N, Delete, Cmd+A/C/X/V | song-list shortcuts (extend selection, add to queue, play next, remove from playlist, select all, copy links, cut, paste links) | list focus |
| MilkDrop panel: F or double-click, Right/N, Left/P, L (keep preset), Esc, `?`/F1 | listed in the dialog; handled in MilkDrop code | |
**Shortcuts dialog** (`ui/dialogs.rs:152`): modal (backdrop black a150 dark / a80 light; frame fill `overlay`, 1 px `outline`, radius 12, margin 24, shadow (0,10) blur 40 `shadow`, fixed 420 wide), title Bold 20, 12 gap, a two-column grid (column gap 24, row gap 8): key text SemiBold 13 `text`, description Regular 13.5 `secondary`, non-truncating, in a vertical scroll area max height = viewport height - 190 (min 120), 16 gap, right-aligned primary "Done" pill (`buttons` RTL row). ~42 rows. Key labels use the platform's modifier names; macOS also lists the Cmd+Shift variants. A test forbids showing the other platform's modifier.

## 6. Media keys, tray, system surfaces

### 6.1 Media keys / now-playing (`app.rs:5735-5960`)
- A `fastframe-now-playing` session (`MediaControls::start`) provides MPRIS on Linux, System Media Transport Controls on Windows, the Now Playing center on macOS. It owns the hardware media keys and the volume overlay on Windows; it lives in the background so the tray keeps working. Commands mapped: Play (only if not playing), Pause/Stop (only if playing), PlayPause, Next, Previous, SeekBy, SetPosition(track id must match), SetVolume (0-1 -> percent), SetShuffle, SetRepeat (Off/Track/Playlist), OpenUri (a search link or a play context), Raise (show window), Quit.
- Metadata pushed every frame: playback state, track id/title/artists/album/duration/art file (art file preferred on Win/macOS; `art_url` minus local-art scheme on MPRIS), position, volume, shuffle, repeat. Nothing playing publishes volume 1.0/off/off.
- A control channel (`single_instance`) offers a `nowplaying` verb for Stream Deck-like tools: tab-separated `state, title, artists, album, position_ms, duration_ms, volume, shuffle, repeat, art_url, saved, device` (`app.rs:5960+`).
- Windows taskbar thumbnail toolbar (`thumbbar.rs`): 3 buttons Previous (id 2), Play/Pause (3), Next (4), icons drawn with tiny-skia, following the system light/dark theme, rebuilt with each window. macOS menu bar (`mac_menu.rs`): Playback menu: Play / Pause (no key), Next Track Cmd+Right, Previous Track Cmd+Left, Seek Forward/Backward (10s) (no key, so text fields keep Shift+arrows), Shuffle, Repeat, Increase Volume Cmd+Up, Decrease Volume Cmd+Down, Mute; View: Back `[`, Forward `]`, Home Cmd+Shift+H, Search Cmd+F, Liked Songs Cmd+L, Toggle Sidebar Cmd+B, Queue Cmd+U, Toggle Full Screen Ctrl+Cmd+F; Window: Minimize Cmd+M; Help: Keyboard Shortcuts Cmd+/. Dock menu: Play/Pause (label follows state), Next, Previous.

### 6.2 Tray (`app.rs:948-1100`, `fastframe-tray`)
Item id `spotifast`, title "Spotifast", the app icon (macOS template mono image), colour/white/black on Linux/Windows by setting `tray_icon` (#128). Menu: "Show or hide Spotifast" (also a plain icon click), "Open main window", separator, **Play** or **Pause** (label updates when playback changes), Next, Previous, separator, Quit. Closing the window hides to the tray and music keeps playing when "keep playing in background" is on and the tray item is shown; a hidden start (`--start-hidden`) waits up to a timeout for a panel to show the item, else opens the window.

### 6.3 macOS notch widget (`notch.rs`, `mac_notch.rs`, setting `mac_notch_widget` default false)
- Visible only if enabled, the app is not in the foreground, a track exists, and the display has a physical notch (`top_inset > 0`): collapsed hit window = 200 wide (<= screen) x notch height, centred under the notch; expanded window 400 wide x (notch + 8 gap + 148 card); level 25 (status, above menus).
- Hover: enter schedules expand after **60 ms** dwell; leave schedules collapse after **400 ms** linger. Expand: window frame set immediately, card slides down and fades in over **0.26 s** (`NSAnimationContext`); collapse: **0.20 s** slide/fade up, then the window shrinks. Mouse re-entry cancels the collapse.
- Card 148 tall, radius 18, HUD-window vibrancy blur behind a dark glass fill rgba(0.08,0.09,0.11,0.78), 1 px border rgba(0.16,0.19,0.22,0.75). Coordinates top-down: art 50x50 @16,14 radius 8 (placeholder rgba(white .18) with a 12 px dot when art is missing); title Inter Bold 14.5 @76,16 (20 high, single line, truncating); artist Inter 12.5 @76,38 (18 high, white a0.65); elapsed 11 px @14,74 (white a0.60), total right at `card_w-58`; seek track x 60..(card_w-58), centre y 82, 4 px tall, radius 2, white a0.20, fill white, **always-visible 12 px white thumb**; click/drag on the seek row (y >= 70) seeks (pending seek held up to 2 s unless the position arrives within 1.2 s). Controls row y 97, buttons 30x36 and a 36x36 disc: Like @16, Shuffle @cx-108, Previous @cx-62, Play disc @cx-18 (fill rgb(0.95,0.96,0.97), glyph rgb(0.06,0.07,0.08)), Next @cx+32, Repeat @cx+78, Device @(card_w-46); 16 px Lucide template icons; idle tint white a0.70, active tint #1ed760 (liked, shuffle, repeat on, remote device); accessibility labels match the player bar. Heart saved = HeartFilled. Click outside controls shows the main window.
- Track change while expanded: old title/artist/art fade out over 0.20 s, text swaps while hidden, new content fades in over 0.30 s easeInEaseOut after 220 ms (so the whole transition ~0.5 s); when collapsed there is no animation. Periodic updates only redraw the progress when the whole second changes.
- Cross-platform no-ops elsewhere (`notch.rs` is pure geometry + command queue; commands: PlayPause, Next, Previous, ShowWindow, ToggleSaved, Seek, ToggleShuffle, CycleRepeat).

## 7. Reference screenshot (docs/screenshot.png, 1920x1200 = 960x600 pt)
Bar at the bottom 88 pt (176 px) with the 12 % cover-tint fill and the 75-bar spectrum behind it in cover greens, bars reaching about 83 pt; left: 56 pt cover, "Rosewood" 14 / "Bonobo" 12, green filled heart just right of the text; centre: shuffle, previous, white 36 pt disc with a dark pause glyph, next, repeat; under it "1:23" [slider, 4 px, played part drawn lighter than the faint track] "3:00"; right: Mic, ListVideo (green = queue open), speaker, volume glyph, 92 pt slider (white fill, thumb visible as hovered). Queue panel on the right: chips "Queue" (selected, white pill) and "Recent", save icon and X on the right; "Playing from  Late night focus"; "Now playing" with a green title; "Next up" with 48 pt compact rows, 36 pt art, duration right-aligned, explicit "E" badge before artists; no heart or More column in the panel.

## 8. Not found / unverified (do not invent)
- No hover time preview or thumbnail scrubbing on the seek bar; no marquee in the player bar; no like-heart animation; no queue "options" menu beyond Clear and Save; no Delete-key removal on queue rows found; no mini-lyrics widget in the player bar.
- UNVERIFIED: WMP skin runtime internals (`skin/wmp/*`, `ui/winamp/wmp.rs` 775 lines), Windows thumb-bar icon geometry, exact egui tooltip delay, the exact `Icon` to Lucide name map, `autoscroll` controller internals, `milkdrop` child-process pipeline, the friends panel.
