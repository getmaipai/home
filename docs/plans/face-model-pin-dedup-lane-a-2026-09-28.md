# FACE-MODEL-DEDUP: one shared SFace pin, not two

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`.
Model floor: Codex, low reasoning is fine (mechanical extraction, no
new design judgment - the value doesn't change, only where it lives).

## Ready handshake

Before touching anything, reply with: the model named in your own
system prompt, your checkout path and branch, and "ready for
FACE-MODEL-DEDUP". Wait for "start" before editing.

## Why

A code review of FACE-02B (2026-09-28) found the SFace model's
sha256 checksum declared independently in two places for the same
physical model file (`face_recognition_sface_2021dec.onnx`):
`backend/src/lib/biometricPrints.ts`'s `KNOWN_MODELS["sface-2021dec"]`
(landed first, FACE-01) and `backend/src/lib/visionAssets.ts`'s
`VISION_FACE_EMBEDDER` (landed later, FACE-02B). Both currently read
the identical 64-hex-char value
`0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` -
verify this yourself in both files before starting, don't trust this
brief's memory of it. This is exactly the "one definition, one place"
principle (`getmaipai/CLAUDE.md`, Platform principles #4): if the
model is ever re-pinned to a newer SFace revision, updating only one
of the two locations would leave the browser downloading a model
whose hash doesn't match what the hub's own enrollment path expects,
with no compiler or test forcing the two to move together.

## Files you own

- New file: `backend/src/lib/faceModelPins.ts`
- `backend/src/lib/biometricPrints.ts` (one import line, one changed
  line inside `KNOWN_MODELS`)
- `backend/src/lib/visionAssets.ts` (one import line, one changed line
  inside `VISION_FACE_EMBEDDER`)
- `backend/tests/faceModelPins.test.ts` (new, small)

Do not touch anything else in either of those two files - this is a
pure extraction, not a rewrite. Do not touch `visionAssets.ts`'s
`VISION_FACE_DETECTOR` (the YuNet entry) - it has no counterpart
anywhere else in the codebase, so there's nothing to deduplicate there;
leave it exactly as it is.

## Steps

1. Read both files' current state (`biometricPrints.ts`'s
   `KNOWN_MODELS` constant, `visionAssets.ts`'s `VISION_FACE_EMBEDDER`
   constant) to confirm the exact current values before extracting
   them.
2. Create `backend/src/lib/faceModelPins.ts`:
   ```ts
   // The one shared pin for the SFace face-recognition model, read by
   // both the hub's enrollment validation (biometricPrints.ts) and the
   // browser's model-serving route (visionAssets.ts) - a review
   // (2026-09-28) found the same sha256 declared independently in both,
   // a "one definition, one place" violation with a real drift risk if
   // the model is ever re-pinned in only one location. Extracted here
   // instead of one importing from the other, since neither module is
   // conceptually "the owner" of the other's concern (consent
   // validation vs. serving bytes to a browser) - both are equally
   // callers of this shared fact about which model build is pinned.
   export const SFACE_MODEL_ID = "sface-2021dec";
   export const SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79";
   export const SFACE_DIM = 128;
   ```
   (Use the real value you confirmed in step 1, not the one copied into
   this brief, in case they've ever drifted since this was written -
   if they don't match, stop and report a question rather than picking
   one.)
3. In `biometricPrints.ts`: import `SFACE_MODEL_ID, SFACE_SHA256,
   SFACE_DIM` from `@/lib/faceModelPins`, and change `KNOWN_MODELS` to:
   ```ts
   const KNOWN_MODELS: Record<string, { modality: "face" | "voice"; sha256: string; dim: number }> = {
     [SFACE_MODEL_ID]: { modality: "face", sha256: SFACE_SHA256, dim: SFACE_DIM },
   };
   ```
4. In `visionAssets.ts`: import `SFACE_MODEL_ID, SFACE_SHA256` from
   `@/lib/faceModelPins`, and change `VISION_FACE_EMBEDDER` to use
   `SFACE_MODEL_ID` for its `file`'s... no - `file` is the ONNX
   filename (`face_recognition_sface_2021dec.onnx`), a different string
   from the model id (`sface-2021dec`) - do NOT conflate them. Only
   `sha256: SFACE_SHA256` changes; `file` and `url` stay as literals in
   `visionAssets.ts` (they're that module's own concern, not shared).
5. Write `backend/tests/faceModelPins.test.ts`: one test asserting
   `KNOWN_MODELS`'s sha256 (imported from `biometricPrints.ts` if it's
   exported, or asserted indirectly through a route/function that
   surfaces it - check what's actually exported first) equals
   `VISION_FACE_EMBEDDER.sha256` (imported from `visionAssets.ts`) -
   the regression test that makes a future silent re-divergence
   impossible to land without a failing test. If `KNOWN_MODELS` itself
   isn't exported from `biometricPrints.ts`, that's fine - assert
   through `SFACE_SHA256` alone being what both modules import, which
   already proves they can't diverge; note in your done report which
   approach you took and why.
6. Run `cd backend && bun test tests/faceModelPins.test.ts` until
   green, then the full backend `bun test` to confirm nothing else
   broke (especially `backend/tests/biometricPrints.test.ts` and
   `backend/tests/visionAssets.test.ts` - both exercise the values you
   just moved).
7. Stage `backend/src/lib/faceModelPins.ts`,
   `backend/src/lib/biometricPrints.ts`,
   `backend/src/lib/visionAssets.ts`,
   `backend/tests/faceModelPins.test.ts` by name (never `-A`). One
   commit.

## Acceptance evidence

- Both `biometricPrints.ts` and `visionAssets.ts` import the sha256
  from `faceModelPins.ts` - no literal `0ba9fbfa...` hex string
  remains anywhere except inside `faceModelPins.ts` itself (`grep -rn
  "0ba9fbfa" backend/src` should return exactly one match, in the new
  file).
- The new regression test passes and would fail if either file's
  import were reverted to a literal (verify this yourself: temporarily
  hardcode a different, wrong 64-hex string back into one of the two
  files, confirm the new test fails, then restore the real fix - the
  same "verify a fix genuinely catches its regression" discipline this
  codebase uses everywhere, per `getmaipai/CLAUDE.md`'s Problem Solving
  section).
- `backend/tests/biometricPrints.test.ts` and
  `backend/tests/visionAssets.test.ts` both still pass unchanged (paste
  both summary lines).

## Exit checks

- `bash scripts/check.sh` from the `home-codex` worktree root, green
  (paste the pass line and the scope it picked).
- Code review at `low` effort (pure extraction, no route, no guard, no
  wire-shape change).
- One commit. Stage by name.
- Push `home-codex`'s branch, or say you left it for the coordinator to
  merge.

## Reporting

Report **ready** first and wait for "start". Report **done** with: the
commit hash, the `check.sh` pass line and scope, the grep confirming
exactly one literal-hash occurrence remains, and confirmation the
revert-and-confirm-failure check was actually done (not just claimed).
Report **blocked** with the exact failing assertion or error. Report
**question** if the two files' current sha256 values don't actually
match when you check them (this brief assumes they do, based on an
earlier read - if reality disagrees, that's a real finding, not
something to silently resolve by picking one).
