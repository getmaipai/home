# Session A: after the 2026-09-12 block (2026-09-13)

Work order from the coordinating session. Lane: backend, on `main` in
the main checkout, shared with Session B (frontend, `routes/memory.ts`
and `lib/memory.ts` for one batch route). Ownership: `backend/src/lib/
{turnEngine,routing,guards,persona,llm,llmSupervisor,episodes,
memoryJudge,conversationHistory}.ts`, `backend/src/routes/{turn,
openai,conversations}.ts`, `backend/scripts/bench/**`, `backend/tests/`
for those, `spec/llm/**`, and your own hunks in `docs/BACKLOG.md` and
`docs/dev.md` (always `git add -p` on those two; never wholesale).
Never `frontend/**`, `scripts/screenshot.ts`, `routes/memory.ts`,
`lib/memory.ts`. Live checks spawn your own backend on a spare port
against the running engines by URL (8788 chat, 8794 embed), recorded
by pid and port, stopped by pid, ports confirmed free; never restart
the 8787 backend. Long commands in the background or with a raised
timeout. Code review at medium with an explicit target before each
commit; `check.sh` before each commit with its result in the done
report; docs in the same commit; stage by name; push after each item;
report to `getmaipai-c0` on ready, done, blocked, question, low
context. Commit this file with item 1.

## 1. getmaipai/home#77: "please remember it" never reaches the remember package (M)

The bench calls `remember` 10 of 10 for that phrasing with four tools
and a bare prompt; the real `prepareTurn()` shape loses the call every
time. Find the difference by bisection, not by guessing: run the
utterance through the real assembly with each of the following removed
in turn, and record which one flips the decision: the offered tool set
(every offered tool versus the bench's four), the tool description
text (FAST-03's sentence), the information policy in the stable
prefix, the late context message, the samplers. Then fix the cause in
the narrowest place: if the model needs a clearer signal, that is a
routing-side fix (a literal pattern for trailing "please remember"
forms in the remember package, mirroring its existing "remember *"
pattern, is acceptable and cheap); if a prompt sentence suppresses tool
calls, fix the sentence and re-run the tool-calling bench. Do not
change guard behavior here (#74 stays its own item). Acceptance: a
regression test with the two exact phrasings from the issue through
`runTurnStream()` with a scripted stub that would call `remember` when
offered; live on your spare-port backend, both phrasings store a
memory record three of three times; tool-calling bench still 10 of 10
positives and 0 false calls; the bisection table in your dev.md
section. Close the issue from the commit.

## 2. getmaipai/home#79: episode recall reads every vector on every turn (S)

`episodes.ts`'s vector half selects every episode embedding for the
person with no limit and scores in JavaScript before the model call.
Bound it: read at most the most recent N episodes (N a named constant,
start at 2,000) plus any inside the chrono date window when one is
present, and score only those; the FTS half is already bounded by
SQL. Acceptance: a test that seeds N plus 500 episodes and asserts the
scan touches at most N (count rows through the existing test seam or a
counter on the select), the memory bench still finds 7 of 8 episode
questions, and a note in dev.md on what the constant costs at ten
thousand episodes. Close the issue from the commit.

## 3. getmaipai/home#78: recalled plugin errors and guard lines read as "you replied" (S)

Episodes store assistant turns verbatim, including canned guard lines
and plugin error text, and `formatEpisodesForPrompt()` presents them
as what MaiPai said. Exclude turns whose reply `source` is not `model`
or `plugin` with `ok: true` (read the turn row's own fields; do not
pattern-match reply text), or label them so the model cannot mistake
them for an answer. Acceptance: a test with a guard-cut turn and a
failed-plugin turn in conversation one, then a recall in conversation
two whose context message carries neither as an assistant line. Close
the issue from the commit.

## 4. CHAT-22: every conversational live bench safe to run (S)

As written in BACKLOG.md (one bench setup helper: own disposable data
directory before any database import, no service spawning, connect
only to a supplied URL, refuse a nonempty or household data directory,
`resetDb` never outside bun:test, cleanup deletes only its own rows and
never stops a shared engine, nonzero on failed setup, zero cases can
never report success). Track B already gave the memory bench a guard
of this shape (`scripts/bench/memory/guard.ts`); generalize it rather
than adding a second one. Acceptance per the item; tick it.

## Out of scope

#74 (near-echo cut of a restated disclosure; CHAT-04's territory),
MEM-05 (waits for CHAT-23's corpus), EVAL-01 (its own read-only
session, after this lane), anything Session B owns.
