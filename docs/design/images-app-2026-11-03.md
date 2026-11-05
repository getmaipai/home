# Images: Browse and Create, templates, a Studio, chat tools and shared media operations (design draft, 2026-11-03)

Status (2026-11-03): proposed, no code. Item: IMG-APP-01. Needs an architect verdict before any IMG item is dispatched.
Owner ask (Jesse, 2026-11-03): "Make the image app similar to the music and videos app: have browse and create, have the create by template
like in the videos app, make it like the Higgsfield app, have studio for full suite of image editing, don't forget the chat tools and cards.
Ensure you don't hard code things so tools like video can call image features like background remove if appropriate."

Builds on: [video-create-one-page-2026-11-02.md](video-create-one-page-2026-11-02.md) (the two-pane workspace, kit gaps K1 to K12),
[video-studio-2026-11-02.md](video-studio-2026-11-02.md) (the Music Studio look as a kit token scope, the Studio page, the shared edit gate),
[video-loras-2026-11-02.md](video-loras-2026-11-02.md) (the Adult lock),
[music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md) (Browse and Create modes, chat parity),
[media-editors-2026-10-31.md](media-editors-2026-10-31.md) (Photo editor), [image-tools-2026-10-17.md](image-tools-2026-10-17.md),
[image-editing-2026-10-17.md](image-editing-2026-10-17.md), [image-generation-2026-10-17.md](image-generation-2026-10-17.md).
Rules: RULES.md rules 0, 1, 9, 9b, 10, 12, S1, S2, S6. The child cartoon lane is governed through the existing `lane.ts` gates. S7 (chat parity) is a proposal in the music note, followed here, not a RULES.md rule.

## 0. Answer in six lines

1. A new catalog app **Images** (`images`), same shape as Videos and Music: a **Browse** mode (Explore, Pictures) and a **Create** mode (Create, Studio).
2. **Create** is the Videos two-pane workspace (panel left, results feed right), built from the same kit parts. It starts from a **template**
   (a tested recipe with a sample picture, a prompt with named blanks, and the pictures it needs) or from plain words. Everything defaults to Auto.
3. **Studio** is the full editing suite inside the app (describe a change, erase, remove background, crop, adjust, upscale, resize, markup,
   compare, blur background, expand later). It replaces the separate `photo-editor` rail app of the editors note.
4. **Chat** gets a tool and a card for every Create and Studio action, and the card is the same kit Element as the page (S7).
5. **No hard-coded features.** Every picture action (and the video actions that matter to pictures) is one entry in a **media operations registry**.
   The Studio tool list, the chat tool, the card's action row and other apps all read the registry. Videos can call `picture.remove_background`
   on a start frame, and Images can call `video.animate`, with no line of Images code naming the other app.
6. It takes the Music Studio look the owner asked Videos to take (dark studio surface, lime pills, eyebrow headings) through the same kit scope, and
   the same Adult lock for adult-only pictures. Nothing new is needed from the engine. Build order: registry first (Home only), then templates, then
   the pages as the Videos kit tags land.

## 1. Supersedes and amends

Nothing approved is deleted; each line names the passage and what it says after this note.

- [media-editors-2026-10-31.md](media-editors-2026-10-31.md) section 4, "Entry points (1) Rail: a catalog app `photo-editor`": the Photo editor is the
  **Studio** page of Images. EDITOR-06 (a `photo-editor` app package) becomes IMG-STUDIO-02. EDITOR-07 and EDITOR-08 keep their meaning and open
  the Studio page. EDITOR-23 (a Create wrapper) is not needed. EDITOR-01 to 05 stand (they are the node, routes, crop, adjust and compare the Studio uses).
  Section 4's tools table stands; section 8 question 1 (one icon or two) is answered by this note: Images is one icon, Studio is a page in it.
- (2026-11-04) Section 7 row "Change in words": `generate_image` with `change` stays and gains `styles` and more references (7a); "any other edit"
  (`edit_picture`) also serves the Studio box through a forced tool call. Section 7 "spoken turns ... shared screen only" is unchanged. Person boxes
  return only as the Stack's `find_people` output chosen by the model; the 2026-10-26 word-rule resolvers are not revived. IMG-PEOPLE-UNSURE-01
  (its `choosePeople` no longer exists) and IMGEDIT-03 (the same phrases run live) fold into IMG-OPS-06 and IMG-CHAT-03.
- The per-operation code in `backend/src/lib/imageEdit.ts` (`EDIT_OPERATIONS`, `EditToolKey`, the branch per operation) becomes registrations in the
  registry (section 5). Rule 12: the chat editor and `/api/image-edit/*` keep working through the whole port; nothing is deleted until the registry serves them.
- `backend/packages/generate_image` stays the chat tool for making and changing a picture; it gains arguments (section 7). `show_images` is unchanged.
- [video-create-one-page-2026-11-02.md](video-create-one-page-2026-11-02.md) K10 says `result_feed` draws `VideoPlayer` "or the still card": this
  note fixes that to the shipped `image-generation`/`image` Elements for a picture row (section 4), no new Element.

- [video-studio-2026-11-02.md](video-studio-2026-11-02.md) section 4.1 sets Videos' group to `["create", "studio", "clips"]`; Images mirrors it
  (`create`, `studio`, with My pictures in Browse), and its "Open in Studio" feed-entry action is the same one this note gives pictures. Its
  `studio` token scope (K1), `creation_header` studio variant (K2) and eyebrow heading style (K5) are used here, not redefined.

## 2. What exists (read from code and the backlog, 2026-11-03)

| Part | Where | State |
|---|---|---|
| Make a picture, change a picture in words | `packages/generate_image`, `lib/pictures/{tool,editTool,jobs}.ts`, `routes/pictures.ts` | built, chat only |
| Edit tools (remove background, erase, upscale, resize, Comment, Markup) | `lib/imageEdit.ts`, `routes/imageEdit.ts`, kit `ImageEditor` | built, addressed by chat id, chat canvas pane only |
| Picture engine, Quick and Detailed, tiers, LoRA styles | Stack `image-gen`, `lib/pictures/quality.ts` | built |
| Child cartoon lane, teen floors, CSAM check | `lane.ts`, `laneGate.ts`, `ageCheck.ts`, `finishedCheck.ts` | built (rule 0, 8, 10) |
| An Images app, Create page, templates, library of pictures | none | **missing** |
| Other apps calling picture actions | each app has its own copy (companion Look tab has its own background removal; Videos has `edit_video`; Music cover art calls the picture tool) | no shared way |
| Two-pane Create kit parts (`prompt_bar` panel, `result_feed`, `split_view` side, `media_shelf` day groups) | commons, rows VIDEO-UI-02 to 05 | **not built yet**; Images reuses them, never copies them |

## 3. Leader benchmark (standing rule: review leaders, replicate what fits)

Source: `data-scratch/research/higgsfield-ui/REPORT.md` (Create Image, Cinema Studio, Marketing Studio, Assets, mobile) and the Dreamina notes behind
the Videos note. What we take, and what we leave:

| Seen | Adopted as |
|---|---|
| Create Image: one docked bar with prompt, aspect, quality, count, Generate; Square or Masonry, Split by date, card size slider | the Videos panel and feed (same kit); the feed's filter bar; My pictures gets the same View controls |
| Marketing Studio: a template grid with category pills over the composer, slots for the pictures a template needs | **Templates** (section 4): categories as pills, a gallery in Explore and a Template popover in the panel; required pictures are named slots |
| Cinema Studio: every control defaults to Auto, so a first run needs only a prompt | all Create controls default to Auto |
| Reference picker with sources as tabs (uploads, earlier pictures) | `prompt_bar.references` slots, picker tabs Uploaded and Made here |
| Edit tools as a plain list, one name plus one line | Studio tool rail (section 6) |
| Assets library: All, Favorites, Uploaded, date groups | Pictures page tabs (section 4) |
| Calm hover tile with only a "..." menu | `media_shelf` tile as shipped |
| Left out | credits and prices on buttons, dozens of model names, community feed, face swap and "viral" presets, skin retouching (teens), a sign-in wall, hype copy |

## 4. The app

**Manifest.** `backend/packages/images/`, `kind: "app"`, category Media, `min_role: "child"` (a child's pictures follow today's cartoon lane; adult-only
templates and tools are filtered per person, section 9). `contributes.header.modes`: `browse` (page `index`) and `create` (page `create`). Sidebar groups:
`browse` pages `["index", "pictures"]`, `create` pages `["create", "studio"]`. Search Images in the header row searches the person's pictures by words and tags (S2).

| Page | Mode | What it is |
|---|---|---|
| Explore (`index`) | Browse | Template shelves by category (kit `media_shelf`), "Make more like this" shelf from the person's recent pictures. A template tile opens Create with that template loaded. Empty state: one sentence and a Create button. |
| Pictures (`pictures`) | Browse | The library of the person's pictures: `tabs` All, Favorites, Made here, Uploaded, Edited; day groups; size slider; Select all with delete and share (the Videos My clips shape, K12). One store: the Library file (rule: one store, two views). |
| Create (`create`) | Create | Two panes. Left panel (kit `prompt_bar`, `placement: "panel"`): prompt, References slots, **Template** (popover of `cards` chips with sample pictures, categories as pills), Shape (square, portrait, landscape, wide, tall), Level (Standard, Boost, Max when held), How many (1 to 4), More settings (Style, Quick or Detailed words stay the Level), **Generate** pinned at the foot with the estimate under it. Right pane: `result_feed` rows of picture entries (the shipped `image-generation` card: queued, percent with the engine's preview, ready, failed, cancelled), words, tags (template, style, level), reference chips, an icon action row built from the registry (section 5), Favorite. Phone: bottom dock and Options sheet as in Videos. |
| Studio (`studio`) | Create | The editor suite (section 6). Opens empty ("Open a picture": Upload, Choose from Library) or on `?file=<id>` from a feed entry, the Library viewer, or chat. |

**Templates.** One record kind, defined once in `commons/spec` (`media_template`, additive; videos' recipes move to it later, one definition for both):
`id`, `kind` (`picture` now, `video` later), `title`, `summary`, `category`, `audience` (`all-ages` or `adult-only`, the strictest label wins; a child sees only `all-ages` templates with no `photo` slot and no reference input, which is what the cartoon lane in `lane.ts` accepts, so no extra field),
`prompt` (words with `{blanks}`), `blanks` (name, label, example), `inputs` (picture slots: label, required, `photo` or `any`), `shape`, `level_hint`,
`style` (a household style name, optional), `sample` (a picture of the package, made by our own engine and judged by a person before it ships), `order`.
Templates are package data (`images/templates/*.json`, validated by the spec schema in `check.sh`), loaded by one reader; a household may add its own
later (the same record, `source: "household"`). Launch set, about 16 in five categories: Portraits (storybook portrait, passport-style clean photo
background, pencil sketch), Products (on marble, on a wooden table, studio white), Art and styles (watercolour, paper cut, pixel art, comic panel),
Cards and posters (birthday card, travel poster, recipe card), Fun (sticker, pet in a costume, coloring page). No brand, no real person, no franchise
character in a name, a prompt or a sample (persona names from the org roster only). A template with a `photo` slot is offered only when
`photoUploadsAllowed` allows it (band, surface and the `chat.photo_uploads` setting). Rule 0 and the adult-content ruling (2026-10-26) allow no likeness or consent
check for adults, so none is added here; LIKENESS-01 is stale on this point. The gate runs in the function the button calls.

**Pressing a template.** It fills the panel: blanks become small named fields over the prompt, required slots show their label, Shape and
Level take the template's hint, everything else stays Auto. Generate works with only the blanks filled. "Clear template" returns to plain words.
Remix on a feed entry refills the panel the same way.

## 5. Media operations registry (the answer to "do not hard code")

The gap today: picture actions are an enum and a branch per action in `imageEdit.ts`; the Videos page has its actions hard-wired in `mediaApps.ts`
(`appId !== "videos"` in each route); the companion Look tab has its own background removal. A new action means editing four places, and another app
cannot reuse one.

**One registry, `backend/src/lib/mediaOps/`** (Home backend; the Stack is still called only from `lib/imageEdit.ts` and the other existing clients).
An operation is registered once with:

| Field | Meaning |
|---|---|
| `id` | `<noun>.<verb>`: `picture.remove_background`, `picture.erase`, `picture.upscale`, `picture.resize`, `picture.crop`, `picture.adjust`, `picture.blur_background`, `picture.change` (Comment), `picture.expand`, `picture.locate` (returns boxes, never listed in the Studio rail or the card row), `video.animate`, `video.frame_to_picture`, `video.trim`, `video.join` |
| `label`, `summary` | the plain name and one line (also the chat tool's text and the Studio rail's text; `describe` copy lint applies) |
| `input` / `output` | media kinds (`picture`, `video`, `audio`) and slots, so a caller can ask "what can I do to a picture" |
| `args` | a zod schema plus a small `controls` list (`mask`, `number`, `choice`, `words`) the Studio draws and the chat tool describes |
| `needs` | a capability id already in `spec/vocab/capabilities.json` (`image`, `video`) or none. The registry defines no readiness: it calls `editToolsStatus` in `lib/imageEdit.ts` for the Stack tools and the `roleHealth` `image` and `video` rows through `healthSnapshot` for the engines, and passes their one-line reason through (S6: one readiness function per concern, never recomputed) |
| `audience` | the least band that may run it, and that a result keeps the strictest label of its sources (BUG-LIBRARY-SHARE-CHILD-01 read gate) |
| `run(ctx, input)` | does the work through the existing function (for `picture.*`, `lib/imageEdit.ts`; for `video.*`, `lib/videos/*` and the shared edit gate VIDEO-STUDIO-07 moved out of `editTool.ts`, never a second copy of it), returns a new Library file or a job id the caller polls |

**Callers, all through the same three calls** (`listMediaOps(actor, {input})`, `runMediaOp(actor, id, input)`, `getMediaOpJob(actor, job)`):

1. **Studio** draws its tool rail from `listMediaOps(actor, {input: "picture"})`. A new operation appears in the Studio when it is registered; no page edit.
2. **Chat**: the `edit_picture` tool (section 7) builds its `op` choices at offer time from the registry (only ready ones, only for this person, at most
   the cap in rule 1), and the picture card's action row is the registry list for the picture's kind.
3. **Other apps**: server code calls `runMediaOp` (Videos cleans a Start frame with `picture.remove_background` or `picture.upscale`; Music cover art
   crops with `picture.crop`; the companion Look tab drops its private copy). Package pages call one generic action,
   `/api/plugins/{app}/actions/op`, with `{op, input}`. An app may call only ops its manifest lists in `permissions` as a parameterized `media_op:<id>` entry (a new entry of `spec/vocab/permissions.json` with its per-band policy cells, spec first; no new manifest field), and the call runs with the **person's**
   gates, not the app's, so a registered op never widens what a person may do.
4. **Images calls video** the same way: Studio "Animate this picture" is `video.animate`, "Save a frame as a picture" is `video.frame_to_picture`.

`/api/plugins/{app}/actions/op` and `/api/media-ops/{id}` mount one handler with one check; `/api/image-edit/*` calls that handler until it is retired (rule 12). The op descriptor (`id`, `label`, `summary`, `controls`, `enabled`, `reason`) is defined once in `commons/spec` because the kit `ImageEditor` also reads it (section 6).

Registration is the only place an operation is named. Tests: every registered op appears in the Studio list, the chat tool and the card row for
a person allowed it, and in none for a person who is not; a test fails if a page or tool names an op id that the registry does not hold.

## 6. Studio

Layout (S2): the tool rail left, picture centred and prompt bar under it are `ImageEditor`'s own layout; Home arranges no Elements in a grid. The kit `ImageEditor` keeps its own Versions menu (no second copy in the right pane). Before and after compare is the kit's. The tool rail is data-driven: IMG-STUDIO-01 adds an additive `operations: [{id, label, summary, controls, enabled, reason}]` prop and a generic `onRunOperation({id, args})` to `ImageEditor` and the `image_editor` node (default `tools` behaviour unchanged, UI-DECISIONS row first), so a registered op, Blur background included, appears with no kit change. Phone uses the `screen` variant, which is immersive: it keeps `onClose` and the shell's listening indicator stays visible (S1, S2).

| # | Tool (registry id) | Runs on | Build |
|---|---|---|---|
| 1 | Describe a change, whole picture or a painted area, optional second picture (`picture.change`) | picture engine (edit_masked) | IMGEDIT-04, IMGGEN-EDITOR-01 |
| 2 | Erase an object (`picture.erase`) | Stack image tools (LaMa) | exists |
| 3 | Remove background (`picture.remove_background`) | Stack image tools | exists |
| 4 | Crop, rotate, flip, aspect presets (`picture.crop`) | Home, `sharp` | EDITOR-03 |
| 5 | Light and colour: brightness, contrast, warmth, saturation, Auto (`picture.adjust`) | Home, `sharp` | EDITOR-04 |
| 6 | Upscale 2x or 4x, Resize (`picture.upscale`, `picture.resize`) | Stack image tools | exists |
| 7 | Blur background (`picture.blur_background`) | Home, cutout then `sharp` | LOKI-PORT-01 |
| 8 | Markup: pen, shapes, text (browser) | kit | exists |
| 9 | Compare before and after | kit | EDITOR-05 |
| 10 | Expand canvas (`picture.expand`) | `edit_masked` on a generated border mask | later |
| 11 | Animate this picture (`video.animate`) | video engine, adults | later, via the registry |
| 12 | Relight, change camera angle, layers | no tested local model | later, after a bench |
| 13 | Combine pictures ("put her in this room", "make these one group photo"): `picture.change` with up to the engine's reference count (`edit.references`, today 2, so 3 pictures with the one being changed) | picture engine (edit with references, built for one by IMGEDIT-01/02) | IMG-OPS-05 |

Everything else is as written in the editors note: versions are Library files, nothing is overwritten, Revert is "Use this version", a shared
picture is edited as a copy in the editor's own "Edited" folder, incognito edits stay in memory, and every generated result passes `checkImages`
then `gateFinished` before a preview shows. Crop, Adjust, Resize and Markup keep the strictest audience label of their source.

## 7. Chat: every Create and Studio action has a tool and a card (S7)

| Make or change | Chat tool (conditional picture set, rule 1) | Card | Same Element on the page |
|---|---|---|---|
| Make a picture | `generate_image` (built); gains `template` (an id from the person's short list), `references` (pictures in the conversation), `count` already exists | picture card (the shipped `image-generation` then `image`) | Create feed entry |
| Change in words | `generate_image` with `change` (built) | picture card | Studio, Describe a change |
| Any other edit | **`edit_picture`** (new): `{op, source, args}`; `op` choices are the registry's, built at offer time; the model decides (rule 1) | picture card, with the new version | Studio tool |
| Open for hands-on editing | none needed: the card's **Edit in Studio** action | card action | Studio |
| Make a video from it | the card's **Make a video** action calls `video.animate` (adults, video on) | video card | Create feed action |
| What can you make | `generate_image` with `list_templates: true` (an argument, so no tool is added to the cap; the model decides, rule 1) returns the template list as a `templates` answer block (a shelf of tiles, each sends "Make this one"; its block schema lands in `commons/spec` before IMG-CHAT-02) | answer block, drawn by `AnswerBlockView` | Explore shelf |

Rules, as in the music and video notes: a job that takes time uses a named tool-call card that polls the job; the card's action row is the
registry list, additive props on the shipped Element (a commons change with its `UI-DECISIONS.md` row first, rule 9b), never a Home `*Card`;
which tools a turn is offered follows the surface or an object in the conversation (the Images app, a picture), never a word rule; gates run
in the tool, not the card; a failed tool never fails the answer (rule 6); spoken turns read one line and show the card on the shared screen only.
`edit_picture` is a package (`backend/packages/edit_picture`, `offer: {mode: "conditional", gate, bench_row}`) like `edit_video`; the registry only fills its `op` choices, and it counts as one tool toward rule 1's cap of 16 (the cap counts tools, not choices). Template ids in `generate_image`'s description are listed from the reader for this person (audience filtered), at most 24.

## 7a. Three ways in, one path (owner, 2026-11-04)

"Remove the boy on the left", "make it sunny", "combine these two" and "turn it Ghibli" work the same in regular chat, the companion (typed or
spoken) and the Studio words box. One routing step, the model's own tool choice (rule 1, rule 2), and one set of operations behind it:

| Where | How the words reach the registry |
|---|---|
| Regular chat or companion chat | the turn offers `generate_image` and `edit_picture` when a picture is in the conversation; the model's choice inside `edit_picture` goes straight to `runMediaOp`. There is no second routing module. Spoken turns read one line; the card shows on the shared screen only (rule 0, section 7), nothing about a spoken turn's shape changes |
| Studio words box | one engine-native tool call (rule 2) using the same `edit_picture` schema with that tool forced and the open picture, painted area and chosen pictures as its context; the call goes straight to `runMediaOp`. Words with a painted area are `picture.change` |

- **Combine** is `picture.change` with more reference pictures (a widened references argument, capped by `edit.references`; the Stack's
  `IMAGE_REFERENCES_MAX` is 2). No separate op. A child gets no reference pictures (cartoon lane). Every picture passes `prepareEditSource`.
- **Style by words** ("turn it Ghibli"). `picture.change` takes `styles`, up to two saved style names the person said. Videos resolves names with
  `resolveStyles` over the `Lora` records; pictures still read the Stack list and `picture_adapter_prefs` (`adapters.ts`). They become one lookup when
  VIDEO-LORA-12 moves pictures onto the `Lora` record, and a locked picture style exists after ADULT-LOCK-07 (organisation principle 4). Until then `styles` uses the
  lookup `generate_image` already uses for pictures and moves with VIDEO-LORA-12; this note builds no third lookup. An unknown or unusable name stops
  the edit with the tool's failure kind and the model says it in its own words. Never an invented name.
- **A subject named in words** ("the dog on the left", "the boy on the left"). `picture.locate` is an `edit_picture` op choice (no new tool, cap of 16 unchanged; it returns boxes, not a file or a job, so it is never listed as a Studio tool or a card action). It calls
  the Stack's `find_subjects` operation, which returns numbered boxes as fractions of the picture with detector `kind` and `label`, and hands the boxes to the model, which picks the number (no
  regex or word list; the 2026-10-26 `choosePeople` and `resolvePosition` word rules are gone and stay gone). One chosen box is the area for `picture.erase` (remove) or
  `picture.change` (replace). On older Stacks, Home falls back to `find_people` and preserves `people` for old callers. Every age may locate and erase people, animals and objects (owner ruling 2026-11-04: finding and erasing make no content). Readiness comes from
  `editToolsStatus` and `roleHealth`; when the reader is not ready the model uses `picture.change` with the words and says so. `locate` logs counts only (rule 6a).
- **In the Studio box** a found person is handled inside the one forced call: the tool's `locate` step returns the boxes to the model within the same call and the model then names the box for `erase` or `change`; one call from the person's side, two steps inside it.
- **Several people or none.** In chat and companion turns the tool returns the count and the positions as a kind of result and the model asks which
  one in its own words; no stored line (rule 6). In the Studio box a short hint under the box is that control's own copy (S6).
- The result is always a new version and a picture card with Edit in Studio; the original stays. Gates are those of section 9, in the functions, not the entry point.
- Bench rows: remove-by-position (three people), make-sunny, combine-two, Ghibli restyle, ambiguous-person question.

## 8. Reuse check (org principle 6, rule 9b)

| Need | Reused | New |
|---|---|---|
| Two-pane Create, panel, feed, day groups, size slider | VIDEO-UI-02 to 05 (`prompt_bar` panel, `result_feed`, `split_view` side, `media_shelf` additions) | `result_feed` picture rows draw the shipped `image-generation`/`image` Elements (a tiny commons addition to VIDEO-UI-04, in its row) |
| Template choice with sample pictures | `prompt_bar` `cards` chip variant and popover group (U1, K3a) | `prompt_bar` `blanks` prop (name, label, example) in IMG-UI-00, UI-DECISIONS row first |
| Template gallery | `media_shelf` shelves, `category_tiles` pills | none |
| Studio canvas and tools | kit `ImageEditor` | crop, adjust, compare, Comment brush (EDITOR-03, 04, 05, IMGEDIT-04); `image_editor` schema node (EDITOR-01) |
| Picture card actions | the shipped Elements and the video card's `actions` pattern (K1) | additive `actions` from the registry |
| Operations | `lib/imageEdit.ts`, `lib/videos/*` | the registry (Home code, no kit) |
| Template record | settings/records pattern, spec first | `media_template` (additive) |
| Words choose the operation (chat, companion, Studio box) | the turn's own tool call to `edit_picture`; the Studio box uses the same schema with the tool forced (rule 2) | none (no `routeMediaOp`) |
| Find a named person | Stack `find_people` boxes, the model picks | `picture.locate` op choice |
| Style by name | one lookup shared with Videos (`styleChoice.ts`, `adapters.ts` merged) | none new |
| Status, queue, errors | S6 rows, `useMakingAvailability`, job cards | none |

Considered and not used: a new manifest field `uses_ops` (the `permissions` vocabulary already does this); a second route family beside the media-app action host (one handler is mounted at both paths); a Home `*Panel`, `*Feed` or `*Card` (rules 9, 9b); a second editor library (the editors note rules out filerobot); a template
marketplace or community feed (not designed).

## 8a. The studio look and the Adult lock (shared with Videos, not redefined)

- **Look.** Create and Studio draw on the `studio` surface of VIDEO-STUDIO-02 (`page.surface: "studio"`, dark near-black pane, lime primary, light value
  for light mode), with the `creation_header` studio variant (eyebrow IMAGES or STUDIO, a large title, one primary lime pill per surface) from
  VIDEO-STUDIO-03. Images writes no colour, no class and no box (rules 9, 9b). Browse pages follow the person's theme like the other Browse pages.
- **Adult lock.** A picture made with an adult-only style or marked adult-only follows [video-loras](video-loras-2026-11-02.md) section 3; ADULT-LOCK-07 (pictures and songs adopt the lock) owns the picture work and IMG-UI-01 and IMG-STUDIO-02 depend on it: it is one lock tile in a feed, a shelf, a search result or a notification until the person unlocks; the Studio page is a page
  with its own unlock and discards unsaved edits on relock; an edit of a locked source is adult-only from the job start (the registry reads
  `fileAudience`, section 5). IMG-UI-01 and IMG-STUDIO-02 are not done until the same tests (lock tests 1, 2,
  6, 10) pass for a locked picture. Until ADULT-LOCK-07 lands Create and Studio refuse an adult-only picture with the same one line Videos uses.

## 9. Safety and privacy

Unchanged and enforced in the functions the buttons and tools call, never in a page: adults get every tool and every template, withheld only by the
CSAM check (rule 10); a teen keeps the teen prompt floor and the finished-picture check; a child opens Create only on the cartoon lane (`lane.ts`: no
photo, no mask, no reference, no level choice) and sees only `all-ages` templates with no photo slot and no reference input; guests, shared screens, robots and spoken turns
get no editor. An uploaded photo used as a source or reference passes `prepareEditSource`; a registered op never skips that. A result keeps the
strictest audience label of its sources. Nothing is fetched at run time: template samples are package files, the engines are local, zero new
outbound connections (asserted in the registry test by running every op against a network-denied fixture). Copy never shows model, memory or
pack words; failures say what to do.

## 10. Slices, in build order

| Id | Size | Slice | Done when |
|---|---|---|---|
| IMG-APP-01 | S | this note, architect verdict, backlog rows, design INDEX row | architect APPROVED |
| IMG-OPS-01 | M, Home backend | `lib/mediaOps/` registry; port `remove_background`, `erase`, `upscale`, `resize`, `change` from `imageEdit.ts` as registrations; the existing routes and chat editor call the registry | all existing image-edit tests pass unchanged; registry tests (listing by person, gates, network-denied run) |
| IMG-OPS-02 | S, spec then Home | the `media_op:<id>` permission entry in `commons/spec` first; generic routes (`GET /api/media-ops`, `POST /api/media-ops/{id}`, job poll) addressed by Library file id (folds EDITOR-02); the generic page action (one handler at both paths) | tests for owner, shared, child, teen, guest |
| IMG-OPS-03 | S, Home | `picture.crop`, `picture.adjust`, `picture.blur_background` on `sharp` (folds EDITOR-04, LOKI-PORT-01) | fixture tests: exact crop size, histogram move |
| IMG-OPS-04 | S, Home | `video.animate`, `video.frame_to_picture` registered from `lib/videos`; Videos Start frame offers Remove background and Upscale from the registry | a clip started from a cleaned photo, run for real |
| IMG-TPL-01 | M, spec then Home | `media_template` spec record; the reader; 16 launch templates and their samples made by our engine, each opened and judged | check.sh validates every template; samples opened |
| IMG-CHAT-01 | M, Home | `edit_picture` from the registry; `generate_image` `template` and `references`; bench rows for the conditional set | bench passes; each action run once in chat |
| IMG-OPS-05 | S, Home | `picture.change` takes up to `edit.references` pictures and `styles`; needs VIDEO-LORA-12 for the shared lookup | a real combine and a real Ghibli restyle |
| IMG-OPS-06 | S, Home | `picture.locate` from `find_people`, the model picks the box | one, several, none, reader down; a real "remove the boy on the left" |
| IMG-CHAT-03 | M, Home | every registry op by words in chat, the companion and the Studio box; folds IMGEDIT-03 | each phrase once in chat and as a companion turn; bench |
| IMG-UI-00 | S, commons | `prompt_bar` `blanks` prop (name, label, example); picture rows in `result_feed`; picture card `actions` from a list; UI-DECISIONS rows; tag | tests, opened at 1440 and 390 |
| IMG-UI-01 | M, Home | `packages/images` manifest, `index`, `pictures`, `create` pages and scopes; the Template popover; pin the VIDEO-UI tags (needs VIDEO-UI-02 to 05 and IMG-UI-00) | dev hub opened at 1440 and 390 with a real picture from a template; every entry state seen once; controls disabled with the one line while the picture engine is not ready |
| IMG-STUDIO-01 | M, commons | The data-driven `operations` prop and `onRunOperation`; Crop, Adjust, Compare, Comment brush in `ImageEditor`; `image_editor` node (EDITOR-01, 03, 05, IMGEDIT-04) | commons tests; opened at both widths; tag |
| IMG-STUDIO-02 | M, Home | the `studio` page from the registry tool list; Library viewer Edit and chat "Open in Studio" (EDITOR-07, 08, 06 retargeted) | each tool run once on desktop and phone with a real picture |
| IMG-CHAT-02 | S, Home | the picture card's action row from the registry; `templates` answer block returned by `generate_image` `list_templates`, with its bench row | each action pressed once |
| IMG-LATER | | Expand canvas, household templates, relight and angle after a bench | |

Order: IMG-OPS-01 first (Home only, unblocks everything and is the part Jesse's "no hard-coding" ask needs), then 02, 03, TPL-01, CHAT-01 in
parallel worktrees (separate files), then the kit-dependent UI once the Videos tags exist.

## 11. Open points

None block IMG-OPS-01. For Jesse when IMG-UI-01 lands: the launch template list and their sample pictures (taste); whether a child sees Create's
template gallery at all or only chat (`lane.ts` already limits the lane; recommended: yes, cartoon templates only).
