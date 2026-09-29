# FACE-02D: browser-side ONNX wiring for YuNet detect + SFace embed

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`.
Model floor: Codex, `low`-to-`medium` (mechanical rename plus two new
preprocessing modules mirroring an already-verified Python contract
line-for-line - no new algorithm design, everything below is read
directly from real source, not guessed).

## Ready handshake

Before touching anything, reply with: the model named in your own
system prompt, your checkout path and branch, and "ready for FACE-02D".
Wait for "start" before editing.

Start from a fresh branch cut from your own current HEAD (`8360f975`,
FACE-02C's own commit - do not fetch/merge `origin/main` first, since
FACE-02C is not yet merged there and your worktree already has the
`faceDetect.ts`/`faceAlign.ts` files this item wires up):

```
git checkout -b codex/face-02d
```

## Why

FACE-02C (just landed in this worktree) gave us pure, framework-free
TypeScript functions: `decodeYunetOutputs` (`faceDetect.ts`) turns raw
YuNet output tensors into boxes + five landmarks, and
`similarityTransform`/`alignCrop` (`faceAlign.ts`) warp a frame into
SFace's 112x112 crop. Neither one runs an ONNX session or knows where
the model files come from - that's this item. FACE-02B already built
the backend half: `GET /api/vision/model/:file` serves the two model
files (`backend/src/routes/vision.ts`, mounted at `/api/vision` in
`backend/src/app.ts:173`), matching `GET /api/voice/wakeword/:file`'s
existing pattern exactly.

The browser already has a working lazy ONNX-session loader:
`frontend/src/lib/voice/wake-word-runtime.ts`'s `getOrLoadSession(modelPath)`
/ `tensorFor()` - it is not actually wake-word-specific despite its
name and file location (its types take any model path string and any
tensor shape; `wake-word-pipeline.ts:44-51` calls it for three
unrelated models already). Per the org's "one definition, one
implementation" rule, vision reuses this loader rather than getting a
second copy - but importing a type named `WakeWordInferenceSession`
into face-recognition code would misname what it actually is, so this
item relocates the module first, then builds vision's own session
wiring on top of the relocated one.

## Files you own

- `frontend/src/lib/vision/faceAlign.ts` - one narrow addition only
  (see Steps, step 0). Do not otherwise touch this file or its test.
- `frontend/src/lib/voice/wake-word-runtime.ts` -> move to
  `frontend/src/lib/onnx/session-runtime.ts` (`git mv`), renaming only
  the exported type names that say "WakeWord" when they mean "any ONNX
  session" (`WakeWordInferenceSession` -> `OnnxInferenceSession`,
  `WakeWordTensor` -> `OnnxTensor`). Do not touch the actual logic,
  the `bundledWasmPaths` production/dev split, or its comments' content
  beyond updating names the rename touches.
- `frontend/src/lib/voice/wake-word-runtime.test.ts` -> move alongside
  it to `frontend/src/lib/onnx/session-runtime.test.ts`, same renames.
- `frontend/src/lib/voice/wake-word-loop.ts`,
  `frontend/src/lib/voice/wake-word-pipeline.ts` - update their two
  imports each to the new path and type names. Nothing else in these
  files changes.
- `frontend/src/lib/vision/faceModels.ts` (NEW) - the two model
  entries, mirroring `wake-word-models.ts`'s `WAKE_WORD_ASSET_BASE`
  pattern exactly:
  ```ts
  export const VISION_ASSET_BASE = "/api/vision/model";
  export const YUNET_PATH = `${VISION_ASSET_BASE}/face_detection_yunet_2026may.onnx`;
  export const SFACE_PATH = `${VISION_ASSET_BASE}/face_recognition_sface_2021dec.onnx`;
  ```
  (file names must match `backend/src/lib/visionAssets.ts`'s own
  `file` fields exactly - read that file to confirm, don't retype from
  memory.)
- `frontend/src/lib/vision/faceDetectRuntime.ts` (NEW) - see Steps.
- `frontend/src/lib/vision/faceDetectRuntime.test.ts` (NEW).
- `frontend/src/lib/vision/faceEmbedRuntime.ts` (NEW) - see Steps.
- `frontend/src/lib/vision/faceEmbedRuntime.test.ts` (NEW).
- `docs/BACKLOG.md` (tick FACE-02D, see step 6).

Do not touch `faceDetect.ts`, `faceAlign.ts`, or their tests (FACE-02C,
already landed and correct) - this item calls their exported functions,
it does not change them. Do not touch camera capture or any UI - that
remains a separate later FACE-02 slice.

## Steps

0. Independent review of FACE-02C (already merged to `main` as of this
   writing) found a real gap worth closing before this item builds on
   top of it: `similarityTransform` (`faceAlign.ts`) has no guard
   against `sourceVariance === 0` (all 5 input points identical, or a
   degenerate collinear case) - it silently produces NaN/Infinity that
   propagates through `alignCrop` into a garbage 112x112 crop fed to
   the SFace embedder as if it were a valid face, no error anywhere.
   This item is exactly the layer that will feed real (sometimes bad)
   detections into these functions, so fix it first: if `sourceVariance`
   is `0` (or non-finite), throw a clear `Error` naming what happened
   (degenerate/collinear input points) instead of returning a matrix
   with NaN/Infinity entries. Add one test in `faceAlign.test.ts`
   asserting this throws for 5 identical points. This is the one
   exception to "do not touch `faceDetect.ts`/`faceAlign.ts`" below -
   everything else in FACE-02C stays as landed.
1. Read `frontend/src/lib/voice/wake-word-runtime.ts` in full, and
   `wake-word-pipeline.ts:1-52` for how it's consumed, before moving
   anything.
2. `git mv` the runtime file and its test to `frontend/src/lib/onnx/`,
   rename the two exported types (`WakeWordInferenceSession` ->
   `OnnxInferenceSession`, `WakeWordTensor` -> `OnnxTensor`) everywhere
   they're referenced (the moved files, `wake-word-loop.ts`,
   `wake-word-pipeline.ts`). Run `bun test` for the voice directory to
   confirm nothing broke from the rename before moving on.
3. Read `bot/body/.venv/lib/python3.12/site-packages/reachy_mini/vision/face_detector.py`'s
   `FaceDetector.detect()` (lines 80-94) for the exact YuNet input
   contract - this is the real installed vendored source, already read
   once for this brief, cite it in your own commit rather than
   re-deriving it: BGR frame, pad up to a multiple of 32 on height and
   width (origin unchanged, zero-fill), `transpose(2,0,1)` to CHW,
   `astype(float32)` with **no scaling** (raw 0-255 values, not
   divided by 255), add a batch dim (NCHW), single input tensor named
   by `session.get_inputs()[0].name` (don't hardcode a name - read it
   from the session's own metadata at runtime, exactly like the Python
   does). Outputs are named `cls_{stride}`, `obj_{stride}`,
   `bbox_{stride}`, `kps_{stride}` for strides 8/16/32 - already
   `decodeYunetOutputs`'s own input shape from FACE-02C, read that
   function's signature to match it exactly.
   Write `frontend/src/lib/vision/faceDetectRuntime.ts`:
   - `padToStride(frameRgba: Uint8ClampedArray, width: number, height: number, stride = 32): { padded: Uint8ClampedArray, paddedWidth: number, paddedHeight: number }` -
     zero-pads an RGBA buffer up to the next multiple of `stride` (keep
     RGBA in this module; note in a comment that channel order is
     handled by the caller/`toNchwBlob`, not here).
   - `toNchwBlob(paddedRgba: Uint8ClampedArray, width: number, height: number): Float32Array` -
     drops the alpha channel, reorders RGBA -> BGR (browser
     `ImageData`/canvas frames are RGBA; the vendored detector expects
     BGR - confirm this against `align.py`'s own docstring, which
     already states the daemon's frames are BGR by convention; if a
     browser `getUserMedia`/canvas frame is natively RGBA and the
     legacy contract is BGR, this function is the one place that
     conversion happens, name it in a comment), then to CHW, no
     scaling - matching `detect()` line for line.
   - `runYunetDetection(session: OnnxInferenceSession, frameRgba: Uint8ClampedArray, width: number, height: number, scoreThreshold: number, nmsThreshold: number): Promise<ReturnType<typeof decodeYunetOutputs>>` -
     pads, blobs, calls `tensorFor()` (from the relocated
     `onnx/session-runtime.ts`) then `session.run()` with the single
     input tensor (get the input tensor's name from... the session
     interface has no `get_inputs()` equivalent today; since
     `OnnxInferenceSession.run()` takes a `Record<string, OnnxTensor>`
     keyed by name already, and this repo's ONNX sessions are always
     invoked by name today - check `wake-word-pipeline.ts`'s own
     `.run()` call sites for how they name their feed keys, and if none
     of them read a name from the session dynamically, ask a
     **question** rather than guessing a literal input name; do not
     hardcode a name you have not confirmed against the actual YuNet
     ONNX model's real input name, since a mismatch just silently fails
     Overwatch ort's own key-not-found error, which the acceptance
     tests below cannot catch without a real model file), passes the
     result to `decodeYunetOutputs(outputs, paddedWidth, scoreThreshold, nmsThreshold)`
     and returns it.
4. Read `bot/body/maipai_body/vision/embed.py` in full (`_to_blob`,
   `SFaceEmbedder.embed`) - the SFace input contract: a 112x112x3
   aligned crop (from `alignCrop`, FACE-02C), BGR -> RGB (`swapRB`,
   the reverse direction of the detector's own BGR conversion - read
   this carefully, it is the opposite swap from step 3's, confirm you
   have the direction right against the docstring's own explanation
   before writing code, this exact kind of silent-degrade mistake is
   what that docstring is warning about), HWC -> CHW, no scaling
   (again raw 0-255), NCHW, single input/output by name.
   Write `frontend/src/lib/vision/faceEmbedRuntime.ts`:
   - `toEmbedBlob(alignedRgba: Uint8ClampedArray): Float32Array` -
     `alignCrop`'s own output is RGBA (see its return type in
     `faceAlign.ts`); convert to the network's expected channel order
     and layout exactly as `_to_blob` does, adjusted for the RGBA ->
     (whatever `_to_blob` expects) starting point instead of Python's
     BGR starting point - work out the net channel order from
     composing `alignCrop`'s RGBA output with `_to_blob`'s BGR ->
     RGB swap, state the resulting order in a comment, do not just
     copy `_to_blob`'s swap blindly onto a differently-ordered input.
   - `runSfaceEmbedding(session: OnnxInferenceSession, alignedRgba: Uint8ClampedArray): Promise<Float32Array>` -
     blobs, runs, returns the 128-d output array.
5. Tests (mirror `wake-word-runtime.test.ts`'s own style for injecting
   a fake session/factory instead of a real onnxruntime-web runtime -
   happy-dom has no WASM ONNX backend, same reason that file's tests
   don't use a real one either):
   - `padToStride`: a non-multiple-of-32 frame pads correctly, origin
     pixels preserved, new region zero.
   - `toNchwBlob`: a small known RGBA frame produces the exact expected
     Float32Array (hand-compute one small case, e.g. 2x2, by hand in
     the test comment so a reviewer can check your arithmetic without
     running anything).
   - `runYunetDetection`/`runSfaceEmbedding`: inject a fake
     `OnnxInferenceSession` whose `run()` returns fixed tensors, assert
     the blob it was called with matches an expected value and that
     the function's return value matches decoding that fixed output
     (for detection, this can literally reuse a fixture from
     `faceDetect.test.ts` - import it or recreate it, your call).
   - `toEmbedBlob`: same hand-computed-small-case treatment as
     `toNchwBlob`.
6. `grep -n "FACE-02" docs/BACKLOG.md` and add a `FACE-02D` sub-bullet
   under the existing FACE-02 item, matching FACE-02A/02B/02C's own
   convention, noting camera capture + guided pose UI still remain.
7. Run `bun test` for the whole `frontend/src/lib/vision/` and
   `frontend/src/lib/onnx/` and `frontend/src/lib/voice/` directories
   until green.
8. Stage every file by name (never `-A`). One commit.

## Acceptance evidence

- Every new pure function (`padToStride`, `toNchwBlob`,
  `runYunetDetection`'s decode wiring, `toEmbedBlob`) has a test with a
  hand-computed expected value, not just "it doesn't throw".
- The channel-order reasoning for both conversions (RGBA frame -> BGR
  blob for detection; RGBA aligned crop -> whatever `_to_blob` expects
  for embedding) is stated explicitly in a comment near each function,
  since this is the exact class of mistake the Python docstring warns
  never crashes, only silently degrades matches.
- The wake-word rename: `bun test` for `frontend/src/lib/voice/` and
  `frontend/src/lib/onnx/` still green, proving the relocation broke
  nothing.

## Exit checks

- `bash scripts/check.sh` (or the frontend-scoped equivalent this repo
  uses - check `docs/BACKLOG.md`/`CLAUDE.md` for the exact command),
  green, paste the pass line and scope.
- Code review at `medium` effort (new numeric preprocessing code whose
  correctness is invisible without a hand-checked test - the class of
  bug the org's review process exists for).
- One commit, staged by name.
- Push `codex/face-02d`, or say you left it for the coordinator.

## Reporting

Report **ready** first, wait for "start". Report **done** with: commit
hash, `check.sh` pass line, confirmation every function above has a
hand-computed test, and which direction you resolved each channel-swap
in (state both explicitly, RGBA-to-what for detection and RGBA-to-what
for embedding) so it can be double-checked against the Python source
without re-reading your diff from scratch. Report **blocked** with the
exact failure. Report **question** if you cannot confirm the YuNet
ONNX model's real input tensor name without guessing (see step 3) -
this is exactly the kind of thing this brief told you not to invent.
