# Companion pack: one format, one player, one maker (2026-11-10)

Reuse check: grepped `getmaipai/*` for companion, talk, mouth, idle, avatar. The kit already ships `CompanionStage` (`commons/ui/src/elements/companion-stage.tsx`, the pane stage, takes `character: ReactNode`) and `CompanionAvatar` with its idle machine, blink and life motion (`companion-avatar.tsx`, `companion-avatar-machine.ts`, TALK-01 `mouthLevel`). Extends and supersedes the TALK-01..11 plan in
`docs/design/talking-companions-2026-11-08.md` (kit `CompanionAvatar` mouth crops, `animation.mouth` spec, Home "Talk" sheet step, LivePortrait maker route).
Keeps from it: TALK-01 (talking still, landed), TALK-06 (Stack LivePortrait engine), the three-screen companion flow (ruling 2026-10-28), RULES.md rule 9 (kit Elements as they ship).

## Rulings (Jesse, 2026-11-10)
1. Replace the six-crop plan with one **companion pack** format. No second copy of the idea.
2. Build the **player first** (the three demo characters become packs and play in the app), then the **maker** (a character from any starting image).
3. Works on iPhone Safari and desktop; low CPU and GPU while in use; small on disk; quick words keep up; several animations per state, picked at random; no green glow.
4. Real people and celebrity photos are valid starting images (see `feedback_no-real-person-caution`); the likeness rule in `docs/PLATFORM.md` and SAFETY.md still applies to who may make and use them.

## What the demo proved (data-scratch/poc-companions, git-ignored; numbers measured on the Mac Studio)
- Idle, listen, think and speak clips (LTX, green screen, keyed, despilled) cut at rest frames with no jump when the current clip runs on to its boundary.
- Whole-lower-face shape tiles plus baked optical-flow in-betweens make lips that move, not pasted patches. Real man: LivePortrait frames and flow through the live video's own lower face. Cartoons: baked tiles.
- A browser-side cue builder (CMU phonemes, audio-envelope alignment, coarticulation) keeps up with fast lines at +9 ms mean lag ("Bob Sam Billy Tom"), 5.0 shape changes per second on a long line.
- Head life (brow, gaze, nod, blink, micro), loud speech (wide shout shapes, brow, shoulder), vocal tags, and upper-face **emotion** layers (angry, excited, alarmed, sad) as one smooth flow plus a texture residual.
- Safari rules found the hard way: no VP9 alpha (stack the matte under the colour in H.264), no `ctx.filter`, byte-range requests for video, BT.709 colour tags, resume Web Audio from a real tap and request the playback audio session so the silent switch does not mute speech.

## Pack format (`@maipai/spec`, one schema, validated at build and at load)
One folder per companion, one `pack.json`:
- `states`: `idle`, `listen`, `think`, `speak` each hold **an array of clips** (at least 2 idles, 1 to 3 for the others), each `{file, fps, frames, rest: [first, last], track}`. H.264 BT.709, 480 px tile, matte stacked under colour (premultiplied). The player picks a clip at random for a state, never the same twice in a row, with weights, and changes only at a rest frame (running the current clip on at up to 8x).
- `mouth`: shapes A to H plus `wide` (shout) as one WebP atlas, the baked in-between flow fields as one int16 binary, anchor and weight maps. `eyes`: closed, half, wide pictures. `emotion`: per kind one flow file and one texture residual. `life`: calibrated head and micro channel amplitudes and per-character tuning.
- Budgets: at most 12 MB per companion at 480 px, a 320 px phone tier made at build time (about 45 percent of the bytes), lazy loading by state (idle first, the rest while idle plays), one shape set only (no calm, wide or experimental copies), one clip format (no WebM twin).

## Player (new kit element `CompanionPackPlayer` in `commons/ui`; Home only wires it)
- It is passed into the existing `CompanionStage`'s `character` slot (no change to the stage). It takes over what `CompanionAvatar` does for a companion that has a pack: one player and one idle sequencer, never two. `CompanionAvatar`'s still, header size and `mouthLevel` stay for companions without a pack; its duplicate idle and blink code is removed in PACK-10 once every companion has a pack.
- Draws with WebGL: clip frame, matte recombination, mouth morph, head and emotion warps in shaders. No per-frame `getImageData`. Target on Mac Studio Safari and an iPhone: under 6 percent of one core and a steady 60 fps desktop, 30 fps phone (rAF cap), measured and recorded, not assumed.
- Pure, tested modules: `buildCues(text, audio)` (CMU phonemes, envelope alignment, coarticulation, **fast mode** above 4.2 vowels per second: holds and merges scaled by 0.6, 70 ms transitions, weak vowels hold B, M/B/P and pauses over 150 ms close), `lifeSchedule(seed)` (blink, gaze single events every 6 to 12 s, brow and nod on stress peaks, micro channels), `emotionFor(text, tags, mode)` (words, vocal tags, loudness), `idleSequencer(clips, seed)`.
- Pauses when the tab is hidden, reduced motion shows the still, the 36 px header avatar stays a still.
- Voice stays Home's own speech path; the player only reads the audio clock and its samples.

## Maker (Stack jobs behind one Home route; one job, resumable, cancellable)
From any starting image (photo, celebrity, drawing, 3D render):
1. keyed portrait: cut-out, rest picture, face landmarks and anchors (Apple-free: the Stack's own detector).
2. clips: several idles, listen, think, speak through LTX with locked-camera prompts, "final frame matches the first", then key, despill, match lighting to the rest frame, tag and stack the matte.
3. shapes: A to H plus wide from LivePortrait (photos) or the image-edit route (stylised); register to the rest picture; bake the in-between flows.
4. emotion poses (angry, excited, alarmed, sad): edit pictures, bake flow plus residual.
5. **validators** that fail the job with a plain reason: green excess on skin and edges against the rest picture, lighting step between every clip pair at the cut, rest-frame difference, chin and neck static at shout peaks, mouth opening range 12 to 19 percent shout, 2 to 6 percent calm, left and right symmetry, size under budget.
**Safety gates (RULES.md 0 and 10, carried over from TALK-05, TALK-10 and TALK-11, not optional):** every starting image goes through `prepareEditSource`; every generated picture and clip (clips, mouth shapes, emotion poses) goes through the child and teen finished-item checks and the adult CSAM check, which fails closed when it cannot run; who may start the maker follows the picture and video age and surface gates (a child or teen profile keeps its filters on companion media). A failed check fails the job with a plain reason and keeps nothing.
The demo's fixes become the stages: `tools/light_fix.py` (hue rotation, wedge repaint, lighting flatten), `stack_alpha.py`, `build_morph.py`, `jaw` rules (jaw OFF), emotion build. Make is disabled by the existing S6 row "Pictures and video are not ready" (`useMakingAvailability`); progress shows on the job's own card ("One job's progress"). No new status surface.

## Quick words, many animations, no green (the three acceptance checks)
- Fast speech: replay "Bob Sam Billy Tom", "And here I was thinking that you wouldn't finally fix it" and a 6 words per second line; lag mean under 30 ms, p95 under 120 ms, shape changes under 5.5 per second.
- Several animations: any state with N clips plays them in a random order, with no repeat twice in a row and no visible jump at the switch (rest-frame difference under 0.7 Lab).
- Green: measured green excess on skin and edge pixels at or below the rest picture on every frame of every clip; the validator blocks a pack above it.

## Supersedes
TALK-02, TALK-03, TALK-04, TALK-05, TALK-08, TALK-09, TALK-10, TALK-11 and the `animation.mouth` / `animation.eyes` spec in the talking-companions note; TALK-07 (Stack mouth-timings route) is no longer needed (cues are built in the browser) and stays only as an optional upgrade. TALK-06 is kept as an input to the maker.

## Rules touched
None changed. Rule 9: the player is a kit element and ships as is; Home adds no wrapper.

## Biggest unknowns
- iPhone CPU and GPU cost of three simultaneous warps: bench before claiming (PACK-09).
- Real-person likeness quality from a single celebrity photo through LTX: validate on one photo before the maker is called done.
