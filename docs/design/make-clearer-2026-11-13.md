# Make clearer: one operation, three levels, for pictures and clips (2026-11-13)

Status: built (MAKE-CLEARER-01). Owner ask (Jesse, 2026-11-13): "our image and video tools need upscalers, for example go to the editor and make the picture
clearer; maybe there are levels, where the ultimate is AI versus sharpening, resizing and noise reduction."

## What people see

One operation named **Make clearer** in the picture Studio (under More), on each video card's menu, and in chat (`edit_picture` op `make_clearer`, `edit_video`
change `upscale` with `clarity`). Three levels, one line and one time each, never a model name or a resource word:

| Level | Line | Time | How |
|---|---|---|---|
| Quick | Less grain and sharper edges, done on this computer. | a few seconds (clip: under a minute) | Pictures: sharp 3x3 median, optional Lanczos 1.5x or 2x, unsharp mask that leaves flat areas alone. Clips: the Stack's existing `denoise` (0.5) then `sharpen` (0.7) steps, one edit, same size. |
| Better | Smart enlarging that rebuilds fine detail. | about a minute (clip: a few minutes) | The existing Real-ESRGAN `upscale` (pictures 2x or 4x; clips 2x). |
| Best | The most careful repair, for old or damaged pictures and faces. | a few minutes | The AI restore (SeedVR2 and face repair, CREATOR-52). Pictures: on when the Stack's image tools list `restore`. Clips: on when `STACK_HAS_VIDEO_RESTORE` is true. |

Best is always shown. While the Stack lacks the restore it is off with one line: "Best quality needs an extra download. An admin can add it in Settings, AI & models."
(`BEST_NEEDS_DOWNLOAD`). The picture Studio draws the three levels with the kit's `levels` on an operation row (ui 0.5.643); the video card menu has no disabled
state, so its Best item answers with the same line when pressed.

## Where it lives (no second copy)

- `lib/mediaOps/picture.ts` registers `picture.make_clearer`; `lib/mediaOps/video.ts` registers `video.make_clearer`. Both carry `levels` (words in `clearerLevels.ts`).
  `listMediaOps` adds whether each level is ready and why not; the Studio rows, `GET /api/media-ops` and the chat schema all read that one table.
- Pictures run in `lib/imageEdit.ts` as operation `clearer` (`level`, `size`): Quick in Home (`processClearerQuick`), Better and Best through the same Stack tool path as
  `upscale`, so slow levels show in Activity through the existing `picture_edit` job row. The result is a preview, then Apply makes a new version (Undo and Compare as for any edit).
- Clips start through `clipEditStart.startClipEdit` (the one gate for adults, own open clip, Adult lock) via `POST /api/plugins/video/actions/clearer`; the edit is the chat tool's `upscale` change.

## Lock rule (owner decision, 2026-11-13, kept in sync with `SIMPLE_LOCAL_OPS` in `lib/imageEdit.ts`)

Quick adds no content, so it is a simple local edit like Adjust, but only when the result has the same pixel size as the source. Quick with 1.5x or 2x, Better and
Best are enlarging or model edits and lock as before (fail closed). Clip edits keep their existing lock handling.

## Measured (Quick on a generated noisy, slightly soft 400 x 300 picture, grain sd 12)

Flat-patch noise 8.9 to 4.4 (half); steepest edge step 25 to 42. On the same picture with no grain the Laplacian variance goes 5.2 to 30.4 (sharper). On the grainy one the
Laplacian variance falls (1583 to 302) because grain, not edges, dominated it, so noise and edge step are the honest pair there. Tests:
`backend/tests/makeClearer.test.ts`.

## Not built

SeedVR2 and GFPGAN themselves (CREATOR-52, benched elsewhere); the video Studio timeline (a per-piece Make clearer inside an export) and a clip level chooser with a disabled Best
(the feed menu has no disabled item). CREATOR-17's `restore` operation should be the Best level of this one operation, not a second operation.
