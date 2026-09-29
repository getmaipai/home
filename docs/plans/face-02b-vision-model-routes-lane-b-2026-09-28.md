# FACE-02B: serve the browser's face-detection and face-embedding models

Lane: codex-b, worktree `~/Developer/github.com/getmaipai/home-codex-2`.
Model floor: Codex, low reasoning is fine (this is a mechanical mirror
of an existing, working route pair - every value below is already
decided and independently verified).

## Ready handshake

Before touching anything, reply with: the model named in your own
system prompt, your checkout path and branch, and "ready for
FACE-02B". Wait for "start" before editing.

## Why

FACE-02 (the browser enrollment capture UI, `docs/BACKLOG.md`) needs
two ONNX models running client-side via `onnxruntime-web` (already a
frontend dependency): a face detector (to find the face, its box, and
five landmark points in a video frame) and SFace (to turn an aligned
crop into the 128-d embedding FACE-01's `/api/biometric-prints` API
expects). This item serves those two model files to the browser, the
exact same shape `routes/voice.ts` + `lib/wakewordAssets.ts` already
serve the wake-word pipeline's own ONNX models: a small backend module
owning the pinned URL + checksum for each file, downloaded and cached
on disk on first request, and a route pair (list what's available,
serve one file's bytes by name) with a fixed allow-list so `:file`
is never a path built from the request.

**Read the exact precedent before writing anything**:
`backend/src/lib/wakewordAssets.ts` (89 lines) and the two routes in
`backend/src/routes/voice.ts` named `wakewordsRoute`/`wakewordFileRoute`
(lines 41-123 as of this writing - re-read, don't trust the line
numbers if the file has moved). Your new module and routes mirror
these almost exactly; the differences are named below.

## Files you own

- New file: `backend/src/lib/visionAssets.ts`
- New file: `backend/src/routes/vision.ts`
- `backend/src/app.ts` (two lines: one import, one `app.route(...)` -
  see step 4)
- `backend/tests/visionAssets.test.ts` (new)
- `docs/BACKLOG.md` (one line, see step 6)

Do not touch `backend/src/lib/wakewordAssets.ts` or
`backend/src/routes/voice.ts` themselves (read-only reference) or
anything under `frontend/` (FACE-02A, a different lane, owns
`frontend/src/lib/vision/`, running in parallel in `home-codex`) -
those files don't exist yet from this lane's point of view and nothing
here should reference them.

## The two models, already downloaded and independently verified

Both are pinned by URL + sha256, the same "download, don't vendor"
shape `wakewordAssets.ts` already uses. Both checksums below were
independently computed against the actual bytes at these URLs earlier
today (not copied from a third-party listing) - verify them yourself
too before trusting this brief blind (`curl -sL <url> | shasum -a
256`), the same discipline this repo's own model-pinning code expects.

**Face detector** (YuNet, multi-stride, the exact model
`bot`'s own robot-side `reachy_mini.vision.face_detector.FaceDetector`
already uses in production - same model on both surfaces on purpose):
- `file`: `face_detection_yunet_2026may.onnx`
- `url`: `https://huggingface.co/pollen-robotics/face_detection_yunet_2026may/resolve/2b8e922362946a0db67e861bae0f77826980effd/face_detection_yunet_2026may.onnx`
- `sha256`: `ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0`
- size: 229738 bytes

**Face embedder** (SFace, the exact model FACE-01's hub-side
`KNOWN_MODELS["sface-2021dec"]` already pins in
`backend/src/lib/biometricPrints.ts` - same model id, same checksum,
on purpose, so a browser-computed embedding and a hub-verified one
never silently diverge):
- `file`: `face_recognition_sface_2021dec.onnx`
- `url`: `https://media.githubusercontent.com/media/opencv/opencv_zoo/ba91a3b91d00d76e86540d4013f944bd6b514e39/models/face_recognition_sface/face_recognition_sface_2021dec.onnx`
- `sha256`: `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`
- size: 38696353 bytes (re-verified directly with `curl -w
  "%{size_download}"` while writing this brief, alongside the
  checksum)

## Steps

1. Read the precedent files named above.
2. Write `backend/src/lib/visionAssets.ts`, mirroring
   `wakewordAssets.ts`'s shape exactly:
   - A `VisionAsset` interface: `{ file: string; url: string; sha256:
     string }` (same shape as `WakewordAsset`).
   - `VISION_FACE_DETECTOR: VisionAsset` and `VISION_FACE_EMBEDDER:
     VisionAsset`, the two models above.
   - `VISION_ALL_ASSETS: VisionAsset[] = [VISION_FACE_DETECTOR,
     VISION_FACE_EMBEDDER]`.
   - A new `visionDir` export in `backend/src/lib/paths.ts` (one line,
     mirroring `wakewordDir`'s own definition exactly:
     `resolve(dataDir, "vision", "models")` - read `wakewordDir`'s
     exact line first and copy its shape, not just its idea).
   - `visionAssetPath(file: string): string`, `isVisionAssetInstalled
     (file: string): boolean`, `areVisionAssetsInstalled(): boolean` -
     same shape as their wakeword counterparts.
   - `ensureVisionAssets`, wrapped in `singleflight()` from
     `@maipai/core/src/singleflight` exactly like
     `ensureWakewordAssets` - same reasoning applies here: a browser
     page loading both models as concurrent requests must not race two
     `downloadUrl()` calls against the same destination file.
3. Write `backend/src/routes/vision.ts`, mirroring
   `wakewordsRoute`/`wakewordFileRoute` exactly:
   - `visionRoutes = apiRouter()`.
   - A `GET /models` route (any signed-in person, `requireAuth`, no
     role gate - same posture the wakeword routes take, these are
     static model bytes, not a privileged read): returns `{ detectors:
     [{ id: "yunet-2026may", label: "..." , file:
     VISION_FACE_DETECTOR.file }, { id: "sface-2021dec", label: "...",
     file: VISION_FACE_EMBEDDER.file }], installed:
     areVisionAssetsInstalled() }`. Use `"sface-2021dec"` as the id for
     the embedder exactly - it must match FACE-01's own
     `KNOWN_MODELS["sface-2021dec"]` string in
     `backend/src/lib/biometricPrints.ts` verbatim (read that file's
     `KNOWN_MODELS` constant to confirm the exact string before you
     write it here - this is the one place a typo would silently break
     the hub/browser model-id contract FACE-01 depends on). Pick your
     own reasonable id string for the detector (it has no existing
     contract to match) and your own reasonable label strings for both
     - state what you chose in your done report.
   - A `GET /model/:file` route: same fixed allow-list pattern
     (`ASSET_BY_FILE = new Map(VISION_ALL_ASSETS.map((a) => [a.file,
     a]))`), same `requireAuth`, same `ensureVisionAssets()` /
     `Bun.file(visionAssetPath(...))` response shape, same 404/503
     error responses for an unknown file / an unavailable asset.
4. Mount the new router in `backend/src/app.ts`: import
   `visionRoutes` from `@/routes/vision` (add the import line near the
   existing `voiceRoutes` import, not necessarily adjacent - match
   whatever import ordering convention the file already uses) and add
   `app.route("/api/vision", visionRoutes);` (place it near the
   `app.route("/api/voice", ...)` lines for readability, not required).
5. Write `backend/tests/visionAssets.test.ts`, mirroring
   `backend/tests/wakewordAssets.test.ts`'s own test shape and the
   route-level tests in `backend/tests/voice.test.ts` for the wakeword
   asset routes specifically (read both first). Cover: `GET
   /api/vision/models` returns both entries with `installed: false`
   before any download happens; `GET /api/vision/model/:file` for an
   unknown file name returns 404; a request with no session cookie
   returns 401 for both routes (mirror however the wakeword tests
   assert this exact case). Do **not** write a test that actually
   downloads either real model file over the network in the
   deterministic suite (that would make `bun test` network-dependent
   and slow) - mirror whatever `wakewordAssets.test.ts` itself does to
   avoid that (read it first; if it fakes or skips the real download
   path, do the same here).
6. Add one line to `home/docs/BACKLOG.md` noting FACE-02B landed
   (search for the existing `FACE-02` line first -
   `grep -n "FACE-02" docs/BACKLOG.md` - add your line as a sub-note
   under it, do not mark the parent `FACE-02` line itself done).
7. Run `cd backend && bun test tests/visionAssets.test.ts` until
   green, then the full backend `bun test` to confirm nothing else
   broke (especially `voice.test.ts` and `app.test.ts` if one exists -
   check for a test that asserts the full route list or OpenAPI doc
   shape, since you added a new mounted router).
8. Regenerate the API docs the same way any route change in this repo
   does: `bun run gen:api-docs` from `backend/` (check
   `backend/package.json`'s scripts for the exact command name first -
   it may differ slightly from this). Stage the regenerated
   `docs/api/openapi.json` alongside your other files.
9. Stage `backend/src/lib/visionAssets.ts`, `backend/src/lib/paths.ts`,
   `backend/src/routes/vision.ts`, `backend/src/app.ts`,
   `backend/tests/visionAssets.test.ts`, `docs/api/openapi.json`, and
   `docs/BACKLOG.md` by name (never `-A`). One commit.

## Acceptance evidence

- `GET /api/vision/models` (signed in) returns both entries with
  `installed: false` on a fresh data directory, and the SFace entry's
  `id` is exactly `"sface-2021dec"` (paste the response body from your
  test, or the assertion, either way show the literal string).
- `GET /api/vision/model/:file` for a name not in the allow-list
  returns 404; for either real file name, once
  `ensureVisionAssets()` has actually fetched it once (a live check
  you run by hand outside the deterministic suite is fine here, or a
  test that mocks the download - your call, matching whatever
  `wakewordAssets.test.ts` itself does), returns the file's real bytes
  with `content-type: application/octet-stream`.
- Unauthenticated requests to both routes return 401.
- The two checksums you verify yourself (step 2's `curl | shasum`
  commands) match what's written in this brief - paste both outputs in
  your done report. If either doesn't match, stop and report a
  question rather than proceeding on a checksum you can't confirm.

## Exit checks

- `bash scripts/check.sh` from the `home-codex-2` worktree root, green
  (paste the pass line; this diff touches a backend route and a shared
  `app.ts`, so it likely runs at least the backend leg or the full
  gate depending on what else changed nearby - say what scope it
  picked).
- Code review at `medium` effort on your diff (a new route + a new
  backend module that reaches the network - `CLAUDE.md`'s own reason
  a route/wire-shape change gets `medium` rather than `low`).
- One commit (code + tests + docs + regenerated API doc together).
  Stage by name.
- Push `home-codex-2`'s branch, or say you left it for the coordinator
  to merge.

## Reporting

Report **ready** first and wait for "start". Report **done** with: the
commit hash, the `check.sh` pass line and scope, the `bun test` summary
lines for the new test file and the full backend suite, both
checksum-verification command outputs, the id/label strings you chose
for the detector entry, and confirmation the SFace entry's id matches
`biometricPrints.ts`'s `KNOWN_MODELS` key verbatim. Report **blocked**
with the exact failing assertion or error (a checksum mismatch against
this brief's stated value is a blocker, not something to silently
correct and proceed past). Report **question** if
`backend/tests/wakewordAssets.test.ts`'s own pattern for avoiding a
real network download in the deterministic suite isn't clear once
you're reading it, or if an existing test elsewhere asserts something
about the full route list that your new mount would break in a way
this brief didn't anticipate.
