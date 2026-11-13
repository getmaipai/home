# Make clearer: one operation, three levels, for pictures and clips (2026-11-13)

Status: built (MAKE-CLEARER-01). Owner ask (Jesse, 2026-11-13): "our image and video tools need upscalers, for example go to the editor and make the picture
clearer; maybe there are levels, where the ultimate is AI versus sharpening, resizing and noise reduction."

## What people see

One operation named **Make clearer** in the picture Studio (under More), in the video Studio (Make more: Quick and Better), and in chat (`edit_picture` op `make_clearer`, `edit_video`
change `upscale` with `clarity`). Three levels, one line and one time each, never a model name or a resource word:

| Level | Line | Time | How |
|---|---|---|---|
| Quick | Less grain and sharper edges, done on this computer. | a few seconds (clip: under a minute) | Pictures: sharp 3x3 median, optional Lanczos 1.5x or 2x, unsharp mask that leaves flat areas alone. Clips: the Stack's existing `denoise` (0.5) then `sharpen` (0.7) steps, one edit, same size. |
| Better | Smart enlarging that rebuilds fine detail. | about a minute (clip: a few minutes) | The existing Real-ESRGAN `upscale` (pictures 2x or 4x; clips 2x). |
| Best | The most careful repair, for old or damaged pictures and faces. | a few minutes | The AI restore (SeedVR2 and face repair, CREATOR-52). Pictures: on when the Stack's image tools list `restore`. Clips: on when `STACK_HAS_VIDEO_RESTORE` is true. |

Best is always shown. While the Stack does not list `restore` it is off with one line: "Best can be added in Settings, AI & models." (`BEST_NEEDS_DOWNLOAD`; true since the Stack's optional component `seedvr2-3b`,
MAKE-CLEARER-2026-11-13). For clips Best says "Best is not available for clips yet." (`BEST_VIDEO_NOT_YET`). The picture Studio draws the three levels with the kit's `levels` on an operation row (ui 0.5.645). The video pages have no room: the Create feed menu is at the schema
cap of 8 actions and the Studio's Make more at 3 (it had one), and a menu item cannot be drawn off with a reason. So the video Studio lists Quick and Better; Best for a clip is
reached by chat and `POST /api/plugins/video/actions/clearer` (`level: best`), which answers with the same line. A levels picker on a video page needs a kit element and is open.

## Where it lives (no second copy)

- `lib/mediaOps/picture.ts` registers `picture.make_clearer`; `lib/mediaOps/video.ts` registers `video.make_clearer`. Both carry `levels` (words in `clearerLevels.ts`).
  `listMediaOps` adds whether each level is ready and why not; the Studio rows, `GET /api/media-ops` and the chat schema all read that one table.
- Pictures run in `lib/imageEdit.ts` as operation `clearer` (`level`, `size`): Quick in Home (`processClearerQuick`), Better and Best through the same Stack tool path as
  `upscale`, so slow levels show in Activity through the existing `picture_edit` job row. The result is a preview, then Apply makes a new version (Undo and Compare as for any edit).
- Clips start through `clipEditStart.startClipEdit` (the one gate for adults, own open clip, Adult lock) via `POST /api/plugins/video/actions/clearer`; the edit is the chat tool's `upscale` change with `clarity`.

## Lock rule (owner decision, 2026-11-13, kept in sync with `SIMPLE_LOCAL_OPS` in `lib/imageEdit.ts`)

Quick adds no content, so it is a simple local edit like Adjust, but only when the result has the same pixel size as the source. `clearer` is on `SIMPLE_LOCAL_OPS`, and
`saveVersion` makes the same-size check there (the preview carries its `level`; only `quick` can carry, a missing level fails closed). Quick with 1.5x or 2x, Better and
Best are enlarging or model edits and lock as before, even when a model level returns the same size. Clip edits keep their existing lock handling.

## One tool

Make clearer is the only upscaling tool a person is offered. There is no separate Upscale entry: the registry's `picture.upscale` is not listed any more, and a caller that
still runs it (the image-edit route, the editor's Resize bar, chat's picture upscale) is run as `picture.make_clearer` at the Better level (`scale` becomes `size`). Chat's
picture upscale starts Make clearer Better at 2x.

## Supersedes

- The lock-list paragraph of `video-loras-2026-11-02.md` (line 235, "Simple edits of an unlabelled picture"): it now lists Make clearer at Quick, same size, among the simple local edits.
- The separate `picture.upscale` Studio entry (`images-app-2026-11-03.md`): it is the Better level of `picture.make_clearer`.
- CREATOR-17's planned `restore` operation (`creatoros-port-2026-11-13.md` section 2.1): it is the Best level of `picture.make_clearer`, not a new operation.

## Measured (Quick on a generated noisy, slightly soft 400 x 300 picture, grain sd 12)

Flat-patch noise 8.9 to 4.4 (half); steepest edge step 25 to 42. On the same picture with no grain the Laplacian variance goes 5.2 to 30.4 (sharper). On the grainy one the
Laplacian variance falls (1583 to 302) because grain, not edges, dominated it, so noise and edge step are the honest pair there. Tests:
`backend/tests/makeClearer.test.ts`.

## Not built

SeedVR2 and GFPGAN themselves (CREATOR-52, benched elsewhere); the video Studio timeline (a per-piece Make clearer inside an export) and a clip level chooser with a disabled Best
(menus have no disabled item and the Create feed menu is full). CREATOR-17's `restore` operation is the Best level of this one operation, not a second operation (see Supersedes).

## Best for pictures (built 2026-11-13, CREATOR-52 picture part, CREATOR-17 restore)

Best calls the Stack's `restore` (SeedVR2 3B through mflux, low-RAM mode, same size as the picture, up to 2 megapixels). It always starts as a job (the Stack is asked not to wait), so it has an Activity row
through the existing `picture_edit` row. Measured on the Studio: 512 px 5.7 s cold and 3.0 s warm, 2 megapixels 24 s, peak footprint 9.8 to 10.1 GB. The level line says "a few minutes", an honest upper bound.
It is an engine edit for the Adult lock (it locks like Better). SeedVR2 is generative and redraws faces, so the result of a picture with a face of 60 px or more is kept only when every such face is found again with a
face match of at least 0.80, the bar of a face edit from the 2026-11-07 likeness bench (`restoredFacesRefusal` in `lib/pictures/likeness/edit.ts`, no new rule or threshold). Otherwise the result is dropped,
the person's picture is untouched and one line says so and offers Better; a face that cannot be compared is treated the same with its own line. No face, or no face models, leaves the ordinary path. A child's own cartoons take no
check. Not built: Best for clips (flicker, temporal path unbenched).
