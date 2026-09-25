# App-wide audit for Codex (2026-09-25, codex-high)

Repo: home. Read-only investigation, no fixes in this pass. This is the
audit Jesse asked for earlier tonight ("audit our app for breaks, code
that doesn't work, stale old code, inefficient code"), held until D1-D9
landed and chat stabilized - both are now true (D1-D9 closed at
`5adeff6d`, tonight's bug batch landed clean through `4f921f4b`).

## Scope

`backend/` and `frontend/` source (not `node_modules`, not vendored
kit snapshots - `frontend/src/kit/dashboard/` and any `elements/`
folder carrying a NOTICE attribution are vendored, per org rule "never
reviewed," skip them entirely). Test files are in scope only as
evidence of what's actually exercised, not as audit targets themselves.

## What to look for, in four categories

1. **Breaks**: code paths that visibly don't work - a route that
   errors on a normal input, a component that renders wrong or not at
   all, a TODO/FIXME/HACK comment that describes a known-broken
   behavior, a try/catch that silently swallows an error a person
   would want to see, a type assertion (`as any`, `as unknown as X`,
   `!`) papering over a real mismatch.
2. **Dead/stale code**: exports nothing imports (`grep -rn` each
   export's name across the repo), files nothing routes to or renders,
   old-path remnants that should have gone with D1-D9 but didn't
   (check for anything still referencing `turnEngine.ts`'s deleted
   guards, `routing.ts`'s deleted Tier 1 decider, `unknownNames.ts`'s
   deleted world half - grep the exact names D1-D9's own commits
   removed, in case a caller was missed), a settings key or route
   nothing reads.
3. **One-definition-rule violations**: two implementations of the same
   thing (a formatter, a validator, a parser) where the org's own
   "simplify: centralize and reuse" principle says there should be
   one; a hand-copied constant/type that should derive from a shared
   source (the exact shape of #127, already fixed tonight - look for
   siblings of that same pattern).
4. **Real inefficiency**: an obviously quadratic loop over something
   that can be large (a household's turns, a conversation's messages),
   a value recomputed every render/request that's cheap to memoize or
   cache, a query that fetches more than the caller uses. Not
   micro-optimization - only things that would show up as a real user-
   facing slowdown or a resource-usage line worth trimming.

## What NOT to do

- No code edits, no commits, no branch. This is a report.
- No re-litigating something already recorded as a deliberate choice
  (D1-D9's own scope cuts, `docs/dev.md`'s decision log, an accepted
  gate exception like #160's mDNS timeout or #158's old-path replay
  drift - grep `docs/dev.md` and `docs/BACKLOG.md` before flagging
  something that might already be a known, ruled-on tradeoff).
- No guessing at product/UX intent - if something looks wrong but
  might be intentional (a debug-only code path, a feature flag's off
  state), say so and flag it as "needs confirmation," don't assume.
- Nothing on child-safety, consent, privacy, or credential handling -
  flag it by file/line only and mark it **NEEDS SAFETY REVIEW**, do
  not characterize the specific gap in a way that could read as a
  found exploit; a Claude lane reviews those first regardless of how
  the report is worded.

## Report shape

One markdown file, `data-scratch/audit-2026-09-25-REPORT.md` (it's
git-ignored - scratch, not committed). For each finding: category (one
of the four above, or NEEDS SAFETY REVIEW), file:line, a one-sentence
statement of what's wrong, confidence (high/medium/low), and whether
it looks like a contained S fix or needs real judgment - same
BUG-READY / BUG-NEEDS-JUDGMENT split tonight's issue triage used.
Group by category, most-confident-and-most-valuable first within each
group. A summary line at the top: total findings per category.

This is a big scan - work through it in passes by area (`backend/src/lib`,
`backend/src/routes`, `backend/src/settings`, `frontend/src/apps`,
`frontend/src/next`, `frontend/src/shell`, etc.) rather than trying to
hold the whole repo in one pass, and write findings to the report file
incrementally as you go rather than holding everything until the end.

Report: ready (confirm scope understood) / done (the report's path,
total finding count per category) / question if something about scope
itself is unclear before starting. No push, no queue claim needed -
this isn't a queue item.
