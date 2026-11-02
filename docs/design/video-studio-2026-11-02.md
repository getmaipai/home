# Videos in the Music Studio look, and a Video Studio (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending. No code. Item: VIDEO-STUDIO-01. Mockup, opened and judged at 1440 and 390 wide, light and dark:
[assets/video-studio-2026-11-02/index.html](assets/video-studio-2026-11-02/index.html) (`?page=studio|create&theme=light|dark&sel=music|video`, `&phone=1`;
`bash cap.sh` regenerates the captures). The Music pages as built today, captured from a dev hub, are in `assets/video-studio-2026-11-02/current/`.

Owner feedback (Jesse, 2026-11-02), with a screenshot of the Music Studio page: "also look at this style for the music studio. that's what you need to do."
What the screenshot shows: a near-black app with one rounded dark main pane; a small cover beside an uppercase eyebrow (STUDIO) and a very large bold
title; lime pill buttons (Split into stems, Play) beside dark pill buttons (Back to the song, Back to start, Loop); a left app list (Create, Studio,
Stems, Remix and edit, Library); a Tracks box with an Add track button, a time ruler, a coloured lane with a waveform and a playhead; a transport bar
(Play, Back to start, Loop, a BPM slider, the time); and right-hand EQ and Compressor panels with sliders and Reset buttons.

## Supersedes and amends

Nothing approved is deleted; each line names the passage and what it says after this note.

- [video-create-feel-2026-11-02.md](video-create-feel-2026-11-02.md) section 2 "Not copied, on purpose: ... a lime accent" and gap G8 "the dark look comes
  from the person's dark theme, never from a fixed colour": replaced for Videos Create and the Studio. The owner's 2026-11-02 words name the Music
  style as the target. Videos takes the Music look through one kit token scope (K1), which has a dark value (the Music app's exact values) and a light
  value, so it follows light or dark mode. It does not follow `ui.look` (the person's base colour) inside Videos Create and the Studio (section 10). Item 5 there (`main_surface: "stage"` on `--surface-stage`) stays shipped; Create stops using it once K1
  lands (section 3, step 2), because the whole page is the studio surface.
- [video-create-one-page-2026-11-02.md](video-create-one-page-2026-11-02.md) section 2 item 3 (the sidebar holds **Create** and **My clips**) and the
  Videos manifest line "`contributes.sidebar.groups[id=create].pages` is `["create", "clips"]`": the group is `["create", "studio", "clips"]` (section 4.1).
  Section 2 Decision 7 ("Trim, Join and Mix ... stay in chat until the edit sheet (K7) lands") and **VIDEO-UI-08** (the K7 `VideoPlayer` action `sheet`
  and the three page actions): replaced. The Studio is the edit surface for a clip; the feed entry's More menu gets one item, **Open in Studio**; K7 is not built as a new part. The `sheet` action already ships in commons (VIDEO-UI-02, `video-player-actions.tsx`); with VIDEO-UI-08 dropped it has no user, so VIDEO-STUDIO-12 removes it and amends the VIDEO-UI-02 ledger row. Chat keeps `trim`, `join` and `mix` through `edit_video`.
- [video-chat-2026-11-02.md](video-chat-2026-11-02.md) C6 (`retake`, after its own bench): unchanged; the Studio's **Redo from here** is that same C6 behind a
  button (section 4.7).
- [music-studio-2026-10-31.md](music-studio-2026-10-31.md) section 3.5 "New in `commons`" item 2 (a `StemRow` or `lanes` prop): replaced; `TrackStudio` (K3) draws the lanes for Music and Videos. Item 1 (`AudioEditor`, region select and loop brackets for "Rewrite a region by drag") stays for Music and is not replaced. Music adopts `TrackStudio` in MUSIC-STUDIO-ADOPT-01 (section 9); nothing about Music changes before that.
- [video-loras-2026-11-02.md](video-loras-2026-11-02.md) section 3.4 (the pages that each hold one unlock): the Videos **Studio** is added as a page with its
  own unlock, and section 3.7 ("edit, remix, join ... end with the page") is the rule the Studio follows (section 6 here).
- [media-editors-2026-10-31.md](media-editors-2026-10-31.md) section 5 (the Video editor as its own pinnable app, EDITOR-16), section 6 (the `ClipTimeline` Element and the `clip_editor` node) and section 7 (EDITOR-12, -13, -14, -16): replaced. The Videos Studio page is the video editor, `TrackStudio` is the one timeline Element, and the Studio's export action replaces `/api/video-edit/*`. EDITOR-11 and EDITOR-15 stay. Its tool 4 (Save a frame as a picture) and the Library viewer's Edit on a video are not carried into the Studio and wait for their own row; the Studio's sources are the person's own made clips only, so the uploaded-video keyframe screen of its Safety paragraph has no Studio path. [video-create-2026-11-01.md](video-create-2026-11-01.md) section 1a: the Storyboard strip uses `TrackStudio`, not `ClipTimeline`.
- Backlog row VIDEO-UI-08 is reworded to point here (the same commit).

## 0. Answer in eight lines

1. The Music Studio look is a Home page, not a kit part. `MusicStudioView.tsx` (251 lines) and `MusicWorkspacePage.tsx` draw their own rounded boxes, and
   the colours come from one Home CSS utility, `music-surface` (`frontend/src/shell/tokens.css`, line 703): twelve colour tokens and `--lanes` (near-black neutrals and a
   lime `--primary`) set on a section that is forced into the kit's `dark` theme. The kit's `Button` is already a pill and `Slider` already reads
   `--primary`, so the lime pills and sliders are tokens only. **No tracks, timeline, waveform or panel Element exists in commons** (checked
   `ui/src/elements`, `ui/src/ui`, `ui/src/primitives`: `timeline.tsx` is a past, now, future event list; `studio-layout.tsx` is a settings-style layout;
   the music parts are `Cover`, `GlassPill`, `MediaTile` and `MediaCarousel` in `ui/src/ui/media-tiles.tsx`).
2. So the Video Studio cannot reuse a Music Element. The right build is one new kit Element, `TrackStudio`, plus a small header and one token scope, all
   additive in commons. Home draws no boxes (rules 9 and 9b). The Music Studio's own boxes predate the 9b lints and are not a precedent (section 2).
3. Create takes the look now with one token scope (K1), one `creation_header` variant (K2) and a heading style (K5). Button emphasis, the card panels and the sliders
   come from the scope with no new prop. VIDEO-UI-15 still lands first and is not redone (section 3).
4. The **Studio** is a new sidebar page, Create, **Studio**, My clips, like Music's Create, Studio, Library. A clip opens with a preview monitor, a
   timeline of three tracks (Video, Voice, Music) with a ruler, thumbnails and waveforms, a transport (Play, Back to start, Loop), trim handles, Split,
   Add a clip, per-track Level, Mute and Solo, and right panels Volume, Fades, Crossfade and Level (section 4).
5. The preview is client-side: one `<video>` and up to two `<audio>` elements kept in step, with Web Audio gain nodes for level and fades. No proxy render
   (section 5). The Stack `media.edit` job renders the export, once, as a **new** clip; the old clip is kept.
6. Export reuses what exists: Stack `media.edit` ops trim, concat, crossfade, mute, audio_overlay, fade, frame. Two Stack additions are needed (a `gain`
   op and fades on an overlay). `crossfade` is already in the Stack on main; Home still has `CROSSFADE_IN_STACK = false` and flips it with the pin.
7. Extend and Redo from here (Max) are buttons that are **absent**, not disabled, until the VIDEO-INPUTS-04 benches pass (the `extend` and `retake`
   runtime commands are beta and unrun by us).
8. A locked adult clip never opens in the Studio without the passcode; the unlock and the plan end with the page. The Studio is adult-only like Create.

## 1. What the Music pages are made of (read from code and opened in a dev hub, 1440 and 390)

Dev hub of this worktree, Sage, six seeded demo songs, Music enabled. Captures: `current/music-*.jpg`.

| Page | What it is | What produces the look |
|---|---|---|
| Create | dark hero "MAKE ANY SONG", a prompt box with chips and a Generate button, then rows of song tiles | Home TSX (`MusicWorkspacePage.tsx`); tiles are the kit's `MediaTile`, `MediaCarousel`, `Cover`, `GlassPill`; colours from `music-surface` |
| Studio | cover, eyebrow, title, two buttons, a Tracks box, transport, EQ and Compressor panels | Home TSX (`MusicStudioView.tsx`, `MusicWaveform.tsx`); `Button` and `Slider` from the kit; every box is a Home `div` with `bg-card rounded-2xl` |
| Stems | a gallery of the person's songs to pick one | `SongGallery`, light page chrome, no dark pane |
| Remix and edit | the same gallery, then an in-page panel | same |
| Library | a gallery with Studio, Stems and Remix buttons under each song | same |

The look, part by part, and what it takes for Videos:

| Seen in the screenshot | Produced by | For Videos |
|---|---|---|
| Near-black rounded main pane, neutral card steps | `music-surface` tokens on a section wrapped in the `dark` class; `rounded-3xl`, `-mx-4` | token scope K1 plus `page.surface: "studio"` (K1b) |
| Lime pill primary (Play, Split into stems) | kit `Button` default variant (already `rounded-full`) with `--primary` redefined by the scope | tokens only, no new variant |
| Dark pill secondary (Back to start) | kit `Button` `secondary` on `--secondary` | tokens only |
| Lime sliders, lime selected ring | kit `Slider` and `--primary`, `--ring` | tokens only |
| Cover, small uppercase eyebrow, huge black-weight title, actions at the right | Home `div` and `Cover` | `creation_header` `variant: "studio"` (K2) |
| Uppercase tracked section labels (TRACKS, EQ, THRESHOLD) | Home classes `tracking-widest uppercase` | built into K2 and K3; K5 for kit shelf headings |
| Tracks box, lanes with a colour bar, ruler, waveform, playhead | Home DOM and `Waveform` bars from `usePeaks` | new `studio` node and `TrackStudio` (K3) |
| Transport (Play, Back to start, Loop, time) | Home `div` | part of K3 |
| EQ and Compressor panels (title, Reset, sliders) | Home `div`, kit `Slider` | part of K3 (`panels`) |

Things the Music page does that Videos must not copy: the section forces the `dark` class whatever the person's theme (in the light shell the Music pane is
dark; the dev capture shows it); the phone Studio clips its ruler and lane at the right edge, truncates the lane name to "1. ..." and draws the playhead
over the Add track button (`current/music-studio-390.jpg`); the EQ panel is cut by the tab bar on a phone. The Studio fixes these (section 4.3).

## 2. Rules check up front

- Rules 9 and 9b: the Studio is a kit schema node rendered by the package page renderer, fed by a package data scope and package action handlers, the way
  `result_feed` is. Home writes no className, no wrapper and no box. The Music Studio is a Home page that draws its own backgrounds and radii; I found no
  `UI-DECISIONS.md` row for it, and it is not carried over. MUSIC-STUDIO-ADOPT-01 moves it onto the same parts and deletes `music-surface`.
- Rule 9b reuse order for `TrackStudio`, completed from [media-editors-2026-10-31.md](media-editors-2026-10-31.md) section 6 (which checked shadcn, Kibo
  and `@xzdarcy/react-timeline-editor`) and re-argued here: (a) the shadcn registry has no tracks or timeline part; (b) Kibo UI: its Video Player and Gantt
  are not a multi-lane media timeline (Gantt is a task chart on dates); VIDEO-STUDIO-04 re-reads the Kibo registry listing, with version and licence, as
  the first step of its ledger row before any code; (c) `@xzdarcy/react-timeline-editor`: that note rejected it partly because "a family trim strip needs one
  track"; that reason no longer holds for a three-lane editor, but its own stylesheet and interactjs dependency cannot be restyled by tokens alone (rule 9b
  "Changing the look and feel"), so it is rejected on that ground, to be confirmed by the same row with its version and licence; (d) wavesurfer.js and its
  multitrack and regions plugins (BSD-3 from memory, to verify): not used here, because three short lanes of 160 bars need no dependency and trim and split
  are lane pieces, not waveform regions; Music's region select stays the `AudioEditor` of its own note. Only then a hand-built Element in commons composing
  `Button`, `Slider` and `Cover`.
- Rule 0 and the minor lines: sections 6.2 and 6.3. Rule 10: nothing here checks an adult's words or picture.
- S1, S2: one header row (the Studio's `creation_header` studio variant is page content like Music's, not a second app header); the rail and companion are untouched.
  S2 says video copies YouTube; Browse stays that. Create and the Studio are the creation workspace the owner chose from references 7 to 11 and now the
  Music Studio.
- S6: Export is disabled with one line where the person acts when the Stack cannot take an edit job, read from the same `["health"]` query as
  `useMakingAvailability` (VIDEO-STUDIO-07 step 1 finds the right `roleHealth` row; if none covers `media.edit` it adds a row there, no new surface). The
  export job's progress lives on that job's own card (`VideoPlayer` states), shown in place of the monitor after Export (section 4.8).
- No fixed colours (owner, 2026-10-19): every colour in the mockup is a stand-in for a scope token. The scope has a dark and a light value. The Music
  page itself still forces dark; that is flagged in section 10, not changed here.
- No resource words, no model names, no credits on any control. A time is in words ("a few seconds").

## 3. What Create takes now (decided on merit, then checked)

The structure approved in the one-page and feel notes (two panes, `prompt_bar` panel, `result_feed`, Try this rail, pinned Generate) stays. What changes is
the surface and the page header. Marks: (a) existing props and variants only; (b) a named commons addition.

1. **(a) One primary per surface.** Generate is the page's one lime pill (the kit default variant, 64 px, time inside the button, already in VIDEO-UI-12).
   Change on the Style banner, the Level cards, View, Landscape and 5 seconds are outline or secondary. The feed entry's icon row is ghost. A selected
   Level card and a focused field take `--ring`, so they turn lime with no prop. Max stays greyed with its reason (VIDEO-UI-01 decision 3). A lime fill
   never marks a secondary action.
2. **(b) The surface: K1 and K1b.** The page body sits on a rounded near-black pane in dark theme and a soft pane in light theme, with neutral card steps
   and a lime `--primary`. Until K1 lands, VIDEO-UI-15 uses `main_surface: "stage"` as planned; VIDEO-STUDIO-08 then sets `page.surface: "studio"` and
   returns `split_view` to `main_surface: "page"`. Nothing is rebuilt: only two JSON props change.
3. **(b) The page header: K2, `creation_header` `variant: "studio"`.** Eyebrow **CREATE**, title **MAKE ANY VIDEO**, no art (Create has no object to show), no actions (Generate lives in the
   panel). It is 72 px tall at 1440 and one line on a phone, so the panel and its pinned Generate still fit on the first screen at 1440 by 900.
4. **(a) The panel stays as built:** `prompt_bar` panel on `--card`, rounded, scrolling inside itself; the Style banner and the Level cards from
   VIDEO-UI-12 and 13. Music's glass floating prompt bar and cover carousels are not copied (the panel is the approved Dreamina and Higgsfield form).
5. **(b) Eyebrow headings: K5.** "Try this" and the feed's filter row take `heading_style: "eyebrow"` (uppercase, tracked, muted), default unchanged.
6. **(a) An entry gets one new item, Open in Studio,** in its More menu and on My clips tiles (a `navigate` action to the Studio with the clip id, an
   existing action kind; section 4.9). It is not drawn for a locked item.

Mockup: `create-1440-*.jpg` and `create-390-*.jpg`. On a phone the real panel is the approved bottom dock and sheet (VIDEO-UI-01); the 390 capture shows the
sheet's content in the flow as a stand-in.

## 4. The Video Studio

What a person does: open a clip, hear it, cut it, put it next to another, lay a voice or a song under it, set the levels, press Export, and find a new
clip next to the old one. One page, no jargon: "Split at playhead", "Delete piece", "Add a voice", "Export as a new clip".

### 4.1 Placement

A schema page `studio` in the Videos package (`kind: "schema"`, `min_role: "adult"`, icon `audio-waveform`, the one Music uses) between Create and My clips:
`contributes.sidebar.groups[id=create].pages` is `["create", "studio", "clips"]`, and `contributes.pages` gains `studio`. The page body is `creation_header` studio variant
then `studio`. Address: `/apps/videos/studio?clip=<id>`. With no `clip` the page shows the person's clips as `media_shelf` tiles ("Pick a clip to open")
and a press navigates with the id. Entry points: the feed entry's More menu, a My clips tile, the chat video card (section 6.4).

### 4.2 The screen at 1440 (mockup `studio-1440-*.jpg`, `studio-video-1440-*.jpg`)

- **Header** (K2): the clip's poster, eyebrow STUDIO, the clip's words as the title (uppercase), at the right **Back to the clip** (secondary) and
  **Export as a new clip** (the one lime pill). Export is disabled until there is a change.
- **Monitor** (left, 340 px, 16:9) with the playhead time, and beside it two tool groups: **Edit** (Split at playhead, Delete piece, Add a clip, Add a
  voice, Add music) and **Make more** (Another take, Extend (Max), Redo from here (Max)), with one line of help.
- **Tracks**: a card with a TRACKS label and a corner button, a ruler (2 s ticks), then three lanes with a colour bar, a name, Mute, Solo and a Level slider:
  **1. Video** (thumbnail strip per piece; the clip's own sound rides with its picture), **2. Voice** (a spoken line, waveform), **3. Music** (a song,
  waveform, drawn fade ramps). The playhead is one line across all lanes. A selected piece shows lime trim handles.
- **Transport**: Play (lime, large), Back to start, Loop, a zoom slider and the time, in a card under the tracks.
- **Right panels** (320 px, analogous to EQ and Compressor): **Volume** (Level in dB, "Lower under speech" for a music piece), **Fades** (Fade in, Fade out),
  **Crossfade** (length at the seam after the selected piece, 0.3 to 1 s), **Level** (Quiet, Soft, Balanced, Loud, Very loud: the same five balances as
  `MIX_LEVELS`). Each panel has a Reset. The panels act on the selected piece or lane, and say which.
- A line under the panels: "The preview is what you hear in the Studio. Export makes a new clip and keeps the old one."

### 4.3 The screen at 390

Header wraps (poster, eyebrow, title, then two equal buttons). Order: monitor, Edit and Make more, Tracks, transport (sticky above the tab bar), then
the panels as one card with a four-way segment (Volume, Fades, Crossfade, Level), because four tall cards under the lanes would push the transport away. The
lane label column is 112 px, sticky; the lanes scroll sideways inside the card and the ruler scrolls with them; the corner button is hidden (Add a clip
and the rest are in Edit). Lane names keep two lines. These are the points where the Music Studio phone page breaks (section 1).

### 4.4 Tools, each mapped to what exists

| Studio control | Does | Built on |
|---|---|---|
| Trim handles | cut the start or end of a piece | Stack `trim`; `trimOps` and `trimRange` in `editPlan.ts` |
| Split at playhead | one piece becomes two; either can be deleted, moved or trimmed | Home plan only; each piece compiles to one `trim` |
| Delete piece | removes a piece; the rest close up | plan only |
| Add a clip | a second clip from My clips, or **Continue from the last frame** of this one | `join`; `continue` is built (EDITOR-15: `frame` op then LTX-2.5 picture start) |
| Crossfade (panel) | blend two pieces at their seam, 0.3 to 1 s, default 0.5 | Stack `crossfade` op (on Stack main; Home flag `CROSSFADE_IN_STACK` flips with the pin) |
| Add a voice | a spoken line in a household or preset voice, placed at a time | `synthesizeSpeech` and `voiceForSpeech`, the `mix` path of `edit_video`; Stack `audio_overlay` |
| Add music | one of the person's own made songs, placed at a time | `getMusicJobFor` and `readMusicFile`, the `mix` path; Stack `audio_overlay` |
| Level, Mute, Solo per lane | gain per lane; Mute drops it from the export, Solo only affects the preview | `MIX_LEVELS` balances; **new Stack `gain` op** for a clip's own sound without an overlay (S1 below) |
| Fades | fade in and out of a piece or an overlay | Stack `fade` for the whole film; **new `audio_overlay` `fade_in_s` and `fade_out_s`** for a lane (S1) |
| Another take | same words, new seed, a new clip | `edit_video` `another_take`, built |
| Extend (Max) | the clip carries on for a few more seconds | runtime `extend`, VIDEO-INPUTS-06; absent until its bench passes |
| Redo from here (Max) | regenerate from the playhead to the end handle, keep the rest | runtime `retake` (beta), `edit_video` C6; absent until its bench passes; needs the `tier.max` grant |
| Export as a new clip | render the plan once | Stack `media.edit` through `startVideoEditJob`; the source clips are untouched |

Limits, from existing constants: up to 6 video pieces (`MAX_JOIN_CLIPS`, the Stack's `MAX_CROSSFADE_CLIPS`), up to two pieces on each audio lane, a film
of at most 60 s. The Stack allows 24 inputs, 12 ops and 600 s per job; the plan compiles to several small jobs when it has more steps than one job takes
(section 5.3). A person who goes past a limit reads one line ("A film can have six clips. Delete one to add another.").

### 4.5 The plan (what the Element hands Home)

`TrackStudio` keeps the edit in the page and hands Home one JSON plan on Export: pieces `{clip, in_s, out_s, level_db, fade_in_s, fade_out_s}` in order,
`transition: {kind: "cut" | "crossfade", seconds}` per seam, and lane pieces `{file, start_s, level_db, fade_in_s, fade_out_s, duck}` for Voice and Music.
Home never trusts it: the plan passes the same gate function as `edit_video` (the surface and lane check, `videoRefusalFor` on every typed voice line before any speech is made, the clip ownership check and `clipAdultOnly`), moved out of `editTool.ts` into one shared function that both call; then a zod schema in `lib/videos/studioPlan.ts` re-checks every number and id, reads each source through the same
`readVideoFile` and audience rules (`fileAudience`, "never lower than its sources"), and compiles the plan with `editPlan.ts` functions into ops. The
plan is also the unit of undo in the page (a list of plans with a cursor, the model of `image-editor-state.ts`: Original, Undo, Redo).

### 4.6 Track colours and the Voice lane

A track colour is a kit hue token (`--hue-blue`, `--hue-pink`, `--hue-orange`), as the Music Studio does with `--track`; a bar and its waveform carry no
raw colour. The lane called Music reads "Music and sounds" once the Sounds maker (MUSIC-STUDIO S7) exists; until then it takes songs only.

### 4.7 Extend and Redo from here (Max)

Both start from the selected piece and make a **new** clip through `makeVideoFor`, the one function every video button calls, so the level rules, the
`tier.max` grant (`MAX_NEEDS_ADMIN_LINE`), the one-clip-at-a-time household queue and the readiness read are the same as on Create. The new clip's job shows on its own `VideoPlayer` card in the monitor's place (`export_result`, as in section 4.8), whose ready state carries Open; no toast or banner. The old clip stays. Neither button is drawn (absent, not greyed) until VIDEO-INPUTS-04 has
a passing measured clip for it (VIDEO-UI-01 decision 5: a control whose input fails its bench is absent). The mockup draws both with a Max chip only to
show where they go.

### 4.8 Export and its progress

Export posts the plan to a package action. Home creates the edit job (`startVideoEditJob`, as `trim`, `join` and `mix` do today), returns its id, and the
page shows that job's own `VideoPlayer` card (queued, generating, ready, failed, cancelled; Stop; Try again) in the monitor's place, polled with the
`poll_while` mechanism of K9. When ready: **Open in My clips** and **Keep editing** (the plan is kept). Nothing else shows progress (S6). The edit job also
appears in Create's feed as an entry of kind `edit` (a change to `lib/videos/feed.ts`, which excludes edits today), so a person who leaves the page still
finds one card.

### 4.9 Opening a clip

`GET` of the package scope `studio` with `clip=<id>` returns `{clip, pieces, tracks}` for a clip the person owns (the rule chat's `ownClip` applies; one rule for both); a locked, minor-barred or missing clip answers the same plain line as a missing one. A clip made in chat opens too: both are
`video_jobs` and Library files. A clip with no sound has no clip-sound lane control.

## 5. How the preview works (decided on feasibility, small and honest)

### 5.1 Two ways

| | A. Render a proxy with ffmpeg through the Stack | B. Play the tracks in the browser |
|---|---|---|
| What the person hears and sees | the real mix, including dissolve and loudness | the picture and the sound of every lane, in step; no dissolve, no final loudness |
| Cost per change | one Stack job per slider move or trim (a render, a queue slot, a download) | none |
| Fit with the household queue | competes with chat, pictures and clips (resource order: chat, then images, then video) | uses none |
| Scrubbing and dragging a handle | stops until a render ends | immediate |
| Risk | many jobs for a tiny change; a stale preview after each edit | audio and video drift; browser limits |

**Decision: B.** The Studio's promise is that nothing is spent until Export; B keeps that and keeps handles and sliders live. A is rejected.

### 5.2 How B works, in numbers I can state

- One `<video>` is the clock and the monitor. Each audio lane piece is an `<audio>` element. At most one video element and four audio elements exist
  (two pieces on each audio lane).
- Every element feeds a `MediaElementAudioSourceNode` into a `GainNode` per lane; the lane Level, Mute, Solo, fades and the audio side of a crossfade are
  gain automation (`linearRampToValueAtTime`), which `element.volume` cannot do cleanly. The Music Studio already builds this chain (a bus, EQ bands and a
  compressor on a `MediaElementSource` per row), so the technique is shipped, not new.
- The shipped chain is `frontend/src/lib/media/audioGraph.ts`; `createMediaElementSource` works once per element, so K4's relock path removes the element, not just its source. Sync: every 250 ms the Element compares each audio element's time with the clock and corrects a drift above 120 ms. I did not measure drift: the browser
  pane was hidden for the run I tried and the media events never fired. VIDEO-STUDIO-04 measures it on a real 16 s plan with three lanes in Chrome and Safari
  and records the numbers in `docs/dev/videos-studio.md`; the 120 ms bound is the proposal to confirm or change.
- Waveforms: the file is fetched with the person's own session, decoded with `decodeAudioData` and cut to peaks, as `MusicWaveform.tsx` does for songs.
  Thumbnails: a hidden `<video>` seeks N times and draws each frame to a 96 by 54 canvas, N about one per second of the visible piece, with the poster as the
  placeholder. Not measured here for the same reason; the target (a 10 s piece's strip in under 2 s) is a target, to be measured in VIDEO-STUDIO-04.
- What B cannot show, said in the UI line under the panels: the picture dissolve of a crossfade (the preview cuts, the sound blends) and the final loudness.
  If VIDEO-STUDIO-05 finds a two-element opacity dissolve cheap, it may add it; it is not required.
- Failure: if an element cannot be decoded, the lane shows "This audio could not be drawn. It still plays." (the Music Studio's line) and the export still works.

### 5.3 Export, the one render

A plan with up to 12 steps and 24 files is one `media.edit` job. A larger plan compiles into piece jobs (one `trim` and optional `fade` per piece), then one
final job (`concat` or `crossfade` of the pieces, `audio_overlay` per lane piece, a final `fade`). These are CPU ffmpeg steps on the clip files (the Stack's
`x264 veryfast`), the same family as today's `trim`, `join` and `mix`. I measured no export time. VIDEO-STUDIO-07 records the seconds of a real three-piece,
16 s export; "a few seconds" is the copy only if that number supports it, otherwise the copy is "a minute or two". The temp folder of staged files is deleted
whatever the result, as `stackEdit.ts` does today.

## 6. Locks, minors and chat

### 6.1 Adult lock (the LoRA note, section 3)

- A locked clip never opens. `GET studio?clip=` goes through `lockState` first: no proof means the page shows the one lock tile ("Locked items") and the kit
  `AdultLockDialog`; the header draws no poster, title or eyebrow (K2 takes `locked`), the timeline and monitor are not drawn, and no request for the media
  is made. An unlocked clip's media loads through the authenticated blob path of ADULT-LOCK-05 (`X-Adult-Unlock`, object URL), handed to the Element as
  sources; the Element never fetches an adult-only file itself.
- The Studio is **a page with its own unlock** (the LoRA note section 3.4 list gains it). It relocks when the page unmounts, the tab is hidden, two minutes
  pass without activity (a playing preview counts as activity, section 3.3), the person presses Lock now, or the session locks. On relock the Element stops
  every media element, removes `src` and calls `load()`, revokes the object URLs, **discards the unsaved plan and every thumbnail and waveform it drew**, and
  the page shows the lock tile. Nothing of the edit survives in `localStorage`, `sessionStorage`, IndexedDB or the query cache: the plan lives in a React
  state only. A line says "Locked. Edits that were not exported are gone."
- No leak around playback: no Media Session metadata, no registration with the mini player or the audio session, `disablePictureInPicture`,
  `disableRemotePlayback`, `controlsList="nodownload noremoteplayback"`, no looping preview, no resume position (section 3.9).
- Export of an adult-only source makes an adult-only clip from the job start (an edit is never lower than its sources, `editTool.ts`). Its card is the lock
  tile with "Something locked is being made". A voice or song added from the picker is offered only when unlocked; the picker lists locked items as one
  lock tile. Mixing a locked song into an open clip makes the result adult-only.
- Until ADULT-LOCK-02, 03 and 05 land, the Studio opens only clips that are not adult-only, and refuses an adult-only clip with "Open this from a screen
  where it is unlocked" rather than opening it (VIDEO-STUDIO-09 is the row that removes the refusal). A clip's audience is read through `fileAudience`
  today, so the refusal needs no new data.

### 6.2 Minors

The Studio is adult-only: the page, the `studio` scope and the export action are behind `appRouteAllowed` (a child or teen gets 404, no sidebar entry), the same
gate as Create and My clips. A child or teen keeps the silent Wan Quick lane in chat and has no Open in Studio. No sound the Studio adds can reach a
minor: a voice line or a song is the person's own, and the result is not shown to a minor unless its audience is all-ages (`canReadFileAudience`).

### 6.3 Content

An adult's picture, words and voice are not checked beyond the CSAM check the generation functions already run (rule 10). The Studio makes no new content: a
trim, a join and a mix are edits of files the person may read. A typed voice line is screened by `videoRefusalFor` like a prompt, then spoken by `synthesizeSpeech`.

### 6.4 Chat parity

| Studio action | Chat equivalent today | After this note |
|---|---|---|
| open a clip | none | a chat video card action **Open in Studio** (a `navigate` to the page; the chat card is `VideoPlayer`, whose `actionItems` already take one); not drawn on a locked card |
| trim, split and delete | `edit_video` `trim` | the same function; Studio compiles several trims |
| join, Add a clip | `edit_video` `join` (`cut`, `crossfade`) | same |
| Add a voice, Add music, Level | `edit_video` `mix` (five balances) | same; per-lane dB and fades are Studio-only fine control, not new chat arguments |
| Another take, Extend, Redo from here | `another_take`, `continue`; `retake` is C6 | same functions |
| Export | the edit job's card | the same card |

No new `edit_video` change is added: the model decides when a person wants an edit (rule 1), and the Studio is where a person who wants control goes. Every
Studio export goes through the same `startVideoEditJob` and gates the chat tool uses, so there is one path.

## 7. Reuse check

| Part | Decision | Why |
|---|---|---|
| Cover art in the header | kit `Cover` (`ui/src/ui/media-tiles.tsx`), `bare` | already shipped, one definition of a cover |
| Pill buttons, sliders, segments, Reset | kit `Button`, `Slider`, tokens | already pill and already `--primary` |
| Peaks and waveform | the algorithm of `MusicWaveform.tsx` (`peaksOf`) moves into `TrackStudio`; Music's copy is deleted in MUSIC-STUDIO-ADOPT-01 | one definition |
| EQ and Compressor panels | Music keeps them; they become `panels` of `TrackStudio` when Music adopts it | the panel is data, not a second part |
| Timeline events list `timeline.tsx` | not used | a past/now/future event list, no time axis |
| `StudioLayout` | not used | a navigation and rail layout for settings-like pages |
| `Billboard` | not used | a hero carousel |
| `creation_header` | used, as a new `studio` variant (K2) | it already has `fields.art`; the variant adds the eyebrow, title style and secondary action |
| `CompanionProfileHeader` | not used | draws a companion's profile |
| `VideoPlayer` as the monitor | not used for the monitor; used for the export job's card | it owns its own transport; a second playhead would fight the lane clock |
| `@xzdarcy/react-timeline-editor` | not used | own stylesheet and interactjs not restylable by tokens (section 2) |
| wavesurfer.js and its multitrack and regions plugins | not used | three short lanes need no library; trim and split are not waveform regions |
| `image-editor-state.ts` | its Original, Undo, Redo model is the page's undo | reuse |
| Stack `media.edit` | all existing ops; two additions | no second renderer |
| `makeVideoFor`, `startVideoEditJob`, `editPlan.ts`, `MIX_LEVELS` | the only paths that make or edit a clip | one definition |

## 8. Kit gaps and the exact additions

All additive, spec first (`spec/ui/schema.json`, then the ui Element and its test), default unchanged, each with its `UI-DECISIONS.md` row before the Element
is written (rule 9b, 9c), each under a new tag that Home pins. Home writes no className, no CSS for a kit part, no wrapper.

| # | Where | Addition | Default | Why existing props cannot do it |
|---|---|---|---|---|
| K1 | `ui/src/tokens.css` | token scope `[data-surface="studio"]`: `--background`, `--card`, `--popover`, `--muted`, `--secondary`, `--accent`, `--border`, `--input`, `--ring`, `--primary`, `--primary-foreground`, `--surface-stage`. Dark values are the Music app's `music-surface` values (near-black neutrals at hue 285, lime `oklch(0.9 0.2 125)`); light values are a soft grey page, white cards and a lime tuned so the pill text and the slider fill pass the contrast tests (proposal: `oklch(0.86 0.2 125)` with near-black text; the build measures). Both added to `contrast.test.ts` and `text-opacity-contrast.test.ts` | no scope: unchanged | `--primary` and the neutrals are the only things between the kit and Music's look; no prop reaches a page-wide token set |
| K1b | schema `page` | `surface: "studio"`: the page body draws as a rounded pane (`rounded-3xl` at `lg`, full bleed on a phone) carrying `data-surface="studio"` | `"page"` | the pane and the scope must sit on one element; `split_view.main_surface` reaches only its main pane |
| K2 | schema `creation_header` and its Element | additive `variant: "studio"`: optional `eyebrow`, `art` drawn by `Cover` `bare` (the node's `fields.art` already exists), a `secondary` action beside `primary` (at most one primary), `locked` (draws no art or text). The `collection` variant draws art beside the title but has no eyebrow, no uppercase title and no secondary action, and `CompanionProfileHeader` (`eyebrow`, `media`, title, `actions`) is a companion profile, not a page header: a variant reaches the look, so no new part | `full` | the existing variants cannot reach the eyebrow, the large title and the secondary pill |
| K3 | new node `studio`, Element `TrackStudio` | `kind: "video"` or `"audio"`; `lanes` (id, label, hue token, `kind`, pieces with `src`, `in_s`, `out_s`, `at_s`, `level_db`, fades); the ruler, lanes, playhead and transport; `tools` (which of Split, Delete, Add a clip, Add a voice, Add music, Make more are drawn, each with `when` and `disabled_reason`); `panels` (title, Reset, controls: slider with `min`, `max`, `step`, `unit`, `state`; segment); `limits`; handlers `export`, `add`, `make_more`; `export_result` (a bound job row drawn by the shipped `VideoPlayer`, with `poll_while`); `sources` supplied by Home so an adult-only file can come from a blob; `onPlan` emits the plan of section 4.5; the preview graph of section 5.2; keyboard: Space plays, arrow keys nudge the playhead, `S` splits, `Delete` deletes, handles move with arrow keys; labels and roles for every control | n/a | no tracks, lanes, ruler or panel Element exists |
| K4 | `TrackStudio` | `peaks` and `thumbnails` computed inside the Element from `sources`; destroyed on `sources` becoming empty (the relock path) | n/a | the Element must own the lifetime of what it draws so a relock leaves nothing |
| K5 | `media_shelf`, `result_feed` | `heading_style: "eyebrow"` | `"default"` | the uppercase tracked heading is a type style, not a colour or a class a package may set |

Stack additions (VIDEO-STUDIO-06, additive to `media.edit`, with the Stack's own tests and `docs/integrations.md`):

- S1: a `gain` op `{db}` on the working clip's sound (today only `audio_overlay.clip_gain_db` can change a clip's own level, and only with an overlay); and
  `audio_overlay` gains `fade_in_s`, `fade_out_s`, `end_s` so one lane fades without touching the clip's sound (today `fade` affects the whole working clip).
- Already in the Stack on main and not needed here: `trim`, `concat`, `crossfade` (0.3 to 1 s, up to 6 clips), `mute`, `audio_overlay` (`gain_db`,
  `clip_gain_db`, `start_s`, `duck`, `loudness_lufs`), `fade`, `frame`.

Home additions are listed in the slices. There is no spec record change: the plan is a request body, not a stored record, and the exported file is a normal
`made-at-home` Library file with provenance from the source jobs (`commercialUseOf` already walks parents).

## 9. Slices, in order

| Id | Size | Slice | Done when |
|---|---|---|---|
| VIDEO-STUDIO-01 | S | This note, mockup, architect ruling, backlog rows | architect APPROVED; screenshots judged |
| VIDEO-STUDIO-02 | S, commons | K1 and K1b, contrast tests, ledger row, tag; values wait on the section 10 `ui.look` answer | commons tests and tsc; opened at 1440 and 390, light and dark; tag pushed |
| VIDEO-STUDIO-03 | S, commons | K2 `creation_header` studio variant, K5 `heading_style`, ledger rows, tag | same; a `locked` header opened |
| VIDEO-STUDIO-04 | L, commons | K3 and K4 playback half: lanes, ruler, thumbnails, waveforms, playhead, transport, per-lane Level, Mute, Solo, the Volume panel, the preview graph; measures drift and strip time | same; a real 16 s, three-lane plan played in Chrome and Safari with the drift numbers recorded; relock leaves no media element with a `src` |
| VIDEO-STUDIO-05 | L, commons | K3 editing half: trim handles, Split, Delete, Add a clip, Add a voice, Add music, Fades, Crossfade and Level panels, undo, plan output, keyboard and focus pass | same; every tool used once at 1440 and 390 by keyboard and pointer; tag pushed |
| VIDEO-STUDIO-06 | S, Stack | S1: `gain` op, `audio_overlay` fades and `end_s`, tests, docs; a real export of the three-piece plan | Stack tests; a real clip checked by ear and by `ffprobe`; tag or sha for Home to pin |
| VIDEO-STUDIO-07 | L, Home; needs 04, 05, 06 | pin tags; `studio.json` and `studio` scope; `lib/videos/studioPlan.ts` (zod, compile to ops, piece jobs plus final job); the `export` action through the shared edit gate (moved out of `editTool.ts`, used by `edit_video` too) and `startVideoEditJob`; edit jobs in the feed; the Studio page and manifest group; flip `CROSSFADE_IN_STACK`; `docs/dev/videos-studio.md`; tests that a plan from a minor, a missing clip, another person's clip or an over-limit plan is refused, and that a typed voice line goes through `videoRefusalFor` before any speech | dev hub opened at 1440 and 390; a real three-piece export made and played, the old clip still there; the export seconds recorded |
| VIDEO-STUDIO-08 | S, Home; needs 02, 03 and VIDEO-UI-15 | Create takes the look: `creation_header` studio variant and `page.surface: "studio"` in `create.json`, `main_surface` back to `page`, Open in Studio in the entry More menu and on My clips tiles | dev hub opened at 1440 and 390, light and dark, empty and with clips |
| VIDEO-STUDIO-09 | M, Home; needs ADULT-LOCK-02, 03, 05 and 07 here | locked clip: lock tile and dialog on the Studio, blob sources, relock discards plan and media, no Media Session; before then the refusal line (section 6.1) | tests 1, 2, 6, 9 of the LoRA note on a locked clip; a relock opened by hand |
| VIDEO-STUDIO-10 | S, Home; needs 07 and VIDEO-CHAT-01 | chat video card **Open in Studio** | pressed once from a chat card; not drawn on a locked card |
| VIDEO-STUDIO-12 | S, commons | remove the unused `VideoPlayer` action `sheet` and amend the VIDEO-UI-02 ledger row | tests; tag pushed |
| VIDEO-STUDIO-11 | M, Home; needs 07, VIDEO-INPUTS-04 and -06 | Extend and Redo from here, absent until each bench passes, through `makeVideoFor` and the `tier.max` grant | one real clip of each, the seam judged, old clip kept |
| MUSIC-STUDIO-ADOPT-01 | M, Home; after 04 and 05, not blocking | the Music Studio draws on `TrackStudio`, `creation_header` studio variant and `data-surface="studio"`; `music-surface` and the duplicate peaks code are deleted; EQ and Compressor become `panels`; the phone defects of section 1 are gone | Music Studio opened at 1440 and 390 before and after |

Order: 02, 03 and 06 in parallel; 04, then 05; 07 once 04 to 06 are tagged; 08 once VIDEO-UI-15 has landed; 09 once the lock rows land; 10 and 11 last.
VIDEO-UI-15 is in progress and is not touched by this note. Each commons slice is its own worktree; Home slices go to Codex or the local lane as one to three
file briefs with a failing test; 04 and 05 are larger and are dispatched in pieces (lanes and ruler, preview graph, then each tool).

## 10. Open points (only the `ui.look` point blocks 02)

- **Music's forced dark.** The Music pages force the dark theme whatever the person chose. The studio scope follows light or dark mode (dark equals Music's values). When
  Music adopts the scope (MUSIC-STUDIO-ADOPT-01) it would follow the theme too. For the owner: keep Music always dark, or let it follow? The adoption row waits
  on that answer; nothing else does.
- **`ui.look` inside the studio scope.** Keep Music's near-black and lime whatever look the person chose (the owner's 2026-11-02 words), or keep the look's neutrals and set only `--primary` and `--ring`? This sets K1's values, so it blocks VIDEO-STUDIO-02. Default if unanswered: Music's values, as the owner's words say.
- **Light-theme lime.** The light value of `--primary` is a proposal; the contrast tests decide the final lightness in VIDEO-STUDIO-02.
- **Preview dissolve.** The preview cuts where the export dissolves. If a two-element opacity dissolve proves cheap in VIDEO-STUDIO-05 it is added; not required.
- **Measurements owed by the build:** sync drift, thumbnail strip time and export seconds (sections 5.2 and 5.3). Nothing in this note claims them.
