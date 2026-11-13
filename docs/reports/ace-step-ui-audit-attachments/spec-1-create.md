# Spec 1: the Create panel (ace-step-ui)

Source: `repo/components/CreatePanel.tsx` (2790 lines, cited as `CP:line`), `repo/components/EditableSlider.tsx` (`ES:line`), mount in `repo/App.tsx:1303-1384` (`App:line`), tokens in `repo/index.html:24-110` (`HTML:line`), strings in `repo/i18n/translations.ts` (`TR:line`), genre list `repo/data/genres.ts` + `data/main_style.txt` (105 lines).
Static read only; nothing was run. Where the code is odd or buggy it is flagged **[BUG]** or **[GAP]** so a rebuild can choose to fix instead of copy.

## 0. Conventions

**Tailwind to px** (default scale, root 16 px): 0.5=2, 1=4, 1.5=6, 2=8, 2.5=10, 3=12, 4=16, 5=20, 6=24, 9=36, 10=40, 11=44, 12=48, 14=56, 16=64, 20=80, 24=96, 32=128. Radii: `rounded`=4, `-md`=6, `-lg`=8, `-xl`=12, `-2xl`=16, `-full`=pill. Type: `text-[9px]`=9, `[10px]`=10, `[11px]`=11, `text-xs`=12/16 line, `text-sm`=14/20, `text-base`=16/24, `text-xl`=20/28. Body font Inter 400/500/600/700 (HTML:62-68). Line height of `[Npx]` sizes is inherited (preflight 1.5).

**Colour roles** (dark theme is default; light theme is the `else` half of each pair). Map each role to a theme token:

| Role | Light value | Dark value | Used for |
|---|---|---|---|
| `panel-surface` | zinc-50 `#fafafa` | suno-panel `#121214` | panel background, sticky footer (95% + blur) |
| `card-surface` | white | suno-card `#18181b` (audio card uses raw `#1a1a1f`, CP:1377) | every grouped card |
| `card-header-surface` | zinc-50 | white at 5% (audio card: 2%) | card title strip |
| `field-inset` | zinc-50 | black at 20% | select, number, text inputs inside cards; value chip behind slider numbers |
| `segment-track` | zinc-200 | black at 40% (tabs: zinc-200/50 and black/30) | pill/segmented container |
| `segment-active` | white + shadow-sm | zinc-800 (tab: zinc-700) | selected segment |
| `border-card` | zinc-200 | white at 5% | card outline |
| `border-divider` | zinc-100 | white at 5% | line under card header, between rows |
| `border-field` | zinc-200 | white at 10% | input outline |
| `text-primary` | zinc-900 | white | values, input text |
| `text-secondary` | zinc-600/700 | zinc-300/400 | labels on cards |
| `text-muted` | zinc-500 / zinc-400 | zinc-400 / zinc-500 | section headings, helper text |
| `text-placeholder` | zinc-400 | zinc-600 | placeholders |
| `accent` | pink-600 `#db2777` | same | selected fill (pills, toggles on, gender, bulk count 1) |
| `accent-focus` | pink-500 `#ec4899` | same | focus border, slider thumb/fill, spinner, loading icon, model check disc |
| `accent-gradient` | purple-600 end | same | play disc `from-pink-500 to-purple-600`, seek fill `from-pink-500 to-purple-500` |
| `cta-gradient` | orange-500 `#f97316` to pink-600 | same | Create button, selected bulk count |
| `source-gradient` | emerald-500 to teal-600 | same | Cover (source) play disc and seek fill (secondary accent) |
| `ai-accent` | violet-100 bg, violet-600 text | violet-500/20 bg, violet-400 text | Enhance ON chip |
| `status-ok` | green-500 dot, green-700 text on green-100 | green-500, green-400 text on green-900/30 | live dot, model Ready/Active badge, LoRA loaded |
| `status-bad` | red-500 dot, red-600 text, red-50 bg | red-500, red-400 text, red-900/20 bg | LoRA unloaded, LoRA error |
| `error-text` | rose-500 | rose-500 | upload errors (CP:2099, 2507) |
| `scrim` | black at 60% + blur-sm | same | modal backdrop |

No focus ring exists anywhere: every input uses `focus:outline-none` and only some swap the border to `accent-focus`. **[GAP]** Keyboard focus is invisible on buttons, toggles, chips and sliders. A rebuild needs one `:focus-visible` ring (2 px `accent-focus`, 2 px offset).

**Motion defaults.** Tailwind `transition-colors` / `transition-all` / `transition-transform` / `transition-opacity` = 150 ms, `cubic-bezier(0.4, 0, 0.2, 1)`. Toggle switches use `duration-200`. Root has `transition-colors duration-300` (CP:1063). `animate-pulse` = 2 s ease-in-out loop on opacity 1 to 0.5. `animate-spin` = 1 s linear loop. Nothing in the panel animates on mount: sections, the model menu, the advanced drawer and the audio modal all appear instantly (no height or fade transition). **[GAP]** Rebuild may add 150 ms fade/height; the original does not.

## 1. Mount and frame

Parent column (App:1305-1308): phone `w-full`; `md` (768) `w-[320px]`; `lg` (1024) `w-[360px]`; `flex-shrink-0 h-full`, right edge `border-r` 1 px (`border-divider`), `panel-surface`, `relative z-10`, colour transition 300 ms. On phone the column is hidden when `mobileShowList` is true (`hidden md:block`); a floating pill `Create Song` / `View List` at `absolute top-4 right-4 z-50` toggles (App:1376-1384; pill: `bg-zinc-800 text-white px-4 py-2 rounded-full text-sm font-bold`), which is why the panel has `pt-14` (56 px) on phone and `md:pt-4` (16 px).

Panel root (CP:1061-1066): `relative flex flex-col h-full w-full overflow-y-auto custom-scrollbar` (class `custom-scrollbar` is not defined anywhere; the global 6 px scrollbar rules apply instead, HTML:72-93: track transparent, thumb 6 px wide radius 3, zinc-300 light / zinc-700 dark, hover zinc-400 / zinc-600). Whole panel is a drag-and-drop target (`onDrop`, `onDragOver`).

Inner content (CP:1089): `p-4 pt-14 md:pt-4 pb-24 lg:pb-32 space-y-5`. That is 16 px side/top padding, 56 px top on phone, bottom 96 px (phone/tablet) or 128 px (`lg`) so content clears the 64-ish px bottom player bar, 20 px between top-level blocks.

Block order, top to bottom:
1. Header row (status, Simple/Custom, model)
2. Simple branch OR Custom branch
3. Common settings (instrumental toggle in Simple; language+gender in Custom)
4. LoRA (Custom only)
5. Music Parameters card (both modes, see **[BUG]** in section 5)
6. Advanced Settings accordion
7. Sticky footer with Create

```
WIDE (md 320 px / lg 360 px column, content width 288 / 328 after 16 px gutters)
+------------------------------------------+
| (o) ACE-Step v1.5      [Simple|Custom][1.5T v] |   header, 38 px tall
|                                          |
| +--------------------------------------+ |
| | AUDIO              [Reference|Cover] | |   card (Custom)
| | [ player row, only when audio set ]  | |
| | [ From library ]  [ Upload ]         | |
| +--------------------------------------+ |
| +--------------------------------------+ |
| | LYRICS  Leave empty ...  [Vocal][*][T]| |
| | monospace textarea 144 px (resizable) | |
| |                 ==== handle ====      | |
| +--------------------------------------+ |
| | STYLE OF MUSIC [* OFF]     [d][T][*] | |
| | textarea 80 px                       | |
| | (tag)(tag)(tag)(tag)(tag)(tag)       | |
| +--------------------------------------+ |
| | TITLE                                | |
| | Name your song                       | |
| +--------------------------------------+ |
|  VOCAL LANGUAGE       VOCAL GENDER       |
|  [English        v]   [Male] [Female]    |
|  [ LoRA                              v ] |
|  +- MUSIC PARAMETERS -----------------+  |
|  | BPM                          [Auto] |  |
|  | ---o-------------------------      |  |
|  | Key [Auto v]      Time [Auto v]     |  |
|  [ Advanced Settings                 v ] |
|                                          |
| ======= sticky footer =================== |
| [        * Create                     ]  |   48 px
+------------------------------------------+

PHONE (<768 px, panel full width, content width = viewport - 32)
 top 56 px reserved for the floating "View List" pill (right aligned)
 same stack, same card widths; two-column rows (language/gender, key/time,
 top-K/top-P, repainting start/end, ...) keep 2 columns (grid-cols-2 gap-3)
 and are tight below 360 px viewport (each col ~ 148 px at 360).
 Footer button is full width; panel scrolls inside the column, not the page.
```

## 2. Header row (CP:1123-1206)

Container `flex items-center justify-between`, no wrap. **[GAP]** At 320 px column the right cluster (about 150 px mode toggle + 8 gap + about 56 px model button) plus the left label (about 105 px) is 319 px for 288 px of room; it relies on text shrinking and is cramped. A rebuild should let the status label hide under 360 px.

| Element | Spec |
|---|---|
| Live dot | `w-2 h-2` (8 px) circle, `status-ok`, `animate-pulse`. Always green: it does not reflect backend state. CP:1126 |
| Version label | text `ACE-Step v1.5` hard-coded (not i18n), 12/16, weight 500, `text-muted`. gap-2 (8) from the dot. CP:1127 |
| Mode toggle container | `flex items-center bg segment-track rounded-lg (8) p-1 (4)` + 1 px `border` (zinc-300 light, white/5 dark). CP:1132 |
| Mode button | `px-3 py-1.5` (12/6), `rounded-md` (6), 12 px weight 600. Active: `segment-active` + `text-primary` (black light, white dark) + `shadow-sm`. Inactive: `text-muted` (zinc-500), hover `zinc-900`/`zinc-300`. Transition `all` 150 ms. Labels `Simple` / `Custom` (TR:95-96). Default **Custom** (`customMode=true`, CP:136). No `aria-pressed`. |
| Model button | `bg segment-track border border(zinc-300 / white/5) rounded-md (6) px-2 py-1` (8/4), 11 px weight 500, `text-primary`, `ChevronDown` 10 px `text-secondary`, `gap-1`. Hover bg one step stronger (zinc-300 / black/50). Disabled (no models) shows `...`. Shows short name: 1.5B base, 1.5S sft, 1.5T turbo, 1.5TS1, 1.5TS3, 1.5TC; unknown ids shown raw. CP:1149-1156, 256-267 |
| Model menu | `absolute top-full right-0 mt-1` (4 px gap) `w-72` (288 px) `rounded-xl` (12) `shadow-2xl` `overflow-hidden z-50`, bg white / zinc-900, 1 px border zinc-200 / zinc-700. Inner `max-h-96` (384) scroll. Closes on outside `mousedown` (CP:343-354) or on pick. No Escape handling. **[GAP]** |
| Menu row | `w-full px-4 py-3` (16/12), left aligned, hover zinc-100 / zinc-800, selected zinc-50 / zinc-800 at 50%, `border-b` zinc-100 / zinc-800, last row none. Line 1: name 14/20 weight 600 `text-primary` + optional badge `px-1.5 py-0.5 rounded text-[9px] bold`, `status-ok` tint, text `● Active` or `● Ready` (only when the backend reports `is_preloaded`; Active when `is_active`). Line 2: raw model id 12 px `text-muted`. Selected row shows a 16 px `accent-focus` disc with a white 12 px check at the right of line 1. CP:1162-1199 |
| Pick side effects | stores `ace-model` in localStorage; if model id lacks `turbo` set steps=20 and ADG=true (CP:1169-1172); otherwise leaves values. Unloads any LoRA (CP:357-362). Panel re-reads `/api/generate/models` after every generation and force-selects the backend-active model (CP:557-608), so the user's pick is overridden after each run. **[BUG-ish]** |
| Fallback list | when fetch fails: base, sft, turbo, turbo-shift1, turbo-shift3, turbo-continuous (CP:241-251) |

## 3. Simple mode (CP:1208-1368)

`space-y-5` wrapper. Three blocks then the Instrumental row from the common area.

```
+--------------------------------------+
| DESCRIBE YOUR SONG              [dice]|  header 37 px
|--------------------------------------|
| A happy pop song about summer ...    |  textarea 128 px
|                                      |
+--------------------------------------+
 VOCAL LANGUAGE          VOCAL GENDER
 [ English         v]    [ Male ][ Female ]
+--------------------------------------+
| (sliders) QUICK SETTINGS             |
| Duration                      [Auto] |
| --o----------------------------      |
| BPM                           [Auto] |
| --o----------------------------      |
| Key [Auto v]       Time [Auto v]     |
| Variations                       [1] |
| --o----------------------------      |
+--------------------------------------+
 (note) Instrumental                 (toggle)
```

**3.1 Description card (CP:1212-1242).** `card-surface`, `rounded-xl` 12, 1 px `border-card`, `overflow-hidden`. Header strip `px-3 py-2.5` (12/10), `card-header-surface`, bottom 1 px `border-divider`, flex between. Title `DESCRIBE YOUR SONG` (TR:322): 12 px, weight 700, uppercase, tracking-wide (0.025em), `text-muted`. Dice button `p-1` (4) `rounded-md`, icon 14 px, `text-muted` zinc-400, hover `text-secondary` + bg zinc-200 / white at 10%, 150 ms. Tooltip "Load random description" (hard-coded). Click calls `getRandomDescription`, fills description, sets instrumental and language (`unknown` if the API returns none); silent on failure (console only, no loading state, no error UI). **[GAP]** Textarea `w-full h-32` (128) transparent, `p-3` (12), 14/20, `text-primary`, placeholder `A happy pop song about summer adventures with friends...` (`text-placeholder`), `resize-none`, no focus border change (card has none either in Simple). Empty default `''`. No character limit, no counter.

**3.2 Language + gender** (CP:1245-1281). `grid grid-cols-2 gap-3` (12 px column gap). Each column `space-y-1.5` (6 px label to control). Label 12 px 700 uppercase tracking-wide `text-muted`, `px-1` (4). Select: full width, `card-surface`, `border-card`, `rounded-xl`, `px-3 py-2` (12/8), 14 px, height 38 px, pointer cursor, focus: border becomes `accent-focus` (150 ms), native arrow, options styled white / zinc-800 (the `[&>option]` classes). Default `en`. First option value `unknown` labelled "Auto / Instrumental" (TR:129); then 50+ ISO codes in alphabetical-by-code order (CP:58-111, label keys `vocalArabic` ... ). Gender: two `flex-1` buttons, `gap-2`, `px-3 py-2` (34 px tall), `rounded-lg` (8), 12 px 600, 1 px border. Off: border zinc-200 / white at 10%, text zinc-600 / zinc-300, hover border zinc-300 / white at 20%. On: `accent` fill, white text, border `accent`. Click the active one again to clear (default none). Gender is not sent as a field: it is appended to the style as `Male vocals` / `Female vocals` on a new line (CP:969-974).

**3.3 Quick Settings card** (CP:1284-1366): `card-surface` `rounded-xl` border `p-4` (16) `space-y-4` (16). Heading: 12 px 700 uppercase tracking-wide `text-muted`, `flex items-center gap-2`, 14 px `Sliders` icon, text `QUICK SETTINGS`. Contains, in order:
- Duration slider: min -1, max `activeMaxDuration` (thinking ? maxWithLm : maxWithoutLm, both default 240, overwritten by `/api/generate/limits`), step 5, display `Auto` at -1 else `<n>s`. Default -1. Panel clamps duration down when the max shrinks (CP:612-616). Note -1 to 5 jumps by 6 on first click: the range starts at -1 and steps by 5 from there (values -1, 4, 9, ...) **[BUG]**: typed values are free, slider values never land on round numbers.
- BPM slider: 0 to 300, step 5, `Auto` at 0. Default 0. Label hard-coded "BPM" and "Auto" here, i18n in the advanced card.
- Key / Time selects (grid 2 cols, gap 12, `space-y-1.5`): label 12 px weight 500 `text-secondary`; select `field-inset`, `border-field`, `rounded-xl`, `px-2 py-1.5` (8/6), 12 px, 30 px tall, focus border `accent-focus`. First option `Auto` (value ''). Key list: 12 pitch names with sharp/flat spellings x major/minor (CP:30-49, 34 entries). Time: 2, 3, 4, 6, N/A (CP:51). **[BUG]** Here `onChange={setKeyScale}` / `{setTimeSignature}` (CP:1322, 1335) hand the change event, not the value, to the state setter, so choosing a key stores an Event object. The Advanced copy (CP:1858, 1871) is correct. Rebuild: always `e.target.value`.
- Variations slider: 1 to 4, step 1, default `batchSize` (localStorage `ace-batchSize` via init, CP:159-162). Followed by a `display:none` duplicate range input and help text (CP:1354-1365, wrong `onChange`). Dead code, drop it.

**3.4 Instrumental row** (CP:1685-1696, Simple only): `flex justify-between px-1 py-2`, left `Music2` 14 px `text-muted` + label `Instrumental` 14 px weight 500 `text-secondary`, gap 8. Switch: **44 x 24** (`w-11 h-6`), pill, `px-1` padding, 1 px border (zinc-200 / white at 5%). Off: zinc-300 / black at 40%. On: `accent`. Knob 16 px white disc, `shadow-sm`, `translate-x-5` (20 px) when on, `transition-transform 200 ms`, track `transition-colors 200 ms`. **[BUG]** inside content width 34 px the knob travels 20 and overshoots by 2 px (rests 3 px from the right edge vs 5 px left). Default off.

## 4. Custom mode (CP:1370-1679)

`space-y-5`. Four cards: Audio, Lyrics, Style, Title. Defaults: lyrics `''`, style `''`, title `''`, instrumental false.

```
AUDIO CARD
+--------------------------------------+
| AUDIO              ( Reference | Cover )|  px-3 py-2.5 strip
|--------------------------------------|
|  p-3 / space-y-2                     |
| (o)  Song name.mp3             (x)   |  player row (only if set)
| 3:21 0:42 [=====o-----------] 3:21   |
| [ (note) From library ][ (up) Upload ]|
+--------------------------------------+
```

### 4.1 Audio card, reference and cover (CP:1374-1545)
Card: `rounded-xl`, border `border-card`, `overflow-hidden`, surface `#1a1a1f` dark (slightly off the other cards, use `card-surface`). The whole card is a drop target: `onDrop` uploads the dropped file to the active tab (CP:932-950). Header strip `px-3 py-2.5`, `card-header-surface` (white at 2% dark), 1 px `border-divider` bottom. Title `AUDIO` 12 px 700 uppercase tracking-wide `text-muted`.
- **Tab switch** (`Reference` | `Cover`): container `bg segment-track (zinc-200/50, black/30) rounded-lg p-0.5 (2)`, `gap-1`. Tab `px-2.5 py-1` (10/4), `rounded-md`, 11 px weight 500, 150 ms all. Active: `segment-active` (white / zinc-700), `text-primary`, `shadow-sm`. Inactive: zinc-500 / zinc-400, hover zinc-700 / zinc-200. Default `reference`. Reference = style conditioning; Cover = source audio to transform (also flips `taskType` text2music to `cover` when a source is set, CP:908-910).
- Body `p-3 space-y-2`.
- **Player row** (only when that tab has a URL): `flex items-center gap-3 p-2`, `rounded-lg`, bg zinc-50 / white at 3%, border zinc-100 / white at 5%.
  - Play disc: 40 px circle (`w-10 h-10`), `accent-gradient` (Reference, 135 deg pink-500 to purple-600) or `source-gradient` (Cover, emerald-500 to teal-600), white glyph 16 px (play has `ml-0.5` optical nudge; pause is two bars), `shadow-lg` tinted 20% of the gradient colour (`shadow-pink-500/20` / `shadow-emerald-500/20`), hover `scale-105` 150 ms. Duration badge pinned bottom-right (`-bottom-1 -right-1`): 8 px bold white on zinc-900, `px-1 py-0.5 rounded`.
  - Name: 12 px weight 500 `text-primary` (zinc-800 / zinc-200) truncate, `mb-1.5` (6). Falls back to a label parsed from the URL.
  - Seek row: `gap-2`, elapsed and total in 10 px `tabular-nums` zinc-400; track `h-1.5` (6) `rounded-full` zinc-200 / white at 10%, click-to-seek (no drag, no keyboard); fill gradient `to-r` (pink-500 to purple-500, or emerald-500 to teal-500), `transition-all` 150 ms; thumb 10 px white disc `shadow-md` revealed only on track hover (`opacity-0 group-hover/seek:opacity-100`, 150 ms).
  - Clear button: `p-1.5` `rounded-full`, 14 px X, zinc-400, hover zinc-600/white and bg zinc-200 / white at 10%. Resets URL, title, time, duration. No confirm.
- **Action buttons** (`flex gap-2`): "From library" (music-note icon) and "Upload" (tray-up icon), each `flex-1`, centered, `gap-1.5` (6), `px-3 py-2` (34 px tall), `rounded-lg`, 12 px weight 500, icon 14 px, bg zinc-100 / white at 5%, hover zinc-200 / white at 10%, text zinc-700 / zinc-300, 1 px `border` zinc-200 / white at 5%. "From library" opens the Reference modal (section 8) on the Uploaded tab; "Upload" clicks a hidden `<input type=file accept="audio/*">` for the active tab. Uploading from here posts to `/api/reference-tracks`, sets the URL, then (if Whisper is available) transcribes. No uploading/loading state shows on the card itself; the busy states only render inside the modal. **[GAP]**
- **Empty state:** no player row, just the two buttons. No helper text.
- **Drag overlay** (CP:1067-1088): while a file or an in-app audio drag (`application/x-ace-audio`) is over the window, `absolute inset-0 z-[90] pointer-events-none`: scrim white at 70% / black at 50% + `backdrop-blur-sm`, centered card `rounded-2xl` `px-6 py-5` `gap-2` `shadow-xl`, bg white / zinc-900 at 90%, 1 px `border-card`. Inside (file drag only) a 48 px gradient disc (pink-500 to purple-600) with a 22 px upload icon and `shadow-lg`; title 14 px 600 "Drop to upload" or "Drop to use audio"; sub 11 px `text-muted` "Uploading as reference / cover" or "Using as ...". No fade.

### 4.2 Lyrics card (CP:1547-1600)
```
+--------------------------------------+
| LYRICS                 (Vocal) [*] [T]|
| Leave empty for instrumental ...      |
|--------------------------------------|
| [Verse 1]  monospace 14 px           |
| ...                                  |
|              ====                    |  12 px handle strip over the bottom
+--------------------------------------+
```
Card: `card-surface`, `rounded-xl`, 1 px `border-card`, `overflow-hidden`, `relative flex flex-col`, `transition-colors`. **Focus-within** (any child focus) border goes `zinc-400` light / white at 20% dark, 150 ms. Header strip `flex justify-between px-3 py-2.5 card-header-surface border-b border-divider flex-shrink-0`. Left: `LYRICS` (12 px 700 uppercase tracking-wide `text-muted`) over helper `Leave empty for instrumental or toggle below` (11 px, zinc-400 / zinc-500, `mt-0.5`). Right cluster `flex gap-2`:
- **Vocal/Instrumental pill:** `px-2.5 py-1` (10/4), `rounded-full`, 10 px weight 600, 1 px border. Shows `Vocal` when off (bg `card-surface`, border zinc-200 / white at 10%, text zinc-600 / zinc-200, hover zinc-100 / white at 10%) and `Instrumental` when on (`accent` fill, white, border pink-500). The label is the current state, not the action. Toggles `instrumental`.
- **AI Format button** (sparkles): `p-1.5` (6) `rounded` (4), icon 14 px, `text-muted` zinc-500, hover black/white + bg zinc-200 / white at 10%. Tooltip "AI Format - Enhance style & auto-fill parameters" (hard-coded). Loading: icon swaps to `Loader2` with `animate-spin`, colour `accent-focus`. `disabled` while loading or when **style** is empty (CP:1573; even for lyrics, because the API needs a caption). No disabled styling, no visible reason. **[GAP]** On success writes lyrics (and BPM, duration, key, time, language) from the LLM; on failure a native `alert()` (CP:726, 730). Rebuild: inline error row.
- **Clear (trash) button:** same box; sets lyrics `''`. No confirm, no undo.
- **Textarea:** `w-full`, transparent, `p-3`, 14/20 **monospace** with `leading-relaxed` (1.625 = 22.75 px), `text-primary`, placeholder `Your lyrics here...`, `resize-none`, no outline. Height = state `lyricsHeight` px, default **144** (`h-36`), persisted in localStorage `acestep_lyrics_height` (CP:334-337). Instrumental on: `disabled`, `opacity-30`, `cursor-not-allowed`, placeholder becomes "Instrumental mode". Text is kept but ignored by the user view. **[GAP]** the real send still includes lyrics while instrumental is on (CP:990-991 sends `lyrics` unchanged); the backend decides.
- **Resize handle:** absolutely positioned at the card bottom, `h-3` (12) full width, `cursor-ns-resize`, flex-centered 32x4 (`w-8 h-1`) `rounded-full` bar in zinc-300 / zinc-700; hover bg zinc-100 / white at 5%, 150 ms. Drag logic: mousedown starts, window mousemove sets height = pointerY - card top **including the header** (so the textarea is about 56 px shorter than the pointer implies), accepted only within 96 to 600 px (CP:511-555); mouseup saves. **[BUG]** the saved value is the stale closure `lyricsHeight`, so the last drag step is lost; body cursor forced to `ns-resize` and `user-select:none` during drag. Mouse only, no touch, no keyboard. **[GAP]** phone cannot resize.
- Structure tags (`[Verse]` etc.) are plain text; no toolbar. There is no word/line count.

### 4.3 Style card, genre chips (CP:1602-1663)
Same card shell as Lyrics (focus-within border). Header strip `justify-between px-3 py-2.5`. Left column: row 1 `STYLE OF MUSIC` label + **Enhance chip**; row 2 helper `Genre, mood, instruments, vibe` 11 px.
- **Enhance chip:** `flex items-center gap-1 px-1.5 py-0.5 rounded` (6/2/4), 10 px weight 500, 9 px sparkles icon, text `ON` / `OFF`. Off: `text-muted` (zinc-400 / zinc-500), hover zinc-600 / zinc-300. On: `ai-accent`. 150 ms all. Tooltip `enhanceTooltip` (TR:270): uses the language model to expand tags into a description and fill BPM/key/time; adds 10-20 s; no extra VRAM. Default off.
- Right cluster `flex gap-1`: Dice (refresh genre suggestions, tooltip `Refresh genre suggestions`), Trash (clear style), Sparkles (AI Format for style; same states as 4.2, on success also sets `isFormatCaption=true`). All `p-1.5 rounded` 14 px icons.
- Textarea `h-20` (80), `p-3`, 14/20 sans, placeholder `e.g. upbeat pop rock, emotional ballad, 90s hip hop`, `resize-none`.
- **Chip row** `px-3 pb-3 space-y-3` > `flex flex-wrap gap-2` (8 both axes). **6 random chips** drawn from `MAIN_STYLES` (105 lowercase genre names, e.g. "bedroom pop", "bossa nova"); re-shuffled by the Dice (`Math.random` sort, so not a uniform shuffle). Initial 6 chosen on mount. Chip: `px-2.5 py-1`, `rounded-full`, 10 px weight 500, bg zinc-100 / white at 5%, text zinc-600 / zinc-400, hover bg zinc-200 / white at 10% and text black / white, 1 px border zinc-200 / white at 5%, 150 ms colour. Click appends `, <tag>` to the style (or sets it when empty). Chips never show a selected state, are never removed when added, and duplicates are allowed. **[GAP]** Rebuild: show selected state and toggle-remove. Chip text stays as typed in the data file (lowercase).

### 4.4 Title card (CP:1665-1677)
Card shell without focus-within. Header `px-3 py-2.5` strip with `Title` text (TR:102: label text is "Title" but uppercased by the CSS class, 12 px 700 tracking-wide `text-muted`). Input `type=text`, full width, transparent, `p-3` (12), 14 px (about 44 px tall), placeholder `Name your song`. Empty title is allowed; bulk mode appends ` (1)`, ` (2)` (CP:993). There is no validation and no maximum length. The title input is not shown in Simple mode, so Simple songs have an empty title.

## 5. Common area, LoRA and Music Parameters

**5.1 Vocal language + gender, Custom** (CP:1700-1738): identical markup and states to 3.2, but rendered only when `!instrumental`. The instrumental pill hides the whole row (no animation, layout jumps up 62 px).

**5.2 LoRA** (Custom only, CP:1741-1831). Closed row: full-width button `px-4 py-3` (16/12), `card-surface`, `rounded-xl`, 1 px `border-card`, 14 px weight 500 `text-secondary`, hover bg zinc-50 / white at 5%. Left: `Sliders` 16 px (`text-muted`) + `LoRA`. Right: `ChevronDown` 16 px, `rotate-180` when open, `transition-transform` 150 ms. Open panel: `card-surface rounded-xl border p-4 space-y-4`:
1. Path input: label `LoRA Path` (12 px weight 500), `field-inset`, `rounded-lg` (8), `px-3 py-2`, 12 px, focus border `accent-focus`. Default `./lora_output/final/adapter`, placeholder from `loraPathPlaceholder`.
2. Status row (`py-2`, top 1 px `border-divider`): 8 px dot (`status-ok` pulsing when loaded, `status-bad` static when not) + text "LoRA loaded / unloaded" 12 px weight 500 in the same role; button right: `px-4 py-2` `rounded-lg` 12 px 600, `transition-all`. Unloaded: bg zinc-100 / zinc-800, text zinc-600 / zinc-400, hover zinc-200 / zinc-700, label `Load`. Loaded: gradient green-500 to emerald-600, white, `shadow-lg shadow-green-500/20`, hover one step darker, label `Unload`. Loading: label `...`, disabled; disabled also when the path is blank (`opacity-40 cursor-not-allowed`). Error: block under the row, `text-xs`, red text + red-50 / red-900 at 20% bg, `px-2 py-1 rounded`.
3. "Use LoRA" checkbox row (`py-2`, top border, `accent-pink-600` native checkbox, label 12 px); whole row `opacity-40 pointer-events-none` until loaded. Default on.
4. Scale slider (EditableSlider, 0 to 1, step 0.05, display 2 decimals, help `loraScaleDescription`), wrapper `opacity-40 pointer-events-none` unless loaded and enabled. Default 1.0.
Side effects: loading a LoRA forces Thinking off and ADG off (CP:364-370); changing the model unloads it. Handlers CP:373-446 (not specified here: engine spec).

**5.3 Music Parameters card** (CP:1834-1881): shown in **both** modes (not gated). `card-surface rounded-xl border p-4 space-y-4`. Heading `Music Parameters` with 14 px `Sliders` icon (12 px bold uppercase tracking-wide `text-muted`), a BPM EditableSlider (0 to 300, step 5, `Auto` at 0) and Key/Time selects (correct handlers). **[BUG]** In Simple mode this duplicates the BPM / Key / Time already in Quick Settings; both bind the same state so they stay in sync but the screen shows them twice. Rebuild: show once.

## 6. EditableSlider (ES:1-105)

Props: `label, value, min, max, step, onChange, formatDisplay?, helpText?, title?, autoLabel='Auto'`. Local state `inputValue` (string) and `isEditing`; a `useEffect` resyncs the string when not editing.

```
Label                        [ value chip ]      row: flex justify-between items-center
[=====o-----------------------------]            native range, h-2 (8 px)
help text 10 px                                  optional
```
- Wrapper `space-y-2` (8 px between rows).
- Label: `<label>` 12 px weight 500 `text-secondary` (zinc-600 / zinc-400), tooltip `title`. Not wired to the range (no `htmlFor`). **[GAP]**
- **Value chip (read state):** `<span>` 12 px monospace `text-primary`, `field-inset` (zinc-100 / black at 20%), `px-2 py-0.5` (8/2) `rounded` (4), `cursor-pointer`, hover bg zinc-200 / black at 30%, 150 ms colour. Text = `formatDisplay(value)` or, when value equals `min` and an `autoLabel` is set, `Auto`, else the number. (So a 1..4 slider at 1 shows "Auto" unless the caller passes `formatDisplay`: Variations at 1 reads `Auto`; **[BUG]**.) Click enters edit mode. It is a span, not a button: no keyboard access. **[GAP]**
- **Edit state:** swaps to `<input type=number>` with `min max step`, `autoFocus`, `w-20` (80 px), 12 px mono right-aligned, same inset bg, `px-2 py-0.5`, `rounded`, 1 px `accent-focus` border, no outline, spin buttons hidden. Commit on blur or Enter: parse float, clamp to min..max, call `onChange`, write back the clamped string; invalid text reverts. Escape reverts. Note clamping uses the clamp bounds, not the step; typed values off-step are accepted (e.g. BPM 97).
- **Range:** `w-full h-2` (8) `rounded-lg` `appearance-none` `cursor-pointer` `accent-pink-500` (native thumb in accent). Track zinc-200 / zinc-700. Note `appearance-none` without custom thumb/track CSS means the browser may render nothing visible in some engines; in Chrome the accent-colour is lost, leaving a flat bar with a default thumb. **[GAP]** Rebuild: custom track (6 px) + 16 px thumb, filled portion in `accent`.
- **Help text:** `<p>` 10 px `text-muted` (zinc-500), no margin (sits `space-y-2` below).
- States: hover (chip only), focus (edit input border only), active (native), disabled: not supported by the component; LoRA wraps in `opacity-40 pointer-events-none`. Error: none (silent clamp). Loading: none.
- Used: Duration, BPM, Variations (Simple); Variations/Batch size, Duration, Inference steps, Guidance, Shift, LoRA scale, LM temperature, CFG scale, Top-K, Top-P (Advanced).

## 7. Advanced Settings (CP:1883-2438)

Closed row: same as the LoRA row (`px-4 py-3`, `Settings2` 16 px icon + `Advanced Settings` label, chevron rotates 180 deg, 150 ms). Default closed. Open: `card-surface rounded-xl border p-4 space-y-4` containing, in order (every row `space-y-1.5` for label+control unless stated; small field = `field-inset`, `border-field`, `rounded-lg`, `px-3 py-2`, 12 px, no focus border):

| # | Control | Type, range, default | Notes |
|---|---|---|---|
| 1 | Load Parameters (JSON) | dashed button-label, `px-3 py-2 rounded-lg`, 1 px dashed border zinc-300 / white at 15%, 12 px weight 500, upload icon 14 px, hover bg zinc-50 / white at 5% | `accept=.json`; reads keys lyrics, style/caption, title, instrumental, vocal_language, bpm, key_scale, time_signature, duration, inference_steps, guidance_scale, audio_format, infer_method, seed (turns random seed off), shift, lm_*, task_type, audio_codes, repainting_*, instruction, audio_cover_strength; bad JSON is a console error only. CP:447-491 |
| 2 | Duration | slider -1 to 600, step 5, default -1 (shows `Auto`, else `Ns`); help "Auto - 10 min" | note max 600 here vs `activeMaxDuration` in Simple |
| 3 | Batch size | slider 1 to 4, default from localStorage or 1; help `numberOfVariations`; tooltip about total time | reads "Auto" at 1 (see 6) |
| 4 | Bulk generate | label + mono chip `<n> job(s)`; row of 5 buttons **1 2 3 5 10** `flex-1 gap-1 py-2 rounded-lg 12 px 700`; help `queueMultipleJobs` | selected: `cta-gradient` + `shadow-md` + white; others zinc-100 / zinc-800, text zinc-600 / zinc-400, hover zinc-200 / zinc-700. Persists `ace-bulkCount`; **resets to 1 after each Create** (CP:1056-1058) |
| 5 | Inference steps | slider 1 to 20 on turbo models, 1 to 200 otherwise, default 12; help `moreStepsBetterQuality` | |
| 6 | Guidance scale | slider 1 to 15, step 0.1, default 9.0, shows 1 decimal | |
| 7 | Audio format / Infer method | 2-col selects (`rounded-xl px-2 py-1.5`, 12 px, focus border) | format `mp3` (default, "MP3 (smaller)") / `flac`; method `ode` (default, deterministic) / `sde` |
| 8 | LM backend | select `pt` (default) / `vllm`, hint 10 px | no focus border |
| 9 | LM model | select 0.6B (default) / 1.7B / 4B; persists `ace-lmModel` | hint 10 px |
| 10 | Seed | row: `Dices` 14 px + `Seed` label; switch **40 x 20** (`w-10 h-5`, `px-0.5`, knob 16, travel 20 = flush to right edge); below: `Hash` icon + `type=number` input (flex-1, `rounded-lg px-3 py-1.5`) + help text | default random on, seed -1; input `disabled` while random (`opacity-40 cursor-not-allowed`); help flips between `randomSeedRecommended` and `fixedSeedReproducible`. In bulk runs only the first job uses the typed seed, rest are random (CP:977-985) |
| 11 | Thinking (CoT) | switch 40x20 | default **off**; disabled and dimmed (`opacity-50 cursor-not-allowed`, label zinc-400/600) when a LoRA is loaded; row has top 1 px divider and `py-2` |
| 12 | Shift | slider 1 to 5, step 0.1, default 3.0, 1 decimal; help "timestep shift for base" | |
| | **Expert controls** divider | top border zinc-200 / white at 10%, `pt-4`, label 10 px bold uppercase tracking-wide `text-muted` | |
| | Upload error | 11 px `error-text` line (if set) | |
| 13 | LM Parameters sub-accordion | button `px-4 py-3`, bg white at 60% / black at 20%, border zinc-200 at 70% / white at 10%, `Music2` icon + two-line label (title + 11 px helper "control lyric generation"), chevron | when open: sub-card with temperature slider 0 to 2 step 0.1 default 0.8 (2 decimals); CFG scale 1 to 3 step 0.1 default 2.2; Top-K 0 to 100 (default 0) and Top-P 0 to 1 step 0.01 default 0.92 side by side in `grid-cols-2 gap-3` (each slider only about 130 px wide on a 288 px column); negative prompt textarea `h-16 p-2` default `NO USER INPUT` |
| 14 | Transform heading | 12 px bold uppercase + 11 px helper | |
| 15 | Audio codes | textarea `h-16 p-2` + two small buttons (**Convert to Codes**, **Transcribe**) `px-2 py-1 rounded text-[10px] weight 500`, bg zinc-100 / zinc-800, disabled `opacity-40` | both buttons only `console.log` (placeholders for a missing endpoint, CP:2195-2220). **[BUG]** Convert is enabled when a source exists but does nothing |
| 16 | Task type | select `text2music` (default), `audio2audio`, `cover`, `repaint` | |
| 17 | Audio cover strength | number 0 to 1 step 0.01, default 1.0 | |
| 18 | Repaint start / end | numbers, step 0.1, defaults 0 and -1 (-1 = end of clip), 2 cols | there is no waveform or region picker; the user types seconds. There is no hint that -1 means "to the end". **[GAP]** |
| 19 | Instruction | textarea `h-16`, default "Fill the audio semantic mask based on the given conditions:" | |
| 20 | Guidance heading | "Advanced CFG scheduling" | |
| 21 | CFG interval start / end | numbers 0 to 1 step 0.01, defaults 0.0 and 1.0 | |
| 22 | Custom timesteps | text, placeholder from `timestepsPlaceholder` | comma list |
| 23 | Score scale / LM batch chunk size | numbers: 0.01 to 1 step 0.01 default 0.5; 1 to 32 step 1 default 8 | |
| 24 | Track name | select: None + woodwinds, brass, fx, synth, strings, percussion, keyboard, guitar, bass, drums, backing_vocals, vocals | |
| 25 | Complete track classes | 12 native checkboxes (`accent-pink-600`), `flex-wrap gap-2`, label 10 px weight 500 `text-muted`, `gap-1` | stored as comma string |
| 26 | 10 checkboxes in `grid-cols-2 gap-3` | Use ADG (default off), Allow LM batch (on), CoT metas (on), CoT caption (on), CoT language (on), Autogen (off), Constrained decoding debug (off), Format caption (off), Get scores (off), Get LRC lyrics (off) | label 12 px weight 500 `text-secondary`, `gap-2`; the ADG checkbox has no `accent-pink-600` (browser default blue) **[BUG]**. ADG forced off if a LoRA loads |

All number inputs and textareas here have no error state, no range enforcement beyond native `min/max`, no units. Tooltips come from `title` attributes (not touch accessible).

## 8. Reference / Cover modal (CP:2441-2768)

Opened by "From library" with the current tab as target (`openAudioModal`, CP:740-746, also fetches `/api/reference-tracks`). Overlay `fixed inset-0 z-[120] flex items-center justify-center`; scrim `absolute inset-0` black at 60% + `backdrop-blur-sm`, click closes (and stops playback). Dialog `relative w-[92%] max-w-lg` (512 px max) `rounded-2xl` (16) bg white / zinc-900, 1 px border zinc-200 / white at 10%, `shadow-2xl`, `overflow-hidden`. No Escape key, no focus trap, no entry animation. **[GAP]**

```
+------------------------------------------+
| Reference                            (x) |  p-5 pb-4
| Create songs inspired by a reference ... |
| [ (up) Upload audio   mp3, wav, ...     ]|  dashed button
|------------------------------------------|
| ( Uploaded | Created )                   |  px-5 py-3
| (>) Song name  [tag][tag]  [Use][trash]  |  rows, max-h 280 scroll
| (>) 0:12 [=======o-----------]     3:21  |
+------------------------------------------+
```
- Header: title 20/28 weight 600 `text-primary` ("Reference" or "Cover", TR:515-516), subtitle 14 px `text-muted` `mt-1` ("Create songs inspired by a reference track" / "Transform an existing track into a new version"). Close: `p-1.5 rounded-lg`, 20 px X, zinc-400, hover zinc-900/white + bg zinc-100 / white at 10%.
- **Upload button:** `mt-4 w-full`, `rounded-xl`, 1 px **dashed** border zinc-300 / white at 20%, bg zinc-50 / white at 5%, `px-4 py-3`, 14 px weight 500, centered `gap-2`; hover bg zinc-100 / white at 10% and border zinc-400 / white at 30% (`transition-all`). Idle: 16 px upload icon + "Upload audio" + 12 px `text-muted` formats text `ml-1`. Uploading: `RefreshCw` 16 px `animate-spin` + "Uploading audio...". Transcribing: spinner + "Transcribing...". Disabled while uploading/transcribing (no explicit disabled styling). Picker accepts `.mp3,.wav,.flac,.m4a,.mp4,audio/*`.
- Error: `mt-2 text-xs error-text`. Transcribing detail row: `mt-2 flex justify-between text-xs` zinc-400, "Transcribing with Whisper" + `Cancel` (zinc-600 / zinc-300, hover darker), aborts the request.
- Library section: top 1 px `border-divider`. Tabs row `px-5 py-3`: pill group `bg zinc-200 at 60% / white at 10%`, `rounded-full p-0.5`, each `px-3 py-1 rounded-full text-xs 600`; active: bg zinc-900 / white, text white / zinc-900; inactive text zinc-500 / zinc-400, hover zinc-700 / zinc-200. Tabs `Uploaded` (default) and `Created`.
- List: `max-h-[280px] overflow-y-auto`; rows `divide-y` zinc-100 / white at 5%. Row: `px-5 py-3 flex items-center gap-3`, hover bg zinc-50 / white at 2%. Play button 36 px circle, bg zinc-100 / white at 10%, glyph 14 px filled (play has `ml-0.5`), hover darker. Name 14 px weight 500 truncate (extension stripped); up to 2 tag chips (`px-1.5 py-0.5 rounded 10 px`, zinc-200 / white at 10%). Under the name: duration `mm:ss` or `--:--` in 12 px zinc-400, or, while this row plays, a seek row (time 10 px `w-8` + 6 px track with `accent-gradient` fill + total). Actions `opacity-0 group-hover:opacity-100` 150 ms: `Use track` (`px-3 py-1.5 rounded-lg` 12 px 600, bg zinc-900 / white, text white / zinc-900, hover one step) and, only on Uploaded, a trash icon button (hover `text-rose-500`; deletes with no confirm). **[GAP]** actions are invisible on touch, so phone users cannot pick a track.
- States: loading = 20 px spinner + "Loading tracks..." 12 px zinc-400, `py-8` centered; empty Uploaded = 24 px `Music2` (zinc-300 / zinc-600) + "No tracks yet" (14 px) + "Upload audio files as references" (12 px); empty Created = "No created songs yet" + "Generate songs to reuse". Created list = the user's own finished songs from `createdSongs` (those with audio).
- Shared hidden `<audio>`; one track plays at a time; picking `Use track` closes and applies (`applyAudioTargetUrl`). Upload from the dialog also applies it immediately and closes unless Whisper transcription starts. A fetch of the track's duration PATCHes `/api/reference-tracks/:id` when unknown.

## 9. Footer, Create button, title behaviour (CP:2770-2787)

Sticky footer: `p-4 mt-auto sticky bottom-0 z-10`, bg `panel-surface` at 95% with `backdrop-blur-sm`, top 1 px border zinc-200 / white at 5%, `space-y-3` (unused second slot). Always visible inside the scroll area. Button: `w-full h-12` (48), `rounded-xl`, 16/24 weight 700, centered flex `gap-2`, `Sparkles` 18 px + label, text white. Fill: `cta-gradient` `bg-gradient-to-r from-orange-500 to-pink-600` (left to right), `shadow-lg`. Hover: `brightness-110` (150 ms). Active: `scale-[0.98]` (150 ms, `transform`). Focus: none. **[GAP]**

Labels (computed, CP:2779-2784):
- generating: `Generating...`
- bulk > 1: `Create <bulk> jobs (<bulk*batch> variations)`
- batch > 1: `Create (<batch> variations)`
- else `Create`
Disabled when `isGenerating` or not authenticated. **[GAP]** There is no disabled style (no opacity or cursor change), no spinner while generating, and no message for the signed-out case. Rebuild: dim to 50%, `cursor-not-allowed`, show spinner replacing the sparkle icon, explain sign-in.

Generate behaviour (CP:968-1059): builds style with the gender hint, then calls `onGenerate` once per bulk count with the full parameter object (about 50 fields: customMode, songDescription (Simple only), prompt = lyrics, style, title, ditModel, instrumental, vocalLanguage, bpm, keyScale, timeSignature, duration, inferenceSteps, guidanceScale, batchSize, randomSeed, seed, thinking, enhance, audioFormat, inferMethod, lmBackend, lmModel, shift, lm sampling fields, reference/source URLs and titles, audioCodes, repainting start/end, instruction, audioCoverStrength, taskType, useAdg, cfg interval, customTimesteps, CoT flags, autogen, debug, allowLmBatch, getScores, getLrc, scoreScale, lmBatchChunkSize, trackName, completeTrackClasses (array), isFormatCaption, loraLoaded). No client-side validation: empty style/lyrics/description all go through; the backend and the app's `handleGenerate` own errors (toast in the app shell).

"Reuse prompt" from a song (props `initialData`) forces Custom mode and fills lyrics, style, title and sets instrumental when lyrics are empty (CP:493-501).

## 10. State inventory (what a rebuild must keep)

| Field | Default | Persisted |
|---|---|---|
| customMode | true (Custom) | no |
| songDescription, lyrics, style, title | '' | no |
| instrumental | false | no |
| vocalLanguage | en | no |
| vocalGender | '' | no |
| bpm / keyScale / timeSignature | 0 / '' / '' | no |
| duration | -1 | no |
| batchSize | 1 | `ace-batchSize` |
| bulkCount | 1 | `ace-bulkCount` (reset to 1 after each run) |
| guidanceScale / inferenceSteps / shift | 9.0 / 12 / 3.0 | no |
| randomSeed / seed | true / -1 | no |
| thinking / enhance | false / false | no |
| audioFormat / inferMethod | mp3 / ode | no |
| lmBackend / lmModel | pt / acestep-5Hz-lm-0.6B | `ace-lmModel` |
| lmTemperature / CfgScale / TopK / TopP | 0.8 / 2.2 / 0 / 0.92 | no |
| lmNegativePrompt | NO USER INPUT | no |
| taskType | text2music | no |
| coverStrength / repaint start / end | 1.0 / 0 / -1 | no |
| cfgInterval start / end | 0.0 / 1.0 | no |
| scoreScale / lmBatchChunkSize | 0.5 / 8 | no |
| flags: useAdg, allowLmBatch, cotMetas, cotCaption, cotLanguage, autogen, debug, formatCaption, getScores, getLrc | off, on, on, on, on, off, off, off, off, off | no |
| selectedModel | first saved `ace-model` else backend active | `ace-model` |
| lyricsHeight | 144 | `acestep_lyrics_height` |
| LoRA path / loaded / enabled / scale | ./lora_output/final/adapter / false / true / 1.0 | no |
| maxDurationWithLm / WithoutLm | 240 / 240 | fetched |

Nothing in the form (text, tags, tab choices, open accordions) survives a reload, and the panel unmounts when the user changes view. **[GAP]** A rebuild should persist a draft.

## 11. Rebuild checklist of defects to fix, not copy

1. Simple Key/Time handlers pass the event object (CP:1322, 1335).
2. Music Parameters duplicates Quick Settings in Simple mode (CP:1834).
3. Hidden dead range input (CP:1354-1365).
4. Slider with `autoLabel` shows "Auto" at `min` for Variations/Batch size.
5. Duration slider starts at -1 so steps are -1, 4, 9.
6. Disabled states are invisible (Create, AI Format); no `:focus-visible`; slider value chip and toggle switches are not keyboard accessible; no `aria-pressed`/`role=switch`.
7. Native `alert()` for AI Format errors.
8. Lyrics resize: header counted in height, last drag value not saved, no touch.
9. Genre chips have no selected state and allow duplicates; shuffle is biased.
10. Modal: no Escape, no focus trap, row actions hover-only (unusable on phone).
11. Audio upload gives no busy state on the card.
12. Create is disabled when signed out with no explanation; no spinner while generating.
13. Transform "Convert to Codes" and "Transcribe" buttons are inert.
14. Model selection is overridden by the backend-active model after each run.
15. The seed knob and Instrumental knob positions are off by 1-2 px at the track end.
