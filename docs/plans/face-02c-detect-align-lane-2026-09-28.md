# FACE-02C: port face detection decode + SFace alignment to TypeScript

Lane: whichever of codex-a/codex-b frees up next in the `home` repo
(worktree `home-codex` or `home-codex-2` - either is fine, this item
has no dependency on FACE-MODEL-DEDUP or FACE-04, which are in
different files). Model floor: Codex, `medium` reasoning - this is a
precise numerical port with a real, run-it-yourself verification
oracle (below), not free-form design, but the math (a similarity
transform, a bilinear warp) is easy to get subtly wrong, so don't rush
the verification step.

## Ready handshake

Before touching anything, reply with: the model named in your own
system prompt, your checkout path and branch, and "ready for
FACE-02C". Wait for "start" before editing.

## Why

FACE-02's browser capture flow needs two more pieces before it can
feed a real face crop to SFace: turning YuNet's raw multi-stride ONNX
output into a face's five landmark points (detection), and warping
those five points onto SFace's own fixed alignment template to produce
the 112x112 crop SFace actually expects (alignment). Both algorithms
already exist, working and tested, in Python, in the **`bot` repo**
(a sibling checkout at `~/Developer/github.com/getmaipai/bot`, not this
one - you'll read from it but never edit it):
`body/maipai_body/vision/detect.py` (`FiveLandmarkDetector`, ~100
lines) and `body/maipai_body/vision/align.py` (`similarity_transform`
+ `align_crop`, ~115 lines). Read both in full before writing anything.

**The verification approach, not a hand-derived formula**: the
alignment math (`similarity_transform`) uses a 2x2 SVD as one step,
which is easy to get a sign or branch wrong on without a rigorous
derivation. Rather than trusting a translated formula on faith, verify
your TypeScript port by running the REAL Python function
(`uv run python3` from `~/Developer/github.com/getmaipai/bot/body`,
that repo already has its own `.venv` with `numpy` installed - `uv
sync` there first if it's stale) against a handful of concrete test
cases (a few hand-picked and a few random 5-point sets), printing its
output matrices, and asserting your TypeScript port produces matching
values (within float tolerance) for the identical inputs. This is the
actual acceptance bar for `similarity_transform` and `align_crop`, not
"the code looks like a faithful translation."

## Files you own

- New file: `frontend/src/lib/vision/faceDetect.ts` (the detection
  decode)
- New file: `frontend/src/lib/vision/faceAlign.ts` (the alignment /
  warp)
- New file: `frontend/src/lib/vision/faceDetect.test.ts`
- New file: `frontend/src/lib/vision/faceAlign.test.ts`
- `docs/BACKLOG.md` (one line, see step 7)

Do not touch anything in `frontend/src/lib/vision/enrollmentSession.ts`
(FACE-02A, already landed - a separate, unrelated module) or
`backend/` (no backend change needed for this item). Do not edit
anything in the `bot` repo - it's read-only reference here.

## Part 1: detection decode (`faceDetect.ts`)

Port `FiveLandmarkDetector`'s actual behavior - not the class
hierarchy (there's no vendored `FaceDetector` base class to subclass
in TypeScript; write one self-contained function) - as a pure function
operating on already-run ONNX output tensors, matching this signature
shape:

```ts
export interface DetectedFace {
  bbox: [x: number, y: number, width: number, height: number];
  rightEye: [number, number];
  leftEye: [number, number];
  nose: [number, number];
  rightMouth: [number, number];
  leftMouth: [number, number];
}

export function decodeYunetOutputs(
  outputs: Record<string, Float32Array>, // keys: cls_8/16/32, obj_8/16/32, bbox_8/16/32, kps_8/16/32
  paddedWidth: number,
  scoreThreshold: number,
  nmsThreshold: number,
): DetectedFace[]
```

Read `body/maipai_body/vision/detect.py`'s `_decode` AND its base
class's own `detect()`/`_nms()` (`reachy_mini.vision.face_detector` -
find its installed location with `python3 -c "import reachy_mini.
vision.face_detector as m; print(m.__file__)"` from the `bot/body`
venv, per that repo's own `AGENTS.md`) for the full algorithm: for each
stride in `(8, 16, 32)`, compute `score = sqrt(clip(cls,0,1) *
clip(obj,0,1))`, filter by `scoreThreshold`, decode `cx/cy/w/h` from
the anchor grid position and `bbox` regression values (`cols = width /
stride`, `col = idx % cols`, `row = idx / cols` (integer division),
`cx = (col + bbox[0]) * stride`, etc. - read the exact formula
yourself, don't trust this paraphrase), decode the five keypoints the
same way FACE-01's own `FiveLandmarkDetector._decode` already does
(right eye, left eye, nose, right mouth, left mouth - `kps` indices
0-1/2-3/4-5/6-7/8-9), then run greedy IoU non-max suppression
(`_nms` in the vendored file) across all candidates from all three
strides together, keeping highest-score-first.

**No ONNX inference happens in this module** - it takes already-decoded
output tensors (what `session.run(...)` would return) and does pure
array math. This keeps it testable with hand-constructed fake tensors,
no onnxruntime-web involved at all here.

### Tests (`faceDetect.test.ts`)

Construct small synthetic output tensors by hand (a single stride's
worth of anchors is enough for most cases - you don't need all three
stride sizes fully populated for every test) covering: a single clear
detection above threshold decodes to a `DetectedFace` with correct
bbox/landmark math you compute by hand for that specific input and
assert exactly; a detection below `scoreThreshold` is filtered out; two
overlapping high-score boxes reduce to one via NMS; multiple
non-overlapping detections across different strides all survive.

## Part 2: alignment (`faceAlign.ts`)

Port `similarity_transform` (the 2x2 Umeyama SVD-based similarity
transform) and `align_crop` (the bilinear warp using it) from
`body/maipai_body/vision/align.py`, line for line in behavior (not
Python syntax). Signature shape:

```ts
export function similarityTransform(points: [number, number][]): number[][]; // 2x3

export function alignCrop(
  frameRgba: Uint8ClampedArray, // from a canvas ImageData, RGBA, row-major
  frameWidth: number,
  frameHeight: number,
  fivePoints: [number, number][],
): Uint8ClampedArray; // 112*112*4 RGBA (or your own choice of channel count - state which and why)
```

The Python version operates on BGR (OpenCV's native order); the
browser's `ImageData`/canvas pipeline is RGBA. Don't silently
transpose channels incorrectly - decide explicitly whether this
function takes RGB(A) and keep the alignment math (which only touches
x/y pixel coordinates, never channel values, except in the bilinear
blend itself) channel-order-agnostic, documented in a comment. The
`_TEMPLATE`/`_TEMPLATE_MEAN` constants are exact literals - copy them
verbatim, they're already correct by construction (OpenCV's own
values), not something to recompute.

### Verification (do this before writing the test file, not after)

From `~/Developer/github.com/getmaipai/bot/body`, write a small
throwaway Python script (not committed anywhere, delete it when done)
that calls `similarity_transform` and `align_crop` from `maipai_body.
vision.align` on a handful of concrete 5-point inputs (at least: the
exact template points themselves as input, which should produce an
identity-like transform; a translated set; a rotated set; two or three
random sets), printing the resulting 2x3 matrix and/or a few sampled
output pixels. Run your TypeScript port on the identical inputs
(`bun run` a small script, or drive it through `bun test` directly) and
confirm the numbers match within a small float tolerance (1e-6 for the
matrix, allow rounding differences up to 1 in pixel values from the
bilinear blend). Only once this cross-check passes do you write the
permanent `faceAlign.test.ts` - encode a few of the SAME verified
input/output pairs as fixed-value assertions (hardcoded expected
numbers, not "close to Python" - the Python run was your one-time
derivation of the ground truth, the committed test is a pure regression
guard against those now-known-correct numbers).

### Tests (`faceAlign.test.ts`)

At minimum: `similarityTransform` on the template's own five points
returns (very close to) the identity transform (scale 1, no rotation,
zero translation); a known rotated/translated point set produces the
matrix you verified against Python, asserted to the same numbers;
`alignCrop` on a simple synthetic frame (e.g., a small solid-color
image, or one with a distinct marker pixel at a known location) warps
it to the expected 112x112 output you verified against Python.

## Steps

1. Read both Python files in full, and the vendored `FaceDetector`
   base class's `_decode`/`_nms`/`detect` methods (find the installed
   path as described above).
2. Write `faceDetect.ts` + `faceDetect.test.ts` (Part 1).
3. Write the throwaway Python verification script, run it, record its
   output.
4. Write `faceAlign.ts`, checking your TS output against the Python
   verification script's output as you go (Part 2).
5. Write `faceAlign.test.ts` encoding the now-verified numbers as fixed
   assertions. Delete the throwaway Python script (it was for your own
   derivation, not a permanent fixture).
6. Run `cd frontend && bun test src/lib/vision/faceDetect.test.ts
   src/lib/vision/faceAlign.test.ts` until green, then the full
   frontend `bun test`.
7. Add one line to `home/docs/BACKLOG.md` noting FACE-02C landed as a
   sub-note under the existing `FACE-02` line (same convention
   FACE-02A/FACE-02B's own sub-notes already use - read one of those
   first and match its exact shape).
8. Stage the four new files and `docs/BACKLOG.md` by name (never `-A`).
   One commit.

## Acceptance evidence

- Both test files passing (paste the `bun test` summary lines).
- The Python-vs-TypeScript cross-check you ran for `faceAlign.ts` -
  paste the actual numbers from both sides for at least two of the test
  cases (not just "they matched").
- Full frontend `bun test` still green.
- No onnxruntime-web import, no `fetch`, no `getUserMedia` anywhere in
  either new module (`grep -n "onnxruntime-web\|fetch(\|getUserMedia"
  frontend/src/lib/vision/faceDetect.ts frontend/src/lib/vision/
  faceAlign.ts` returns nothing) - both are pure math operating on
  already-provided data, same discipline FACE-02A's own module used.

## Exit checks

- `bash scripts/check.sh` from your worktree root, green (paste the
  pass line and scope).
- Code review at `low` effort (pure ported math, no route, no guard,
  no wire shape, no UI).
- One commit. Stage by name.
- Push your branch, or say you left it for the coordinator to merge.

## Reporting

Report **ready** first and wait for "start". Report **done** with: the
commit hash, the `check.sh` pass line and scope, both test summary
lines, and the actual Python-vs-TypeScript verification numbers you
recorded. Report **blocked** with the exact failing assertion, error,
or a specific numerical mismatch between your TS port and the Python
oracle (paste both values - this is exactly the kind of subtle bug this
verification step exists to catch, so a mismatch here is real signal,
not noise to work around). Report **question** if the vendored
`FaceDetector` base class's installed location can't be found, or if
`bot/body`'s own `.venv` doesn't have what's needed and `uv sync`
doesn't fix it cleanly.
