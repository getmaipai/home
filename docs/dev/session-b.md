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

## getmaipai/home#90: Firefox still got precache interception

`sw.ts`'s own header comment claimed Firefox was "passed through
entirely (no fetch interception at all)", but that gate
(`PASSTHROUGH`) only wrapped the CALLBACK of the navigate-handling
listener, not the `self.addEventListener("fetch", ...)` call that
registered it - the listener existed either way, it just always
returned early on Firefox. Worse, `precacheAndRoute()` a few lines
below registered its OWN separate 'fetch' listener (workbox's routing
system, via `addFetchListener()`) completely unconditionally, so
Firefox was still getting real precache interception for every JS/CSS/
font/icon request - exactly the thing the comment said wasn't
happening. Fixed by moving both under the SAME `if (!PASSTHROUGH)`
block - the navigate listener's own `self.addEventListener` call and
`precacheAndRoute()` both live inside it now, one guard instead of two
textually separate ones (a first draft gated them as two independent
`if` blocks, which a second review pass flagged as the identical
"gated the first site, missed the second" shape that caused this bug
in the first place - a future third registration has to either join
this one block or sit visibly outside it, not silently slip through a
second copy of the check). `cleanupOutdatedCaches()` stays OUTSIDE the
block, unconditional, on the same review's finding: it only registers
an `'activate'` listener that deletes stale `-precache-` caches, and a
Firefox household that hit this exact bug before the fix shipped may
still be carrying a real leftover precache entry from when Firefox
wrongly had one - gating cleanup too would leave that stuck forever.
Firefox now registers zero 'fetch' listeners of any kind, matching the
comment literally instead of only in spirit.

**Verification note.** The acceptance for this item called for
checking the built worker in a real Firefox via Playwright's firefox
project. That build cannot start on this machine: `firefox.launch()`
in headless mode fails immediately with "Could not find profile
folder" (tried twice, once with `TMPDIR` pointed at a fresh writable
directory instead of the system default, same result both times - not
a permissions issue on one specific path). A non-headless attempt was
made once, which opened a REAL, visible Firefox window - a hard rule
from this incident: a session never launches a browser with a visible
window (a window on the machine's desktop is a machine change), and a
headless engine that cannot start after one retry is the finding,
recorded, not a reason to fall back to non-headless. No further
Firefox launches were attempted after that rule was set.

What was actually proven instead: `src/sw.test.ts` loads the real
built `sw.ts` module (not a reimplementation of its logic) with a
faked `self` global under two user agents - a real Firefox one and a
real Chromium one, in that order within one test so the ordering is
guaranteed rather than an accident of file layout - and counts how many
`'fetch'` listeners each registers. Firefox: zero. Chromium: at least
one (the exact count depends on `workbox-precaching`'s own internal
registration, not something this test pins to a specific number). This
exercises the real code path `precacheAndRoute()`/`cleanupOutdatedCaches()`
run through against real `workbox-precaching`, just outside a real
browser's `ServiceWorkerGlobalScope`.

The compiled `dist/sw.js` was also read directly after a real `bun run
build`, not grepped for a line or occurrence count (a first draft's own
`grep -c` on a single minified line always returns 1 regardless of how
many times the pattern actually occurs - a code review caught that it
could never fail, proving nothing). Reading the actual substring around
the navigate listener's call site shows the real gating survived
minification intact: `` /\bFirefox\//.test(self.navigator?.userAgent??``)||(self.addEventListener(`fetch`,e=>{...}),`` -
one short-circuited `||` covering both the listener registration and,
immediately after it in the same expression, `precacheAndRoute()`'s own
call, exactly matching the source's single `if (!PASSTHROUGH) { ... }`
block. The OTHER occurrence of the literal string `` addEventListener(`fetch`) ``
in the bundle is workbox-routing's own `addFetchListener()` METHOD
DEFINITION (library code, always present in the bundle whether or not
it's ever invoked) - a bare occurrence count can't distinguish "defined"
from "called," which is exactly why this is read directly rather than
grepped for a number.

**What still needs a real Firefox, and how to check it**: this repo's
own environment cannot start one, so this is a check for whoever next
has a working Firefox (Jesse, or a session on a different machine).
Two steps: (1) load the app in Firefox pointed at the real LAN hub
(not `localhost` - the bug this passthrough exists for is specifically
about a LAN hostname) and confirm pages load and the app works,
matching a healthy `localhost`/Chromium session; (2) open
`about:serviceworkers`, find this worker, and confirm it has no
`fetch` handler listed at all (Firefox's own devtools show registered
event types) - `about:debugging#/runtime/this-firefox` also works and
lets the worker be inspected directly. Either finding a `fetch` handler
present, or the app failing to load real hub requests, means this fix
did not hold and should be reopened.

## MEM-05: the judge eval on the 1.7B, 4B and 8B, with the real scorer

Read-only bench lane per `docs/plans/measure-first-2026-09-13.md`
section 3: run `backend/scripts/bench/judge-eval.ts` (#87's real
extraction scorer, `judgeScore.ts`) against all three candidate judge
models and apply MEM-05's own rule. The 1.7B's number with this scorer
already existed from a5015c1 (precision 66.7%, recall 100%, retrieval
0/2, 2.59s/turn); this pass adds the 4B fallback and a real 8B baseline
run through the identical scorer, since neither existed with it before.

Engines: the hub's own three (8788 chat/8B, 8789 background/1.7B, 8794
embed) stayed untouched throughout - the 1.7B number is theirs already,
recorded before this pass. For the 8B baseline, `MAIPAI_BACKGROUND_URL`
was pointed at the hub's own already-running 8788 (the same model the
rule needs as its baseline is already serving chat; no second 8B
process, no GPU contention), with `MAIPAI_LLAMA_SERVER_URL` also
pointed at it - `judge-eval.ts` never actually calls the chat role, so
setup.ts's Rule 2 URL requirement is satisfied by a URL nothing in the
bench script exercises. For the 4B fallback, one llama-server was
spawned on a scratch port (8809, no collision with the hub), with the
production background role's exact launch flags
(`backgroundSupervisor.ts`'s own `spawnBackgroundServer()`: `-c 8192
-ngl 0 -t 4 -fa on --reasoning off --jinja --no-webui --metrics
--cache-reuse 256`) against `qwen3-4b-q4-k-m.gguf`, already on disk -
stopped by pid immediately after that one run, before the 8B run
started, so at most one engine beyond the hub ran at a time. Each run
used its own fresh, disposable `MAIPAI_DATA_DIR` under the OS temp
root (`scripts/bench/setup.ts`'s own rule), deleted after.

| judge | precision | recall | retrieval | s/turn |
|---|---|---|---|---|
| 1.7B (Q8_0, port 8789, from a5015c1) | 66.7% (tp 2, fp 1) | 100% (tp 2, missed 0) | 0/2 | 2.59 |
| 4B (Q4_K_M, port 8809) | 100.0% (tp 2, fp 0) | 100% (tp 2, missed 0) | 0/2 | 7.005 |
| 8B (Q4_K_M, port 8788, the baseline) | 100.0% (tp 2, fp 0) | 100% (tp 2, missed 0) | 1/2 | 3.552 |

Same three cases as the original run (`job`, `new job`, `abstention`)
and the same two retrieval probes (knowledge-update, abstention). The
1.7B's one false positive is the same overlapping second "teacher" fact
noted before; the 4B and 8B both extract cleanly. Retrieval: the 8B is
the only one of the three whose SUPERSEDE decision actually retires the
stale "nurse" fact (knowledge-update passes for 8B alone); all three
fail the abstention retrieval probe the same way (something is recalled
for a color question nothing ever stated - 1.7B and 4B both 2 matches,
8B 1 match), a recall-side issue orthogonal to which model runs the
judge - unaffected by this item's own rule, which only names precision
and recall. Filed as getmaipai/home#93 for the baseline conversation
bench (measure-first step 2) to carry as its own row, since the only
records that exist at this point in the scenario are the two job facts,
almost certainly what `recall()` is surfacing with nothing relevant to
return.

**Verdict, by the item's own rule** ("keep the 1.7B pin if recall is at
least 85% of the baseline and precision is within five points;
otherwise switch the default pin to the 4B fallback... If neither
passes, leave this open"): the 1.7B's recall (100%) clears the 85%
bar, but its precision (66.7%) is 33.3 points off the 8B baseline's
100% - nowhere near the five-point band, so the keep-the-1.7B branch
does not apply. The 4B fallback, run against the identical baseline,
matches the 8B on both figures exactly (100%/100%, well inside five
points and past the 85% recall bar) - the "otherwise switch to the 4B
fallback" branch is what the numbers call for, not the "neither
passes" branch (which needs the 4B to fail the same bar the 1.7B
failed; it doesn't).

**Not applied**: `backgroundAssets.ts`'s default stayed the 1.7B pin.
The item's own text says to make this change directly, but
`measure-first-2026-09-13.md`'s framing for this lane is explicit -
"MEM-05 and EVAL-01 as one lane, both benches only, no product change
beyond EVAL-01's one catalog entry" - and switching the household's
default background model is a real product change (download size,
memory, and roughly 2x the per-turn latency the table above shows).
Recorded here and flagged to the coordinator rather than decided
unilaterally, since the lane's own framing and the item's own action
clause point in different directions for this specific case.

**Ruling (coordinator, 2026-09-13)**: the pin stays the 1.7B. The
item's rule, applied as written, does point to the 4B on this n=2
corpus, but two cases is too small a sample to move the household's
default background model on, and the 4B costs 2.7x per judged turn for
that thin an edge - the org's own rule for model changes applies here
too: a recommendation is not a switch. MEM-05 stays open; re-run once
the baseline conversation bench's disclosure rows exist (measure-first
step 2) for a real sample size, then it is Jesse's call.
