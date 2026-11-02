# Videos Create: making it feel like Higgsfield (design draft, 2026-11-02)

Status (2026-11-02): proposed. No code. Item: VIDEO-UI-10. Amends [video-create-one-page-2026-11-02.md](video-create-one-page-2026-11-02.md)
(VIDEO-UI-01, revision 7, built as VIDEO-UI-06) mostly in look and proportion, with the behaviour changes listed under "Supersedes and amends"; its structure (two panes, `prompt_bar` panel, `result_feed`,
Generate pinned, adult-only, estimates in words) is unchanged. Mockup, opened and judged at 1440 and 390 wide, light and dark:
[assets/video-create-feel-2026-11-02/index.html](assets/video-create-feel-2026-11-02/index.html) (`?theme=light|dark&state=feed|empty&open=style`,
`&phone=1`; `bash cap.sh` regenerates the captures). Captures of the page as built today, from a dev hub with eight seeded clips, are in
`assets/video-create-feel-2026-11-02/current/`.

Owner feedback (Jesse, 2026-11-02): "create page is looking better but it doesnt have that higgsfield feel and look".

## Supersedes and amends

Each line names the passage of `video-create-one-page-2026-11-02.md` and what it says after this note.

- Section 2 item 1 "up to 360 px, the `split_view` aside maximum": the panel is 420 px through `split_view` `aside_width: "wide"` (item 3 here). The panel order, top to bottom, stays the one built today: prompt box (Start frame inside it as a tile, idea chips under it), Style, Level, Shape and Length, More settings, Generate. Style becomes a poster banner; nothing moves.
- Section 2 item 1 "Generate with the level and the estimated time under its label": the time is inside the button (`submit_detail.placement: "in_button"`).
- Section 2 item 2 "A filter bar (Favorites only, Group by words, Type), then entries newest first. An entry is: the words, its tags and Start frame chip, the clip or the stage face, an icon action row": the filters sit behind one View button (item 6); an entry is the media look (item 2); a "Try this" rail sits above the feed (item 1).
- Section 2 item 2 "With no clips the feed says what to do in one sentence" and the section 6 `empty_state.text`: the sentence changes to the one in item 7 and the rail above it is the stage.
- Section 2 phone paragraph "its filter bar scrolls sideways": the View button and its sheet; the rail scrolls sideways.
- Section 1 table, refs 7 and 8 rows "Generate ... with the cost line above it" and "Filter bar over the feed": amended as above.
- Section 6 `pages/create.json` gains a `media_shelf` node in `main` before `result_feed`.
- Section 9 open point (a) "everything defaults to Auto" was a backlog note, not scope; it is scope here (item 4: an Auto card in Look and Camera; item 7). The `videoCreateApp.ts` comment "`none` is not a card, so no card is chosen until the person picks one" is replaced by the Auto card. Look's `natural` is shown on the card as "Auto" with the same value; feed tags still print the look's own label ("Natural").
- Decision 3 (greyed Max with its reason) is kept and drawn: a disabled Level card shows its reason in place of its promise.
- `docs/dev/videos-create.md` "Pages" is rewritten in VIDEO-UI-15.

## 1. What the page is today, measured

Dev hub, Sage, 1440 by 900, eight clips seeded from the 13 package loops, Stack down (Generate disabled):

- The panel is 360 px wide (25 percent). The prompt box is 324 by 72 px. Start frame is a thin text link inside it. Style is a 56 px row with a
  40 px thumbnail. Level is a small text segment with one line ("Up to 5 seconds"). Generate is 326 by 56 px, grey while it is disabled, with the
  time as a line under it.
- The feed pane starts with three filter controls (Favorites only, Group by words, Type), then entries. An entry is the words in small text, tag
  chips, a 647 px wide player (the kit's `size: "lg"`, 768 px maximum) pushed to the left of a 1384 px pane with blank space on its right, a grey
  action strip, and the same words again as a caption under the strip. At 390 wide the three filters take three rows before the first clip.
- With no clips (Favorites only on, as the owner sees a first run) the pane is a 24 px film icon and one line. Nothing moves, nothing invites.
- What is already right and stays: the Style popover with looping Look and Camera cards, the pinned Generate with time words, the dock and sheet
  on a phone, `result_feed` entry states, Favorite, Remix, Make it Max, "Auto" in the sense that a prompt alone is enough to start.

## 2. Gap table

What Higgsfield and Dreamina do comes from `data-scratch/research/higgsfield-ui/REPORT.md` and `dreamina-ui/REPORT.md` and the owner's references 7 to 11.

| # | Higgsfield and Dreamina | MaiPai today | Change |
|---|---|---|---|
| G1 | The stage is never empty: a How it works demo, community tiles, then the result feed; Cinema Studio shows a strip of poster tiles above its composer | an icon and one line; the feed is the whole stage | "Try this" poster tiles on the stage; a press fills the panel (Create Similar) |
| G2 | Result cards are media first: big, grid or masonry, the prompt as a caption, a calm action row on hover | words, chips, a 647 px player left of blank space, a grey strip, the words twice | a media-first feed look: wide first entry, two-column grid, tags on the picture, one caption, actions on hover |
| G3 | A preset card at the top of the panel: a large looping thumbnail, a bold name, a Change button | a 56 px row with a 40 px thumbnail | the Style trigger becomes a poster banner; the popover grows and each group gets an Auto card |
| G4 | A large reference box ("Add references") and a tall prompt box | a text link and a 72 px prompt | Start frame as a big tile, a roomy prompt |
| G5 | A Model row that explains itself (name, badges) | three words and "Up to 5 seconds" | three Level cards with a one-line promise and the time each |
| G6 | One very prominent Generate, with the cost on it | a 56 px button, grey when disabled, the time under it | a 64 px full-width button with the time inside it; the primary token |
| G7 | A panel about 28 percent wide | 25 percent, cramped | the panel at 420 px at the kit's desktop breakpoint |
| G8 | Dark, cinematic framing; media glows against it | a pale card on a pale canvas | the stage is a recessed pane on a new kit token, `--surface-stage`; the dark look comes from the person's dark theme, never from a fixed colour |
| G9 | Filters tucked into a View popover (Library: square or masonry, split by date, size) | three permanent controls; three rows on a phone | one View button that opens the same three controls |
| G10 | Everything defaults to Auto, so a first run is one prompt | true in effect, but nothing says it | an Auto card in Look and Camera, and the empty-state line says "Everything else is automatic" |
| G11 | Phone: a composer and a settings sheet with big rows and Apply | dock and sheet exist; the sheet reuses the small controls | the sheet gets the banner, the tile and the Level cards from the same props; the stage starts with a tile rail |

Not copied, on purpose: credits on every button, 250 presets and model names as the main choice, a tutorial as the default stage that hides
results, uppercase hype headlines, a lime accent. The accent is the theme's `--primary` (black or white by default); a person who wants colour
picks a coloured theme, and every part follows.

## 3. The changes, in priority order

Marks: (a) doable now with existing kit props and variants and page JSON plus package data; (b) needs a commons addition (the exact prop or
variant named). Impact is the expected change in how the page feels at first sight (high, medium, low).

1. **An alive stage: "Try this" tiles. (a) Impact high.** A `media_shelf` rail at the top of `main`, above the feed: `heading: "Try this"`, `layout: "rail"`, `aspect: "poster"` (2:3), `variant: "plain"`, `card_radius: "tight"`, `press_scale: true`, the label and subtitle under each tile as the node draws them (no overlay, no hover pill). It is bound to a new `recipes` scope `showcase`: `{id, title, subtitle, thumbnail, prompt, look, camera}`, five to eight rows built from the 13 loops and the Look and Camera tables in `lib/videos/recipes.ts`. `on_select` is a `navigate` to `/apps/videos/create` with state `{prompt, look, camera}`, the refill Remix already uses (VIDEO-UI-06), so a press fills the panel and starts nothing (S6: no disabled control, no status). One rail at one size, with or without clips: with an empty feed it is the rail on top and the feed's own one-line `empty_state` below it (mockup `empty-1440-*`), so the stage is never dead. `item_media_field` is an image only (`SafeImage`), so the tiles ship as posters (a jpg per loop beside the mp4, 13 small files, frame at 0.8 s) and looping is item 8's `media_loop`, a commons addition. The mockup's tiles match what `media_shelf` draws today.
2. **A media-first feed. (b) Impact high.** `result_feed` gains `look: "media"` (default `"default"`, unchanged): the newest entry is wide, the rest sit in a two-column grid (keyed on the pane's width, not the window: two columns only when the pane gives each at least 320 px; one column otherwise), the tags move onto the picture's top edge, the words show once, and the action row appears on hover or focus and stays visible on touch. The Element changes, not the feed: `VideoPlayer` gains four props, each defaulting to today's look, spec first, each with its `UI-DECISIONS.md` row (rule 9c): `caption: false` (the player prints no caption), `badges` (short strings drawn on the picture's top edge), `chrome: "overlay"` (Favorite, the play button and the icon action row drawn over the picture on `--art-overlay` and `--art-foreground`) and `actionsReveal: "hover"` (the icon row of the `ready` and `draft` states shows on hover or focus and always on touch). `result_feed` passes these props and draws nothing over the Element. The one caption is the feed's own words paragraph under the player (`data-slot="result-feed-words"`), so the words cannot show twice or not at all. `actionsReveal` hides only that icon row: the `notice` line, progress, Stop, the failed reason and Try again stay visible at rest in every status (S6; VIDEO-UI-01 decision 2). The first entry uses the existing `size: "xl"`, the others `"lg"`.
3. **A bigger, bolder panel. (b) Impact high.** One slice of three prop additions, each default unchanged:
   - `split_view` `aside_width: "wide"` (420 px at `lg` and up; the phone is unchanged). G7.
   - `prompt_bar` `field_size: "large"` (the prompt box about 140 px tall at the panel, 5 rows) and `references[].placement: "tile"` (a dashed
     full-width tile with an icon, the label and a one-line hint; once a picture is chosen it shows as the named thumbnail with a remove control,
     as `in_field` does today). G4.
   - `prompt_bar` `tier.presentation: "cards"` (three cards: label, the tier's own `hint` as the promise, and the time words from
     `submit_detail.labels` when `submit_detail.state` is the tier's `state`, which `videoCreateApp.ts` sets only when a tier segment exists; a disabled tier shows its `disabled_reason` as visible text in place of its promise, VIDEO-UI-01 decision 3 and S6) and `submit_detail.placement: "in_button"` (the time on the second line of the button, a 64 px full-width Generate). G5, G6.
4. **Style as a poster banner. (b) Impact high.** `prompt_bar` chips in a popover `group` gain `trigger: "banner"`: the trigger draws the chosen Look's
   loop as a 16 by 6 banner with "Look and camera", the two names ("Anime, Dolly in") and a Change pill; the popover gains `popover_size: "wide"`
   (about 760 px, six cards a row, Look and Camera as two sections with tabs below `lg`). The Auto card (G10) needs no kit change: it is one more
   option with no `media`, which the kit already draws as a plain labelled tile (the Camera chip's `none` default becomes the Auto card; Look's
   `natural` stays the default, shown as Auto, same value; the popover hints say "Pick one move, or Auto to fit your words.", no engine words). G3, G10.
5. **A recessed stage. (b) Impact medium.** `split_view` `main_surface: "stage"`: the main pane draws on a new kit token `--surface-stage`, defined in commons `tokens.css` beside `--surface-page` in the light root and in both dark blocks, one step darker than `--surface-page` in each, and added to `PAGE_SURFACES` in `text-opacity-contrast.test.ts` and to `contrast.test.ts`. The existing `--surface-pane` is not used: it is the kit's raised panel (lighter than the page in dark theme), the opposite of this look. The token is set through a kit data-slot value, never a `data-page-tone` attribute (`cinema-tone.test.ts`). In dark theme it reads near black, the cinematic frame; in light theme a soft grey. No fixed colour, no per-page dark page; the deprecated cinema tone is not revived. It reaches only pages whose root is `split_view`: Create. My clips (root `tabs`) is out of scope. G8.
6. **One View button for the filters. (b) Impact medium.** `result_feed` `filters_presentation: "popover"` (default `"inline"`): one View button
   (a filters icon on a phone) opens the same Favorites only, Group by words and Type controls in a popover, a sheet on a phone. The
   phone shows tiles and the first clip with one slim row above them, not three. G9.
7. **Copy and defaults. (a) Impact low to medium.** The Level `hint`s say what each is ("Fast, with sound" only while the engine in use has sound, as `videoCreateApp.ts` already decides; "Sharper picture"; Max shows its reason when it is greyed), the Start frame label says what it is for ("Optional. Begin from a picture."), the empty-state line reads "Your clips show here. Pick a tile or describe a video on the left and press Generate.", and Auto is the stated default. No resource words, no model names, no credits (Home has none; the time is the cost).
8. **Moving tiles. (b) Impact medium.** `media_shelf` `media_loop: true`: a muted loop of an mp4 address shown over the poster, paused when off screen and under reduced motion (which shows the poster). The shipped Look and Camera cards already loop; this extends the same behaviour to the rail.

What each change does to the first screen at 1440 by 900 (mockup `feed-1440-*` and `empty-1440-*`): the stage opens with a row of five poster
tiles, then a wide clip that shows picture first; the panel opens with a banner of the chosen look, a prompt you can see all of, three Level cards and
a Generate that says how long. Nothing is hidden that was visible before.

## 4. Rules check

| Rule | Result |
|---|---|
| Rule 9 and 9b, kit Elements as they ship | no className, no Home wrapper; items 2 to 6 are commons props or variants, each with its `UI-DECISIONS.md` row before the Element is written; items 1 and 7 are page JSON and package data |
| No fixed colours | every colour in the mockup is a stand-in for a token (`--background`, `--card`, `--muted`, `--border`, `--primary`, `--surface-stage`); the stage tint is a token; colour over a picture (tags, pills, scrim, overlay buttons) uses the kit's `--art-scrim`, `--art-overlay` and `--art-foreground` tokens; no literal colour is built. The mockup's `rgba(10,10,12,...)`, `#fff` and `#000` are stand-ins only |
| S1, S2 | one header row, one companion avatar, no second copy of a global control; Create stays the creation workspace the owner chose from references 7 to 11 (S2 copies the native app, and for Create that is the Dreamina and Higgsfield layout, VIDEO-UI-01 section 1) |
| S6 | a Try this tile only refills the panel; Generate and every starting action keep `disabledReason` and the `makingNotice`; one job's progress stays on its feed entry; no new status surface |
| Schema nodes only on package pages | `media_shelf`, `result_feed`, `prompt_bar`, `split_view`, `empty_state` |
| Minors | unchanged: both pages adult-only; the tiles are the package's own loops; no tile names a real person or a brand character |
| No resource words, no credits | Generate says time ("Standard, about a minute"); Level cards say what each is for |
| Third-party and privacy | nothing fetched from outside the home; posters and loops ship in the package |
| Mockup honesty | everything the mockup draws is today's control or a named addition: Shape and Length are today's dropdown chips, the order is today's, the Settings gear is back in the header row (S2), End frame is not drawn (VIDEO-UI-01 decision 5: absent until VIDEO-INPUTS-03 passes), the greyed Max card shows its reason |
| Reuse check | `VideoPlayer` (size, icons, notice), `DayDivider`, option cards, `media_shelf`, `CardSizeSlider` unchanged; considered and not used: a Home Explore page, a how-it-works video (the tiles are the demonstration), a new carousel node (`media_shelf` rail does it) |

## 5. Slices

| Id | Size | Slice | Done when |
|---|---|---|---|
| VIDEO-UI-10 | S | This note, mockup, architect ruling, backlog rows | architect APPROVED; screenshots judged |
| VIDEO-UI-11 | M, Home | Items 1 and 7: the `showcase` scope, the 13 posters, the `media_shelf` rail in `create.json`, the copy, Level hints and Auto cards | dev hub opened at 1440 and 390, light and dark, empty and with clips; a tile pressed refills prompt, Style and Camera and starts nothing; tests for the scope |
| VIDEO-UI-12 | M, commons | Item 3 (`aside_width`, `field_size`, reference `tile`, tier `cards`, `submit_detail.placement`) | commons tests and tsc; opened at 1440 and 390, light and dark; tag pushed |
| VIDEO-UI-13 | S, commons | Item 4 (`trigger: "banner"`, `popover_size`) and item 5 (`main_surface` on the new `--surface-stage` token with its contrast tests) | same; keyboard and focus on the popover; tag pushed |
| VIDEO-UI-14 | M, commons | Item 2 (`result_feed` `look: "media"`, `VideoPlayer` `caption`, `badges`, `chrome: "overlay"`, `actionsReveal: "hover"`), item 6 (`filters_presentation`) and item 8 (`media_shelf` `media_loop`) | same; every entry state opened in the media look; tag pushed |
| VIDEO-UI-15 | S, Home | pin the tags; switch `create.json` to the new props; reseed and capture; the Favorite, Stop and Make it Max actions and `poll_while` unchanged | dev hub opened at 1440 and 390, light and dark; a real run of one clip with the entry moving from queued to done in the media look |

Order: 11 first (Home only, the biggest change in feel for the least risk), 12, 13 and 14 as parallel commons worktrees, then 15.

## 6. Open points

None block 11. Owner decision only if he wants it: Max stays visible and greyed with its reason (VIDEO-UI-01 decision 3). The stage tint reaches Create only; My clips (root `tabs`) would need its own prop and slice, not proposed here.
