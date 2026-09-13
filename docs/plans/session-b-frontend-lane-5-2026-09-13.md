# Session B: lane 5 (2026-09-13)

Work order from the coordinating session. Same rules as lane 4
(`session-b-frontend-lane-4-2026-09-13.md`): frontend-first on `main`
in the shared checkout beside Session A (backend, the CHAT program:
`turnEngine.ts`, `turnActivity.ts`, `turnContext.ts`, `guards.ts`,
`safety.ts`, `memoryJudge.ts`, `conversationHistory.ts`, `routes/turn.ts`,
`routes/openai.ts`). Gate on your own diff in a throwaway worktree,
`git add -p` on `BACKLOG.md`, your sections in `docs/dev/session-b.md`
with an index line in `dev.md`, spare-port backends by pid, report on
ready, done, blocked, question, low context. Where an item below
needs a backend line, it names the file and the exact change; message
Session A before touching any file in its list and keep the change
additive. Commit this file with item 1.

## 1. Stale BACKLOG line: the a11y gate is already wired (S, docs)

BACKLOG.md "Wire `bun run a11y` into `scripts/check.sh`" (UI / shell,
~line 3344) still reads as open; your cdd80f0 did it. Tick it with a
one-line status pointing at that commit and at the a11y fixes in
aaaf724. Same commit as item 2.

## 2. getmaipai/home#64: the chat "memory updated" chip never shows (S)

The judge fires `memory.updated` with only a summary; the chip
(`chatMemoryChip.tsx`, `useMemoryUpdatesByTurnId()`) needs `turn_id`
and a non-empty `memory_ids`. This is the single most visible reason
memory feels absent: a person states a fact and nothing on the message
shows it was kept. The backend line is in `memoryJudge.ts`, Session A's
file and mid-CHAT-03 territory: message Session A with the exact
payload change (add `turn_id`, `conversation_id`, and the ids returned
by `remember()`/`supersede()`, keep `summary` for the bell) and ask it
to land that line and its judge test in its next commit, or to tell
you to do it additively; do not edit the file unprompted. Your half:
the chip renders from that payload, a frontend test with the new
payload shape, and a live check on a spare-port backend where you
state a fact, wait for the judge (the background engine on 8789 must
be up; use the household engines by URL), and see the chip on that
message; screenshot opened. Close the issue from whichever commit
completes it.

## 3. Home's weather card writes a fake turn into real chat history (S-M)

BACKLOG.md "A real bug this session found, not caused by it, and not
fixed here" (UI / shell, ~line 3945): `WeatherCard` (`runFixedTurn.ts`)
calls `POST /api/turn/stream` for a fixed utterance and the engine
persists it, so "What's the weather like today?" appears in the
person's real chat history every time the Home page loads. Decide the
fix with the smallest surface: a request flag the turn route accepts
(`ephemeral: true`, additive, `routes/turn.ts` and the `runTurnStream`
opts, Session A's files, same protocol as item 2) that skips `logTurn`
and episodes, or a dedicated read-only route for fixed card queries.
State the choice and why in session-b.md. Acceptance: a Home visit
adds no turn to the conversation list or the episode store (assert
through the API on a spare backend, before and after); the card still
shows weather; a backend test for the flag. Tick the item.

## 4. Withdrawn: chat stream reconnection (2026-09-13, outside review)

The item assumed a finished reply exists to fetch after a client
disconnect. `routes/turn.ts` aborts generation on disconnect, so it
does not. The backend lifecycle (continue to completion and log, or
return an explicit interrupted result) is decided in CHAT-17's design
note by Session A; the client half returns to a Session B lane after
that. The BACKLOG item stays open with a note saying so.

## 5. getmaipai/home#90: Firefox still gets precache interception (S)

`sw.ts`'s passthrough gates only the custom fetch listener;
`precacheAndRoute()` registers its own unconditionally. Gate all
interception on the same check, correct the header comment, and
verify the built worker in real Firefox through Playwright's firefox
project, recording what you observed. Close the issue.

## Out of scope

The home screen redesign (Jesse's decision first), unified search,
the screenshot matrix pipeline, #75, #81 (a prompt matter, Session A's
CHAT-01/02 territory), anything in Session A's CHAT items.
