# Videos Create and video editing (developer notes)

Dev tier. Design and measurements are in [video-create](../design/video-create-2026-11-01.md), [the Create screen](../design/video-create-ui-2026-11-02.md), [video tiers](../design/video-tiers-2026-11-02.md) and [videos in chat](../design/video-chat-2026-11-02.md). This page is the code map. Items: VIDEO-TIERS-01, VIDEO-CREATE-01 and 02, VIDEO-CHAT-01, VIDEO-UI-06, VIDEO-UI-15. The page design is [the one-page Create note](../design/video-create-one-page-2026-11-02.md).

## What was verified, and what was not

- Verified: the LTX-2.5 engine and the edits (trim, join, mix) ran with real clips and real ffmpeg on a scratch Stack. Home's tests run against a scripted Stack.
- Not verified: the live hub does not have this yet. It has not been shipped. Read this page as the behavior once installed.
- Verified for Max (LTX25-MAX-01): the Stack's own run (205 s for a 10 s clip, 48.6 GB OS footprint, speech correct, Stack main cc1198f3f) and Home's tests against a scripted Stack. The Create level segment was opened on a dev hub in the browser at desktop and phone width, with the Stack's status answered by a small proxy that forwarded to the live Stack and added `qualities.ltx25max` (ready, then installed false). **Not verified:** a real Create to Max clip through Home. No scratch Stack had the `ltx25-max-gen` runtime built (it downloads its Python environment and a 71 GB pack), so Home has never sent `ltx25-max` to a real Stack, and the clip that comes back (1024x576, quality `ltx25max`) is read only from the scripted fixture.
- Verified for VIDEO-UI-06 (the Create workspace and My clips): both pages opened on a dev hub at 1440 and 390 wide, light and dark. Style popover, level segment, Generate, Stop's button, Favorites only, Remix, the heart, the My clips tabs, day groups and size slider were pressed. With no Stack, Generate and Make it Max were disabled with the one plain line. A clip then moved from queued to a percent to ready without a reload, on a scripted scratch video Stack that answers the video routes on a timer (not the real engine). **Not verified:** a clip from a real Stack through this page, and the entry following a job while its tab is throttled in the background (the browser pane does not throttle a background tab); the unit tests cover the same code with a scripted Stack.
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

Two Create pages, both `min_role: "adult"`, in `backend/packages/videos/pages/` (manifest 0.2.0; the sidebar group `create` lists `["create", "clips"]`; the Browse and Create mode switch and Search Videos are the manifest's `header`):

- `create.json` (VIDEO-UI-15, the [feel note](../design/video-create-feel-2026-11-02.md)): a `split_view` with `aside_side: "start"`, `aside_width: "wide"` (420 px from `lg`) and `main_surface: "stage"` (the main pane on the kit's recessed `--surface-stage` token). The aside is a `prompt_bar` with `placement: "panel"` (a left panel from `lg`, 960 px; a bottom dock and Options sheet below), `field_size: "large"`, `starts: "video"` (the K8 marker) and one Start frame reference with `placement: "tile"` (label "Start frame", `hint` "Optional. Begin from a picture."). The main side is a `media_shelf` rail (heading Try this: `aspect: "poster"`, `layout: "rail"`, `variant: "plain"`, `density: "compact"`, `press_scale`, `hide_when_empty`, `media_loop: true` with `item_loop_field: "loop"`) bound to `recipes` scope `showcase`, whose `on_select` is a `navigate` to Create with `{prompt, look, camera}` (the refill Remix uses; a press starts nothing), then a `section` headed "Your clips" (the kit's feed has no heading of its own, so the heading sits above its View button, not beside it) holding the `result_feed` bound to `recipes` scope `feed`: `look: "media"`, `filters_presentation: "popover"` (one View button for Favorites only, Group by words and Type), the built-in handlers `stop`, `retry`, `make_another` and `favorite`, the extra actions Remix and Make it Max, and the required `poll_while` (statuses `queued` and `generating`, record `recipes` scope `job` with `id`). The `videoCreateApp.ts` fill adds the rest of the new props per person: the level segment gets `presentation: "cards"`, `submit_detail` gets `placement: "in_button"`, and the Look chip (first of the Style group) gets `trigger: "banner"` and `popover_size: "wide"`. Pinned `ui-v0.5.476` and `spec-v0.1.308`.
- `clips.json`: kit `tabs` (state `view`: All, Favorites, Uploaded) over `media_shelf` grids with `group_by_field: "created_at"` (day headings), `size_control` and, on All and Favorites, the `favorite` heart.

The three older pages (`create` as a text box with Next, `make-video`, `creations`) and the scopes `starters`, `making`, `last` and `newest` are gone. An unknown scope answers an empty list. A removed page is a 404 for everyone.

The per-person fill is in `lib/media/videoCreateApp.ts` (`registerAppPageFill("videos", "create", ...)`). It builds Length, Look and Camera (as `popover` cards in the group Style, each card's loop from the package assets), Voices (folded under More settings), the idea chips from `VIDEO_STARTERS`, the level segment, and the time under Generate (`submit_detail`, plain words per level: `VIDEO_TIME_WORDS`). It leaves out the Make it Max action unless the person holds Max and the Stack reports the Max model ready. The Level segment reads the Stack's video status without waiting, so the page route awaits one real read first (`registerAppPageWarm`, at most 1.5 s, never fails the page; MAX-FIRST-LOAD-01). The Look and Camera sample loops are package assets in `backend/packages/videos/assets/loops/`, played locally, never fetched.

## Data scopes and actions

One data id, `recipes` (the manifest stays at 16 ids), answers by `scope`. All of them are adult-only because only the two Create pages bind `recipes` (`appRouteAllowed`).

| Scope | Rows | Code |
|---|---|---|
| none | the recipe list | `recipes.ts` |
| `feed` | the person's own Create jobs (no chat behind them, no edits), newest first, limit 30, in the `result_feed` shape; params `favorites` and `type` | `lib/videos/feed.ts` |
| `showcase` | the Try this rail: `{id, title, subtitle, thumbnail, loop, prompt, look, camera}` (`loop` is the same-origin mp4 for `media_loop`), the same rows for every adult; a row whose poster is missing from the package is left out. A camera of `none` is the Auto card | `videoCreateApp.ts` `showcaseRows`, list `VIDEO_SHOWCASE` in `recipes.ts` |
| `job` | one feed row by `id`, for `poll_while.record` | `feed.ts` `feedRowById` |
| `clips` | My clips: Library clips made at home (own and shared with the person, as the Library lists them), by `view` (`all`, `favorites`, `uploaded` pictures) | `videoCreateApp.ts` `clipRows` |

A feed row is `{id, prompt, tags, references, status, state, percent, phase, queue_position, started_at, error, still, src, favorite, created_at, look, camera, start_frame, seconds, tier, orientation, width, height, kind}`. `status` is one of queued, generating, ready, failed, cancelled. A finished job whose Library file is gone or in Trash is not a row. The Remix fields (`look`, `camera`, `start_frame`) are `""` when absent: a null would leave the `{look}` placeholder text in the page state.

Actions, in `routes/mediaApps.ts`, each behind `appRouteAllowed` (a child or teen gets a 404):

- `make` and `another`: unchanged. `another` also serves Try again and Another take.
- `cancel`: stops the person's own Create clip (`cancelVideoJob`).
- `max`: Make it Max. `makeItMaxBody` (in `editTool.ts`, shared with the chat tool's `make_it_max`) does the checks (already Max, the Max grant, the Max model ready, words only) and `makeVideoFor` makes it, so every gate is the same.
- `favorite`: flips the mark, or sets it when `favorite` is true or false. `id` is a job (the feed) or a Library file (My clips).

## Favorites

The Library had no per-person flag, so Favorites is a small table, `video_favorites` (migration 0158, schema version 111): `id`, `person_id`, `file_id`, `created_at`, `hlc`, `provenance`, unique on `(person_id, file_id)`. One row per person and clip, so a shared clip can be a favorite of each person alone. It is a private preference, not a shared spec record, so no spec change was needed. Code: `lib/videos/favorites.ts`.

## Host wiring (K8)

`MediaHostProvider` (`frontend/src/shell/mediaHost.tsx`) gives the kit `makingNotice(kind)`: it reads the same `["health"]` query as `useMakingAvailability` (`makingAvailability` is the one reading) and returns the person's own line, or a plain fallback (`MAKING_NOT_READY_LINE`) when the row is not ready and carries no words. The bar's Generate, Try again, Another take and Make it Max are disabled with that line while video is not ready. `pickMedia` offers pictures only: a voice clip or source clip slot is refused until VIDEO-INPUTS-05 and -06 pass their benches.

## Not built yet

End frame and Voice clip slots (VIDEO-UI-09), the still draft with Make the video from this, Another still and Edit words (VIDEO-UI-07, needs VIDEO-INPUTS-02; the `render`, `another_still` and `edit_words` handlers are not in the page), Trim, Join and Mix on an entry (VIDEO-UI-08), Characters and Shows in the sidebar (they join when built), and the Filter and Select all controls of the mockup's My clips toolbar (the kit `media_shelf` has neither). The Type filter's Stills value is not offered until stills have rows. Remix cannot clear a Camera pick: the bar takes over only a value that is one of its options.

## Try this posters and Auto

`VIDEO_SHOWCASE` (`recipes.ts`) holds the eight tiles: words plus a Look id and a Camera id from the two lists below, and the loop whose poster is the picture. Each loop in `assets/loops/` has a poster JPEG beside it (`anime.mp4`, `anime.jpg`), the frame at 0.8 s. Regenerate them with `swift scripts/video-posters.swift` (Apple's decoder, no ffmpeg, no network); the files are committed package assets, served by `GET /api/plugins/videos/assets/loops/<name>.jpg` under the same adult-only rule as the loops (`appAssetAllowed`). Titles stay under about 14 characters because the kit draws one caption line.

Auto is the stated default (VIDEO-UI-11). Look's first card is `natural` and is drawn as "Auto" (same value; a clip's tag still says "Natural"). Camera gets a first option `none` labelled "Auto", with no media, which the route reads as no camera move. The Level hints say what each level is: Standard "Fast, with sound" (only "Fast" while the engine in use has no sound), Boost "Sharper picture", Max "Sharpest picture, with sound" or its reason when greyed. The Start frame tile reads "Start frame" with the hint "Optional. Begin from a picture."

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

In `backend/tests/`: `videoCreate.test.ts` (lists, wording, the Create page, refusals, one clip at a time), `videoCreateFeed.test.ts` (the `feed`, `job` and `clips` scopes, favorite, cancel, Make it Max, the manifest of two pages, permissions), in `frontend/src/shell/` `mediaHostMaking.test.tsx` (K8), `videoEdit.test.ts` (declared arguments, `quality` still accepted, another take, remix), `videoChatEdit.test.ts` (trim, join, mix, refusals, staging cleanup, audience floor), `videoContinue.test.ts` (the picture flags, picture start at each level, `continue`, the join transition), `videoLtx25.test.ts` (the tier choice with and without the engine, and the LTX-2.5 Max cases: offered iff ready and held, hidden for a teen, a child and an adult without the grant, the model id and size on the wire, a Stack profile lowering the ceiling, the not-ready segment and line), `videoQuality.test.ts`, `videoTool.test.ts`, `videoSafety.test.ts`. The Stack side is scripted by `videoEditStackFixture.ts` and `videoFixture.ts`. Run one with `cd backend && bun test tests/videoChatEdit.test.ts`.

## Verified for VIDEO-UI-15

Opened on a dev hub (Sage) at 1440 and 390 wide, light and dark, with eight seeded clips and one clip run live (queued, then a percent, then the video, in the media look, no reload). The Stack was a scripted video Stack on a scratch port that answers the video routes with the package loops, not the real engine. The pass found that the wide Style popover ran 68 px off the right edge at 1440 (it opens to the right of the left panel); fixed in commons `ui-v0.5.476` (width capped at Radix's available width). At 1440 with the app sidebar open the feed pane is about 500 px, so the feed is one column; the grid starts at a 41 rem pane (about 1560 px window). Not seen: a real clip from the real engine, a granted Max card in the ready state, hover actions by pointer.
