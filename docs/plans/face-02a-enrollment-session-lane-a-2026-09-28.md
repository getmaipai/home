# FACE-02A: port the enrollment coverage/quality logic (pure, no UI, no ONNX)

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`.
Model floor: Codex, low reasoning is fine (mechanical port of an
already-designed, already-tested algorithm; no new design judgment).

## Ready handshake

Before touching anything, reply with: the model named in your own
system prompt, your checkout path and branch, and "ready for
FACE-02A". Wait for "start" before editing.

## Why

FACE-01 (landed today, commit `ac1c9aad`) built the hub's biometric
print store and `/api/biometric-prints` API. FACE-02 is the browser
capture UI that fills it: an iOS-Face-ID-style guided flow (look
straight, turn left, turn right, tip up, tip down) that only accepts
a sample when it's actually a good one (sharp, well-lit, at the right
angle), then POSTs the accepted samples to the API FACE-01 built.

That whole flow's hardest-won logic - which angle bucket a head pose
falls into, whether a frame is good enough to accept, when enrollment
is complete, what to tell the person to do next - already exists,
already works, and is already tested: `perception/enroll.py` in the
robot's pre-rebuild code (`EnrollmentSession`, `QualityConfig`,
`bucket_pose`, `assess_quality`, `FaceGallery`). This item ports that
logic to TypeScript, unchanged in behavior, with no camera and no ONNX
involved at all - it operates on numbers (yaw, pitch, box size,
sharpness, brightness) that a later item (FACE-02B, a different lane)
will compute from a real camera frame. You are building the decision
logic only, proven against the same inputs/outputs the Python version
already proves itself against.

Read the source once before starting:
```
cd ~/Developer/github.com/getmaipai
git --git-dir=legacy-backups/bot-legacy.git show HEAD:robot/robot/perception/enroll.py
```
That's the whole file (385 lines) you're porting from. It is
reference-only per org policy (`getmaipai/CLAUDE.md`, "Third-party code
and assets" / "Legacy: copy, re-examine, record") - rebuild the logic
in idiomatic TypeScript, do not attempt a line-for-line transliteration
of Python syntax, but every threshold, bucket rule, and piece of
behavior it encodes must carry over exactly (this is a port of a
decided algorithm, not a redesign).

## Files you own

- New file: `frontend/src/lib/vision/enrollmentSession.ts`
- New file: `frontend/src/lib/vision/enrollmentSession.test.ts`
- `docs/BACKLOG.md` (one line, see step 5)

Do not touch anything under `frontend/src/lib/voice/` (a different,
unrelated pipeline you'll read for pattern only, not edit) or
`backend/` (FACE-02B, a different lane running in parallel in
`home-codex-2`, owns the new backend routes - nothing here calls them
or needs them).

## What to port, concretely

The Python file has two halves; port both into one new file,
`frontend/src/lib/vision/enrollmentSession.ts`:

**Half 1 - coverage and quality** (`QualityConfig`, `EnrollmentSpec`,
`FaceSample`, `bucket_pose`, `assess_quality`, `is_solid`,
`OfferResult`, `BucketStatus`, `PersonStatus`, `EnrollmentSession`):

- `POSES` stays a fixed tuple/array of the same five strings in the
  same order: `"frontal"`, `"left"`, `"right"`, `"up"`, `"down"`.
- `QualityConfig` becomes a TS interface (or a `type`) with the same
  fields and the same default values (`minBoxFrac: 0.10`,
  `minSharpness: 40.0`, `minBrightness: 40.0`, `maxBrightness: 220.0`,
  `frontalMaxYaw: 12.0`, `turnMinYaw: 18.0`, `updownMinPitch: 15.0`,
  `solidSharpness: 90.0`, `solidBoxFrac: 0.14`) - camelCase field names
  (this codebase's convention, confirm by reading a nearby file like
  `frontend/src/lib/voice/wake-word-models.ts`), Python's snake_case
  names are not carried over.
- `EnrollmentSpec`: `shotsPerPose: number` (default 2), `wearsGlasses:
  boolean` (default false), `glassesShots: number` (default 2),
  `quality: QualityConfig` (default the config above). FACE-02's own
  acceptance is a five-pose enrollment with no glasses branch exercised
  - keep the glasses fields and logic (don't drop them, they're part of
  the ported algorithm and may be wired up later), but they are not
  this item's own acceptance target.
- `FaceSample`: `embedding: number[]`, `yawDeg: number` (default 0),
  `pitchDeg: number` (default 0), `boxFrac: number` (default 0),
  `sharpness: number` (default 0), `brightness: number` (default 128),
  `glasses: boolean | null` (default null).
- `bucketPose(yawDeg, pitchDeg, cfg): string | null` - port the exact
  branch order and thresholds from `bucket_pose` (pitch check first,
  then frontal, then turn, else `null` for an in-between angle).
- `assessQuality(sample, cfg): [boolean, string]` (or a small tagged
  object `{ ok: boolean; reason: string }` - your call, pick whichever
  this codebase's own style favors more, check a nearby function with
  a similar "ok or why not" return shape first) - same four checks,
  same order, same reason strings (`"too_far"`, `"blurry"`,
  `"too_dark"`, `"too_bright"`, `"ok"`).
- `isSolid(sample, cfg): boolean` - same two-condition check.
- `OfferResult`, `BucketStatus`, `PersonStatus` - same fields,
  camelCase.
- `EnrollmentSession` class: same constructor shape (`name: string,
  spec?: EnrollmentSpec, source?: string`, source defaulting to
  `"in_person"`), same public methods (`offer(sample): OfferResult`,
  `embeddings(): number[][]`, `status(): PersonStatus`), same private
  bookkeeping and the same bucket-full / between-angles / bucket-needs
  rejection logic `offer()` encodes. `_POSE_PROMPT`'s five prompt
  strings carry over verbatim (they're what a real person reads on
  screen - don't reword them).

**Half 2 - the gallery** (`cosine`, `Match`, `FaceGallery`): port
`cosine(a, b): number`, the `Match` type (`name: string | null, score:
number, margin: number`), and `FaceGallery` (`enroll`, `names`,
`status`, `statuses`, `remove`, `identify`) the same way - same
threshold default (0.36 - note this differs from FACE-01's own
`sface-2021dec` `threshold: 0.363` in `home`'s `lib/biometricPrints.ts`
and `bot`'s `vision/gallery.py`; keep the ported default at 0.36
matching the legacy file exactly, since this port's job is behavioral
fidelity to what it's copying, not silently reconciling it with a
different threshold decided elsewhere for a different reason - name
this discrepancy in your done report, don't resolve it, it isn't this
item's call to make).

Do not build a browser-side `FaceGallery` UI or wire this to any
route - this item is the pure module and its tests only. Nothing here
imports `onnxruntime-web`, touches a camera, or calls `fetch`.

## Tests

`frontend/src/lib/vision/enrollmentSession.test.ts`, `bun:test`
(`import { describe, expect, test } from "bun:test"` - this codebase's
own convention, confirm against `wake-word-models.test.ts`). Cover, at
minimum, one test per case below - each is a real behavior a person or
a future caller depends on, not a restatement of the code:

- `bucketPose`: a near-zero yaw/pitch buckets as `"frontal"`; a yaw
  past `turnMinYaw` in each direction buckets `"left"`/`"right"`; a
  pitch past `updownMinPitch` in each direction buckets `"up"`/`"down"`
  (and pitch wins over yaw when both thresholds are crossed at once,
  matching the Python function's own check order); an angle strictly
  between `frontalMaxYaw` and `turnMinYaw` returns `null`.
- `assessQuality`: each of the four rejection reasons fires on its own
  threshold boundary (a sample just under `minBoxFrac` -> `"too_far"`,
  etc.), and a sample clearing all four returns `ok: true`/`"ok"`.
- `EnrollmentSession.offer()`: a full five-pose enrollment (one good
  sample per bucket, `shotsPerPose: 1` for a fast test) reaches
  `complete: true` on the fifth accepted sample and `false` before it;
  an out-of-range sample (fails `assessQuality`) is rejected without
  affecting any bucket's count; a between-angles sample (`bucketPose`
  returns `null`) is rejected with reason `"between_angles"`; offering
  a sample to an already-full bucket is rejected with `"bucket_full"`
  without incrementing anything further; `status()` reports the right
  `coveragePct`, `needs`, and `retake` lists as buckets fill (a bucket
  whose accepted frames are all below the "solid" bars but above the
  accept bars shows up in `retake`, per `isSolid`).
- `FaceGallery.identify()`: a probe embedding closest to one enrolled
  person's stored embedding (by cosine) returns that person's name
  when the score clears the default threshold; a probe below threshold
  returns `name: null` with the real (not zeroed) score; the `margin`
  field reflects the gap to the second-best person, not a second angle
  of the same person (mirror the Python docstring's own reasoning: best
  score is taken per person first, then the top two people are
  compared).

## Steps

1. Read the legacy file (command above).
2. Read `frontend/src/lib/voice/wake-word-models.ts` and
   `wake-word-models.test.ts` once for this codebase's own style
   conventions (naming, export shape, `bun:test` structure) - your port
   should read like it was written for this repo, not transliterated.
3. Write `frontend/src/lib/vision/enrollmentSession.ts`.
4. Write `frontend/src/lib/vision/enrollmentSession.test.ts` covering
   every case listed above.
5. Add one line to `home/docs/BACKLOG.md` noting FACE-02A landed
   (search for the existing `FACE-02` line first -
   `grep -n "FACE-02" docs/BACKLOG.md` - and add your line as a
   sub-note under it rather than duplicating the parent item; don't
   mark the parent `FACE-02` line itself done, since FACE-02B and the
   real UI wiring are separate, not-yet-landed lanes).
6. Run `cd frontend && bun test src/lib/vision/enrollmentSession.test.ts`
   until green, then the full `bun test` in `frontend/` to confirm
   nothing else broke.
7. Stage `frontend/src/lib/vision/enrollmentSession.ts`,
   `frontend/src/lib/vision/enrollmentSession.test.ts`, and
   `docs/BACKLOG.md` by name (never `-A`). One commit.

## Acceptance evidence

- The full test list above, passing (paste the `bun test` summary
  line for the new file).
- `frontend`'s full `bun test` still green (paste the summary line) -
  confirms nothing in the new file collides with an existing module.
- No import of `onnxruntime-web`, no `fetch`/`XMLHttpRequest`, no
  camera/`getUserMedia` call anywhere in the new file (`grep -n
  "onnxruntime-web\|fetch(\|getUserMedia" frontend/src/lib/vision/
  enrollmentSession.ts` returns nothing) - this item is pure logic,
  confirmed by grep, not by description.

## Exit checks

- `bash scripts/check.sh` from the `home-codex` worktree root, green
  (paste the pass line; this is a frontend-only diff by the scoped-gate
  rule, so it should run the frontend leg, not the full suite - say
  what scope it picked).
- Code review at `low` effort on your diff (a new pure-logic module and
  its tests, no route, no guard, no wire shape).
- One commit (code + tests + docs together). Stage by name.
- Push `home-codex`'s branch, or say you left it for the coordinator to
  merge.

## Reporting

Report **ready** first and wait for "start". Report **done** with: the
commit hash, the `check.sh` pass line and which scope it picked, the
`bun test` summary lines for both the new file and the full frontend
suite, and the one discrepancy to flag (the 0.36 vs 0.363 threshold
default, per "Half 2" above) rather than silently resolving it. Report
**blocked** with the exact failing assertion or error. Report
**question** if anything in the legacy file's behavior is genuinely
ambiguous once you're reading it directly (not guessed from this
brief) - name the exact line and what's unclear.
