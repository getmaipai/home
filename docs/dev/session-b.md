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

## Lane 5 item 3: Home's weather card writes a fake turn into real chat history

BACKLOG.md's own "A real bug this session found, not caused by it, and
not fixed here" (session E step 5, 2026-09-06): `runFixedTurn.ts` (the
Home page's `WeatherCard`) calls the exact same `POST /api/turn/stream`
route Chat itself uses, for a fixed "What's the weather like today?"
utterance, and the turn engine persisted every turn it handled
regardless of caller - so every Home page load silently wrote a real,
visible turn into the household member's own Chat history, forever,
with nothing to tell it apart from something they actually typed.

Two shapes were on the table: a dedicated read-only route for fixed
card queries, or a request flag the existing route accepts. Went with
the flag - `ephemeral?: boolean`, additive on `POST /api/turn/stream`'s
body and `runTurnStream()`'s opts (`routes/turn.ts`, `turnEngine.ts`) -
because a dedicated route would have meant a second, parallel
model/safety/reply path to keep in sync with the real one (CLAUDE.md's
"one definition, one implementation" cuts against that directly), while
the flag changes nothing about how the turn is answered: routing,
safety (both input and `gateOutputSafety()`'s output-side boundary),
tool calls, and the turn lease all run exactly as they do for a real
message. The only thing conditional on the flag is the log write -
`logTurnSafely()`, called from the three places inside
`runTurnStreamHoldingLease()` that finalize a `TurnValue` (the immediate/
plugin-floor path, a tool-resolved reply, and the streamed-text path).
Skipping `logTurnSafely()` also skips `conversationHistory.ts`'s
`logTurn()`, and since that function is what calls `recordEpisodes()`,
one flag closes off both halves of the bug (the chat-history row and
the episode) rather than needing two separate skips.

`runFixedTurn.ts` sets `ephemeral: true` on its one call; the frontend
carries it as a new trailing parameter on `api.streamTurn()` rather than
an options object, matching that function's existing positional-params
shape (`thinking`, `signal`, `conversationId`, `supersedes` are already
positional). `runTurn()` (the non-streaming `POST /api/turn`, unused by
any widget today) was deliberately left untouched - the bug and the
acceptance criteria are both about the streamed route Home actually
calls, and adding the flag there too with no caller would be scope
nothing asked for.

Verified on a spare-port backend (`PORT=18796 MAIPAI_DATA_DIR=<throwaway
dir> bun run src/index.ts`, a fresh household, `sqlite3` reading
`hub.db` directly): before any turn, `conversation_turns` and
`episodes` both at 0. `POST /api/turn/stream` with `ephemeral: true` and
the weather card's own utterance answered normally (a real "done" event
with the reply text) and left both tables at 0 afterward. The same
route with `ephemeral` omitted, sent right after, answered the same way
and left one new `conversation_turns` row - proving the flag, not
something else about the request, is what makes the difference.
Backend test: `tests/turnEngine.test.ts`'s two new `runTurnStream()`
cases (the immediate/plugin-floor path via "remember that..." and the
streamed path via the weather utterance itself), each asserting the
table counts are unchanged across the call. Frontend test:
`runFixedTurn.test.ts` asserts the request body carries `ephemeral:
true`; `HomePage.test.tsx`'s existing weather-card tests were updated
for the new field in their own body assertions.

**Code review (medium effort) found seven issues; two fixed here,
two escalated.** Fixed: the `if (!opts.ephemeral)` guard was duplicated
identically at all three `logTurnSafely()` call sites inside
`runTurnStreamHoldingLease()` - moved into `logTurnSafely()` itself as
the one choke point a future fourth finalize path can't ship without,
and the move surfaced that the guard had also been silently skipping
the operational `[turn]` log line (`logTurnLine()`), the one thing Fix
A4/A5 (docs/dev.md, 2026-09-07 incident) added specifically so a
failing turn is never untraceable - that line now runs unconditionally,
only the persisted row/episode and the now-pointless summary-refresh
schedule stay conditional. Also converted `api.streamTurn()`'s six
positional params (two same-typed optional booleans, `thinking` and
`ephemeral`, three apart) to an options object for everything after
`text`/`signal`, closing the `(text, undefined, undefined, undefined,
undefined, true)` five-blank-call `runFixedTurn.ts` had been reduced to.

Escalated to the coordinator rather than fixed unilaterally: `ephemeral`
is a plain client-supplied boolean on an otherwise ordinary,
`requireAuth`-gated, no-role-check route, honored for any text a
signed-in household member sends. Two consequences follow directly:
(1) `conversationHistory.ts`'s own documented guarantee - a parent
reviewing history can see a request was made and refused - has a real
gap for content a person tags `ephemeral` themselves via a raw request,
never through the app's own UI, which never sends the flag on a typed
message; and (2) an ephemeral turn that happens to route to the
`remember` package (its deterministic-floor pattern match, not
anything Home's card would ever say) still permanently writes a
`MemoryRecord` whose `source` is that turn's id, orphaned the moment
the turn itself is never persisted. Two things bound the real risk
below what they'd otherwise be: `notifyOncePerTurn()` fires from
safety evaluation directly (input-side in `prepareTurn()`, output-side
via `gateOutputSafety()`), entirely independent of `logTurnSafely()`,
so a parent's flagged-content notification still fires for an ephemeral
turn exactly as for a real one - only ordinary, unflagged content can
disappear this way; and the "orphaned" memory record has no FK
constraint to violate (`memoryRecords.source` is a free-text provenance
string, not a reference), so today nothing reads it back and finds a
dangling pointer, it just cannot be resolved by a future feature that
tries. Closing this fully means either a role/trust boundary distinct
from "any signed-in person" or persisting the turn (for audit) while
excluding it from what a person sees, both bigger than this item's
approved "additive flag, skip logTurn and episodes" design - a decision
for the coordinator, not something to expand unilaterally. Filed as
getmaipai/home#91.

## getmaipai/home#91: ephemeral needs a trust boundary, not just a flag

The coordinator's call on #91 above: rather than a new trust tier or a
persist-then-hide redesign, declare the exact question `ephemeral` is
allowed to skip logging for, once, on the backend, and refuse the flag
for anything else. `backend/src/lib/homeCardQueries.ts`'s
`isFixedHomeCardQuery()` is that one declaration - it rebuilds the same
two shapes `HomePage.tsx`'s `WeatherCard` can ask (with or without a
configured `household.home_place`) from that same setting, read
straight off `lib/settings.ts` rather than duplicated as a second list
anywhere in the frontend, and compares the submitted text against it
exactly. `routes/turn.ts`'s POST /stream now only honors `ephemeral:
true` when that check passes; a request that sets the flag on anything
else is logged exactly as if the flag had never been sent, plus a
`console.warn` naming the actor, so a stray or misbehaving caller is
visible in the operational log rather than silently ignored.

This keeps the parent-visibility guarantee (a household member cannot
make an arbitrary message disappear from their own history just by
setting a client-side flag) without adding a new actor/role concept and
without ever persisting a turn only to hide it again later - the
ordinary case (a real message) is untouched, and the one exempted case
is named, not inferred. A future second ephemeral-eligible card gets
its own line in `isFixedHomeCardQuery()`, not a looser pattern.

Verified on a spare-port backend, reading `hub.db` directly: the
weather card's own question with `ephemeral: true` still leaves
`conversation_turns` unchanged; an unrelated sentence with the same
flag writes a row exactly as an ordinary turn would, and the server log
carries the warning. Backend test:
`tests/turnEngine.test.ts`'s new `getmaipai/home#91` suite, going
through the real `POST /api/turn/stream` route (not `runTurnStream()`
directly) since the enforcement lives in the route, not the engine.

**A second review pass on this fix (medium effort) found two more real
issues, both fixed here.** First: the fixed question template was
hand-duplicated in `homeCardQueries.ts` instead of imported from the one
place `HomePage.tsx`'s `WeatherCard` builds it - exactly the drift risk
this fix exists to prevent (a future wording edit in one place silently
stops the other from matching, quietly regressing lane 5 item 3's own
bug with no test failure to catch it). Fixed by extracting the shared
builder into `backend/src/homeCardQuestions.ts`, alias-free like
`wire.ts` for the same reason - so `HomePage.tsx` imports the identical
function through the `@maipai/home-backend` workspace dependency
(`@maipai/home-backend/src/homeCardQuestions`) instead of retyping the
template. Second: the with-place shape (`household.home_place` set) had
no automated coverage through the real route, only the manual spare-
backend check named above - added
`tests/turnEngine.test.ts`'s with-place case, plus one proving the
place-free shape is correctly refused once a place is configured (using
a deterministic-floor phrase, not a live-model one, after the first
draft's "good morning" case hit an unrelated cross-test race: a
neighboring engine-down simulation can leave the chat engine pointed at
a dead port for whichever test runs right after it). Also hoisted the
route's twice-evaluated `body.ephemeral === true` into one
`requestedEphemeral` (a smaller finding from the same pass). Closes
getmaipai/home#91.
