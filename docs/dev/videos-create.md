# Videos Create and video editing (developer notes)

Dev tier. Design and measurements are in [video-create](../design/video-create-2026-11-01.md), [the Create screen](../design/video-create-ui-2026-11-02.md), [video tiers](../design/video-tiers-2026-11-02.md) and [videos in chat](../design/video-chat-2026-11-02.md). This page is the code map. Items: VIDEO-TIERS-01, VIDEO-CREATE-01 and 02, VIDEO-CHAT-01.

## What was verified, and what was not

- Verified: the LTX-2.5 engine and the edits (trim, join, mix) ran with real clips and real ffmpeg on a scratch Stack. Home's tests run against a scripted Stack.
- Not verified: the live hub does not have this yet. It has not been shipped. Read this page as the behavior once installed.
- Not built: `continue` and `retake` (the Stack's LTX-2.5 refuses a picture start), Max (no slot passes the 64 GB cap yet), Characters, Places and Storyboard.

## Stack requirements

Home reads what the Stack reports, and offers nothing the Stack did not say it can do.

- **LTX-2.5 engine** (`ltx25-gen` on the Stack). Home counts it only when `qualities.ltx25.ready` is exactly `true`; `profiles[]` lists each level's true width, height and `max_seconds`, and a profile with an unusable size is dropped (`stack.ts`). Without it, adults get the older models (Wan Standard 5 s, LTX-2.3 Boost 10 s) and the tests in `videoLtx25.test.ts` pin that.
- **`media.edit` job.** Trim, join and mix call it through `lib/videos/stackEdit.ts`. Without it, an edit answers with a plain "cannot change the video" line.
- LTX-2.5 takes words only: the Stack answers 422 to a picture start or a LoRA. A picture or style clip goes the old way.

## Tiers and ceilings

One definition: `backend/src/lib/videos/quality.ts`. Every length in Home reads `maxSecondsFor`; every size reads `videoSizeFor`.

| Level | Model | Sound | Ceiling | True size |
|---|---|---|---|---|
| Standard (adult) | LTX-2.5 q8 distilled | yes | 10 s | 512x256 (asked as 512x288) |
| Boost (adult) | LTX-2.5 q8 distilled | yes | 5 s | 768x448 (640x320 is the smaller size) |
| Max | none | | | stays empty until a run passes the 64 GB per-clip cap and beats Boost |
| Standard (child, teen) | Wan Quick | no | 5 s | 832x480 |

The engine rounds the height so heights are multiples of 64, so the 288 and 352 in the design note come out as 256 and 320. The Stack's own profile wins over `LTX25_DEFAULTS`, and a profile's `max_seconds` can only lower a ceiling. Measured on a 128 GB Mac: Standard 10 s about 43 s (39.4 GB), Boost 5 s 42 to 74 s.

Rule 8: a child or teen has no level choice. `chooseVideoQuality` sends `quickOnly` for them and `videoModelForLane` (`lib/pictures/lane.ts`) picks Wan Quick again at the job starter. Max needs the `tier.max:video` grant (`lib/tiers.ts`); owners and admins hold it by role.

The older words Quick and Detailed remain in `quality.ts` as the internal model families. `generate_video` still accepts `quality`: detailed means Boost, quick means Standard.

## Pages

`backend/packages/videos/pages/`:

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

Package `backend/packages/edit_video` (manifest 0.2.0, gate `videoEditAllowed`, bench row `video-edit-tool`), code in `lib/videos/editTool.ts`.

1. `editVideoArgs` parses the call. A bad call fails as `bad_arguments`.
2. `videoRefusalFor` screens the surface and age, then any typed words (a remix prompt or a voice line).
3. `another_take`, `remix` and `make_it_max` rebuild the old job's body (`bodyOfVideoJob`), change the named fields, and call `makeVideoFor`. A clip that started from a picture reloads it through `prepareVideoRerun`. `make_it_max` checks the Max grant and keeps the seed.
4. `trim`, `join` and `mix` are adult-only. `editPlan.ts` builds the ops (`trimOps`, `joinOps`, `mixOps`); join takes 2 to 6 of the person's own clips; mix takes a voice line or a song at one of five levels (quiet to very loud). A voice line is spoken by `synthesizeSpeech` inside the job, so the chat reply does not wait for it.
5. `runStackEdit` stages the inputs under `data/video-edit/` in a private 0700 folder, submits one `media.edit` job, reads the result, and always removes the folder. `sweepStaleEditFolders` removes folders over an hour old at startup.
6. The result is `data: { videoJobId }`, the same shape as `generate_video`, so the same card follows it. A failed tool tells the model only the failure kind; a refusal keeps its own plain line.

Clips in Trash or gone from the Library are refused. A temporary chat uses only its own temporary clips.

## Audience floor

An edit is never lower in audience than its sources. `clipAdultOnly` marks a source adult-only from its job flag, else from its Library note (a saved clip whose note does not say all-ages counts as adult-only). A song marked adult-only, or a voice line that screens as adult-only, also makes the edit adult-only. `startVideoEditJob` stores `request.adultOnly`, and the stored file's provenance carries `audience: "adult-only"`.

## Tests

In `backend/tests/`: `videoCreate.test.ts` (lists, wording, page data, refusals, one clip at a time), `videoEdit.test.ts` (declared arguments, `quality` still accepted, another take, remix), `videoChatEdit.test.ts` (trim, join, mix, refusals, staging cleanup, audience floor), `videoLtx25.test.ts` (the tier choice with and without the engine), `videoQuality.test.ts`, `videoTool.test.ts`, `videoSafety.test.ts`. The Stack side is scripted by `videoEditStackFixture.ts` and `videoFixture.ts`. Run one with `cd backend && bun test tests/videoChatEdit.test.ts`.
