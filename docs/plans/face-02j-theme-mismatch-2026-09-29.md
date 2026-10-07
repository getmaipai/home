# FACE-02J: the enrollment page doesn't match the app's theme

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`,
branch `face-02j-theme` (already checked out off current `origin/main`).

Jesse's own live-test note (2026-09-29): the face-enrollment page
"doesn't seem to use the site theme colors." A screenshot from his test
shows the ENTIRE page as solid black, not just the camera preview box -
worth confirming whether that's really every part of the page (a real
bug) or just the camera viewfinder itself (a conventional, probably-fine
choice - Zoom/FaceTime/etc. all use a black camera background regardless
of app theme).

## Ready handshake

Reply with your model, checkout path and branch, and "ready for
FACE-02J". Wait for "start".

## Steps

1. Read `frontend/src/apps/people/FaceEnrollmentPage.tsx` in full,
   specifically its top-level page wrapper/layout (not just the camera
   box at the `bg-black` class you'll find on the video container - grep
   for it, that one's the camera viewfinder itself and is probably
   correct as-is per the reasoning above, don't just delete it without
   checking). Find whatever wraps the WHOLE page/route and compare it to
   how a normal page in this app (e.g. `PersonProfilePage.tsx`,
   or the shell route it's rendered inside) gets its background - does
   it come from the kit's own theme tokens (CSS variables, a shared
   layout wrapper), or did this page build its own full-page container
   that never inherited them?
2. Start the dev server (`cd frontend && bun run dev`, or however this
   repo's own README/AGENTS.md says to run it locally) and actually look
   at the enrollment page yourself in a real browser, in both light and
   dark mode (check how this app toggles that - a settings option, or
   system preference), and compare it side by side with an ordinary page
   like the person profile page. Take real screenshots of both modes and
   open/judge them yourself before concluding what's wrong (org rule:
   never guess a UI fix without looking at it rendered).
3. Fix whatever you actually find: if the page wrapper isn't using the
   shared layout/theme tokens the rest of the app uses, fix that (reuse
   the existing pattern another page already uses correctly, don't
   invent a new one). If it turns out the black background is ONLY the
   camera preview box itself and everything else already matches the
   theme correctly, then there may be nothing to fix here beyond
   confirming that and closing the item - say so plainly in your report
   rather than inventing a change for its own sake.
4. `docs/BACKLOG.md`: `grep -n "FACE-02J"`, tick it with a short note on
   what you found and fixed (or confirmed was already correct).

## Exit checks

- `bash scripts/check.sh`, green.
- Real screenshots taken and opened/judged by you, in both light and
  dark mode, before and after (if you made a change).
- Code review at `low` effort (a small, contained visual fix, or a
  no-op confirmation).
- One commit, staged by name.
- Push `face-02j-theme`, or say you left it for the coordinator.

## Reporting

Report **ready**, wait for **start**. Report **done** with: what you
found (a real mismatch and the fix, or confirmation there wasn't one),
the screenshot paths and confirmation you opened and judged each one,
`check.sh`'s pass line, and the review's disposition.
