# Videos Create and video editing (developer notes)

Dev tier. Design and measurements are in [video-create](../design/video-create-2026-11-01.md), [the Create screen](../design/video-create-ui-2026-11-02.md), [video tiers](../design/video-tiers-2026-11-02.md) and [videos in chat](../design/video-chat-2026-11-02.md). This page is the code map. Items: VIDEO-TIERS-01, VIDEO-CREATE-01 and 02, VIDEO-CHAT-01.

## What was verified, and what was not

- Verified: the LTX-2.5 engine and the edits (trim, join, mix) ran with real clips and real ffmpeg on a scratch Stack. Home's tests run against a scripted Stack.
- Not verified: the live hub does not have this yet. It has not been shipped. Read this page as the behavior once installed.
- Verified for Max (LTX25-MAX-01): the Stack's own run (205 s for a 10 s clip, 48.6 GB OS footprint, speech correct, Stack main cc1198f3f) and Home's tests against a scripted Stack. The Create level segment was opened on a dev hub in the browser at desktop and phone width, with the Stack's status answered by a small proxy that forwarded to the live Stack and added `qualities.ltx25max` (ready, then installed false). **Not verified:** a real Create to Max clip through Home. No scratch Stack had the `ltx25-max-gen` runtime built (it downloads its Python environment and a 71 GB pack), so Home has never sent `ltx25-max` to a real Stack, and the clip that comes back (1024x576, quality `ltx25max`) is read only from the scripted fixture.
- Built 2026-11-02 (VIDEO-INPUTS-01 Home side, EDITOR-15), scripted tests only: picture start on LTX-2.5, `edit_video` `continue`, the `join` `transition` field. A real `continue` clip was not run (see the session report). Not built: `retake`, the join crossfade (needs a Stack step, below), the End frame slot and `end_frame` argument (bench VIDEO-INPUTS-04 first), Characters, Places and Storyboard. VIDEO-TIERS-01 stays open for the parts below Max (the Stack pin and one memory-measurement method are the Stack's).

## Stack requirements

Home reads what the Stack reports, and offers nothing the Stack did not say it can do.

- **LTX-2.5 engine** (`ltx25-gen` on the Stack). Home counts it only when `qualities.ltx25.ready` is exactly `true`; `profiles[]` lists each level's true width, height and `max_seconds`, and a profile with an unusable size is dropped (`stack.ts`). Without it, adults get the older models (Wan Standard 5 s, LTX-2.3 Boost 10 s) and the tests in `videoLtx25.test.ts` pin that.
- **`media.edit` job.** Trim, join and mix call it through `lib/videos/stackEdit.ts`. Without it, an edit answers with a plain "cannot change the video" line.
- **Picture start (VIDEO-INPUTS-01, Stack ede7c3a).** `qualities.ltx25.image_to_video` and `qualities.ltx25max.image_to_video` exactly `true` (`ltx25PictureReady`, `ltx25MaxPictureReady` in `quality.ts`); `end_image` is a second flag (`ltx25EndPictureReady`) and `VideoBody.end_image` exists, but nothing sends a last picture yet (VIDEO-INPUTS-03 waits for its bench). `chooseVideoQuality` lets an adult's picture clip ride LTX-2.5 (and Max) only when the flag is true; an older Stack, a style, a teen or a child keep the old makers. The Stack fits the picture itself; Home sends the stored bytes unchanged. Home holds no memory figures for a picture start: admission is the Stack's. `videoBodyForSlot` drops `end_image` for any model but LTX-2.5.
- LTX-2.5 takes no LoRA: the Stack answers 422 to one. A style clip goes the old way.

## Tiers and ceilings

One definition: `backend/src/lib/videos/quality.ts`. Every length in Home reads `maxSecondsFor`; every size reads `videoSizeFor`.

| Level | Model | Sound | Ceiling | True size |
|---|---|---|---|---|
| Standard (adult) | LTX-2.5 q8 distilled | yes | 10 s | 512x256 (asked as 512x288) |
| Boost (adult) | LTX-2.5 q8 distilled | yes | 5 s | 768x448 (640x320 is the smaller size) |
| Max (adult, holds Max) | LTX-2.5 bf16 distilled, `ltx25-max` | yes | 10 s | 1024x576 (576x1024 portrait), words only |
| Standard (child, teen) | Wan Quick | no | 5 s | 832x480 |

The engine rounds the height so heights are multiples of 64, so the 288 and 352 in the design note come out as 256 and 320. The Stack's own profile wins over `LTX25_DEFAULTS`, and a profile's `max_seconds` can only lower a ceiling. Measured on a 128 GB Mac: Standard 10 s about 43 s (39.4 GB), Boost 5 s 42 to 74 s.

Rule 8: a child or teen has no level choice. `chooseVideoQuality` sends `quickOnly` for them and `videoModelForLane` (`lib/pictures/lane.ts`) picks Wan Quick again at the job starter. Max needs the `tier.max:video` grant (`lib/tiers.ts`); owners and admins hold it by role.

**Max (LTX25-MAX-01).** Max is offered only when `qualities.ltx25max.ready` is exactly `true` (`ltx25MaxReady`) and the person holds `tier.max:video` (owners and admins by role) and is an adult. It no longer depends on the saved Max slot having its own model: `maxOffered(person, "video", band, available)` takes the Stack's answer for `available`. The Stack's `max` profile gives the size and a ceiling that can only lower 10 s (`videoSizeFor`, `maxSecondsFor` with maker `ltx25max`). `chooseVideoQuality` takes `max: true` (the caller read the grant) and returns maker `ltx25max`; a picture start or a style never gets Max (the tool tells the model it was not made at Max). `makeVideoFor` sends model `ltx25-max`, tier `max`; the job request is quality `detailed`, tier `max`, and `videoBodyForSlot` keeps the model while the level is still Max, otherwise sends an LTX-2.5 Boost clip (a Max level switched off since) or Wan (a minor, never Max). Admission (51 GB) and the one-video-at-a-time rule are the Stack's and the household queue's; Home says "about four minutes" and never a memory figure to a person.

The Create level segment shows Max ready with its hint. A person who holds Max, on a Stack that reports the Max engine but not a ready pack, sees Max greyed with `disabled_reason` from `videoMaxNotReadyReason` (not installed, or not ready): the existing way a kit segment says why. The install, the 71 GB and the licence prompt stay in Settings, Models and storage: the Stack lists the pack as a `video` component with its licence, and `ModelsAndStorageSection` already asks the admin to accept it. `make_it_max` refuses with that same line (`max_not_ready`) and makes nothing, and refuses a clip that started from a picture or used a style (`max_words_only`).

The older words Quick and Detailed remain in `quality.ts` as the internal model families. `generate_video` still accepts `quality`: detailed means Boost, quick means Standard.

## Pages

`backend/packages/videos/pages/`:

- The Level segment reads the Stack's video status without waiting. The first page after Home starts would have no Max, so the page route awaits one real read first (`registerAppPageWarm`, at most 1.5 s, never fails the page; MAX-FIRST-LOAD-01).
- `make-video.json`: `split_view` of a `prompt_bar` (chips), the `player` stage, a `list` for Making now and a `media_shelf` of recent clips.
- `create.json`: the Create home: `prompt_bar`, a section of starters, a section of Making now, and a `media_shelf`.

The per-person fill is in `lib/media/videoCreateApp.ts`. It builds the Look and Camera options, the level segment, lengths and the Start frame from the single lists below, and it hides Max from a person who cannot use it. The chip cards variant and `references` slots are the commons `prompt_bar` additions of the Create design (U1); the Look and Camera sample loops are package assets in `backend/packages/videos/assets/loops/`, played locally, never fetched.

## One list for looks, camera moves and voices

`backend/src/lib/videos/recipes.ts` holds each list once:

- `VIDEO_LOOKS`: natural, classic cartoon, anime, 3D animated, film.
- `VIDEO_RECIPES` (the Camera cards): dolly in, slow orbit, handheld, slow motion, time-lapse, aerial, close-up, still.
- `VIDEO_VOICES`: clean (no laugh track, no music, one speaker at a time; the default) and music and effects.

A look's wording goes before the person's words, a camera's wording after, a voices wording last. The Stack gets the joined text; the card and the Library keep only what the person typed. The Create page, the `generate_video` and `edit_video` manifests and `editVideoArgs` (`z.enum(ids(...))`) all read these arrays, so a new look is one edit plus its loop.

## Jobs

`makeVideoFor` (`lib/videos/make.ts`) is the one function that starts a clip. The Create buttons, `generate_video`, and the first three `edit_video` changes call it, so the gates, the level rules and the one-clip-at-a-time rule are the same everywhere. Jobs live in `lib/videos/jobs.ts` (table `video_jobs`). An edit is a job of kind `edit`, started by `startVideoEditJob`, with the Library note `video-edit:` linked to its first source. The old clip is never replaced.

## The edit tool path

Package `backend/packages/edit_video` (manifest 0.3.0, gate `videoEditAllowed`, bench row `video-edit-tool`), code in `lib/videos/editTool.ts`.

1. `editVideoArgs` parses the call. A bad call fails as `bad_arguments`.
2. `videoRefusalFor` screens the surface and age, then any typed words (a remix prompt or a voice line).
3. `another_take`, `remix` and `make_it_max` rebuild the old job's body (`bodyOfVideoJob`), change the named fields, and call `makeVideoFor`. A clip that started from a picture reloads it through `prepareVideoRerun`. `make_it_max` checks the Max grant and keeps the seed.
4. `trim`, `join` and `mix` are adult-only. `editPlan.ts` builds the ops (`trimOps`, `joinOps`, `mixOps`); join takes 2 to 6 of the person's own clips; mix takes a voice line or a song at one of five levels (quiet to very loud). A voice line is spoken by `synthesizeSpeech` inside the job, so the chat reply does not wait for it.
5. `runStackEdit` stages the inputs under `data/video-edit/` in a private 0700 folder, submits one `media.edit` job, reads the result, and always removes the folder. `sweepStaleEditFolders` removes folders over an hour old at startup.
6. The result is `data: { videoJobId }`, the same shape as `generate_video`, so the same card follows it. A failed tool tells the model only the failure kind; a refusal keeps its own plain line.

Clips in Trash or gone from the Library are refused. A temporary chat uses only its own temporary clips.

**`continue` (EDITOR-15).** `continueFrom` in `editTool.ts`: the person must be an adult in a chat; the source must be their own finished clip, not in Trash; the Stack must report a picture start for the level (`ltx25PictureReady`, or Max's own flag at Max) or the tool answers `picture_start_not_ready` with a plain line and takes no frame; another clip being made answers `already_making`. Then `runStackEdit` runs one `frame` op (`frameOps(lastFrameAt(seconds))`, 0.1 s before the end) to `frame.png`, `sharp` turns it into a JPEG, `screenInputImage` screens it like any picture an adult hands the tool, and `storeContinueFrame` (`jobs.ts`) keeps it as the chat's own picture (the same kind of file a clip's poster is; memory only in a temporary chat) so Another take and Remix of the new clip start from it again. The body is `bodyOfVideoJob(source)` with the new words (else the old), look, camera, voices, tier and length when given, a new seed, and goes through `makeVideoFor` with `prepared` and `adultOnly` (an adult-only source makes an adult-only continuation: `StartVideoInput.adultOnly` is stored on the request, so the finished-clip check never judges it lower). The result is a new `animate` job; the old clip is kept. A clip made by trim, join or mix has no stored level, so a continuation of it takes the level its quality implies.

**`join` transition.** `transition` is `cut` (default) or `crossfade`, with `transition_s` 0.3 to 1.0 (default 0.5). The Stack's `media.edit` (editOps.ts: trim, concat, mute, frame, audio_overlay, fade) cannot lay one clip over another, so a real crossfade cannot be built from those steps; a fade out then a fade in then a concat is a dip through black, not a crossfade, and Home does not call it one. `CROSSFADE_IN_STACK` in `editPlan.ts` is false, so a crossfade answers `not_supported` with a plain line offering the cut. `crossfadeOps` already builds the step the Stack needs: `{ op: "crossfade", duration_s, with? }`, run like `concat` (working clip, then the later files or `with`), each seam blending the last `duration_s` of one clip into the first `duration_s` of the next (video `xfade=fade`, sound `acrossfade`), re-encoded to the first clip's size and rate, every clip longer than twice `duration_s`. When the Stack ships it, flip the switch and add a real-ffmpeg check.

## Audience floor

An edit is never lower in audience than its sources. `clipAdultOnly` marks a source adult-only from its job flag, else from its Library note (a saved clip whose note does not say all-ages counts as adult-only). A song marked adult-only, or a voice line that screens as adult-only, also makes the edit adult-only. `startVideoEditJob` stores `request.adultOnly`, and the stored file's provenance carries `audience: "adult-only"`.

## Tests

In `backend/tests/`: `videoCreate.test.ts` (lists, wording, page data, refusals, one clip at a time), `videoEdit.test.ts` (declared arguments, `quality` still accepted, another take, remix), `videoChatEdit.test.ts` (trim, join, mix, refusals, staging cleanup, audience floor), `videoContinue.test.ts` (the picture flags, picture start at each level, `continue`, the join transition), `videoLtx25.test.ts` (the tier choice with and without the engine, and the LTX-2.5 Max cases: offered iff ready and held, hidden for a teen, a child and an adult without the grant, the model id and size on the wire, a Stack profile lowering the ceiling, the not-ready segment and line), `videoQuality.test.ts`, `videoTool.test.ts`, `videoSafety.test.ts`. The Stack side is scripted by `videoEditStackFixture.ts` and `videoFixture.ts`. Run one with `cd backend && bun test tests/videoChatEdit.test.ts`.
