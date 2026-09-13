# Session B: lane 7, the screenshot pipeline and the type floor (2026-09-13)

Work order from the coordinating session. Frontend, `scripts/`, and
docs only; no backend line (Session A owns the chat engine and the
supervisors; #98 and #99, which you found, are in its queue). Same
protocol as lane 6: gate on your own diff in a throwaway worktree of
`main` created as a sibling of `home`, removed the moment the gate
ends; `git add -p` on `BACKLOG.md`; sections in `docs/dev/session-b.md`;
report on ready, done, blocked, question, low context. Commit this
file with item 1.

## 1. BACKLOG "A screenshot matrix in the pipeline": reconcile and finish (S-M)

The item still says "today one hero shot at one size". Tonight's
`scripts/screenshot.ts` has a viewport-by-theme matrix with a
concurrency pool, overflow and target-size checks, the a11y scan, the
clipped-strips check, the keyboard-trap check, a seeded repair, a
seeded weather cache, and per-browser output directories. Read
`docs/UI.md` in the org repo (the screenshot standard: every page at
every surface, light and dark, overflow and touch-target checks) and
`docs/STYLE.md`'s screenshot section, list what the standard asks for
that the pipeline still lacks, do the missing pieces if they are S
each (a route the matrix skips, a surface size the standard names
that the matrix does not, a check the standard names), and rewrite
the BACKLOG item's status to what is true, ticking it if the
standard is met. Acceptance: the item's text matches the script; any
new check has a test or a proven-to-fail run recorded in
session-b.md.

## 2. getmaipai/home#75: the WebKit chat exercise times out (S)

`bun run scripts/screenshot.ts --chat-review --webkit` reaches the
chat page on phone/dark and times out after 90 s exercising the chat
flow; Chromium passes. Find the cause in the exercise, not the app,
unless it is the app: the WebKit run uses Playwright's own WebKit,
headless (never a window, per the org rule); capture the page's
console and network in the failing run; the likely shapes are the
NDJSON stream not being read the same way by WebKit's fetch, a
`visualViewport` difference in the keyboard guard, or the send button
not receiving the synthetic click. Fix the exercise or file the app
bug with the evidence, and make the WebKit chat-review run pass or
skip with a stated reason in its output. Close the issue or comment
the cause.

## 3. The type floor across the app (S-M)

Lane 5 item 3 closed the bell badge and the thread timestamps and
recorded that about 49 other `text-xs`/`text-[10px]` instances remain.
`docs/UI.md` names the type floor. Sweep them: each instance either
moves to the floor or is a deliberate exception with a comment naming
why (a badge count inside a fixed-size dot, a monospace token). Then
make the floor enforceable: an eslint rule or a small lint script in
the frontend's `check` step that fails on a sub-floor class without an
exception comment, so the sweep cannot regress. Acceptance: the lint
passes on the swept tree and fails on a planted violation (prove it
once, record it); `bun run a11y` unchanged; the screenshots a user
page embeds regenerated and opened, since sizes moved.

## Out of scope

Anything under `backend/` (#98, #99 are Session A's), the home
redesign (Jesse's decision), unified search, the Health and updates
pages (an L item needing its own design pass).
