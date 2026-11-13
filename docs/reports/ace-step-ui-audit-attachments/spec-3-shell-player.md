# ace-step-ui: app shell, player, phone layout (rebuild-level spec)

Repo root: `/private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai-home/51ec3e7f-849d-471f-a90c-b28549377b45/scratchpad/ace/repo`. Cites are `file:line`. Read-only static read; nothing run. Source is Tailwind Play CDN classes; px values are Tailwind defaults (1 unit = 4px) resolved below. Complements `../audit-b-ui.md`.

## 0. Roles (colour by role; hex is dark / light)

| Role | Dark | Light | Source |
|---|---|---|---|
| Page surface | `#09090b` (`suno`) | white | App.tsx:1391, index.html:31 |
| Rail surface | `#000000` (`suno-sidebar`) | white | Sidebar.tsx:45 |
| Panel surface (create col, details, video controls, training) | `#121214` (`suno-panel`) | `zinc-50` `#fafafa` | App.tsx:1309 |
| Card / input surface | `#18181b` (`suno-card`), also `bg-black/20`, `bg-white/[0.02]` | `zinc-100` | index.html:34 |
| Player bar | `black/95` + `backdrop-blur` | white | Player.tsx:640 |
| Border (hairline) | `white/5` panels, `white/10` player + modals | `zinc-200` `#e4e4e7` | |
| Hover fill | `white/5` (rows), `white/10` (active nav, icon buttons) | `zinc-100` | Sidebar.tsx:215 |
| Primary text | white | `zinc-900` | |
| Muted text | `zinc-400` `#a1a1aa` (artist, times), `zinc-500` (labels, inactive icons) | `zinc-500` | |
| Accent | pink-500 `#ec4899` (active states, progress hover, slider thumbs, nav bar); pink-600 `#db2777` (light-mode pink, selected chips) | | |
| Brand gradient | `from-pink-500 to-purple-600` (logo disc, avatar) | | Sidebar.tsx:53 |
| Primary action (play) | white disc / black glyph | `zinc-900` disc / white glyph | Player.tsx:702 |
| Secondary accent | emerald-600 (Pexels), blue-500/20 (encoding, init service), amber (queue) | | |
| Danger | red-500 text, red-500/10 hover fill | | Sidebar.tsx:168 |
| Selection | `selection:bg-pink-500/30` | | App.tsx:1391 |
| Theme colour meta | `#ec4899` | | index.html:16 |

Font: Inter 400/500/600/700 (Google Fonts import, index.html:62), `antialiased`. Mono for times/values (`font-mono`, system mono).
Icons: lucide-react 0.563, stroke default 2. Body: `overflow-hidden`, `transition-colors duration-300` (index.html:262).

---

## 1. Shell (App.tsx)

### 1.1 Structure (App.tsx:1390-1524)
```
<div h-screen flex-col  bg #09090b>                       (1391)
  <div flex-1 flex overflow-hidden>                       (1392)
    <Sidebar/>    fixed on phone, relative md+            (1393)
    <main flex-1 flex overflow-hidden relative>           (1419)
      {renderContent()}   one of the views
  </div>
  <Player/>       bottom bar, in flow (not fixed)         (1424)
  ...modals/portals at root level (z 60..100)
</div>
```
`h-screen` = 100vh (not dvh: on iOS Safari the bar may sit under browser chrome; no `viewport-fit=cover`, index.html:5).

### 1.2 Routing (no router lib; App.tsx:249-298, 1395-1408)
- `currentView` string in state: create | library | search | profile | playlist | song | training | news.
- Paths: `/` or `/create` -> create; `/library`; `/search`; `/news`; `/@username` -> profile; `/song/<id>`; `/playlist/<id>`; `?song=<id>` is rewritten with `replaceState` to `/song/<id>`. Training has no path (view only, URL stays).
- Sidebar nav uses `history.pushState`; `popstate` re-runs the same parser (back/forward work). Navigating to Create resets `mobileShowList=false`. On phone, any nav collapses the rail (`if (isMobile) setShowLeftSidebar(false)`, :1407).
- Quirk: nav to `training` pushes no URL; `profile/song/playlist` push in their own handlers.

### 1.3 Global state that drives the shell
`showLeftSidebar` default **true** (:80), so on first load a phone sees the expanded 200px rail + dark backdrop until tapped. `showRightSidebar` default true (:79). `volume` from localStorage `volume`, default 0.8 (:69). `playbackRate` 1.0, `isShuffle` false, `repeatMode` default **'all'** (:75). `theme` localStorage else prefers-color-scheme (:43-47).

### 1.4 Keyboard shortcuts (complete list)
| Key | Action | Cite |
|---|---|---|
| Space (not in INPUT/TEXTAREA/SELECT/contentEditable) | toggle play/pause; if no song, play first playable song in list; `preventDefault` | App.tsx:603-623 |
| Esc | close fullscreen player (desktop sheet only; mobile sheet has no Esc handler as written, the effect is global but the mobile branch shares `isFullscreen`, so it also closes) | Player.tsx:80-89 |
| Esc | close MobileDrawer (dead code) | MobileDrawer.tsx:36-44 |
| Enter / Esc | Pexels search submit; inline rename commit/cancel; slider value commit/revert | VideoGeneratorModal.tsx:2321 |
No arrow-key seek, no M for mute, no N/P track keys, no media-session API. Spec for rebuild: add those.

---

## 2. Layouts (ASCII)

### 2.1 Wide desktop (>=1280, xl) with a song selected
```
+----+----------------+---------------------------------------+---------------+
|rail|  CREATE PANEL  |  SONG LIST (flex-1)                   | DETAILS 360   |
|72/ |  360 (lg)      |  header: breadcrumb/search/filters    | cover, title  |
|200 |  scroll        |  rows: 64px cover, title, style,      | actions row   |
|    |  sticky Create |  actions, progress when generating    | tags, lyrics  |
|    |  button footer |                                       |               |
+----+----------------+---------------------------------------+---------------+
| PLAYER h-96 (lg) : [cover+title+heart] [shuffle prev PLAY next repeat] [time speed vol dl full more]
+--------------------------------------------------------------------------+
```
Widths: rail 200 expanded / 72 collapsed (Sidebar.tsx:47); create `md:w-[320px] lg:w-[360px]` (App.tsx:1309); details `w-[360px]` shown `hidden xl:block` (:1356); list takes the rest (`flex-1`).

### 2.2 Tablet (768-1279)
```
+----+---------------+------------------------------+
|rail| CREATE 320    |  SONG LIST (flex-1)          |   details = slide-over from right
|    | (360 at lg)   |  each row has Info button    |   (max-w-md, z-60) opened by Info
+----+---------------+------------------------------+
| PLAYER h-80 (md) / h-96 (lg)                      |
+---------------------------------------------------+
```
Info button visible `xl:hidden` on rows. Details third column absent. Player at md hides: heart (<sm), shuffle/repeat (<sm), speed (<lg), download (<lg), kebab (<sm). Volume + time appear at md.

### 2.3 Phone (<768, isMobile)
```
default (rail expanded, first load)      create view                   list view
+---+------------------+                 +----+------------+           +----+------------+
|200|   dark backdrop  |                 |72  | [View List]|           |72  |[Create Song]|
|rail overlays content |                 |rail| CREATE     |           |rail| SONG LIST   |
+---+------------------+                 |over| PANEL full |           |    |             |
                                         |lay | width      |           +----+------------+
+--------------------------------+       +----+------------+
| mini player (no fixed pos, in flow, bottom)               |
|  [=== 4px progress strip =======]                         |
|  [44 cover] title/artist ........ [heart][prev][PLAY 44][next]
+-----------------------------------------------------------+
tap cover/title -> full-screen Now Playing sheet
```
Details of the phone shell:
- Rail is `fixed left-0 top-0 z-50` (Sidebar.tsx:46). Because it is out of flow, on phone the main area starts at x=0 and the 72px collapsed rail **covers the left 72px of the Create panel/content**. There is no hamburger, no bottom nav: the rail's own chevron toggles it. Rebuild should fix this (bottom tab bar or hamburger), but this is the shipped look.
- Expanded rail on phone adds full-screen `bg-black/60 backdrop-blur-sm z-40 md:hidden` backdrop; tap = collapse (Sidebar.tsx:36-41).
- Floating toggle pill, `md:hidden absolute top-4 right-4 z-50`: `bg-zinc-800 text-white px-4 py-2 (16/8px) rounded-full shadow-lg border border-white/10 text-sm(14px) font-bold gap-2`, label `Create Song` / `View List` + List icon 16px (App.tsx:1376-1384). Create panel `pt-14 md:pt-4` clears it.
- Create panel: `w-full` when `!mobileShowList`, else `hidden md:block` (App.tsx:1308). Song list: `hidden md:flex` unless `mobileShowList` (:1323). Mutually exclusive on phone.

---

## 3. Sidebar / icon rail (Sidebar.tsx)

Container (45-48): `flex flex-col h-full border-r py-4 (16px) overflow-y-auto scrollbar-hide transition-all duration-300`, `bg-white / #000`, border `zinc-200 / white/5`. Width `200px` open, `72px` closed. Default open. Easing: Tailwind `transition-all` default = 150ms cubic-bezier(.4,0,.2,1) overridden by `duration-300` => **300ms**, same curve. Labels mount/unmount instantly (conditional render, no fade), so text pops during the width tween.

Header (50-83): `px-3 mb-8 (32px)` row, space-between.
- Logo disc `w-10 h-10 (40px) rounded-full bg-gradient pink-500->purple-600 shadow-lg`, 20px white stacked-layers SVG (3 chevron paths, stroke 2). `hover:scale-105`. Click = go Create. title "ACE-Step UI".
- Wordmark (open only): "ACE Step", `text-lg (18px) font-bold`, `gap-3` from disc.
- Collapse chevron `w-8 h-8 (32px) rounded-lg`, 16px svg chevron-left (open) / chevron-right (closed), `text-zinc-500` -> black/white hover, hover fill zinc-100 / white/10. Collapsed rail: disc + chevron row is 72-24=48px of room; disc 40 + chevron 32 overflows, so the header wraps visually (chevron sits beside/under); rebuild should stack.

Nav (85-120): `flex-1 flex flex-col gap-2 (8px) px-3`. Items in order, icon 20px:
1. Create (Disc) 2. Library (Library) 3. Search (Search) 4. Training (GraduationCap) 5. News (Newspaper).
NavItem (209-224): `w-full rounded-xl (12px) flex items-center gap-3 (12px) relative overflow-hidden transition-all duration-200`.
- Open: `px-3 py-2.5` (12/10px) => height 20+20=40px, label `text-sm (14px) font-medium`.
- Closed: `aspect-square justify-center` => 48x48 (72 - 2x12 padding).
- Inactive: `text-zinc-500`, hover `text-black/white` + `bg-zinc-100 / white/5`.
- Active: `bg-zinc-100 / white/10`, text black/white, plus **left accent bar** `absolute left-0 top-1/2 -translate-y-1/2 h-8 (32px) w-1 (4px) bg-pink-500 rounded-r-full`.
- Tooltip: native `title` = label (no custom tooltip).

Bottom group `mt-auto flex flex-col gap-2` (122-194), same item geometry:
- Theme toggle: Sun (when dark) / Moon (when light), label "Light Mode"/"Dark Mode".
- Signed in: avatar button (24px gradient circle, `border border-white/20`, initial `text-xs font-bold` or image; label = username truncated; title "user - Settings" opens SettingsModal) then Sign Out (LogOut icon, hover red-500 text, red-500/10 fill).
- Signed out: Sign In (LogIn icon, hover pink-500).
No keyboard shortcuts, no focus-ring styling beyond browser default, no `aria-current`.

---

## 4. Player (Player.tsx, 844 lines)

Props: song, isPlaying, time, duration, volume, rate, shuffle, repeat('none'|'all'|'one'), liked, plus callbacks (Player.tsx:11-37). Audio element lives in App (`new Audio()`, crossOrigin anonymous, App.tsx:491-555); Player is presentational. Seek click -> `handleSeek` queues `pendingSeekRef` if audio not seekable yet (App.tsx:966-975).

### 4.1 Empty state (103-116)
Same bar height, centered button: 40px (48 at lg) rounded `zinc-200/800` tile with Play 20px + text "Select a song to play" (`text-sm font-medium`, `zinc-400 / zinc-600`, hover one step lighter). Click => `onPlayFirst` (play first playable song). Space does the same.

### 4.2 Desktop bar (>=768), 639-836
```
|== progress (h-1 / lg:h-1.5), full width, click to seek ====================|
| [cover 40/48][title / artist][heart]   [shuf][prev][ PLAY ][next][rep]   [0:42 / 3:10][1x][vol][dl][full][more] |
```
- Bar: `h-20 (80px) lg:h-24 (96px)` incl. progress; `border-t`, `shadow-[0_-4px_6px_-1px_rgba(0,0,0,.1)]` light only; `z-50`; `transition-colors 300ms`.
- Progress rail `h-1 lg:h-1.5` (4/6px), track `zinc-200 / zinc-800`, fill `zinc-900 / white` -> **pink-600 / pink-500 on hover** (`transition-colors`), 12px (w-3) thumb circle at fill end, `opacity-0 -> 100` on hover. Click-only seek (no drag, no scrubbing preview, no buffer indicator). Hit area is only the 4-6px bar plus a 16px invisible `-z-10` strip (ineffective). No tooltip, no waveform anywhere in the player.
- Row `px-2 sm:px-4 lg:px-6 gap-2 sm:gap-4`, three zones: left `flex-1 max-w-[30%] lg:max-w-[33%]`, centre `flex-shrink-0`, right `flex-1 max-w-[30%] lg:max-w-[33%] justify-end`.
- Left: cover `w-10 h-10 (lg 48) rounded (4px) shadow-sm`, `bg zinc-200/800`; `<img>` hides on error, otherwise seeded generative `AlbumCover` gradient. Title `text-xs sm:text-sm font-bold truncate`, hover underline, click -> song page. Artist `text-[10px] sm:text-xs zinc-400` (shows creator or "Unknown Artist"), hover underline (not wired). Heart 18px, `hidden sm:block`, liked = pink-600/500 + filled, `ml-1 sm:ml-2`.
- Centre transport (`gap-2 sm:gap-4 lg:gap-6`): Shuffle 16px (sm+), SkipBack 18->22px filled, **Play/Pause disc `w-9 h-9 sm:w-10 sm:h-10`** white (dark) / zinc-900 (light), glyph 18->20px filled, play glyph `ml-0.5` optical offset, `hover:scale-105 transition-transform shadow-lg`; SkipForward; Repeat 16px (sm+; `Repeat1` icon when 'one'). Active shuffle/repeat = pink-600/500; inactive `zinc-400` -> hover white. Repeat active adds a 4px dot under the icon (`-bottom-1.5`). Shuffle has no dot.
- Right (zinc-500/400): time `text-[10px] sm:text-xs font-mono hidden md:block` "m:ss / m:ss"; speed button (lg+) `px-2 py-1 text-[11px] font-mono font-bold min-w-[42px] rounded` showing `1x`; menu `absolute bottom-full right-0 mb-2 rounded-lg shadow-xl py-1 min-w-[80px] bg-white / zinc-800 border`, rows `px-3 py-1.5 text-xs font-mono`, rates 0.25,0.5,0.75,1.0("Normal"),1.25,1.5,1.75,2.0, selected pink bold; closes on outside mousedown (not Esc); volume (md+): 18px speaker/mute icon button (`p-1.5 lg:p-2 rounded-full`), click = mute/unmute (restore 0.8), **hover opens vertical popover** above (enter immediately, leave closes after **400ms** timer): `bg-white/zinc-800 rounded-lg shadow-xl border p-2`, 32x96px track area, rotated native range `w-24 h-8 -rotate-90`, gradient fill pink-500 `rgb(236 72 153)` over `rgb(228 228 231)`, percent readout `text-[10px] font-mono` below; download (lg+, 18px, `title` "Download audio", fetches blob and saves `<title>.mp3` always, even if file is flac); **fullscreen** Maximize2 16px (all md+); kebab MoreVertical 18px (`hidden sm:block`) opening SongDropdownMenu (position right, direction up).
- No queue button, no lyrics button, no like count, no cast.

### 4.3 Desktop fullscreen "Now Playing" (413-636)
Trigger: Maximize2. Close: ChevronDown (top-left 28px, `p-2 rounded-full` hover fill), Esc, or click anywhere on the backdrop (content stops propagation).
```
+--------------------------------------------------------------+
| [v]                  NOW PLAYING                          [ ] |  px-6 py-4; label text-sm uppercase tracking-wider zinc-500/white50
|                                                              |
|   +----------+     Title (2xl / lg:3xl bold, hover underline) 
|   |  cover   |     Artist (base / lg:lg)                      
|   | 320/400  |     ===o========== (h-2 bar, thumb 16px on hover, pink on hover)
|   +----------+     0:42                       3:10 (mono sm)
|                          [shuf] [<<36] (PLAY 72) [>>36] [rep]
|                          [1x] (lg only)
|                          (vol) ------o---- (max-w-xs)
|                          [heart][video][download][more]
+--------------------------------------------------------------+
```
- Surface: `fixed inset-0 z-50 bg-gradient-to-b from-zinc-100 to-zinc-50 (light) / from-zinc-900 to-black (dark)`. No fade/slide animation: it mounts instantly.
- Layout: `flex-col lg:flex-row items-center gap-8 lg:gap-16 max-w-5xl`; cover `max-w-[320px] lg:max-w-[400px] aspect-square rounded-lg shadow-2xl`.
- Controls: shuffle/repeat 22px, prev/next 36px filled with `hover:scale-110`, Play disc `p-5` (~76px; classes `w-18 h-18` do not exist in Tailwind so size is from padding 20+36+20 = 76px), 36px glyph, `hover:scale-105`. Gaps `gap-8`.
- Seek bar h-2, thumb appears on hover; times `text-sm font-mono`.
- Volume: 22px icon + `h-1.5` track `max-w-xs`, invisible native range overlay, custom thumb 14px.
- Extra actions row `gap-4`, each `p-3 rounded-full` hover fill: Heart 22, Maximize2 20 (opens Video Studio, shown only if `onOpenVideo`), Download 20, kebab 20 (menu opens up, centred).
- No lyrics view, no visualizer, no queue.

### 4.4 Phone mini bar (340-409)
- `flex-col border-t safe-area-inset-bottom` (env() is 0 without viewport-fit=cover), `bg white / black/95 backdrop-blur`.
- Seek strip `h-1 (4px) w-full` track `zinc-200/800`, fill pink-600/500 (always pink, no thumb). Whole 4px strip is the tap target (hard on touch).
- Row `px-3 py-2 gap-3`: left (flex-1, tap = open sheet): cover `w-11 h-11 (44px) rounded shadow-sm` with a ChevronUp 20px overlay shown only on `:active` (`bg-black/20 opacity-0 active:opacity-100`), title `text-sm font-semibold truncate`, artist `text-xs zinc-400`. Right cluster `gap-1`: Heart 20px (`p-2`, 36px hit), SkipBack 22 filled, **Play disc 44px** (`w-11 h-11`, glyph 22 filled), SkipForward 22 filled. No shuffle, repeat, volume, time, speed on the mini bar.
- Total height approx 4 + 8 + 44 + 8 = 64px.

### 4.5 Phone full-screen sheet (156-336)
```
[v]        NOW PLAYING        [spacer 44]
          +--------------+       cover max 280 square, rounded-lg shadow-2xl, px-8
          |    cover     |
          +--------------+
Title (xl bold)                                    [heart 24]
Artist (sm, white/60)
====o=========================  (h-1.5, 16px thumb always visible, white/zinc-900)
0:42                                        3:10   (xs mono)
[shuf22]  [prev32]  (PLAY 64)  [next32]  [rep22]   gap-8
            vertical volume (rotated range w-32, 128px tall)
                 (speaker/mute 20)
        [video 20] [download 20] [more 20]   gap-6, p-3 each
```
- `fixed inset-0 z-50`, gradient surface as desktop, `safe-area-inset-top/bottom`. Header `px-4 py-3`. Play disc `w-16 h-16` (64px), glyph 32 filled, `shadow-lg`. Tap highlight disabled everywhere (`tap-highlight-none`).
- Title tap closes sheet and opens song page. Dropdown anchored `absolute bottom-24 left-1/2 -translate-x-1/2`.
- No swipe-down-to-close, no drag seek (click on bar only; on touch the click fires on tap, not scrub), no speed control on phone.

### 4.6 Loaders / states in the player
- No spinner or buffering indicator while audio loads. Errors surface as toasts (`songNotAvailable` for code 4 / NotSupportedError, `unableToPlay` otherwise) and `isPlaying` resets (App.tsx:527-537, 566-572).
- Previous: if `currentTime > 3` restart track instead of previous (App.tsx:451). Next respects repeat: 'one' restarts, 'none' stops at end of queue, 'all' wraps; shuffle picks random playable (App.tsx:403-435). Skips songs without `audioUrl` or `isGenerating`.
- Persisted: volume only (`localStorage.volume`). Not persisted: rate, shuffle, repeat, queue, position.
- Likes: optimistic toggle (App.tsx:977+).

---

## 5. Responsive model

`ResponsiveContext` (context/ResponsiveContext.tsx): `MOBILE_BREAKPOINT = 768`; `isMobile = innerWidth < 768` at init, then `matchMedia('(max-width: 767px)')` change listener; exposes `{isMobile, isDesktop}`. Provider order: AuthProvider > ResponsiveProvider > App (index.tsx:15-19); I18nProvider wraps inside App.

| Width | Name | What changes |
|---|---|---|
| <640 | phone small (Tailwind `sm` off) | JS isMobile true (<768). Mini player + sheet; rail overlay; one-column Create/List toggle |
| 640-767 | phone large | still isMobile; Tailwind `sm:` classes apply only in non-JS-mobile components (modals, lists) |
| 768-1023 | tablet (`md`) | Rail in flow; create 320 + list; player desktop bar 80px with time + volume + fullscreen; details via Info slide-over |
| 1024-1279 | `lg` | create 360; player 96px, bigger cover/gaps, speed + download appear |
| >=1280 | `xl` | details column 360 appears; Info button hidden |
CSS-only helpers (index.html:120-142): `.mobile-only` (display:block <768), `.desktop-only` (display:none <768), `-flex/-inline/-inline-flex` variants. Safe-area utilities + touch helpers lines 196-247. `--breakpoint-mobile: 768px` var unused.

### 5.1 MobileDrawer (components/MobileDrawer.tsx): DEAD CODE (never imported), but a complete spec
- Portal to body, `fixed inset-0 z-[60]`. Backdrop `bg-black/70 backdrop-blur-mobile (8px)`; click backdrop closes.
- Panel `fixed top-0 left-0|right-0 h-full w-80 (320px) max-w-[85vw] bg-zinc-900 shadow-2xl`, 1px `border-white/10` on the inner edge, safe-area insets, `flex-col`.
- Header `p-4 border-b border-white/10`: optional title `text-lg font-semibold white`, close X 20px in `p-2 rounded-lg hover:bg-white/10`.
- Body `flex-1 overflow-y-auto overscroll-contain scroll-touch`.
- Motion: open slide-in 0.3s ease-out forwards (translateX -100%->0 or 100%->0) + backdrop fade-in 0.3s ease-out; close slide-out 0.3s ease-in + fade-out 0.3s, unmount after 300ms timeout (lines 18-24, 93-97; keyframes index.html:144-185).
- A11y: `role=dialog aria-modal`, focus moves into drawer, focus trap on Tab/Shift+Tab, focus restored on close, Esc closes, `body overflow:hidden` while open.
Worth adopting as the phone nav/details drawer in a rebuild.

### 5.2 Phone details slide-over (App.tsx:1490-1515)
`fixed inset-0 z-[60] flex justify-end xl:hidden`; backdrop `bg-black/60 backdrop-blur-sm animate-in fade-in`; panel `w-full max-w-md h-full bg zinc-50/#121214 shadow-2xl border-l border-white/10 animate-in slide-in-from-right duration-300` (tailwindcss-animate names; plugin not configured under the CDN so animation may not run).

### 5.3 Global overlays and z-order
sidebar backdrop 40; sidebar + player + toggle pill 50; drawers/modals/details/video/settings 60; Pexels browser 70; drag overlay 90; Toast + ConfirmDialog 100.
Toast (Toast.tsx:34-50): `fixed top-6 left-1/2 -translate-x-1/2 z-100 px-6 py-4 rounded-full shadow-2xl border bg-zinc-900 text-white`, icon 20px (CheckCircle green-500 / AlertCircle red-500 or blue-500), `text-sm font-medium`, X 16px, auto-dismiss 3000ms default, border `green|red|blue-500/50`, `animate-in slide-in-from-top-4 fade-in duration-300`.

---

## 6. Settings modal (SettingsModal.tsx)

Backdrop `fixed inset-0 bg-black/50 z-[60] p-4`, click closes. Card `max-w-2xl (672px) w-full max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl bg white / zinc-900`. No animation. Only renders when signed in.
```
+------------------------------------------------------+
| Settings (2xl bold)                              (X) |  p-6, border-b white/5
| +--------------------------------------------------+ |
| | (64 avatar) @name                  [Edit profile][View profile] | rounded-xl p-6 bg zinc-800/50
| |             Member since Month YYYY                | |
| +--------------------------------------------------+ |
| [user] Account      > Username: @name                |  section header: 20px icon + font-semibold; content pl-7
| [globe] Language (i)> [ select en/zh/ja/ko  v ]      |  (i) opens 256px credits popover (X and Bilibili links)
| [palette] Appearance> [ Light ] [ Dark ]             |  2 buttons flex-1 py-3 rounded-lg border-2
| [info] About        > version 2.0.0, credits, [Follow @AmbsdOP][GitHub Repo]
|------------------------------------------------------|
|                                              [ Done ]|  p-6 border-t, button px-6 py-2 rounded-lg
+------------------------------------------------------+
```
- Sections spaced `space-y-8`; content `pl-7 space-y-3`.
- Accent here is **indigo** (not pink): Edit profile `bg-indigo-600 hover:bg-indigo-700`, selected theme `border-indigo-500` with `bg-indigo-50 text-indigo-700` (light) / `bg-indigo-950 text-indigo-300` (dark). View profile `bg zinc-200/zinc-700`. Done `bg zinc-900 / white`.
- Language select: `py-3 px-4 pr-10 rounded-lg border-2 border-zinc-300 / zinc-700`, custom ChevronDown 20px. Changes language immediately.
- Edit profile closes Settings then opens EditProfileModal.
- Inconsistency to fix: indigo vs pink accent; hard-coded English in the About block.

---

## 7. Video Studio modal (VideoGeneratorModal.tsx, 2414 lines)

Opened from Player extras, song rows, kebab, details panel. Preview is a 1920x1080 `<canvas>` drawn each `requestAnimationFrame` (:1044, 1321) with an `AnalyserNode` for audio reactivity; export is offline frame capture then ffmpeg.wasm to MP4 (lazy-loads encoder).

### 7.1 Frame (1701-1745)
- Overlay `fixed inset-0 z-[60] bg-black/90 backdrop-blur-md p-0 md:p-4 animate-in fade-in duration-200`.
- Card `bg-suno-card w-full h-full md:max-w-7xl (1280) md:h-[90vh] md:rounded-2xl md:border border-white/10 shadow-2xl overflow-hidden`; desktop `flex` (controls left, preview right), phone `flex-col`.
- Close: `absolute top-3 right-3 md:top-4 md:right-4 z-50 p-2 bg-black/50 hover:bg-white/20 rounded-full`, X 20/24.
```
DESKTOP                                         PHONE
+-----------+---------------------------+       +---------------------------+
| Studio hd |                           |       | Video Studio (grad hdr)   |
| tabs      |   canvas 16:9 object-     |       | canvas aspect-video       |
| content   |   contain on #0a0a0a      |       |   (PLAY 56 white, bottom) |
| (scroll)  |                           |       +---------------------------+
| footer    |   [  PLAY 64 white  ]     |       | tabs                      |
| Render MP4|   (bottom gradient)       |       | content (scroll)          |
+-----------+---------------------------+       | footer Render (safe area) |
 w-96 (384)         flex-1                      +---------------------------+
```

### 7.2 Controls column (1745-2190)
- Column `w-96 bg-suno-panel border-r border-white/5` (phone: `flex-1`, no border).
- Header (desktop only) `p-6 border-b border-white/5`: Video icon 20px pink-500 + "Video Studio" `text-xl font-bold`, sub "Create professional visualizers." `text-xs zinc-500`.
- Tab bar `flex border-b border-white/5`; four equal tabs `py-3 text-xs font-bold uppercase tracking-wider gap-2`, 14px icon: Presets (Grid), Style (Palette), Text (Type), FX (Zap). Active: white text, `border-b-2 border-pink-500 bg-white/5`; inactive `zinc-500` hover `zinc-300`.
- Content `p-4 md:p-6 space-y-4 md:space-y-6 overflow-y-auto`.

**Presets tab** (1779): grid 2 cols `gap-3`; 10 tiles `p-4 rounded-xl border flex-col gap-2`, icon in `p-2 rounded-full`, label `text-xs font-medium`. Selected: `bg-pink-600/20 border-pink-500 text-white`, icon disc pink-500; idle `bg-black/20 border-white/5 text-zinc-400 hover:bg-white/5`. Tiles: Classic NCS (NCS Circle), Spectrum (Linear Bars), Mirror (Dual Mirror), Shockwave (Center Wave), Orbital, Hex Core (Hexagon), Analog (Oscilloscope), Matrix (Digital Rain), Pulse (Shockwave), Clean (Minimal). Default NCS Circle.

**Style tab** (1797): section labels `text-xs font-bold uppercase zinc-500`.
- Background card `bg-black/20 p-3 rounded-lg border white/5`: 3-up segmented `Random (Wand2) | Image | Video`, `py-2 rounded text-xs font-bold`, active `bg-pink-600 text-white`, idle `bg-zinc-800 text-zinc-400`. Image: Upload (zinc-700) + Pexels (emerald-600) buttons, 80px-tall thumbnail. Video: Upload + Pexels, URL input "Or paste video URL...", green "check Video loaded" line `text-[10px] emerald-400`. Dimming slider 0-1 step 0.1 default 0.6 with percent value; range `h-1 accent-pink-500 bg-zinc-700`.
- Color Presets: 5-col grid of `h-8 rounded-lg` half/half swatches (10 presets: Neon Pink, Cyber Blue, Sunset, Matrix, Fire, Ocean, Violet, Gold, Ice, Mono); selected `border-white scale-110 shadow-lg`, idle `border-transparent hover:border-white/30 hover:scale-105`. Default primary `#ec4899`, secondary `#3b82f6`.
- Custom Colors: two native `<input type=color>` 24px swatches with hex mono text, in `bg-black/20 p-2 rounded border`.
- Particles slider 0-200 step 10 default 50.
- Center Image: 64px rounded preview (custom art else song cover) + Upload / Pexels (`text-[10px]`) + "Reset to default" red-hover text.

**Text tab** (2033): full-width pink "+ Add Text Layer" (`py-2 rounded-lg text-xs font-bold`); layer cards (`bg-black/20 p-3 rounded-lg border space-y-3`): "Layer N" + trash 14px (red hover), text input, X/Y range sliders 0-100 (2 cols), Size number input, colour input 32x24. Default layer: song title at x50 y85 size 52 white Inter (line 200).

**FX tab** (2085): 13 toggle rows (Bass Shake default ON, Digital Glitch, VHS Tape, CCTV Mode, Scanlines, Aberration, Bloom, Film Grain, Pixelate, Strobe, Vignette, Hue Shift, Letterbox). Row = `rounded-lg border transition-all`, on: `bg-pink-600/10 border-pink-500/30`, off: `bg-black/20 border-white/5`; content `p-3`: 16px icon in `p-1.5 rounded-md` (on pink-500/white, off zinc-800/zinc-500), name `text-sm font-bold` + desc `text-[10px] zinc-500`, right status dot 12px (on: pink-500 with `shadow-[0_0_8px_rgba(236,72,153,.8)]` glow, off zinc-700). When on, an Intensity slider (0-1 step 0.05, percent readout) reveals with `animate-in fade-in slide-in-from-top-2`. Default intensities: shake .05, glitch .3, vhs .5, cctv .8, scanlines .4, chromatic .5, bloom .5, filmGrain .3, pixelate .3, strobe .5, vignette .5, hueShift .5, letterbox .5.

**Footer** (2148): `p-4 md:p-6 border-t white/5 bg-black/20 space-y-3 safe-area-inset-bottom`. Three states, all `h-12 rounded-xl w-full`:
1. Idle: white button "Render Video (MP4)" + Download 18px, bold black, `hover:scale-105`.
2. Encoder loading: zinc-800 pill, spinner 18px + "Loading video encoder...".
3. Exporting: zinc-800 pill with an absolutely positioned progress fill (`transition-all duration-100`; pink-600/20 while "capturing" => text "Rendering frames NN%", blue-600/20 while "encoding" => "Encoding (be patient)..." until 95%, then "Encoding MP4 NN%"), spinner 16px pink-400 / blue-400.
Caption `text-[10px] zinc-600`: "[Encoder ready • ]Offline rendering - faster than real-time."
Play button disabled (50% opacity) while exporting.

### 7.3 Pexels browser (2218-2411)
`fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm p-4`, card `max-w-4xl max-h-[80vh] rounded-2xl bg-zinc-900 border white/10`. Header: emerald 36px icon tile + title ("Select Background" / "Select Center Image") + sub, gear (emerald when key set, amber when missing) and X. API-key strip (password input + Save, key stored in localStorage `pexels_api_key`, link to pexels.com/api/new). Red error strip with "Set API key" link. Tabs Photos/Videos (emerald-600 active, hidden for album art), search input + "Search" button (spinner when loading, Enter submits), 10 quick-tag pills (abstract, nature, city, space, neon, particles, smoke, fire, water, technology). Results grid 3 cols `gap-3`, 16:9 tiles, hover overlay `bg-black/60` + "Select" emerald pill, photographer credit bottom gradient, VIDEO badge top-right. Loader: centred 32px emerald spinner. Empty: "No photos found. Try a different search term." Footer credit line (Pexels attribution).
Note this calls an external service (Pexels) from the browser, a privacy exception for a local-first product.

---

## 8. Training panel (TrainingPanel.tsx, look only)

Full-height view: `h-full w-full flex flex-col bg zinc-50 / #121214 overflow-hidden`. Not full width tuned: this is single-column (no max-width), stretched on desktop.
```
Header: "LoRA Training" (lg bold) / description (xs zinc-500)          px-4 pt-4 pb-2
Pipeline chips: Upload > Edit > Save > Preprocess > Train > Export       px-4 pb-2, h-scroll
Tabs: [Dataset Builder] [Train LoRA] [Export]                            px-4 gap-1
-----------------------------------------------------------------------
scroll area px-4 py-3 space-y-3 (scrollbar-hide)
  [Section card] Model Configuration (collapsible, chevron rotates 90deg)
  [Section] Upload audio (dashed dropzone) / Scan directory / Load existing dataset
  [Section] dataset table (tiny 10px, max-w-[80px] truncated cells)
  [Section] Dataset settings / Auto-label with AI / Edit sample (n/N) / Save / Preprocess
  [Section] Load tensors / LoRA settings / Training parameters
  [ Start Training ] full-width gradient pink->purple h ~40px
  [Section] progress text + log <pre> max-h-40 / Loss chart SVG polyline
```
- Section card: `bg-white/[0.02] border border-white/5 rounded-xl p-3`, title `text-xs font-semibold zinc-300 mb-2` (:1146).
- FieldRow: label `text-[11px] zinc-500 w-28 (112px)` + control. Inputs `bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-zinc-200`, focus `border-pink-500/50`; selects `px-2 py-1 text-xs`; checkboxes 12px `accent-pink-500`, labels `text-[10px]`.
- Pipeline chips: `px-1.5 py-0.5 rounded text-[10px]` with 10px icon, chevron-right 10px between; done = `bg-green-500/15 text-green-400`, pending `bg-white/5 text-zinc-500` (:649-661).
- Tabs: `px-3 py-1.5 rounded-lg text-xs font-medium` icon 16px; active `bg-pink-500/20 text-pink-400 border border-pink-500/30`, idle `zinc-400` hover white/5.
- Drop zone: `border-2 border-dashed rounded-xl p-4 text-center`, idle `border-white/10`, drag-over `border-pink-500 bg-pink-500/10` with pink icon; 24px Upload icon, hint `.wav, .mp3, .flac, .ogg, .opus` `text-[10px] zinc-600`. Queued files rows `bg-white/5 rounded-lg px-2 py-1`, `max-h-32` scroll.
- Buttons: Initialize Service `bg-blue-500/20 text-blue-400 rounded-lg text-xs py-1.5`; Start Training gradient `from-pink-500 to-purple-600 py-2.5 text-sm font-medium` (hover darker); Stop Training `bg-red-500/20 text-red-400`; Export LoRA gradient green-500->emerald-600. All use lucide `Loader2 animate-spin` 14-16px when busy; disabled = `opacity-50`.
- Sliders `ParamSlider`: label `text-[11px]` + value mono `text-[11px] zinc-400` (2 decimals when step<1), range `h-1.5 accent-pink-500`. Ranges: rank 4-256/4, alpha 4-512/4, dropout 0-.5/.05, epochs 1-4000, grad accum 1-16, save every 50-1000/50.
- Loss chart: inline SVG polyline `rgb(236 72 153)` stroke 1.5, axis text 8px mono `rgb(113 113 122)` (min step, max step, min loss) (:616-621). No grid, no tooltips.
- Training log: `<pre> text-[10px] zinc-400 bg-black/20 rounded-lg p-2 max-h-40 overflow-y-auto`.
- Empty/loading states: text-only status lines (`text-[10px] zinc-400`), "No checkpoints found" / "No configs found" in selects. No skeleton.
- Hard-coded English in many labels (Export, Model Configuration, Initialize Service).

---

## 9. index.html styles and motion inventory

| Item | Spec | Cite |
|---|---|---|
| Scrollbar | 6x6px, track transparent, thumb `#d4d4d8` r3px hover `#a1a1aa`; dark `#3f3f46` hover `#52525b` | index.html:72-93 |
| `.scrollbar-hide` | no scrollbar (rail, training body) | 96-102 |
| `.gradient-text` | `linear-gradient(to right,#f472b6,#a78bfa,#60a5fa)` clipped text | 104-108 |
| `music-bars` | height 20%->100%->20%, opacity .5->1->.5, **1s ease-in-out infinite**; applied to 4 `w-1` pink bars, delays 0/.2/.4/.1s ("generating" cover overlay) | 110-118 |
| drawer keyframes | slide in/out 0.3s ease-out / ease-in, fade 0.3s | 144-185 (MobileDrawer only) |
| `gradient-x` | 15s ease infinite background sweep, Tailwind config (unused in shell) | 42-56 |
| `.backdrop-blur-mobile` | blur(8px); `-lg` 16px | 187-194 |
| safe-area utils | env(safe-area-inset-*) padding | 196-221 |
| touch utils | `.touch-none`, `.touch-pan-x/y`, `.touch-manipulation`, `.tap-highlight-none`, `.scroll-touch`, `.overscroll-none/contain` | 223-247 |
| Spinner | lucide `Loader2 animate-spin` (Tailwind: 1s linear infinite) | everywhere |
| Pulse | `animate-pulse` (2s cubic-bezier(.4,0,.6,1) infinite) for green status dot, skeletons, now-playing bars | |
| Hover micro-motion | `hover:scale-105` (logo, play, render), `hover:scale-110` (prev/next in fullscreen), `active:scale-[0.98]` (Create), `transition-transform` 150ms | |
| Colour transitions | `transition-colors duration-300` on body, shell, panels, player (theme switch) | |
| Rail width | `transition-all 300ms` | Sidebar.tsx:45 |
| NavItem | `transition-all 200ms` | :213 |
| Fullscreen player | none (instant mount) | Player.tsx:413 |
| Missing: `/index.css` is linked (index.html:260) but not in repo, so `.custom-scrollbar` and `animate-in` utilities are undefined here. Rebuild must ship its own CSS and a real animation plugin (or keyframes). |

Skeleton / empty / loader catalog (shell-level): Player empty = "Select a song to play"; no skeletons in shell; skeletons only in Search (`animate-pulse` blocks). List empty = dashed box with Filter icon; Video encoder = spinner pill; Training = status text.

---

## 10. Rebuild checklist (what the shell must do)

1. Three-zone responsive shell: rail (72/200, 300ms) | content | bottom player; third details column at >=1280; slide-over below.
2. Player bar 80px (96 at lg): hover-reveal 4/6px seek bar, transport of 5 (shuffle, prev, 40px play, next, repeat with dot), time, speed menu, hover volume popover (400ms close delay), download, fullscreen, kebab.
3. Mini bar on phone (44px cover, 44px play, 4px strip) + full-screen sheet (280px art, 64px play, vertical volume).
4. Space toggles play; Esc closes fullscreen. Add: arrow seek, M mute, J/K or N/P tracks, media session (not in source).
5. Fix on phone: rail overlays content with no flow space, expanded on first load, no safe-area (`viewport-fit=cover` missing), 4px touch seek target, no drag scrub, no buffering state.
6. One accent (pink) everywhere; Settings uses indigo and Library uses green: unify.
7. Video Studio: 4 tabs, 10 presets, 13 FX with intensity, text layers, 3-state render footer; phone = canvas on top.
