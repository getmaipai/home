# ace-step-ui: UI / UX audit (task b)

Source: `/private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai-home/51ec3e7f-849d-471f-a90c-b28549377b45/scratchpad/ace/repo`. Read-only; nothing executed. All paths below are relative to that repo.
Cites are `file:line`. "Tailwind" = Tailwind Play CDN script, not a build (index.html:23).

## 0. Big picture

- React 19 + Tailwind CDN + lucide-react (importmap, index.html:249-259). One `App.tsx` (1534 lines) owns all state; no router library, it uses `window.history.pushState` and a `currentView` string (App.tsx:50, 255-296; `View` = create, library, search, profile, playlist, song, training, news).
- Layout: `h-screen flex-col` root (App.tsx:1391): row of [Sidebar | main view], then a fixed-height bottom `Player` bar.
- Look: Suno-like. Dark default (`<html class="dark">`, index.html:2), near-black surfaces, pink-to-purple accent gradient, orange-to-pink Create button. Light theme exists.
- Embedded editor is NOT an iframe. It is AudioMass served as static files at `/editor` and opened in a new browser tab with `?audioUrl=` (SongDropdownMenu.tsx:116-123, RightSidebar.tsx:303, SongProfile.tsx:275, server/src/index.ts:84-88). Stem extraction is likewise a separate page `/demucs-web/` in a new tab (SongDropdownMenu.tsx:125-135).
- `MobileDrawer.tsx` exists but nothing imports it (grep: only its own file). It is dead code. Phone navigation actually uses the Sidebar itself (section 3).

## 1. Design tokens

### 1.1 Tailwind config (index.html:25-59)
| Token | Value |
|---|---|
| `suno` (DEFAULT) | `#09090b` (page bg dark) |
| `suno-sidebar` | `#000000` |
| `suno-panel` | `#121214` (create panel, right sidebar, video sidebar) |
| `suno-card` | `#18181b` (cards, inputs) |
| `suno-hover` / `suno-border` | `#27272a` |
| font | `Inter, sans-serif` weights 400/500/600/700 via Google Fonts (index.html:62) |
| animation `gradient-x` | 15s ease infinite, background-position sweep (defined, little used) |

Other raw colors used inline: `dark:bg-[#1a1a1f]` (audio section card, CreatePanel.tsx:1375), `dark:bg-[#121214]` (search input, SongList.tsx ~233), `dark:bg-[#18181b]` (filter menu, song row hover), `dark:bg-black/95` (player), `dark:bg-black` (library/song list page).

### 1.2 Accent colors (Tailwind palette, no custom vars)
- Primary accent: pink-500/600 (`#ec4899` also meta theme-color, index.html:16). Active nav bar `bg-pink-500` (Sidebar.tsx:219); selected chips `bg-pink-600 text-white border-pink-500` (CreatePanel.tsx:1562); focus borders pink; slider `accent-pink-500` (EditableSlider.tsx:93).
- Brand gradient: `from-pink-500 to-purple-600` (logo disc Sidebar.tsx:53; avatar fallback; reference play button). `.gradient-text` = pink `#f472b6` -> violet `#a78bfa` -> blue `#60a5fa` (index.html:104-108).
- Create button: `bg-gradient-to-r from-orange-500 to-pink-600`, `h-12 rounded-xl font-bold text-base`, `shadow-lg hover:brightness-110`, `active:scale-[0.98]` (CreatePanel.tsx:2773-2776).
- Library tab underline is green-500 (LibraryView.tsx:~91), inconsistent with pink elsewhere. Video modal "Select"/Pexels uses emerald-500/600. News uses amber. Queue badge uses amber-400/500 (SongList.tsx ~549).
- Status: success green-500, error red-500, info blue-500 (Toast.tsx:32-42). Danger red-600/700 (ConfirmDialog.tsx:80).

### 1.3 Type scale (observed utility classes)
- Page title `text-3xl font-bold` (Library), `text-2xl font-bold` (News, Settings), `text-5xl font-extrabold` (Liked Songs header).
- Song title in list `font-bold text-lg truncate` (SongList.tsx ~610). Player title `text-xs sm:text-sm font-bold` -> mini `text-sm font-semibold`.
- Section labels: `text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400` (CreatePanel 1382, 1555, 1607).
- Field labels `text-xs font-medium text-zinc-600 dark:text-zinc-400`; help text `text-[10px] text-zinc-500`; sub-hints `text-[11px] text-zinc-400`.
- Time and numeric values `font-mono` (player time, slider values, lyrics textarea `font-mono leading-relaxed`, CreatePanel.tsx:1589).
- Tiny badge text `text-[9px]`/`text-[10px]` (model "Active/Ready", chips).

### 1.4 Spacing / radii / shadows
- Panel padding `p-4`, vertical stack `space-y-5` (CreatePanel.tsx:1089); bottom padding `pb-24 lg:pb-32` to clear the Player. List pages `p-6 pb-32` (SongList), Library `p-6 lg:p-10 pb-32`.
- Cards `rounded-xl border border-zinc-200 dark:border-white/5`; modals `rounded-xl`/`rounded-2xl shadow-2xl border border-white/10`; pills `rounded-full`.
- Z layers: sidebar backdrop 40, sidebar 50, player 50, mobile toggle 50, drawers/modals 60, video modal 60, drag overlay 90, toast 100, confirm 100 (Sidebar.tsx:38-46; Toast.tsx:45; ConfirmDialog.tsx:42).
- Scrollbars: 6px, thumb `#d4d4d8` light / `#3f3f46` dark, hover `#a1a1aa`/`#52525b` (index.html:72-93). Utility `.scrollbar-hide`. Class `custom-scrollbar` is referenced widely but not defined in index.html (relies on `/index.css`, which is not in the repo; link at index.html:260), so it is a no-op or an external-file dependency.

### 1.5 Theme
- Toggle in Sidebar (Sun/Moon) and Settings > Appearance (Light/Dark buttons). State in App.tsx:43-47: localStorage `theme`, else `prefers-color-scheme`. Effect toggles `dark` class on root (App.tsx:235-243). Body has `transition-colors duration-300`.

## 2. Motion and animation inventory
- Drawer/backdrop keyframes: `slide-in-left/right` 0.3s ease-out, `slide-out-*` 0.3s ease-in, `fade-in/out` 0.3s (index.html:144-185). Only used by the unused MobileDrawer.
- Equalizer bars for "generating": `.music-bar-anim` keyframe `music-bars` 1s ease-in-out infinite, heights 20%->100%->20%, opacity .5->1; 4 bars `w-1 bg-pink-500` with delays 0 / .2 / .4 / .1s (index.html:110-118; SongList.tsx ~560-565).
- "Now playing" bars in profile lists: `animate-pulse` on pink bars with staggered delays (SongProfile.tsx:249-252; UserProfile.tsx:444-447, 534-536).
- Modals: `animate-in fade-in zoom-in-95 duration-200` (ConfirmDialog.tsx:47; ShareModal, EditProfile, Playlist modals); backdrops `animate-in fade-in duration-150` + `backdrop-blur-sm`. Mobile details panel `slide-in-from-right duration-300` (App.tsx:1497). Toast `slide-in-from-top-4 fade-in duration-300` (Toast.tsx:45). Dropdown menus `fade-in slide-in-from-top-2` or `...bottom-2` when opening upward (SongDropdownMenu.tsx:165-166). These `animate-in` classes are tailwindcss-animate names; with the CDN they only work if the plugin is available (not configured in tailwind.config), so treat as intended-not-guaranteed.
- Spinners: lucide `Loader2 animate-spin`, `RefreshCw animate-spin`, CSS border spinner `w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin` (SongProfile.tsx:145).
- Skeletons: `animate-pulse` placeholders in Search (SearchPage.tsx:246, 308, 367).
- Pulse dot beside "ACE-Step v1.5": `w-2 h-2 rounded-full bg-green-500 animate-pulse` (CreatePanel.tsx:1124); LoRA status dot green pulse / red static (CreatePanel.tsx:1774).
- Hover micro-motion: logo `hover:scale-105`, player play `hover:scale-105`, fullscreen controls `hover:scale-110`, buttons `active:scale-[0.98]`; avatar wiggle `group-hover/avatar:animate-[wiggle_0.6s...]` + `rotate-1` (UserProfile.tsx:210; `wiggle` keyframe not defined here).
- Sidebar width transition: `transition-all duration-300` between `w-[200px]` and `w-[72px]` (Sidebar.tsx:45-47).

## 3. Responsive / phone layout

### 3.1 Mechanism
- `ResponsiveContext` (context/ResponsiveContext.tsx): `MOBILE_BREAKPOINT = 768`; `isMobile = innerWidth < 768` initial, then `matchMedia('(max-width: 767px)')` change listener (lines 8-39). Exposes `{isMobile, isDesktop}`. Wrapped per `index.tsx`.
- Two parallel systems: JS `isMobile` (Player, Video modal, Sidebar close-on-nav, App) and Tailwind breakpoints `md:`(768) / `lg:`(1024) / `xl:`(1280) / `sm:`(640). Also CSS helpers `.mobile-only`, `.desktop-only` at max-width 767px (index.html:120-142).
- Safe-area utilities (`.safe-area-inset-top/bottom/x/y/all`, env(safe-area-inset-*)), touch helpers (`.touch-none`, `.touch-manipulation`, `.tap-highlight-none`, `.scroll-touch`, `.overscroll-contain`) at index.html:196-247. Used by fullscreen mobile player and drawer.
- `meta viewport width=device-width, initial-scale=1.0` (index.html:5). No `viewport-fit=cover`, so the env() insets are effectively 0 on notched phones.

### 3.2 Layout by breakpoint (Create view, App.tsx:1303-1384)
- Phone (<768): Create panel and Song list are mutually exclusive, toggled by a floating pill button top-right: `md:hidden absolute top-4 right-4 z-50`, `bg-zinc-800 text-white px-4 py-2 rounded-full ... text-sm font-bold`, label `Create Song` or `View List` plus List icon (App.tsx:1376-1384). State `mobileShowList`. Create panel gets `pt-14 md:pt-4` to clear the pill (CreatePanel.tsx:1086).
- 768-1279: Create panel fixed `md:w-[320px] lg:w-[360px]` | Song list flex-1. Details sidebar hidden; each song row shows an Info button (`xl:hidden`, SongList.tsx ~ "Song Details") that opens a right slide-over (`max-w-md`, z-60, backdrop black/60 blur) (App.tsx:1490-1512).
- >=1280 (xl): third column Right sidebar `w-[360px]` shown when a song is selected (App.tsx:1355-1372).
- Sidebar: on phone it is `fixed left-0 top-0 z-50` overlay, `w-[72px]` collapsed (icon rail) or `w-[200px]` expanded with a full-screen `bg-black/60 backdrop-blur-sm` backdrop (`md:hidden`) that collapses it on tap (Sidebar.tsx:36-48). On md+ it is `relative` in the flex row. Navigating on phone auto-collapses (App.tsx:1407).
- Library, Search, News etc. are single-column scrollers; padding and font steps use `md:`/`lg:` (UserProfile `text-xl md:text-2xl`).
- Video Studio: full screen on phone (`w-full h-full`, `p-0`, no radius, preview canvas on top `aspect-video`, controls below, round white play button `w-14 h-14`); desktop modal `md:max-w-7xl md:h-[90vh] md:rounded-2xl` with `w-96` left control sidebar (VideoGeneratorModal.tsx:1701-1730).
- No keyboard-safe handling or bottom nav on phone; the Player is still a fixed bar (below).

### 3.3 Player responsive behaviour (Player.tsx)
- Desktop bar: `h-20 lg:h-24`, `bg-white dark:bg-black/95 backdrop-blur border-t`, 3-column row (track info max 30-33%, transport, tools) (Player.tsx:640-724). Hidden by breakpoint: time `hidden md:block`, speed menu `hidden lg:block`, volume `hidden md:block`, download `hidden lg:block`, more-menu `hidden sm:block`.
- Mobile (isMobile): compact bar: 1px-high (`h-1`) progress strip (pink-600/500 fill), 44px cover, title, like, prev/play(44px)/next; tapping cover/title expands to full-screen "Now Playing" sheet (Player.tsx:341-410). Full-screen mobile sheet: gradient bg `from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-black`, 280px square cover, progress bar `h-1.5` with 16px thumb, controls gap-8 with 64px play button, vertical volume slider (rotated range `w-32 -rotate-90`), actions row for video/download/menu (Player.tsx:155-335).
- Desktop fullscreen (Maximize2 button): same gradient, cover 320/400px, title `text-2xl lg:text-3xl`, scrubber `h-2` that turns pink on hover, speed menu, volume, extra actions; closes with Esc (Player.tsx:79-90, 416-636).

## 4. Screens and controls

### 4.1 Sidebar (components/Sidebar.tsx)
- Header: 40px logo disc (click = Create, title "ACE-Step UI"), wordmark "ACE Step" (only expanded), chevron collapse/expand button (`w-8 h-8 rounded-lg`) (50-83).
- Nav items (icon + label, tooltip = label): Create (Disc), Library (Library), Search (Search), Training (GraduationCap), News (Newspaper) (86-120). Item: `rounded-xl px-3 py-2.5`, active `bg-zinc-100 dark:bg-white/10` + 4px-wide pink left bar `h-8 w-1 rounded-r-full` (209-224). Collapsed items are `aspect-square` centered icons.
- Bottom group (`mt-auto`): theme toggle (label "Light Mode"/"Dark Mode"); if signed in: avatar+username button (opens Settings, tooltip "username - Settings"), "Sign Out" (hover red-500/red-500/10); else "Sign In" (hover pink) (122-195).

### 4.2 First-run / auth
- UsernameModal opens automatically when not authenticated (App.tsx:151-155). Single field "Your Name" (`enterYourName`), button "Get Started" / "Getting Started..." with spinner; validation: min 2 chars, regex `^[a-zA-Z0-9_-]+$`; errors inline (UsernameModal.tsx:20-37). No password; local account only. No dismiss (no `onClose` prop).

### 4.3 Create view: left column `CreatePanel` (2790 lines)
Header row (CreatePanel.tsx:1121-1218):
- Green pulsing dot + "ACE-Step v1.5".
- Mode toggle segmented control `Simple | Custom` (`bg-zinc-200 dark:bg-black/40 rounded-lg p-1`; active tab white/zinc-800 with shadow). Default `customMode = true` (line 126).
- Model chip: short name button (mapping base 1.5B, sft 1.5S, turbo 1.5T, turbo-shift1 1.5TS1, turbo-shift3 1.5TS3, turbo-continuous 1.5TC; lines 252-262) with chevron; opens a 288px-wide menu (`w-72`, `max-h-96`), each row: short name, "● Active"/"● Ready" green badge (from `/models`), id subtitle, pink check on selected. Default `acestep-v15-turbo-shift3` (localStorage `ace-model`). Choosing a non-turbo model auto-sets steps 20 and ADG on (1187-1190). Fallback list of 6 hard-coded ids when backend is down (237-247). Disabled and shows `...` when no models.

Simple mode (1221-1300+):
- "Describe your song" card with textarea (`h-32`, placeholder "A happy pop song about summer adventures with friends...") and a Dices button "Load random description" (fills description, instrumental, language).
- Vocal Language select (50+ languages, list at CreatePanel.tsx:60-111; default `en`) and Vocal Gender Male/Female toggle buttons (click again to clear; selected `bg-pink-600 text-white`).
- "Quick Settings" card (Sliders icon): Duration slider, BPM, Key, Time signature, Variations; same primitives as Custom.

Custom mode (1380-1830):
1. Audio card (bg `#1a1a1f`): tabs `Reference | Cover` (`audioTab`). Each tab shows, when loaded, a mini player row (round 40px gradient play button, title from URL, time, seek, remove); buttons "From Library" and "Upload" (1528, 1541). Files accepted: `audio/*`; picker also `.mp3,.wav,.flac,.m4a,.mp4`. Whole panel is a drop target: overlay `absolute inset-0 z-[90]` with blurred scrim and centered card (Upload icon in gradient disc), text "Drop to upload" or "Drop to use audio" plus "Uploading as reference/cover" (1067-1090).
2. Lyrics card: label "Lyrics" + hint "Leave empty for instrumental or toggle below"; pills `Vocal`/`Instrumental` (pink when instrumental), Sparkles "AI Format" button (disabled until style non-empty; spinner while running), Trash clears. Textarea `font-mono`, default height 144px, user-resizable by bottom grab handle (`cursor-ns-resize`, 3px grey pill), height saved in localStorage `acestep_lyrics_height` (334-338, 1589-1600). Disabled/30% opacity in instrumental. Placeholder "Your lyrics here...".
3. Style of music card: Sparkles toggle "enhance" (title = long enhanceTooltip, adds 10-20s), refresh-genres button (reshuffles 6 random tags from `data/main_style.txt`), clear, AI Format; textarea (placeholder "e.g. upbeat pop rock, emotional ballad, 90s hip hop"); six clickable tag pills `text-[10px] rounded-full` appended as ", tag" (1655).
4. Title input (placeholder "Name your song").
5. Instrumental switch row, Vocal Language select, Vocal Gender buttons.
6. LoRA collapsible: path input (default `./lora_output/final/adapter`), status dot + "Loaded/Unloaded", Load/Unload button (shows `...` while loading), enable toggle, Scale slider 0-1 step .05 (default 1.0), red error text under it (1745-1830).
7. Music Parameters: BPM slider 0-300 step 5, 0 displays "Auto"; Key select; Time signature select; Variations slider 1-4 (stored `ace-batchSize`).
8. Advanced Settings (collapsible, `showAdvanced`): Duration -1..600 step 5 (-1 = "Auto", else `NNs`), Batch size 1-4, Bulk generate count (1.., label "Queue multiple independent generation jobs with same settings", stored `ace-bulkCount`), Inference Steps default 12, range 1-20 for turbo else 1-200, Guidance Scale 1-15 step .1 default 9.0, Audio format mp3 | flac (FLAC lossless), Infer method ODE (deterministic) | SDE (stochastic), LM backend pt | vllm, LM model select (default `acestep-5Hz-lm-0.6B`, stored `ace-lmModel`), Seed (Random toggle default on, else numeric input "Enter fixed seed"), Thinking toggle (default off, disabled when LoRA loaded), Shift 1-5 step .1 default 3.0, "Expert Controls": LM Parameters collapsible (Temperature 0-2 default .8, CFG 1-3 default 2.2, Top-K 0-100 default 0, Top-P 0-1 default .92, Negative prompt default "NO USER INPUT"), Transform (audio codes textarea, task type text2music / cover / repaint, cover strength, repainting start/end, instruction default "Fill the audio semantic mask based on the given conditions:"), Guidance (CFG interval start 0 / end 1, custom timesteps, score scale .5, LM batch chunk 8, track name, complete-track classes), checkboxes: ADG, allow LM batch (default on), CoT metas/caption/language (default on), autogen, constrained-decoding debug, format caption, get scores, get LRC lyrics (2398-2434). Max duration with/without LM 240 (state, ~line 215).
- Sliders: shared `EditableSlider` (components/EditableSlider.tsx): label left, value chip right; click chip to type (number input, pink border, Enter commits, Esc reverts, blur clamps to min/max, NaN reverts, 38-50); `h-2 rounded-lg accent-pink-500`; optional help text; value shown as "Auto" when equal to min unless `formatDisplay` given.

Reference-audio modal (2440-2740): title/description change by target (Reference vs Cover); "Upload Audio" dashed button (mp3, wav, flac, m4a, mp4) with spinner states "Uploading audio..." and "Transcribing..." plus "Transcribing with Whisper" and Cancel (AbortController); tabs `Uploaded | Created`; track rows with play/seek mini-player and "Use Track" button; empty states "No tracks yet / Upload audio files as references", "No created songs yet / Generate songs to reuse"; loading "Loading tracks..." with spinner.

Footer (sticky): `sticky bottom-0 bg-zinc-50/95 backdrop-blur-sm border-t`, full-width Create button (see 1.2). Label: "Generating..." / "Create" / "Create (N variations)" / "Create N jobs (M variations)". Disabled while generating or not authenticated (2773-2785).

Errors: upload errors via `uploadError` state (e.g. "Please sign in to upload audio.", 768); AI Format failure uses native `alert()` (726, 730); random-description failure only `console.error`.

### 4.4 Create view: middle column `SongList` (SongList.tsx)
- Header: fake breadcrumb "Workspaces > My Workspace" (hard-coded English, 222-226), search input (placeholder "Search your songs...", Search icon, `rounded-lg`, bg `#121214`), Filters button with active count "(n)" (pill turns inverted white/black when open or active), Select toggle button.
- Filters menu (`w-56`): header "Refine by", checkboxes Liked (ThumbsUp), Public (Globe), Private (Lock), Generating (Loader2); check is 16px pink square.
- Selection mode bar: "N selected", "Select all"/"Clear all", red outlined "Delete" (disabled when none). Rows gain a 20px checkbox; generating rows' checkbox is `opacity-40 cursor-not-allowed`. Hard-coded English strings ("Select", "Select all", "Delete").
- Empty/filtered-empty: dashed 256px box, Filter icon in 64px disc, "No songs match your filters", pink "Clear filters" link (343-356). No other empty state for zero songs.
- Row (`SongItem`, ~470-831): `group flex gap-4 p-2 rounded-lg border`, hover `dark:bg-[#18181b]`, selected `bg-zinc-100`; 64px square cover (AlbumCover seeded generative gradient fallback, or image); hover overlay play/pause circle 40px white (always visible when current); title (bold lg, pink when current; click to rename for owner; inline input with Enter save, Esc cancel, 506-508), version badge pill (gradient pink-purple `text-[9px]`, title shows DiT model), Lock icon if private, creator avatar chip (16px purple circle initial) + name (click to profile), style text `line-clamp-2`, mono timestamp right. Action row (hidden while generating): like (count, pink bubble when liked), Share, Create Video, Add to Playlist (ml-auto), Song Details (`xl:hidden`), kebab menu.
- Generating state: cover `opacity-20 blur-sm` + `bg-black/40` overlay with 4 EQ bars; queued state shows amber Clock disc + "Queue #N"; title text "Creating..." or "Queued..."; right side "#N" amber or "Creating..." pink; progress bar `h-1 rounded-full` gradient pink->purple, `opacity-40` when progress unknown, accepts 0-1 or 0-100 (SongList.tsx ~700-715). Job polling every 2000 ms (App.tsx:742); failure toast "Generation failed. Please try again."; timeout toast "Generation timed out".
- Upload rows (`UploadItem`) appear for reference uploads (style "Upload") with Use as reference / Cover actions.

### 4.5 Song kebab menu (SongDropdownMenu.tsx)
Width `w-52 bg-zinc-900 rounded-xl shadow-2xl border border-white/10 py-1.5 z-50`; opens up or down. Items in order: Create Video, Edit Audio (opens `/editor`), Extract Stems (opens `/demucs-web/`), Reuse Prompt (owner), Use as Reference, Cover Song, Add to Playlist, Download, Share, Delete Song (red, owner only). Download builds an `<a download>` (line ~145).

### 4.6 Right sidebar / Song details (RightSidebar.tsx)
- Empty: "Select a song to view". Header "Song Details" with close X. Cover, title (owner can rename inline, Save/Cancel, "Saving...", error text), creator, "Created <date>", action icon row: Create Video, Open in Editor, Reuse Prompt, Extract Stems, Download, kebab.
- Sections: tags/style with "Copy" (becomes "Copied") and "+N more" expander; Lyrics with Copy. Width 360px on xl; slide-over on smaller.

### 4.7 Library (LibraryView.tsx)
- Title "Your Library" and "+ New Playlist" button. Tabs (text with 2px green underline): All Songs, Liked Songs, Playlists, Uploads.
- Liked Songs hero: "Playlist" eyebrow, `text-5xl` title, "N songs". Playlists grid with cards (name, description or "By you", song count). Uploads: rows with size via `formatBytes` (B/KB/MB/GB) and a delete icon (title "Delete upload") that raises the confirm dialog "deleteUploadConfirm".

### 4.8 Search (SearchPage.tsx)
- Search input (placeholder `searchSongsPlaceholder`) with right spinner while searching. Sections: Featured Songs / "Songs matching "q"", Featured Creators (110px avatar cards), Featured Playlists (140px cards), Genres (pill list; click searches, hover Copy icon copies tag, green Check on copied). Skeletons with `animate-pulse`; per-section empty text: `No songs found "q"`, `noCreatorsYet`, `noPlaylistsYet`.

### 4.9 Profile pages, Playlist, Song profile
- User profile: back button, banner + avatar (wiggle hover), joined date, supporter badge, stats Songs / Likes / Plays, Edit Profile (own), Featured songs, Songs with Recent | Top tabs, Playlists "See more". Loading "Loading profile..." with spinner; "User not found" + "Go back". Edit-profile modal (also in Settings): username (maxLength 50, errors for min length, taken, update failed), avatar upload (formats text), banner click-to-upload, bio, Cancel / Save Changes ("Saving...", "Uploading avatar...").
- Song profile page: loading "Loading song...", "Song not found", back button, pink EQ bars when playing, "Open in Editor" at SongProfile.tsx:275.
- Playlist detail: back, header, song rows; create/add modals below.

### 4.10 News (NewsPage.tsx)
Header (amber Newspaper tile + "News" + "Updates and announcements"), GitHub star card (`fspecii/ace-step-ui`), cards from `data/news.json` with tag pills colored by `tagColor`, dismiss button; dismissed list under a small uppercase heading; empty "No new updates" with large Newspaper icon. Dismissals in localStorage `ace-dismissed-news`.

### 4.11 Training / LoRA (TrainingPanel.tsx, 1175 lines)
- Title "LoRA Training". Pipeline chip strip: Upload > Edit > Save > Preprocess > Train > Export (green-500/15 when done, `bg-white/5` otherwise; 10px text) (36-43, 650-662).
- Tab bar (active `bg-pink-500/20 text-pink-400 border-pink-500/30`) plus collapsible "Model Configuration" (checkpoint, config, device auto/cuda/mps/xpu/cpu, backend pt/vllm/mlx, LM path, flags: flash attention, CPU offload, DiT offload, compile, quantization; button with Cpu icon and status text).
- Dataset: drag-drop upload with dataset name default `my_lora_dataset`; scan directory; load path default `./datasets/my_lora_dataset.json`; custom tag; genre-ratio slider 0-100; auto-label (skip metas, format lyrics, transcribe, only unlabeled); sample editor with index stepper, caption, genre, key, BPM (120), time signature (list `['', '2','3','4','6','N/A']`), duration, language select (instrumental, en, zh, ja, ko, es, fr, de, pt, ru, unknown), lyrics, Save.
- Preprocess: dataset path, output dir `./datasets/preprocessed_tensors`.
- Train params defaults (143-156): rank 64 (4-256, step 4), alpha 128, dropout 0.1, LR 0.0003, epochs 1000 (1-4000), batch 1 (1-8), grad accumulation 1, save every 200 (50-1000), shift 3.0 (1.0-5.0, 0.5), seed 42, output `./lora_output`, resume checkpoint. Log pane and metrics. Export: path `./lora_output/final_lora`.
- Visual style differs from the rest: uses `bg-white/5 border-white/10` inputs and tiny 10-12px text; status text per action via `*Status` strings (no toasts); `ParamSlider` `accent-pink-500 h-1.5`.

### 4.12 Video Studio (VideoGeneratorModal.tsx, 2414 lines)
- Modal title "Video Studio", subtitle "Create professional visualizers." Opening it pauses playback (App.tsx:1196-1202).
- Preview canvas 1920x1080, `object-contain bg-[#0a0a0a]`; play/pause; export renders offline at 30 fps (lines 482-488), progress "Rendering frames N%" then "Encoding (be patient)..." / "Encoding MP4 N%", ffmpeg.wasm to `<title>.mp4`, audio 128k (852-891).
- Tabs: Presets, Style, Text, FX.
- Presets (10, 83-92): Classic NCS (NCS Circle), Spectrum (Linear Bars), Mirror (Dual Mirror), Shockwave (Center Wave), Orbital, Hex Core (Hexagon), Analog (Oscilloscope), Matrix (Digital Rain), Pulse (Shockwave), Clean (Minimal).
- Style: background Random | Custom | Video (selected `bg-pink-600`); upload image/video, URL "Or paste video URL...", Pexels search modal (API key in localStorage `pexels_api_key`, placeholder "Enter your Pexels API key...", "Search for backgrounds...", Photos/Videos tabs, emerald "Select" pill, attribution "Photos and videos provided by Pexels"); Dimming slider; Color Presets; Custom Colors Primary/Secondary; Particles; Center Image.
- Text: overlay list; default two items: song title (x50 y85 size 52, `#ffffff`, Inter) and style uppercased (x50 y92 size 24, `#3b82f6`); fields "Text content", X Position, Y Position, Size, Color.
- FX (13 toggles, each with description, and an Intensity slider when on): Bass Shake, Digital Glitch, VHS Tape, CCTV Mode, Scanlines, Aberration (RGB split), Bloom, Film Grain, Pixelate, Strobe, Vignette, Hue Shift, Letterbox (2088-2100).
- Close X top right `bg-black/50 rounded-full`.

### 4.13 Settings modal (SettingsModal.tsx)
Title "Settings". Profile block (avatar, name, member since, Edit Profile, View Profile). Sections: Account (username), Language (select English / Chinese / Japanese / Korean; info popover "Localized by"), Appearance (Light / Dark buttons), About (Version 2.0.0, "ACE-Step UI - Local AI Music Generator", powered by, creator credit, follow link). Footer "Done" button. Translations in `i18n/translations.ts` (en, zh, ja, ko).

### 4.14 Share modal (ShareModal.tsx)
`max-w-sm` card, "Share Song", icon buttons with titles: X, Facebook, WhatsApp, Telegram, Reddit, LinkedIn, Email (mailto with subject/body templates), and "Copy" link (label flips to "Copied" for a moment; falls back to a hidden textarea + `execCommand` when `navigator.clipboard` fails, line 119).

### 4.15 Playlist modals (PlaylistModals.tsx)
Create Playlist (Name, Description, Cancel / Create). Add to Playlist: list with song counts, top row "Create new playlist", empty "no existing playlists" message.

## 5. Bottom Player (Player.tsx)
Desktop controls (left to right):
- Left: 40/48px cover (AlbumCover fallback), title (click navigates to song page, underline on hover), creator.
- Center: shuffle, previous, play/pause (36-40px round, white in dark), next, repeat (cycle none > all > one; a 4px dot under the icon marks active; no "1" glyph shown for repeat-one; App.tsx:1471-1472).
- Right: time `cur / total` (md+), speed pill (lg+) menu `0.25, 0.5, 0.75, 1.0 ("Normal"), 1.25, 1.5, 1.75, 2.0` with current in pink-bold (Player.tsx:529-545, 738-753), volume icon with hover popover containing a rotated vertical range `w-24 h-8 -rotate-90` and percent readout, Download, Maximize2, kebab (SongDropdownMenu opening upward).
- Top edge: clickable progress bar `h-1 lg:h-1.5` (zinc-200 / zinc-800), fill white/zinc-900 turning pink on hover with a 12px thumb that appears on hover.
- Empty: "Select a song to play" with placeholder 40-48px tile, in a 80/96px bar. Clicking it (cursor-pointer) calls `onPlayFirst`.
- Audio element: one `<audio>` in App; `timeupdate`, `loadedmetadata`, `canplay`, `progress`, `ended`, `error` handlers (App.tsx:539-544); errors toast "This song is no longer available." / "Unable to play this song." (App.tsx:531-533). Volume persisted in localStorage `volume`; playbackRate effect (App.tsx:596-600).

## 6. Keyboard shortcuts (main app)
Only these exist in React code:
- `Space`: global play/pause, ignored in INPUT/TEXTAREA/SELECT/contentEditable; if no current song, plays the first playable song (App.tsx:603-621).
- `Esc`: closes Confirm dialog (ConfirmDialog.tsx:29-36), Player fullscreen (Player.tsx:79-90), MobileDrawer (unused), Toast does not close on Esc.
- Inline renames: `Enter` saves, `Esc` cancels (SongList.tsx:506-508); slider value input `Enter`/`Esc` (EditableSlider.tsx:50-57); Pexels search `Enter` (VideoGeneratorModal.tsx:2321).
No arrow-key seek, no `/` focus-search, no shortcut help screen. MobileDrawer implements focus trap and focus return (MobileDrawer.tsx:26-83), but is unused.

## 7. Empty, loading, error states and feedback (summary)
- Toast (components/Toast.tsx): single instance, top-center `fixed top-6 left-1/2 -translate-x-1/2 z-[100]`, `rounded-full px-6 py-4 bg-zinc-900 border (green|red|blue)-500/50 text-white shadow-2xl`, 20px CheckCircle/AlertCircle icon (info reuses AlertCircle in blue), `text-sm font-medium` message, X to close, auto-dismiss default 3000 ms (21-30). Only one toast at a time (App.tsx:144-150). Types success / error / info. Messages used: songDeleted, songsDeletedSuccess, songsDeletedPartial "{succeeded} of {total}", failedToDeleteSong, playlistCreated, failedToCreatePlaylist, songAddedToPlaylist, failedToAddSong, generationFailed, generationTimedOut, songNotAvailable, unableToPlay.
- Confirm dialog (components/ConfirmDialog.tsx): centered, `max-w-sm mx-4 rounded-2xl p-6`, backdrop `bg-black/60 backdrop-blur-sm` click or Esc = cancel; red 40px disc with AlertTriangle when `danger` (default true); title `text-base font-semibold`; message `text-sm text-zinc-500 leading-relaxed`; buttons right-aligned: Cancel (zinc-100/zinc-800) and confirm (red-600, default label "Delete"; non-danger blue-600). Used for single delete ("Are you sure you want to delete "{title}"? This action cannot be undone."), bulk delete (`deleteSongsConfirm` with {count}), and reference-upload delete (App.tsx:1033-1110).
- Native `alert()` still used for AI Format failures and profile update failure (CreatePanel.tsx:726,730; UserProfile.tsx:150).
- Loading: spinners (Loader2 / border spinner), skeleton cards in Search, "Loading ..." text on pages, disabled buttons with spinner icon replacement (Sparkles to Loader2 in AI Format).
- Empty: Player placeholder, Right sidebar placeholder, filtered-empty list, library/news/search empties with icons and dashed borders.
- Offline backend: model chip falls back to fixed list; no global "backend unreachable" banner was found.

## 8. Embedded AudioMass editor (server/audio-editor, mirrored at audiomass-editor/src)
Load: `/editor?audioUrl=<encoded>` from the main app; patch loads via `engine.LoadURL(audioUrl)` after a 500 ms timeout (audiomass-url-patch.js:4-11; also in app.js). Express serves with relaxed CSP (server/src/index.ts:84-88). `server/audio-editor` and `audiomass-editor/src` differ only in `engine.js` and `main.css` (restyled to Suno dark; engine tweaked: wave color, progress color, height).

### 8.1 Theme (server/audio-editor/main.css)
- Dark zinc re-skin ("SunoAce black", main.css:27): body `#09090b`, header bar `#18181b` 40px with `#27272a` border (47-55), toolbar 56px `#09090b` (122-134), menu panel `#18181b`, 6px radius, shadow `0 10px 15px -3px rgba(0,0,0,.5)` (86-101), hover `#27272a`, active menu row `#4f46e5` (indigo-600), shortcut hints `#52525b` (136-148).
- Base font `Helvetica, Arial, sans-serif` 13px, text `#eee`. Icon font `icomoon` (icon-play3, icon-stop2, etc.).
- Waveform: wavesurfer `waveColor: '#99c2c6'` (dist/wavesurfer.js:3731), progress `rgba(79, 70, 229, 0.4)` (engine.js:15), selection region `rgba(30, 30, 162, 0.51)` default (regions plugin:148), `splitChannels: true`, `autoCenter: true`, canvas height `innerHeight - 168` (engine.js:6-21). Other literal colors: `#519fa7`, `#47497d`, `#a855f7`, `#ef4444` (peak/clip), `#3f3f46`.
- Mismatch with host app: indigo/teal editor palette vs pink app palette; Helvetica vs Inter.

### 8.2 Layout
Top header menu bar (File, Edit, Effects, View, Help) > toolbar (transport, edit actions, selection readout, timer) > waveform stage with timeline markers, horizontal "wavescroll" mini-map under it > footer dock `pk_dck` with L/R panner buttons, volume gauges `pk_volpar` with peak markers, zoom buttons (ui.js:1671-1860). Empty state text: "Drag n drop an Audio File in this window, or click here to use a sample" (ui.js:2077). Loading overlay: "Please Wait..." + 200x2px indigo indeterminate bar (`pk_loader_anim`) + percent + "cancel" button (ui.js:2084-2100, main.css:187-215, 1451-1465).

### 8.3 Menus (ui.js)
- Mouse and keyboard navigable: Left/Right arrows move across top menus, Up/Down move through items (wrap-around), Enter activates, Esc closes (ui.js:1472-1545). `~` (backtick, keycode 96) opens/closes the menu bar (engine.js:545-558).
- File (128): Export / Download; Load from Computer; Load Sample File; Load From URL; New Recording; Save Draft Locally; Open Local Drafts (IndexedDB drafts list with name etc.).
- Edit (866): Undo (Shft+Z), Redo (Shft+Y), Play (Space), Stop, Select All (Shft+A), Deselect All (~), Channel Info/Flip.
- Effects (958): Gain, Fade In, Fade Out, Noise Reduction (Voice) [RNNoise wasm], Paragraphic EQ, Compressor, Normalize, Graphic EQ, Graphic EQ (20 bands), Hard Limiter, Delay, Distortion, Reverb, Speed Up / Slow Down (pitch), Playback Rate, Reverse, Invert, Remove Silence.
- View (1091): Follow Cursor (toggle check), Peak Separators (toggle), Timeline (toggle), ---, Frequency Analyser, Spectrum Analyser, Tempo Tools, ID3 Tags, ---, Center to Cursor [Tab], Reset Zoom [0].
- Help (1224): Store Offline Version, About, See Welcome Message, SourceCode on Github.

### 8.4 Toolbar (ui.js:2108-2900)
Transport (tooltips are the spans): Stop (Space), Play (Space), Pause (Shift+Space), Toggle Loop (L), Seek back (left arrow; hold repeats with acceleration), Seek forward (right arrow), Record (R; `pk_act` while recording). Edit: Copy Selection (Shift+C), Paste (Shift+V), Cut (Shift+X), Insert Silence (Shift+N), Clear Selection (Q) (small screens render the label "clear"). Selection readout panel "Selection: Start / End / Duration" in seconds to 3 decimals (ui.js ~2890-2930). Timing display: big mono clock `pk_timing`, total duration top-right and hover time (main.css `.pk_total_dur`, `.pk_hover_dur`, 12px mono `#a1a1aa`).
Button states: `pk_inact` greys out copy/paste/cut/clear until a selection or clipboard exists.

### 8.5 Footer controls
- Panner: "L ON/OFF" and "R ON/OFF" channel mute buttons (ui.js:1726-1765).
- Zoom: `+` zoom in horizontally (key `=`/187), `-` zoom out (key `-`/189), `[R]` reset (key 0), vertical zoom up/down arrows (titles "Zoom In Vertically", "Zoom Out Vertically"); hidden on screens `max-height: 438px` (main.css:1473-1478). Drag-able mini-map `pk_wavescroll` with left/right drag handles for the visible window.
- Level meters: two bars with peak-hold ticks (`pk_peaker`, `pk_act` on clip), title "Peak at <time>".

### 8.6 Selection and mouse
- Click-drag on the waveform creates a region (wavesurfer regions with `dragSelection slop 5`, engine.js:19-24); drag handles resize; click seeks; right-click context menu (ui.js:2616-2644): Select Visible View, Reset Zoom, Set Volume/Gain, Copy, Paste, Cut, Insert Silence (Copy/Cut/Paste greyed when unavailable). Browser context menu is suppressed globally (keys.js:82-84).
- Drag-and-drop an audio file anywhere to load (drag.js overlay). Loading from URL/sample via File menu.

### 8.7 Keyboard shortcuts (all via keyCode, keys.js; engine.js:533-640, ui.js)
Note: AudioMass uses Shift, not Ctrl/Cmd, as the modifier (welcome tip, welcome.js:11).
| Keys | Action |
|---|---|
| Space | Play / stop (engine.js:581) |
| Shift+Space | Pause / resume (577) |
| L (keypress 108) | Toggle loop (626) |
| Left / Right | Seek, speed ramps with key repeat; step = max(duration/200, .05)/zoom, multiplier up to 6x (ui.js:2328-2385) |
| Shift+Left / Shift+Right | Seek variants (ui.js:2386, 2414) |
| Up / Down | prevented from scrolling (engine.js:533-538) |
| Shift+A | Select all (622) |
| Q | Deselect (560) |
| `~` / backtick | Open or close top menu (545) |
| Shift+C / Shift+X / Shift+V | Copy / Cut / Paste (592-612) |
| Backspace | Delete selection (cut without copying) (617) |
| Shift+Z / Shift+Y | Undo / Redo (597-602) |
| Shift+S | Open Export dialog (632) |
| Shift+N | Insert silence (ui.js:2876) |
| R | Record (ui.js:2490) |
| Tab | Center view on cursor (ui.js:2502) |
| 0 / - / = | Reset zoom / zoom out / zoom in (ui.js:1800-1811) |
| Esc | Close modal or menu |
| F12 | blocked (engine.js:567) |
Shortcuts are suppressed while a modal is open (`InteractionHandler.on`).

### 8.8 Effect dialogs (ui-fx.js; shared `PKAudioFXModal`)
Dialogs have title, body rows (`pk_row`) with `label` + range `pk_horiz` + value span `pk_val`, Preview and Apply buttons (`pk_modal_a_accpt`), optional presets and saved custom presets (`custom_presets`). Esc closes. Defaults:
- Gain (title "Apply Gain to selected range"): "Gain percentage", 0 to 2.5 step .01, default 1.0 (shown 100%).
- Compressor: Threshold -100..0 (-24), Knee 0..40 (30), Ratio 1..20 (12), Attack 0..1 (.003), Release 0..1 (.25).
- Delay: Delay Time 0..6 s (.28), Feedback 0..1 (.5), Wet 0..1 (.4).
- Distortion: Gain 0..2 (.5).
- Reverb: Time 0..3 (.3), Decay 0..3 (.05), Wet 0..1 (.6).
- Normalize: "Normalize L/R Equally" checkbox + "Normalize to" percent (default 100%).
- Hard Limiter: enable checkbox, "Limit to" (99%), "Ratio between lows and highs" (0%).
- Speed (Change Speed): presets "A lot slower" 0.65, "Slightly slower" 0.85, "Slightly faster" 1.15, "Blazing Fast" 1.4; button "Apply Rate". Playback Rate is a separate non-destructive variant.
- Insert Silence: radio "Insert silence at current cursor (<time>)" or at selection, slider 0..30 s step .01 default 5 s.
- Channel Info/Flip, Graphic EQ (10 band) / Graphic EQ 20 bands (ui-fx.js:907), Paragraphic EQ (fx-pg-eq.js:1134, canvas based with draggable nodes), Tempo & Rhythm Tools (fx-pg-eq.js:2441, includes tap tempo key handler `tmpTap` at 2154), New Recording (fx-pg-eq.js:2570, mic recorder), ID3 Metatags Explorer (ui-fx.js:1373, Delete / Update).
- Effects preview in realtime (`RequestActionFX_PREVIEW_*`).

### 8.9 Export dialog (ui.js:131-300)
Title "Export / Download". Fields: File Name (default `audiomass-output.mp3`, placeholder "mp3 filename"), Format radios mp3 | wav (44100 Hz) | flac, MP3 bitrate radios 128 (default) / 192 / ... kbps, FLAC compression slider (default 5, `pk_val`), Channels Mono (default) | Stereo (forced stereo for some formats), scope "Export whole file" | "Export Selection Only" (disabled if no selection). Button "Export". Triggers `engine.DownloadFile(name, format, kbps, selection, stereo)`. Enter and Esc handled by `modalTemp`/`modalTempEnter`.

### 8.10 Feedback in editor
- `OneUp(text, ms)` toast: centered fixed box `rgba(0,0,0,.66)`, `#eee` text 16px, 1px `#333` border, 3px radius, fades and floats up 20px (oneup.js; main.css:904-918). Examples: "Canceled Loading" (1350 ms).
- Welcome modal "Welcome to AudioMass": random 4% display after first visit (`localStorage k`, welcome.js:61-68); tip text says shortcuts are Shift+key; mobile tip about iOS silent switch with image; OK button; Esc closes.
- Fatal errors use `PKSimpleModal` dialogs with Esc handler (`modalTempErr`).
- Mobile (`PKAE.isMobile` UA sniff, app.js:95): toolbar becomes horizontally scrollable (`.pk_tbc {overflow-x:scroll}`) at <=779px; selection readout hidden; header padded; time display 24px. Breakpoints in main.css: 1250 px (compact toolbar 24px buttons, alternate markers hidden), 864 px (selection titles hidden, "clear" text), 779 px (mobile layout), 400 px. Fixed `min-width:560px` toolbar below those still causes scroll. Viewport meta locks zoom (`user-scalable=no`).
- Service worker registration is commented out (index.html:63-69).

## 9. Stem extraction page (server/public/demucs-web/index.html)
Standalone page "Extract Stems - ACE-Step UI": header "Stem Extraction" + backend badge ("Detecting..." then a backend name, not verified), drop zone (music-note icon, "or click to select"), file name line, "Extract Stems" button (disabled until file chosen), progress bar, status line ("Select an audio file to begin"), stats row Elapsed / Segment / Speed / ETA, detail log, results card with per-stem tracks and "download all". Has `--zinc-*` CSS variables of its own; opened with `?audioUrl=` to prefill.

## 10. Notable UX gaps / inconsistencies (for adoption decisions)
1. Two palettes: editor and stems page do not share the app's tokens (indigo/teal vs pink; Helvetica vs Inter).
2. Editor is outside the SPA (new tab); returning to the app loses nothing but there is no "save back to library".
3. MobileDrawer and `ResponsiveContext.isDesktop` are mostly unused; most responsive work is raw Tailwind breakpoints.
4. Hard-coded English in places that otherwise use `t()` (Select, Delete, Workspaces, Library "All Songs"/"Uploads", Queue #, Creating...).
5. `animate-in` / `custom-scrollbar` / `wiggle` classes are used but not defined in the CDN config shown; verify `/index.css` or plugin in real run.
6. Single toast slot; native `alert()` in a few failure paths; no global backend-offline banner.
7. Shortcuts: only Space globally; none for next/prev, seek, mute.
8. Tooltips (`title=`) are the only affordance labels on icon buttons in lists; some are English literals ("Share", "Create Video", "Add to Playlist", "Song Details", "Rename song").
