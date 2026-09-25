# App-wide audit, round 2 (2026-09-25, codex-high or low, coordinator's read-only pass)

Repo: home. Read-only investigation, no fixes in this pass - same
rules as the first audit (`docs/plans/codex-app-audit-2026-09-25.md`,
read it for the full category definitions and exclusions, not
repeated here). This round exists because a real amount landed since
that first pass: `git log --oneline 7dc294b9..HEAD` is 7 commits,
touching `backend/src/lib/memoryJudge.ts` (a new cursor table and
resumable scan), all three engine supervisors (`llmSupervisor.ts`,
`embedSupervisor.ts`, `backgroundSupervisor.ts` - a shared stalled-
startup/retry mechanism, new), `register.ts` and `turnMachine/
messages.ts` (a new target-aware plan-line path), and the status-
dashboard skill in `.github` (out of scope for this repo's own audit).

## Scope this round

Same four categories as round 1 (breaks, dead/stale code, one-
definition-rule violations, real inefficiency), same exclusions
(vendored kit paths, no re-litigating a recorded decision, no product/
UX guessing, safety/consent/privacy findings flagged NEEDS SAFETY
REVIEW only, never characterized).

Two passes, in order:

1. **The seven recently-changed files first** (named above, plus
   anything else `git log --oneline 7dc294b9..HEAD --stat` shows
   touched) - freshly-landed code is where a real defect is most
   likely to still be sitting unreviewed. Check the new stalled-engine
   mechanism across all three supervisors for consistency (the brief
   for that fix asked for the same shape in all three - confirm it
   actually landed that way, not just in the one the issue happened to
   name). Check the memory-consolidation cursor table and resumable
   scan for a real edge case (what happens to a cursor pointing at a
   group that no longer exists, a concurrent run, a cursor from before
   a schema change).
2. **A fresh general sweep of `backend/src/lib` and `frontend/src`**,
   same method as round 1 (grep for dead exports, TODO/FIXME/HACK,
   `as any`/`as unknown as`, duplicate implementations, obviously
   quadratic loops over household-sized data) - round 1 covered this
   already, so favor areas it didn't reach deeply (`frontend/src/apps`
   beyond chat/settings, `backend/src/routes`, `backend/src/settings`)
   over re-treading the same ground.

## Report shape

Same as round 1: `data-scratch/audit-2-2026-09-25-REPORT.md`
(git-ignored), same per-finding shape (category, file:line, one
sentence, confidence, BUG-READY/BUG-NEEDS-JUDGMENT/NEEDS SAFETY
REVIEW), grouped and summarized the same way. Work through it in
passes by area, write incrementally.

Report: ready (confirm scope) / done (path, finding counts) / question
if scope itself is unclear. No push, no queue claim needed.
