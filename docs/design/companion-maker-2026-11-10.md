# Companion maker: from a starting image to a pack (2026-11-10)

Reuse check: grepped `getmaipai/home`, `stack`, `commons` for companion, pack, maker, key, despill, matte, talk, liveportrait, image-tools. Extends and splits PACK-07 of [companion-pack-2026-11-10](companion-pack-2026-11-10.md). **Already shipped and reused, not rebuilt:** the Stack media op `media.companion_clip` (CMEDIA-STACK-01 and CMEDIA-KEY-01: keys green or magenta per frame from the drawn background, unmixes spill so skin stays untinted, colour-matches to the rest picture, fits loops at the seam, writes a 480 px wide BT.709 premultiplied stacked-alpha H.264 with a `report.json`; `stack/docs/integrations.md` kinds table), Home `companionTakes.ts` and `companionStates.ts` (CMEDIA-STATES-01..03: per-state takes through the video model from the rest picture on the key colour, retries, measured reports, per-state approval `approved_by` and `approved_at`), `checkCompanionArt` (`backend/src/lib/companionArtCheck.ts`: the stricter of the companion's audience and the person asking), and `roleHealth` with `useMakingAvailability`. Builds on: the Stack picture and video generation routes, the TALK-06 LivePortrait engine (unbuilt; it gates MAKER-B), Home's `companionLookJobs.ts`, `companionTalkMaker.ts`, `pictures/stack.ts`, `jobProducers.ts`, `useMakingAvailability`, and the PACK-01..04 work (spec `CompanionPack`, `scripts/pack/`, kit `companion-pack/`). The proof-of-concept scripts to port are in `data-scratch/poc-companions/tools/` (git-ignored): `process_clip.py`, `light_fix.py`, `stack_alpha.py`, `build_man.py`, `build_morph.py`, `build_head*.py`, `build_eyes.py`, `emotion_build.py`.

## Supersedes
PACK-07 of the companion pack note (one row, now split into MAKER-A..G). It supersedes nothing that is built: the existing take and state pipeline (`companionTakes.ts`, `companionStates.ts`, `media.companion_clip`) is **kept and extended**, not replaced. TALK-05, TALK-10 and TALK-11 are already superseded by the pack note. TALK-06 (the Stack LivePortrait engine) is a gate for MAKER-B, not superseded.

## Rulings (Jesse, 2026-11-10)
1. Build the **permanent maker first**, then make the next character with it. The demo scripts are the specification and the source to port, not the runtime.
2. **One character at a time, fully**, each proving the system: a real person first (P4, a man in his thirties, approved still), then a cartoon with a mouth, then a bot without a mouth, then non-human mouths.
3. **Preview images before anything is created**: the maker always starts with stills the owner approves (the existing picture route), and every expensive stage (clips) needs an approval.
4. Quality gates are code, not eyes: a stage that fails its validator stops with a plain reason.

## Shape
Home owns the job (state, approvals, safety, storage, validation). The Stack does the heavy work as stateless, resumable, cancellable ops. No stage writes to Home's data directly; files move through the Stack file store and the pack ends in Home's companion store.

- **Stack, clips:** extend `media.companion_clip` (MAKER-A) with the parts the demo proved and it lacks: the per-frame lighting and hue flatten (`light_fix.py`), the rest-frame boundary check (first and last frame equal to the rest pose, reported in `report.json`), the per-frame head track (`<clip>.track.json`, a 2x3 affine and a confidence per frame), and the 320 px phone twin. No second keyer, no second encoder.
- **Stack, shapes and emotion (media lane, not the ONNX image-tools environment, which has no torch):** new ops declared in the `integrations.md` kinds table: `media.companion_shapes` (photo path: LivePortrait frames per letter from TALK-06, registered to the rest picture, baked atlas and flows; stylised path: edit pictures to tiles and flows), `media.companion_emotion` (flow plus residual), `media.companion_pack` (lossy WebP, deflated flows, the 12 MB budget). Face landmarks come from the licence-clean detector TALK-06 ships, not Apple Vision (the demo used Apple Vision; the maker must not).
- **Home** `backend/src/lib/companionPackMaker.ts` (new, backend only): a `companion_pack_job` record whose stage machine **sits on the existing take and state records** (a clip stage is the existing per-state take with its retries, reports and approval), pack assembly, validation through `@maipai/spec`, the route under `routes/companions.ts`. The route refuses when the image or video row of `roleHealth` is not ready, and LivePortrait readiness feeds the `image` row (as TALK-10 carried) so `useMakingAvailability` disables Make. The approval buttons and progress are the existing job card and the kit `Button` as shipped (frontend is PACK-08; if the card has no action slot a commons prop lands first, rule 9(c), no wrapper).

## Stages and approvals
0. **Preview**: owner prompt or image to stills (existing picture route); the owner picks one. **Approval A.**
1. **Source**: the approved still on a flat chroma-green background (image edit), face and clothes untinted (checked).
2. **Clips**: idle (at least two), listen, think, speak through the video route one job at a time with locked-camera prompts and pose-matched boundaries; up to 2 re-rolls per clip; every clip goes through the extended `media.companion_clip`. **Approval B** (the owner sees the idle loop in the pack player).
3. **Shapes**: `media.companion_shapes` (photo path for a photo, stylised path for a stylised character), a voice-reactive layer instead for a character with no mouth (design note to follow with the first bot).
4. **Emotion**: `media.companion_emotion` for angry, excited, alarmed, sad.
5. **Validate and pack**: `media.companion_pack`, the spec validator, then the measured checks. **Approval C** (the owner sees the pack speak and shout in the player), then installed in Home.
Each approval is a button on the job's own card; refusing stops the job and keeps only what the owner chose.

## Validators (a failure names the field and what to do)
green excess on skin and edge pixels at or below the rest picture on every frame; lighting step between any two clips at the cut under 0.7 Lab; first and last frame of every clip equal to the rest frame; no frame without alpha holes; per-eye openness difference under 0.12 outside blinks; mouth opening 2 to 6 percent calm and 12 to 19 percent shout (photo path), chin and neck static; size under 12 MB (desktop tier); spec validator clean.

## Safety (RULES.md 0 and 10, as in the pack note)
Every starting image goes through `prepareEditSource`; every generated output (the green source, every clip frame, every `shapes` frame and tile, every emotion pose) goes through `checkCompanionArt`, which uses the stricter of the companion's audience and the person asking, so an all-ages companion made by an adult still gets the child lane, plus the adult CSAM check, failing closed; who may start the maker follows the picture and video age and surface gates; a failed check fails the job and keeps nothing. Real-person likeness follows `docs/PLATFORM.md` and SAFETY.md.

## Testing and the first character
Unit tests per op on tiny fixtures (a 12-frame clip). P4 is the golden run: its stage metrics (green excess, lighting step, frame counts, mouth ranges) are recorded and asserted with tolerances, not pixels. The demo's measured numbers are the acceptance targets. Stack changes land in the Stack repo; installing them on the live hub needs Jesse's word in that turn.

## Slices (replace PACK-07)
MAKER-A (Stack): extend `media.companion_clip` (lighting flatten, rest-frame check, track, phone twin). MAKER-B (Stack; gate TALK-06): `media.companion_shapes` photo path. MAKER-C (Stack): `media.companion_emotion` and `media.companion_pack`. MAKER-D (Home, backend only; gate A to C): `companionPackMaker.ts` on the existing takes and states, the route, safety and validators. MAKER-E (Home; gate D): a script that runs a job end to end for P4 and opens it in the player. MAKER-F: the stylised path for the first cartoon. MAKER-G: the no-mouth voice-reactive layer for MaiPai (a spec change; its design note comes first).

## Not doing
No cloud generation. No new status surface. No second pack format. The demo scripts are not shipped.
