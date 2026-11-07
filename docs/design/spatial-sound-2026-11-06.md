# Directional and surround sound for generated videos (SPATIAL)

Design note, 2026-11-06. Status: proposed, awaiting architect. Owner direction (Jesse, 2026-11-06, after asking whether a movie's audio is
directional, with a character on the left sounding left, and ideally surround): build a feature that creates a directional and surround sound
track for a generated video. This note says what the engine gives us, what we can add with parts we already run, where it shows, what it cannot
do, and the build order. No code is written here.

Reuse check: grepped home, stack, commons and catalog for face, person, detect, landmark, vision, yolo, pan, surround, eac3, channel_layout,
stereo, spatial and beats. Found, and reused:
- Stack `look/look.ts`, `look_worker.py` and `look_core.py` (LOOK-01): YOLOX-nano in the image-tools environment, one JPEG in, labels with boxes out, the class list starts with `person`, nothing kept, no log line carries a box. It is the position source. It is not a face detector; it finds people.
- Stack `speech/transcriptSpans.ts` `splitSpeechSpans` with the Silero detector already loaded for voice: speech spans over a mono 16 kHz signal. It is the speech activity source.
- Stack `media/editOps.ts` (29 ops in `EDIT_OPS`, zod unions, one `*Args` builder per op) and `media/jobs.ts` (one `else if (op.op === ...)` branch per op, `needsVideo`, the work directory and the `partial` file). The new op follows the same shape as `gain`, `film_look` and `mute`.
- Home `videos/editTool.ts` (the `edit_video` `change` enum, `newItemMark` at its three call sites), `videos/editPlan.ts`, `videos/stackEdit.ts`, `videos/editGate.ts`, `lib/adultLock.ts` `newItemMark`, and `lib/failureCopy.ts`.
- Rows read: LTXD-E1 and E2 (the pattern for an additive op and a clip menu entry), LTXD-13 (More menu entries), AUDIO-PARITY-01 (audio on clips, children and teens get no generated sound), VIDEO-STUDIO-07 (Studio export lays voice over music), VIDEO-INPUTS-04 and -05 (audio lengths, voice clip), CMEDIA-STACK-01 (clip results through `media.companion_clip`), LOCAL-BENCH-01.
- Home has a face detector, but it is YuNet running in the browser for face enrollment (`frontend/src/lib/vision/faceDetect.ts`, `faceDetectRuntime.ts`, pins in `backend/src/lib/faceModelPins.ts`). It is consent-bound enrollment code that serves a model to a browser, it is not on the Stack, and a clip job runs on the Stack. It is not reused here.
Not found anywhere: a pan or surround op, a speaker-position track, any multichannel output, an `eac3` encode. This note adds only those.

## 1. What the engine gives us (measured 2026-11-06, LTX-2.5 Max)

Notes: `data-scratch/reports/ltxd-01-claymation-on-25-2026-11-06.md` and the runs in `~/video-bench/lora-test/runs`.

1. Engine audio is AAC, 48 kHz, 2 channels.
2. A clip with a man talking at the far left of the frame and another with him at the far right both have identical left and right channels (correlation 1.0, largest left-minus-right difference about 0.01, mean pan 0.0). The engine gives no left or right direction for speech. Dialog is mono placed in the middle.
3. A clip of ambient sound (a sleeping cat in a kitchen) had different channels (correlation 0.43). Width exists in ambience and music, but it does not follow the on-screen position of anything.
4. Proof of concept: ffmpeg `pan=5.1|FL=0.85*c0|FR=0.15*c0|FC=0.5*c0|LFE=0|BL=0.05*c0|BR=0.02*c0` on the left-speaker clip, encoded `-c:a eac3 -b:a 384k`, gave a real 5.1 E-AC-3 track. Per-channel RMS: FL 0.072, FR 0.013, FC 0.043, BL 0.004, BR 0.002. The Stack's own ffmpeg can render a surround track.

So the answer to the owner's question is no today: a talking character on the left is not louder on the left. The fix is a post step on a finished clip, not a change to the engine.

## 2. The feature in one paragraph

A clip gets a "Spatial sound" action. The Stack finds where the speaker is on screen over time, finds when speech happens from the clip's own audio, and
re-mixes the audio: dialog moves toward the speaker's side while they speak, the wide part of the sound goes to the sides and rear, and a low bass
channel is filled from the low end. The result is a normal clip with stereo that has direction, always. When the person also asks for it, a second file
with a 5.1 track is made for a surround system. Nothing here adds or invents sound; it moves sound that is already in the clip.

## 3. How it works

### 3.1 Speaker position (SPATIAL-02)

- **Frames.** ffmpeg samples the clip at 4 frames a second, scaled for Look (416 px), and hands each JPEG to the Look worker. The frames live in memory or a work directory that is deleted when the job ends (Robot vision R1 is the model: look once, drop). No box, label or position is logged or stored; logs carry counts and milliseconds (RULES 6a).
- **Detector.** The existing Look worker, `person` class only. Look's `too_fast` limit of 12 pictures a minute per source guards outside callers, and a 5 s clip needs 20 frames. So SPATIAL-02 adds one in-process batch entry (`lookFrames`) that uses the same worker, the same governor admission and the same heavy-gate pause, with no per-minute counter because the caller is a Stack job, not a camera. It adds no second model and no second worker.
- **One value.** For each frame, a person box gives `x = box.x + box.width / 2`, and `position = 2 * x - 1`, so -1 is the left edge, 0 the middle, +1 the right edge.
- **Several people.** Candidates are kept per frame. A tie-break picks the talker: the person whose upper box (where the face is) changes most between frames while speech is on (frame difference in ffmpeg, no model). If that does not clearly separate them, the largest box wins; if two are close in size and motion, the position is 0 (center). This tie-break is the part that needs a bench (SPATIAL-01) and ships only if it holds.
- **Smoothing.** Median of 5 samples, then a limit of 0.6 position units a second, so a dialog never jumps. No person for up to 1.5 s holds the last value; longer than that it glides back to 0 over 0.5 s.
- **Speech activity.** `splitSpeechSpans` over the clip's own audio (mixed to mono 16 kHz) gives speaking segments. For each segment the position is the median of the smoothed samples inside it, one value per segment. A segment longer than 4 s may update when the median moves by more than 0.25. Between segments the dialog glides to 0 over 150 ms, so the middle channel sits in the center when nobody talks.
- **Output of this step.** A short list of `{ start_s, end_s, position }`, passed in memory to the render step. At most 64 segments (the rest merge by nearest position).

### 3.2 The render (SPATIAL-03)

Mid and side: `M = (L + R) / 2`, `S = (L - R) / 2`. Dialog lives mostly in M; ambience and music width live in S.

- **Direction (stereo, always).** Constant-power pan on M with `theta = (position + 1) * pi / 4`, `gL = sqrt(2) * cos(theta)`, `gR = sqrt(2) * sin(theta)`. At position 0 both are 1, so a centered line sounds as it did. Output `L' = gL * M + S`, `R' = gR * M - S`. The gains are a piecewise-linear expression of time built from the segment list and applied with the ffmpeg `volume` filter in frame mode on M before it is recombined. If the expression grows past ffmpeg's length limit, the op renders per segment with `atrim` and joins instead (the exit of SPATIAL-03 tests both).
- **Surround (optional 5.1 E-AC-3).** `FL` and `FR` carry the panned M plus part of S. `FC` carries M scaled by `1 - |position|`, so a centered speaker locks to the middle speaker and a side speaker is mostly front-left or front-right. `BL` and `BR` carry S and -S, delayed 10 ms and low-passed at 7 kHz so the rear reads as room, not as a copy. `LFE` is a 120 Hz low-pass of the sum, scaled down, and adds no new content. Encode `-c:a eac3 -b:a 384k`.
- **No fake upmix.** If the clip's S is near silent, the rear channels are near silent. We do not synthesize reverb or decorrelate to make the rear loud. The plain line in section 4 says so when the rear is quiet (measured as rear RMS under -50 dBFS).
- **Video is copied.** The op re-encodes only audio (`-c:v copy`). AI-disclosure marks and metadata that the LTX licence asks us to keep are carried over (the LTXD-E1 verification task covers the same point for every op).
- **Op shape.** `spatial_sound` joins `EDIT_OPS` in `editOps.ts` with `{ op: "spatial_sound", surround?: boolean }` and a `spatialArgs` builder; `media/jobs.ts` gets one branch. The segment list is computed inside the job from SPATIAL-02 and is not part of the request, so the request cannot smuggle positions in. A clip with no audio stream is refused with a plain line (`needsAudio`, beside `needsVideo`). The Stack edit job runs up to 12 ops and writes one final partial, so `spatial_sound` with `surround` must be the last op; otherwise the job is refused with a plain line ("Make the 5.1 file as the last step of the edit.").
- **Where the 5.1 file lives.** The job result is the stereo clip, so Library, Download and sharing work unchanged. With `surround`, the same job also writes a 5.1 file (video copied, one E-AC-3 track). Home stores it as a second entry in the result clip's `files` array (`VideoFile` in `videos/jobs.ts`, with its own poster), and records where the clip came from with the existing `VideoRequest.edit: { from: source.id, change: "spatial_sound" }`, adding `"spatial_sound"` to that `change` union. `clipFileOf` and `editableClip` keep using `files[0]`, the stereo clip. No new spec field is proposed: the two existing places cover the link; a spec field would be needed only if the Library must list the 5.1 file as its own item, and nothing in this note needs that.

## 4. Where it shows

- **Clip action.** "Spatial sound" in the More menu of a clip. The kit `VideoPlayer` (ui-v0.5.506, the pin) already takes `actionItems` with `when` and `disabledReason` (`video-player.tsx`; `chatToolUis.tsx` uses it), so no commons change is needed. No wrapper, no className.
- **Choice.** One small step after the click: "Stereo with direction" (default) and a switch "Also make a 5.1 file". Both from kit parts as shipped.
- **Chat.** The same action is one more value in the `edit_video` `change` enum, `spatial_sound`, with an optional `surround` boolean (additive; no new tool, so the offered tool count of rule 1 does not move). The model picks it from the person's words; code never reads the words.
- **Result.** A new normal clip with the source as its source. The mark comes from `newItemMark([await clipMarkOf(source)], false)`, so an adult-only clip stays adult-only and nothing is loosened. The 5.1 file takes the same mark.
- **Plain lines (copy, STYLE.md).** After a stereo result: "Sound now follows who is talking on screen. Wear headphones to hear it." After a 5.1 file: "The 5.1 file plays on a surround system or an Apple TV. Other players play it as stereo." When the rear is quiet: "This clip's sound had little width, so the back speakers stay quiet."
- **Status and failures.** No new status UI (RULES S6). Progress is the job's own card and the existing Status row. A failure reads through the failing call's own response and `failureCopy`: the problem as the person sees it, then the next step. Examples: "This clip has no sound, so there is nothing to place. Make or add sound first." and "Spatial sound needs the Look part. An admin can install it in Settings, Models and storage, then try again." While the video engine is not ready, the action is disabled through the item's `disabledReason` (S6 row "Pictures and video are not ready").
- **Ages and gate.** The action runs through the existing edit gate unchanged, with no new gate and no bypass. `editRefusal` (`editTool.ts`, `editGate.ts`) is for adults only; a child or teen gets `EDIT_MINOR_LINE`. `editableClip` (`editGate.ts`) allows only the person's own, finished clip that is open (not behind the Adult lock). The result goes through the same finished-item check as every `media.edit` result (rule 10; adult output is withheld by the CSAM check only, an unrun check on an adult-only job fails closed). Opening this to minors would be a separate owner decision and is not proposed.
- **Privacy.** No outbound connection. The detector, the speech detector and ffmpeg all run on the Stack. Frames and positions stay in memory or a deleted work directory (rule 6a). No phone-home.
- **Out of scope here.** Studio export (`studioExport.ts`) is not changed: run Spatial sound on the exported clip. Choosing the position by hand, per-object tracks, head-tracked or Dolby Atmos output, and applying it automatically to every new clip are not planned.

## 5. Honest limits

1. A person detector gives where people are, not who is talking. With one person it is right when they talk. With several, it guesses from motion, and when it cannot tell it centers the dialog. The bench says how often it is right before this ships.
2. Sound effects and voices with no visible source (an off-screen narrator, a door, footsteps) stay centered or keep whatever width the engine gave them. We do not guess a position for what we cannot see.
3. Mid carries the dialog and also whatever mono ambience or music sits in the middle. While someone speaks, that content leans with the voice. The glide back to center between lines limits it. A music-heavy clip will lean more.
4. The side-to-rear split is only as wide as the engine's own width (correlation 0.43 in the cat clip, 1.0 for the speech clips). Many clips will give a quiet rear.
5. A box center is not a mouth. A person cut off by the frame edge, seen from behind, or drawn as a cartoon or claymation figure may not be found at all. The bench includes the styles Home makes.
6. 5.1 E-AC-3 is not played by every browser. The stereo clip is the main result for that reason.
7. Positions are sampled 4 times a second and smoothed. A fast whip pan will lag by a fraction of a second.

## 6. Build order (backlog rows)

Format is `docs/BACKLOG.md`. Rows stay in this note until the architect approves it, as the LTXD rows do; the lander writes `docs/BACKLOG.md`. Each slice lands alone. The bench is first because the whole feature rests on a person box being a good enough stand-in for the speaker.

- [ ] **SPATIAL-01: bench the position source and the render** (S, Stack bench, owner judges by listening). Twelve real clips from the Studio (speaker far left, far right, center, walking across, two people with one talking, two people close in size, nobody visible, back to camera, a cartoon, a claymation, an off-screen narrator, a music-only clip). Measure per clip: whether Look finds the `person` (recall), position error against a hand-marked position (target: within 0.25 for 90% of speaking segments on single-speaker clips), the two-person tie-break hit rate (ship the tie-break only at 80% or better, otherwise ship center-on-doubt), time and peak footprint of 20 frames through Look, and the clip's left-right correlation before and after. Then render each with the section 3.2 filter and have Jesse listen on headphones and one 5.1 system. Reuse check: Look, `splitSpeechSpans`, the cat and speaker clips already measured. Exit: a verdict row per question in `video-speed-bench-2026-11-01.md` and a go, narrow or no-go for SPATIAL-02 to 06. If YOLOX-nano misses cartoon and claymation figures, say so and ship for realistic styles only, with the limit written in the plain line.
- [ ] **SPATIAL-02: the position track on the Stack** (M, Stack; needs SPATIAL-01 go). `media/spatialTrack.ts`: frame sampling at 4 per second, `lookFrames` batch entry on the existing Look worker, the tie-break if SPATIAL-01 passed it, smoothing, speech spans from `splitSpeechSpans`, the segment list of section 3.1. Pure functions for smoothing and segmenting, unit tests with fixed box sequences (a speaker moving left to right, a dropout of 2 s, two people, nobody). Footprint row added to the job table. Exit: tests pass; one real clip run prints the segment list as counts only in the log.
- [ ] **SPATIAL-03: the `spatial_sound` edit op** (M, Stack; needs SPATIAL-02). `spatial_sound` in `EDIT_OPS` and the `EditOp` union with `surround`, `spatialArgs` and `surroundArgs` builders, one branch in `media/jobs.ts`, `needsAudio`, the second 5.1 output, last-op rule, the plain 422 lines. Reuse check: `gainArgs`, `muteArgs`, `needsVideo`. Exit: a left-speaker clip gives front-left louder than front-right by the segment gain and FC at 0.5 or less; the real-clip RMS check reproduces the proof of concept ordering (FL above FC above FR above BL and BR); `ffprobe` shows 2 channels AAC for the main result and 6 channels E-AC-3 for the sibling; a clip with no audio returns the plain refusal; the expression-length fallback is tested with 64 segments.
- [ ] **SPATIAL-04: `edit_video` change and Home plumbing** (S, Home; needs SPATIAL-03). `spatial_sound` added to the `change` enum with `surround`, validation in `editTool.ts`, a plan in `editPlan.ts`, the call in `stackEdit.ts`, the mark through `newItemMark` with the source, the 5.1 file saved as a second `files` entry and `edit: { from, change: "spatial_sound" }` (no spec field), failure copy through `failureCopy`. Reuse check: LTXD-E1 and LTXD-E2 patterns, `filmLookArgs` wiring. Exit: the chat tool runs it on a real clip; a test that an adult-only source gives an adult-only result and 5.1 file; a test that a teen and a child get `EDIT_MINOR_LINE` from both the chat tool and the menu action; a test that a clip with no sound returns the plain line; the tool set count is unchanged.
- [ ] **SPATIAL-05: the clip action and plain lines** (S, Home; needs SPATIAL-04). "Spatial sound" in the More menu with the one choice step and the three plain lines of section 4. Preview with `bun run dev` on the demo household at 1440 and 390 px, opened and judged, light and dark. Exit: the action runs from the menu on a real clip; the result plays in the page with audible direction on headphones; Download gives the stereo clip; the 5.1 file is a second file of the clip, with its line; the disabled state shows while the video engine is not ready.
- [ ] **SPATIAL-06: end-to-end check and the user page** (S, Home docs). Run the whole chain on three new clips (a person on the left, a person on the right, an ambient scene), open the result, and measure channel balance with the same ffmpeg commands as section 1. Play the 5.1 file on a surround system. Add a grade-6 page to `docs/user/` ("Make a video's sound follow the picture") and a developer note. Exit: `bash scripts/check.sh --docs` passes; measured numbers are in the page's source note.

Recommended order: SPATIAL-01, then 02, 03, 04, 05, 06. SPATIAL-02 and 03 can be written by two sessions once 01 passes, because 03 needs only a fixed segment list to test its render. Not planned: automatic spatial sound on every new clip (revisit after SPATIAL-06 and the listening verdict), and a hand-edit of positions.

## 7. Owner questions

None. The decision to build was Jesse's on 2026-11-06. The listening verdict in SPATIAL-01 is a bench judgement, not an open question. No rule changes, no money, no credential or safety gate is touched.

## Supersedes

Nothing. No rule or earlier note is changed, and the existing edit gate (adults only, the person's own open clip) is inherited.
