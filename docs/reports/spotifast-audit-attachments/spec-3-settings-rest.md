# Spotifast spec 3: settings, EQ, visualizers, themes, motion, onboarding, rest-of-screens, i18n, CLI, demo, docs

Source: `repo/` (Spotifast, Rust/egui). All cites are `file:line` under `src/` unless a path says otherwise. "px" = egui logical points (zoom factor 1.0). **DROP** = Spotify-account-specific, not for MaiPai Home, still described in one line.
Corrections to earlier notes are flagged "(note)". Read-only audit; nothing was run.

Contents: 1 Settings page, 2 Equalizer, 3 Limiter, 4 Visualizers, 5 MilkDrop, 6 Themes and appearance, 7 Motion and power, 8 First run / login / Soloist (DROP), 9 Other screens (friends, artist, show, prerelease, update, skin cards, new releases, banners, toasts), 10 Storage, 11 i18n, 12 Accessibility, 13 CLI, 14 Demo mode, 15 Docs site, 16 README features not yet captured, 17 Tricks worth copying, 18 Differences for a web app.

---------------------------------------------------------------------------------------------------

## 1. Settings page (`ui/settings.rs`, 3163 lines; rows in `ui/widgets.rs:3727-3830`)

### 1.1 Page frame
```
 [page padding 24px both sides, top 4 / bottom 48]           ui/mod.rs central()
 Settings                         <- bold 28, text colour             settings.rs:465
 (4px)
 ( magnifier  Search settings                 x )  pill, h34, w = min(avail, 400)   widgets.rs:3567
 (4px)
 Spotify Soloist        <- section title bold 18  (DROP section, see 1.3)
 +--------------------------------------------------------------+  <- Frame: fill surface (x0.7 in dark),
 | row title (medium 14)                       [control]        |     1px outline stroke, radius 10 (RADIUS+2),
 | description (regular 12.5, secondary, wraps)                 |     margin L20 R20 T16 B6, width <= 760
 | ... (10px gap after every row)                               |
 +--------------------------------------------------------------+
 (8px after section, 10px before next title, 8px between title and card)
```
- Section order, top to bottom: Spotify Soloist (DROP), Account (DROP), Playback on this computer / Application, Appearance, Proxy, Mini player, MilkDrop, Equalizer, Storage, About. Cites: soloist 501, account 533, playback 745, appearance 1232, proxy 1699, mini player 1794, milkdrop 2084, equalizer 2275, storage 2390, about 2482.
- A section is hidden entirely when it has no matching row (`section_matches` 138). Conditional rows ("available" flag, `RowText::when`) only participate in search where they exist (platform/state).
- No section collapse, no tabs, no left nav. One long scroll, sections never reorder.
- Page background is `palette.window`; header wash gradient from art tint scrolls away with the page (see 6.5). A 14px shadow gradient under the top bar deepens over the first 24px of scroll (`ui/mod.rs:576`).
- Empty search: centered `Search` icon 40px dim, title `No settings for "{query}"` (semibold 16), body "Try fewer words, or check the spelling." (regular 13.5, secondary), 48px top gap (`widgets.rs:3233`, settings.rs:2569).
- Changes apply immediately; there is no Save button. `Action::SettingsChanged` marks dirty; file is written at most every 2 s (`app.rs:4721`) as one JSON file, atomically. Theme and language apply on the same frame (`app.rs:13607-13620`).
- Exception: **playback engine rows** need an explicit "Apply and restart playback" (see 1.4). Proxy manual fields need "Apply settings".

### 1.2 Row layout rules (`widgets.rs:3730-3830`)
- Control slot is reserved `max(control_width+16, 260)` px. If `available - reserved < 140` (the minimum text width) the control drops to its own line under the text, right aligned, 6px gap. This is computed from known widths, never from last frame, so the layout never needs a second pass.
- Option groups ("segmented" soft buttons) lay out right-to-left so the last choice is placed first and reads left-to-right; if they do not fit on one line they stack top-to-bottom (items right aligned, 6px gap). Used by Audio quality, Tray icon, Player bar visualizer, Start with computer (settings.rs:909-962 and clones).
- `setting_note` = row with no control (storage sign-in line) (widgets.rs:3739).
- Text rows are `selectable_labels = false` everywhere (theme.rs apply_to_style): no text selection on labels, only on inputs.

### 1.3 Search in settings (the trick that makes one long page usable)
- Field state lives in egui temp memory (`settings-filter`), NOT persisted. `clear_search()` (252) lets flows that jump to a row (Personal App setup) reset it so the row is visible/focusable.
- Match = case-insensitive substring of **title OR description OR section title** (`RowText::matches` 58). A word only the section knows shows the whole section (soloist 509-515).
- Rows deliberately carry hidden keywords: the EQ "Presets" row title is `"Presets Preamp Bands dB"` and its description lists every preset name plus user-preset names plus "Save preset" so typing "rock" or "preamp" finds the EQ card (2284-2308). MilkDrop pack names are the description of the "Get presets" row (2163-2175). Skin names are appended to the Winamp/WMP row descriptions so typing a skin name finds the mini-player section (1824-1845). Storage row titles get the live size appended ("Artwork cache · 12.3 MB") before matching.
- Results are the same cards, filtered; no separate results list, no highlight of the matched text, no result count.
- Row descriptions switch by state (examples: Account row text differs if on shared grant; Theme row shows the catalog status line; macOS vs other OS shortcut wording via `keys::platform_shortcut`).

### 1.4 Playback (built-in player) section, title "Playback on this computer" (title becomes "Application" when Soloist is on) (745-1230)
Rows (title / description / control / default / notes):
| Row | Control | Default | Notes |
|---|---|---|---|
| Status: {Ready, Setting up, Connecting, Waiting for network, Unavailable, Not set up} | primary pill "Enable playback here" / "Try again" else soft button with Refresh icon "Reconnect" | | Description changes per state. DROP-ish (Spotify Connect state) but the status-row pattern (state word in title, plain sentence below, one action button) is reusable |
| Device name | text field 200px, hint none | `Spotifast` | "How this computer appears in Spotify Connect." Sets dirty flag |
| Audio quality | 3 soft buttons "Normal · 96 kbps", "High · 160 kbps", "Very high · 320 kbps" | 320 | "Higher bitrates use more data and cache space." DROP (Spotify bitrate) |
| Normalize volume | switch | off | "Keep loud and quiet tracks at a similar level." |
| Autoplay | switch | on | "Keep playing similar songs when your music ends." DROP (Spotify recs) |
| Gapless playback | switch | on | "Play tracks without silence between them." |
| Keep music playing when the window closes | switch | on | Text differs per OS: tray vs menu bar, Ctrl+Q vs Cmd+Q. Applies at once, no restart |
| Show in Dock (macOS) | switch | on | Off = menu-bar app, leaves Cmd+Tab |
| Tray icon (not macOS) | Colour / White / Black soft buttons | Colour | |
| Start with your computer (only when autostart supported) | Off / With the window / In the tray (menu bar on macOS) | Off | Description changes: needs approval in System Settings > Login Items; "Starting in the tray needs Keep music playing..." warning when Hidden but not keep-running (2610-2692) |
| MacBook notch widget (macOS) | switch | off | "Show interactive Now Playing widget when hovering over the notch." |
| Automatic update checks | switch | on | "Checks GitHub once a day. No personal data is sent." |
| Download updates automatically | switch | off | "Downloads in the background. You choose when to restart." |
| Output buffer (Windows only) | 50 / 100 / 200 ms soft buttons | `sink::DEFAULT_BUFFER_MS` | "More buffering can prevent clicks on busy computers..." marks dirty |
| Local files | pill "Choose folder" (+ "Remove" pill and "Open folder" soft ExternalLink button once set) | none | Description is live: "{count} song(s) in {folder}" / "Looking for songs in {folder}..." / explanatory sentence. Controls ordering: right-to-left so Choose folder is leftmost |
| Audio cache | switch + (when on) 3 soft buttons "4 GB", "1 GB", "512 MB" | on, 1024 MB | Size buttons appear only while the switch is on |
Below the rows: a footer line (4px gap). When any engine row changed ("playback_dirty", stored in egui temp memory, not settings): primary pill **Apply and restart playback** + subtle text "Restart local playback to apply these settings."; else subtle "Playback settings applied." The dirty flag covers device name, bitrate, normalize, autoplay, gapless, buffer, cache toggle/size. Rows that need no restart (keep playing, update checks, tray, dock) do not set it. (1211-1228)
Rule: rows that need a restart are batched behind ONE apply button instead of restarting on every click.

### 1.5 Appearance (1232-1697)
| Row | Control | Default / range |
|---|---|---|
| Theme | ComboBox 200px (min with avail): Follow system / Light / Dark, separator, then each local palette file by display name (filename without .json). Below it two soft buttons: "How to make a theme" (Globe, opens docs anchor #custom-themes) and "Open themes folder" (ExternalLink); if both do not fit they stack | Follow system. Description is the catalog status line when there is one (loading, selected unavailable, folder unreadable, >512 entries, >128 palettes) else "Follow system uses your desktop's light or dark appearance." (Omarchy: "...uses your Omarchy colours.") |
| Light mode theme / Dark mode theme | two ComboBoxes, only shown when Theme = Follow system, no custom theme, not on Omarchy. Each starts with the built-in Light/Dark then a separator then palettes whose `base` matches | unset = built-in |
| Language | ComboBox 200px, height 1000 (menu does not scroll): "System" then each language by its OWN name (never translated: Deutsch, Espanol, Nederlands, Portugues (Brasil), Portugues (Portugal), Francais, Svenska, Polski, Russian, Italiano, Japanese, Korean, Simplified/Traditional Chinese, Turkce, Ukrainian) | System. Applies instantly, no restart (13615) |
| Colour from album art | switch | on. "Use the current cover's colour on pages and the player bar." |
| Compact library sidebar | switch | off. "Show names without covers in the sidebar." |
| Compact track list | switch | off. "Show each track on one line without a cover." (row 36px vs 56px) |
| Interface zoom | soft "+" , "{n}%" label (medium 13.5), soft "-" | 100%, step 0.1, range 0.5 to 2.5. Writes `ctx.set_zoom_factor`. Ctrl/Cmd +, -, 0 work anywhere |
| Middle-click autoscroll (Linux) | switch | off. Because Linux middle click pastes |
| Custom title bar (Windows/Linux when controls visible) | switch | off. Pushes an action (needs window recreate) rather than flipping a bool |
| Player bar visualizer | Off / Spectrum / Waveform | Off |
| Click player bar to change visualizer | switch | on. Tooltip over bar: "Click to change the visualizer" (player_bar.rs:77) |
| Frame rate | "dial" (see 1.6) | 60 fps |
The last three rows only exist when `visualizers_available()` (not available with Soloist unless audio route works).

### 1.6 The frame-rate dial (259-323)
A slider that only stops on useful values, "the way a gear lever does": stops = {30, 60, screen refresh rate (if reported and >=10), current rate (if custom), Uncapped}, sorted ascending with Uncapped last (milkdrop.rs:57-67). Slider range is index 0..=last, step 1. Value box (pill, radius 14, 13px medium) formats the stop label: "30 fps", "144 fps, your screen", "Uncapped" (milkdrop.rs:73-85). Dragging the box moves one stop per 20px (speed 0.05). Typed text snaps to the nearest stop; text starting "un" = Uncapped; trailing "fps" and decimals stripped. Screen refresh is detected live from the monitor showing the window (re-asked on window move, and once a second; entrypoint.rs:1307-1330) and 0/1 Hz ("hardware default" on Windows) is ignored (`is_screen_rate` = hz >= 10). Used twice: visualizer fps and MilkDrop fps (same widget; description names the screen rate: "Your screen refreshes at {hz} Hz. Higher rates do not add visible frames.").
Slider visual: rail fill uses accent up to the handle (`slider_trailing_fill`), handle circle; value box pill fill surface/hover/active (202-219). Rail uses default theme rounding because a pill radius leaks accent past the handle (195 comment).

### 1.7 Proxy (1699-1789) (keep as "Network/Proxy" if MaiPai needs outbound)
Row "Mode" with description; below it a full-width line of 4 soft buttons Off / System / HTTP / SOCKS5 (default System). Manual modes show a 2x2 grid of labelled fields: Host (hint 127.0.0.1) | Port (hint 1080) / Username | Password (masked), each field a labelled text input: caption medium 13, 6px gap, box radius 8, margin 12x10, fill surface; then a scope note ("Proxy login applies to Web requests...", "Spotify hostnames are resolved by the proxy...") and primary pill **Apply settings**. Off/System apply immediately and show subtle "Not using a proxy." / "Using the system proxy." Editing host/port/username clears the password field (anti leak). Password goes to the credential store, never settings.json (settings.rs:171-185). The same widget is reused on the sign-in card (login.rs:586) and expands the card from 400 to 500 or 720 px.

### 1.8 Mini player section (1794-2082)
Rows: "Show the mini player" (primary pill "Switch to it"; shortcut Ctrl+M, Cmd+Shift+M mac), "Skins folder" (soft "Open folder"), then two sub-headers drawn by `skin_part` (4x22px accent bar + bold 18 title; 6px below; 14px after): **Winamp** (note "Classic .wsz skins. Find more at the Winamp Skin Museum.", soft Globe button "Skin Museum", card grid with a first built-in "Spotifast" card) and **Windows Media Player** (note, soft Globe "Windows Media Player Skins Collection", if only shipped skins: note "Installed skins are in {folder}. None of this kind yet.", card grid). Then "Random skin" switch (off), "Size" 1x..4x soft buttons (default = double size for display; "Whole-number scaling keeps skin pixels sharp."), "Always on top" switch (disabled with an explanatory description where the platform cannot, e.g. Wayland), "Show in taskbar" switch (only where supported). Skin cards: section 9.6.

### 1.9 MilkDrop row set, EQ rows, Storage, About: see sections 5, 2, 10, 1.10.

### 1.10 About (2482-2567)
40px app logo (the real app icon rasterised at devicePixel size and cached in egui memory, theme.rs logo()) + "Spotifast {version}" (semibold 15) + "Built with Rust, egui, and librespot. Not affiliated with Spotify." (regular 13 secondary). 8px. A wrapping row of soft buttons (8px gap): Refresh "Check for updates" (label becomes "Checking..." and click ignored while checking), ExternalLink "Release notes" (URL = repo + /releases/tag/v{version}, built at compile time), Info "Keyboard shortcuts" (opens dialog), ExternalLink "Source code". 14px, then a credit line: red heart + "Built with love by " + link "Carmine Paolino" (medium 13, underline on hover, hover tooltip shows URL). The name is spliced into a translated sentence via `{name}` so word order is translatable (widgets.rs:3699).

### 1.11 Hidden / file-only settings (settings.json, defaults at settings.rs:487-583)
UI-less but real: `home.made_for_you.visible`, `home.recommendations.visible` (DROP), `sidebar_width` 250, `lyrics_width` 360, `queue_width` 360 (panels share one width so toggling never shifts the page), `volume` = 70% of u16, `milkdrop_panel_height` 232 skin px, `milkdrop_size` 640x480, `playlist_height` 174 skin px, `show_shortcut_hints` true, `search_history`, `pinned_contexts`, `sidebar_order`, `library_sort` per shelf, `library_by_you`. Forward-compat pattern: `#[serde(default)]` on the whole struct, unknown language tag falls back to System instead of failing the file (settings.rs:127-141), optional fields skipped when default (`skip_serializing_if`), legacy proxy combined address split on load and never written back. `Debug` impl strips the proxy username so logs never leak it (settings.rs:370).

---------------------------------------------------------------------------------------------------

## 2. Equalizer UI (settings card + mini-player window) (`ui/settings.rs:2275-2388,2794-2898`; `ui/winamp/equalizer.rs`; `eq.rs`)

### 2.1 Data model (`eq.rs`, `settings.rs:263+`)
- Bands (Hz): 60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000 (note: 12K/14K/16K are Winamp's, uneven). Range +-12 dB both bands and preamp (note: the doc comment at settings.rs `eq_preamp_db` says "never above zero" but code and docs allow +-12; the comment is stale).
- Settings fields: `eq_on` (false), `eq_preamp_db` (0), `eq_bands_db[10]` (0), `eq_user_presets[]` {name, preamp_db (default 0), bands_db[10]}, `balance` -1..1 (0), `mono` (false). Balance and mono apply even with the EQ off (eq.rs:24-34). Balance gains: left=min(1,1-b), right=min(1,1+b): the louder side stays at unity, the other is attenuated.
- Peaking biquad per band, with widths set from midpoints between neighbours (outer bands 3 octaves below 60 Hz and 1 octave above 16 kHz); bands within 0.05 dB of flat are skipped; gains are solved (6 iterations of a 10x10 Gaussian elimination) so the combined response meets each slider at its own centre despite overlap (eq.rs:87-190). The curve drawn in UI uses the exact same filters (`settings.curve().db_at(hz)`), so the picture is the sound.
- Shared to the audio thread through an `Arc<Mutex<EqSettings>>` (`push_eq` app.rs:5370).

### 2.2 Settings page "Equalizer" card
```
 Equalizer                                  <- section
 +------------------------------------------------------------+
 | Equalizer                                          [switch]|   row: title "Equalizer", desc "A ten-band equalizer for
 | A ten-band equalizer for playback on this computer...      |   playback on this computer. It does not affect other devices."
 |  (chip) Flat (chip) Classical (chip) Club ... wraps        |   26 built-in + user presets as pill chips, 8px gap
 |  [ Preset name        ] [+ Save preset] [trash Delete "x"] |   field 160px (radius 6), buttons soft
 |  +------------------------------------------------------+  |
 |  | +12 ......................................  curve      |  |   plot h120, w<=720, radius 8, fill surface
 |  |  +6                                                    |  |   H lines at -12,-6,0,+6,+12 (0 dB line dim, others outline)
 |  |   0 ----------------o--o----o---                       |  |   V line per band; line accent 2px (dim when EQ off); dot r3 per band
 |  +------------------------------------------------------+  |   at (band dB + preamp)
 |  [Pre][60][170][310][600][1K][3K][6K][12K][14K][16K]       |   11 vertical sliders, 14px gaps
 +------------------------------------------------------------+
```
- Chip row: active chip = filled `text` colour with `window` text (soft_button active). "current" preset = a user preset when bands AND preamp match, else the first built-in whose bands match (flat if none) (2336-2347). Choosing a built-in preset turns the EQ on and does NOT change preamp; choosing a user preset also restores its preamp and turns the EQ on (app.rs:14002-14054).
- Presets: 26 built-in (the brief said 23; real count is 26, `eq.rs` PRESETS): first 18 are Winamp's, in Winamp order: Flat, Classical, Club, Dance, Full Bass, Full Bass & Treble, Full Treble, Laptop Speakers / Headphones, Large Hall, Live, Party, Pop, Reggae, Rock, Ska, Soft, Soft Rock, Techno. Then 8 of this app's (shown behind a separator in the mini-player menu; in the settings chips there is no separator): Bass Booster, Bass Reducer, Treble Booster, Vocal Booster, Small Speakers, Spoken Word, Loudness, Night Listening. Values (dB, 60..16K): Flat all 0; Classical [0,0,0,0,0,0,-7.2,-7.2,-7.2,-9.6]; Club [0,0,8,5.6,5.6,5.6,3.2,0,0,0]; Dance [9.6,7.2,2.4,0,0,-5.6,-7.2,-7.2,0,0]; Full Bass [-8,9.6,9.6,5.6,1.6,-4,-8,-10.4,-11.2,-11.2]; Full Bass & Treble [7.2,5.6,0,-7.2,-4.8,1.6,8,11.2,12,12]; Full Treble [-9.6,-9.6,-9.6,-4,2.4,11.2,12,12,12,12]; Laptop [4.8,11.2,5.6,-3.2,-2.4,1.6,4.8,9.6,12,12]; Large Hall [10.4,10.4,5.6,5.6,0,-4.8,-4.8,-4.8,0,0]; Live [-4.8,0,4,5.6,5.6,5.6,4,2.4,2.4,2.4]; Party [7.2,7.2,0,0,0,0,0,0,7.2,7.2]; Pop [-1.6,4.8,7.2,8,5.6,0,-2.4,-2.4,-1.6,-1.6]; Reggae [0,0,0,-5.6,0,6.4,6.4,0,0,0]; Rock [8,4.8,-5.6,-8,-3.2,4,8.8,11.2,11.2,11.2]; Ska [-2.4,-4.8,-4,0,4,5.6,8.8,9.6,11.2,9.6]; Soft [4.8,1.6,0,-2.4,0,4,8,9.6,11.2,12]; Soft Rock [4,4,2.4,0,-4,-5.6,-3.2,0,2.4,8.8]; Techno [8,5.6,0,-5.6,-4.8,0,8,9.6,9.6,8.8]; Bass Booster [8.8,7.2,5.6,3.2,0.8,0,0,0,0,0]; Bass Reducer [-8.8,-7.2,-5.6,-3.2,-0.8,0 x5]; Treble Booster [0 x5,0.8,3.2,5.6,7.2,8.8]; Vocal Booster [-2.4,-4.8,-4.8,1.6,5.6,5.6,4,1.6,0,-2.4]; Small Speakers [-8,-6.4,-4,-1.6,1.6,3.2,4.8,5.6,5.6,5.6]; Spoken Word [-3.2,-0.8,0,0.8,4,5.6,4.8,2.4,0.8,0]; Loudness [9.6,6.4,0,0,-2.4,0,-1.6,0,8,1.6]; Night Listening [-4.8,-3.2,-1.6,0.8,2.4,3.2,2.4,0.8,-1.6,-3.2]. (Values are multiples of 0.8: Winamp's 0..63 byte scale mapped to +-12 dB.)
- User presets: text field (hint "Preset name", 160px, radius 6) + soft button "+ Save preset" (disabled when the trimmed name is empty; Enter in the field also saves). Saving under an existing name replaces it. "Delete "{name}"" soft button with trash icon appears ONLY while a saved preset is the current one; deleting leaves the sound unchanged. Saves preamp + 10 bands. Draft name kept in egui temp memory. Presets edited by hand in JSON are re-clamped on apply (app.rs:14002).
- No dedicated "Reset" button in Settings. Reset paths: choose preset "Flat" (bands only, preamp stays), double-click any slider (that slider to 0), the mini player's AUTO button (applies preset 0 = flat bands, turns EQ on; Winamp's AUTO was per-song presets), or a WMP skin script `ResetEq` (zeroes bands). (note: preamp is not reset by Flat or AUTO; only by double-click on Pre.)
- Balance and mono are NOT in Settings. Balance = slider in the mini player main window (BALANCE area; snaps to 0 within +-0.08 of centre, `balance_of` winamp/mod.rs:1487) and tiny slider in the EQ shade bar; mono = MONO/STEREO lamps in the mini player (click MONO to fold channels, STEREO to unfold; tooltips "Play in mono", "Play in stereo"; lamps dim when nothing is sounding). A web rebuild should surface balance + mono in the same EQ card.

### 2.3 The vertical slider widget (`eq_slider` 2798-2851)
- Hit rect 30 x 118 px; track 4px wide, 98px tall (rect minus 20), radius 2, colour surface_active. Fill from 0 dB to the value, accent when EQ on, `dim` when off. 0 dB tick: 1px dim line extending 3px either side. Handle: circle r=7, `text` colour. Hover or drag shows the value as "+3.5" / "-2.0" (regular 11, secondary) at the top of the rect. Label below (regular 11.5, secondary): "Pre", then "60","170","310","600","1K","3K","6K","12K","14K","16K" (`hertz()` 2787).
- Interaction: click or drag sets value from pointer y, snapped to 0.1 dB, clamped +-12. Double-click = 0. No keyboard handling and no accessibility info in this widget (gap; the mini-player EQ has none either).
- Sliders stay editable while the EQ is off (they just draw dim); changing a band does not turn the EQ on. Preset pick does.

### 2.4 Mini-player EQ window (skin sprites) (`ui/winamp/equalizer.rs`, `skin/layout.rs:127-148`)
275 x 116 skin px (14px title bar at top). Zones: ON (14,18, 26x12), AUTO (40,18, 32x12), PRESETS (217,18, 44x12), graph (86,17, 113x19), preamp slider (21,38, 14x63), band sliders at x=78+18*i, y=38, 14x63, thumb 11px, travel 52. Close (264,3, 9x9), shade/roll-up (254,3). Graph: Catmull-Rom spline through the 10 bands drawn one skin pixel column at a time (12 px per band step, 2px pad), colours sampled per row from `eqmain.bmp`'s line gradient; preamp drawn as its own line sprite. Slider face = one of 28 frames chosen from value. Thumb sprite pressed variant while dragging. Title bar: drag moves window; double-click rolls up. PRESETS opens a popup menu: built-ins, separator after the 18th, then a separator and the user presets; scrolls if taller than the window; the current one shows selected (bands equal) (presets_menu 291-324).
EQ shade mode (14px tall): contains tiny volume (97x7 at x=61) and balance (43x7 at x=164) sliders with 3px thumbs that change sprite by thirds (LOW/MIDDLE/HIGH or LEFT/MIDDLE/RIGHT); mouse wheel on volume = +-5 per notch (`wheel_notches`: one mouse detent = one event regardless of Windows' x3 multiplier, 50 points = one notch for trackpads; widgets.rs:3257).

---------------------------------------------------------------------------------------------------

## 3. Limiter (`limiter.rs`) - no UI, no setting

Fixed look-ahead soft-knee limiter on the final output (the 'EQ boosts can clip' safety net): threshold -1 dBFS, knee 2 dB (unity from -2 dBFS, aligned with librespot normalisation's threshold so flat normalised audio is unchanged), attack 1.5 ms, release 100 ms, look-ahead 8 ms (353 frames at 44.1k), one gain for both channels (stereo image preserved), quadratic knee, final clamp as numeric guard. `full_scale` is passed in so output volume applied later is accounted for (at 25% volume a sample of 4.0 is full scale). It is always on; there is no toggle, ceiling, or release control in Settings. Detail of the DSP is in audit-c section 4. Web rebuild: do not expose it; run a limiter (or `DynamicsCompressorNode` with tuned params) whenever EQ preamp/bands boost. Show nothing, but consider a read-only "headroom" hint in the EQ curve when sum of preamp + max band > 0.

---------------------------------------------------------------------------------------------------

## 4. Visualizers (`vis.rs`, `ui/player_bar.rs:127-440`, `ui/winamp/*`)

### 4.1 Common
- Source: `AudioTap` keeps the last 0.5 s of **post-EQ, pre-volume** mono mix (stereo goes to MilkDrop via shared-memory ring). So changing volume never changes the picture; changing EQ does (docs milkdrop.md:30-33).
- Lag compensation: the visualizer reads the window ending `LAG` = 200 ms behind the newest sample (sink queues 180-200 ms plus device buffer) so the picture matches what the speaker is playing; with Soloist native route lag = 0 (app.rs:2031).
- Availability: only for audio played on this computer (`visualizer_sounding`: playing/loading AND local). Not for remote devices.
- Frame rate: user setting `visualizer_fps` (default 60, "Frame rate" dial). Budget: out of focus = half; OS saver = at most 30 (and half of that out of focus); window hidden/screen off/locked = none (`power.rs:49-60`). Uncapped halves to 30 out of focus.
- Settled detection: when nothing sounds and all bars/peaks are 0 the component reports "not moving" and the app stops requesting repaints (zero CPU while paused).

### 4.2 Player-bar visualizer (behind the 88px bar, full width incl. margins) (`player_bar.rs`)
- Modes `Off | Spectrum | Waveform`; click on empty bar space cycles Spectrum -> Waveform -> Off (`PlayerBarVis::next`, Winamp-style) when "Click player bar to change visualizer" is on. Tooltip "Click to change the visualizer" only while the empty space itself (not a control above it) is hovered. Controls drawn after the click zone take their own clicks.
- Spectrum: `WideAnalyser` = Winamp's classic analyser (512-sample FFT, 75 semitone-spaced bands via Hermite-interpolated bin sums, x2 channel-sum scale, x0.5 spec scale) with each of the 75 columns a bar (heights 0..1, not whole rows). Rise instant, fall `0.75/15/0.016667` heights per second (smooth at any fps). Peak caps hang 0.35 s then fall with gravity 2.4 height/s^2; values <0.01 snap to 0. Drawing (constants player_bar.rs:15-39): bar gap 2px; reach = bar height - 2 (gap) - 2 (cap) - 1; bar gradient alpha foot 0.28 to top 0.08 (scaled by level); glow = bar expanded by (2px, 3px) at alpha 0.12 (top 0.3x); peak cap 2px high, alpha 0.7, 2px above bar; "bass pulse": a rectangle over the lower half of the bar fading from transparent to colour at alpha `0.35 * bass^2` where bass = mean of the lowest 1/8 bands. On a light bar all alphas x1.5 (`LIGHT_STRENGTH`). All painted into one egui `Mesh` (one draw call).
- Waveform: Winamp scope, every 7th sample (`SCOPE_STEP`), column every ~8px (75..320 points), value=sample*2 clamped to -1..1 (half full-scale reaches the edge; trembles like Winamp). Drawn as 3 glow layers (widths/alpha 9/0.06, 4/0.16, 1.6/0.85), a faint fill to the midline (alpha 0.14), and a mirrored echo at -0.6 scale alpha 0.18; lines built in runs of 8 points so colour can sweep along the line.
- Colours (`vis_colours` 191-229): with art colours on: the cover's palette (up to 4) - hues first, in the cover's order, then its grey - each forced vivid (s>=0.55, v=1) for hues or pure grey for neutrals, then luminance-clamped (dark theme <= 0.35 relative luminance; light theme kept within 0.2..0.4 so dark text still reads). Swept bass-to-treble with gamma-space lerp (`swept`). Without art: accent for bass, accent hue +60 degrees for treble.
- Bar background fill eases to the art tint with a 450 ms per-channel `animate_value_with_time` (TINT_FADE) at 12% strength, no fade when reduce-motion.

### 4.3 Mini-player analyser / scope (skin-drawn)
- `Analyser` = same FFT but 19 bars x 3 columns wide + 1 gap, 16 rows, height 0..15, falloff 0.75 rows per 1/60 s step with fixed 16.667 ms internal clock (`STEP`) so bars fall at the same speed at any fps; catches up at most 2 steps (frames at half rate owe two steps). Peaks in 1/256 row units, speed starts 3, x1.1 per step. Scope: 75 columns, 16 rows, centre row 7, every 7th sample, five shades by row (`scope_shade`). Mode `VisMode` bars/scope/off, click the display to cycle bars -> scope -> off. Also works in the collapsed (shade) title bar.

### 4.4 Settings entry points for visualizers
Appearance section rows (player bar mode, click-to-cycle, frame rate) + the MilkDrop section (below) + mini-player "V" menu. Everything is hidden when `visualizers_available()` is false.

---------------------------------------------------------------------------------------------------

## 5. MilkDrop (`milkdrop.rs`, `milkdrop/*`, `ui/winamp/milkdrop.rs`, docs `_guide/milkdrop.md`)

### 5.1 Architecture (how it is shown)
projectM (libprojectM, OpenGL) runs in a CHILD PROCESS (`--milkdrop-child`) because winit allows one event loop per process and an OpenGL context on egui's thread would freeze the UI. Audio = shared-memory ring (stereo f32) to the child. Three presentation modes: (a) own window (resizable, drag-to-move, fullscreen toggle), skinned with the classic skin's frame (`gen.bmp`) when a Winamp skin is on; (b) panel inside the mini-player window (frames published to shared memory, drawn as a texture; panel height `milkdrop_panel_height` 232 skin px, resizable by a bottom-left grip in whole skin pixels, `ResizeVertical` cursor; double-click or the "Full screen with lyrics" button goes fullscreen); (c) behind full-screen lyrics (`lyrics_milkdrop`, dimmed until words are clear, active line in accent). Not shipped on Windows ARM.
Before the first frame arrives the pane draws the skin's plain background plus a built-in bars animation ("A built-in animation appears while the download starts").

### 5.2 Settings section "MilkDrop" (2084-2273; only when visualizers available)
| Row | Control | Default | Notes |
|---|---|---|---|
| MilkDrop window | switch | closed | desc lists the ways to open it: top bar, Ctrl/Cmd+Shift+K, mini player V menu; "Press ? or F1 for its shortcuts" |
| Presets | text-only; below it a button line | | Description counts: "None yet in {folder}..." / "One preset in {folder}..." / "{n} presets in {folder}..." (plural catalog). Buttons on one line: Globe "Get MilkDrop's own" ("550 presets that shipped with MilkDrop 2; about 1 MB", tooltip), Globe "Get Cream of the Crop" (9,800 presets, ~25 MB), ExternalLink "Open folder". While downloading a pack its button reads "Fetching..." and other clicks are ignored |
| Time per preset | log slider + value box with " s" | 10 s, range 2..300 | Never shorter than the 2.7 s fade (`CROSSFADE_SECONDS`) in logic |
| Frame rate | dial | 60 (first run: the screen's rate) | 10..360 range for custom; "Uncapped" |
| Resolution | Full / Half / Quarter soft buttons | Full (scale 1) | "Half and Quarter use fewer resources and scale the image back up." |
Auto-fetch: first open with an empty preset folder downloads both packs automatically (sequential; if the first fails with 0 added it reports an error, later failures keep what arrived). Presets listed recursively to depth 4, sorted case-insensitively by path, on a worker thread (listing a pack took 0.33 s on Windows and froze the UI), cached 30 s; `has_presets` is a cheap first-hit check allowed on the UI thread. Pack zips are unpacked flat; filenames validated (`is_plain_file_name`: one normal component, no ':' drive/stream suffix).

### 5.3 Behaviour and keys (child.rs:600-653; docs)
N / Right = next; P / Left = previous; H = hard cut on next beat; L = lock current preset; R = toggle random vs folder order; T = show/hide preset name; D = show/hide FPS; I = cycle song info overlay (notification / always / hidden); F or double-click or Alt+Enter = fullscreen; Esc = leave fullscreen/close; ? or F1 = key list overlay. Playback keys work inside: Space, Ctrl+Left/Right, Ctrl+Up/Down volume, M mute, B like, S shuffle. Right-click inside the mini-player panel = next preset. Preset history keeps the last 100 for Previous/Next. Random mode avoids repeating the current preset. A failed preset leaves the current one playing for another turn (#1120). Time per preset is counted app-side, not by projectM, so a changed value applies to the preset already playing.
Overlays (`overlay.rs`): CPU-rasterised text (skrifa + tiny-skia) uploaded as one bitmap and blended over the frame; sized from a 480px-tall reference scaling with the window; margins 14, pad 10, column gap 14, shadow 1px; key list on a black box alpha 190 radius 8; song title fades over 900 ms and drifts 6% bigger as it fades; font stack Inter (variable weight + optical size axis) -> Noto Emoji -> system fallbacks; missing glyph shows "?". Overlay stays 3 s (messages), 4 s (song), 12 s (help) (child.rs:717-900).
Energy: stops when minimised (and on macOS/Linux when covered); in OS saver at most 30 fps; display off/locked 1 fps (`power.rs:35`). Window size remembered, min 320x240.

---------------------------------------------------------------------------------------------------

## 6. Themes and appearance (`theme.rs`, `settings.rs`, `appearance.rs`, `app.rs:5560-5640`)

### 6.1 Tokens (17 colours + mode flag) (`theme.rs:17-86`, file-settable names at 117-136)
| Token | Dark | Light | Role |
|---|---|---|---|
| window | #0f1114 | #f8f9fb | page background |
| panel | #15181c | #ffffff | sidebar, player bar, side panels, cards on login |
| surface | #1d2127 | #eef0f3 | inputs, chips, inactive widgets, settings cards (x0.7 in dark) |
| surface_hover | #262b33 | #e3e6eb | hover fill |
| surface_active | #2f353f | #d7dbe1 | pressed/selected fill, switch off track, slider rail |
| outline | #2a3038 | #dde1e6 | 1px borders, dividers |
| text | #f2f4f6 | #14171a | primary text, active chip fill |
| secondary | #a9b1bc | #535b66 | descriptions, meta |
| dim | #6e7784 | #8b939e | disabled/placeholder, EQ off, idle outlines |
| accent | #1ed760 | #15a64a | primary buttons, switches on, slider fill, focus ring, playing row |
| accent_hover | #3ce87a | #128f40 | primary hover |
| on_accent | #0a140e | white | text on accent |
| danger | #f5717f | #d63b4c | errors, heart in credit |
| warning | #f2b85c | #b87a14 | warnings |
| overlay | #22272e | #ffffff | menus, tooltips, dialogs, toasts, update window |
| shadow | black a140 | black a50 | popup/window shadows |
| tint | transparent | transparent | page-header fade colour when no art tint; alpha = strength |
- Fixed (not themed): listening dot blue #4285f4 (friends), pre-save green #1ed760 (prerelease), white text on art washes, countdown plate `black alpha 105`, hover-dim `black alpha 140` over covers.
- Shape tokens: RADIUS 8, RADIUS_SMALL 4 (widgets use 6), windows/cards 10, login card 16, pills fully round (h/2). Heights: ROW 56, COMPACT 48, THIN 36, PLAYER_BAR 88, TOP_BAR 56 (custom titlebar on Windows 48), side panel min 280 (max 560 for friends), macOS titlebar inset 28.
- egui Style (theme.rs apply_to_style 340-430): text styles Small 11.5 / Body 14 / Button 14 / Heading 22 / Mono 13; item spacing 8x6; button padding 12x6; interact size 40x28; menu margin 6; window margin 16; scroll bars floating 6px (8 when active), handle min 28, handle opacity 0.55 idle / 0.85 interact, invisible when dormant; selection fill accent x0.35 + 1px accent stroke; text cursor 2px accent; window shadow offset 6 blur 24, popup 4/16; tooltip delay 0.4 s; hyperlink colour = text colour (links are underlined on hover only).
- Type: Inter variable (Regular/Medium/SemiBold/Bold as separate font ids via `fastframe_fonts::Weight`), Noto Emoji monochrome bundled as fallback; platform colour emoji painted over the glyphs by `fastframe_emoji::EmojiPlugin` (Apple Color Emoji / Segoe UI Emoji / desktop font; synchronous mode for demo captures; `warm_up` thread); system fallback fonts found by `fastframe_fonts::system::fallbacks()` for scripts Inter lacks (CJK, Arabic, Hebrew, etc.). `system_fonts.rs` is only for the Winamp playlist face: scan font directories (depth 4, <=64 faces per collection, to survive hostile files) for Arial -> Liberation Sans -> Arimo -> Helvetica -> Nimbus Sans -> DejaVu Sans.
- Text rendering follows the desktop (`fastframe_text::detect` once per process): linear coverage on Linux (egui's dark curve made text heavier than GTK), subpixel binning on.
- Icons: Lucide + custom set of ~95 SVGs compiled in (`theme::Icon`), rendered through egui image loaders, tinted per use. Play glyph is optically shifted by `size*(0.03 - 1/24)` px so the triangle looks centred (theme.rs `play_glyph_offset`).

### 6.2 Choosing a palette (settings.rs:243-250,484+, app.rs:5560-5640)
- `theme` = system (default) | light | dark. Follow system uses OS appearance; on Linux where winit reports none, an XDG Desktop Portal watcher thread reads `org.freedesktop.appearance color-scheme` (1 dark, 2 light, 0 no preference = light) and subscribes to `SettingChanged` BEFORE reading so a change in between is not missed (appearance.rs). GNOME `enable-animations` is read the same way for motion.
- `custom_theme` (palette JSON filename), `custom_theme_cache` (last accepted palette so a deleted/invalid file keeps looking the same across restarts), `system_theme_cache` (Omarchy), `theme_pair` (light/dark file choices + cached palettes, only written when chosen).
- Palette files: JSON, `{"base":"dark|light","colors":{token:"#RRGGBB[AA]"}}`; omitted tokens inherit from base; unknown token names are rejected (`set()` returns false). `overlay` is DERIVED when a file omits it but gives `window`: dark -> window lerped 8% toward text; light -> panel (theme.rs:111-123). Limits: 64 KiB per file, 128 files, 512 folder entries, regular UTF-8 files only, no symlinks/subfolders. 8 presets copied into the folder on first launch (Catppuccin, Catppuccin Latte, Nord, Ristretto, Rose Pine, Rose Pine Dawn, Rose Pine Moon, Tokyo Night), tracked in `.installed-palettes` so deleted ones stay deleted; never rewritten. Linux watches the folder (inotify); other OS use `spotifast reload-themes`.
- Omarchy (Linux tiling distro): a Jinja-like template (`contrib/omarchy/spotifast.json.tpl`) maps Omarchy's palette to tokens: window=background, panel=dark_background, surface=mix(bg,fg,8%), hover=12%, active=selection, outline=mix(bg,muted,50%), text=foreground, secondary=mix 70%, dim=mix 50%, accent, accent_hover=mix(accent,fg,15%), on_accent=background, danger=red, warning=yellow, overlay=mix(lighter_bg,fg,3%), shadow=darker_bg+"80", tint=accent+"12". Reusable idea: ANY theme source reduces to the 17 tokens with fixed derivation rules.
- Applying a theme pushes the palette into egui visuals: panel_fill=panel, window_fill=overlay, extreme_bg/faint_bg/code_bg=surface, override_text=text, weak_text=secondary, widgets bg by state (inactive surface, hover surface_hover, active/open surface_active, noninteractive panel + outline stroke), no widget strokes, expansion 0, corner 6, slider trailing fill on, circular slider handle, striped rows off.
- Switching theme: "the new colours open from the middle of the window outwards, as Omarchy's own theme change does" (docs). Implemented by `theme_transition` (fastframe): snapshot old frame, hold, reveal; skipped when reduce-motion, on first colours, and in the mini player (skin-drawn). On apply: `accents` art-tint cache is cleared (tints are lightness-normalised per theme).

### 6.3 Art tint ("Colour from album art") (`theme.rs:89-107`, `images.rs:661-720`, `app.rs:2657-2680`)
1. Cover fetched, decoded, thumbnailed to 48x48 off-thread.
2. Pixels bucketed by 4-bit RGB (r>>4,g>>4,b>>4); weight = (1 + 6*saturation) * max(0.05, 1 - |lightness-0.5|*1.4) so vivid mid-tones win and black borders / white text lose; bucket colour = weighted mean. Ties broken by key so a cover always gives the same colours.
3. Buckets merged into groups by hue distance (>= 1/12 turn apart = distinct; hue vs grey = distinct; two greys = same); first group = accent (whatever its weight); up to 3 more groups kept if they hold >= 6% of weight, heaviest first. `has_hue`: max>=48 and (max-min)/max >= 0.2. `PALETTE_COLOURS` = 4.
4. UI tint = accent colour re-lit to lightness 0.30 (dark) or 0.72 (light) (`tint_from_art`), cached per art URL (small rendition preferred).
5. Page header wash = vertical gradient from `blend(window, tint, 0.45)` (overview pages: Home, Search, Settings, Queue) or `0.85` (a cover's own page) to `window`, 340px tall, scrolls away with the hero. Liked Songs page uses fixed #5038c8. With the setting off or no tint: `palette.tint` fades to transparent when its alpha > 0. Player bar fill = blend(panel, tint, 0.12), eased over 450 ms. Countdown pages bring their own gradient.
6. Prerelease washes use a separate `artwork_wash` (saturate x1.25 relative to peak, x0.85, luminance clamped <= 0.095 so 210-alpha white text keeps >= 4.5:1 contrast) (ui/prerelease.rs:18-35).

### 6.4 Compact and zoom
- `sidebar_compact` (names only), `tracklist_compact` (36px single-line rows), `sidebar_grid` (cards, set in sidebar header not Settings), `art_expanded` (art docked large at sidebar bottom). Zoom 0.5-2.5 in 0.1 steps, keyboard Ctrl/Cmd +/-/0. Min window 760x520 (`window.rs:188`); top bar needs 510px of content (`TOPBAR_MIN_CONTENT`); a custom title bar replaces OS chrome on Windows/Linux (opt-in).
- Fonts via `system_fonts.rs` / `fastframe_fonts`: see 6.1. Bidi: `bidi.rs` (1154 lines) lays out RTL: paragraph direction decided by the first strong char (ASCII short-circuit, no cost for ASCII), runs reordered into visual order after shaping while glyphs stay in logical order with `rtl` flags (carets/hit-testing remain correct), ellipsis placed at the left reading edge for RTL, `halign_for(text)` right-aligns RTL text, search field layouter reorders so a Hebrew query reads correctly. Demo fixtures `--demo-show rtl` use invented Hebrew/Arabic/mixed titles (demo.rs:90).

### 6.5 Light/dark pair on Follow system
Two extra rows appear: Light mode theme, Dark mode theme. Switching the OS appearance swaps palettes live, without interrupting playback. Choosing a single theme keeps the pair choices for later. Files whose `base` flips keep their last accepted colours and the row explains.

---------------------------------------------------------------------------------------------------

## 7. Motion and power (`motion.rs`, `power.rs`, `appearance.rs`)
- "Reduce motion" is never a Spotifast setting; it follows the OS: Windows `SPI_GETCLIENTAREAANIMATION`, macOS `accessibilityDisplayShouldReduceMotion`, Linux GNOME portal `enable-animations == false`. Asked at most once a second; a portal change wakes the app and applies at once.
- Effects of reduced motion: egui easing time 0.12 s -> 0; scroll animation none; theme reveal skipped; player-bar tint fade (0.45 s) and any view animation using `motion::seconds(ctx, s)` / `motion::scroll(ctx, s)` go to 0 so they "show where they end at once"; lyric follow and drag row-gap animation also. Docs landing page also checks `prefers-reduced-motion` before autoplaying the hero film.
- Standard durations: egui animation_time 0.12 s (hover, switch knob animate_bool); tint fade 0.45 s; toast in 0.15 s, hold, out 2.8-3.2 s (`ui/mod.rs:715`); toast 280px wide label, Area anchored bottom-right offset (-20, -player offset), `interactable(false)`, order Tooltip; spinner = 250 degree arc, 1.2 rev/s, 33 ms repaint; hover on circle buttons grows 5% and presses shrink icon to 0.92.
- Power budget `Normal | Saver (not focused or OS saver: half rate) | Background (no window / display off / locked: nothing drawn, slow polling)`. Apps also hold a power-assertion (App Nap/sleep) only while playing or loading and unmuted-error free (`power.rs:playback_needs_activity`).

---------------------------------------------------------------------------------------------------

## 8. First run / sign-in / setup (labels only; ALL DROP for MaiPai) (`ui/login.rs`, `ui/soloist.rs`)
Layout worth keeping: centered card on a window with a top-to-bottom gradient `blend(window, accent, 0.10) -> window`; card fill `panel`, 1px outline, radius 16, margin 36, shadow offset 16 blur 48; card width 368 (+72 margins) or two columns 240..368 each with a 40px gutter when setup steps are shown; height base 400 (proxy collapsed) / 500 / 720 (manual proxy), grows downward to fit measured content, scrolls only if the window is too short; fixed footer line at bottom - 24 "Spotifast {version} * not affiliated with Spotify" (regular 11.5 dim); the whole background drags the window (on macOS only the top bar zone). Big button 300 x 46, radius 23, bold 15, accent fill, hover accent_hover, disabled accent x0.45.
Content (all DROP): logo 72 (56 beside steps), title "Spotifast" bold 30 (26), tagline "A native Spotify client."; Client ID field + "Sign in with Spotify"; states "Waiting for Spotify in your browser...", "Didn't open? Open the sign-in page again", Cancel, "Connecting to Spotify..."; steps "Register Spotifast": Open Spotify's developer dashboard; create app; "Under Redirect URIs, add exactly:" (copy row, "Copy" -> "Copied" for 500 ms); "Tick Web API, accept the terms, and save."; "Paste the Client ID into the field and sign in."; collapsible "Proxy Settings". Refusal messages (malformed, unknown client, account not allowed, shared sign-in retired, expired) are each a full sentence stating cause + next step. Show-steps decision is made once (cached) so the card does not change shape while typing.
Soloist onboarding (DROP; separate Spotify-owned player download): modal card 460 x 480; 3-step progress ("Step {n} of 3"); screens Welcome ("Listen with Spotify Soloist", three lines: personal key, downloads the player, choose it once in the Spotify app; "Set up Soloist", "Requires Spotify Premium.", "Setup, privacy and limitations"), key ("Get your Soloist key", "Copy your key from Spotify's Soloist page.", "Paste it here.", "Download Soloist"), starting, downloading ("{received} of {total} MB" progress), pairing ("Choose Soloist in Spotify", "Waiting for Spotify...", help appears after 45 s, "slow" hint after 20 s), verifying, ready ("Start listening"), failed. Escape routes: "Not now", "Use the built-in player". Soloist runtime banner ("Soloist isn't running" + Try again; "Soloist needs to connect again" + Connect in Spotify; etc.) and a Settings section (Status, Version, Audio quality, Spotify access (separate approval), Turn off).
Pattern to keep for MaiPai: first-run = one centred card, numbered steps with 1 action each, every failure = cause sentence + one button, an always-visible "use the simpler path" escape.

---------------------------------------------------------------------------------------------------

## 9. The other screens

### 9.1 Friends / listening activity panel (`ui/friends.rs`) - DROP (Spotify social feed)
```
 [right panel, width = shared queue_width 280..560, panel colour, margin 12]
 Listening activity (bold 16)                            [X 18px]
 (12)
 ( avatar 40 round )  Name (semibold 13.5)                    [bars | "2h ago"]
 (  dot 4.5 blue    ) Song  *  Artist     (regular 12.5, secondary, song yields to artist up to half)
 (                  ) [icon 13] Playlist/Album/Liked Songs   (links)
 (18 gap between rows)
```
Hover avatar -> black alpha 140 disc with Play/Pause icon; click plays that song (or toggles if it is playing here). Live listeners: blue dot (r 4.5, 6px panel-coloured ring) at avatar's top right and 4 static bars (levels .6/1/.45/.8, 2.5 wide, 13 tall) - static on purpose, animated bars would force 60 fps repaint for hours. Row text left-aligned to the title, right-aligned to the close glyph (insets 4 / 6). Empty: icon Users + "No listening activity" + "What the people you follow play on Spotify shows here." Loading row; failure row with CircleAlert and a sanitized error.

### 9.2 Artist page (`ui/artist.rs`)
Order: hero (round avatar image, kind "Artist", title; byline = monthly listeners (full number with thousands separators) | followers | up to 3 genres, joined with dot) -> action row (spacing 18): 56px circle Play (accent; spinner while starting), pill "Follow"/"Following" (artist-context pgettext so it translates separately from lyrics "Follow"), 26px ellipsis menu -> **Popular** (5 rows, "See more"/"Show less" soft button when >5; play counts column when known; whole block disabled at 0.55 opacity while offline) -> optional **Release countdown** card (440 x 96, cover 88, name semibold 16, "Album" regular 13; hover fill surface_hover, focusable, labelled "Release countdown: {name}") only while `is_upcoming` -> **Discography** (chips All / Albums / Singles & EPs / Compilations / Appears On; card grid of deduped-by-lowercase-name albums, subtitle "{year} * {kind}"; per-chip lists and a "Load more" soft button; height of the previous list is reserved while a new chip loads and skeleton cards fill it, so the page never jumps) -> **Fans also like** shelf (portrait cards). States: loading preview reuses known metadata for the hero while the page loads, actions disabled; offline empty state "You're offline" + "Spotifast will reconnect automatically when your connection returns."; failure row with Retry.

### 9.3 Show (podcast) page (`ui/show.rs`)
Hero "Podcast" kind (square art), byline publisher + "{n} episode(s)". Actions: 56px Play latest episode (resumes), 26px follow toggle (CirclePlus -> CircleCheck accent, tooltip "Follow podcast"/"Remove from Your Library"), ellipsis menu with Refresh. "About" (HTML stripped, regular 13.5 secondary, bidi layout) then "All episodes" virtual list, rows 128px: cover 96, title semibold 15 (accent while current), 2-line description (regular 12.5 secondary, 34px box), footer: 32px play/pause circle, meta "date * duration" or "{duration} left" for partly played, progress bar 72x4 (surface_active track, accent fill) for resumed, or CircleCheck + "Played" when finished, 32px More at right; double-click plays; row hover fill surface_hover (x0.7 dark). Infinite scroll via `load_more_when_near_end`.

### 9.4 Prerelease / countdown page (`ui/prerelease.rs`) - mostly DROP (Spotify pre-save), but the hero is a good pattern
Hero: cover 232 (wide, window > 700) or 160; kind label "Album" medium 14; title bold 72/36 shrunk so a single line fits (measured), max 3 lines with ellipsis; byline artist avatar 24 + artist links semibold 13 + "* Releases {date}"; countdown plate (black alpha 105, radius 6, margin 12): 4 columns (days/hours/minutes/seconds; number bold 24, label regular 11 at 70%), 78px max column, 1px white-alpha-65 dividers; repaints each second. Background wash from cover colour (see 6.3 step 6). Pre-save button 48px high, pill, green; labels "Pre-save" / "Saving..." / "Pre-saved"; "..." menu: Copy link, Open in Spotify. Below: "Track list preview" (bold 24) table with #, Title, Plays (only when width >= 640 and counts known), placeholder "Track {n}" names.

### 9.5 Update window and badge (`ui/update.rs`, topbar.rs:303-320, `updates.rs`)
Top bar badge (accent text, medium 12.5): "Update to {version}" / "Downloading update..." / "Update ready"; click opens a modal-ish `egui::Window`: no title bar, 420px (min with window-64), fill overlay, radius 12, margin 24, shadow 10/40, centred. Header "Update Spotifast" bold 20 + X ("Close update"); "{current} -> {new}" regular 14 secondary; states: Downloading ("Downloading update..." then "Checking download..." at 100%; 6px accent progress bar; "{received} of {total} MB" with 1 decimal), Ready ("Ready to install" + "Music playing on this computer will stop when Spotifast restarts." + primary "Restart to update"), Installing (spinner + "Preparing to restart..."), Idle/Failed (error in danger colour, then "Download update"/"Retry download", or when unsupported (package-managed): the reason sentence + link "Download from GitHub"). Escape closes. Closing keeps a download running. Backend: GitHub releases of the repo, Ed25519 signature check on `checksums.txt` (key `assets/update-public-key.hex`), AppImage self-replace, failed start restores previous install, proxy-aware updater cached per proxy config and rebuilt after proxy changes.

### 9.6 Skin cards (`ui/skin_cards.rs`) - reusable "visual picker grid"
Column count = floor((w+10)/(148+10)), min 1, cards share the width exactly (verified: 640px -> 4 columns, last right edge 640). Card height = width*0.5 + 26 (label) + 16 (padding 8x2). Gap 10. Radius 8. Fill `window` (so it stands off the surface-coloured section), hover `surface_hover`. Selected: 2px `text` ring + label drawn in a `text`-filled pill with `window` text. Picture: texture scaled to fit, to a whole-number multiple when enlarging (keeps pixel art crisp); placeholder rect surface_hover radius 4; failed = centred name only. Virtualised: height is arithmetic (rows * card + gaps) and only visible cards paint or request their preview (test: 500 cards stay cheap), yet every card is a real focusable widget exposed as `RadioButton` with selected state; focus scrolls it into view; tooltip = full name; label uses bidi layout with '…' truncation. Previews are rendered from the skin and cached on disk (`skin-previews/`).

### 9.7 New releases (`ui/new_releases.rs`) (DROP, account feed) and Home/Library/Radio are in earlier audits
Title bold 30 + subtitle regular 13.5 secondary + table of tracks of followed artists' latest releases (newest first) played like a playlist; empty state icon Music "No new releases".

### 9.8 Banners (`ui/mod.rs:380-514`) - pattern keep
Strip under the top bar: fill surface, 1px outline, radius 8, margin L16 R6 T12 B12, outer margin 24 sides / 8 below; bold 14 title (optional 14px spinner) + regular 13 secondary text + wrapped row of pill buttons (first = primary) + optional X ("Close banner") top right. Only one banner at a time (Soloist > audio key > slow-app); never shown while a dialog is open or on Settings. Slow banner capped: at most once a day, never after 3 dismissals (`SlowAppBanner` in settings; settings.rs:215).

### 9.9 Toasts, dialogs, empty states
Toast: Info = CircleCheck accent, Error = CircleAlert danger, fill overlay, radius 8, margin 14x10, shadow 4/16, text medium 13.5, wraps at 280. Dialogs (Shortcuts, PersonalAppIntro, PremiumNeeded, create/edit playlist, duplicate) are in `ui/dialogs.rs`. Generic `empty_state` = 40px dim icon + semibold 16 title + regular 13.5 body, 48px top gap; skeleton rows/cards for loading; `error_row` with Retry.

---------------------------------------------------------------------------------------------------

## 10. Storage / cache settings (`ui/settings.rs:2390-2480`, `storage.rs`)
Section "Storage", four rows; each title gets the live size appended ("Artwork cache · 24.1 MB", "Checking...", or "Unavailable"):
1. Artwork cache - "Stored in {folder}" - soft Trash button "Clear artwork" (removes only files directly in that folder).
2. Audio cache (only when built-in player) - "Stored in {folder}" - "Clear audio" -> "Clearing..." disabled while running. Size budget itself is set in the Playback section (512 MB / 1 GB / 4 GB; default 1 GB).
3. Play history - "Tracks played here are stored in {file}. This file is never uploaded." - "Clear history".
4. Sign-in - "Sign-ins are saved in the system credential store when available." - no control (DROP-ish, pattern: say where secrets live).
Sizes are measured on a worker thread (`storage-usage`), ONLY while the section is drawn (closing Settings schedules no scans), refreshed at most every 5 s; `invalidate()` discards an in-flight scan so a pre-clear measurement cannot restore old sizes. `format_bytes` formats B/KB/MB/GB. Folder paths are shown verbatim (the doc lists every location per OS, plus "safe to delete?" per file in `_reference/settings-and-files.md:7-300`; portable mode keeps everything in `spotifast-data`).

---------------------------------------------------------------------------------------------------

## 11. i18n (`i18n.rs`, `assets/i18n/*.po`, `build.rs`, docs `translating.md`)
- 17 locales: en (source), de-DE, es, nl, pt-BR, pt-PT, fr, sv, pl, ru, it, ja, ko, zh-Hans, zh-Hant, tr, uk. Each is a gettext `.po` (e.g. `assets/i18n/ja.po`) merged from `spotifast.pot` (891 `msgid`s, 48 with `msgctxt`). `POTFILES` lists the source files scanned.
- API: `gettext(locale, "English text")`, `ngettext(locale, singular, plural, n)` (each locale's `Plural-Forms` header; ja/ko/zh have nplurals=1, Russian/Polish/Ukrainian have three+), `pgettext(locale, "context", "text")` for homographs (e.g. "Follow": artist vs lyrics; "Off" for proxy vs tray vs start-with-computer; "Light"/"Dark"; "Full/Half/Quarter" resolution). Placeholders are named `{count}`, `{folder}`, `{name}`, `{rate}`, filled by `.replace("{x}", ...)`; every placeholder phrase carries a `// Translators:` comment that lands in the .po. Sentences with a link inside keep the link target as a placeholder (`Built with love by {name}`) so order can change.
- Compile time: `fastframe_i18n::build::compile_catalogs` turns the .po files into Rust modules (`catalogs.rs` in OUT_DIR, one `Translator` per locale), no runtime gettext tools. Missing, empty, fuzzy, or incomplete-plural entries fall back to the full English phrase, so a catalogue can ship incomplete; a test requires all bundled catalogues complete and placeholders preserved (`tests/localization.rs`).
- Choosing: `LanguageChoice::System | Locale(tag)` stored as "system" or the tag; unknown tag -> System. System detection takes the first preferred language with a catalogue (a Norwegian then German list gives German); `pt` + Portugal/African/Macau regions -> pt-PT, bare pt -> pt-BR; `zh` script Hant or region TW/HK/MO/CHT -> Traditional, else Simplified. `from_system()` returns English under `cfg(test)`.
- Native language names in the picker are never translated. Dates/numbers: `util::format_date`, `format_relative_date` (relative for recent dates: "30 seconds ago" ... then absolute), `format_count` (thousands separators), `Locale::song_count/liked_song_count` use ngettext.
- Not translated: tray menu, macOS menu bar and Dock menu, Windows taskbar buttons (still English), upstream error details, song/album/artist names, lyrics.
- Tooling: `.github/scripts/update-translations.sh [--check]` (xgettext + msgmerge + msgfmt); demo mode `--demo-language <tag>` previews a locale.

## 12. Accessibility (docs `using-spotifast.md:265-315`, `theme.rs`, `widgets.rs`)
- AccessKit enabled by egui; custom widgets declare `WidgetInfo` with translated names: icon buttons use their tooltip as label (`icon_button`), pills/soft buttons use their visible text, switches are `Checkbox` with selected state and the row title as label (`widgets::switch` 3668), ComboBoxes report label + current value (settings.rs:1418 etc.), skin cards are `RadioButton`s with selected state, sliders expose min/max/step plus `SetValue`/`Increment`/`Decrement` actions only when valid (widgets.rs:3340-3400; player-bar volume and seek), text inputs set label via `accesskit_node_builder` (search hint, labelled fields). Row labels and descriptions are plain labels (not tied to their control as `labelled_by`; the control's own label is the row title).
- Keyboard: Tab / Shift+Tab; focus ring = 2px `selection.stroke` (accent) rounded rect expanded by 2px (`theme::focus_ring`), drawn by every custom widget (22 call sites) and auto-scrolls into view on focus gain; Enter activates; song rows: Up/Down move between rows, Shift extends selection, Delete removes from editable playlist, Enter plays, row focus scrolls into view; sliders: Left/Right = 5 percentage points volume / 1% seek; Space plays/pauses even when a row/control has focus (but not in text fields); unmodified letter shortcuts yield to a focused control; Ctrl/Cmd+F or `/` focuses search; Ctrl/Cmd arrow keys move the caret in text fields while Ctrl+arrows elsewhere = prev/next; right-click in any text field gives Cut/Copy/Paste/Select all (Cut/Copy disabled without a selection; selection kept while the menu opens).
- Known gaps (stated in docs): Windows NVDA testing pending (#262); Winamp-skin windows lack equivalent accessibility; the EQ vertical sliders have no keyboard/AccessKit.

## 13. CLI control (`entrypoint.rs:104-296`, `single_instance.rs`)
`spotifast <verb>` talks to the running instance over a single-instance channel (named pipe/socket), prints a reply and exits; "Spotifast is not running or does not support remote control" + exit 1 otherwise. Verbs: play-pause, play, pause, next, previous, seek <+-seconds>, seek-to <s>, volume <0-100>, volume-up [10, 1-100], volume-down [10], mute, shuffle [on|off], repeat [off|context|track], like (toggle save), play-uri <uri>, play-search [--kind track|album|artist|playlist] <words>, devices [--raw] (prints `* id<TAB>name<TAB>kind`, active marked), transfer <device_id>, now-playing [--raw] (human: `> Title - Artist [m:ss / m:ss]` or "Nothing playing"; raw: tab-separated state,title,artists,album,position_ms,duration_ms,volume,shuffle,repeat,art_url,saved,device), show, reload-themes. Flags: `[LINK]` positional (spotify: URI or open.spotify.com URL; handed to the running instance), `--device-name`, `-v/--verbose`, `--start-hidden` (what login-start in tray runs), `--demo*` (demo builds). Output handling: a closed pipe (`| head`) ends quietly. Link + verb do not conflict. Linux also exposes MPRIS (`playerctl --player=spotifast`, `open` accepts search links). Also media keys, Windows taskbar thumbnail buttons, macOS menu bar/Dock menu/touch bar guard (`mac_touchbar_crash_guard.rs`), MacBook notch widget (`notch.rs`, `mac_notch.rs`), tray (Show/Hide, Main window, Play/Pause, Next, Previous, Quit).
Web equivalent: a documented `/api/control` (or Media Session API + WebSocket verbs) with the same verb set; "now-playing" snapshot as TSV is a good minimal contract.

## 14. Demo mode (`demo.rs`, 13.8k lines, feature `demo`; `settings-and-files.md:467-540`)
- Not a user mode: a build feature for screenshots/CI. `--demo` marks the session connected and the backend offline; nothing talks to the network (cover art still comes from picsum.photos seeded URLs so image pipeline, disk cache and accent extraction are exercised). Never writes settings. Persona "Carmine", Premium, country DE.
- Data: 8 real-sounding artists (Bonobo, Khruangbin, Nils Frahm, Little Simz, Floating Points, Jon Hopkins, Sault, Four Tet) with 8 albums, 20 track names (Rosewood, Otomo, Shadows, ...), 13 playlists (Discover Weekly, Late night focus, Sunday morning, Running 2026, Release Radar, Berlin nights, Dinner party, Deep work, Road trip, Kitchen jams...), 6 top mixes, shows/episodes, friends, lyrics sample, devices (Cast, Sonos, phone), local-file rows (found and missing), added-at timestamps chosen to cover every relative-date unit (30 s, 5 min, 3 h, 2 d, 2 w, then absolute), contributors Kasia and Sam, RTL titles.
- Surfaces via `--demo-page <page>` (home, playlist:pl1, artist:art0, prerelease, prerelease-fog-lake, ...) and `--demo-show a,b,c`: queue, playing-next, devices, sonos-*, cast-*, phone-playing, shortcuts, create, edit, duplicate, light/dark/system-light/system-dark, focus, update, personal-app, slow-banner, audio-key-banner, windows-taskbar, start-in-tray, german, lyrics(-fullscreen...), lyrics-empty/loading/error/instrumental/no-playback, queue-empty/loading/error, recents-*, collection-loading, home-loading, shuffle-selected/started, undated-mix, library-list/grid (narrow/wide), signed-out/connecting/waiting-for-browser/sign-in-*, shared-grant, own-app, settings-skins, settings-player-skins, milkdrop, milkdrop-framed, eq, presets, eq-user-presets, eq-shade, shade, playlist, playlist-shade, compact, small, art, folders, pins, sorted, emoji, rtl, player-bar-spectrum, player-bar-waveform, soloist-*, wmp-skin=PATH, wmp-run=SCRIPT. `--demo-language <tag>`, `--demo-size WxH`, `--demo-shot PATH` (PNG then exit, waits `--demo-shot-delay` ms default 6000 for art), `--demo-click X,Y`, `--demo-drag X,Y:X,Y` (scripted pointer: rests several frames, presses, glides, holds), `--demo-data DIR` (caches under DIR/cache|state, settings from DIR/config), `SPOTIFAST_DEMO_REST` env for slow skins.
- Purpose served: the same fixtures render the website screenshots, the 0.17 launch film ("made with its built-in demo content"), translation previews, and the headless layout tests (egui `Context::run_ui` with AccessKit enabled and fixed `Power`/`SystemAppearance::fixed(dark)`; `app.reveal_theme_changes=false` in tests). For MaiPai: a deterministic demo household + fixture flags per state is the cheapest way to get every empty/loading/error state reviewable.

## 15. Docs site (`docs/`, Jekyll + a VitePress-like theme `_includes/jekyll_vitepress`, `_data/navigation.yml`, `CNAME` spotifast.rocks)
- `index.md`: layout `home`; hero (name, text "Spotify, native and fast", tagline, three actions Download / What is Spotifast? / GitHub) with an autoplaying launch film that replaces the hero image via a tiny script (poster fallback when scripts do not run; autoplay skipped if `prefers-reduced-motion`); 9 feature cards with emoji icons (Lightweight: "Opens in well under a second and typically uses just 100-250 MB"; Native, in Rust; Spotify Connect; Library and search; Themes; Skins; MilkDrop; Desktop controls; Open source); sections "Skins of its own, and the classics" (Spotifast Tall = white ceramic ribbon round smoked glass, Wide = on its side, green thread of light traces each as it opens, click fills glass with MilkDrop), "MilkDrop with more than 10,000 presets", "WhatsApp, just as fast" (sibling app ZapFast).
- Guide pages: download (per-OS install incl. Nix/nix-darwin, checksum verification), getting-started (sign in, enable playback, basics, match desktop theme, empty-boxes font fix, language, link handler, proxy, build), using-spotifast (857 lines: autoscroll, shelves, drag beyond visible list, copy/paste songs, starting and resuming playlists, covers, finding a setting, keyboard and screen readers, shortcut table, CLI, updates, library order, start with computer, taskbar/menu bar/Dock, always-on-top, notch, recents, audio output, listening activity, sleep timer, Cast, radio, play counts, discography, upcoming albums, playlist covers, lyrics), make-it-even-faster, milkdrop, troubleshooting, what-is-spotifast, winamp.
- Reference: how-it-connects (869), privacy ("What stays on your computer" / "What is sent, and to whom"; zero analytics), settings-and-files (every path per OS + safe-to-delete column + every settings.json key with default + CLI + demo + custom themes + Omarchy), queue, soloist, translating, packaging, nix-cache, what-spotify-allows.
- Docs conventions worth copying: every setting is documented with its JSON key, default and "since x.y.z"; every file path has a "Safe to delete?" column; each claim about platform differences names the platform; screenshots are generated from demo mode (`docs/screenshot.png` 2018x1198, `assets/images/*`, `.mp4` posters); deep-link anchors (`#custom-themes`, `#make-a-spotify-app`, `#rate-limits`, `#audio-key`) are referenced from in-app buttons ("Why?", "How to make a theme", "Setup guide").

## 16. README features not captured elsewhere
Tagline "Spotify, native and fast"; no browser engine; install matrix (brew cask, AUR `spotifast-bin`, Windows installer + portable x64/ARM, deb, rpm, Flatpak, AppImage, Nix, source); Windows-on-ARM build omits MilkDrop; features table rows beyond those already audited: "Local files" (play `spotify:local:` entries from a chosen folder, any sample rate, names with accents), "Lyrics" (Spotify lyrics then LRCLIB fallback with retry/search/cached during outages), "Spotify Connect" incl. Google Cast groups with frequency-ranked outputs, "Queue" (Play next), "Themes" (light/dark/system/custom + per-mode pair + Omarchy follow), "Desktop controls", "Winamp mini player" (.wsz and .wmz skins, EQ, playlist, analyser; Ctrl+M / Cmd+Shift+M), "MilkDrop" (>10,000 presets, first-run download). Soloist paragraph = DROP. Shield badges, MIT licence, Premium-required note.

---------------------------------------------------------------------------------------------------

## 17. Tricks worth copying (small clever behaviours)
1. **Search that finds rows by hidden keywords** (preset names, pack names, skin names, section title) with no extra index; section hides when no row matches; conditional rows only match where they exist.
2. **One "Apply and restart" button** that appears only when an engine-level row changed (dirty flag), with a quiet "Playback settings applied." line otherwise.
3. **Frame-rate "gear lever" slider** that stops only on useful rates, labels the screen's refresh ("144 fps, your screen"), parses typed text to the nearest stop, and ends with Uncapped.
4. **Frame-budget by context**: half rate out of focus, 30 max when OS saver, zero when hidden/locked, "settled" detection stops redraws when visuals are at rest.
5. **Visualizer lag compensation** (read 200 ms behind newest sample) and tap AFTER EQ but BEFORE volume.
6. **Visualizer time-step fixed to 1/60 s** with owed-steps catch-up so fall speed is frame-rate independent; peak caps with hold + gravity.
7. **Readable-over-text visualizer colours**: art hues made vivid, then luminance-clamped per theme (0.35 dark ceiling; 0.2-0.4 band light) so words always stay readable over bars.
8. **Art tint recipe**: 48px thumbnail, bucketed by 4 bits, weight favours saturation and mid-lightness, hue-distance grouping, re-lit to lightness 0.30/0.72; cache keyed by URL, cleared on theme change; header wash 340px, 0.45 overview vs 0.85 cover pages, scrolls away.
9. **Overlay derivation**: a theme file that omits `overlay` still gets menus matching its window (dark: lerp 8% toward text; light: panel). Any theme source reduces to 17 tokens plus a fixed derivation table.
10. **Last-accepted palette cache** inside settings so a deleted/corrupt theme file never changes how the app looks; the row explains why.
11. **Subscribe-then-read** for the OS colour-scheme portal; same for reduce motion (1 s re-check, but change wakes immediately).
12. **Reduce-motion helper API** (`motion::seconds(ctx, s)`, `motion::scroll`): every custom animation goes through it, so honouring the OS preference is automatic.
13. **Theme change reveal** from the window centre outwards, skipped under reduce motion.
14. **Equalizer solved so the curve you see is the sound**: per-band widths from neighbour midpoints and a 10x10 solve so combined response meets each slider; the UI curve calls the same filter code.
15. **EQ slider affordances**: double-click = 0, value bubble only on hover/drag, snap 0.1 dB, fill from 0 dB not from the bottom, dim when EQ off, 0 dB tick.
16. **User EQ presets store preamp too** (headphone corrections need headroom); Delete only appears while one is active; Enter saves; save-by-name replaces.
17. **Limiter + EQ guard**: no clipping stage in the EQ; one soft-knee look-ahead limiter at the very end aware of later volume.
18. **Row layout never needs a second pass**: control width is declared by the caller, and the control drops under the text when the text column would be < 140 px.
19. **Segmented controls lay out right-to-left then stack** when narrow, so order reads naturally in both layouts.
20. **Search field**: pill, icon, clear button, RTL-aware layouter; right-click edit menu with Cut/Copy/Paste/Select all that keeps the selection while the menu opens.
21. **Virtualised card grid with arithmetic height** and all cards still focusable/labelled; whole-number image scaling for pixel art; disk-cached previews.
22. **Storage sizes measured off-thread only while the section is visible**, with invalidate-on-clear so stale scans can't resurrect old numbers.
23. **Skeletons reserve the previous list's height** (discography) so switching chips never jumps; loading hero reuses known metadata so the page appears instantly with disabled actions.
24. **Static "now listening" bars** instead of animated ones: calm, zero redraw cost; animate only what is on screen and changing.
25. **Toast = non-interactive area** that fades in 150 ms and out over the last 400 ms; label laid out at its own fixed width so a short toast followed by a long one wraps correctly.
26. **Ellipsis placement for RTL** at the left reading edge; ASCII fast-path for direction detection.
27. **Language picker lists each language in its own name**, menu tall enough not to scroll, applies instantly, system language picks the first preferred language that has a catalogue.
28. **Translators' context built in** (pgettext contexts, placeholders documented, plural forms per language, English fallback for incomplete entries so partial translations can ship).
29. **Docs as product**: every setting has key, default, since-version; every file has a safe-to-delete column; in-app "Why?" buttons deep-link to docs anchors; screenshots generated from demo fixtures.
30. **Credit line with translatable word order** (`{name}` splice) and the author name as the only link.
31. **Anti-leak habits**: proxy password clears when host/port/username change; Debug impl hides username; password only in credential store; settings never contain tokens.
32. **Banner discipline**: one at a time, rate-limited (once a day, three dismissals max), suppressed while a dialog is open or on Settings.
33. **Update UX**: badge in the top bar -> small modal with progress and an explicit restart; closing keeps the download; signature verified; failed start rolls back; package-managed installs show the reason and a link instead of a dead button.
34. **First-open resource fetch** (MilkDrop packs) with a built-in animation as a placeholder and per-pack tooltips that state counts and download size ("about 25 MB").
35. **Wheel normalisation**: one mouse detent = one notch regardless of OS multiplier; trackpad 50 points = one notch (accumulated remainder kept per widget).

## 18. Differences that matter for a web app (MaiPai Home)
- **Settings persistence**: Spotifast writes one local JSON with 2 s debounce and an explicit apply for engine rows. Web: per-user records on the hub (spec-first), optimistic UI, a single "Apply" affordance only for rows that restart a server-side engine; show "Saved" state, and keep search state URL-addressable (`?q=`), not lost on navigation (here it is egui temp memory and clears with the process).
- **Search**: here it filters on the client over a fully rendered page. In web, index titles + descriptions + hidden keywords per row from one registry (also usable for a command palette and deep links like `/settings#equalizer`).
- **Audio stack**: no Web Audio equivalent of the shared-memory tap; use an `AudioContext` with `AnalyserNode` (post-EQ, pre-master gain; but browsers' analyser lag differs, so compensate via `outputLatency`/`baseLatency`), `BiquadFilterNode` peaking x10 (Q derived from the octave widths above; the 10x10 solve can be done in JS or precomputed per preset), `StereoPannerNode` for balance (note: Spotifast's balance attenuates only the far side, StereoPanner uses equal-power; replicate with two gains), mono via channel merger, `DynamicsCompressorNode` or an AudioWorklet limiter for the -1 dBFS/2 dB knee. Server-side playback (hub) needs the DSP in the engine instead; the UI contract (bands, preamp, presets, balance, mono, EQ on/off) stays the same.
- **Visualizers**: canvas/WebGL; MilkDrop in web = Butterchurn (MilkDrop in WebGL) with `.milk`-JSON presets instead of projectM child process; no separate window/fullscreen process problem, use the Fullscreen API and a `<canvas>` in the player; frame cap via `requestAnimationFrame` throttling; pause when `document.hidden` / `visibilitychange` (the web equivalent of Background budget) and respect `prefers-reduced-motion` (CSS media query) for all motion, plus Battery/Save-Data hints for Saver budget. First-run preset download = lazy fetch of preset packs from the hub, not GitHub.
- **Reduce motion/colour scheme**: use `prefers-reduced-motion` and `prefers-color-scheme` (+ `matchMedia` change events) instead of OS portals; theme as CSS custom properties from the same 17 tokens (plus derived `overlay`), `color-scheme` meta, and a view-transition-based circular reveal (`document.startViewTransition` with a clip-path animation) skipped under reduced motion. House rule "no fixed colours": the few fixed colours here (listening blue, pre-save green, white-on-art) must become tokens.
- **Art tint**: do it server-side once per cover (store the 4 palette colours with the media record, no data debt) instead of per client; use `color-mix()` for blends (0.45/0.85/0.12) and CSS gradients for the header wash.
- **Fonts/emoji/bidi**: browsers do shaping, RTL, emoji fallback and system fonts for free; keep Inter + weights, set `dir="auto"` on text containers, use `text-overflow: ellipsis` (note: ellipsis at the left for RTL comes with `direction: rtl`). The entire `system_fonts.rs`/`bidi.rs`/`emoji.rs` stack disappears.
- **Accessibility**: web gets roles and focus for free but must copy the intent: names on every icon button, switch = `role="switch"` with the row title as label, sliders = `role="slider"` with Arrow keys +-5/+-1, skin/preset pickers = `radiogroup`, visible focus ring in accent, live regions for status rows ("Fetching...", "Playback settings applied"), and (improvement over Spotifast) keyboard and AT access for the EQ band sliders (use `<input type=range orient=vertical>` or div sliders with `aria-valuetext="+3.5 dB"`).
- **i18n**: keep gettext-style catalogs (ICU MessageFormat or gettext JSON) with context + plural + named placeholders; ship all locales lazily; language picker in own names; locale-aware dates/numbers from `Intl`. "Not translated" items here (tray, menu bar) do not exist in the web UI.
- **CLI**: becomes an authenticated local HTTP/WebSocket API plus Media Session API and MPRIS on the hub host; keep the verb names and the TSV now-playing shape. `reload-themes` becomes live theme CRUD in the UI.
- **Storage section**: web cannot show a user's local cache folders; show hub-side sizes (artwork cache, audio cache, history) with Clear buttons, plus browser storage usage via `navigator.storage.estimate()`; keep the "where secrets live" line phrased for the hub.
- **Updates**: the hub's update flow is the ship path (not an in-app download-and-restart); keep the badge + progress + "restart when ready" UX but sourced from the hub release state; package-managed explanation not needed.
- **Window features** (tray, always-on-top, taskbar, start-with-computer, dock, notch, custom title bar, interface zoom 0.5-2.5, Winamp skins, `.wmz` script sandbox) do not apply; zoom -> browser zoom, mini player -> PiP/Document Picture-in-Picture, skins -> not needed (themes only). Keep Compact list/sidebar toggles.
- **Network/proxy**: only relevant to the hub's outbound requests; do not ship a user-facing proxy page unless hub needs one (house rule: nothing leaves the home).
- **Spotify-account items (DROP)**: Account section, Client ID registration, Soloist (section, onboarding, banners), Spotify Connect device name/status/bitrate, Autoplay (recommendations), friends/listening activity, Made for you/Recommendations shelves, pre-save/countdown pages, play counts, monthly listeners, "Follow artist" on Spotify, personal-app banners, rate-limit banners, audio-key banner, `.milk` pack URLs on GitHub (replace with hub-hosted).
- **Demo parity**: add a seeded demo household and `?demo=<state>` fixtures for every state listed in section 14; the hub already has a demo household (Sage, Marlow, Nova) so each state (empty/loading/error/offline) should have a flag, and screenshots/docs should be generated from it.
