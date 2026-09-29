# FACE-02E: yaw/pitch estimate from the five detected landmarks

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`.
Model floor: Codex, `low`-to-`medium` reasoning (a documented geometric
heuristic, not an algorithm to invent from scratch - the shape is
decided below; the calibration constants are honestly approximate and
say so).

## Ready handshake

Reply with your model, checkout path and branch, and "ready for
FACE-02E". Wait for "start". Start from a fresh branch off current
`origin/main` (this item does not depend on FACE-02D being merged, but
fetch first to confirm you're not behind it):

```
git fetch origin && git checkout -b codex/face-02e origin/main
```

## Why

FACE-02A ported the legacy `EnrollmentSession`/`bucketPose` logic
faithfully, but that logic has always taken `yawDeg`/`pitchDeg` as
**inputs** it never computed itself - read `enrollmentSession.ts`'s
`FaceSample` interface and `bucketPose()` (they just consume the
numbers). The legacy source explains why: its own header says "the
512-d embedding itself comes from the Hailo ArcFace pipeline
(perception service)" - head pose came from that same external
hardware pipeline too, never ported, because it was never pure logic
to port. This repo has no head-pose source at all today. Before FACE-02's
camera UI can guide someone through a five-pose enrollment ("turn left
a little"), something has to turn FACE-02C's five detected landmarks
(right eye, left eye, nose, right mouth, left mouth, in pixel
coordinates) into the `yawDeg`/`pitchDeg` numbers `bucketPose()`
already expects.

**Be honest about what this is**: a simple geometric heuristic from 5
points, not a calibrated 3D pose solve (that would need a canonical 3D
face model and a real PnP solver, which is real added complexity for a
UI guidance signal, not a security- or matching-critical number -
matching only ever happens on the embedding, never on pose). There is
no ground-truth oracle to verify exact values against here (unlike
FACE-02C's SVD math, which had the real Python `align.py` to check
against) - say so plainly in your own commit and comment, and test the
*shape* of the behavior (sign, ordering, frontal-near-zero), not exact
calibrated degree values. The scale constants below are starting
points Jesse or a later live-camera session will need to tune against
a real face, the same honest position `DEFAULT_QUALITY_CONFIG`'s own
comment already takes for its thresholds.

## Files you own

- `frontend/src/lib/vision/headPose.ts` (NEW).
- `frontend/src/lib/vision/headPose.test.ts` (NEW).
- `docs/BACKLOG.md` (tick FACE-02E, see step 4).

Do not touch `enrollmentSession.ts`, `faceDetect.ts`, or `faceAlign.ts` -
this item only adds a new pure function that PRODUCES the numbers those
files already consume; it doesn't change any of them.

## Steps

1. Read `faceDetect.ts`'s `DetectedFace` type (the five landmark fields
   FACE-02C already decodes: which field is which point, and their
   coordinate space - pixel coordinates in the padded detection frame)
   and `enrollmentSession.ts`'s `FaceSample`/`bucketPose()` (the numbers
   you're producing and the sign convention they expect: read
   `bucketPose`'s own logic - positive pitch is "up", positive yaw is
   "left", per its `pitchDeg > 0 ? "up" : "down"` / `yawDeg > 0 ? "left"
   : "right"` branches - your function's sign convention MUST match
   this exactly, or the pose buckets silently mean the opposite of what
   the UI tells someone to do).

2. Write `estimateHeadPose(face: DetectedFace): { yawDeg: number;
   pitchDeg: number }` (or take the five points directly if that reads
   cleaner against `DetectedFace`'s actual shape - your call, but the
   function should be pure, taking coordinates in, returning degrees
   out, no session/UI state).

   **Yaw** (left/right turn): the horizontal position of the nose
   relative to the midpoint between the two eyes, normalized by the
   inter-eye distance so it works at any face size/distance from
   camera:
   ```
   eyeMidX = (rightEye.x + leftEye.x) / 2
   interEyeDist = distance(rightEye, leftEye)
   yawRatio = (nose.x - eyeMidX) / interEyeDist   // ~0 when frontal
   yawDeg = yawRatio * YAW_SCALE_DEG               // a named constant, see below
   ```
   Sign check against `bucketPose`'s convention (step 1): work out by
   hand which direction a real turn moves the nose in image
   coordinates versus which sign `bucketPose` calls "left", and get
   this right before writing tests around it - don't guess and let a
   test merely confirm whatever you wrote.

   **Pitch** (up/down tilt): the vertical position of the nose relative
   to the eye line, normalized by the eye-to-mouth vertical span (a
   proxy for face height in the image, so it's also scale-independent):
   ```
   eyeMidY = (rightEye.y + leftEye.y) / 2
   mouthMidY = (rightMouth.y + leftMouth.y) / 2
   eyeToMouth = mouthMidY - eyeMidY                // positive: mouth is below eyes, as expected
   pitchRatio = (eyeMidY - nose.y) / eyeToMouth - FRONTAL_NOSE_RATIO  // see below
   pitchDeg = pitchRatio * PITCH_SCALE_DEG
   ```
   `FRONTAL_NOSE_RATIO` is where the nose normally sits between the eye
   line and the mouth line on a frontal face (roughly a third of the
   way down in most face proportion guides - derive a specific number
   from the SFace alignment template already in this repo, since it's
   a real frontal-face reference: `faceAlign.ts`'s `TEMPLATE` constant
   gives exact frontal (x, y) positions for all five points at a fixed
   112x112 scale - compute this ratio directly from that template's own
   eye/nose/mouth y-coordinates rather than guessing a textbook
   fraction, and say in a comment that's where it came from).

   `YAW_SCALE_DEG` and `PITCH_SCALE_DEG`: pick defensible starting
   constants (a full profile turn, ratio near +-1, should land somewhere
   near 60-90 degrees; work out something in that neighborhood and
   explain your reasoning in a comment), but state explicitly in the
   file's header comment that these are uncalibrated starting values,
   the same honest framing `DEFAULT_QUALITY_CONFIG`'s own comment uses
   for its thresholds - real calibration needs a live camera and a real
   face, which only a browser session can do, not this port.

3. Tests (`headPose.test.ts`) - shape and sign, not exact calibrated
   values, since there is no oracle:
   - The SFace template's own frontal five points (import `faceAlign.ts`'s
     exported `TEMPLATE` if it's exported, or reconstruct the same
     values here as a literal - check whether `TEMPLATE` is exported;
     if not, ask whether to export it rather than duplicating the
     literal) produce `yawDeg` and `pitchDeg` both close to zero
     (`toBeCloseTo(0, ...)` with a loose tolerance - this is a
     heuristic, not exact math).
   - Shifting the nose's x-coordinate to the right (toward the
     right-eye side) produces a yaw sign matching `bucketPose`'s own
     "right" convention when fed through `bucketPose()` together - i.e.
     write one small integration-style test that constructs a clearly
     right-turned set of points, runs both `estimateHeadPose` and
     `bucketPose`, and asserts `bucketPose` returns `"right"` - this is
     the test that actually proves the sign convention is right, not
     just that some number came out.
   - Same for `"left"`, `"up"`, `"down"`.
   - A degenerate case (all five points identical, or a zero
     `interEyeDist`/`eyeToMouth`) doesn't throw or return `NaN`/`Infinity` -
     guard both divisions the same way FACE-02D's review already fixed
     an analogous zero-variance gap in `faceAlign.ts`'s
     `similarityTransform` (grep for `sourceVariance` there for the
     pattern to mirror: throw a clear `Error` naming the degenerate
     input, don't silently return garbage).

4. `docs/BACKLOG.md`: `grep -n "FACE-02D"`, add a `FACE-02E` sub-bullet
   right after it under the same FACE-02 parent item, noting this
   produces the pose numbers `enrollmentSession.ts` already consumes,
   with uncalibrated constants pending live-camera tuning, and that
   camera capture + the guided pose UI itself remain the last FACE-02
   slice.

5. Run `bun test` for `frontend/src/lib/vision/` until green.

6. Stage `frontend/src/lib/vision/headPose.ts`,
   `frontend/src/lib/vision/headPose.test.ts`, `docs/BACKLOG.md` (and
   `frontend/src/lib/vision/faceAlign.ts` ONLY if you added an export
   for `TEMPLATE` - nothing else in that file) by name. One commit.

## Acceptance evidence

- The four directional tests (left/right/up/down) each prove the sign
  convention via `bucketPose()` returning the expected pose name, not
  just an isolated number.
- The frontal-near-zero test, using the SFace template's own real
  frontal coordinates as the reference, not an invented "frontal"
  example.
- The degenerate-input guard, with a test proving it throws rather than
  returning `NaN`.
- The file's own header comment states plainly that the scale constants
  are uncalibrated starting values needing live-camera tuning - this
  is the honest state, not a gap to paper over.

## Exit checks

- `bash scripts/check.sh` (frontend-scoped), green, paste the pass line.
- Code review at `low` effort (a small, self-contained pure function
  with an already-honest "this needs real tuning" framing - not a
  security- or matching-critical path, since matching only ever uses
  the embedding, never pose).
- One commit, staged by name.
- Push `codex/face-02e`, or say you left it for the coordinator.

## Reporting

Report **ready** first, wait for "start". Report **done** with: commit
hash, `check.sh` pass line, confirmation the four directional
sign-convention tests pass, and which frontal-nose-ratio value you
derived from `faceAlign.ts`'s template and how. Report **blocked** with
the exact failure. Report **question** if `bucketPose`'s sign
convention doesn't resolve cleanly from reading its code (don't guess a
sign and hope the tests happen to agree with your own guess).
