# Session A: the CHAT program resumes (2026-09-13)

Work order from the coordinating session. The items are the BACKLOG
entries themselves (under "Chat system optimization"); this file only
sequences them, names what tonight's merged work already gives each
one, and sets the shared-checkout rules. Same rules as
`session-a-post-block-2026-09-13.md`: your files, `git add -p` on the
two shared docs, your dated sections in `docs/dev/session-a.md` with
an index line in `dev.md`, gate on your own diff in a throwaway
worktree, spare-port backends by pid, report on ready, done, blocked,
question, low context. Commit this file with the first item.

## Order and why

1. **CHAT-18** (S, no dependencies): the turn-activity lease. First
   because it is small, mechanical, and lives in the exact functions
   CHAT-01 is about to refactor; getting the acquire/release pairing
   right on every exit path before the refactor means the refactor
   carries it rather than re-breaking it. FAST-04's generator path
   (`peekAndHandle`, the resolved variant, `StreamUnavailable`) added
   exit paths since the item was written: every one of them releases.
2. **CHAT-01** (M): one `TurnContext` shared by generation and the
   guards. What exists already: FAST-02's `buildPromptParts()` split
   the stable prefix from the context message; FAST-05 narrowed the
   guards to household subjects; JOIN-01 adds recalled episodes to the
   guard's grounded sources beside memory bullets; ROUTE-01/02 own
   routing and the offered set (leave `selectOfferedTools` and the
   shape guard alone; `intent.kind` may read the trace's shape, not
   recompute it). The item's core is that prompt and guard draw from
   the same selected evidence ids; today `guardContext` is assembled
   separately from the prompt in `prepareTurn()`, which is the defect.
3. **CHAT-02** (M, after CHAT-01): one output safety boundary. Note
   the FAST-04 resolved-reply path deliberately bypasses the style
   guards; it must still pass the safety evaluator, which is a
   different thing. Do not fold the two back together.
4. **CHAT-03** (M): credentials never enter memory or context. Session
   B's `POST /api/memory/batch-forget` and `forgetByIds()` landed
   tonight in `routes/memory.ts` and `lib/memory.ts`; build on them,
   do not re-shape them.

CHAT-05 in the order list is already done (2026-09-11).

## Shared checkout

Session B is finishing #60 (an additive `supersedes` column on
`conversation_turns`, a passthrough option on `runTurn`/
`runTurnStream` to `logTurn`, small hunks in `conversationHistory.ts`
and `routes/turn.ts`, and the chat adapters). Its gate is running as
this file is written; pull its commit before starting CHAT-18, since
CHAT-18 and CHAT-01 touch those same functions. After #60, Session B's
lane is frontend-only again (#82 and onward), so from CHAT-01 on the
backend is yours alone.

## Acceptance discipline

Each item's acceptance in BACKLOG is the contract. Where an item names
a live check, run it on a spare-port backend against the household
engines by URL and record the numbers in `session-a.md`. Where a
measured result misses, record it and stop; never lower a threshold.
