# Urgent, small: temporary yaw/pitch debug readout on the enrollment screen

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`,
branch `face-02-pose-debug` (already checked out, based on current
`origin/main`, which includes the just-merged FACE-02 capture UI).

Jesse is live-testing the face enrollment flow right now and is stuck
at the "up" pose step ("tip your chin up a little" never advances).
`headPose.ts`'s scale constants are explicitly uncalibrated starting
values (its own header comment says so) - we need one real data point
from his actual camera before tuning them, not a guess.

## The one change

In `frontend/src/apps/people/FaceEnrollmentPage.tsx`, find where
`pose.yawDeg`/`pose.pitchDeg` are computed (search `estimateHeadPose` -
it's inside the `tick` callback, assigned to a local `pose` variable).
Right after that `pose` value is computed (and before/alongside the
existing `setLastReason`/rendering logic), add a small piece of
render-visible state (e.g. a `useState<{yaw: number; pitch: number} |
null>` set on every successful pose estimate) and display it as plain
text on screen, near the existing pose-prompt text (`{POSE_PROMPT[pose]}`
around line 577) - something like:

```tsx
{debugPose ? (
  <p className="text-center text-xs text-muted-foreground">
    yaw {debugPose.yaw.toFixed(1)}° · pitch {debugPose.pitch.toFixed(1)}°
  </p>
) : null}
```

Keep it simple and clearly temporary (a one-line code comment saying
this is throwaway debug instrumentation for live pose-constant tuning,
to be removed once `headPose.ts`'s constants are confirmed correct -
don't write a permanent feature around this). Do not touch
`headPose.ts` itself, `DEFAULT_QUALITY_CONFIG`, or any other file - the
only change is making the already-computed pose numbers visible on
screen.

## Steps

1. Make the change above.
2. Run `bash scripts/check.sh` (frontend scope) to confirm nothing
   broke - this is a trivial, low-risk change, so this should be fast.
3. Run `bun run build` in `frontend/` (or whatever `check.sh`'s own
   build step invokes) to confirm the production build still succeeds,
   since this needs to actually run against a built `dist/`, not just
   the dev-mode typecheck.
4. Stage `frontend/src/apps/people/FaceEnrollmentPage.tsx` by name. One
   commit, clearly marked as temporary/debug in the message.
5. Push `face-02-pose-debug` to origin.

No code review needed for this one (temporary debug instrumentation,
about to be reverted) - skip that step, but do still run check.sh and
confirm the build succeeds before reporting done.

## Reporting

Report **done** with just: the commit hash, confirmation `check.sh`
passed, and confirmation the production build succeeded. This is
urgent - move fast, keep the diff minimal, don't add anything beyond
what's asked.
