# Spatial sound on a clip (developer notes)

Dev tier. Design: [spatial sound](../design/spatial-sound-2026-11-06.md). Rows SPATIAL-04 (the `edit_video` change and the plumbing) and SPATIAL-05 (the clip menu).

## What was verified, and what was not

- Verified: Home's tests against the scripted edit Stack, which answers like the Stack at 67481c2 (`files[]`, `spatial`, failure codes). The menu entries were opened on a dev hub at 1440 and 390 wide.
- Not verified: a real `spatial_sound` run. The Stack with the op is not shipped and Home is not pinned to it yet, so the dev Stack refuses the op. Nothing here was heard on headphones or a 5.1 system.
- Not on the live hub. Read this page as the behavior once the Stack is pinned and Home is shipped.

## The change

`edit_video` takes `change: "spatial_sound"` and an optional `surround` boolean. Nothing else is accepted with it. It adds no tool, so the offered tool count does not move.

| Piece | Where |
|---|---|
| Arguments and validation | `lib/videos/editTool.ts` (`editVideoArgs`, the `spatial_sound` branch of `editFinishedClips`) |
| The Stack step | `spatialOps` in `lib/videos/editPlan.ts`, `EditOp` in `lib/videos/stackEdit.ts` |
| The 5.1 file and the lines | `runStackEdit` reads `files[]` and `spatial` from the job result |
| Failure lines | `SPATIAL_FAILURE_COPY` in `lib/failureCopy.ts` |
| The menu route | `POST /api/videos/jobs/{id}/spatial-sound` in `routes/videos.ts` |
| The menu entries | `apps/chat/spatialSoundActions.ts`, used by `VideoToolRender` |

## Who may run it

The existing edit gate, unchanged. `editRefusal` (`lib/videos/editGate.ts`) gives a child or a teen `EDIT_MINOR_LINE` from the chat tool and from the route, before any clip is read. The clip must be the person's own, finished and open (`editableClip`). A clip with no sound of its own (`files[0].audio` is not `true`) is refused with the plain line and no job starts.

## The result

- The new clip is an ordinary edit job with `request.edit = { from, change: "spatial_sound", note }`. Its mark comes from `newItemMark(marks, false)` over the source, so an adult-only source gives an adult-only result and nothing is loosened.
- `files[0]` is always the stereo clip. With `surround`, `files[1]` is the 5.1 file (`role: "surround_5_1"`). It is its own Library file named "Spatial sound 5.1.mp4", with the same flags in its provenance, and it shares the stereo clip's poster. It shows in the Library as its own video, and a clip's file route serves it under the same lock check as the stereo clip.
- Both files go through the same finished-clip check before either is stored. If either is withheld, the job fails and nothing is kept.
- Unchanged stereo is a success. The Stack copies the sound and says why (`no_person`, `no_speech`, `several_people`, `centered`). Home keeps the Stack's `spatial.notes` as `request.edit.note`; the card shows it as its muted notice (the kit `notice` prop). There is no new status UI.

## Side, effects and already-spatial clips (SPATIAL-07)

- `side` is an optional `"left"` or `"right"` on `edit_video` with `change: "spatial_sound"`. It forces the sound to that side and is passed to the Stack op unchanged (`spatialOps(surround, side)`). Any other value, or `side` with another change, is refused with a plain line. The menu route takes `{ side? }` beside `surround`. No menu entry or screen uses it yet.
- A clip whose sound already moves with the picture comes back with reason `already_spatial` and is a success, like the other unchanged reasons. `SPATIAL_UNCHANGED_LINES` holds the same line as the Stack: "This clip's sound already moves with the picture, so it is unchanged."
- The Stack can also move effects (footsteps, a passing vehicle). Then its `note` is "Sound effects now come from the side of the picture where they happen. Wear headphones to hear it." Home keeps the Stack's lines first, so that line reaches the card as sent and Home adds no line of its own.
- `spatial.sources` names what moved: `speech`, `walker`, `vehicle`, `impact`, `side`. Home reads it (SPATIAL-REACH) only to decide whether the effects line may show: the stored note keeps the effects line only when `sources` holds an effect source (a Stack that sends no `sources` keeps its lines as sent).
- Child and teen still get `EDIT_MINOR_LINE`; the gate is unchanged.

## Failures

The Stack's codes `no_audio`, `bad_input`, `model_missing`, `no_memory`, `speech_unavailable` and `spatial_failed` each have one line in `SPATIAL_FAILURE_COPY`, shown after "I couldn't change that video." The Stack's own text is never shown. Home reads the code from `failure.code` of the job when the pinned Stack contract carries it, so the lines apply once the pin moves. Until then a failed job shows the Stack's own plain `reason` when it names no path, else the general edit line.

## The menu

`VideoToolRender` passes two `actionItems` to the kit `VideoPlayer` when the card says `can_edit` (an adult): "Spatial sound" and "Spatial sound with 5.1 file". Both are in the More menu. `disabledReason` carries the hint: no sound in the clip, or the video row's not-ready line from `useMakingAvailability`. No class, no wrapper (RULES rule 9).

## Where it is offered (SPATIAL-REACH)

- Chat video card: the kit `VideoPlayer` `actionItems` above ("Spatial sound" and "Spatial sound with 5.1 file").
- Videos > Create feed and the Studio export card: the page documents (`packages/videos/pages/create.json`, `studio.json`) list a "Spatial sound" action. Page actions may call only `/api/plugins/video/...`, so they call `POST /api/plugins/video/actions/spatial-sound` (`routes/mediaApps.ts`). That route and the chat card's route both call `startSpatialSound` (`lib/videos/spatialStart.ts`): the edit gate (adults only, `EDIT_MINOR_LINE` otherwise), the person's own open clip, the no-sound line. The new clip is an edit row of the Create feed (the Studio card then opens the Create page). Not covered: the "with 5.1 file" entry on these two surfaces (the kit schema allows four feed actions and two Studio export actions, and both are used up), a per-clip disabled hint for a clip with no sound (the route answers with the plain line instead), and the Watch and My clips tiles (they are not `VideoPlayer`s).

## The note

`spatialNote` (`lib/videos/editPlan.ts`) puts the Stack's lines in order: what moved (speech line, then effects line, with "Wear headphones to hear it." said once at the end), the 5.1 line, the quiet-rear line.
