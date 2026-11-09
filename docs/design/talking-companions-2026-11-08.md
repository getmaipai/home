# Talking companions (2026-11-08)

## Goal

Move a companion's mouth with its spoken voice. The body remains the approved rest picture while it talks. The audio stays on the existing speech path.

## Rulings

1. While talking, the body stays a still (the keyed rest picture) with a moving mouth. A moving-body talking clip is not built now.
2. Six mouth shapes per character, approved like the rest of the sheet (Rhubarb A to F, X = rest).
3. Bench MuseTalk now, on one stylised and one human-like character. Needs a model download: ask the owner first.

## What exists

- Home's speaking signal is a boolean: `frontend/src/apps/chat/useCompanionSignals.ts:25` and `useCompanionPresence.ts:35`. It picks the `speaking` clip and a pulsing ring (`commons/ui/src/elements/companion-avatar.tsx:105`).
- A speech level meter already taps the speech bus: `frontend/src/lib/sentenceSpeechScheduler.ts:107` and `frontend/src/lib/voice/audioLevelMeter.ts:15`. The scheduler buffers whole sentences with a start time each (`sentenceSpeechScheduler.ts:14-22, 129-150`). Speech text is `normalizeForSpeech(text)` (`frontend/src/apps/chat/chatSpeechAdapter.ts:39`); timings must use the spoken string.
- The companion sheet already has a `mouth` view (`backend/src/lib/companionLookJobs.ts:66`), made by a Klein reference edit. Masked edits exist: `edit_masked` with a painted box (`companionLookJobs.ts:168`, `backend/src/lib/imageEdit.ts:338`), through `prepareEditSource` (`companionLookJobs.ts:163`) and the age and child screens.
- The kit `CompanionAvatar` draws clips through a WebGL canvas (`stacked-alpha-video.tsx:102-103`) and has no overlay slot. The `ring` prop is the precedent for an additive prop. Spec vocabulary in `commons/spec/vocab/companion-media.json` has no mouth field; `speaking` falls back to `idle`.
- No TTS engine emits word or phoneme timing. Chatterbox Turbo streams 1 s chunks (`stack/backend/src/speech/mlx_tts_server.py:41, 235-240`), Pocket TTS streams WAV only, and Fish Audio Drama 3 returns a duration only (`stack/backend/src/recordedSpeech/recordedSpeech.ts:30`).
- Stack has an MMS forced aligner (`stack/backend/src/align/align_worker.py`, peak 3.8 to 11 GB, lyrics only, `align.ts:21-23`). Parakeet token start times (`stack/backend/src/speech/sherpa.ts:22`, `transcriptSpans.ts:33`) are a no-download fallback for word times.
- Loki Doki is archived and read only: `frontend/src/components/companion/{phonemeViseme,viseme-scheduler,amplitude-fallback,visemeMap}.ts`. Its phoneme path was never fed; only the amplitude mouth ran (`amplitude-fallback.ts:3-4`). Port `amplitude-fallback.ts:35-65` (syllable rotation) and `VisemeScheduler`; do not rebuild.

## Reuse check

- Speech level meter: reuse it as the mouth driver input.
- `mouth` sheet view and `edit_masked`: reuse for the first edit. For the six approved shapes the spike changed the maker: photos use LivePortrait (ratio retargeting, same pixels every frame; new Stack pin, downloaded not vendored, with a licence-clean face detector in place of the bundled non-commercial one); stylised characters use the mouth-crop masked edit until LivePortrait is benched on one. Both start from LIKENESS-01's face scope (`likeness/edit.ts`: ellipse mask, Stack feathering, seeds, identity check) and keep `prepareEditSource` and the age and child screens.
- `ring` prop precedent: add an additive prop to `CompanionAvatar` in commons first.
- Loki Doki scheduler: port its amplitude fallback and `VisemeScheduler`.
- Rhubarb Lip Sync: new Stack pin, downloaded like ffmpeg, never vendored. Use for timed mouth shapes.
- Stack MMS aligner: rejected because its 3.8 to 11 GB peak and lyrics-only path are too heavy for chat.
- Engine-reported timing: dropped because no current TTS engine emits word or phoneme times.

## Phases

1. **P1 talking still (S; commons ui, then Home).** While speaking, the kit crossfades the keyed rest still to the keyed `mouth` view by level. Add `mouthLevel: () => number` to `CompanionAvatar`; poll it per frame like `useMediaAnalyser.ts:4-5`, fed from the scheduler's meter. No new art and no model. Risk: the `mouth` edit changed more than the mouth and flickers. If so, redo it with `edit_masked`.
2. **P2-spike, first step of P2 (S; Home dev hub).** Make the six shapes for the dev seed companion with `edit_masked`, flip them at 12 fps on the dev hub and look. This is the early check for whether the edits preserve the character and change only its mouth. Do this before the full P2 work.
3. **P2 six mouth shapes (M; commons spec, commons ui, Home; after TALK-02-SPIKE passes).** Define `animation.mouth` in spec as an anchor box and shapes A to F, with X as rest. Add a "Mouth shapes" sheet step whose maker is LivePortrait for photos and the mouth-crop masked edit for stylised characters (see the Reuse check and the P2-spike result), plus an eye-closed picture for blinks. Status rides the existing surfaces (RULE S6): each edit's own job card under "One job's progress", and the Make button is disabled through `useMakingAvailability` on the `image` row when pictures are not ready. No new surface. Review and approve each. Key and crop each shape to the anchor; the kit draws the crop over the still. Keep amplitude as the driver, using Loki Doki syllable rotation. Shared record change: spec first, then hub.
4. **P3 timed shapes (M; Stack, then Home; after P2).** Pin Rhubarb Lip Sync (MIT, CPU, macOS) behind `POST /v1/audio/mouth-shapes`. Input is WAV plus optional dialog text; output is shapes A to H plus X. Home `/api/tts` gains an additive per-sentence timings channel. Port `VisemeScheduler` onto the AudioContext clock. The first sentence stays on amplitude so there is no delay to first sound. Any failure falls back to amplitude and never fails the answer. Add no status surface, per RULE S6. The ported scheduler is covered by Elements ledger row ED-001 (`docs/design/ELEMENTS-DECISIONS.md`, speech scheduling with the spoken cue). Any crop drawn over the still is drawn inside the kit Element, never as an overlay `div` in Home.
5. **P4 MuseTalk bench (L; bench; folded into LOCAL-BENCH-02, no new id).** Bench MLX port `mlx-community/MuseTalk-1.5-fp16` (MIT, 256 px face, about 34 faces/s, 7 GB peak). It was trained on human faces; stylised animals are unproven. 7 GB during chat breaks the resource order (chat > images > video) and the rule that nothing is generated at play time. This is a bench with a verdict row, not a build. LatentSync 1.6 needs 18 GB and CUDA, so exclude it. Ask the owner before downloading the model.

## Supersedes

- `companion-video-characters-2026-10-21.md` section 6: the `speaking` row and "Speaking is the honest limit". While a companion speaks, the kit shows the keyed rest still with a moving mouth instead of the generic mouth-rhythm clip. The `speaking` clip stays the fallback when no mouth view exists.
- The decision row "Nothing is generated at play time" in the same record: P3 runs Rhubarb on each sentence while the voice plays. Only this narrow case is allowed; it is CPU only, loads no model and never blocks the first sound.
- `ambient-companion-2026-10-27.md` section 6a, "the header avatar is a still plus the ring, never a playing clip": the mouth moves on the pane stage and in Chat only. The 36 px header avatar is unchanged (still plus ring). A bot in the ambient spot keeps its `RobotFace` Element and is not touched (`bots-in-the-ambient-companion-2026-10-31.md`).

## Reduced motion

`mouthLevel` is ignored when the kit `animated` prop is false (`commons/ui/src/elements/companion-avatar.tsx:11`) or under prefers-reduced-motion. Then the avatar shows the rest still and the speaking ring without animation, as the ambient and video-character records already require.

## Rules touched

- Rule 9: add kit props in commons first, in its own worktree, then tag it. Sentence-gated speech scheduling is a named gap in the rule record.
- Rule S6: failures use the existing answer path; add no status surface.
- Age and child screens apply to every mouth edit; a child's or teen's mouth edits pass their band's finished-item check.
- Timings use the spoken text normalizer.
- Do not show resource words to users.
- TALK-03 must not log the dialog text it sends to Rhubarb (rule 6a). The mouth-shape scheduler lives in `frontend/src/lib/voice/`, not under `apps/chat/`, and the kit draws every crop.
- Principle 4: one definition. Mouth shapes live in spec only.

## Biggest unknown

Answered 2026-11-09, see the P2-spike result below.

Can masked edits of the rest picture give six stills that are the same character with only the mouth changed? The one check is the P2-spike: make the six shapes for the dev seed companion with `edit_masked`, flip them at 12 fps on the dev hub and look.

## P2-spike result (2026-11-09)

Run on a real-person photo companion (the plan said the dev seed companion; the "Open" line below still asks for a stylised character before the sheet step is approved).

- **Home's normal edit route cannot make a mouth shape.** `startLookEdit` with a mask runs a head swap (`faceRef`, `swapHead`) that copies the rest picture's face back over the edit, and it appends the version's style phrase ("cartoon"), which redraws the mouth as a cartoon. Its fit and key steps also rescale the picture, so the result no longer lines up with the rest. Six shapes through it showed no mouth change.
- **One full-frame masked edit drifts.** The mouth changes but the eyes and expression change too (smile creases lost).
- **A mouth-only crop edit works.** Crop a 384 px square on the mouth, upscale to 1024, masked-edit it with no face swap, no fit, style "keep" and one fixed seed, and paste back only a feathered ellipse onto the untouched rest, taking the edited crop from the engine's raw output (the `.orig.png`), not the keyed version. Measured: the raw crop lines up with the rest at offset 0 and scale 1. Shapes A, B, C, D and F were distinct and the same man. Moustache edges are still soft and shape E ("oh") came back as a smile.
- **LivePortrait beats the crop method on a real photo (bench, same day).** One photo in, a mouth-open ratio and an eye-open ratio out. Same pixels in every frame, so teeth, lips and identity stay put; five mouth steps and a blink each took about half a second on this Mac's GPU. Its code and weights are MIT, but its bundled face detector (InsightFace buffalo_l) is non-commercial: a shipped version needs a licence-clean detector (MediaPipe) first. Stylised characters are untested. A first bench run produced garbage because the zoom argument was passed as 0; its default is 1.
- **Open:** a better prompt for E, and a check on several faces and one stylised character before the sheet step is approved.
- **Eyes:** blinking is the same technique on the eyes (one closed-eyes picture, optionally half closed). It is added to TALK-02's scope as a finding to verify, not a decided design.
- **Design of the job is left to TALK-02's own reuse check.** That check must start from LIKENESS-01's face scope (`backend/src/lib/pictures/likeness/edit.ts`: ellipse mask, `editMasked` with Stack feathering and paste-back, several seeds, identity check) and say what it reuses and what is new. Any new route must keep `prepareEditSource` and the age and child screens that `startLookEdit` applies.

## Not doing

No engine-reported timing tier, moving-body talking clip, LatentSync or live Meta-style face.
