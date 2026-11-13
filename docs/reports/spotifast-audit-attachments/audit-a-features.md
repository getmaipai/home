# Spotifast feature audit (a): every user feature and flow

Source: crmne/spotifast clone, read-only (README.md, docs/_guide/*.md, docs/_reference/*.md, src/*.rs, src/ui/*.rs).
Cites are `file:line` (under `src/`) for code and `doc:section` for docs. A bare file name means the feature is spread across it.

Verdict legend:
- **DROP-S** = Spotify-only (needs Spotify account, Premium, Connect, Web API, librespot session, or Spotify private feeds)
- **CAND** = local/offline-capable candidate (works on the household's own files/local data, or is a pure local engine)
- **DROP-P** = platform/desktop-only (OS shell integration with no meaning in a hub web app)

## 0. Headline findings

1. **There is no standalone local library.** "Local files" only means a Spotify playlist that contains `spotify:local:` entries; the user picks a folder (searched with subfolders) and librespot plays the matching file (`player.rs:67-68`, `player.rs:637` `local_file_directories`; `settings.rs:286-288`; `ui/settings.rs:845,1134`). Without a Spotify login and Premium the app cannot play anything (README: "Playback needs Spotify Premium"). So the local-file *flow* is DROP-S; only the building blocks are CAND.
2. **Not present at all** (grep over `src/`; the only hits are MilkDrop preset crossfade and librespot normalisation): no audio crossfade between songs, no sleep timer, no playback speed control, no offline mode (the "audio cache" caches Spotify audio, `settings.rs:280-285`), no sharing beyond copy-link, no recommendation engine of its own. "Sleep while playing" (docs/_guide/using-spotifast.md "Sleep while playing") is a wake-lock, not a timer (`power.rs:10` `KeepAwake`).
3. **Reusable engines (CAND):** 10-band EQ + presets (`eq.rs`), soft-knee limiter (`limiter.rs`), FFT spectrum/scope analyser (`vis.rs`), MilkDrop via projectM (`milkdrop.rs`), local tag reader for cover + lyrics (`local_tags.rs`), LRC parser (`lyrics.rs:650,681`), polyphase resampler (`resample.rs`), Winamp `.wsz` and WMP `.wmz` skin renderers (`skin/`, `winamp.rs`, `ui/winamp/`), history thresholds (`history.rs`), i18n catalogs (`assets/i18n/*.po`). These are Rust/egui; MaiPai Home is a web app (Bun/React), so the *behaviour and numbers* carry over, not the code.
4. **Outbound network use to flag against "nothing leaves the home", even in CAND items:** LRCLIB lyrics lookup (`lyrics.rs:19` `https://lrclib.net/api`), MilkDrop preset pack download on first use (`milkdrop.rs:114` `PACKS`), skin museum links (`ui/settings.rs:1926,1978`), GitHub update checks (`updates.rs`). Only the local parts are candidates.

---

## 1. Playback

### 1.1 Transport (play/pause, next, previous, seek)
- Inputs: player bar buttons (`ui/player_bar.rs:707-765`, widths `TRANSPORT_WIDTHS [29,30,36,30,29]` at `:707`), `Space`, `Ctrl+Left/Right` (prev/next), `Shift+Left/Right` seek 10 s, media keys, tray, CLI. Actions `TogglePlay/Next/Previous/Seek/SeekBy` (`model.rs:1179-1183`).
- Seek slider previews on press, seeks on release; Left/Right on a focused slider = 1% of the song (docs/using-spotifast "Keyboard and screen readers").
- Next removes the top queue row immediately, without waiting for Spotify (docs/_reference/queue.md rule 4).
- Previous that restarts the song keeps Repeat One (docs "Keyboard shortcuts").
- Mini player: Play on a playing song restarts it from 0; Stop = pause + rewind (docs/_guide/winamp.md "Main controls").
- Verdict: transport semantics **CAND** (generic). The Spotify command path (Web API, Connect) is DROP-S.

### 1.2 Volume and mute
- Slider 0-100 in the player bar (`ui/player_bar.rs:999` `SetVolume(value*100)`); saved `volume` 0..=65535, default 70% (`settings.rs:322-324,517`). `Ctrl+Up/Down`, `M`; Left/Right on the focused slider = 5 points. `PreviewVolume`, `VolumeBy(i8)`, `ToggleMute` (`model.rs:1184-1188`).
- Local output smooths volume/mute changes over 30 ms; track changes and play/pause fade 50 ms nominal; natural transitions gapless (docs "Keyboard and screen readers").
- Remote volume keeps the chosen level for 6 s against stale reports (Sonos): Spotify-only detail.
- Verdict: local volume/fades **CAND**; remote-device volume DROP-S.

### 1.3 Shuffle
- Button in the transport (`ui/player_bar.rs:757`), `S` key, `ToggleShuffle/SetShuffle/ShufflePlay` (`model.rs:1178,1189,1191`). Choosing Shuffle on a collection page does not start playback; the next Play uses it (queue.md "since 0.10.0"). Shuffle picks a random start unless a row is chosen. Toggling rechecks the queue order at once. Reconnect restores the exact shuffle order (queue.md "since 0.9.0").
- Verdict: **CAND** (logic). Today's order comes from the Spotify context (implementation DROP-S).

### 1.4 Repeat
- Cycle Off -> Context (whole list) -> Track (`player.rs:117-130`, `RepeatMode::next`), `R` key, `CycleRepeat/SetRepeat` (`model.rs:1190,1192`). Choosing another song while Repeat One turns it into repeat-all. Starting another song keeps the mode (queue.md "since 0.9.0"). Mini player: repeat is on/off only.
- Verdict: **CAND**.

### 1.5 Queue and queue editing
Two sections: **Playing next** (user-queued) then **Next up** (rest of context); a "Playing from" line above names the source and links to it (`ui/queue.rs:477`, queue.md intro). Tabs Queue and Recents (`model.rs:198-202 QueueTab`); `Q` toggles the panel (`ToggleQueuePanel`, `model.rs:1368`); queue width default 360 (`settings.rs:~331`).
- **Add to queue**: end of Playing next, duplicates allowed, a double-click counts once (`AddToQueue/QueueMany`, `model.rs:1193,1199`). **Play next**: front, selection keeps displayed order, `Shift+N` (`PlayNext`, `:1203`). Album Add to queue adds all playable songs in order, all-or-nothing on fetch failure (queue.md "since 0.9.0"). `Shift+Q` adds the selection or shows the queue.
- **Click a queue row**: skip to it; rows above are removed, rows below stay (queue.md rule 5).
- **Drag to reorder/insert** inside Playing next (`MoveInQueue`, `InsertInQueue`, `model.rs:1209,1216`); Next up is never a drop target; with an empty queue, drop on the player bar Queue button (rule 11). Edge auto-scroll while dragging.
- **Remove from queue** by right-click or ... menu (`RemoveFromQueue`, `:1224`). **Clear queue**: trash beside "Playing next", only removes manual songs (`ClearQueue`, `:1297`, rule 7). **Save queue as playlist** (`SaveQueueAsPlaylist`, `ui/queue.rs:29,105,254`).
- Queue persists on close; resume restores song, position, queued songs (rule 9). A song no longer in its context plays alone at its saved position.
- Optimistic updates; stale server answers ignored (rules 8, 10). Spotify quirks (padding by going round, remote queues not editable, rate-limit retries) are DROP-S.
- Verdict: the model (two tiers, rules 2-9, 11, 12, drag/reorder) **CAND**; remote-device queue handling DROP-S.

### 1.6 Gapless, normalisation, autoplay, audio quality, cache
- Gapless, default on (`settings.rs:272-273,495-496`; `ui/settings.rs:752,795` "Play tracks without silence between them"). Done inside librespot; Spotifast has no crossfade of its own.
- Normalize volume, default off (`settings.rs:270,495`; `ui/settings.rs:750,787`). librespot `NormalisationType::Auto` (`player.rs:629`); limiter threshold is aligned to it (`limiter.rs:18-22`).
- Autoplay, default on, "Keep playing similar songs when your music ends" (`ui/settings.rs:751,791`).
- Audio quality 96/160/320 kbps, default 320 (`settings.rs:269,494`; `player.rs:89-93`; `ui/settings.rs:910-912`).
- Output buffer 20-500 ms, default 100, Windows (`sink.rs:85,89`; `ui/settings.rs:817`). Audio cache on, 1024 MB (`settings.rs:280-285,501-502`).
- Verdicts: gapless **CAND** (Web Audio can do it), normalisation **CAND** (ReplayGain-style, needs own tags); autoplay, quality, cache DROP-S; buffer DROP-P.

### 1.7 Sleep timer, crossfade, speed
- **Absent.** See headline 2. Do not credit Spotifast with them.

### 1.8 Recent (play history)
- Queue panel's second tab merges Spotify history with local plays (`history.rs:1-6`, merging `/me/player/recently-played`). A play counts after 30 s or half of a shorter song; pauses and seeks do not count (`history.rs:16`). 500 local plays kept (`history.rs:19`). A local play and a Spotify report within 60 s (+ song length) are one play (`history.rs:24,184`). Each repeat is its own play. Stored in `history.json`, never uploaded; Settings > Storage > **Clear history** (`ClearPlayHistory`, `model.rs:1423`; `ui/settings.rs:2408,2470`). Clicking a row plays that song alone.
- Verdict: local history with the 30 s / half rule, 500 cap, dedupe window **CAND**; the Spotify merge DROP-S.

### 1.9 Play counts (Spotify)
- Plays column on albums, popular-song counts, artist monthly listeners (`RequestPlayCounts`, `model.rs:1323`; Plays sort `model.rs:1008`, `ui/collection.rs:1493-1515`; 3-state click: most, least, album order). DROP-S. A local count built from `history.json` would be a new idea.

---

## 2. Library and browsing

### 2.1 Library sidebar
- Shelves Playlists, Albums, Artists, Podcasts (`settings.rs:12-18 LibraryShelf`); Liked Songs row; list or grid (`sidebar_grid`, `SetLibraryGrid` `model.rs:1398`), compact mode (`sidebar_compact`), default width 250 (`settings.rs:326-333,520-523`); playing album art docked large at the bottom (`art_expanded`); `Ctrl+B` (`ToggleSidebar`, `model.rs:1367`). Code: `ui/sidebar.rs`, `ui/library.rs`.
- **By You** filter: owned playlists only, remembered (`SetLibraryByYou`, `model.rs:1393`; docs "Library order").
- **Sorts** per shelf: Name, Recently played, Recently added (albums/podcasts only), Spotify custom order, Local custom order (`settings.rs:22-29 LibrarySort`; `SetLibrarySort`, `model.rs:1394`). Name keeps folders; text search lists flat. Dragging rows = Local custom order. Pins stay on top; Liked Songs pinned first by default, draggable (`pinned_contexts`, `liked_songs_pinned`, `sidebar_order`). Folders collapse (`ToggleLibraryFolder`, `model.rs:1399`).
- Double-click a row plays it; single click opens it. Drag songs onto a playlist row to append, onto Liked Songs to save.
- Verdict: layout, sorts, pins, drag-arrange **CAND** (for a local library); Spotify folders/custom order/By You DROP-S.

### 2.2 Playlist page (view, edit, create)
- `Page::Playlist(id)` (`model.rs:121`; `ui/collection.rs`). Cover (click to enlarge, Esc closes), description with clickable links, year hover shows full release date on albums.
- Columns/sort: Index (#), Title, Album, Added, Duration, AddedBy, Plays (`model.rs:1001-1011`). Sorting changes play order only, not the saved playlist. A filter field narrows rows and the playable set; Play is disabled when no playable rows remain.
- **Play** starts at the first available song in the selected order; **Shuffle** sets the mode only; double-click starts there; Space resumes.
- Selection: Ctrl/Cmd-click, Shift-click, `Ctrl+A`; `Ctrl+C` copies song links, `Ctrl+V` pastes links to the end (duplicate prompt with "Add anyway"), `Ctrl+X` cut/move; `Delete` removes; arrows move row focus, Shift extends (docs "Copying and pasting songs", "Keyboard and screen readers").
- Edit actions: add/insert/confirm duplicate (`AddToPlaylist`, `InsertInPlaylist`, `ConfirmAddToPlaylist`, `model.rs:1232-1243`), remove (`:1257`), move and drag reorder (`MoveInPlaylist`, `:1265`; default order only), create (`CreatePlaylist`, `:1272`), edit name/description/visibility (`UpdatePlaylist`, `:1279`), delete (`:1285`), cover upload JPEG/PNG (`ChoosePlaylistCover/UploadPlaylistCover`, `:1277-1278`, `playlist_cover.rs`; docs say "in development").
- **Refresh** in the ... menu; drag a song from the player bar/queue/another list into an open playlist.
- **Hide in this playlist** on Spotify-made playlists (`SetHiddenInPlaylist`, `model.rs:1303`; skipped when playing).
- Verdict: table UX (sort, filter, select, drag, reorder, duplicate confirm) **CAND**; Hide, open.spotify.com link paste, cover-upload rules, AddedBy DROP-S.

### 2.3 Liked Songs
- Heart on rows and the player bar; `B` toggles (`ToggleSaved`, `model.rs:1197`; `SetSavedMany`, `:1228`). `Page::LikedSongs` (`Ctrl+L`). Dragging a selection onto the row saves all. Optimistic edits; cache fresh for 15 min (`liked.rs:11`). Player-bar heart popup offers saving to playlists (`ui/player_bar.rs:20`).
- Verdict: **CAND** as local favourites per profile; Spotify sync DROP-S.

### 2.4 Albums, Artists, Podcasts, Episodes pages
- `Page::Albums/Artists/Podcasts/Episodes/Album/Artist/Show` (`model.rs:117-124`; `ui/collection.rs`, `ui/artist.rs`, `ui/show.rs`).
- Album page: header, year hover, Plays column, Add to queue adds the album.
- Artist page: popular songs (`ToggleShowAllTop`, `model.rs:1351`), discography filter All / Albums / Singles / Compilations / Appears On (`model.rs:918-925`; `SetDiscographyFilter`, `:1347`; `LoadMoreArtistAlbums`, `:1346`), monthly listeners, **Release countdown / pre-save** (`ui/prerelease.rs`, `prerelease.rs`; `SetPrereleaseSaved`, `:1324`).
- Podcast page: episodes, Refresh, resume from where left off; Home "Your podcasts" shelf: started-not-finished plus newest within 30 days, 8 shows x 5 episodes, audiobooks excluded (docs "Podcasts on Home").
- Verdict: album/artist pages and discography filter **CAND** (over local tags); podcasts, pre-save, monthly listeners DROP-S.

### 2.5 Search
- `Ctrl+F` or `/` (`FocusSearch`, `model.rs:1336`); `ui/search.rs`. Filters All / Songs / Artists / Albums / Playlists / Podcasts / Episodes (`model.rs:778-787`, `SetSearchFilter`, `:1334`). Top-result card art 96 px (`ui/search.rs:298`). Search history in `search_history` (`settings.rs:~338`), `ForgetSearch` (`model.rs:1333`). Pasting a Spotify link plus Enter opens it (`link.rs`; docs "Opening a Spotify link"). A song picked in search plays alone; with Autoplay Spotify continues. Launcher search link is "in development".
- Verdict: filter chips, history, top-result card **CAND** (over a local index); catalogue search and link opening DROP-S.

### 2.6 Top songs
- `Page::TopSongs` (`model.rs:112`), period Short / Medium / Long term (`model.rs:612-617`, `SetTopPeriod`, `:1335`). Spotify top-items API: DROP-S. A local version from `history.json` would be new.

### 2.7 Radio
- "Go to song/playlist/album/artist radio" opens `Page::Radio` seeded by URI (`model.rs:127`; `OpenSongRadio`, `:1132`; `ui/radio.rs`). The page keeps its songs; Play/Shuffle/double-click use them; Refresh makes a new mix; **Save as playlist** (`SaveRadio`, `:1301`). Needs the Spotify playback session. DROP-S (a local "similar songs" mix would be new).

---

## 3. Lyrics

- Open with the mic button or `L`; panel width default 360 (`settings.rs:~329`; `ToggleLyricsPanel`, `model.rs:1369`; `ui/lyrics.rs`). Full screen with `F` or expand button (`SetLyricsFullscreen`, `:1372`); Esc/`F` leaves. At 900 px wide or more the cover sits beside lyrics, lyrics column 640 px (`ui/lyrics.rs:353-357`); instrumentals show cover only.
- **Synced** lyrics follow the active line (`Lyrics::active_line`, `lyrics.rs:66`; line size 19, gap 10, sung-line growth 1.15, light-up 0.22 s, `ui/lyrics.rs:12-32`). Scrolling pauses follow, **Follow** resumes (`FollowLyrics/PauseLyricsFollow`, `model.rs:1374-1375`); click a line to seek. Unsynced lyrics show as plain text (`Lyrics.synced`, `lyrics.rs:55-60`). Retry on error (`RetryLyrics`, `:1376`).
- **Source order:** Spotify transcription (if signed in), then LRCLIB exact lookup, then ranked search (closest length wins, synced breaks ties) with title/artist cleanup (strip featuring/remaster, `lyrics.rs:482,534,582`); retry/backoff on 503 and Retry-After; disk cache, old cache kept during outages (`lyrics.rs:117-176,243-274`).
- **Local files:** `.lrc` beside the file (same stem, BOM stripped), else ID3 `USLT` / Vorbis `LYRICS`; cover from ID3 `APIC` or FLAC `PICTURE`, front cover preferred (`local_tags.rs:1-9,93-125`); ISO-8859-1 LRC with lost newlines is repaired (`local_tags.rs:119`). Runs off the UI thread.
- **MilkDrop behind lyrics:** `V` toggles (`ToggleLyricsMilkdrop`, `model.rs:1498`; `lyrics_milkdrop` in settings); `N`/`P` change preset; backdrop dim 0.2-0.32 (`ui/lyrics.rs:576-579`); clicking the album art goes to pure MilkDrop (`EnterImmersive/LeaveImmersive`, `model.rs:1494-1496`), controls reappear on mouse move for a few seconds.
- Verdict: LRC parsing, sidecar/tag lyrics, line-follow, click-to-seek, fullscreen layout **CAND**; Spotify lyrics DROP-S; LRCLIB is an outbound request (breaks "nothing leaves the home" unless dropped or self-hosted).

---

## 4. Equalizer, limiter, balance (local playback)

- **Bands (Winamp's 10):** 60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000 Hz, each -12..+12 dB; preamp -12..+12 dB (`eq.rs:15-20,28-40`). Default: off, flat, balance 0, mono off (`eq.rs:36-48`).
- Second-order peaking filter per band; widths from midpoints (outer bands extend 3 octaves below 60 Hz and 1 above 16 kHz); gains solved together so the combined curve meets each slider at its centre; bands within 0.05 dB of flat are skipped (`eq.rs:50-140`). Curve and sliders drawn in Settings (`eq_curve`, `ui/settings.rs:2855`; `eq_slider`, `:2798`).
- **23 built-in presets:** Flat, Classical, Club, Dance, Full Bass, Full Bass & Treble, Full Treble, Laptop Speakers / Headphones, Large Hall, Live, Party, Pop, Reggae, Rock, Ska, Soft, Soft Rock, Techno (Winamp's 18), then Bass Booster, Bass Reducer, Treble Booster, Vocal Booster, Small Speakers (`eq.rs:233-330`; `ApplyEqPreset`, `model.rs:1467`).
- **User presets:** type a name, **Save preset**; stores preamp + 10 bands; same name replaces; **Delete** while one is in use (`UserEqPreset`, `settings.rs:~110`; `SaveEqPreset/DeleteEqPreset/ApplyUserEqPreset`, `model.rs:1469-1474`; `ui/settings.rs:70-137,2304`). Listed after built-ins in Settings and the mini player PRESETS menu.
- Controls: `ToggleEq`, `SetEqBand`, `SetEqPreamp`, `SetBalance`, `ToggleMono` (`model.rs:1463-1477`). Balance -1..1 attenuates only the quieter side (`eq.rs` `channel_gains`); mono plays both channels the same; both work with EQ off. Mini player: `EQ` window, AUTO resets bands. Moving a band from a WMP skin turns EQ on.
- **Limiter:** look-ahead soft-knee, threshold -1 dBFS, knee 2 dB, attack 1.5 ms, release 100 ms, look-ahead 8 ms, one shared gain for both channels (`limiter.rs:20-27`). The EQ itself does not clip.
- Applies to this computer's playback only, never remote Connect devices.
- Verdict: all **CAND** (clean DSP spec; maps to Web Audio BiquadFilter plus a limiter node).

---

## 5. Visualizers

### 5.1 Player-bar visualizer
- Off / Spectrum / Waveform, default Off (`settings.rs:82-100 PlayerBarVis`). Spectrum: glowing bars bass-to-treble with hanging peaks; Waveform: glowing line. **Colour from album art** sweeps up to four cover colours, else accent. Follows EQ, not volume; moves only while playing locally. Clicking empty bar space cycles Off -> Spectrum -> Waveform -> Off; can be disabled (`player_bar_vis_click`, `ui/settings.rs:1243,1348`; `CyclePlayerBarVis`, `model.rs:1453`). Alphas, peak height 2, gap 2 (`ui/player_bar.rs:24-39`). **Frame rate** 30 / 60 (default) / screen rate / Uncapped (`visualizer_fps`, `settings.rs:322`; `frame_rate_dial`, `ui/settings.rs:259`); half rate unfocused, max 30 on energy saver, none when hidden.
- Verdict: **CAND**.

### 5.2 Winamp analyser (mini player)
- 19 bars, 75 columns x 16 rows, 512-point FFT, 576-sample scope, bar fall-off 12/16, peak fall 1.1, 60 Hz step (`vis.rs:20-50`). Click the display to cycle bars -> waveform -> off, or the **V** menu (`CycleVisualiser/SetVisualiser`, `model.rs:1451-1455`). Works in the collapsed bar. Audio tap keeps 0.5 s of post-EQ, pre-volume audio (`vis.rs:20`). Wide display uses 75 bands (`vis.rs:593-603`).
- Verdict: **CAND**.

### 5.3 MilkDrop (projectM)
- Open via the top-bar button, `Ctrl+Shift+K`, Settings, or the mini player V menu; own window, wearing the Winamp skin frame when a classic skin is on; double-click or `F` for full screen; Esc leaves (`ToggleWinampMilkdrop`, `MilkdropFullscreen`, `model.rs:1488-1492`; `milkdrop.rs`; `ui/winamp/milkdrop.rs`).
- Keys: N/Right next, P/Left previous, H hard cut on next beat, L lock preset, R random vs folder order, T preset name, D FPS, I song display (notify / always / hidden), ?/F1 help (docs/_guide/milkdrop.md).
- Settings: **Time per preset** default 10 s (`milkdrop.rs:44`); **Frame rate** 10..=360, default 60 (`:46-48`); **Resolution** 1 full / 2 half / 4 quarter, default 1 (`ui/settings.rs:2157-2261`); window default 640x480, min 320x240 (`milkdrop.rs:92-94`); preset crossfade 2.7 s (`:96`); mini-player panel default 232 skin px. Stops drawing when minimised/covered; 30 fps on energy saver; 1 fps with display off.
- **Presets:** auto-download on first use: 550 MilkDrop 2 pack plus ~9,800 Cream of the Crop (`milkdrop.rs:114 PACKS`; `DownloadMilkdropPack`, `model.rs:1509`; "Get presets", `ui/settings.rs:2167-2208`); stored in a `milkdrop` folder (`OpenMilkdropFolder`, `:1506`). Needs a GPU.
- Verdict: **CAND** (butterchurn is the web analogue; `.milk` files; the first-use download is an outside fetch and would have to be bundled).

### 5.4 Reduced motion
- Follows OS reduce-motion: lyrics jump, theme change without reveal, tint without fade (`motion.rs`, `appearance.rs`; `ANIMATION_TIME 0.12`). Verdict: **CAND** (prefers-reduced-motion).

---

## 6. Mini player (Winamp) and skins

- Toggle: `Ctrl+M` (`Cmd+Shift+M`), shrink button, Settings **Switch to it** (`ToggleWinampWindow`, `model.rs:1425`; `winamp.rs`; `ui/winamp/mod.rs`). One window at a time.
- Main controls: spectrum, elapsed/remaining toggle on click, balance, MONO/STEREO, shade by double-click on the title bar (`ToggleWinampShade`, `model.rs:1486`); size **1x-4x** (`MAX_SCALE 4`, `winamp.rs:18`; `SetSkinScale`, `:1437`; right-click or **O** menu; **D** steps sizes; **A** toggles always-on-top, `ToggleWinampOnTop`, `:1438`); **I** opens the playing album; `Ctrl+Q` quits. Marquee 31 chars, 220 ms step, "  ***  " gap (`winamp.rs:21-27`).
- **Playlist window** `PL`: playing song + queue, double-click plays, Ctrl-click multi-select, resizable (default 174 skin px, `ui/winamp/playlist.rs`). Buttons ADD (search / Liked Songs), SEL, MISC (song/artist/album pages), LIST OPTS (start a playlist, save queue as playlist), REM (Remove selected / Remove all, local queue only).
- **Equalizer window** `EQ` (`ui/winamp/equalizer.rs`): ten bands, preamp, AUTO, PRESETS menu.
- **Skin formats:** Winamp 2 `.wsz`, unpacked folders (searched 8 deep), `.zip` (classified by contents), WMP `.wmz` or folders with `.wms` (`winamp.rs:50`; `skin/zip.rs`, `skin/sprites.rs`). Drag-and-drop install (`InstallSkin`, `model.rs:1435`); cards with background-rendered cached previews (`ui/skin_cards.rs`, `skin_previews.rs`); **Random skin** each open, never the same twice (`SetRandomSkin`, `:1449`); folder opener (`OpenSkinsFolder`, `:1442`). Default skin: built-in **Spotifast Wide** (`settings.rs` default `skin: Some(WIDE)`), also **Spotifast Tall**. Winamp 3/5 modern skins unsupported; transparency and odd shapes supported.
- **WMP skins** run their own scripts in a custom sandboxed interpreter (`skin/script/*`, `skin/wmp/*`, texture cap 192 MiB `winamp.rs:101`); transport/seek/volume/shuffle/repeat/playlist/EQ/visualisation map to app state; FF/rewind jump 10 s; file/CD/library/web buttons do nothing.
- Shipped skin assets: `assets/skins/{ribbon,wide,spotifast.wsz,spotifast-wide.wmz,spotifast-ribbon.wmz}`.
- Verdict: the idea (skinnable mini player with EQ, playlist and visualizer panels) **CAND**; Webamp (JS) is the realistic web analogue for `.wsz`. Native windows, always-on-top, taskbar, Hyprland border patch (`hyprland.rs`), custom title bar DROP-P. WMP scripting not worth porting.

---

## 7. Themes and appearance

- Theme: Follow system / Light / Dark (`settings.rs:40-47`; `SetTheme`, `model.rs:1384`). **Custom palette files** in a themes folder (`SetCustomTheme`, `:1388`; `OpenThemesFolder`, `:1387`; `ReloadThemes`, `:1392`). Palette fields: dark flag, window, panel, surface (+hover, active), outline, text, secondary, dim, accent (+hover), on_accent, danger, warning, overlay, shadow, tint (`theme.rs:16-37`). One theme each for light and dark (`SetPairTheme`, `:1391`; `pair_picker`, `ui/settings.rs:2699`). Omarchy follow-theme (`contrib/omarchy`) DROP-P.
- **Colour from album art** tints the UI (`accent_from_art`, default on, `settings.rs:314-315,516`; strength 0.12, fade 0.45 s, `ui/player_bar.rs:15-17`; `PrepareTint`, `model.rs:1137`).
- Interface zoom (`zoom` 1.0, Ctrl +/-), compact sidebar, compact track list, shortcut hints, custom title bar, Linux middle-click autoscroll (off by default), fonts Inter + Lucide icons (`settings.rs:329-361`; `system_fonts.rs`; docs "Middle-click autoscroll").
- Verdict: token themes, art tint, compact/zoom **CAND** (MaiPai already has tokens); Omarchy, custom title bar, autoscroll DROP-P.

---

## 8. Desktop shell: notch, tray, taskbar, media keys, CLI

- **MacBook notch widget** (`mac_notch.rs`, `notch.rs`; `mac_notch_widget` default off): hover expands to art, title, artist, elapsed/remaining, seek bar, shuffle, previous, play/pause, next, repeat, save, device; `NotchCommand` set (`notch.rs:3-12`). DROP-P.
- **Tray / background:** closing hides to the tray, music keeps playing (`keep_playing_in_background` default true; tray icon Colour/White/Black, `settings.rs:60-67`). Start at login: With the window / In the menu bar / In the tray (`SetStartWithComputer`, `model.rs:1293`; `ui/settings.rs:2589-2650`). macOS menu-bar mode `mac_show_in_dock` (`mac_menu.rs`). DROP-P.
- **Taskbar thumbnail buttons** (`thumbbar.rs`), SMTC, MPRIS (`playerctl --player=spotifast`), media keys: DROP-P. A browser MediaSession API is the web equivalent (**CAND**).
- **Sleep prevention while playing** (`power.rs`): wake lock. DROP-P.
- **CLI/launcher control** over a private channel (`single_instance.rs`; docs "Controlling it from the command line"): `play-pause play pause next previous seek <s> seek-to <s> volume <n> volume-up/down [pct] mute shuffle [on|off] repeat [off|context|track] like show play-uri transfer devices now-playing [--raw] play-search [--kind artist|album|playlist]`; `now-playing --raw` fields: state, title, artists, album, position_ms, duration_ms, volume, shuffle, repeat, art_url, saved, device. DROP-P as a CLI; the same verbs as a hub API/voice command set is a **CAND** idea.
- **Shortcuts** (`ui/keys.rs:278 shortcuts()`; dialog `?` or `Ctrl+/`): `Space`, `Ctrl+Left/Right`, `Shift+Left/Right` (10 s), `Ctrl+Up/Down`, `M`, `B`, `S`, `R`, `Q`, `F`, `V`, `N`/`P`, `Ctrl+F` or `/`, `Ctrl+B`, `Alt+Left/Right` (back/forward), `PageUp/Down`, `Home/End`, `Ctrl+H`, `Ctrl+L`, `Ctrl+Shift+A` (playing artist), `Ctrl+Shift+B` (playing album), `Ctrl+A/C/V/X`, `Shift+Q`, `Shift+N`, `Ctrl+M`, `Ctrl+Shift+K`, `Ctrl+,`, `Ctrl+Q`. Letter keys yield to focused text fields. Verdict: key map **CAND**; Quit, mini player, MilkDrop window DROP-P.
- **Accessibility:** screen-reader names on controls/sliders/rows; Tab/Enter; focus outline; arrow row navigation (docs "Keyboard and screen readers"). **CAND**.

---

## 9. Devices, Connect, Cast, Sonos, audio output

- **Device picker** (`ToggleDevicesPopup`, `model.rs:1377`; `ui/devices.rs`): Connect devices, active marked; `Transfer`, `ActivateReceiver`, `RefreshDevices`, `PlayOnAnotherDevice` (`model.rs:1286-1289,1366`); frequent/recent outputs rise to top. Device name default "Spotifast" (`settings.rs:268,493`). Handoff back to this computer carries song, position, queue (queue.md). DROP-S.
- **Google Cast** (`cast.rs`, `zeroconf.rs`): mDNS `_googlecast._tcp`, Cast v2 over TLS port 8009, genuineness check, launch Spotify receiver, `getInfo`, token exchange, `addUser`, then a normal Connect device (`cast.rs:1-20`). DROP-S (the trick is Spotify's receiver app); a DLNA/Cast media output for local files would be new.
- **Sonos** (`sonos.rs`): finds idle speakers via ZeroConf `/spotifyzc` on port 1400, steers them via the Connect state service. DROP-S.
- **Audio output picker** at the bottom of the device picker: system default or any output; restarts at the same place; saved by device id (`audio_device`, `SetAudioDevice`, `model.rs:1295`; `ListOutputDevices`, `:1291`; `sink.rs`). Linux: PipeWire, else PulseAudio, else ALSA; mixer shows "Spotifast". Resamples to the device rate with a 64-tap polyphase sinc (`resample.rs:1-24`). DROP-P in a browser; the hub's speaker/Cast output is a MaiPai design question.
- **Soloist** (Spotify's own player binary; `ui/soloist.rs`, `credentials.rs`, docs/_reference/soloist.md). DROP-S.

---

## 10. Discovery and social

- **Home** (`ui/home.rs:58` and following): Recently played tiles (at least 8, padded with Liked Songs and first playlists), Made for you, Your top mixes, New releases, Recommendations, Your podcasts; shelf visibility toggles (`HomeSettings`, `settings.rs:76-80`); `Shift+wheel` scrolls a shelf sideways.
- **Made for you / Top mixes:** Spotify's private Pathfinder Home feed over the playback session; Web API search fallback (`made_for_you.rs:1-9`). DROP-S.
- **New releases** shelf and page: Spotify "What's New" feed, else newest albums of up to 50 followed artists; page lists every song newest-first with Play and Shuffle (`new_releases.rs:1-12`; `ui/new_releases.rs`; `Page::NewReleases`). DROP-S (a local "recently added albums" shelf would be new; layout is CAND).
- **Recommendations** shelf (`ui/home.rs:981`): Spotify-based. DROP-S.
- **Listening activity / friends** panel: followed people's current songs, refresh every 15 s, blue dot = live, play from their song (`ui/friends.rs`; `ToggleFriendsPanel`, `model.rs:1371`). DROP-S and privacy-hostile for a family hub.
- **Sharing:** only **Copy link**, **Copy details** (title, artists, or "Artist - Title") (`CopyLink`, `:1309`; `CopyText`, `:1311`; `CopySongs`, `:1314`) and `OpenInSpotify` (`:1328`). Verdict: Copy details **CAND**; links DROP-S.

---

## 11. Offline, storage, privacy

- **Offline:** none. The audio cache (default on, 1024 MB) holds streamed Spotify audio; **Clear audio** and **Clear artwork** (`ClearAudioCache`, `ClearArtCache`, `model.rs:1420-1421`; `ui/settings.rs:2393-2453`; `images.rs`). Settings > Storage shows folders, sizes, sign-in storage state. Credentials in OS protected storage (`credentials.rs`, `account_cache.rs`). Cache DROP-S; the Storage page layout **CAND**.
- Privacy: only Spotify, LRCLIB and GitHub requests (docs/_reference/privacy.md). Proxy: Off / System / HTTP / SOCKS5 with host, port, user, password in the protected store (`settings.rs` `ProxyMode`; `ui/settings.rs:1699-1781`). DROP-P.

---

## 12. Settings structure

One searchable page (`ui/settings.rs:461`; search box `:485`; empty result "No settings for ..." `:2575`). Sections in order: Spotify Soloist (`:516`), Account (`:585`), Playback on this computer (`:867`), Appearance (`:1365`), Proxy (`:1710`), Mini player (`:1880`), MilkDrop (`:2179`), Equalizer (`:2312`), Storage (`:2435`), About (`:2504`).
- Playback rows: Device name, Audio quality, Normalize volume, Autoplay, Gapless playback, Keep music playing when the window closes, Automatic update checks, Download updates automatically, Audio cache + size, Output buffer, MacBook notch widget, **Local files** (Choose folder, Remove, status "Looking for songs in {folder}...", `ui/settings.rs:391-412,845,1134`), Tray icon, Start with your computer, Show in Dock, **Apply and restart playback** (`RestartEngine`, `model.rs:1412`).
- Appearance rows: Theme, Light/Dark mode theme, Colour from album art, Compact library sidebar, Compact track list, Middle-click autoscroll, Custom title bar, Player bar visualizer, Click player bar to change visualizer, Language, Interface zoom, Frame rate.
- Mini player rows: Show, Always on top, Show in taskbar, Random skin, Size, Skins folder, Winamp and WMP skin lists, Skin Museum links.
- Verdict: searchable settings page **CAND**; Soloist/Account/Proxy/Update rows DROP-S/P.

---

## 13. Internationalisation

- gettext catalogs in `assets/i18n/*.po`, English source and fallback (`i18n.rs:1-8`). 17 locales: en, de-DE, es, nl, pt-BR, pt-PT, fr, sv, pl, ru, it, ja, ko, zh-Hans, zh-Hant, tr, uk (`i18n.rs:8-60`). Picker: System or a locale (`LanguageChoice`, `settings.rs:~120-165`; `SetLanguage`, `model.rs:1386`; `language_picker`, `ui/settings.rs:2749`). `bidi.rs` handles right-to-left text; `ngettext` plurals, `pgettext` contexts. Guide: docs/_reference/translating.md. Verdict: **CAND** (strings reusable; MaiPai has its own i18n).

---

## 14. Updates

- Self-update from GitHub releases daily (`updates.rs`; `check_for_updates` default true, `download_updates_automatically` default false, `settings.rs:~385-392,525-528`); green update button, download, restart only on click (`CheckForUpdates/ShowUpdate/DownloadUpdate/InstallUpdate`, `model.rs:1379-1382`; `ui/update.rs`); verified downloads, rollback on a failed start; Settings > About: Check for updates, Keyboard shortcuts, Release notes, Source code. Package-managed installs update through the package manager. DROP-P (MaiPai has its own catalog and installer).

---

## 15. Account and onboarding flows (all DROP-S)

- Sign-in: register a Spotify developer app, enter a Client ID (`ui/login.rs`, `auth.rs`; `ConfigurePersonalWebApp`, `OpenPersonalAppSetup`, `model.rs:1357-1358`), OAuth in the browser (`SignIn/CancelSignIn/SignOut`, `:1353-1355`), local playback authorisation (`EnablePlayback`, `:1417`; `zeroconf.rs`), Free vs Premium notice, slow-app banner (once a day, max 3 dismissals, `settings.rs` `SlowAppBanner`), audio-key-refused banner (`player.rs:171`; `CloseAudioKeyBanner`, `model.rs:1363`).
- `--demo` mode with a seeded fake library (`demo.rs`, 13,820 lines): useful only as a reference for what a seeded demo looks like.

---

## 16. Summary table

| Feature | Verdict | Primary cite |
|---|---|---|
| Transport, seek, volume/mute, fades | CAND | `ui/player_bar.rs:707`, `model.rs:1179-1188` |
| Shuffle, Repeat (Off/Context/Track) | CAND | `player.rs:117-130`, `model.rs:1189-1192` |
| Two-tier queue, play next, reorder, remove, clear, save as playlist | CAND | `ui/queue.rs`, queue.md |
| Gapless, normalise (ReplayGain-style) | CAND | `settings.rs:270-273` |
| Autoplay, bitrate, audio cache, output buffer | DROP-S / DROP-P | `settings.rs:268-285` |
| Crossfade, sleep timer, speed | absent | n/a |
| Local files (as Spotify playlist entries) | DROP-S flow; parts CAND | `player.rs:67,637` |
| Local tags: cover, lyrics (USLT, LYRICS, .lrc) | CAND | `local_tags.rs:93-125` |
| Synced lyrics UI, LRC parse, click-to-seek, fullscreen | CAND | `ui/lyrics.rs`, `lyrics.rs:650-706` |
| Spotify lyrics, LRCLIB lookup | DROP-S / outbound | `lyrics.rs:19,146` |
| 10-band EQ, preamp, balance, mono, 23 presets, user presets | CAND | `eq.rs`, `ui/settings.rs:2275-2390` |
| Limiter | CAND | `limiter.rs:20-27` |
| Player-bar spectrum/waveform, art colours, fps | CAND | `settings.rs:82-100`, `ui/player_bar.rs` |
| Winamp analyser (19 bars, scope) | CAND | `vis.rs:20-50` |
| MilkDrop (projectM, presets, controls) | CAND (bundle presets) | `milkdrop.rs`, milkdrop.md |
| Winamp `.wsz` mini player, EQ, playlist windows | CAND (idea; Webamp) | `winamp.rs`, `ui/winamp/*` |
| WMP `.wmz` skins with script sandbox | DROP-P | `skin/wmp`, `skin/script` |
| Themes: tokens, light/dark pair, art tint, custom palette | CAND | `theme.rs:16-37`, `settings.rs:314` |
| Library sidebar sorts, pins, drag arrange, grid/compact | CAND | `ui/sidebar.rs`, `settings.rs:12-29` |
| Playlist table: sort, filter, multi-select, drag, copy rows | CAND | `ui/collection.rs`, `model.rs:1001` |
| Liked Songs (as hearts) | CAND (local) | `liked.rs`, `model.rs:1197` |
| Local play history (30 s / half rule, cap 500) | CAND | `history.rs:16-24` |
| Search filters, history | CAND (local index) | `model.rs:778`, `settings.rs` |
| Discography filter, album/artist pages | CAND (local tags) | `model.rs:918` |
| Reduced motion, a11y, shortcut table | CAND | `motion.rs`, `ui/keys.rs:278` |
| i18n catalogs (17 locales) | CAND | `i18n.rs`, `assets/i18n` |
| Searchable settings page | CAND | `ui/settings.rs:461` |
| Radio, Made for you, Top mixes, New releases, Recommendations, Top songs | DROP-S | `ui/radio.rs`, `made_for_you.rs`, `new_releases.rs` |
| Friends activity, play counts, pre-save | DROP-S | `ui/friends.rs`, `prerelease.rs` |
| Connect devices, Cast, Sonos, Soloist | DROP-S | `cast.rs`, `sonos.rs`, `ui/devices.rs` |
| Notch, tray, taskbar, MPRIS/SMTC, CLI, login start, proxy, self-update | DROP-P | `mac_notch.rs`, `thumbbar.rs`, `updates.rs` |

## 17. Doc/code inconsistencies noticed
- A `settings.rs` comment says preamp is "never above zero", but `eq.rs` clamps to +/-12 and winamp.md says -12 to 12. Treat +/-12 as the spec.
- milkdrop.md says MilkDrop is included on ARM PCs; README says it is not in the Windows on ARM download. Irrelevant to a web port.
- Docs mark playlist cover upload and launcher search links "in development, not included in 0.8.0"; treat as unshipped.
- Line cites marked `~` were not re-read and are approximate; all others come from grep output.
