# Videos Create: a two-pane workspace (control panel and results feed) and a My clips library (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending on revision 5 (revision 3 was REJECTED on G1 and G2, revision 4 on three kit facts R1 to R3, all fixed here). Revision 1 (a single page with a stage, a clips column and a
bottom dock) landed as f9009fc78; revision 2 (two panes, built on the generic `player`) was REJECTED because the kit already ships `VideoPlayer`;
this text, revision 3, builds the feed entry on `VideoPlayer` and replaces both. Nothing should be built from revision 1's or 2's slices.
No code. Item: VIDEO-UI-01. Amends [video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md). Mockup, opened and judged at 1440 and
390 wide, light and dark: [assets/video-one-page-2026-11-02/index.html](assets/video-one-page-2026-11-02/index.html) (captures beside it;
`?page=clips` is the library; `bash cap.sh` regenerates them).

Owner feedback (Jesse, 2026-11-02): "I dont understand our current ui for video gen and especially it seems wasteful and probably not
what Higgsfield AI does." Then, with five reference screenshots: "you need better overall UI for the left menu and right panes and just
general flow".

What he saw: Create is a textbox with Next, an Ideas list and a Making now card (`pages/create.json`); Make a video is a small prompt
box, a Picture slot, two full-width card grids, small dropdowns and a Make button below the fold, with an empty right column
(`pages/make-video.json`); My creations is a separate empty page (`pages/creations.json`). One job over three pages.

## Supersedes and amends

Nothing approved is deleted; each line names the passage and what it says after this note.

- [video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md) section 1 (the screen): "Left panel" and "Stage column" are replaced by the
  layout in section 2 here. Its controls stay (Look, Camera, Level, Length, Voices, references); their place and form change (a
  left control panel; Look and Camera in one Style popover, a sheet on a phone). Section 2 rows: the Look and Camera cards stay the
  `prompt_bar` cards chips and gain a popover presentation; "Shot strip: reuse `media_shelf`" becomes the results feed (K10) beside the
  panel; "Preview stage: reuse `player`" becomes the kit `VideoPlayer` Element inside each feed entry (K1). Section 6: U1 and U2 are built (cards variant,
  `references`, the 13 loops in `backend/packages/videos/assets/loops/`); U3 and U4 are replaced by VIDEO-UI-06. The button words change
  from Make to Generate (a label only; chat tools keep their names).
- [video-still-first-2026-11-02.md](video-still-first-2026-11-02.md): the "stage's confirm state" it asks for (VIDEO-INPUTS-02) is the
  `draft` state of a feed entry (K1), with the same three actions. The reference slots it names sit in the panel's References group.
  Its decisions 1 to 10 are unchanged.
- [video-create-2026-11-01.md](video-create-2026-11-01.md) section 3 (the Make page layout) is amended the same way.
- The Videos manifest: `contributes.sidebar.groups[id=create].pages` goes from `["create", "make-video", "creations"]` to
  `["create", "clips"]`; `make-video` and `creations` leave `contributes.pages` with their files; `clips` ("My clips", adult, schema page)
  is added. The `create` mode of `contributes.header.modes` (`page: "create"`) is unchanged.
- [../dev/videos-create.md](../dev/videos-create.md) "Pages" is rewritten in VIDEO-UI-06, in the same commit as the code.
- Revision 1 of this note (stage, Your clips column, bottom dock): the `media_shelf` `select_state` prop (old K5) and the dock-only bar are
  dropped; the dock survives only as the phone form of the panel.

## 1. Patterns adopted from the reference screenshots

Owner's five screenshots, read 2026-11-02. Each pattern is named, with what we do with it.

| Ref | Pattern seen | Adopted as |
|---|---|---|
| 7, 8 (Dreamina) | A fixed left control panel and a right results feed in two rounded panes; the page never changes while generating | the Create page is exactly two panes, panel left, feed right (section 2) |
| 7, 8 | Generate is one large button pinned at the panel's bottom, with the cost line above it | Generate pinned at the foot; the line is the level and an estimated time ("Boost, 5 s, about a minute"), not credits (nothing is metered; no resource words) |
| 8 | Image prompt: the reference thumbnail with its name sits inside the prompt box, a trash icon removes it | the Start frame attaches inside the prompt box as a named thumbnail with a remove control (K3c); the Words and Photo tabs are not copied, attaching a photo is the switch |
| 7, 8 | A Model row with a settings icon, "More settings" fold, "Credit details" | our Level segment replaces the model row (we never show model names to a person); Shape and Length sit visible; a "More settings" fold holds Voices and Picture first |
| 7, 8 | Feed entry: the prompt text, tags (model, Detailed info), the reference thumbnail labelled First frame, the player, a small icon action row (edit, rerun, upscale, music) | the feed entry (K10): words, tags (look, camera, level, length, sound), a "Start frame" chip with its thumbnail, the `VideoPlayer`, an icon action row (K1): Remix (edit), Another take (rerun), Make it Max (HD), Download, More (Trim, Join, Mix), and Favorite at the end |
| 7, 8 | Filter bar over the feed: Show Favorites only, Group results by prompt, Type: All | the same three controls over the feed (K10 `filters`): Favorites only, Group by words, Type (All, Videos, Stills) |
| 7, 8 | Newest on top, the feed is the stage | the feed is the stage: an entry in `draft`, `queued` or `generating` is the newest entry and shows the still, the progress and the actions in place; nothing else shows progress (S6 "One job's progress") |
| 9 (Higgsfield assets) | A library: left list All, Favorites, Uploaded with counts; day-grouped grid; size slider, Filter, Select all | My clips (section 3): tabs All, Favorites, Uploaded; day groups; size slider; Filter; Select all; one source for feed and library |
| 9 | Tools, Shared and Private folders with counts | not adopted now: folders and sharing are a later design; the sidebar shows Characters and Shows under "Later" only as a place for the Create note's V4 and V5 |
| 10 (Higgsfield menu) | A top Features menu (Create Video, Lipsync, Talking Avatar, Upscale, Animate) and a Models list with one-line descriptions | not copied as a menu: Videos already has the rail, the Browse and Create mode switch and the app sidebar (S1, S2). The features become actions on a clip (Make it Max, Mix, Trim, Join) and later sidebar entries; the Models list is not shown to a person (Level instead) |
| 10 | Per-entry Rerun and Settings at the entry's foot | Another take and Remix in the icon row |
| 11 (studio form) | Numbered steps, a count of variations, a Visual References box with Upload | References group (Start frame, End frame, Voice clip) as a labelled box of slots; numbered steps and variation counts are not adopted (heavier than the dad test allows; one clip at a time is the household queue's rule) |

## 2. The Create page (decided on merit first, then checked against the rules)

What a person does: describe a clip, choose how it looks, press Generate, watch it appear, act on it, find it again. One page,
two panes, nothing that navigates away while a clip is made.

At 1024 px window width and up (1440 shown):

1. **Left: the control panel** (about 370 px, its own rounded pane; `prompt_bar` with `placement: "panel"`, K2a). Top to bottom: the
   prompt box (large; the Start frame attaches inside it as a named thumbnail; three idea chips show only while it is empty); References
   (Start frame, End frame, Voice clip as slots); Style (one control showing two small thumbnails and "Anime, Dolly in"; it opens the
   Look, Camera and Sound popover); Level (Standard, Boost, Max); Shape and Length; More settings; and at the foot **Generate** with
   the level and the estimated time under its label. The panel scrolls inside itself; Generate never moves.
2. **Right: the results feed** (the rest of the width, its own pane; `result_feed`, K10). A filter bar (Favorites only, Group by words,
   Type), then entries newest first. An entry is: the words, its tags and Start frame chip, the clip or the stage face for its state, an
   icon action row. States of an entry (VideoPlayer's own words, plus `draft`): `draft` (a still waiting: **Make the video from this**, **Another still**, **Edit words**),
   `queued` and `generating` (a soft poster, one progress bar, "Making your video, 42% done", **Cancel**), `ready` (the clip with the browser player's controls), `failed` (one line, **Try again**) and `cancelled` ("Stopped. Nothing was kept."). With no clips the feed says what to do in one sentence.
3. **The Videos header row and sidebar (S2: one header row per app).** The header row holds the title, the Browse and Create mode control
   (`contributes.header.modes`, unchanged) and the Search Videos trigger, left of the companion avatar. The sidebar holds entries only:
   **Create** and **My clips**, and below a quiet "Later" group (Characters, Shows) drawn only when those exist. No count is shown (the
   sidebar has no count field; a count would be a new kit gap and is not needed). The manifest holds the two real destinations; Favorites and Uploaded are tabs of My clips, because a sidebar entry is a page and carries no filter state, while the kit
   `tabs` node does.

Below 1024 px window width (the phone and a narrow window; `split_view` switches at the window-width `lg` breakpoint, and the panel takes its
mode from the enclosing `split_view`, never from its own width or query): the panel becomes a bottom dock (`placement: "panel"` follows the enclosing
`split_view`):
one line with the words, an **Options** round button and a round **Generate**. Options opens a bottom sheet (the kit Drawer) with References,
Level, Shape and Length, and the Look and Camera pickers as three-column thumbnails, Generate fixed at its foot. The feed fills the width; its
filter bar scrolls sideways; the icon row scrolls sideways. The app's sidebar is the shell's drawer (S1).

What this removes: the Create page, the Make a video page, the My creations page as built, the Ideas list, the Making now card, the dead
"Your video shows here" panel and the two full-width card grids. At 1440 by 900 the first screen shows the whole panel including Generate,
the newest clip with its actions, and the top of the next.

### Decisions

1. **The feed entry is the single running job's card.** S6 "One job's progress": progress lives on that job's card; the entry is that
   card. No banner, toast, second list or full-screen takeover.
2. **Controls follow S6.** When pictures and video are not ready, every control that starts a clip or a still is disabled with one line
   where the person acts, read from `useMakingAvailability` on the `["health"]` query. `prompt_bar` has a `disabledReason` prop, but
   the package-page renderer does not pass it and Home gives package pages no availability, and `player.actions` cannot be disabled
   today. K8 closes that; until it lands the page is not built. The round Generate of the phone dock and the Generate in the sheet take the
   same `disabledReason`. A disabled icon-only action row shows the one line as visible text on the entry (VideoPlayer's `hint`, shown in every status by K1), not only a
   tooltip. The existing one-time recovery toast of that S6 row is the only toast; nothing new is added.
3. **The Level segment shows only what the person may use.** Standard alone is no segment (today's fill). Max appears when the Stack
   reports it ready and the person holds it, greyed with its reason when the engine has it but not its pack (`videoMaxNotReadyReason`).
4. **Estimates are plain words per level from measured numbers** ([video-tiers](video-tiers-2026-11-02.md) section 3: Standard 10 s about
   43 s, Boost 5 s 42 to 74 s, Max 10 s 205 s): "under a minute", "about a minute", "about four minutes". No memory, size or model words.
5. **A control whose input fails its bench is absent, not disabled** (still-first section 4). The mockup draws the Voice clip slot dimmed
   only to show where it goes; it ships in VIDEO-UI-09 after VIDEO-INPUTS-05 passes. End frame the same after its bench.
6. **Remix is a refill.** It puts the entry's words and settings back in the panel (a `navigate` to this page with up to 8 state values,
   an existing action; needs K6) and the person presses Generate. Another take is the same words with a new seed, one press.
7. **Chat parity** (basis: VIDEO-CHAT-01 and VIDEO-INPUTS-01, both approved; S7 is only proposed and nothing here depends on it). The
   entry actions call the same Home functions as the chat video card and `edit_video` (`another_take`, `remix`, `make_it_max`, `trim`,
   `join`, `mix`); the still actions the same functions as the chat still card. Trim, Join and Mix need inputs (a range, other clips, a
   voice line); until the edit sheet (K7) lands they are not drawn and stay in chat, which has them.
8. **Adults only, unchanged.** Both pages stay `min_role: "adult"`; a child or teen sees no Create mode, has no level choice and keeps the
   silent Wan Quick lane in chat (video-tiers decision 1). Nothing loads from outside the home; thumbnails are the package's own loops.
9. **One store, two views.** The feed (recent, with filters) and My clips (everything, browsed) read the same `made-at-home` data; no second
   list of clips.

## 3. The My clips page (the library side)

Reference 9, mapped. Kit `tabs` (All, Favorites, Uploaded) over a `media_shelf` grid, day groups ("Today", "Yesterday", then a date),
a size slider, Filter (type, level, look), Select all with delete and share-to-screen from the existing batch pattern, and a press on a clip
plays it through the host player as today. Mockup: `?page=clips`. **Uploaded** lists the references the person put in (photos, voice
clips, later source clips), which is where Start frame, End frame and Voice clip can be picked from again. **Favorites** needs a flag: look
first for one on the Library file record (reuse); only if none exists add it there, spec first (VIDEO-UI-06 step 1).

Phone: the grid is two columns, the tabs and the toolbar scroll sideways, the sidebar is the drawer.

## 4. Reuse check (org principle 6, one definition each)

| Part | Decision | Why |
|---|---|---|
| Page layout | `split_view` `main` and `aside`, with `aside_side: "start"` (K11) | the two-column node exists; only the side is new |
| Control panel | `prompt_bar` (K2, K3), not a new panel | it already submits prompt, chips, tier and references in one action |
| Style picker | the cards chips shown as a popover group (K3) | one definition of a choice with thumbnails; `OptionCards` stays |
| Feed entry (the generated clip and its job) | the kit `VideoPlayer` Element (`ui/src/elements/video-player.tsx`), the same card the chat draws (`chatToolUis.tsx`): statuses `queued`, `generating`, `ready`, `failed`, `cancelled`, progress with estimate and place in line, engine preview, Stop, Retry, Download, Share, Make another, `actions` slot. K1 adds only what it lacks | rule 9b "a second copy of a part"; one card for chat and page |
| Feed with filters and grouping | new kit block `result_feed` (K10) composing `VideoPlayer`, `DayDivider` and the filter controls | no schema node exposes `VideoPlayer` or a bound feed with filters; a kit block composed of shipped parts is allowed (UI-DECISIONS row first) |
| A draft entry (the still waiting for the person) | `VideoPlayer` in its new `draft` status (K1), and the chat still card of VIDEO-INPUTS-02 is the same `VideoPlayer` in `draft`; `image-generation.tsx` is not used for it | exactly one Element draws the still with its three actions, on the page and in chat (still-first decision 6) |
| Day headings | `DayDivider` (`ui/src/elements/day-separator.tsx`, used by `ActivityFeed`) for K10 `group_by` and K12 | not rebuilt |
| `ActivityFeed`, `StoryFeed`, `MediaGrid` | considered, not used: `ActivityFeed` is a day-grouped list of text events with no player, `StoryFeed` draws news stories, `MediaGrid` draws still tiles without an entry's words, actions or states | none holds a clip, its job state and actions |
| Size slider | `CardSizeSlider` primitive (`ui/src/primitives/CardSizeSlider.tsx`, used by Home's `FilesPage`) for K12 `size_control` | not rebuilt |
| Library | `tabs` plus `media_shelf` grid, extended (K12: day headings from `DayDivider`, `size_control` from `CardSizeSlider`, favorite toggle) | exists; day groups, size slider and favorite are the only gaps |
| Slots | `prompt_bar.references` (two `picture` slots are Start and End frame; `audio`, `video` kinds are VIDEO-INPUTS-05 and -06) | already built |
| Idea chips | `prompt_bar.suggestions` (K2b), filled from `VIDEO_STARTERS` | replaces a list and a data scope |
| Download | `VideoPlayer`'s own Download | already there |
| Status | the existing `disabledReason` and the entry's job state (K8) | S6: no new surface |
| Loops | the 13 mp4 loops in the package | built, local |
| Store | the Library file and `made-at-home` | one store |

Considered and not used: a Home `*Panel`, `*Feed` or `*Dock` component (rules 9 and 9b: no wrapper); `category_tiles` and `card_grid` (they open
something, none writes a value into a submit); copying a top Features menu (section 1).

## 5. Kit gaps and the exact commons additions

Each is additive, spec first (`spec/ui/schema.json`, then the ui Element and its test), has its `UI-DECISIONS.md` row in commons before the
Element is written (rule 9b), and ships under a new tag; Home pins it in VIDEO-UI-06. Home writes no className, no CSS for a kit part, no wrapper.

| # | Node | Addition | Default | Why existing props cannot do it |
|---|---|---|---|---|
| K1 | `VideoPlayer` (the Element) | additive props, each default unchanged: a `draft` status with its still and three actions; per-action `when` (statuses) and `disabledReason`; `actionsVariant: "icons"` (icon buttons, label as accessible name and tooltip); `actionsInline` N with a More menu; a Favorite toggle; a `size` prop if an entry must be wider than the Element's maximum (about 576 px); the K8 `starts` marker. `hint` shows in every status (draft, ready, failed, cancelled, not only while queued or generating, where it shows today); K8 fills it with the `makingNotice` when any `starts` action on the entry is disabled. `VideoPlayer`'s built-in Stop, Retry and Make another (`onStop`, `onRetry`, `onMakeAnother`) also take `disabledReason` and the `starts` marker (Retry and Make another start a clip; Stop does not). The generic `player` is not changed and stays the Browse player | | the Element has Stop, Retry, Download, Share, Make another and an `actions` slot; it lacks these |
| K2a | `prompt_bar` | `placement: "panel"`: a left panel at the enclosing `split_view`'s side-by-side breakpoint, 1024 px window width (`lg`; scrolls inside, Generate pinned at its foot); below that a bottom dock (field, Options, round Generate) with the controls in a bottom sheet | `inline` | the bar is a block in the flow |
| K2b | `prompt_bar` | `suggestions`: up to 4 `{label, text}`, shown while the field is empty | none | idea chips |
| K2c | `prompt_bar` | `submit_detail`: `{state, labels}`, the small line under the submit label chosen by a chip or tier state | none | the time under Generate |
| K3a | `prompt_bar.chips[]` | `presentation: "popover"` on a `cards` chip and `group`: chips with the same group share one trigger with two thumbnails and open one popover (sheet on a phone); a text chip (Voices) may be in the group | inline | Look, Camera and Sound are one control |
| K3b | `prompt_bar` | `fold`: chips listed under "More settings" | none | Voices and Picture first |
| K3c | `prompt_bar.references[]` | `placement: "in_field"` on the first picture slot: the chosen picture shows inside the prompt box as a named thumbnail with a remove control | `row` | reference 8 |
| K4 | `prompt_bar.references[]` | `kind` gains `audio`, `video` | | planned by VIDEO-INPUTS-05 and -06 |
| K6 | `prompt_bar` | initial values of chips, tier and references read from page state on arrival (the prompt already is) | | Remix refills through `navigate` state. Verify first: if the bar already does it for chips, K6 is not needed |
| K7 | `VideoPlayer` actions | `sheet`: `{title, submit_label, fields: [{name, label, kind: number|text|clips}]}` | none | Trim, Join, Mix need inputs (VIDEO-UI-08) |
| K8 | host, `prompt_bar`, `VideoPlayer` actions, `result_feed` | `MediaHost.makingNotice(kind)` fed by `useMakingAvailability`; the renderer passes it as `disabledReason` and disables every action marked `starts: "picture"` or `"video"` with the same notice | no marker: unchanged | S6 row "Pictures and video are not ready" (owner ruling 2026-10-29) |
| K9 | `result_feed` | `poll_while`: statuses in which the feed re-reads only those jobs' own records every few seconds and stops once every row is settled, like the chat card's `VIDEO_POLL_MS` query | none | the newest entry follows a running job; the job record read S6 allows, not a new polling loop; only if the refresh check fails |
| K10 | new node `result_feed` | bound rows (newest first); per row one `VideoPlayer` (a draft is the same Element in `draft`) plus the words, tags and reference chips `{label, thumb}`; `filters` (toggle, select) that write page state the binding reads as `$state.<name>`; `group_by` (day through `DayDivider`, or the words); the entry's Stop, Try again and Another take are `VideoPlayer`'s own `onStop`, `onRetry` and `onMakeAnother`, mapped from a `handlers` prop (Cancel, Try again and Another take are not declared again as extra actions); only Remix, Make it Max, the draft actions and Favorite are extra `actions`, and an extra action with no `when` shows in `ready`; K1 and K8 | | the Dreamina feed: no existing node holds an entry with words, tags, a player and actions |
| K11 | `split_view` | `aside_side: "start"` | `end` | the panel is the left pane |
| K12 | `media_shelf` | `group_by_field` (a date field, `DayDivider` headings built as shipped: a centred label between hairlines such as "Today, 5 clips"; the mockup's left-aligned heading is not built unless a `DayDivider` variant is added here, never a className), `size_control` (`CardSizeSlider` writing tile density), `favorite` (`{field, action}` heart toggle) | none | the library of reference 9 |

Not verified: whether a package data binding refreshes while a job runs. VIDEO-UI-02's first step reads the host code and measures on a dev
hub; if it does not refresh, K9 is built.

## 6. Page JSON shape

Two files replace `create.json`, `make-video.json` and `creations.json`. The per-person fill (Style options, Level, lengths, suggestions,
estimates) stays in `videoCreateApp.ts` from the single lists.

`pages/create.json`:

```json
{
  "type": "page", "id": "videos-create", "title": "Create",
  "body": [{
    "type": "split_view",
    "aside_side": "start",
    "aside_label": "Make a video",
    "aside": [{
      "type": "prompt_bar", "placement": "panel",
      "label": "Describe a video",
      "placeholder": "Describe your video. Put each person's line in quotes.",
      "prompt_state": "prompt", "max_length": 1200, "submit_label": "Generate",
      "references": [
        { "state": "start_frame", "label": "Start frame", "kind": "picture", "placement": "in_field" },
        { "state": "end_frame", "label": "End frame", "kind": "picture" }
      ],
      "chips": "(filled per person: look and camera as popover cards in group Style, orientation, seconds; voices and picture first folded)",
      "tier": "(filled per person: Standard, Boost, Max)",
      "suggestions": "(filled from VIDEO_STARTERS)",
      "submit_detail": "(filled: estimate words per level)",
      "submit": { "call": { "target": "/api/plugins/videos/actions/make", "method": "POST",
        "args": { "prompt": "{prompt}", "orientation": "{orientation}", "seconds": "{seconds}", "tier": "{tier}",
                  "look": "{look}", "camera": "{camera}", "voices": "{voices}",
                  "start_frame": "{start_frame}", "end_frame": "{end_frame}" } } }
    }],
    "main": [{
      "type": "result_feed",
      "bind": { "source": "package", "path": "recipes",
                "params": { "scope": "feed", "favorites": "$state.favorites_only", "group": "$state.group_by_words", "type": "$state.type" } },
      "filters": [
        { "kind": "toggle", "state": "favorites_only", "label": "Favorites only" },
        { "kind": "toggle", "state": "group_by_words", "label": "Group by words" },
        { "kind": "select", "state": "type", "label": "Type", "options": [ { "value": "all", "label": "All" }, { "value": "video", "label": "Videos" }, { "value": "still", "label": "Stills" } ] }
      ],
      "fields": { "words": "prompt", "tags": "tags", "references": "references", "status": "status", "progress": "percent", "poster": "still", "src": "src", "favorite": "favorite" },
      "handlers": { "stop": { "call": { "target": "/api/plugins/videos/actions/cancel", "args": { "id": "{id}" } } },
                    "retry": { "starts": "video", "call": { "target": "/api/plugins/videos/actions/another", "args": { "id": "{id}" } } },
                    "make_another": { "starts": "video", "call": { "target": "/api/plugins/videos/actions/another", "args": { "id": "{id}" } } } },
      "actions_variant": "icons", "actions_inline": 4,
      "actions": [
        { "label": "Remix", "icon": "pencil", "action": { "navigate": { "to": "/apps/videos/create", "state": { "prompt": "{prompt}", "look": "{look}", "camera": "{camera}", "seconds": "{seconds}", "tier": "{tier}", "orientation": "{orientation}" } } } },
        { "label": "Make it Max", "icon": "sparkles", "starts": "video", "action": { "call": { "target": "/api/plugins/videos/actions/max", "args": { "id": "{id}" } } } },
        { "label": "Make the video from this", "starts": "video", "when": ["draft"], "action": { "call": { "target": "/api/plugins/videos/actions/render", "args": { "draft": "{id}" } } } },
        { "label": "Another still", "starts": "picture", "when": ["draft"], "action": { "call": { "target": "/api/plugins/videos/actions/still", "args": { "draft": "{id}" } } } },
      ],
      "empty_state": { "type": "empty_state", "icon": "film", "text": "Your clips show here. Describe a video on the left and press Generate." }
    }]
  }]
}
```

`pages/clips.json`: a `tabs` node (state `view`; tabs `all`, `favorites`, `uploaded`), each body one `media_shelf` with `layout: "grid"`,
`group_by_field: "created_at"`, `size_control: true`, `favorite`, `on_select: { "play": { "media_id": "{id}" } }`, bound to
`made-at-home` (or the Library uploads list) with `params.view`. Filter and Select all use the existing batch pattern.

Data: the `recipes` scope `feed` returns rows `{id, prompt, tags, references, state, percent, status, still, src, download_path, look, camera,
seconds, tier, orientation, favorite, created_at}` honoring the three filters, newest first (limit 30); it replaces the scopes `newest`,
`making`, `last` and `starters` (deleted with the old pages; the manifest data list stays at 16 ids). Routes `render`, `still` and `cancel` call
the same functions as the chat still card and the existing cancel; `max` is `make_it_max`; `end_frame` joins `make` with VIDEO-INPUTS-03.

## 7. Safety and privacy

Unchanged from the notes it joins: adult-only pages, gates in the functions the buttons call, a still passes the picture policy before it can
be a start frame, a withheld clip never reaches the feed, nothing is fetched at run time, a Look card never names a real person or a brand
character. The feed and library play only the person's own Library files. No memory, RAM, GB, model name, pack or engine words on either page;
a failure says what to do ("It did not finish. Try again.").

## 8. Slices, in build order

| Id | Size | Slice | Done when |
|---|---|---|---|
| VIDEO-UI-01 | S | This note, architect ruling, mockup, backlog rows | architect APPROVED; screenshots judged |
| VIDEO-UI-02 | M, commons | K1 `VideoPlayer` additions (draft status, `when`, `disabledReason`, icon variant, More menu, Favorite) and the K8 `starts` marker; the refresh check first | commons tests and tsc; opened at 1440 and 390; tag pushed |
| VIDEO-UI-03 | M, commons | K2a to K2c, K3a to K3c, K8 `disabledReason` pass-through, K6 check | same; keyboard and focus pass on popover and sheet; tag pushed |
| VIDEO-UI-04 | M, commons | K10 `result_feed` composing `VideoPlayer` and `DayDivider` (K8, K9 if needed) and K11 `split_view.aside_side`; the row names VideoPlayer and ActivityFeed | same; an entry in each state opened; tag pushed |
| VIDEO-UI-05 | S, commons | K12 `media_shelf` day groups, size slider, favorite | tests; opened at 1440 and 390; tag pushed |
| VIDEO-UI-06 | M, Home | pin the tags; `create.json` and `clips.json`; `feed` scope and fields; Favorite flag (reuse the Library's if it has one); K8 host wiring (`makingNotice` from `useMakingAvailability`); manifest three pages to two; delete old pages and four scopes; rewrite `docs/dev/videos-create.md` Pages; update `videoCreate.test.ts` | dev hub opened at 1440 and 390 with a real clip made and every entry state seen once; every starting control seen disabled while `engines.video` is not ready; a removed page link checked |
| VIDEO-UI-07 | S, Home | the `draft` entry wired to the still-first draft record (needs VIDEO-INPUTS-02) | each action pressed once on desktop and phone |
| VIDEO-UI-08 | M, commons then Home | K7 edit sheet on `VideoPlayer` actions; Trim, Join, Mix on an entry (needs VIDEO-CHAT-01 C3 and C4) | each tool run once from the page and from chat |
| VIDEO-UI-09 | S, Home | End frame and Voice clip slots after their benches pass (VIDEO-INPUTS-03, -05) | a clip with each input made from the page |

Order: 02, 03, 04, 05 as parallel commons worktrees (04 is the largest and the riskiest, start it first), then 06, which is the first thing
Jesse can open; 07 follows INPUTS-02, 08 the chat edit tools, 09 the benches.

## 9. Open points

None block 02 to 06. For the owner when 06 lands: whether Generate keeps the old word Make (one string). Folders, sharing and a Tools menu
(reference 9, 10) are not designed here; Characters and Shows (Create note V4 and V5) join the sidebar when built.
