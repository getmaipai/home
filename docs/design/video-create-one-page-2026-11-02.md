# Videos Create: one page, a stage, a feed and a docked prompt (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending. No code. Item: VIDEO-UI-01. Replaces the three-page Create mode of
[video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md) with one page. Mockup, opened and judged at 1440 and 390 wide, light
and dark: [assets/video-one-page-2026-11-02/index.html](assets/video-one-page-2026-11-02/index.html) (captures beside it).

Owner feedback (Jesse, 2026-11-02): "I dont understand our current ui for video gen and especially it seems wasteful and probably not
what Higgsfield AI does."

What he saw, read from a dev hub and the page files: Create is a textbox with Next, an Ideas list and a Making now card
(`pages/create.json`). Make a video is a small prompt box, a Picture slot, a Look grid of five big cards, a Camera grid of eight big
cards, small dropdowns, and the Make button below the fold (`pages/make-video.json`). Its right column, a `player`, is empty until a
clip exists. My creations is a separate empty page (`pages/creations.json`). One job over three pages, the main control smallest, the
stage dead while you type.

## Supersedes and amends

Nothing approved is deleted; each line names the passage and what it says after this note.

- [video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md) section 1 (the screen): "Left panel" and "Stage column" are replaced by
  the layout in section 1 here. Its controls stay (Look, Camera, Level, Length, Voices, references); their place and form change: Look
  and Camera leave the page as inline card grids and live in one Style popover (sheet on a phone); the controls sit in a docked bar.
- Same note, section 2 (reuse check): the row "Look and Camera cards: a `variant: "cards"` of the `prompt_bar` chips" stands for the
  cards themselves and gains a `presentation` (inline or popover). The row "Shot strip: reuse `media_shelf`" changes from a strip under
  the stage to the Your clips column beside it (section 1). The row "Preview stage: reuse the `player` node" stands and the player gains
  stage states (section 3, K1).
- Same note, section 6: U1 (chip cards, `references`) and U2 (the 13 loops, now in `backend/packages/videos/assets/loops/`) are built;
  U3 (rebuild the Make and Create pages) and U4 (phone and keyboard pass) are replaced by VIDEO-UI-05 here. The button words change from
  Make to Generate (a label only; the chat tools keep their names).
- [video-still-first-2026-11-02.md](video-still-first-2026-11-02.md): the "stage's confirm state" it asks for (VIDEO-INPUTS-02) is
  drawn here, inside the stage, as the `draft` state with three actions (K1). The reference slots it names (Start frame, End frame, Voice
  clip, Source clip) sit in the docked bar. Its decisions 1 to 10 are unchanged.
- [video-create-2026-11-01.md](video-create-2026-11-01.md) section 3 (the Make page layout) is already amended by the Create UI note;
  this note amends it again the same way.
- The Videos manifest: `contributes.sidebar.groups[id=create].pages` goes from `["create", "make-video", "creations"]` to `["create"]`;
  the `make-video` and `creations` entries in `contributes.pages` and their two page files are removed in VIDEO-UI-05. The `create`
  mode of `contributes.header.modes` (`page: "create"`) is unchanged.
- [../dev/videos-create.md](../dev/videos-create.md) "Pages" is rewritten in VIDEO-UI-05 (same commit as the code).

## 1. The screen (decided on merit first)

What a person does: describe a clip, pick how it looks, press Generate, watch it appear, act on it, find it again later. That is one
loop, so it is one page, and the person's eye goes in this order: the prompt, the stage, the clips.

One page, three regions inside the Videos content area (the shell, rail and header row are untouched, S1 and S2):

1. **Stage (top, left).** A 16:9 surface, the largest thing on the page. It is the only place a clip is ever shown, in this order of
   states: `idle` (nothing yet: "Your video shows here", with the idea chips in the dock), `draft` (a still waiting for the person:
   **Make the video from this**, **Another still**, **Edit words**), `queued` and `running` (the still or a soft poster, one progress
   bar, one plain line such as "Making your video, 42% done", **Cancel**), `done` (the clip playing with the kit's own controls),
   `failed` (one line with the next step and **Try again**). The words of the clip and its settings as small tags sit under it. The
   actions sit in one row under the tags: **Download**, **Another take**, **Remix**, **Make it Max** (only for a person who holds Max
   and when the engine offers it), then **More** with **Trim**, **Join**, **Mix**.
2. **Your clips (right of the stage, from 1024 px; under it on a narrower screen).** The person's clips newest first, as vertical rows
   with a picture, the words and the settings, a running time, and **Another take** on each row. A clip being made is the first row with
   a "Making" badge and the played-share bar showing its progress. Choosing a row shows that clip in the stage; it replaces My creations.
3. **Prompt dock (bottom).** One bar docked to the bottom of the content area, always in reach: a large prompt field, the Start frame,
   End frame and Voice clip slots, a **Style** control (the Look and Camera pickers and the Voices choice, with two small thumbnails of
   the current choice), **Shape**, **Length**, the **Level** segment (Standard, Boost, Max), and **Generate** with the estimated time
   under it. While the prompt is empty, three idea chips sit above the field and fill it (they replace the Ideas list).

Phone (390 wide): the stage is first at full width, then its tags and actions (a row that scrolls sideways), then Your clips as rows,
and the dock stays at the bottom as one line: the field, an **Options** round button and a round **Generate** button. Options opens a
bottom sheet with the slots, Level, Shape, Length, and the Look, Camera and Sound pickers as three-column thumbnails, with Generate
fixed at the sheet's foot. The three draft actions sit under the picture, never over it, at every width.

What this removes: the Create page, the Make a video page, the My creations page, the Ideas list, the Making now card, the dead
"Your video shows here" panel and the two full-width card grids. The page above the fold at 1440 by 900 shows the clip, its actions,
eight clips and the whole prompt bar; before, the Make button was below the fold and the stage was empty.

What the page borrows from a modern generation tool (the owner's reference): a large generation stage over a feed of the person's own clips, a docked bar with reference slots, a style picker with thumbnails, one Generate. Nothing is copied that would send data out of the home or show a resource word (section 6).

### Decisions

1. **The stage owns the single running job's progress.** The "One job's progress" row of S6 says progress lives on that job's own card;
   the stage is that card. No banner, toast or second list.
2. **Controls follow S6.** When pictures and video are not ready, Generate and every stage action that starts work are disabled with
   one line where the person acts, read from `useMakingAvailability` on the `["health"]` query. The `prompt_bar` has a
   `disabledReason` prop, but the package-page renderer does not pass it and Home gives package pages no availability, and `player.actions` and
   `media_shelf.row_actions` cannot be disabled today. K8 closes that; until it lands the page is not built. No new status surface.
3. **The Level segment shows only what the person may use.** Standard alone is no segment (today's fill). Max appears when the Stack
   reports it ready and the person holds it, greyed with its reason when the engine has it but not its pack
   (`videoMaxNotReadyReason`), as the build does now. Boost and Max show their time next to Generate.
4. **Estimates are plain words, per level, from measured numbers only** ([video-tiers](video-tiers-2026-11-02.md) section 3: Standard
   10 s about 43 s, Boost 5 s 42 to 74 s, Max 10 s 205 s): "under a minute", "about a minute", "about four minutes". No memory, size or
   model words anywhere on the page (no-resource-words ruling, 2026-11-01).
5. **A control whose input fails its bench is absent, not disabled** (still-first section 4). The mockup draws the Voice clip slot
   dimmed only to show where it goes; it ships with VIDEO-UI-08 after VIDEO-INPUTS-05 passes. End frame the same after its bench.
6. **Remix is a refill, not a new job.** It puts the clip's words and settings back in the dock (a `navigate` to this page carrying
   up to 8 state values, an existing action) and the person presses Generate. Another take is the same words and a new seed, one press.
7. **Chat parity (basis: VIDEO-CHAT-01 and VIDEO-INPUTS-01, both approved; S7 is only proposed and nothing here depends on it).** The stage actions call the same Home functions as the chat video card and
   `edit_video` (`another_take`, `remix`, `make_it_max`, `trim`, `join`, `mix`) and the still actions the same functions as the chat
   still card ([video-chat-2026-11-02.md](video-chat-2026-11-02.md), [video-still-first](video-still-first-2026-11-02.md) decision 6).
   Trim, Join and Mix need inputs (a range, other clips, a voice line); until the edit sheet (K7) lands they are not drawn on the
   page and stay available in chat, which already has them. The page never offers something chat cannot do, and chat's tools never
   need the page.
8. **Adults only, unchanged.** Every page stays `min_role: "adult"`; a child or teen sees no Create mode, gets no level choice and
   keeps the silent Wan Quick lane in chat (video-tiers decision 1). Nothing on this page loads a thing from outside the home:
   thumbnails are the package's own loops, played locally.

## 2. Reuse check (org principle 6, one definition each)

| Part | Decision | Why |
|---|---|---|
| Stage | the existing `player` node, extended with stage states (K1) | a second "stage" node would copy the player; the item already carries `poster`, `title`, `actions`, `empty_state` |
| Your clips | `media_shelf` with `orientation: "vertical"`, `row_actions`, `item_progress_field`, `item_badge_field`, `item_highlight_field`, all existing | a clip in progress is a row with the progress bar the shelf already draws |
| Page layout | `split_view` `main` and `aside` (stacks under 1024 px), existing | no new layout node for the two columns |
| Dock | `prompt_bar` (K2), not a new bar | the bar already submits prompt, chips, tier and references in one action |
| Style picker | the `prompt_bar` cards chips shown as a popover (K3) | one definition of a choice with thumbnails; the cards component is the existing `OptionCards` |
| Slots | `prompt_bar.references` (two `picture` slots are Start and End frame; `audio` and `video` kinds are VIDEO-INPUTS-05 and -06) | already built; only the kinds grow |
| Idea chips | `prompt_bar.suggestions` (K2), filled from `VIDEO_STARTERS` | replaces a list and a data scope; no tile node writes into a prompt |
| Download | an `href_field` on a player action (K1) | the kit has no download action; a call cannot return a file link |
| Remix | `navigate` with state, existing | no new action kind |
| Status | the existing `disabledReason`, the player's own job state, the shelf's progress bar | S6: no new surface |
| Look and Camera loops | the 13 mp4 loops already in `backend/packages/videos/assets/loops/` (416 KB total) | built and local |
| Library, trash, storage | unchanged; a clip is the same Library file | one store |

Considered and not used: a Home `*Stage` or `*Dock` component (rule 9 and 9b: no wrapper, no Home component that draws a box around a
kit part); `category_tiles` and `card_grid` (they open something, none writes a value into a submit); a full-screen takeover while
rendering (the person leaves the page and the clip lands in Your clips; no second progress surface).

## 3. Kit gaps and the exact commons additions

Each is additive, spec first (`spec/ui/schema.json`, then the ui Element and its test), has its `UI-DECISIONS.md` row in commons
before the Element is written (rule 9b), and ships under a new tag; Home pins it in VIDEO-UI-05. Home writes no className, no CSS
for a kit part and no wrapper.

| # | Node | Addition | Default | Why the existing props cannot do it |
|---|---|---|---|---|
| K1a | `player` | `fields.state`, `fields.percent`, `fields.status`, `fields.still` (dotted paths). An item whose state is not `done` draws a stage face: the still (or a plain tonal surface) with a determinate progress bar and the status line, instead of the video | absent: today's behavior | the player only plays a finished file; the page needs one surface for draft, waiting, making and failed |
| K1b | `player.actions[]` | `when`: array of `idle`, `draft`, `queued`, `running`, `done`, `failed` | `["done"]` | the three still actions, Cancel and Try again must appear only in their states |
| K1c | `player.actions[]` | `href_field`: dotted path to a same-origin path; the button is an anchor with `download`. An item needs `action` or `href_field` (a `oneOf`; today `action` is required) | absent | Download |
| K1d | `player` | `actions_inline` (integer): the first N visible actions draw as buttons, the rest in a **More** menu; the cap on `actions` goes from 6 to 8. It is the one overflow rule: with `actions_inline` set, `actions_wrap` is ignored | all inline | seven actions do not fit one row at phone width |
| K2a | `prompt_bar` | `placement: "dock"`: sticks to the bottom of the content area, the field is large, controls sit in one row; below 640 px it collapses to the field, an Options button and a round Generate, and the controls open in a bottom sheet (Drawer) | `inline` | the bar is a block in the page flow today |
| K2b | `prompt_bar` | `suggestions`: up to 4 `{label, text}`; shown only while the field is empty, a press fills the field | none | idea chips |
| K2c | `prompt_bar` | `submit_detail`: `{state, labels}`; the small line under the submit label chosen by a chip or tier state (`{"state":"tier","labels":{"standard":"under a minute",...}}`) | none | the time under Generate |
| K3 | `prompt_bar.chips[]` | `presentation: "popover"` on a `cards` chip and `group` (a short string): chips with the same `group` share one trigger, labelled with their chosen options and two thumbnails, and open one popover (sheet on a phone) with a heading and thumbnails per chip. A non-card chip may be in the group (Voices, text radios) | `inline`, no group | Look, Camera and Voices must be one control, not three |
| K4 | `prompt_bar.references[]` | `kind` gains `audio` and `video` | | already planned by VIDEO-INPUTS-05 and -06; listed so the slot row is one definition |
| K5 | `media_shelf` | `select_state`: a page-state key; pressing a row writes its key there and draws the current ring on the matching row, no navigation | none | choosing a clip must not leave the page (a `navigate` to this page would drop the unsent prompt, since the bar writes `prompt` only on submit) |
| K6 | `prompt_bar` | initial values for chips, tier and references are read from page state on arrival (the prompt already is) | | Remix refills through `navigate` state. Verify first in VIDEO-UI-02: if the bar already does this for chips, K6 is not needed |
| K8 | host, `prompt_bar`, `player.actions[]`, `media_shelf.row_actions[]` | `MediaHost` gains `makingNotice(kind)` (Home feeds it from `useMakingAvailability`); the renderer passes it as `disabledReason` to `prompt_bar`; actions and row actions gain `starts: "picture" or "video"`, and the renderer disables each marked button and shows the same notice while that engine is not ready | no marker: unchanged | S6 row "Pictures and video are not ready" (owner ruling 2026-10-29): every starting control is disabled with one line, never a raw error after a click. Starting controls: Generate, Another take, Remix refill excepted (it starts nothing), Make it Max, Try again, Make the video from this, Another still, the shelf's Another take |
| K9 | `player` | only if the refresh check below fails: `poll_while` (list of states) re-reads the bound item every few seconds while its state is listed, like the chat video card's poll | none | the stage must follow a running job without a Home polling loop |
| K7 | `player.actions[]` | `sheet`: `{title, submit_label, fields: [{name, label, kind: number|text|clips}]}`; the action opens a small sheet and fires with the answers | none | Trim (a range), Join (2 to 6 clips), Mix (a voice line, a level) need inputs; VIDEO-UI-07 |

What is not verified: whether a package data binding refreshes on its own while a job runs (the Making now list on today's page
suggests it should). VIDEO-UI-02's first step reads the host code and measures on a dev hub; if it does not refresh, K9
is added: the player re-reads its own item every few seconds only while the item's state is `queued` or `running`, the job record
read S6 allows and not a new status surface.

## 4. Page JSON shape

One file replaces `create.json`, `make-video.json` and `creations.json`. Shown with the per-person fill left to
`videoCreateApp.ts` (the fill adds Style options, Level, lengths, suggestions and estimates from their single lists, as it does today).

```json
{
  "type": "page",
  "id": "videos-create",
  "title": "Create",
  "body": [
    {
      "type": "split_view",
      "aside_label": "Your clips",
      "main": [
        {
          "type": "player",
          "kind": "video",
          "bind": { "source": "package", "path": "recipes",
                    "params": { "scope": "stage", "clip": "$state.clip" } },
          "fields": { "state": "state", "percent": "percent", "status": "status", "still": "still" },
          "details": true,
          "details_show": ["title", "facts"],
          "actions_inline": 4,
          "actions": [
            { "label": "Download", "icon": "download", "href_field": "download_path" },
            { "label": "Another take", "starts": "video", "icon": "refresh-cw", "action": { "call": { "target": "/api/plugins/videos/actions/another", "args": { "id": "{id}" } } } },
            { "label": "Remix", "icon": "pencil", "action": { "navigate": { "to": "/apps/videos/create", "state": { "prompt": "{prompt}", "look": "{look}", "camera": "{camera}", "seconds": "{seconds}", "tier": "{tier}", "orientation": "{orientation}" } } } },
            { "label": "Make it Max", "starts": "video", "icon": "sparkles", "action": { "call": { "target": "/api/plugins/videos/actions/max", "args": { "id": "{id}" } } } },
            { "label": "Make the video from this", "starts": "video", "when": ["draft"], "action": { "call": { "target": "/api/plugins/videos/actions/render", "args": { "draft": "{id}" } } } },
            { "label": "Another still", "starts": "picture", "when": ["draft"], "action": { "call": { "target": "/api/plugins/videos/actions/still", "args": { "draft": "{id}" } } } },
            { "label": "Cancel", "when": ["queued", "running"], "action": { "call": { "target": "/api/plugins/videos/actions/cancel", "args": { "id": "{id}" } } } },
            { "label": "Try again", "starts": "video", "when": ["failed"], "action": { "call": { "target": "/api/plugins/videos/actions/another", "args": { "id": "{id}" } } } }
          ],
          "empty_state": { "type": "empty_state", "icon": "film", "text": "Your video shows here. Describe it below, then press Generate." }
        }
      ],
      "aside": [
        {
          "type": "media_shelf",
          "heading": "Your clips",
          "bind": { "source": "package", "path": "made-at-home", "params": { "limit": 200 } },
          "orientation": "vertical",
          "item_key_field": "id", "item_label_field": "title",
          "item_subtitle_field": "{settings}", "item_media_field": "thumbnail",
          "item_meta_field": "duration_s", "item_badge_field": "badge",
          "item_progress_field": "progress", "item_highlight_field": "current",
          "aspect": "wide", "variant": "plain",
          "select_state": "clip",
          "row_actions": [ { "icon": "refresh-cw", "starts": "video", "label": "Another take", "action": { "call": { "target": "/api/plugins/videos/actions/another", "args": { "id": "{id}" } } } } ],
          "empty_state": { "type": "empty_state", "icon": "library", "text": "Clips you make show up here, newest first." }
        }
      ]
    },
    {
      "type": "prompt_bar",
      "placement": "dock",
      "label": "Describe a video",
      "placeholder": "Describe your video. Put each person's line in quotes.",
      "prompt_state": "prompt",
      "max_length": 1200,
      "submit_label": "Generate",
      "references": [
        { "state": "start_frame", "label": "Start frame", "kind": "picture" },
        { "state": "end_frame",   "label": "End frame",   "kind": "picture" }
      ],
      "chips": [ "(filled per person: look and camera as popover cards in group Style, voices in the same group, orientation, seconds)" ],
      "tier": "(filled per person: Standard, Boost, Max)",
      "suggestions": "(filled from VIDEO_STARTERS)",
      "submit_detail": "(filled: estimate words per level)",
      "submit": { "call": { "target": "/api/plugins/videos/actions/make", "method": "POST",
                            "args": { "prompt": "{prompt}", "orientation": "{orientation}", "seconds": "{seconds}", "tier": "{tier}",
                                      "look": "{look}", "camera": "{camera}", "voices": "{voices}",
                                      "start_frame": "{start_frame}", "end_frame": "{end_frame}" } } }
    }
  ]
}
```

Data and routes: the `recipes` scope `stage` returns one row for `$state.clip`, else the newest Create job in any state, as
`{id, src, title, state, percent, status, still, download_path, prompt, look, camera, seconds, tier, orientation}`; it replaces the
scopes `newest`, `making`, `last` and `starters` (those four are deleted with the three pages; the manifest data list stays at 16 ids).
`made-at-home` gains `settings`, `badge`, `progress` and `current` per row. Routes `render`, `still` and `cancel` call the same
functions as the chat still card and the existing cancel; `max` is `make_it_max`; `end_frame` joins `make` only with VIDEO-INPUTS-03.

## 5. Safety and privacy

Unchanged from the three notes it joins: adult-only page, gates in the functions the buttons call (not in the card), a still
passes the picture policy before it can be a start frame, a withheld clip never reaches the stage, nothing is fetched at run time,
and a Look card never names a real person or a brand character. The stage plays only the person's own Library files.

## 6. Words the page may not use for a person

No memory, RAM, GB, model name, pack or engine words on the page, in the estimates or in a failure line. A failure says what to do
("It did not finish. Try again.") as `statusLine` does now.

## 7. Slices, in build order

| Id | Size | Slice | Done when |
|---|---|---|---|
| VIDEO-UI-01 | S | This note, architect ruling, mockup, backlog rows | architect APPROVED; screenshots judged |
| VIDEO-UI-02 | M, commons | K1a to K1d, the K8 `starts` marker on `player.actions`, K9 if needed, and the K6 check: `player` stage states, `when`, `href_field`, `actions_inline`; UI-DECISIONS row; the refresh check of section 3 | commons tests and tsc pass; Element opened in a story or page at 1440 and 390; tag pushed |
| VIDEO-UI-03 | M, commons | K8 `disabledReason` pass-through, K2a to K2c, K3, K4 (`audio`, `video` kinds only if VIDEO-INPUTS-05 or -06 is near; else with them): dock, suggestions, submit detail, popover group, phone sheet; UI-DECISIONS row | same; keyboard and focus pass on the popover and the sheet; tag pushed |
| VIDEO-UI-04 | S, commons | K5 `media_shelf.select_state`, K8 `starts` on `row_actions` | test; tag pushed |
| VIDEO-UI-05 | M, Home | pin the three tags; the one page JSON; the `stage` scope and `made-at-home` fields; the Estimates; manifest from three pages to one; delete the two pages and four scopes; rewrite `docs/dev/videos-create.md` "Pages"; tests in `videoCreate.test.ts` | dev hub opened at 1440 and 390, a real clip made and shown in the stage, every stage state seen once, Another take and Remix pressed once, a removed `make-video` link checked (redirect kept if the shell shows a dead page); K8 host wiring (`makingNotice` from `useMakingAvailability`) and every starting control seen disabled while `engines.video` is not ready |
| VIDEO-UI-06 | S, Home | the `draft` state wired to the still-first draft record, Make the video from this, Another still, Edit words, Cancel | needs VIDEO-INPUTS-02; each action pressed once |
| VIDEO-UI-07 | M, commons then Home | K7 edit sheet; Trim, Join, Mix on the stage | needs VIDEO-CHAT-01 C3 and C4; each tool run once from the page and from chat |
| VIDEO-UI-08 | S, Home | End frame and Voice clip slots drawn after their benches pass | needs VIDEO-INPUTS-03 and -05 |

Order: 02, 03 and 04 in parallel (separate commons worktrees; 04 is small enough to ride with 02), then 05, which is the first thing
Jesse can open. 06 follows INPUTS-02, 07 follows the chat edit tools, 08 follows the benches.

## 8. Open points

None block 02 to 05. For the owner when 05 lands: whether Generate should keep the old word Make (a label only, one string).
Not decided here and not needed: a storyboard tab and a character gallery (Create note V4 and V5) would be new regions of this page
and get their own note.
