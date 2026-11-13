# ace-step-ui spec 2: Song list, library, detail screens

Source: `repo/components/*.tsx` (cites `File:line`), `repo/index.html`, `repo/App.tsx`. Tailwind via CDN (index.html:23), Inter 400/500/600/700, dark mode by `dark` class.
Colours are given by ROLE with the source class in brackets. Map roles to theme tokens; never copy hex.

Role legend (dark / light source value):
- `canvas`: main page bg (`bg-white dark:bg-black` list/library; `bg-suno-DEFAULT #09090b` wrapper App.tsx:1323)
- `panel`: side panels (`bg-zinc-50 dark:bg-suno-panel #121214`)
- `raised`: menus, modals, cards (`bg-white dark:bg-zinc-900` or `#18181b`)
- `hover-fill`: `bg-zinc-100 dark:bg-[#18181b]` (row) / `hover:bg-zinc-200 dark:hover:bg-white/5` (icon button)
- `border`: `border-zinc-200 dark:border-white/10` (strong) and `dark:border-white/5` (hairline)
- `text`: `zinc-900 / white`; `text-muted`: `zinc-500 / zinc-400`; `text-faint`: `zinc-400 / zinc-600`
- `accent`: pink-600 (light) / pink-500 (dark) = playing, liked, focus, checkbox, progress. Gradient badge: `from-pink-500 to-purple-500`.
- `accent-2` green-500 = Library tab underline, copied tick, play FAB in Library only.
- `warn` amber-400/500 = queued. `danger` red-400/500/600 = delete.
- Scrollbar: 6px, track transparent, thumb zinc-300 (dark zinc-700 #3f3f46), radius 3px (index.html:69-92).

Key finding: there is NO side-by-side takes/versions UI and no like/dislike pair beyond icons. Variations from `batchSize` are saved as separate songs titled `Title (v1)`, `Title (v2)` (server/src/routes/generate.ts:423) and appear as consecutive rows. The "v1.5" badge is the DiT MODEL, not a take number. Reference frame first.png shows exactly this: Untitled (v1)/(v2)/(v1)/(v2) rows stacked, each with a model badge. A rebuild wanting real takes must add it (see section 12).

---

## 1. Shell placement (App.tsx)

```
>=1280 (xl)  [rail 72/200][Create 360][        SongList flex-1        ][RightSidebar 360][
 768-1279    [rail][Create 320/360][        SongList flex-1        ]   (details = slide-over via Info button)
 <768        rail is overlay; Create OR SongList (toggle pill top-right); details = full-height slide-over max-w-md
```
- SongList wrapper: `flex-1 flex-col h-full overflow-hidden`, hidden on phone until toggled (App.tsx:1321-1325).
- Right column: `hidden xl:block w-[360px] flex-shrink-0 h-full bg panel border-l z-10 transition-colors duration-300` (App.tsx:1356). Selecting a row sets `selectedSong` and re-opens it (App.tsx:1335-1337); X closes it.
- Mobile/tablet details: `fixed inset-0 z-[60] flex justify-end xl:hidden`; scrim `bg-black/60 backdrop-blur-sm animate-in fade-in`; sheet `max-w-md w-full h-full panel shadow-2xl border-l border-white/10 animate-in slide-in-from-right duration-300` (App.tsx:1491-1497).
- Page transition: `transition-colors duration-300` on every surface.

`animate-in / fade-in / zoom-in-95 / slide-in-from-*` are tailwindcss-animate class names but the CDN build does not load that plugin (index.html has no plugin, only `gradient-x`). Treat them as INTENDED motion; in the original they likely do nothing. Rebuild: fade 100-200 ms + scale 0.95->1, ease-out.

---

## 2. SongList (`SongList.tsx`, 831 lines)

### 2.1 Layout (wide)
```
┌ scroller: p-6 pb-32 (24px / 128px bottom for player), custom-scrollbar ─────────────────────┐
│  ┌ max-w-5xl (1024px) mx-auto ──────────────────────────────────────────────────────────┐  │
│  │ Workspaces › My Workspace                         (breadcrumb, text-sm, gap-2)       │  │
│  │ [🔍 Search your songs.........................] [⛛ Filters (2)] [Select]             │  │ header gap-6 mb-8
│  │ ┌ selection bar (only in select mode) ─────────────────────────────────────────────┐ │  │
│  │ │ 3 selected                                          [Select all] [Delete]        │ │  │
│  │ └──────────────────────────────────────────────────────────────────────────────────┘ │  │
│  │ ┌row──────────────────────────────────────────────────────────────────────────────┐  │  │ rows space-y-2 (8px)
│  │ │ [☐] [cover 64]  Title  [v1.5TS3] [🔒]                                    2:08   │  │  │
│  │ │                 (a) creator                                                     │  │  │
│  │ │                 style / tags text, 2 lines max                                  │  │  │
│  │ │                 👍12  👎  ⤴share  🎬        [+list] [ⓘ <xl] [⋯]                 │  │  │
│  │ └─────────────────────────────────────────────────────────────────────────────────┘  │  │
└──┴──────────────────────────────────────────────────────────────────────────────────────┴──┘
```
Phone (<768): same single column, `p-6` stays; the toolbar row does not wrap (search flex-1 shrinks, Filters/Select keep `px-4`). Row content wraps less: style line-clamp-2, action row 7 icons of 32px = 224px+ so it is tight at 375px (no responsive collapse in source; the Info button appears `xl:hidden`). Recommend in rebuild: hide dislike/video behind the more menu below 480px.

### 2.2 Header block (SongList.tsx:222-340)
- Breadcrumb: `text-sm`, muted; "Workspaces" hover to text colour (`transition-colors`, cursor-pointer, not wired), chevron `›` faint, current segment `font-medium text`. Hard-coded English, not i18n.
- Toolbar `flex items-center gap-3`.
  - Search input: `w-full pl-10 pr-4 py-2.5 text-sm rounded-lg` (8px), fill `bg-zinc-100 dark:bg-[#121214]`, 1px border strong, focus: border -> `zinc-400 / white/20`, no ring, placeholder `zinc-500 / zinc-600`; `transition-colors`. Icon 16px at `left-3 top-3`, muted, turns text colour on `group-focus-within`. Matches title, style, any tag, case-insensitive substring (163-183).
  - Filters button: `px-4 py-2.5 text-xs font-bold rounded-lg gap-2 border`, funnel 14px (filled when active) + label `Filters (n)`. Default: field fill + hover `white/5`. Active or open: inverted (`bg-zinc-900 dark:bg-white`, text inverse, border transparent). `transition-all select-none`.
  - Select button: same recipe; label "Select"; inverted while in select mode. Toggling clears the selection.
- Filter menu (`absolute right-0 top-full mt-2 w-56` = 224px, `rounded-xl shadow-2xl py-1 z-50`, raised fill `bg-white dark:bg-[#18181b]`, strong border, `origin-top-right`, intended `fade-in zoom-in-95 100ms`). Click outside closes (mousedown listener, 129-137). Heading "REFINE BY": `px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500`. Four rows `px-4 py-2.5`, `justify-between`, hover fill; label `text-sm font-medium` (muted -> text on hover), leading 16px icon (faint -> muted on hover) gap-3. Trailing checkbox `w-4 h-4 rounded border`; checked = accent fill (pink-600) + white 10px check stroke 4; unchecked border `zinc-300 / zinc-600`, darker on hover. Items, in order: Liked (ThumbsUp), Public (Globe), Private (Lock), Generating (Loader2). Multi-select, AND semantics (176-179). Any active filter hides upload rows (186).
- Selection bar: `rounded-xl border px-4 py-3`, fill `bg-zinc-50 dark:bg-white/5`, `justify-between`. Left `text-sm` muted "{n} selected". Right buttons `px-3 py-1.5 rounded-lg text-xs font-semibold border`: "Select all"/"Clear all" (neutral, hover border darkens); "Delete": enabled = red-500 border, red-600 text, hover red tint (`red-50` / `red-500/10`); disabled (0 selected) = neutral border, zinc-400 text, `cursor-not-allowed`. Delete calls `onDeleteMany`, clears, exits select mode. Generating songs are not selectable (210-216).

### 2.3 Row = SongItem anatomy (SongList.tsx:446-784)
Outer: `group flex items-center gap-4 p-2 rounded-lg border transition-all cursor-pointer`; padding 8px, gap 16px.
- States: rest `border-transparent bg-transparent`; hover `hover-fill`; selected (row open in details) `hover-fill` + `border strong` (1px outline, 540). Click anywhere = select (opens details). Playing is NOT shown with a row fill, only the title turns accent and the cover keeps its play overlay.
- Draggable when it has audio and is not generating: `cursor-grab`, `active:cursor-grabbing`. Drag payload mime `application/x-ace-audio` {url,title,source:'song'}; drag image = clone at 0.95 opacity with a 24px green-500 circular "+" badge at bottom-left 8px (57-87, 519-539). Used to drop onto the Create panel's reference/cover slots.
- Selection checkbox (select mode only, first flex child): `w-5 h-5 rounded border`, 12px check; checked accent fill/border; unchecked border `zinc-300 / zinc-600`; disabled while generating `opacity-40`.
- Cover (`w-16 h-16` = 64px, `rounded-md`, `bg zinc-200 / zinc-800`, `overflow-hidden shadow-sm`, flex-shrink-0, named group `group/image`):
  - No coverUrl or image error -> `AlbumCover` generated art (section 8) filling it.
  - Else `<img object-cover>` with `transition-opacity`.
  - Generating: art drops to `opacity-20 blur-sm`; overlay `bg-black/40` centred column gap-1 with either queue chip or waveform (below).
  - Idle: hover overlay (`absolute inset-0 bg-black/40 backdrop-blur-[1px] flex center`, `transition-opacity duration-200`) hidden at `opacity-0`, shown on `group-hover/image` (hover of the cover itself, not the row) and ALWAYS shown when this is the current song. Contains a 40px white disc (`w-10 h-10 rounded-full bg-white shadow-lg`), black filled Play 20px with `ml-1` optical nudge (Pause 20px when current and playing), `hover:scale-105 transition-transform`. Click plays (stopPropagation).
- Waveform (generating, not queued): four bars `w-1` (4px) `bg-pink-500 rounded-full` in `flex items-end gap-1 h-6` (24px), class `music-bar-anim`: keyframes height 20% -> 100% -> 20%, opacity .5 -> 1 -> .5, `1s ease-in-out infinite`, delays 0.0/0.2/0.4/0.1 s (index.html:110-118).
- Queue chip (queuePosition set): 32px circle `bg-amber-500/20` with 16px Clock icon amber-400, caption `text-[10px] font-medium` amber-400 "Queue #n".
- Content column: `flex-1 min-w-0 flex flex-col justify-between py-1`.
  1. Title row `flex items-center gap-2`:
     - Title `h3 font-bold text-lg` (18px/28px) `truncate`; normal = text colour, current = accent. Owner and not generating: `cursor-pointer hover:underline`, click enters inline rename (stopPropagation). Fallbacks: generating -> "Queued..." or "Creating...", else "Untitled".
     - Rename input: same type size, `bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-pink-500`, no outline, autofocus + select-all. Enter or blur saves (PATCH), Esc cancels, empty/unchanged cancels, failure reverts silently.
     - Model badge: `text-[9px] font-bold text-white px-1.5 py-0.5 rounded-sm shadow-sm` on gradient `from-pink-500 to-purple-500` (left to right), tooltip `DiT model: <id>`. Text map (13-ish ids, 43-55): base `1.5B`, sft `1.5S`, turbo `1.5T`, turbo-shift1 `1.5TS1`, shift3 `1.5TS3`, continuous `1.5TC`, unknown/none `v1.5`. THIS is the version badge.
     - Private: 12px Lock, faint, shown when `isPublic === false`.
  2. Creator line (`space-y-1` block): clickable chip `gap-1.5`, 16px circle avatar `bg-purple-500 text-[8px] font-bold white` with first letter, name `text-xs font-medium` muted -> hover text-stronger + underline; hover `opacity-80`. Click navigates to profile.
  3. Tags/style line: `text-xs font-medium text-zinc-500 line-clamp-2 pt-1 max-w-2xl` (672px). It is the raw `style` string (comma-separated), not chips.
  4. Generating only: progress bar `pt-2`; track `h-1 rounded-full bg-zinc-200/70 dark:bg-white/10`; fill `bg-gradient-to-r from-pink-500 to-purple-600 transition-all`; width = progress (0..1 or 0..100 normalised, clamped); indeterminate (undefined) = 40% opacity at 0%.
  5. Action row (hidden while generating) `flex items-center gap-1 pt-2`, every button a 32px target (`p-2` + 16px icon) `rounded-full`, rest `text-zinc-400`, hover `text strong` + fill `hover:bg-zinc-200 dark:hover:bg-white/5`, `transition-colors`, stopPropagation:
     - Like: `px-3 py-1.5` pill, ThumbsUp 16px + count (`text-xs font-bold`, only if >0). Liked = accent text + tint fill (`pink-100 / pink-500/10`) + icon filled. Toggle = optimistic via parent.
     - Dislike: ThumbsDown, NO handler (visual only; click is swallowed).
     - Share: opens ShareModal (tooltip "Share").
     - Create Video: Video icon (tooltip "Create Video").
     - `ml-auto` spacer pushes the rest right: Add to Playlist (ListPlus, tooltip), Info (`xl:hidden`, opens details slide-over), More (MoreHorizontal) in `relative` wrapper that anchors SongDropdownMenu.
     These icons are always visible (NOT hover-revealed); only the cover play button is hover-revealed.
- Duration column: `text-xs font-mono`, muted-faint (`zinc-500 / zinc-600`), `self-start pt-1`, top-right. While generating: "Creating..." (pink-500) or "#n" (amber-500).
- Row height: ~96-112px (64px cover, or content: 28 title + 20 creator + 4+34 two-line style + 40 actions + pt) so rows are taller than the cover; there is no fixed height.

### 2.4 Upload rows
Reference uploads (`referenceTracks`) are merged into the list sorted by `createdAt` desc (194-208). Rendered as a SongItem with style "Upload", private, no like/owner; id `upload_<id>`; clicking row or cover plays it; menu shows only the items its handlers allow (Use as reference, Cover song). Duration `m:ss` or `--:--`.

### 2.5 Empty / filtered-empty state (344-357)
`h-64 flex-col center space-y-4 border border-dashed rounded-2xl`, border `zinc-200 / white/5`, fill `bg-zinc-50 dark:bg-white/[0.02]`. 64px circle `bg-zinc-100 dark:bg-white/5` with 32px Filter icon; message "No songs match filters" (`font-medium`, muted); link-button accent `text-sm font-bold hover:underline` "Clear filters" resets search and filters. (There is no separate "no songs yet" state in this component.)

---

## 3. SongDropdownMenu (`SongDropdownMenu.tsx`)
Anchored `absolute` to a `relative` wrapper: `right-0` (or `left-0` via `position`), `top-full mt-2` (or `bottom-full mb-2` via `direction="up"`), `w-52` (208px), `rounded-xl shadow-2xl py-1.5 z-50`, ALWAYS dark (`bg-zinc-900 border border-white/10`, ignores theme; rebuild should theme it). Motion intended `fade-in slide-in-from-top-2` (or bottom-2) `duration-150`. Closes on outside mousedown, Esc, or after any action (`handleAction`). Clicks inside stopPropagation so the row does not select.
Item: `w-full px-3 py-2 text-sm flex items-center gap-3`, 16px icon box (14px icon, `opacity-70`), normal text `zinc-300` hover `bg-white/5 text-white`; danger `red-400` hover `bg-red-500/10 text-red-300`; disabled `opacity-50 cursor-not-allowed`. Divider `h-px bg-white/10 my-1 mx-2`.
Items in order:
1. Create Video (Video) always
2. Edit Audio (Edit3) owner only; opens `/editor?audioUrl=` in new tab, or `onEditAudio`
3. Extract Stems (Layers) always; opens `/demucs-web/?audioUrl=` new tab (dev port 3000 -> 3001)
4. Reuse Prompt (Repeat) only if handler passed
5. Use as Reference (Layers) only if handler; disabled without audio
6. Cover Song (Layers) only if handler; disabled without audio
--- divider ---
7. Add to Playlist (ListPlus)
8. Download (Download) blob-fetch, saves `<title>.mp3`; errors only console
9. Share (Share2)
--- divider (owner only) ---
10. Delete Song (Trash2, danger) owner only
Callers: SongList passes all handlers; LibraryView passes no reference/cover handlers; RightSidebar passes only video/reuse/delete/playlist/share; SongProfile passes stubbed reuse/playlist (no-ops: `() => {}`, SongProfile.tsx:302-303).

---

## 4. LibraryView (`LibraryView.tsx`)
Page: `flex-1 canvas overflow-y-auto p-6 lg:p-10 pb-32` (24 / 40 px).
```
Your Library                                        [＋ New Playlist]      h1 text-3xl font-bold, mb-8
All Songs   Liked Songs   Playlists   Uploads                               tabs gap-4, border-b, mb-8
────────────                                                               active underline 2px green
 1  [40] Title                                  2:08  ⋯
 ▶  [40] style text                                                        (row hover: index -> play)
```
- New Playlist button: `px-4 py-2 rounded-full gap-2 font-medium`, 18px Plus; fill `bg-zinc-900 dark:bg-zinc-800` hover one step lighter, text white, `shadow-lg shadow-zinc-900/10` (none in dark), `transition-colors`.
- Tabs: `pb-3 text-sm font-bold relative`, container `border-b border-zinc-200 dark:border-white/10 pb-1`, inactive muted (hover text), active text; underline `absolute bottom-0 inset-x-0 h-0.5 bg-green-500 rounded-full` (accent-2, no slide animation, appears instantly). Order: All Songs, Liked Songs, Playlists, Uploads. "All Songs" and "Uploads" are hard-coded English.
- Track row (All and Liked): `group flex items-center gap-4 p-2 rounded hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors`, list `space-y-1`. Columns: index `w-6 text-center` (faint; hidden on hover) swapped for 14px Play icon (shown on hover, `group-hover:hidden/block`); cover `w-10 h-10 rounded object-cover shadow-sm` (AlbumCover `sm` fallback; img error hides it, leaving a gap); title `font-medium truncate` over style `text-xs muted` (NOT truncated); duration `text-sm font-mono muted`; Liked tab adds a 16px green-500 filled heart; More button (`p-2 rounded-full`, MoreHorizontal 16px) + SongDropdownMenu (no Share modal when `shareSong` null; share modal state is split across two vars, 52-54, 280-286). Click row plays with list context (`onPlaySong(song, list)`).
- Liked header card: `p-6 rounded-xl flex items-end gap-6 mb-8 cursor-pointer border group`, gradient `from-indigo-500/10 to-zinc-50` (dark `from-indigo-800/50 to-zinc-900/50`), hover `zinc-100 / white/5`. 160px art `rounded shadow-2xl` gradient indigo-500 -> purple-400 with white filled 64px heart; kicker "PLAYLIST" `text-sm font-bold uppercase`; h1 `text-5xl font-extrabold`; count `text-sm font-medium`. Right: 56px green-500 circle play FAB, `opacity-0 group-hover:opacity-100 transition-opacity`, `hover:scale-105`, black 28px Play, `ml-1`. Click anywhere plays first liked.
- Playlists tab: grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6`. Card: `p-4 rounded-lg border`, fill `bg-white dark:bg-zinc-900/40`, hover border darkens + `hover:shadow-lg` + dark fill `zinc-900`, `transition-all`; square art `aspect-square rounded-md mb-4` (image or AlbumCover); name `font-bold truncate`; description or "by you" `text-sm muted line-clamp-2`. No play overlay.
- Uploads tab: list `space-y-2`; row `p-3 rounded-lg border gap-4`, fill `white / zinc-900/40`; 40px tile with Music 18px; filename `text-sm font-medium truncate`; meta `text-xs muted` "12 MB • 11/13/2026"; delete Trash 16px (muted, hover red-600) with NO confirm.
- Empty: plain `text-sm muted` lines "No songs yet." / "No uploads yet." (no illustration). Playlists tab with none: empty grid, no message. Liked with none: header card only.

---

## 5. RightSidebar = song details (`RightSidebar.tsx`, 360px)
```
┌ Song Details                                ✕ ┐ h-14, border-b, backdrop-blur
│ ┌─────────────── 1:1 cover ───────────────┐   │ p-5, sections space-y-6
│ │ ▶ 12                               2:08 │   │ cover rounded-xl shadow-2xl ring-1
│ │            (hover: 64px play disc)      │   │
│ └─────────────────────────────────────────┘   │
│ Title (2xl bold)                       ✎  ⋮   │
│ (F) creator                                    │
│     Created 11/13/2026                         │
│ ┌ [🎬] [✎] [🔁] [⧉ stems] ────────────────┐   │ tool strip
│ ♡ 0   ⤴                              ⬇        │ icon row
│ SOURCES (if reference/cover)                   │
│ ─────────────────────────                      │
│ SONG DETAILS                         ⧉ Copy    │
│ [Indie Folk] [male vocal]        [+more]       │ tag chips, 1 line collapsed
│ ┌ LYRICS                          ⧉ Copy ┐     │
│ │ [Verse] ... mono, max-h 300, scroll    │     │
│ └─────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```
- Empty (no song): centred 40px Music icon (zinc-300/700) + `t(selectSongToView)` `text-sm` faint, panel fill, left border (119-126).
- Header: `h-14 px-4 border-b flex justify-between`, `bg-zinc-50/50 dark:bg-suno-panel/50 backdrop-blur-md z-10`; title `font-semibold text-sm`; close X 18px in `p-1.5 rounded-full hover:` fill.
- Body scroller `custom-scrollbar`, inner `p-5 pb-24 lg:pb-32 space-y-6`.
- Cover: `aspect-square w-full rounded-xl overflow-hidden shadow-2xl ring-1 ring-black/5 dark:ring-white/10 cursor-pointer group`, fill zinc-200/800. Img `object-cover transition-transform duration-700 group-hover:scale-105`; img error hides it, NO fallback in that case (AlbumCover only when `coverUrl` empty). Always-on bottom gradient `from-black/80 via-transparent to-transparent opacity-60`. Hover: centred play disc `w-16 h-16` (64px) `bg-white`, black 28px Play (`ml-1`) or Pause, `hover:scale-110 transition-transform`, overlay `opacity-0 -> 100 duration-200`. Bottom bar `bottom-4 left-4 right-4` flex-between: white 16px Play + play count `text-xs font-bold font-mono`; duration chip `text-[10px] font-bold text-black bg-white/90 px-1.5 py-0.5 rounded backdrop-blur-sm`.
- Title block `space-y-3`: h2 `text-2xl font-bold leading-tight tracking-tight`, click navigates to song page, hover underline. Owner pencil (Edit3 18px) `p-1`, then MoreVertical 20px with SongDropdownMenu. Inline rename: input `text-xl font-bold px-3 py-2 rounded-lg border`, field fill `bg-white dark:bg-black/30`, focus `ring-2 ring-pink-500/40`, `maxLength 120`, autofocus; buttons below `px-3 py-1.5 rounded-md text-xs font-semibold`: Save accent fill (`pink-600`, hover `pink-700`, "Saving..." and `opacity-60` while busy), Cancel neutral (`zinc-200` / `white/10`); inline error `text-xs red-500` ("Title cannot be empty.", "Please sign in to rename.", server message). Enter saves, Esc cancels.
- Creator row `gap-3`: 32px gradient avatar (indigo-500 -> purple-600, `ring-2` page-colour, `text-xs font-bold`), name `text-sm font-semibold hover:underline`, "Created <date>" `text-xs muted`. (No avatar image, no tier badge.)
- Tool strip: `px-3 py-2.5 rounded-2xl border`, fill `bg-zinc-200/80 dark:bg-black/40 backdrop-blur-sm`, border `zinc-300/50 / white/5`, `justify-between`. Four buttons `p-3 rounded-xl` 18px stroke-1.5 icons, muted -> strong + fill on hover, `transition-all duration-200`: Create video, Open in editor, Reuse prompt (Repeat), Extract stems (Layers). Titles are tooltips only.
- Action row `px-2 py-2`: left `gap-6` Heart 22px (+ count `text-xs font-semibold`; liked = accent + filled) and Share 22px; right Download 20px (`p-2`). NO dislike here.
- Sources (only when generationParams has reference or source audio): label `text-xs font-bold uppercase tracking-wide muted` with 14px Link icon; per source a card `rounded-lg border px-3 py-2`, fill `white / zinc-900/40`: icon 14px, tiny kind label ("Reference"/"Cover" `text-xs` muted), filename `text-sm font-medium truncate`; right pill button "Play" `text-xs px-2 py-1 rounded-full border` that plays a synthetic preview song.
- Divider `h-px bg-zinc-200 dark:bg-white/5`.
- Style & tags: header row "SONG DETAILS" (`text-sm font-bold uppercase tracking-wide`) + Copy link (`text-[10px] font-medium`, 12px Copy icon; flips to green "Copied" 2 s). Chips: `px-2 py-0.5 rounded border text-[11px] font-medium`, fill `bg-zinc-100 dark:bg-white/5` hover one step up, text `zinc-600 / zinc-300`, `gap-1.5 flex-wrap`. Collapsed: container `max-h-[22px] overflow-hidden` (one line) with an absolutely positioned "+more" chip (`bg-zinc-200 dark:bg-zinc-700`) at right-0 top-0; click anywhere toggles expanded (no "less" affordance). Source = `tags[]`, else `style` split on commas.
- Lyrics card: `rounded-xl border overflow-hidden`, fill `bg-white dark:bg-black/20`, border `zinc-200 / white/5`. Header `px-4 py-3 border-b flex-between`, fill `bg-zinc-50 dark:bg-white/5`; label "LYRICS" `text-[10px] font-bold uppercase tracking-wider muted`; Copy as above. Body `p-4 max-h-[300px] overflow-y-auto`, `text-sm font-mono whitespace-pre-wrap leading-relaxed opacity-90`, colour `zinc-700 / zinc-300`. Empty: centred italic faint "Instrumental" + `text-xs not-italic` "No lyrics generated", `py-8`. Bracketed section markers are not styled.
- Not present: versions list, variations carousel, BPM/key/seed/model facts table, generation parameters, comments. (The model id is only in the list badge tooltip.) The frame shows a comment bubble count next to the heart that this source version lacks.

---

## 6. SongProfile = full song page (`SongProfile.tsx`, route `/song/:id`)
```
┌ border-b px-4 md:px-6 py-4 ───────────────────────────────────────────────┐
│ ← Back                                                                    │
│ Title (3xl)                                    [Similar] [By creator]  md+│
│ (a) creator    chips (max 4)   November 13, 2026 at 04:12 PM  [Private]   │
├───────────────────────────────────────────────────────────────────────────┤
│        max-w-3xl centered   px-4/6  py-4/6                                │
│        [ cover  max-w-xs/sm square  ▶ ]                                   │
│        (👁 12) (♡ 0) (✎ Edit) (⤴) (⋯)                                    │
│        ┌ Lyrics ─────────────┐                                            │
└───────────────────────────────────────────────────────────────────────────┘
```
- Page `bg-zinc-50 dark:bg-black`. Loading: spinner `w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin` + text, centred. Not found: text + "Go back" button `px-4 py-2 rounded-lg` neutral fill.
- Back: `gap-2 muted hover:text mb-4` ArrowLeft 20px. Title `text-2xl md:text-3xl font-bold mb-2`. Creator chip: 24px gradient circle (or avatar img), name `font-semibold`, hover underline. Tags: first 4 comma parts `px-2 py-1 rounded text-xs`, fill `zinc-200 / zinc-800`. Date line `text-xs muted`; owner-only "Private" pill. "Similar" (inverted pill `px-4 py-2 rounded-full text-sm font-semibold`, no action) and "By <creator>" (text button) are `hidden md:flex`.
- Cover: `aspect-square max-w-xs md:max-w-sm rounded-xl shadow-2xl`, centred below lg and left above. Always-on `bg-black/40` button overlay (`bg-black/50` when current) with white disc `w-16 h-16 md:w-20 md:h-20` that scales 1.1 on hover; Pause/Play 28-32px. While playing the image scales 1.05 (`duration-500`) and four 6px pink bars pulse at bottom-left (`animate-pulse`, heights 16/24/12/28px, delays 0/150/300/450 ms).
- Pills row (`gap-2 md:gap-3 flex-wrap`, centred below lg): views pill (Eye 16 + count) `px-3 py-2 rounded-full text-sm`, fill `bg-zinc-200 dark:bg-zinc-900`; Like pill (liked = `bg-pink-500 text-white` filled heart); owner Edit pill `bg-indigo-600 hover:bg-indigo-700 text-white` (label hidden below md); Share and More round buttons `p-2` 16px icons. Menu = SongDropdownMenu.
- Lyrics card `rounded-xl border p-4`, fill `bg-white dark:bg-zinc-900/50`, border `zinc-200 / zinc-800`; heading `text-sm font-semibold mb-3`; body `text-sm leading-relaxed whitespace-pre-line max-h-72 md:max-h-96 overflow-y-auto`. Hidden if no lyrics.
- Side effects: sets document title and OG/Twitter/music meta tags, reset on leave (22-83). Cover URL here is a picsum placeholder (118), not the real cover.

---

## 7. Playlists
### 7.1 PlaylistDetail (`PlaylistDetail.tsx`)
```
 ← (abs top-6 left-6, 32px dark circle)
┌ header  p-8 pt-8  flex gap-8 items-end  bg-black/20 backdrop-blur-lg border-b white/10 ─────┐
│ [cover 208]  PLAYLIST                                                                       │
│              Name (7xl bold, tight, drop-shadow)                                            │
│              description (sm, max-w-2xl, md+)                                                │
│              (a) creator · 12 songs · 45 min                                                │
├ actions  px-8 py-4 bg-black/20 ──────────────────────────────────────────────────────────────┤
│ (▶ 56 green)  🗑(owner)                                              Public|Private          │
├ list bg-black/40 ───────────────────────────────────────────────────────────────────────────┤
│ #   Title            Artist        Date added        ⏱         sticky header, bg #121212    │
│ 1  [40] Title/creator  creator     11/13/2026        2:08  🗑(hover)                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Whole page gradient `bg-gradient-to-b` chosen by `name.length % 4`: purple-900, blue-900, indigo-900, rose-900 -> black. Always dark (hard-coded; not theme aware).
- Header: phone `p-4 pt-12 flex-col gap-4 items-center text-center`; md `p-8 flex-row gap-8 items-end`. Cover `w-32 h-32` (phone) / `md:w-52 md:h-52` (208px), `rounded-lg shadow-2xl bg-zinc-800`; fallback gradient `zinc-700 -> zinc-900` with Music icon (40/64px, white/20) and giant initial (`text-4xl md:text-6xl font-bold text-white/10`) overlapped.
- Info: kicker `text-xs font-bold tracking-wider uppercase text-white/80`; title `text-2xl md:text-5xl lg:text-7xl font-bold tracking-tight leading-none`; meta row `text-sm font-medium gap-2 flex-wrap`: 20/24px avatar (image or green->blue gradient), creator (hover underline), 4px dot, "N songs", dot (md+), minutes (only if numeric durations; string durations yield nothing).
- Actions bar: play FAB `w-12 h-12 md:w-14 md:h-14 rounded-full bg-green-500 hover:scale-105 transition-transform shadow-lg`, black 24px Play `ml-1` (plays first). Owner trash `p-2` 20px zinc-400 -> red-500 uses `window.confirm` (not ConfirmDialog). Right: "Public"/"Private" `text-xs md:text-sm` zinc-400.
- Column header (md+): grid `grid-cols-[16px_4fr_3fr_2fr_minmax(120px,1fr)] gap-4 px-4 py-2 border-b text-sm font-medium zinc-400 sticky top-0 bg-[#121212] z-10`; labels #, Title, Artist, Date added, clock icon (right-aligned).
- Row: `group px-2 md:px-4 py-3 rounded-md hover:bg-white/10 text-sm text-zinc-400 hover:text-white cursor-pointer transition-colors`, `space-y-1`. Phone: flex row (cover 48px with always-visible `bg-black/50` play overlay, title/creator + "• m:ss", trash 18px). Desktop: index, cover 40px (play overlay on cover hover) + title (`font-medium text-white truncate`) over creator (`text-xs zinc-500`), artist link (hover underline), date or "Just now", duration `font-mono text-xs` + owner trash revealed `opacity-0 -> 100` on row hover. Row click = select + play. Removal is immediate, no confirm.
- States: loading spinner (black page), not-found with "Go back". Empty playlist shows nothing (no empty message). Playing row has NO highlight.

### 7.2 PlaylistModals (`PlaylistModals.tsx`)
Shared modal recipe: scrim `fixed inset-0 z-[60] bg-black/50 dark:bg-black/80 backdrop-blur-sm p-4` centred; card `rounded-xl w-full border shadow-2xl animate-in fade-in zoom-in-95 duration-200`, fill raised, `max-w-md p-6` (create) / `max-w-sm p-6` (add). Title `text-xl` (create) / `text-lg` (add) bold; close X 20px muted -> text. Scrim click does NOT close (create or add).
- CreatePlaylistModal: label `block text-xs font-semibold uppercase mb-1 muted`; name input `p-3 rounded-lg border`, fill `bg-zinc-50 dark:bg-black/50`, focus border + `ring-1` accent; textarea `h-24 resize-none`. Footer `justify-end gap-3 mt-6`: Cancel ghost (`px-4 py-2 rounded-lg text-sm font-medium`, hover fill); Create (`font-bold`, inverted solid `bg-zinc-900 dark:bg-white`, `hover:scale-105`, `shadow-lg`; disabled when name blank: `opacity-50`, no scale). Enter submits; clears fields after.
- AddToPlaylistModal: top dashed "Create new playlist" row (`p-3 rounded-lg border border-dashed`, 40px plus tile `rounded`), divider, list `space-y-1 max-h-60 overflow-y-auto` of rows (`p-3 rounded-lg`, 40px cover/Music tile, name `font-medium truncate`, "N songs" `text-xs muted`). Picking closes. Empty: centred italic `text-sm py-6` "No existing playlists". No selected/already-added tick, no search.

---

## 8. AlbumCover (`AlbumCover.tsx`)
Deterministic generated art, no network. Props `seed`, `size`, `className`, `children`. Seed = song id (or title/name).
- Sizes: xs 32, sm 40, md 48, lg 56, xl 192, full 100%. Base `rounded-md shadow-lg flex-shrink-0 overflow-hidden relative`.
- Algorithm: djb-style string hash -> LCG (`seed*1103515245+12345 & 0x7fffffff`). Picks 1 of 15 four-colour palettes (+ dark bg: Sunset, Ocean, Forest, Neon, Golden Hour, Aurora, Lavender, Cherry Blossom, Cyber Punk, Deep Space, Warm Ember, Cool Mint, Velvet Rose, Electric Blue, Jungle) then 1 of 10 CSS-gradient patterns (aurora, mesh, orbs, rays, waves, geometric, nebula, gradient, rings, crystal) with seeded angles/positions/counts (lines 47-268). Pure CSS backgrounds, no animation.
- Rebuild note: palettes are fixed brand-free hex; for theming, keep it (art, not UI chrome) but derive the 4 colours from theme accent hues if wanted.

---

## 9. SearchPage (`SearchPage.tsx`) = Explore
```
[🔍 Search songs...........................(✕|spinner)]   max-w-3xl, h-11, rounded-full
Featured Songs                                      >        (chevron if >4)
[card][card][card][card]   grid 2 cols (lg 4), 8 cards
Featured Creators                               <  >
 (90) (90) (90) ...          horizontal scroll, scrollbar hidden
Featured Playlists                              <  >
 [140][140]...
Genres   (pill)(pill)(pill)...
```
- Page `bg-zinc-50 dark:bg-[#0a0a0a]`, inner `max-w-[1400px] px-6 py-6 pb-24 lg:pb-32`. Section `mb-10`; heading `text-lg font-bold mb-4`; arrow buttons `p-1.5 rounded-full` 20px chevrons (scroll by 400px smooth); songs grid has only a right chevron and it scrolls a non-overflowing grid (no-op).
- Input: `h-11 pl-12 pr-12 rounded-full border`, fill `white / zinc-900/80`, focus border accent + `ring-2 ring-pink-500/20`, `transition-all`; 20px Search icon left-4; right: 18px spinner (accent, `animate-spin`) while searching, else X to clear. Debounce 300 ms; empty query restores featured (146-161). Errors become empty results, no message.
- Search mode swaps section titles to `Songs matching "q" (n)` etc. and layouts become grids (songs 1/2/3/4 cols by md/lg/xl, creators 3..8 cols, playlists 2..6 cols), max 20 each.
- FeaturedSongCard (compact result row): `p-2 rounded-xl border gap-3`, fill `white / zinc-900/40`, border `zinc-100 / white/5`, hover border `pink-500/30` + fill step + `transition-all`. 48px `rounded-lg` cover; hover/playing shows `bg-black/50` overlay with 16px white Play/Pause. Title `text-sm font-semibold truncate max-w-[140px]` + badge (`text-[8px] font-bold` gradient `pink -> purple`, hard-coded "v5" on public songs); tags line `text-[11px]` first 2 style words as buttons (click copies, flips to green check 2 s, hover accent); meta row `text-[10px]` faint: 14px creator avatar chip (gradient + initial) max-w-80px, Play 9px + count, Heart 9px + count (K/M format).
- CreatorCard: `w-[110px] text-center`; 90px circle avatar `shadow-lg ring-2 ring-transparent group-hover:ring-pink-500 transition-all`; name `text-sm font-semibold truncate` (hover accent); handle `@name` `text-[11px] muted`. Avatar fallback = dicebear URL (network, violates local-first; replace with initials).
- PlaylistCard: `w-[140px]`; square `rounded-lg shadow-md` (hover image scale 1.05 `duration-300` + bottom gradient `from-black/60`); name `text-sm font-semibold truncate`; "N songs" `text-[11px] muted`; creator chip 16px.
- Genres: pills `px-3 py-1.5 border rounded-full text-sm duration-200`, rest fill `zinc-100 / zinc-800/60`, hover border `pink-500/30` + text accent; selected `bg-pink-500 text-white`; hover reveals 12px Copy icon (copies genre) then a green check.
- Skeletons (`animate-pulse`): songs 8 x `h-[72px] rounded-lg` blocks in 2/4 cols; creators 8 x (90px circle + 16px line); playlists 6 x (square + 2 lines).
- Empty: centred `text-sm muted py-8` ("No songs found "q"", "No creators yet"...); no icon.

---

## 10. ShareModal (`ShareModal.tsx`)
- Portalled to `document.body`, `z-[9999]`; scrim `bg-black/50 dark:bg-black/80 backdrop-blur-sm p-4`, click on scrim closes; card `max-w-sm p-6 rounded-xl border shadow-2xl` (raised) `animate-in fade-in zoom-in-95 duration-200`.
- Header: "Share Song" `text-lg font-bold`, close X 20px.
- Song summary `p-3 rounded-lg mb-6`, fill `bg-zinc-50 dark:bg-black/30`: 48px `rounded` cover (plain img, NO fallback), title `font-medium truncate`, style `text-sm muted truncate`.
- Grid `grid-cols-4 gap-3`: 7 tiles `flex-col items-center gap-1.5 p-3 rounded-lg`, 20px glyph + `text-xs font-medium` label, `transition-colors`: X (black), Facebook (#1877F2), WhatsApp (#25D366), Telegram (#0088CC), Reddit (#FF4500), LinkedIn (#0A66C2), Email (zinc-600/700), Copy link (outlined, strong border, 20px Link icon -> green Check + "Copied" for 2 s; falls back to hidden textarea + execCommand). Brand colours are fixed (third-party marks; keep or drop for local-first, since every tile opens an outside site in a popup or mailto).
- Share URL `${origin}/song/<id>`; popups sized 550x420 (X, Facebook, LinkedIn), 800x600 (Reddit), new tab otherwise.
- Rebuild note for a private hub: keep only Copy link (+ maybe Email); social tiles contradict a local-only product.

---

## 11. Feedback and chrome

### ConfirmDialog (`ConfirmDialog.tsx`)
Scrim `fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm`, `fade-in 150ms`; click scrim or Esc cancels. Card `rounded-2xl shadow-2xl border max-w-sm mx-4 p-6`, raised fill, `zoom-in-95 fade-in 200ms`. Body `flex gap-3 mb-4`: when `danger` (default) a 40px circle `bg-red-500/10` with 20px AlertTriangle red-500; title `text-base font-semibold`; message `mt-1 text-sm muted leading-relaxed`. Footer `flex justify-end gap-3 mt-6`: Cancel `px-4 py-2 text-sm font-medium rounded-lg` neutral fill (`zinc-100 / zinc-800`, hover step); Confirm solid `red-600` hover `red-700` white (danger) or `blue-600` (non-danger; blue is off-palette, use accent). Default labels `t(cancel)` / `t(delete)`. No focus trap, no initial focus.

### Toast (`Toast.tsx`)
Top-centre pill: `fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-6 py-4 rounded-full shadow-2xl border`, always dark fill (`bg-zinc-900`), border tint by type at 50% (success green-500, error red-500, info blue-500), white text. 20px icon (CheckCircle green / AlertCircle red / AlertCircle blue), message `font-medium text-sm`, close X 16px `ml-2 hover:opacity-70`. Auto-dismiss 3000 ms default (`duration` prop; 0 = sticky). Motion `slide-in-from-top-4 fade-in duration-300`; no exit animation. Single instance, no stacking/queue, no action button, no progress.

### Generic states table
| State | Visual |
|---|---|
| Loading page | `w-4 h-4` spinner, 2px border, `border-t-transparent`, `animate-spin` + muted label, centred in page |
| Skeleton | `animate-pulse` blocks of `zinc-200 / zinc-800` |
| Error | console only in most places; titles show inline red-500 `text-xs`; fetch failure on search becomes empty list |
| Disabled | `opacity-50/60`, `cursor-not-allowed` |
| Focus | inputs: accent border (+ ring on search/rename); buttons have NO focus-visible ring (rebuild must add one) |
| Press | only `active:cursor-grabbing` on rows; no pressed styles elsewhere |

---

## 12. UserProfile (`UserProfile.tsx`)
```
┌ banner h-48 md:h-64 (image or gradient), fade to page colour at bottom ───────────────────────┐
│ [← Back pill]                                                              [image edit btn]   │
│   (avatar 96/160 ring-4 badge colour)  Name (2xl / 5xl)  badges...        [Edit profile]      │
│                                         bio / joined                                           │
│                                         ♪ 12 songs  ♡ 40 likes  👁 900 plays                  │
├ max-w-7xl px-4/8 py-6/8  space-y-8/12 ────────────────────────────────────────────────────────┤
│ Featured Songs  [156/192px square cards, horizontal scroll]                                   │
│ Songs                                               (Recent | Top)                            │
│ [row][row][row]  grid 1/2/3 cols                                                              │
│ Playlists                                           See more >   [cards]                      │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Banner: `relative group/banner`; image `bg-cover center` or random gradient by `username.length % 5` (purple-pink-red, blue-purple-pink, green-teal-blue, orange-red-pink, indigo-purple-pink) with a 40px grid SVG at 30% opacity; bottom fade `from-page via-page/20 to-transparent`. Back pill `top-4 left-4 px-4 py-2 rounded-full bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white/80`. Owner banner-edit button `opacity-0 group-hover/banner:opacity-100`.
- Avatar: `w-24 h-24 md:w-40 md:h-40 rounded-full border-4` (page colour) `shadow-2xl ring-4` coloured by primary badge (yellow/purple/blue/teal/green/orange/pink else zinc-500/50); fallback initial on gradient (`text-4xl md:text-6xl`); owner pencil badge `bottom-1 right-1 p-1.5` round. Paid tiers get a hover wiggle (`wiggle` keyframe is undefined, no effect) and the name uses a gradient text per badge colour (drop-shadow glow).
- Badges: pills `px-3.5 py-1.5 rounded-full text-xs font-semibold border` on gradients with glow shadow, emoji icon, hover `-translate-y-0.5 scale-[1.03] brightness-110`, `duration-200`.
- Stats strip: `text-sm pt-2 border-t mt-2 gap-4 md:gap-6`, 16px icon + bold number + muted label (songs, likes, plays).
- Featured cards: `w-36 md:w-48` (144/192px), square `rounded-lg`; hover or current: `bg-black/40` overlay + white disc `w-12 h-12 md:w-14 md:h-14`; image `hover:scale-105 duration-500`; playing: 4 pink bars (w-1, heights 12/16/8/20px, `animate-pulse`, 150 ms stagger); title accent when current; style line; Like heart 16px; counts row `text-xs` (Heart 12, Eye 12).
- Songs: segmented control `p-1 rounded-full bg-zinc-200 dark:bg-zinc-900`, active segment white with black text + `shadow-sm`, `px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-sm`. Grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4`; row `p-2 md:p-3 rounded-lg`, current = `bg-pink-50 dark:bg-pink-500/10`, else hover fill; cover `w-14 h-14 md:w-16 md:h-16 rounded-md` with hover/current dark overlay + 18-20px white Play/Pause (no disc) and 3 mini bars when playing; title `font-semibold text-sm md:text-base`, style, counts row (heart, plays, duration); right Like heart 18px (`hover:text-pink-500`).
- Empty songs: 64px Music icon `opacity-50` + "No public songs yet", `py-16`.
- Playlists: horizontal cards `w-36 md:w-48`, square indigo-600 -> purple-700 tile with 48/64px Music icon white/30, hover play disc; name, "N songs".
- Edit modal: `fixed inset-0 z-[60]` scrim as other modals; card `max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto`, sticky header/footer (`border-b/t`, footer fill `bg-zinc-50 dark:bg-black/20`). Fields: avatar (80px dashed circle preview + "Upload avatar" button `px-4 py-2 rounded-lg` + format hint), banner (full-width `h-32` dashed drop tile, click to upload, spinner overlay `bg-black/60` while uploading), bio textarea `rows 4` (focus border pink-500). Save = inverted pill `px-6 py-2 rounded-full font-bold` with spinner and label cycling Uploading avatar / banner / Saving / Save changes; Cancel ghost. Failure = `alert()`.
- Loading/not-found same as SongProfile.

---

## 13. Type scale used in these screens
`text-[8px]` badge on search cards; `[9px]` model badge; `[10px]` section kicker, copy links, duration chip; `[11px]` chips, search meta; `xs 12px` creator, tags, meta; `sm 14px` body, menu items; `base 16px` card titles (profile); `lg 18px` row title, section h2; `xl 20px`; `2xl 24px` details title; `3xl 30px` Library h1, SongProfile h1; `5xl 48px` Liked, Profile name, playlist title; `7xl 72px` playlist title lg. Weights: 400/500/600/700 Inter (800 `font-extrabold` on Liked h1 falls back to 700). Mono (`font-mono`, system mono) for durations, counts, lyrics.
Radii: 3px scrollbar, `rounded-sm` badge, `rounded` 4px (tiles, chips), `rounded-md` 6px (covers, tags), `rounded-lg` 8px (inputs, rows, buttons), `rounded-xl` 12px (menus, cards, modals, cover), `rounded-2xl` 16px (dialogs, tool strip, empty state), `rounded-full` (icons, pills, avatars).
Shadows: `shadow-sm` row covers; `shadow-lg` discs, share/cover; `shadow-2xl` menus, modals, hero cover.
Motion summary: colour/opacity hovers `transition-colors|opacity` (Tailwind default 150 ms, ease cubic-bezier(.4,0,.2,1)); cover hover overlay `duration-200`; hero cover zoom `duration-700` (details) / `500` (profile); modal in `200 ms`, menu `150 ms`, filter menu `100 ms`, toast `300 ms`, details slide-in `300 ms`; waveform `1s ease-in-out infinite`; playing bars `animate-pulse` (2 s, opacity); `hover:scale-105/110` on discs/FABs.

## 14. Gaps and rebuild recommendations (for Home)
1. Takes: render a "take group" (v1..vN of one generation) as one card with a horizontal strip of 2-4 take tiles (cover, play, waveform, like), selected take drives details; the source only offers separate rows named `(vN)` (generate.ts:423) with a model badge, so the group id must be added to the record.
2. Dislike is a dead button; either wire it (negative feedback record) or drop it.
3. Row actions are always visible (8 buttons); at phone width collapse to like + more.
4. Menu, toast, playlist page and ShareModal ignore the theme; menus must use `raised` tokens.
5. Missing: focus-visible rings, keyboard row navigation, empty-state for "no songs yet", delete confirm for uploads and playlist-song removal (ConfirmDialog exists but only delete-song flows use it, `window.confirm` for playlists).
6. Remote assets to remove: picsum covers (SongProfile, Playlist, Search), dicebear avatars, Google Fonts import, social share targets.
7. Hard-coded English: "Workspaces", "My Workspace", "Select", "Delete", "Clear all", "Select all", "All Songs", "Uploads", "No songs yet.", "Queue #", "Creating...", "Sources", "Reference", "Cover", "Play", "Similar".
