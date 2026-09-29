# ROBOT-CARD-01 (hub half): PUT /api/devices/me/state and the derived state field

Lane: codex-a, worktree `/tmp/home-robot-card`, branch `robot-card-01-hub`
(already checked out off current `origin/main`, which includes
`spec-v0.1.55`'s `RobotState` schema).

Model floor: Codex, `medium` reasoning (a new auth-gated route, but
built from an already-vetted pattern - not inventing new auth
behavior).

## Ready handshake

Reply with your model, checkout path and branch, and "ready for
ROBOT-CARD-01 (hub half)". Wait for "start".

## Why, and a hard constraint on HOW

Full design: `docs/dev.md`, "Robot device state" (2026-09-29). The
robot pushes a small state frame; the hub stores the latest one per
device and derives `reachable`/`unreachableSince` on read.

**Do not touch `backend/src/middleware/auth.ts` in this item, at all -
not even an `export` keyword, not even a one-line addition.** This is
a hard constraint, not a style preference: that file hit real,
repeated tool-level denials tonight on an unrelated auth change, and
this item's own route does not need to touch it. `requireDeviceSession("robot")`
(already exported, already used successfully by FACE-03's
`biometricPrints.ts` sync route - read that file's own `syncRoute` as
your pattern for the auth gate itself) already correctly gates this
route. What it does NOT do is expose which device passed the gate to
the route handler (it only calls `c.set("person", result)`, never
`c.set("device", ...)`). Rather than widen `requireDeviceSession`/`AppEnv`
to add that (a real design a review once floated, but not this item's
risk to take), **resolve the device independently inside your new
route handler**, in a small new function in the new
`lib/deviceStates.ts` file you're already writing (see step 2) - it
needs the same three-line lookup `middleware/auth.ts`'s own
(unexported) `resolveSessionDeviceId` already does (read that function
for the exact pattern: `hashSessionToken` from `@/lib/session`,
`getCookie(c, "session")` from `hono/cookie`, a `db.select({deviceId:
sessions.deviceId}).from(sessions).where(eq(sessions.tokenHash,
tokenHash)).get()`), then `getDeviceById(deviceId)` (already exported
from `@/lib/devices`) for the device row. A few duplicated lines in a
new file is the deliberately safer choice here over touching the
shared auth module again tonight - do not "clean this up" by exporting
from `auth.ts` instead, even though it would be more DRY.

## Files you own

- `backend/src/db/schema.ts` (add the `deviceStates` table) + its
  migration.
- `backend/src/lib/deviceStates.ts` (NEW): `upsertDeviceState`,
  `getDeviceState`, and the route's own device-resolution helper (see
  above).
- `backend/src/routes/devices.ts`: the new `PUT /api/devices/me/state`
  route, and the derived `state` field added to `GET /api/devices`/
  `GET /api/devices/robots`'s existing response schemas.
- `backend/tests/deviceStates.test.ts` (NEW).
- `docs/BACKLOG.md` (tick ROBOT-CARD-01's hub-half checklist - it does
  not have explicit sub-bullets yet, so write them as you go and tick
  them, matching FACE-03's own hub-half entry's shape).

Do not touch `middleware/auth.ts` (see above), `frontend/` (the card
itself is a separate, later item - this is backend/API only), or
`commons` (the schema already landed, `spec-v0.1.55`).

## Steps

1. Read `spec/schemas/robot-state.schema.json` (in this repo's own
   `node_modules`/pinned commons checkout, or `../commons/spec/schemas/`
   if that's how this repo references it - check how `biometric-print.schema.json`
   is actually consumed here, e.g. `@maipai/spec/gen/ts/...`, and mirror
   that import path exactly) and `docs/dev.md`'s "Robot device state"
   entry in full.
2. `backend/src/db/schema.ts`: add a `deviceStates` table -
   `deviceId` (text, primary key, references `devices.id`, `onDelete:
   "cascade"` - mirror how `sessions.deviceId` or another FK in this
   file already declares a Drizzle foreign key with cascade), `activity`
   (text), `muted`/`tracking` (integer, Drizzle's boolean convention in
   this file - check an existing boolean column for the exact type),
   `onBattery`/`batteryLevel`/`daemonVersion` (nullable, matching types),
   `reportedAt` (text, ISO timestamp, stamped by the hub on receipt -
   never trust a client-supplied timestamp for this field). Generate the
   migration the same way this repo's own migrations are generated
   (check `package.json`'s `db:generate` script, already used by
   FACE-03's own migration tonight - don't hand-write the SQL).
3. `lib/deviceStates.ts`:
   - The device-resolution helper described above (name it something
     like `resolveRequestDevice(c): Device | null`).
   - `upsertDeviceState(deviceId: string, frame: RobotStateFrame): void` -
     validates the frame against the spec's own `validateRobotState`
     if one exists (check whether `PRINT-SPEC-01`'s biometric print
     validator has an equivalent you should mirror, or whether schema
     validation alone is what `RobotState`'s own commons item decided
     was sufficient - read that item's done report/BACKLOG entry), sets
     `reportedAt` to `new Date().toISOString()` (the hub's own clock),
     and writes with a Drizzle upsert (insert `.onConflictDoUpdate` or
     this repo's own established upsert pattern - check for a precedent
     elsewhere in `lib/`).
   - `getDeviceState(deviceId: string): { ...frame, reachable: boolean,
     unreachableSince: string | null } | null` - the derive-on-read
     logic: `reachable = Date.now() - new Date(row.reportedAt).getTime() <= 45_000`
     (name the 45000 a constant, `ROBOT_STATE_STALE_MS`, near the top
     of the file), `unreachableSince = reachable ? null : row.reportedAt`.
     Returns `null` if the device has never reported (the caller
     represents this as the card's own "hasn't connected yet" case, not
     this function's problem).
4. `routes/devices.ts`: new route, `PUT /api/devices/me/state`,
   modeled on `biometricPrints.ts`'s `syncRoute` for the createRoute/
   openapi shape (zod body schema matching `RobotState`'s own fields,
   `middleware: [requireDeviceSession("robot")] as const`). Handler:
   resolve the device via your new helper (if null despite the
   middleware passing - shouldn't happen, but handle it as a 401
   rather than throwing), call `upsertDeviceState`, return `204`. A
   malformed body (fails the zod/schema validation) is Hono's own
   normal `400`, nothing custom needed. Also add the derived `state`
   field (nullable) to whatever existing `GET /api/devices` and
   `GET /api/devices/robots` response schemas already exist in this
   file - read them first, extend the response shape, call
   `getDeviceState` per robot-kind row only (not every device kind -
   `state` is robot-specific for now, per the design record).
5. Tests, `backend/tests/deviceStates.test.ts` (mirror `biometricPrints.test.ts`'s
   own sync-route test setup: a real paired robot device, redeemed
   through the real routes, not mocked):
   - A robot session's frame is stored and read back correctly via
     `GET /api/devices`/`GET /api/devices/robots`.
   - A person's (non-device) session gets 403 on the PUT route.
   - A different device kind (mint a `tv`/`phone` device token) gets
     403.
   - A stale report (freeze/mock time, or directly manipulate
     `reportedAt` in the DB after a real write) reads `reachable: false`
     with `unreachableSince` equal to the last real report's timestamp.
   - Deleting the device (`deleteDevice`) removes its state row (check
     the FK cascade actually fires - a real DB assertion, not just
     trusting the schema declaration).
   - An invalid `activity` enum value in the PUT body gets 400.
6. `docs/BACKLOG.md`: tick what you completed under ROBOT-CARD-01's hub
   half (grep for the entry, write real sub-bullets if none exist yet).

## Exit checks

- `bash scripts/check.sh`, green, paste the pass line and scope.
- Code review at `medium` effort (a new auth-gated route and a new
  table - real, but built entirely from already-reviewed pieces,
  `requireDeviceSession` untouched).
- Confirm in your own done report: zero lines changed in
  `middleware/auth.ts`. If you found yourself wanting to touch it,
  stop and report **question** instead of doing it.
- Stage by name, one commit, push `robot-card-01-hub`.

## Reporting

Report **ready**, wait for **start**. Report **done** with: the
migration file name, `check.sh`'s pass line, confirmation every test
in step 5 passes, and confirmation `middleware/auth.ts` was never
touched. Report **blocked** with the exact failure. Report **question**
if the commons-side `RobotState` import path or validator location
doesn't resolve cleanly from reading the repo - don't guess it.
