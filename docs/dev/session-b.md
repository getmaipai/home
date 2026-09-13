# Session B: frontend, from #60 on (2026-09-13)

Work order: `docs/plans/session-b-frontend-lane-4-2026-09-13.md` (and
its lane 3 predecessor). Items 1 and 2 of lane 4 are documented in
`docs/dev.md` directly (written before this file existed); everything
from item 3 (`getmaipai/home#60`) on is documented here instead, one
"## <item>" section per shipped item, with a one-line index entry added
to `docs/dev.md`'s own "After the 2026-09-12 block" heading - splitting
detailed write-ups into a per-session file rather than a shared
`dev.md`, since two sessions both appending to the end of one file left
no unchanged context lines between their additions, so `git diff` could
not tell them apart as separate hunks (found live, 2026-09-13: Session
B's PWA commit accidentally carried Session A's uncommitted CHAT-22
section along with it).

## getmaipai/home#60: an edited message survives a history reload

### Scoping correction: `supersedes` is backend-only, not a spec change

The lane 4 plan file's own item 3 originally said "spec first": read
`spec/schemas/conversation.schema.json`, add `supersedes` there,
regenerate bindings, add a round-trip fixture. That was wrong, caught
before any spec work started (coordinator ruling, 2026-09-13, quoting
`conversationHistory.ts`'s own header comment): platform plan 4.14
draws a real line between the conversation THREAD (spec-shaped,
`conversations` table, syncs to a robot or a second hub) and its
individual TURNS (`conversation_turns`, hub-internal, a raw utterance
log that deliberately never syncs). `supersedes` describes an edit
branch WITHIN that per-hub utterance log, not a property of the
synced thread record, so it belongs exactly where every other
`conversation_turns` column already lives: a nullable column with a
migration, on the DB row directly. No `spec/schemas/` edit, no
fixture, no `bun run gen:ts`/`gen-py.sh` regeneration - there is no
spec file for a turn to add a field to. The plan file itself is
corrected in the same commit as this note (its own "M, spec first"
title and body rewritten to say this).

### Shipped: `supersedes`, end to end

Backend: `supersedes: text("supersedes")` on `conversation_turns`
(`backend/src/db/schema.ts`, migration 0030 on top of Session A's 0029,
schema version 28 to 29), following `memoryRecords.supersededBy`'s own
precedent exactly - a plain column, no `.references()` FK, since
Drizzle's self-referencing FK typing buys nothing a real, resolvable id
doesn't already give for free. `logTurn()` (`conversationHistory.ts`)
writes it from a new `opts.supersedes`; `POST /api/turn` and `/api/turn/
stream` (`routes/turn.ts`) accept it in the body; `runTurn()`/
`runTurnStream()` (`turnEngine.ts`) carry it through their own `opts` to
all four `logTurnSafely()` call sites (immediate, tool-resolved, and the
two ordinary-stream-finish paths). Coordinated with Session A per its
own "wait on turnEngine.ts and routing.ts until ROUTE-01 lands" request:
`conversationHistory.ts`/`routes/turn.ts` first (confirmed clean), then
`turnEngine.ts` once ceb354d was on `main`.

Frontend: `chatHistoryAdapter.ts` switched from `ExportedMessageRepository.
fromArray()` to `fromBranchableArray()`, rebuilding the real tree from
`rowsToBranchableMessages()` - a row with no `supersedes` extends the
running chain (the previous reply); a row that supersedes turn X attaches
under whatever X's own user message's parent was (a sibling of X, not a
child - what makes the branch switcher show "1/2, 2/2" instead of two
exchanges), remembered per row so a third edit of the same slot chains
off the same anchor as the first two. Getting `supersedes` out of the
browser in the first place took two real dead ends before landing:

1. First tried `unstable_parentId`/`unstable_getMessage()` on
   `ChatModelRunOptions` - neither carries the edited message's own id
   (`unstable_parentId` is the freshly-appended message's own id, not
   what it replaced; assistant-ui's edit path never threads a `sourceId`
   that far). Confirmed by reading `local-thread-runtime-core.ts` and
   `default-edit-composer-runtime-core.ts` directly.
2. Then tried `composer.send`'s own event (`@assistant-ui/store`'s
   `ComposerEvents`, documented: "`messageId` is set when the send came
   from an edit composer") via `useAuiEvent` in a small tracker component
   mounted next to `SttAutoSend` in `ChatPage.tsx`. Confirmed live
   (2026-09-13) that a PLAIN send's event reached it, but an EDIT's never
   did, `{ scope: "*" }` included - the edit composer's own client is a
   MESSAGE-scoped one, and per `useAui.ts`'s own `on()` implementation, a
   subscription's chain only walks UP a client's ancestors, never down
   into a sibling subtree it isn't itself nested in.
3. What actually works: read the state directly from inside
   `EditComposer` (`thread.aui.tsx`), which already sits in that exact
   message's own scope. `useAuiState((s) => s.message.id)` plus
   `useAuiState((s) => s.thread.messages)` (the CURRENTLY DISPLAYED
   branch) finds the reply right after the edited message and reads its
   `metadata.custom.turnId` - computed inside the "Update" button's own
   `onClick`, composed to run before assistant-ui's real send callback
   (`createActionButton`'s `composeEventHandlers`), and stashed in a
   plain module-scope ref (`chatEditSupersedes.ts`, the same "ref, not an
   event pair" shape `chatListenStore.ts` already uses) that
   `chatModelAdapter.ts`'s `consumeSupersedes()` reads and resets,
   mirroring `consumeThinking()`'s single-shot pattern.

That last piece needed one more fix to work for a message edited in the
SAME session it was sent in (not only a reloaded one): the reply's
`metadata.custom.turnId` was previously populated only by
`chatHistoryAdapter.ts` on reload (chatActionBar.tsx's own comment named
this gap explicitly: "a message from the CURRENT live session has
none"). `chatModelAdapter.ts`'s "done" yield now stamps
`turnId: event.value.turn_id` onto every live reply's own metadata too,
closing that gap for "Remember this"/"Forget this" as a side effect, not
just for #60.

Verified live (spare backend on a temp port, `bun run src/index.ts`, no
`--hot`): sent a message, got a reply, edited it, clicked Update (branch
switcher: 2/2, the pre-fix client-side behavior), confirmed via
`GET /api/conversations/:id/turns` that the new row's `supersedes` really
carried the old row's id (`turn-ivaka3ysld` -> `turn-wmfgd6wb57`), then
reloaded the page: the switcher was still there, 2/2, and switching to
1/2 showed the original exchange intact. That reload survival is the
acceptance's own "after" state.

One unrelated, not-reproduced-on-retry finding from the same live pass:
a fresh backend boot's very first `POST /api/turn/stream` once threw
`ReferenceError: routingStats is not defined` inside
`ordinaryToolIdsForInstalled()` (ROUTE-01/ROUTE-02 territory, not
touched by this item); killing and restarting the same backend made it
disappear immediately and it did not recur across several more fresh
boots. Filed as getmaipai/home#84 rather than chased further here, since
it's Session A's lane and I could not get it to reproduce a second time.

Backend test: `tests/conversationHistory.test.ts`, `logTurn`'s
supersedes option" - defaults to null; an edit-and-resend writes a new
row carrying the old turn's id while the old row stays untouched, both
rows persisting. Frontend tests: `chatHistoryAdapter.test.ts` (five new
cases, one caught a real bug in my own first draft - `?? chainTail`
can't tell "not found" from "found and genuinely null", `.has()` can)
and `chatModelAdapter.test.ts` (`consumeSupersedes()`'s value reaches the
request body; a live reply's `turn_id` reaches its own metadata). A full
`ChatPage.test.tsx` render of the real edit-click-Update flow hit the
same happy-dom/Radix hover-and-click limitation the file's own header
comment already documents for `ActionBarMorePrimitive` - not pursued
further for the same reason, verified live instead.
