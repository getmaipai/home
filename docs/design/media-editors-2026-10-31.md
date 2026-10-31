# Photo editor and Video editor apps

Status: proposed 2026-10-31, design only, nothing built. Needs an architect verdict before any EDITOR item is dispatched.
Source: Jesse, 2026-10-31: turn the chat picture editor into an app pinned to the left, open any picture from an upload or the
Library, more room and more tools; the same for video; look at Higgsfield's photo and video editors.
Builds on: [image-tools-2026-10-17.md](image-tools-2026-10-17.md), [image-editing-2026-10-17.md](image-editing-2026-10-17.md),
[video-generation-2026-10-17.md](video-generation-2026-10-17.md). Rules: RULES.md rule 0, rule 9, rule 9b, rule 10, S1, S2, S6.
Architect, first ruling 2026-10-31: REJECTED on process only (design fits rules 0, 1, 9, 12, S1, S2, S6); this revision adds
Supersedes, the reuse check, the Stack ffmpeg reuse and the audience labels it asked for.

## Supersedes

When this note is approved, these stop being the design (the chat editor itself stays, rule 12):

- `docs/BACKLOG.md` LIBRARY-REVAMP-12: the clause "Open in the picture editor links into the chat that made it (hidden when
  the chat is gone)" and the acceptance "no Edit for an item whose chat is gone". The shipped backend half (`chat_id`,
  `can_edit` on the file record) stays; `can_edit` comes to mean "may open this in the Photo editor" (EDITOR-07).
- The Library viewer's "Edit in its chat" button and its "Its chat was deleted, so it cannot be edited here" line
  (`frontend/src/shell/library/LibraryViewer.tsx`), replaced by "Edit" (EDITOR-07).
- [image-tools-2026-10-17.md](image-tools-2026-10-17.md) line 3 and the routes paragraph near line 69, and
  [image-editing-2026-10-17.md](image-editing-2026-10-17.md) section 1 and the versions line near line 91, only where they
  address a picture by its chat (`conversation_id`, "a new attachment of the same chat and turn"). A picture is addressed by its
  Library file id as well; versions become Library files. Everything else in both notes stands.

## 1. Verdict

Yes, both should be apps, and the Photo editor first. The editing engine already exists and is good (IMGTOOLS-03..05,
IMGEDIT-01..06): what holds it back is where it lives. Today it is addressed by a chat id, so a picture uploaded to the Library,
or one whose chat was deleted, cannot be edited at all (the Library viewer says "Its chat was deleted, so it cannot be edited
here"), and the editor shares a narrow canvas pane with chat. An app fixes both with one backend change (address a picture by its
Library file id) and no new engine. The Video editor is worth an app too, but a smaller one: the Stack has no video editing
model, so v1 is an assembly editor (trim, join, continue a clip from its last frame, save a frame as a picture) over the
engines we already run; generative video edits wait for a tested model. "Docked to the left" means pinned in the rail like
Media, never a second column (S1 forbids app content in the rail; S2 gives the right side only to the one pane). Other apps:
Music is the only other candidate, and it is already the backlog row MUSIC-STUDIO-01 (later, design note first). Documents do not
need it: the chat canvas is already the document editor and a docs app would be a separate product.

## 2. What exists today (measured from the code, 2026-10-31)

| Part | Where | What it does |
|---|---|---|
| Kit `ImageEditor` Element | `commons/ui/src/elements/image-editor.tsx` (1317 lines), `variant: "pane" \| "screen"` | Stage over a checkerboard; tools Markup (pen, highlighter, shapes, text, undo/redo of strokes), Comment, Remove BG, Erase (painted mask), Resize/Upscale; every result is a preview to Apply (new version) or Discard; version list; download, share. All I/O through props. |
| Home hook | `frontend/src/apps/chat/useImageEditor.ts` | Opens from the Edit button on a chat picture (`ImageEditContext`); only chat attachments and saved versions qualify, web pictures never. Opens in the chat canvas pane, full screen on a phone. |
| Routes | `backend/src/routes/imageEdit.ts`, `/api/image-edit/*` | `status`, `pictures/{id}/versions`, `pictures/{id}/edit`, `jobs/{job}` (poll, cancel), `previews/{token}` (+ `/apply`), markup save, `pictures/{id}/comment` (prompt, region, mask, reference picture). Every call needs `conversation_id`. |
| Server half | `backend/src/lib/imageEdit.ts` | Stack image tools (`POST /v1/images/edits`: remove_background, erase (LaMa), upscale 2x/4x, resize) answer within 2.5 s or become a polled job; Comment runs the picture engine's generative edit (Klein 4B, masked or whole). Previews live 10 minutes in memory. |
| Versions | `saveVersion` | A result is a new attachment of the same chat and turn; the File note holds provenance: op, label, source id and sha256, root, engine, model, ms, size, audience. EXIF dropped. Temporary chats keep versions in memory. |
| Safety | `imageEdit.ts`, `pictures/policy.ts`, `ageCheck.ts`, `laneGate.ts` | Photo gate `photoUploadsAllowed`; a child edits only cartoons the engine made for them, with no mask and no reference; teen and child prompt floors; every Comment result passes `checkImages` and `gateFinished` (CSAM check for adults, the age floor for minors). |
| Chat words | `pictures/editTool.ts` | `generate_image` with `change` edits a picture in chat; the model decides (rule 1). |
| Video | `backend/src/lib/videos/*` | Text to video and picture to video ("Animate"), Quick (5 s silent) and Detailed (up to 10 s with sound); Make another; a texting copy. Adults on their own screen only; never a child or teen (policy.ts). No trim, join, extend or video edit route exists in the Stack. |

Limits today: chat-bound addressing; no crop, rotate, straighten, light and colour adjust, or expand canvas; Comment has no
brush or reference control in the kit yet (IMGEDIT-04); no before and after view; no video editing of any kind.

## 3. Higgsfield, what to copy and what not (summary of their product pages and reviews, 2026-10-31)

Their photo editor is a canvas with a short list of named tools (remove background, expand and crop, upscale, colour, relight,
retouch, change text, camera angle, split into layers) plus one prompt bar for anything else, and paint-an-area-then-describe
for local changes. Their video side is draw-to-edit on a clip, swap one object, relight with presets, reframe to 9:16 / 1:1 /
16:9, upscale, extend a clip forward or back, and a timeline for assembling clips.

Copy: one prompt bar under the canvas that works on the whole picture or a painted area; a short tool list with plain names;
preset chips (aspect ratios, a few looks) instead of sliders where possible; extend and reframe as one-press tools; results
land in your own library. Do not copy: credits and per-run cost, cloud models and uploads, face swap and celebrity or
"viral" presets, skin retouching (a likeness and body-image risk for teens), and a dense pro timeline. Their editor is for
creators; ours is for a family, so fewer tools, each one obvious.

## 4. Photo editor

**Who.** Same gates as the chat editor, unchanged (rule 0). Adult: every tool; outputs withheld only by the CSAM check
(rule 10). Teen: every tool on pictures they may open, teen prompt floor on Comment and the finished-picture check.
Child: opens only cartoons the engine made for them while the child lane is on; no photos, no mask, no reference (today's
`childOwnCartoonsOnly`); a child whose lane is off sees the app's one muted line from `PICTURES_OFF_REASON`. Guest, a shared
screen (TV), a robot and a spoken turn: no editor. Incognito: edits stay in memory under the temporary chat rules; Save
becomes Download.

**Entry points.** (1) Rail: a catalog app `photo-editor`, pinnable, with an empty state "Open a picture" offering Upload and
Choose from Library. (2) Library viewer: "Edit" on any image the person may read, replacing "Edit in its chat".
(3) Chat: the quick editor stays in the canvas pane (same Element, port before delete, rule 12) and gains "Open in Photo
editor". (4) Video editor: "Save frame as picture" then "Edit picture".

**Layout.** S2: the app copies a native photo editor (Photos and Higgsfield): picture centred and large, tools on one side,
prompt bar at the bottom, versions as a strip. The right side stays the shell's one pane; versions and details are a tab there.

```
Desktop (>= 640)                                  Phone (< 640, ImageEditor variant="screen")
+--+-----------------------------------------+   +---------------------------+
|R | Photo editor   [Open] [Save] [...]  (o) |   | (x) Beach-1.png    [Save] |
|a +------+--------------------------+-------+   |                           |
|i | Tools|                          | pane: |   |        picture            |
|l | Crop |        picture           | Vers- |   |                           |
|  | Adjust      (before | after)    | ions, |   | [Describe a change...  >] |
|  | Erase|                          | Info  |   | Crop Adjust Erase BG More |
|  | BG   |                          |       |   +---------------------------+
|  | ...  | [Describe a change...  >]|       |
+--+------+--------------------------+-------+
```

**Tools, in priority order.**

| # | Tool | Runs on | v1? |
|---|---|---|---|
| 1 | Describe a change (whole picture, or a painted area; optional second picture) | Comment route, picture engine (Klein) | v1, needs IMGEDIT-04 kit brush and reference |
| 2 | Erase an object (paint it) | Stack image tools, LaMa; Klein fill on pictures made here | v1, exists |
| 3 | Remove background | Stack image tools | v1, exists |
| 4 | Crop, rotate, flip, aspect presets (1:1, 4:3, 16:9, 9:16) | Home, `sharp`, no model | v1, new |
| 5 | Light and colour: brightness, contrast, warmth, saturation, Auto | Home, `sharp`, no model | v1, new |
| 6 | Upscale 2x / 4x, Resize | Stack image tools | v1, exists |
| 7 | Markup (pen, shapes, text) | browser, kit | v1, exists |
| 8 | Before and after compare | kit | v1, kit gap |
| 9 | Expand canvas (pad, then masked fill of the border) | Comment with a generated border mask | later |
| 10 | Animate this picture | Video engine, adults only | later (opens Video editor) |
| 11 | Relight, change camera angle, layers | no tested local model | later, after a bench |

**How edits run.** Only existing engines, only through `lib/imageEdit.ts` (the Stack is called only from there); no new
outbound connection. Queue: Stack jobs as today, with "Waiting your turn (n)" from the job position and the chat > pictures >
video priority. Status (S6): the edit's own progress lives in the editor's pending card (row "One job's progress"); when the
picture engine is not ready, the tools that need it are disabled with the existing one line from `useMakingAvailability`
(row "Pictures and video are not ready"); Crop, Adjust and Markup stay usable because they need no engine. Failures use the
kit destructive Alert with `failureCopy` text.

**Where results go.** A new route family addressed by Library file id, additive beside the chat one:
`/api/image-edit/files/{id}/{versions,edit,comment,adjust}`. Read through `canAccessFile`. Applying a result writes a new
File owned by the editing person, in the same folder as the source when they own it, otherwise in their own "Edited" folder
(an edit of a picture shared with you never changes the sharer's file). Provenance is the existing File note
(`v: 1`, op, source, source_sha256, root, engine, model, ms, audience), so the shape is unchanged. The Library shows the newest
version as the tile and the version list in its info panel, the way songs already show versions.

**Undo and history.** Two levels, both shipped in the kit: stroke undo and redo while painting, and versions. Nothing is
overwritten: every Apply is a new version, Revert is "Use this version" on an earlier one, which saves it again as newest.

**Safety.** Unchanged and in one place: every generated result passes `checkImages` then `gateFinished` before a preview is
shown; a Comment on an adult's picture is withheld only for CSAM (rule 10), a check that cannot run on a CSAM candidate fails
closed; a teen and child keep their floors; an uploaded photo used as a source or reference goes through `prepareEditSource`
(CSAM and age input screen) exactly as in chat. Crop, Adjust, Resize and Markup create no new content, but their outputs
(Markup included) keep the strictest audience label of their sources, recorded in provenance, so an adult-only source never
yields a file a teen or child can read (the read gate of BUG-LIBRARY-SHARE-CHILD-01, which treats a file with no recorded
class as adult-only for minors).

## 5. Video editor

**Who.** Adults on their own screen only, while the household has video on. Never a child or teen, never a guest, TV, robot
or spoken turn (`videos/policy.ts`; rule 0). For a minor the app is not listed (`min_role: "adult"`) and every route refuses.

**Entry points.** Rail app `video-editor` (pinnable); Library viewer "Edit" on a video; the chat video card's "Open in Video
editor"; Photo editor "Animate this picture" (later).

**Layout.** Native look: a player on top, a clip strip below, a prompt bar for the generating tools. Phone: player full width,
strip scrolls sideways, tools in a bottom row.

```
+--+------------------------------------------------+
|R | Video editor  [Add clip] [Export]          (o) |
|a +------------------------------------------------+
|i |               player (kit VideoPlayer)         |
|l |                                                |
|  | [ clip 1 |===| clip 2 |== | + Continue ]      |   <- clip strip, trim handles
|  | Trim  Split  Continue  Frame->picture  Sound   |
|  | [Describe the next shot...                  >] |
+--+------------------------------------------------+
```

**Tools.**

| # | Tool | Runs on | v1? |
|---|---|---|---|
| 1 | Trim a clip (in and out points) | Stack `media.edit` job (bundled ffmpeg) | v1 |
| 2 | Join clips in order, reorder | `media.edit` concat | v1 |
| 3 | Continue: a new clip from the last frame, with words | existing picture to video ("Animate"), Quick or Detailed | v1 |
| 4 | Save a frame as a picture (then open in Photo editor) | `media.edit` frame grab | v1 |
| 5 | Make another of a clip | existing rerun | v1, exists |
| 6 | Mute, or keep sound | `media.edit` | v1 |
| 7 | Reframe to 9:16, 1:1, 16:9 (crop) | `media.edit` | later |
| 8 | Add a song from the Library as the sound | `media.edit` | later |
| 9 | Draw-to-edit, object swap, relight, upscale video | no tested local model | later, after a bench |

**How edits run, results, history.** No second ffmpeg pipeline. Trim, concat, frame and mute extend the Stack's media job
kinds (MEDIA-STACK-01, `stack/backend/src/media/jobs.ts`, the same lane and helpers as `media.companion_clip` from
CMEDIA-STACK-01 and `media.transcode`): one new kind `media.edit` with an `ops` list, reusing `toolPaths` for the bundled
ffmpeg, the path guards (`resolveReadable`, `resolveWritableDir`, `safeName`), the deadline table and `POST /stack/v1/jobs`.
The music worker (MUSIC-GEN-02) does not fit: its trim, fade and loudness are steps inside the Python music job, on audio
only, in the music environment. Home submits through its existing Stack jobs client; the job shows on the editor's own job
card (S6). The media lane runs one job at a time at idle priority, so an edit can wait behind a long transcode: EDITOR-11
measures that and, if it is over a few seconds, gives `media.edit` its own short-deadline lane. Continue uses the
existing video job and its card. The clip strip is the editor's working state in the browser; Export writes one new Library
file with provenance in the File note (op, source ids and sha256, engine, model). No project record in v1 (a saved project
would be a new spec record: spec first, later). Undo: the strip has undo and redo; files are never overwritten.

**Safety.** Every generated clip (Continue, Make another) passes the existing finished-clip check. Every export (trim,
mute, any join, including a join with an uploaded clip) and every "Save a frame as a picture" keeps the strictest audience
label of its sources in provenance (BUG-LIBRARY-SHARE-CHILD-01 read gate). An uploaded video used as a source has its
keyframes screened like an uploaded photo (`screenInputImage`) before any job; a check that cannot run fails closed.

## 6. Kit pieces and gaps

| Part | Covered by (shipped) | Gap |
|---|---|---|
| Picture stage, tools, Markup, Erase brush, versions, preview Apply/Discard, phone `screen` variant | `ImageEditor` Element | needs Crop/rotate, Adjust and Compare tools: additive tool keys and props in commons first (rule 9b, second step) |
| Comment brush and second picture | `ImageEditor` | IMGEDIT-04, commons |
| Prompt bar | kit `Textarea` + `Button` inside `ImageEditor`; video uses the same part | none |
| Empty state, Upload, Choose from Library | `EmptyState`, Library upload (`LibraryUploads`), `FileGrid` in a `Dialog` | none |
| Versions and details tab | the shell's one right pane, `DetailPane` | none |
| Player | `VideoPlayer` Element, `Player` | none |
| Clip strip with trim handles | none (reuse check below) | new kit Element `ClipTimeline` composed of shipped primitives, no hand-drawn canvas; ledger row below |
| Job progress, not-ready line, errors | `Progress`, `Alert`, `useMakingAvailability` | none |
| Page in a catalog app | spec UI schema | new node types `image_editor` and `clip_editor` in `commons/spec/ui/schema.json` (spec first); Go renders them last |

**Reuse check (org principle 6, rule 9b), npm registry and project pages read 2026-10-31.**

| Need | Checked | Adopt | Why not the others |
|---|---|---|---|
| Crop, aspect presets | shadcn registry (no crop part); Kibo UI Image Crop (registry install, wraps react-image-crop 11.1.2, ISC, updated 2026-06); react-easy-crop 6.2.4 (MIT, updated 2026-10); react-filerobot-image-editor 5.0.0-beta (MIT) | Kibo UI Image Crop into commons, used by `ImageEditor`'s Crop tool | react-easy-crop is not in a registry, so it would be a new direct library for the same job; filerobot is a whole second editor with its own UI kit (`@scaleflex/ui`, styled-components, konva), still in beta, and would duplicate `ImageEditor` (principle 1) |
| Rotate 90, flip | same | none: two `Button`s in the Crop tool; `sharp` applies them server side | no part is needed for a button that sends an op |
| Before and after | shadcn (none); Kibo UI Comparison (registry, drag and hover modes); react-compare-slider 4.0.0 (MIT, v4 new in 2026-03) | Kibo UI Comparison | react-compare-slider is a direct library where a registry part exists; Kibo's page names no keyboard support, so EDITOR-05 tests arrow keys and adds them as a kit prop if missing |
| Clip strip | shadcn (Slider with two thumbs, no clip strip); Kibo UI (Video Player, Gantt for scheduling, no clip trimmer); @xzdarcy/react-timeline-editor 1.0.0 (MIT, updated 2026-01) | none; compose shipped primitives | react-timeline-editor is a multi-track pro editor with its own stylesheet, interactjs and react-virtualized: its look cannot be reached by tokens without overriding its CSS (rule 9b), and a family trim strip needs one track; Gantt is a schedule, not a media strip |

UI-DECISIONS.md row text for the one composed part:
`| ClipTimeline (Video editor clip strip) | proposed, EDITOR-12, owner sign-off pending | shadcn has a two-thumb Slider but no clip strip; Kibo UI has Video Player and Gantt but no trimmer; @xzdarcy/react-timeline-editor brings its own CSS and a multi-track model that tokens cannot restyle. ClipTimeline composes shipped kit parts only (Slider range per clip, Card, Button, SafeImage thumbnails), draws no border, radius, shadow or background of its own, and reorders with Move buttons instead of a drag library. | shadcn registry (Slider, Card, Button) | kit pin at EDITOR-12 |`

## 7. Plan

Phase 1, Photo editor app (no new engine):

- EDITOR-01 (S, spec): `image_editor` node in the UI schema, bound to a file id; fixtures and validator test.
- EDITOR-02 (M, Home): `/api/image-edit/files/{id}/*` routes reusing `lib/imageEdit.ts`, read by `canAccessFile`, save as a
  new File owned by the editor; tests for owner, shared, child cartoon-only, teen, guest refusal.
- EDITOR-03 (S, commons): add Kibo UI Image Crop (UI-DECISIONS row), then `ImageEditor` Crop/rotate/flip and aspect presets. Test: a 4:3 crop of a
  fixture returns exact pixel size.
- EDITOR-04 (S, Home): `adjust` op in `sharp` (brightness, contrast, warmth, saturation, Auto); keeps source audience. Test with
  a fixture histogram.
- EDITOR-05 (S, commons): add Kibo UI Comparison (UI-DECISIONS row); Compare in `ImageEditor`; arrow keys tested.
- EDITOR-06 (M, catalog + Home): `photo-editor` app package (empty state, Upload, Choose from Library) rendering the node;
  previewed at 1440 and 390 with the seeded household.
- EDITOR-07 (S, Home): Library viewer "Edit" replaces "Edit in its chat"; versions in the info panel.
- EDITOR-08 (S, Home): chat canvas editor gains "Open in Photo editor".
- IMGEDIT-04 (existing row): brush and reference in Comment; becomes part of Phase 1.

Phase 2, Video editor v1 (starts once the Photo editor app is live, so real use shapes it):

- EDITOR-11 (M, Stack): `media.edit` job kind beside `media.companion_clip` (trim, concat, frame, mute), reusing `toolPaths`
  and the path guards; tests with a 3 s fixture; measures the wait behind a transcode on the media lane.
- EDITOR-12 (M, commons): `ClipTimeline` composed from shadcn `Slider` (range), `Card`, `Button`, `SafeImage`; trim, reorder
  by Move buttons, undo; the UI-DECISIONS row of section 6.
- EDITOR-13 (S, spec): `clip_editor` node.
- EDITOR-14 (M, Home): `/api/video-edit/*` routes, adults only, export as a Library file with provenance, input keyframe screen.
- EDITOR-15 (S, Home): Continue from last frame through the existing video job.
- EDITOR-16 (M, catalog + Home): `video-editor` app package, `min_role: "adult"`; preview at both widths.

Later: EDITOR-21 expand canvas; EDITOR-22 reframe and add a song; EDITOR-23 a "Create" wrapper if Jesse wants one icon;
EDITOR-24 bench a local video edit and relight model. Music is not an EDITOR item: it is the existing MUSIC-STUDIO-01.

## 8. Questions for Jesse

1. One rail icon or two? Recommended: two pinnable apps (Photo editor, Video editor), each unpinned by default except Photo
   editor for adults and teens. A "Create" wrapper like Media is EDITOR-23 if the rail gets crowded.
2. Rule 9b (the architect's flag): it lists `src/ui`, `src/blocks` and `src/dashboard` as the parts for non-chat screens, while
   `ImageEditor` and `VideoPlayer` live in `src/elements`. Home already uses `src/elements` on non-chat pages (LibraryViewer,
   StatusPage, CompanionsPage) and rule 9 governs every kit Element. Recommended: read 9b as allowing kit Elements outside
   chat, and add that sentence to 9b with your `Owner-approved` date.
3. When you edit a picture someone shared with you, where does your edit go? Recommended: a copy in your own Library
   ("Edited" folder); the sharer's picture never changes.
4. Should teens get a trim-and-join-only Video editor (no generating)? Recommended: no for v1; video stays adults-only as the
   video rule says, and a teen version needs your ruling later.
