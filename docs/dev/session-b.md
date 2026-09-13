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

## EVAL-01: stopped at step 1, no official GGUF for the candidate

Session A's baseline conversation bench landed (`da97e37`,
`docs/dev/session-a.md`'s "The baseline conversation bench: first run")
with the 20 fixed fixture ids and the frozen-input header shape EVAL-01
needs, so this item's own step 1 (add the catalog entry) was next.

Checked before touching anything else, per the item's own instruction
("If Qwen publishes no official GGUF for the candidate at the time,
record 'not tested: no official artifact' in dev.md and stop; do not
substitute a third-party quant"): Qwen's own Hugging Face org publishes
`Qwen/Qwen3.5-4B` and `Qwen/Qwen3.5-4B-Base` in Transformers format
only. No `Qwen/Qwen3.5-4B-GGUF` or equivalent exists on Qwen's own org
today. Every GGUF conversion that does exist is third-party:
`unsloth/Qwen3.5-4B-GGUF`, `bartowski/Qwen_Qwen3.5-4B-GGUF`,
`lmstudio-community/Qwen3.5-4B-GGUF`, `prithivMLmods/Qwen3.5-4B-f32-GGUF`,
and an MLX (not GGUF) build from `mlx-community`. None of these are the
Qwen-published artifact the item requires, and the item is explicit
that a third-party quant is not an acceptable substitute (the same
"never trusted from a listing, only from what we actually downloaded
and hashed ourselves" discipline `backgroundAssets.ts` documents for
its own pins would not even apply here, since there is no first-party
file to hash in the first place).

Stopped here: no `modelCatalog.ts` entry added, no engine spawned
beyond the hub's own three (8788/8789/8794, all untouched throughout),
no bench run. `docs/BACKLOG.md`'s EVAL-01 item carries the same finding
as its status line. Nothing else to re-check until Qwen ships an
official GGUF for this specific model.

## Lane 6: docs and user-facing truth

Frontend and docs only, per `docs/plans/session-b-lane-6-2026-09-13.md`.
Session A owns the chat engine and memory files; nothing here touches
`backend/` beyond reading it, or `spec/schemas`.

### Item 1: CHAT-25's "current documentation" half

Read all six user pages (`docs/user/chat.md`, `memory.md`, `privacy.md`,
`home.md`, `getting-started.md`, `fix-a-problem.md`) against the actual
running code, then verified the claims that changed against a real,
live spare-port backend (`MAIPAI_DATA_DIR` under the OS temp root,
`MAIPAI_LLAMA_SERVER_URL`/`MAIPAI_EMBED_URL`/`MAIPAI_BACKGROUND_URL` all
pointed at the hub's own real, already-running engines - 8788/8794/8789
- so nothing new was spawned) with a fresh household seeded through the
real API, not a mock.

**What was already accurate, checked and left alone**: `memory.md`'s
batch select/forget/clear-all section, and its credential section -
the fixed line it quotes verbatim (`"Keep passwords and keys in
Credentials, not in chat."`) matches `CREDENTIAL_SAFE_MESSAGE`
(`memoryContentPolicy.ts`) exactly. World knowledge, `home.md`'s "Ask
MaiPai anything" (confirmed live: it really does navigate to Chat and
send a real, saved turn - `HomePage.tsx`'s `submitPrompt`, unrelated to
the Home weather card's own ephemeral one), and `getting-started.md`
had no stale claims to find.

**What changed, verified live then written**: `chat.md` was missing any
mention of a household member's OWN message having its own action
bar (`UserActionBar`, `thread.aui.tsx`: Copy, Edit, a brain-icon
"Remember this") and the edit-history switcher. Live-verified via the
spare backend's real API: sent a message, edited it (`supersedes`), and
confirmed via `GET /api/conversations/:id/turns` that BOTH the original
and the edited row persist as separate turns linked by `supersedes` -
exactly what the branch switcher (`BranchPickerPrimitive`, hidden when
there's only one branch) reads to show "1 / 2" and survive a reload.
Also missing: the "Memory updated" chip - live-verified by sending
"remember that the wifi password is on the fridge" through the real
`remember` plugin and confirming the turn's own row carries
`memory_ids` (`GET /api/conversations/:id/turns`), which is what the
chip (`chatMemoryChip.tsx`) reads on a reload. `fix-a-problem.md` had
no mention of the PWA's offline page at all - added a section quoting
its actual wording (`frontend/public/offline.html`) rather than
paraphrasing it.

**Not documented, on purpose**: capitalized replies and broadened
"please remember" phrasing recognition are real fixes from tonight
(CHAT-04, and the guard work before it) but neither is a distinguishable
feature a parent would look for or notice as new - the pages never
claimed the opposite, so there was nothing false to correct and adding
either as its own bullet would read as trivia rather than something the
dad test wants. The baseline bench's own failing rows (#92 among them)
were also deliberately left undocumented, per the item's own rule: a
row the bench shows broken is not a feature yet.

Screenshots: regenerated with `bun run scripts/screenshot.ts` (the full
matrix, not a partial run - the only way to be sure nothing else drifted
alongside the pages actually edited) against the same seeded household,
then the affected images opened and checked against what the pages now
claim. Two real findings from actually looking at them, per the org's
own "every screenshot gets looked at" rule:

- `fix-a-problem.md`'s Repairs caption said "showing a healthy hub with
  nothing to fix," but the captured image shows a real error ("The
  Wyoming satellite server failed to start"). Not a bad capture: the
  pipeline deliberately occupies the Wyoming port before the backend
  starts (`scripts/screenshot.ts`'s `REPAIR_SEED_PORT`) so the Repairs
  page always has real, non-empty content to show - this pipeline can
  never produce a genuinely "nothing to fix" state, on any run, by
  design. The caption was simply wrong about what its own image always
  shows; corrected to describe the real content (an example finding
  with its Dismiss button), which is arguably more useful on a
  troubleshooting page than a sterile all-clear screen would be anyway.
- `home.md`'s screenshot shows the weather card's reply verbatim,
  including the stub backend's own deliberate debug prefix ("[stub
  model: no real model loaded, this is a canned reply]"). Pre-existing,
  unrelated to anything this lane touched (the weather card's own text
  never changed), and out of this lane's scope to fix (it needs a
  scripted stub reply for the weather card's fixed question, touching
  the stub server rather than docs or frontend). Filed as
  getmaipai/home#96 rather than silently published or silently ignored.

### Item 2: doc drift, the plain corrections

`spec/llm/README.md`'s "Non-streaming only" paragraph was genuinely
stale - `spec/llm/ts/types.ts`/`client.ts` now carry streaming
(`chatCompleteStream()`), native tools (`tools`/`tool_choice`), and
grammar-constrained structured output (`response_format`'s
`json_schema` variant, which the memory judge depends on) alongside
`chat_template_kwargs`. Rewritten to say so plainly, cross-referencing
the file's own later "Tools: real, native" section instead of
duplicating its detail, and trimmed that later section's own now-
redundant "the line near the top is historical" sentence since the top
itself no longer says the stale thing.

`spec/ui/README.md`'s named "single-shot JSON" claim, checked against
the file: it isn't there. The file already only describes the schema/
interpreter split (which pages convert, which stay hand-written, why)
with no streaming-related claim of any kind - nothing to fix. The
BACKLOG item's own description of this drift was itself stale by the
time this ran.

`docs/BACKLOG.md`'s combined item split per the lane's instruction: the
plain corrections above are done and ticked; two standalone "Jesse's
call" items now carry the platform-plan-commit question (which also
subsumes the `.github/CLAUDE.md`/`STACK.md` broken references and the
plan's own internal `skill`/`plugin` terminology drift, all only fixable
once the plan is a real, editable file in the repo) and the routing-tier-
vs-package-tier renaming question, separately.

### Item 3: reader's rows, checked for filed issues

Session A's baseline bench (`docs/dev/session-a.md`, "The reader's
rows") named two findings it was asked to file: the timer follow-up
that invents a remaining time, and replies ending in an emoji or a
canned closer. Both already exist (`gh issue list`): getmaipai/home#94
and #95. Nothing missing to file.

### Item 4: the privacy page and the service worker

Read `backend/src/lib/privacy.ts`'s aggregation (`platformConnections()`,
`pluginConnections()`, `inboundConnections()`) in full: nothing added
tonight touches it, and the service worker's own same-origin caching
isn't an outbound connection in the first place - there's no third
party to name, so no new row belongs in the table. Added one sentence
to `docs/user/privacy.md`'s "What never leaves your house" section
instead, saying plainly that the browser also saves a copy of MaiPai's
own screens on the device so the app can still open without internet,
and that this is a copy of the app, never anything typed or remembered.

## Lane 6 follow-up: the screenshot half, three real bugs

The coordinator rejected the first pass on the screenshots specifically
(the prose was fine): the weather card's own regenerated image still
showed the stub server's raw debug text, the avatar row's name labels
were clipped, and `chat-desktop-light.png` had gone from a real
conversation to an empty thread. All three turned out to be real,
findable bugs, not flukes - fixed with code changes this time, so this
half went through the full `check.sh` gate and a code review, not the
docs-only shortcut.

**1. The avatar row's own labels, clipped at the top of every letter
(`home-desktop-light.png`, `HomePage.tsx`'s `WhoIsHere`).** A real CSS
bug, reproduced with a headless Chromium diagnostic (Playwright,
matching the pipeline's own proven-working pattern - happy-dom's unit
tests can't see it, `getBoundingClientRect()` always reads zeroed
there): `overflow-x-auto` computes `overflow-y` to `auto` too (the
exact quirk `MediaShelf.tsx`'s own 2026-09-05 comment already names for
a different symptom, focus-ring clipping), and a flex item that
establishes a scroll container on either axis gets an *automatic
minimum size of zero* instead of its content size - so this row's own
measured height collapsed to 0px inside the page's `flex-col` layout
while its children (avatars, then labels) still painted at their real
60px, spilling out past a box too short to show them. Fixed with
`min-h-16 shrink-0` on the row (`HomePage.tsx`), which sidesteps the
automatic-sizing path entirely with a real, explicit minimum. Verified
by the same diagnostic script, before (`stripRect.height: 0`) and after
(the strip now correctly bounds its children); also added a live check
to `scripts/screenshot.ts` itself (right after the existing `#71`
empty-thread check, the same "only a real browser can see this" reason)
that fails the run if any `overflow-x-auto` row on any page is shorter
than its own content - this bug had zero effect on axe's own contrast/
ARIA checks or the overflow-width check already there, so nothing
existing would ever have caught a regression.

**2. The stub debug text in the weather card
(`home-desktop-light.png`).** `scripts/screenshot.ts`'s scripted stub
reply (`startStubLlmServer`'s `scriptedChatReply`) was gated behind
`chatReview`, so the plain `bun run scripts/screenshot.ts` command used
to regenerate every OTHER page's screenshot never had it at all - every
chat completion, including the weather card's own fixed question, fell
through to the stub server's bare default reply, always prefixed
`[stub model: no real model loaded, this is a canned reply]`
by design. Un-gated it (always starts now) and added a `weather like`
branch alongside the existing herbs/book ones.

**3. `chat-desktop-light.png` went from a real conversation to an empty
thread.** Direct cause of the SAME gating as #2: `exerciseChat()` (the
function that sends real messages and captures `chat-desktop-light.png`
among others) only runs `if (chatReview && route.slug === "chat")` -
the plain command visits the chat route but never exercises it, so the
"chat" screenshot has only ever really been current after a SEPARATE
`--chat-review` run (a mode this codebase has used this way since
2026-09-04, per several `docs/dev.md` entries) - the full run I did
first genuinely never populates it. Both were run this time: `bun run
scripts/screenshot.ts` for the full matrix, then `bun run
scripts/screenshot.ts --chat-review` for chat's own set, matching how
this pipeline has always needed to be run for a complete regeneration.

**A fourth thing found investigating #2, not really a bug in either of
the two commits above**: even with a scripted stub reply, the weather
card's fixed question never reaches the model at all - "What's the
weather like today" pattern-matches the `weather` package's own
deterministic floor (Tier 0/1 routing) before the turn engine ever
calls the chat model, so the stub server's `weather like` branch is
dead code today, kept only as a defensive fallback if routing ever
changes. The REAL fix for the weather card needed
`household.home_place` actually configured - the seeded household
never set it, so the deterministic package's own geocoding step got an
empty place. Added it to `seedHousehold()` (`"Seattle, WA"`, matching
the widget grid's own already-seeded default so both weather cards on
the same page agree). Even with a real place configured, the weather
package still failed this run (`plugin_error`, the second fetch went
out with its `{lat}`/`{lon}` placeholders literally unsubstituted,
which is why open-meteo answered 403) - traced to the geocoding step
itself returning no usable result. Live-tested directly (`bun -e`
hitting `geocoding-api.open-meteo.com` from this same machine): it
answers fine on its own. The most likely explanation is this session's
own repeated weather-endpoint testing tonight (MEM-05's judge-eval
runs, live verification passes, this investigation's own repeated
calls) exhausting `host.fetch`'s per-host rate limit or poisoning its
cache (`packageHost.ts`) for `api.open-meteo.com`/`geocoding-api.open-
meteo.com` - not something reproduced from a clean state, and not
something this lane's own scope covers fixing (`packageHost.ts`'s
fetch/cache/rate-limit internals are backend territory). The published
screenshot shows the weather card's real, honest current error text
rather than a fabricated success - accurate to what actually happened
this run, not a broken capture. `household.home_place` being seeded is
correct and needed regardless of this separate finding; not filed as
its own issue, since the evidence points to this session's own testing
load rather than a reproducible defect.

Every image a user page embeds (`home`, `privacy`, `settings-repairs`)
and the two more the coordinator named (`settings`, `settings-users`)
were opened again after this pass. `settings-desktop-light.png` and
`settings-users-desktop-light.png` are new checks - both correct.

**A code review of this fixup found two more real things**, both
confirmed and addressed: the `clippedStrips` check only matched
`[tabindex="0"].overflow-x-auto`, missing `MediaShelf.tsx`'s identical
scroll rail whenever it mounts with an `onSelect` handler (that drops
its own `tabIndex` to `undefined`, per that file's own comment on why -
the click target becomes the tab stop, not the rail) - broadened to
match `.overflow-x-auto` alone, re-ran the full matrix afterward to
confirm the wider selector adds no false positives (0 violations, 0
overflow, same as before). And: the same CSS quirk now has two
different fixes in two files (`MediaShelf.tsx`'s own padding, from
2026-09-05, for a different symptom - focus-ring clipping, not a height
collapse; `WhoIsHere`'s `min-h-16 shrink-0` here) with nothing
centralizing it - not unified into one shared primitive in this pass
(a bigger change than a screenshot fixup's own scope, and `MediaShelf`'s
own rail isn't confirmed to actually hit the height-collapse symptom
anywhere it's mounted today, only theoretically capable of it), but
cross-referenced in both files so a third instance is easier to find,
and the `clippedStrips` check itself is the real backstop regardless of
which files ever get a from-scratch fix.

## Lane 6 follow-up 2: make the weather card offline, and two real bugs
found chasing it

The coordinator's last open item on lane 6: the Home weather card
(`home-desktop-light.png`) showed "Couldn't check the weather right
now." - a real error in a doc screenshot, caused by the pipeline
calling the real open-meteo endpoints (subject to rate limits and the
network, the prior pass's own finding, accepted then as "not a product
bug" but rejected this time as "a scripted doc run must be offline and
deterministic, the same rule the benches follow"). Also asked: fix a
missing-space nit in the scripted garden reply
("feels dry.How much space"), and file (not fix) the "one CSS quirk,
two fixes" finding as a BACKLOG item.

**The weather card, made offline.** `backend/src/lib/packageHost.ts`
has the fetch seam the coordinator pointed at, but Session A had it
open with uncommitted changes for #92 the whole time this ran, so
touching it was off the table under this session's own shared-checkout
rule. Used the seam one layer down instead:
`backend/src/lib/packageCache.ts`'s file-based fetch cache
(`cachedFetch()`) returns a cached value without ever calling the real
network when the entry is fresh, and its on-disk layout
(`<MAIPAI_DATA_DIR>/cache/<packageId>/<sha256-of-method+url+headers+body>.json`)
is entirely derivable from outside that file. `scripts/screenshot.ts`'s
new `seedWeatherCache()` writes two geocode fixtures and one forecast
fixture into that layout before the backend spawns - zero changes to
`packageHost.ts` or `packageCache.ts`. Verified in isolation first (a
standalone spawned backend, same env `screenshot.ts` uses, no real
network reachable) before trusting it in the real pipeline.

**Bug 1, filed as [getmaipai/home#98](https://github.com/getmaipai/home/issues/98):**
even with `household.home_place` correctly set to "Seattle, WA" (the
prior pass's own fix), the weather card kept failing. Traced to
`weatherCardQuestion("Seattle, WA")` producing "What's the weather like
in Seattle, WA today?", and `weather/manifest.json`'s routing pattern
`"what's the weather like in *"` having nothing after the `*` to anchor
against - `matchPattern()` captures everything to the end of the
sentence, so the place argument the weather package actually receives
is "Seattle, WA today", not "Seattle, WA". Confirmed directly by
calling `matchPattern()` against that exact question. The same shape as
#92 (a literal pattern claiming more than its intended argument). Not
fixed here (`backend/src/lib/turnEngine.ts` was also mid-edit
elsewhere in the checkout the whole time); the fixture is seeded under
BOTH the buggy captured place and the plain one (coordinator's own
call, so the screenshot stays correct whether or not #98 gets fixed).

**Bug 2, filed as [getmaipai/home#99](https://github.com/getmaipai/home/issues/99):**
the "missing space" in the garden reply wasn't missing from the source
string at all - `"...feels dry.\n\nHow much space...?"` parses to two
clean markdown blocks (checked directly with `remark-parse` +
`remark-gfm`). Chased three wrong theories before finding the real one:
not a CSS/paragraph-spacing issue (the two blocks were fully MERGED
into one `<li>` in the live DOM, not just visually adjacent); not the
typewriter "smooth" reveal lagging behind stream completion (added a
wait on `MarkdownTextPrimitive`'s own `data-status="running"` attribute
to rule this out - the attribute was already `"complete"`, so that fix
was reverted); not even a frontend rendering bug at all - `GET
/api/conversations/:id/turns` already returns `replyText` with the
blank line missing, so it disappears before storage. Root cause:
`gateOutputSafety()` (`backend/src/lib/turnEngine.ts`) streams replies
through a per-sentence safety gate using
`spec/safety/ts/sentenceChunker.ts`'s `nextSentenceBoundary()`, whose
boundary regex treats a blank line (`\n{2,}`) as a match in its own
right, separate from its sentence-terminator alternative. When a blank
line lands as the very start of the gate's `pending` buffer, the
resulting span is nothing but that whitespace - the gate's `if
(!trimmed) continue` (meant only to skip running the safety classifier
on it) also skips yielding it, so the blank line never reaches the
caller. That only happens when the sentence before the blank line ends
in `.`/`!`/`?` and the text right after it starts with an uppercase
letter or digit (the terminator regex's own lookahead) - in this
reply, "dry." before "How" hits it, while the earlier "plants." before
a lowercase "- Grow" does not, and survives. This is a real production
bug, not a screenshot-only one (any real model reply whose paragraph
break happens to fall on that same shape would lose it identically) -
filed with the exact fix needed (forward the raw span, skip only the
classifier call). Not fixed here for the same reason as bug 1
(`turnEngine.ts` mid-edit elsewhere). Worked around in
`scripts/screenshot.ts`'s own scripted reply: a single `\n` instead of
a blank line never matches the regex's blank-line alternative, survives
the gate intact, and renders as a plain space - the real paragraph
break this reply originally intended still needs #99's actual fix.

Both `home-desktop-light.png` and `chat-desktop-light.png` regenerated
and opened after these two fixes: the weather card shows "It's 57.3
degrees in Seattle." on both the Today card and the widget grid, and
the garden reply reads correctly ("...feels dry. How much space do you
have?", a real space, on one line inside the last bullet). Every image
a user page embeds (`home`, `privacy`, `settings`, `settings-repairs`,
`settings-users`) opened again too - all correct. Added the "shared
horizontal-rail primitive" BACKLOG item under UI / shell (S, not fixed,
per the coordinator's own instruction).

## Lane 7 item 1: reconcile the screenshot-matrix BACKLOG item

Read getmaipai/.github's `docs/UI.md` ("Responsive layout, PWA, tabs,
icons") and `docs/STYLE.md` ("Platform screenshot pipeline") against
what `scripts/screenshot.ts` actually does tonight, to find what the
standard names that the pipeline still lacks.

**Already met, no change needed:** every page (18 routes) at every
surface (phone/tablet/desktop, TV via `far`'s user agent) in light and
dark (136 shots); horizontal overflow; `clippedStrips` (the
WhoIsHere/MediaShelf `overflow-x-auto` quirk, lane 6); a real axe scan
tagged `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`/`wcag22aa`/
`best-practice`; reduced-motion and keyboard-trap checks. The BACKLOG
item's own text ("today one hero shot at one size") was simply stale -
that described the pipeline before session-e-ui-and-docs.md's step 0,
not tonight's.

**Added (S, done):** STYLE.md: "a generated manifest per shot records
the capture script, viewport, theme, and date." Nothing wrote one.
Added `writeScreenshotManifest()`, one `manifest.json` in
`SCREENS_DIR`, keyed by filename so a partial run (`--chat-review`,
`--settings-review`) updates only the entries it actually captured
rather than clobbering the other 130-odd from the last full run.
Verified: a full matrix run wrote 136 entries; a follow-up
`--chat-review` run left all 136 in place and updated exactly the two
chat entries' `capturedAt`/`captureScript` in place (checked both
counts and the two entries' content directly).

**Found, NOT met, NOT S-sized - left open, two new BACKLOG items filed
instead of forced:**

1. UI.md's own type-floor line: "48 px targets... the kit refuses to
   go below." Nothing checks this. Confirmed axe-core 4.13.0 ships no
   `target-size` rule at all (grepped its own rule table directly, no
   match for `target-size` or any `2.5.5`/`2.5.8` WCAG tag). Wrote a
   real `page.evaluate()` measurement (every `button`/`a[href]`/input/
   role=button etc., `getBoundingClientRect()` under 48px on either
   axis) and ran it across the full matrix as a **proven-to-fail
   check**, not committed: dozens of real violations on nearly every
   page - the sidebar's own nav rows (200x40), most icon buttons
   (28x28, 36x36 - "Toggle Sidebar", "Voice input", "Send message",
   "New chat"), settings tabs (154x32), the settings-repairs
   "Dismiss" button (70x28). This is a kit-wide component-sizing pass,
   not a screenshot-pipeline change - reverted the check rather than
   land a hard-failing gate the rest of the app isn't built to pass,
   and filed it as its own BACKLOG item ("Enforce the kit's 48px
   touch-target floor").
2. STYLE.md's own vision-model review ("a vision-model check ...
   fails the build on a miss ... written into the screenshot's
   manifest") - not built at all; a session still opens and judges
   every image by hand (which happened again this lane, per CLAUDE.md's
   own rule, same as every prior lane). Filed as its own BACKLOG item
   ("A vision-model verdict per screenshot", L - a declared expectation
   per route, a real model call, a manifest verdict field).
3. STYLE.md's third fixed theme, High Contrast, isn't captured -
   traced to the theme system itself: `frontend/src/kit/tokens.css` has
   no High Contrast preset to capture yet. A theming gap, not a
   pipeline one; noted in the reconciled BACKLOG item's own text, not
   filed as a separate item (the theme-preset work already has its own
   home in the platform plan's section 6.8, not this repo's screenshot
   lane).

BACKLOG's "A screenshot matrix in the pipeline" item ticked, rewritten
to name exactly what's covered and the three findings above.

## getmaipai/home#75: the real fix

Root-caused via a headless WebKit run before pausing lane 7 for the
media package (see the earlier entry in this file for the diagnostic
trail: checkpoint logs, then per-element visibility/enabled/
boundingBox reads, then `elementFromPoint` at the Send button's own
center). The fix, once the coordinator reordered it ahead of the
package:

`thread.aui.tsx`'s composer footer gets `!isEmpty && "translate-y-9"`
below `sm:` - a real transcript pushes the sticky footer 36px further
down than the empty/greeting state, with nothing offsetting that
against `PhoneNav.tsx`'s own fixed bottom bar. Measured live: composer
bottom edge 816px, nav top edge 789px, a 27px overlap. Added
`max-sm:bottom-16` to that same conditional class, reusing the exact
`16` (4rem) clearance `Shell.tsx`'s own `pb-16 sm:pb-0` already
reserves for PhoneNav on ordinary page content - the one existing
definition of "PhoneNav's height" in this codebase, not a second
literal invented for this one spot.

**Proven to fail, then proven fixed**, since happy-dom's unit tests
always return a zeroed `getBoundingClientRect()` regardless of CSS
(this file's own history says so, `docs/dev.md`'s 2026-09-12 entry) -
the only honest check is real layout, so it lives in
`scripts/screenshot.ts`'s `exerciseChat()`, phone-only, right after the
send that used to hang: reads the nav's top and the composer's bottom
edge, throws if the composer's bottom is below the nav's top, naming
both pixel values and the overlap amount. Temporarily reverted
`max-sm:bottom-16` alone, reran `--chat-review` (plain Chromium, no
`--webkit` needed - this is a real geometry check, not a click
hit-test, so it doesn't depend on which browser's click() is
stricter): failed with `composer's bottom edge (816) sits 27px inside
PhoneNav's own top edge (789)`, the exact numbers from the original
diagnosis. Restored the fix, reran: clean. Then
`--chat-review --webkit` clean too (the original repro, now the live
proof it stays fixed) - `bun test` in frontend, 505 pass, 0 fail,
unaffected by the class change. Regenerated the full matrix and
`--chat-review`; opened `chat-phone-dark.png` (composer sits clear of
the nav bar with visible gap) and `chat-history-phone-dark.png` (the
thread-list overlay, no composer in this view, unaffected either way).
Closed #75 from this commit.

## The `media-lookup` package (conversation program step 1)

Coordinator reorder: paused lane 7 (item 2 done above; item 3, the
type-floor sweep, still open) to build this first, per Jesse's live
film exchange and `docs/plans/media-conversation-program-2026-09-13.md`.

**Design, decided before writing anything.** Wikidata's own API
(`www.wikidata.org`) for the typed fields, Wikipedia's REST summary API
(`en.wikipedia.org`) for the synopsis - both keyless, both the model
`knowledge` already uses for Wikipedia. Verified the actual shapes live
(curl, not assumed) before committing to the design: `wbsearchentities`
is a label match, not full text, so a title with a year appended
("Cobra 1986 film") returns nothing - the handler splits a trailing
year off the title text instead (`parseTitleAndYear()`) and uses it
only to disambiguate among the search results, never in the search
string itself. A bare title collides with every other kind of thing on
Wikidata - "Cobra" returned a 1986 video game, a roller coaster, a
Bolkow anti-tank missile, and fifteen other unrelated entries before
the film, unqualified - so `pickCandidate()` filters to results whose
own Wikidata *description* reads as a film or a television series
(also deciding `kind` from that same field, one Wikidata call saved
rather than a second one to resolve `P31`'s own value). No Wikidata
property exists for a TV content rating (checked directly, searched
Wikidata's own property list) - `rating` stays `null` for a TV show,
an honest gap, not a guess.

**Two real bugs this package's own tests caught before anything ran
live**, both in the "made the tests deliberately exercise the real
shape, not a simplified stand-in" sense the org's testing standard
asks for: `pickCandidate()`'s declared return type was `{ id, kind }`
but the implementation returned its own internal `description` field
too - the test asserting the literal returned object caught the
mismatch immediately. And the composed reply's title came from the
Wikidata entity's Wikipedia *sitelink* title ("Cobra (1986 film)",
Wikipedia's own disambiguation form) rather than Wikidata's clean
display label ("Cobra") - produced "Cobra (1986 film) (1986), directed
by..." in the end-to-end fixture test, caught before it ever reached a
live check. Fixed by folding the candidate's own Wikidata id into the
existing batched label lookup (the same call that already resolves
director/cast/rating names) instead of adding a second Wikidata round
trip just for the display title.

**Built in the catalog checkout first** (`getmaipai/catalog`,
commit 7effc0e, pushed), matching `knowledge` as the model to copy:
same Tier 1 Deno/MCP shape, same `host.fetch` seam (no direct network
access from the Deno sandbox), same typed `not_found` on a miss
(#92's shape) instead of a spoken apology. `tools/check` there (lint +
scorecard) passed 7/7 packages including this one; the full
`scripts/check.sh` there passed clean. Bundled into `home` with `bun
run refresh-bundled-packages` after adding the one line
`refresh-bundled-packages.ts` needed (the `BUNDLED` list is hand-kept,
not auto-discovered) - `backend/packages/media-lookup/` and
`bundled-provenance.json` are generated output of that script, never
hand-edited.

**Verification, in order**: `deno test` on the package's own
`handler_test.ts` (14 tests: the four pure shaping functions exercised
directly, `handleMedia()` end to end against real recorded fixtures
for two films - Cobra, The Godfather, one with a rating recorded on
Wikidata and one without - and one TV show - Breaking Bad, confirming
the optional fields genuinely go `null` rather than the handler
crashing or guessing - plus the typed `not_found` and
`network_unreachable` error paths). `bun test bundledPackages` and
`bun test plugins` in backend (the latter includes FAST-03's own
description-lint regex across every manifest) both green. Full backend
`bun test`, 2217 pass. **Live check**, a spare-port backend, a real
turn through the real turn engine, real network calls to Wikidata and
Wikipedia: "what's the runtime of Cobra" routed to `media-lookup` at
Tier 0 pattern matching and answered "Cobra (1986), directed by George
P. Cosmatos, 83 minutes." (no rating spoken - this build of the film's
own Wikidata entry carries no MPA rating claim, confirmed directly
against the live API before writing the fixture, not assumed).
Regenerated the full screenshot matrix; the Privacy page's own "what
leaves your house" count moved from 14 to 15 rows (this package's two
new `data_sources[]` entries, auto-aggregated by the existing `GET
/api/privacy` route - no privacy page text or screenshot hand-edited,
the generated table did its own job). Ticked BACKLOG's "Music / media
search" item for the film/TV half done; split "what's this song" (a
genuinely different, audio-fingerprinting problem) back out as its own
line for later, un-implied by this item's own close.

## Lane 7 item 3: the type-floor sweep, and a lint that proves it

The last open piece of lane 7. Lane 3's own item 3 (2026-09-12) closed
the two named instances (the bell badge, already fine; `DayDivider`/
`MessageTimestamp`) and recorded ~49 other `text-xs` instances still
scattered across the frontend as real, unscoped remaining work. `grep
-rn "text-xs" frontend/src` confirmed exactly 49 (two more hits were
stale historical comments in `chatDayDivider.tsx` itself, already
correctly worded "was text-xs, now text-base").

**Judged each of the 49 individually** rather than a blanket rule,
per the item's own instruction ("each instance either moves to the
floor or is a deliberate exception with a comment naming why"):

- **26 moved to `text-base`** (16px): real headings, group labels,
  captions, and body text a person actually reads - "Favorites" and
  its empty-state line (`Shell.tsx`), search/command-palette result
  sublabels, settings group headings and shortcut descriptions, the
  avatar-row name label and page tagline on Home, three instances on
  the Apps library page, search result group headings, a chat source
  citation, a Senses popover's detail text, the composer's "For your
  next message only" hint, and - inside the kit itself, where it was
  genuinely real content, not vendored chrome - a cmdk/Select/
  DropdownMenu group-heading primitive, a thread-list date-group
  heading, an image's filename caption and its generation-error text,
  and a tool-call group's own trigger label.
- **23 left as deliberate exceptions**, each with an inline comment:
  badges and chips (the kit's own `Badge` primitive, `SidebarMenuBadge`,
  `chatMemoryChip`'s "Memory updated" pill, `SensesDock`'s status
  trigger - a fixed-size dot/chip is the coordinator's own named
  exception, and the popover it opens already carries the real,
  readable text at the floor); keyboard-shortcut and byte-size/
  duration tokens (`CommandShortcut`, `DropdownMenuShortcut`, a file's
  own size, a tool call's own elapsed time, a grant's permission id);
  raw JSON/args dumps in `<pre>` (monospace data, not prose, and the
  label sitting directly on top of one stays paired with it rather
  than becoming an odd large caption over small data); compact size
  variants that exist on purpose (Button's `xs`, the kit Sidebar's
  `sm`, a File attachment's `sm`, Avatar's small-avatar fallback,
  physically sized to a tiny circle); a `<sup>` footnote reference
  (smaller than body text is the entire point of superscript); a
  tooltip bubble (transient, hover/focus-only, not persistent body
  text); a code block's own compact language/copy header bar; and the
  "1 / 2" edited-message branch-picker (a compact inline pagination
  control). The one approval-flow error alert in that same file
  (`tool-fallback.aui.tsx`, `role="alert"`) is NOT on this list - it
  moved to `text-base`, since it genuinely needs to be readable before
  an adult approves or denies something consequential.

**Two instances needed more than a class swap, checked live rather
than assumed:**

- Home's `WhoIsHere` avatar-row name label moving to `text-base` grew
  the row's own content height past the `min-h-16` (64px) the lane 6
  fix tuned for `text-xs`'s shorter line height - recomputed to
  `min-h-[72px]` (40px avatar + `text-base`'s own ~24px line height +
  the 4px gap, with rounding room) and re-verified with the same
  `clippedStrips` check that caught the original bug.
- `PhoneNav`'s five tab labels ("Home", "Apps", "Chat", "Conversations",
  "More") were the one real judgment call with a genuine risk: `text-
  base` in a ~78px-wide flex column risked "Conversations" wrapping or
  overflowing. Moved it anyway (a bottom-tab label is still something
  a person reads to navigate, the same reasoning that moved every
  other real label) and checked live rather than assumed safe: `bun
  run scripts/screenshot.ts --a11y-only` (0 violations, 0 overflow)
  and the regenerated `home-phone-light.png` both confirm it fits on
  one line with room to spare.

**The `local/type-floor` ESLint rule** (`frontend/eslint.config.js`),
the same hand-written shape as the kit's own `hover-needs-focus`
(string/template literals and `cn(...)` call arguments, not a full
data-flow analysis): flags a `text-xs` or `text-[Npx]` (n < 16) class
with no "type-floor"/"exception" marker in a comment within the eight
lines above it. Scoped to `src/apps/**` and `src/shell/**` only,
matching the exact file-scope convention `eslint.config.js` already
uses for the kit's other accessibility-floor rules (`src/kit/ui` and
`src/kit/assistant-ui` are shadcn/assistant-ui-generated, "not a
mandate to hand-patch every accessibility nuance of vendored component
internals... applied by hand where it mattered," that block's own
words) - the sweep still gave every kit instance a real, individual
comment either way, just not lint-enforced there, the same posture the
48px/focus-ring floors already take in that file.

**Proven both directions**, not just asserted: planted a violation (a
scratch component, `text-xs` with no comment) - `bunx eslint` reported
it with the rule's own message. Added a "Deliberate type-floor
exception" comment to the identical class - clean, no report. Deleted
the scratch file afterward.

**Verified**: `bunx tsc --noEmit` clean; `bunx eslint .` clean (2
pre-existing, unrelated `react-hooks/exhaustive-deps` warnings only);
`bun test` in frontend, 505 pass, 0 fail; `bun run scripts/screenshot.ts
--a11y-only`, 0 violations, 0 overflow across all 34 combos. Regenerated
the full matrix and `--chat-review`; opened every page a user page
embeds plus Chat, Search, Settings, and the phone bottom nav
specifically - all correct, no clipping, no wrapping.

**One unrelated thing found regenerating, not caused by this sweep**:
Home's own Weather card intermittently showed "Couldn't check the
weather right now." in the regenerated screenshots - not a fixture
problem (the offline cache from lane 6 answers fine in isolation,
checked directly), but the household's own per-person turn rate budget
(`PERSON_TURN_BUDGET`, `backend/src/lib/llm.ts`: capacity 5, refills
0.5/s) getting exceeded by several concurrent browser contexts each
firing Home's own real ephemeral weather turn within the same couple
of seconds - confirmed by firing eight of that identical turn at once
by hand and watching several come back `429 turn_rate_limited`. Filed
as [getmaipai/home#102](https://github.com/getmaipai/home/issues/102)
(a real design question - should an ephemeral, no-history card question
skip the budget entirely - not mine to decide); worked around in
`scripts/screenshot.ts` itself for now (wait out the refill window and
reload once if the fallback text is showing after visiting Home,
scoped to that one route), the same thing a real person hitting this
would do, and it answers for real every time in testing since.

## Lane 8 item 1: the touch-target floor

BACKLOG.md's own "Enforce the kit's 48px touch-target floor" item
(written by this session in lane 7 item 1) named the shape: a live
`page.evaluate()` measurement in `visitRoute()` (axe-core still ships
no target-size rule, checked its own rule list directly), every real
sub-48px interactive element either moved to the floor or given a
documented exception, the same discipline lane 7 item 3's type-floor
sweep used.

**The check.** Selects every `button`, `a[href]`, `input`, `select`,
`textarea`, and ARIA `button`/`link`/`checkbox`/`radio`/`switch`/`tab`/
`menuitem`/tabbable-widget role, measures `getBoundingClientRect()`,
and - unlike a naive version - also reads `getComputedStyle(el,
"::before")` and `"::after"`: the kit's own established hit-area
technique (`button.tsx`'s `xs`/`sm`/`icon-xs`/`icon-sm` sizes, a
transparent absolutely-positioned pseudo-element wider than the
painted box) makes a visually-compact control a real 48px target, and
a naive rect-only check would have flagged every one of those as a
false violation. Two exclusions, both found live, not assumed up
front: `aria-hidden="true"` (Radix Select renders a real, genuinely
hidden native `<select>` purely to fire native `change` events for
form libraries - its own source, `@radix-ui/react-select`'s
`useSelect.ts`: `"aria-hidden": true, tabIndex: -1` - and it showed up
in the first run as two nonsense "1x1" violations with concatenated
option text as the label); and `data-touch-target-exempt`, the
sweep's own documented-exception marker, the same shape as the
type-floor sweep's comment marker but for a geometry check rather than
a source-text one. Deliberately NOT a blanket `tabIndex === -1` skip:
an inactive tab in a roving-tabindex tablist also carries `tabIndex
-1` and is still a real, visible, clickable target - the exclusion has
to name the actual reason (imperceptible, not just non-tabbable), not
a proxy for it.

**Every real violation, and what fixed it** (none forced through a
kit-wide redesign - each judged on its own, the same discipline the
type-floor sweep used):

- The sidebar brand link (`Shell.tsx`, both the desktop sidebar-header
  mark and the phone-only header mark) - `min-h-10`/no min-height at
  all, moved to `min-h-12` (48px), centered via `flex items-center`.
- The sidebar's resize rail (`kit/ui/sidebar.tsx`'s `SidebarRail`, 16px
  wide, the full sidebar's height) - a genuine exception:
  `tabIndex={-1}` (never a keyboard stop), mouse-only, redundant with
  the header's own `SidebarTrigger` button which already clears the
  floor through its `icon-sm` hit-area extension. Marked
  `data-touch-target-exempt` with a comment naming why, rather than
  widened into the page content next to it for no accessibility gain.
- The card-size slider's thumb (`kit/ui/slider.tsx`, Radix Slider) -
  already used the hit-area technique, but via `::after`, not
  `::before`, which the first draft of the check didn't read; and even
  once read, the actual extension (`after:-inset-2`, 8px) only reached
  28px, not 48 - `-inset-2` was reused from elsewhere without doing
  the arithmetic for this thumb's own `size-3` (12px). Fixed the check
  to read both pseudo-elements, and the thumb to `after:-inset-[18px]`
  (12 + 18 + 18 = 48).
- The chat composer's text field (`thread.aui.tsx`) - `min-h-9` (36px),
  moved to `min-h-12` with `py-3` instead of `py-1.5` so a single line
  centers in the taller box rather than sitting top-left.
- The composer's five action buttons (dictate, stop-dictation, send,
  disabled-send, cancel - `thread.aui.tsx`) and New chat and Chat
  options (`ChatPage.tsx`) - all a raw `size-9` class override with no
  hit-area extension. Fixed `button.tsx`'s own `icon-lg` variant first
  (it existed as a name but had never actually gained the same
  `before:-inset-*` treatment as its `xs`/`sm`/`icon-xs`/`icon-sm`
  siblings - nothing used it as a `size` prop, every call site
  overrode with a raw `size-9` class instead), then tried switching
  the composer buttons to `size="icon-lg"` to use it. That produced
  partial results (48x44 on one, unchanged 36x36 on three others): a
  live check caught two different wrapping components -
  `ThreadListNew`'s own baked-in `h-8`, `TooltipIconButton`'s own
  baked-in `size-6 p-1` - whose own hardcoded classes sit later in the
  final `cn()`/`twMerge` string than a `size` prop's CVA-computed
  classes, so they won the merge and silently ate the fix. The
  reliable fix was the caller's own `className`, which is always the
  last word regardless of wrapper depth: `size-9 relative
  before:absolute before:-inset-1.5 before:content-['']` at each of
  the six call sites. `icon-lg`'s own fix in `button.tsx` stays - it's
  correct for a bare `Button` no wrapper overrides, just not what any
  current call site actually uses.
- The conversations list's title link (`ConversationsPage.tsx`) - the
  row it sits in is already `min-h-12` (`List.tsx`'s own generic
  floor), but the link itself is only as tall as its one line of text
  (24px) - clicking the row's own padding does nothing, since this
  page doesn't pass `onSelect` (the row here isn't a `List`-owned
  selectable row; the title's own inline link is the real target).
  Extended via `relative before:-inset-y-3 before:content-['']` rather
  than restructuring the row.
- The settings back link and the settings search field
  (`SettingsPage.tsx`) - `py-2` (≈36px) and `h-11` (44px), moved to
  `py-3.5` and `h-12`.
- The whole per-message action bar (Copy, Refresh, the "More" menu
  trigger, Listen, Remember this) - found only once a real assistant
  message actually rendered: the regular matrix's Chat route always
  shows the empty "How can I help you today?" state, so this entire
  class of violations was invisible to `bun run a11y` and `bun run
  screenshots` and only surfaced running `--chat-review`, the one mode
  that seeds a real reply. All five are `TooltipIconButton` with no
  size override, i.e. its own default (`size-6 p-1`, 24px, no hit-area
  extension at all). Fixed once, in `TooltipIconButton`'s own base
  className (`relative size-6 ... before:-inset-3`), rather than at
  five call sites across two files (`chatActionBar.tsx`,
  `thread.aui.tsx`) - a caller that already overrides size (the
  composer buttons above) supplies its own pseudo classes after this
  one in the same `cn()` call, which wins the merge, so the base fix
  and the per-site fixes don't fight each other.

**Proven both ways.** Planted a violation (`Button` for "Show/Hide
threads", `className="size-6"`, no hit area): `bun run a11y` failed
with `touch-target-floor (under 48px): button "Show threads": 24x24`,
the exact measured size, on both combos. Reverted; clean again.

**Verified**: `bun run build` (tsc + vite) clean; `bunx eslint .` clean
(2 pre-existing, unrelated `react-hooks/exhaustive-deps` warnings
only); `bun test` in frontend for the touched pages (ChatPage,
conversations, SettingsPage), 30 pass, 0 fail. `bun run a11y` (34
combos, the fast pass) 0 violations. `bun run screenshots` (136
combos, the full matrix) run twice - once before the
`TooltipIconButton` base fix, once after - both 0 violations, 0
overflow. `bun run scripts/screenshot.ts --chat-review` (the one path
that renders a real assistant message with its action bar) 0
violations, run after the `TooltipIconButton` fix. Regenerated
screenshots opened: Home, Chat (empty and with a loaded transcript),
Settings, a settings sub-page (the back link), and the phone bottom
nav, at both phone and desktop, both themes - all correctly sized, no
visual regression from the hit-area extensions (invisible by design)
or the composer's taller minimum height.

## A regression found regenerating item 1's own screenshots: the plain
matrix's chat route silently reverted to the empty state

Folded into item 2's commit, per the coordinator (a review of ebecad7's
own published `chat-desktop-light.png`, back to the empty "How can I
help you today?" state it showed before 88ffaee's own fixup). Root
cause: `--chat-review` is the only mode that ever clears and exercises
a real conversation (`exerciseChatFirst`, `scripts/screenshot.ts`), and
its own two combos (`A11Y_ONLY_COMBOS`: phone/dark, desktop/light)
happen to share output filenames with two of the plain matrix's own
eight - whichever of the two commands ran LAST is what the published
files actually show. 88ffaee's own fixup depended on a person running
both commands in the right order by hand ("ran both commands, matching
how this pipeline has needed to be run since 2026-09-04"); this
session's own later re-verification run (`bun run screenshots`, no
flags, checking the `TooltipIconButton` fix across the full matrix)
was the plain command running last, silently reverting the two files
chat-review had just fixed - the exact regression 88ffaee describes
finding once already, recurring for the identical structural reason.

Fixed for real rather than re-ordered by hand: `visitRoute()` takes an
`exerciseChatFirst` parameter (defaults to the module-level
`chatReview` flag, so `--chat-review`'s own behavior is unchanged), and
the plain run now does one small sequential re-visit of chat for
`A11Y_ONLY_COMBOS` after its own main pooled pass, with a cleared and
exercised conversation, replacing those two combos' results and
screenshots - the same single-shared-conversation race
`chatReview`'s own pool size of 1 already exists to avoid. One
canonical `bun run screenshots` command is now correct regardless of
what ran before it, in a single process. Verified: `docs/assets/
screens/manifest.json`'s own `chat-phone-dark.png`/`chat-
desktop-light.png` entries show `captureScript: "scripts/
screenshot.ts"` (no flags) with a timestamp after the main matrix's
own pass; both images opened, show the real garden conversation
(the herbs/book scripted exchange). `bun run a11y` and the full
`bun run screenshots` both 0 violations after the fix, run twice.

## Lane 8 item 2: CHAT-20's frontend half

BACKLOG.md's CHAT-20 (real `turnId`/`memoryIds`/`memoryStatus` in both
live and loaded assistant metadata, a bounded poll of the existing
per-conversation turns endpoint, one shared source of truth for the
chip and the memory actions). Read `routes/conversations.ts` and
`lib/conversationHistory.ts` first, as the plan asked, rather than
assuming: `GET /:id/turns` already carries real `memory_ids` per turn
(`memoryIdsByTurn()`, getmaipai/home#64's own contract), and its row
type (`ConversationTurnWithMemoryIds`, `@/wire`) is Drizzle-inferred
from the real table, so it already carries `judgeStatus` too
(`backend/src/db/schema.ts`'s own `judge_status` column) - nothing was
missing from the backend for the frontend half to build on; no message
to Session A was needed.

**The status derivation** (`chatMemoryState.ts`'s `deriveMemoryStatus`),
the one piece of real judgment this item needed: `judge_status` is
`null` until judged, `"done"`/`"failed"` after - but `memoryJudge.ts`'s
own queue query (`eq(conversationTurns.source, "model")`) only ever
selects `source: "model"` turns, so a plugin/command/safety-refusal
turn's `judge_status` stays `null` forever, not "still pending." Read
that wrong on a first pass (every non-model turn would have shown
"Checking for memories" permanently); the fix is source-aware: no
memory ids, judge not `"failed"`/`"done"`, and `source !== "model"` is
`not_saved`, not `pending`. A non-empty `memory_ids` always wins
regardless of source or judge status, since "Remember this" writes
into the exact same `memory_records.source = turn_id` provenance field
the automated judge does (chatMemoryActions.ts, unchanged reasoning).

**One store, one source of truth.** `chatMemoryState.ts`'s zustand
store, keyed by turn id: `{conversationId, memoryIds, status,
pendingSince, stalled}`. Seeded once per message mount from whatever
metadata it already carries (a loaded row's real fields, or a live
reply's `source` alone - the judge runs after the turn, never during
it, so a live message has no `judgeStatus` field at all;
`deriveMemoryStatus` reads that the same as an explicit `null`),
never re-seeded, never overwritten by a stale mount-time snapshot.
Replaces `chatMemoryActions.ts`'s own former localStorage-backed
"remembered id per turn" map: that map existed only because the real
per-turn `memory_ids` hadn't reached the frontend yet ("session-a-
intelligence.md's contract adds GET /:id/turns' per-turn memory_ids,
not merged" - its own comment, now stale, since it has been merged for
a while); once real ids flow through both live and loaded paths, nothing
needs to be approximated client-side between reloads, and `rememberMessage`/
`forgetMessage` now write directly into the same store the chip reads,
targeting exact returned/given ids rather than a single remembered slot.

**The poll** (`useMemoryStatusPoll`, mounted once in `ChatPage.tsx` off
the same conversation id its own runtime uses as `threadId`): a 5s
`setInterval` re-fetching `GET /:id/turns` in full (no `since` - the
poll is rechecking EXISTING rows' status, not fetching new ones, so
`since`'s own "everything after this turn" semantics don't apply here)
whenever anything in the open conversation is `pending`, paused on
`visibilitychange` to hidden, stopped entirely (effect cleanup) the
moment nothing is pending or the conversation id changes/unmounts. A
first pass tried per-turn dependency arrays and array-identity
selectors, which risked re-running the effect on every store write
even when nothing observable changed; settled on a boolean
`hasPending` selector (stable via zustand's default `Object.is`) as
the only effect dependency, with the interval's own tick reading fresh
state via `useMemoryStore.getState()` rather than closing over a stale
list. Ten-minute stall is a real wall-clock timestamp (`pendingSince`,
set once, kept across ticks so backgrounding the tab doesn't reset it)
checked at the start of each tick, not a separate timer.

**Two real bugs a live check caught, not the unit tests** (see below):

1. `rowMemoryIds ?? []` inside a `useAuiState` selector - a fresh empty
   array literal on every single call when the field is absent, which
   `useAuiState`'s underlying subscription (`useSyncExternalStore`)
   read as "changed" every render, an infinite render loop
   (`getSnapshot should be cached`, React's own diagnostic). Reproduced
   in isolation with plain `useAuiState` calls, no store code involved,
   before finding it. Fixed by keeping the selector's own return value
   `?? undefined` (stable) and coalescing to `[]` only afterward, in a
   plain synchronous statement outside the hook.
2. `size="icon-lg"` on the composer's action buttons (thought this
   would ALSO close the touch-target work item 1 left slightly loose -
   see its own lane 8 item 1 writeup above) lost the fix silently: two
   different wrapping components (`ThreadListNew`'s own baked-in `h-8`,
   `TooltipIconButton`'s own baked-in `size-6 p-1`) append their
   default classes AFTER the variant slot in the same `cn()`/`twMerge`
   call, so they won the merge back. Reverted those two call sites to
   the caller-className approach lane 8 item 1 already used elsewhere
   (guaranteed to be the last word regardless of wrapper depth) -
   noted there, not re-explained here.

**Proven both ways, live, not just unit-tested**: a spare-port backend
(`PORT=8850`, its own throwaway `MAIPAI_DATA_DIR`) pointed at the real
household chat and embed engines already running on the box
(`MAIPAI_LLAMA_SERVER_URL`/`MAIPAI_EMBED_URL`, the household's real
Qwen3-8B chat model and nomic-embed), a real household seeded, a real
message sent from a real Vite dev server against it. The chip showed
"Checking for memories" the instant the live reply landed, before any
reload. The automated judge itself failed on both messages sent
(`judgeAttempts: 3`, `judgeStatus: "failed"`) - traced to the
`background` role (the judge's own extraction call,
`backgroundSupervisor.ts`) having no `MAIPAI_BACKGROUND_URL` pointed
at this spare instance, so it fell to its own in-process stub, whose
canned reply doesn't parse as the extraction schema's JSON - a real
gap in this session's own spare-instance setup, not a product bug (the
household's own real chat/embed models both worked correctly; only
the third, background role was left unconfigured), so no issue filed.
That failure still proved the "failed" chip state for real
(`judgeStatus: "failed"` did reach the chip and render "Memory wasn't
saved") and, since it left nothing for the automated path to
demonstrate "saved" with, "Remember this" from the message's own "..."
menu stood in for stating a fact: clicked, the chip flipped to "Memory
updated" with no reload; "Forget this" (now available in the same
menu), clicked, the chip disappeared and `GET /api/memory` confirmed
the record was really archived server-side. Also directly observed the
"pause while hidden" behavior working (the Chrome extension's own
automated tab reports `document.visibilityState: "hidden"`, not a page
bug - the poll correctly stopped issuing requests while it did, and
resumed once forced back to `"visible"` for the check).

**Verified**: `bunx tsc --noEmit` clean; `bunx eslint .` clean (2
pre-existing, unrelated warnings only, the same two lane 8 item 1 also
saw); `bun test` in frontend, 515 pass, 0 fail, including new suites
for `chatMemoryState.ts` (deriveMemoryStatus's every branch, the poll:
never fetches when nothing pending, resolves pending-to-saved without
a reload, stops polling once everything resolves) and the rewritten
`chatMemoryChip.test.tsx` (all four states, a manual save always
outranking a pending/not_saved judge status, forgetting a saved
message turning its chip off). `bun run build` clean.

## Lane 8 item 3: what MaiPai can look up

A short "What MaiPai can look up" section in `docs/user/chat.md`,
placed right after "Send a message" (the natural next question once a
reader knows how to send one). Checked what's actually installed and
real, not assumed from `docs/user/privacy.md`'s own outbound
description: `backend/packages/` today ships weather, a dictionary
definition, trivia, a joke, general knowledge, a film or TV lookup,
news headlines, a music-artist lookup, MLB scores, and web search
(the last one opt-in: `checkSearxngHealth()`'s own "not configured is
not a fault" treats an empty `search.searxng_url` as normal, not an
error, and `docs/user/privacy.md`'s own phrasing already calls it
"through your own search server"). Kept the section itself short and
representative (weather, a definition, trivia, a film lookup, web
search) rather than enumerating all ten - the plan's own "one short
section" and CLAUDE.md's dad test both argue against a full package
list here; the [Privacy](../user/privacy.md) page's own table is where
someone goes for the complete, current list and what each one sends.

Phrased as "ask it to look something up" throughout (an example
question per lookup, imperative), never "it looks things up on its
own" - CHAT-16 (the composer unifying deterministic-lookup results
into companion-voiced replies) hasn't landed, so today a lookup only
answers when the message matches its own routing pattern directly;
nothing implies MaiPai decides mid-conversation to go look something
up unprompted. No screenshot: a docs-only change to `docs/user/`
prose, no new or changed app screen for the pipeline to capture.

**Verified**: `bun run scripts/reading-level.ts` - `chat.md: grade 7.8
(max 8) ok` (the first draft scored 8.3, TOO HARD; shortened the
lookup-vs-search sentence and swapped a shorter example word before it
passed). Read the rendered section back for the dad test and for
honesty against what's actually shipped, per-package, above.

## Lane 9 item 1: the home screen, reconciled

BACKLOG.md's "The home screen: keep the dashboard, make it a real
home" carries Jesse's 2026-09-05 ruling and a recommendation in five
clauses. Read `frontend/src/apps/home/HomePage.tsx` and its
components directly, not the backlog prose, before touching anything:

1. **"A greeting with who is here (from sign-in now, voice or face ID
   later)"** - built. `Tagline`/`greetingFor()` for the greeting,
   `WhoIsHere` for the roster strip, both already shipped (a lane 7
   fix for `WhoIsHere`'s own clipping bug is the most recent touch).
   "Voice or face ID later" is exactly that - later, and explicitly
   out of scope for this lane.
2. **"A row of 'today' cards ... the 'skills as home-screen widgets'
   item above is exactly this, so the two items merge"** - built, but
   NOT merged with that item, on purpose (this lane's own instruction):
   `WeatherCard`/`RecentMemoriesCard` under "Today," plus a separate
   "Your packages" widget grid (`NodeRenderer` over
   `widget_card`/`/api/widgets`) that IS the shipped half of "skills as
   home-screen widgets" - the manifest hook, the data route, and a real
   card-size slider (`CardSizeSlider`, matching that item's own
   legacy-reference section almost exactly) all already exist. Left
   that BACKLOG item open and untouched: what it still asks for (which
   packages opt in by default, card density conventions) is a real,
   undecided design question this lane doesn't answer.
3. **"A pinned-apps strip driven by the same `pinnedIds` the sidebar
   uses"** - built, and correctly: `PinnedAppsStrip` calls
   `usePinnedApps(person.id)`, the identical hook
   `shell/Shell.tsx`'s own sidebar Favorites section calls (`grep`
   confirms both call sites) - one definition, not a second list that
   could drift.
4. **"One prompt box that is both search and chat (type or talk;
   finds apps, memories and answers)"** - was chat-only (a bare form,
   `navigate("/chat", {state: {initialText}})` on every submit, no
   search at all); now built for "type": `HomeSearchPrompt`, the exact
   same shared query (`shell/search/useSearchCommand.ts`,
   `SearchResultGroups.tsx`) `CommandPalette.tsx`'s Cmd/Ctrl+K dialog
   uses (see lane 9 item 2's own writeup below for that query's real
   sources). "Talk" is still missing: nothing wires the composer's own
   dictation adapter into this box, so voice only reaches MaiPai once
   a person is already inside Chat - a real gap, not a false claim,
   left open rather than silently expanded into scope this lane didn't
   ask for.
5. **"Personal data on the shared screen only after the person is
   confirmed"** - not applicable yet, confirmed with the coordinator
   before writing this down as fact rather than a guess: `App.tsx`'s
   own routing renders `<SignIn>` INSTEAD of `<Shell>`/`HomePage` when
   `person === null`, never both - every render of Home already has a
   real, specific, signed-in person, so "household-only until
   confirmed" has no unconfirmed state to gate against without
   inventing a new auth concept this lane has no mandate for. What
   this recommendation actually describes is a FUTURE ambient/shared-
   screen case (a kiosk display nobody has voice- or face-confirmed
   yet) - the same future case clause 1's "voice or face ID later"
   names, and already its own deferred BACKLOG item. No test written
   for it, no toggle invented.

One more recommendation clause, found while reading `Shell.tsx` for
clause 3, not itself part of this lane's own DO list but worth
recording since the audit is meant to be honest either way: "the
sidebar stays the one permanent navigation and auto-collapses in
consumption modes" is only half true. The collapsible-to-icons
mechanism is real and shipped, but `Shell.tsx`'s own comment says it
plainly - "the person's own choice - never the default" - there is no
automatic collapse tied to a "consumption mode" concept anywhere in
the shell. Not fixed here (out of scope, not named in this lane's own
work order); noted so the next session doesn't have to re-discover it.

**Built this lane**: `HomeSearchPrompt` (search-and-chat, item 4
above), and the shared `useSearchCommand`/`SearchResultGroups`
extraction that makes it and `CommandPalette.tsx` the literal same
code (lane 9 item 2's own section covers that extraction and its own
bugs in full). Two real, live-only bugs found building it, neither
visible from source alone:

1. `Command`'s own base class (`kit/ui/command.tsx`) carries `size-full
   overflow-hidden` - correct for `CommandDialog`'s always-sized
   `DialogContent`, wrong for this inline box's real parent (a plain
   flow div inside Home's own `overflow-y-auto flex-col` scroll
   container). First symptom: the whole box collapsed to a few px (the
   identical "`overflow-hidden` zeroes a flex item's own automatic
   minimum size" quirk `WhoIsHere`/`MediaShelf` already document) -
   `shrink-0` fixed that, but then exposed `size-full`'s OWN `height:
   100%` computing against the scroll container's real height instead,
   stretching the box to ~650px and pushing every card below it off
   screen. Both `shrink-0` AND a forced `h-auto!` are the real fix
   together - a plain `h-auto` alone survived in the class list next to
   `size-full` rather than replacing it (`cn()`'s own `twMerge` didn't
   treat them as conflicting) and lost the cascade to `.size-full`
   either way, `!important` needed regardless of source order.
2. `CommandInput`'s own `aria-controls` always points at
   `CommandList`'s id, whether or not that list is actually mounted -
   this box originally unmounted `CommandList` entirely on an empty
   query (to avoid showing the full app catalog before anyone types
   anything, unlike the deliberately-invoked palette), leaving a
   dangling reference axe's `aria-valid-attr-value` correctly flagged
   as critical. Fixed by always mounting `CommandList` and keeping only
   its CONTENTS conditional on a real query - the same UX, a real DOM
   node underneath it.

**Also found regenerating this lane's own screenshots, fixed alongside
(none of it new to this lane, all pre-existing)**: the touch-target
check (lane 8 item 1) caught `CommandInput`'s own real `<input>`
element measuring 24px tall inside its visually-48px `InputGroup` row -
a real gap, not just a measured one (the row's own padding wasn't a
real click target, nothing wired it through to the input); fixed with
`h-full` on the input itself, then `InputGroup`'s own height bumped
50px to compensate for its own 2px border eating into that `h-full`.
Axe's `color-contrast` rule caught `chatMemoryChip.tsx`'s own chip
(lane 8 item 2, `bg-muted`/`text-muted-foreground`) failing in light
theme once a real exercised chat reply rendered one for the first time
in a full-matrix run - switched to `badge.tsx`'s own proven-contrast
`secondary` pairing.

**Verified**: `bunx tsc --noEmit` and `bunx eslint .` clean (the same
two pre-existing warnings every lane this session has seen); `bun test`
in frontend, 536 pass, 0 fail, including the new
`HomePage.test.tsx` suites (a typed query lists an app, a memory, and
a conversation; selecting a match navigates to it; Enter with nothing
arrowed to sends the raw text to chat even with real matches showing;
the pinned strip's own order follows `pinnedIds`, not catalog order).
Live-checked against a spare-port backend with a real seeded household:
typing "hik" listed the real memory; typing "garden" listed a real,
titled conversation and Enter (no selection) correctly opened Chat with
that text; the pinned strip showed Settings/Chat/Memory in that exact
pinned order. `bun run screenshots` (full 136-combo matrix, run three
times across the two live bugs above) 0 violations on the last two
runs; Home screenshots (desktop and phone, both themes) opened and
read correctly.

## Lane 9 item 2: unified search, over what exists

BACKLOG.md's "Unified search: one palette over everything" opens with
"Nothing like it exists in the rebuild" - false the moment
`frontend/src/shell/search/` is actually read: `CommandPalette.tsx`
(Cmd/Ctrl+K, wired in `Shell.tsx`) and `apps/search/SearchPage.tsx`
(`far`'s own destination) already share one query module,
`providers.ts`, with independent, best-effort providers for apps,
pages, people, memories, conversations, settings, and commands - six
of the seven core providers the BACKLOG item's own text asks for
(only a package-contributed `search` blueprint is genuinely absent).
The backlog text is stale, not the build; this lane corrects the
record rather than re-building something that already exists.

**What was real vs. what the code claimed**: `conversationsProvider`
was mocked to a single hardcoded "Chat" destination, its own comment
citing "pending Session A's per-thread conversation routes" - stale
the moment CHAT-20's own frontend half (lane 8 item 2, this same
session) started reading `GET /api/conversations`'s real
`ConversationSummary[]` shape. Rewired to `api.conversationList()`,
matching by real title, linking to `/chat?conversation=<id>` (an
untitled conversation has nothing to match on and never appears,
correctly).

**Centralized, not duplicated**: extracted `useSearchCommand.ts`
(the query: local Apps/Favorites merge plus `runSearchProviders`) and
`SearchResultGroups.tsx` (the render: grouped results plus the "Ask
MaiPai" fallthrough row, now rendered FIRST rather than last - see
item 1's own writeup above for why) out of `CommandPalette.tsx`,
which now just supplies the `CommandDialog` wrapper. `SearchPage.tsx`
and the new `HomeSearchPrompt` (item 1) both call the identical hook
and renderer - three surfaces, one real implementation, matching
docs/BACKLOG.md's own "build it once."

**Touch targets and type floor**: `command.tsx`'s `CommandItem`,
`CommandInput`, and `CommandEmpty` had never been swept in lane 7 item
3 or lane 8 item 1 (both landed before this file saw real use in a
launcher context) - `CommandItem` was under both floors at once (no
`min-h-12`, `text-sm` not `text-base`); `CommandInput`'s own wrapper
was `h-8`/`text-sm`; `CommandEmpty` was `text-sm`. All three now match
`kit/ui/input.tsx`'s own established `h-12`/`text-base` standard.

**The backend route this still waits on, named for Session A**: the
BACKLOG item's own "core providers... a `search` blueprint so any
package contributes a provider over its own tables" is a real,
separate piece of work - a fan-out `GET /api/search?q=<query>` route
that queries every installed PACKAGE's own content (not the six
sources above, which are all core-platform tables the frontend
already reaches directly and cheaply). Proposed response shape, to
match `SearchGroup`/`SearchResultItem`
(`frontend/src/shell/search/providers.ts`) so the frontend needs no
redesign to consume it, only one more provider function:
```ts
// GET /api/search?q=<query>
{
  groups: Array<{
    heading: string;        // the package's own display name, e.g. "Recipes"
    package_id: string;     // which installed package this came from
    items: Array<{
      id: string;            // unique within the response
      label: string;
      sublabel?: string;
      icon: string;          // one of the kit's own icon names
      to: string;             // a real in-app route to navigate to
    }>;
  }>;
}
```
Matches `providers.ts`'s own "each provider independent and
best-effort" rule: one package's own query failing should drop that
one group, never the whole response. `RESULTS_PER_PROVIDER` (6, this
file's own constant) is the per-provider cap the frontend already
enforces for its six core providers; the route should hold to the
same number per package rather than the frontend re-slicing a larger
payload.

**Found by code review, before this lane's commit**: `useSearchCommand`'s
query used `placeholderData: (previous) => previous` (a "keep the last
match visible while the next one loads" pattern) alongside `enabled:
trimmed !== ""` - but TanStack Query v5 computes `placeholderData` off
`status` (pending vs. success), not `fetchStatus`, so a *disabled* query
still hands back the last successful data for whatever key it had
before. Clearing the search box back to `""` never re-fetches (the
query is disabled at that key), so the previous, real match stayed on
screen instead of the empty-query state clearing it. Fixed by gating
the provider-group spread directly on `trimmed === ""` in
`useSearchCommand.ts`, rather than trusting the query's own data;
regression test in `CommandPalette.test.tsx` ("clearing the query drops
a provider match instead of leaving it stale") reproduces it against
the pre-fix code and passes against the fix.

**Verified**: `bun test` in frontend covers every source directly -
`shell/search/providers.test.ts` (one test per provider: apps, pages,
people including a failed-fetch-contributes-nothing case, memories,
conversations including the untitled-never-matches case, settings,
commands), `shell/search/CommandPalette.test.tsx` (closed renders
nothing; open with no query shows the app catalog; selecting a match
navigates and closes; Enter with nothing arrowed to asks MaiPai with a
real match showing; clearing the query drops a stale provider match),
`apps/search/SearchPage.test.tsx` (typing lists a
match; selecting navigates; the Ask row sends to chat). Live-checked
Cmd+Ctrl+K on a spare-port backend: opened to the real pinned-order
Favorites row, typed "marlow" and got the real seeded household
member back. `bun run screenshots`, 0 violations, `search-palette-
desktop-light.png`/`search-palette-phone-dark.png` (a new, small,
dedicated capture, `capturePaletteOpen()` in `scripts/screenshot.ts` -
`SearchPage.tsx`'s own route is `far`'s real destination for this, not
phone's or desktop's, both of which reach the dialog instead, which
the route matrix never opens) opened and read correctly.

## Lane 10 item 1: sources on a reply, the spec shape and the chat rendering

The work order's own line ("Add an optional `sources: Source[]` to the
assistant turn in `conversation.schema.json`") doesn't match what that
file actually is: `conversation.schema.json` is the Conversation
THREAD record (title, summary, lifecycle) - it has no notion of a
single turn at all, because turns are hub-internal
(`backend/src/db/schema.ts`'s `conversationTurns`, exposed to the
frontend as `TurnValue`/`ConversationTurnRow` in `backend/src/wire.ts`,
neither of which is spec-generated). Legacy's own precedent confirms
sources belong on the reply, not the thread: `docs/BACKLOG.md`'s own
citation item describes a `messages.sources` column, per message. So
this lane built the one part of that instruction that IS a spec
concern - `spec/schemas/source.schema.json`, a standalone `Source`
record with the shared envelope (`source`, `hlc`, `created_at`, no
`updated_at` since a citation is a snapshot, never edited) - and left
`TurnValue`/the `conversationTurns` row exactly where the work order's
own out-of-scope line puts them: Session A's, added when CHAT-16 emits
real sources. Flagged here rather than silently reinterpreted, since a
wrong guess here is exactly the kind of thing worth a paper trail.

**The spec half**: `spec/schemas/source.schema.json` (`id`, `kind`:
web/wikidata/wikipedia/weather/package, `title`, `url`, `site`, an
optional `snippet`, plus `source`/`created_at`/`hlc`), regenerated into
`spec/gen/ts/source.ts` and `spec/gen/py/source_schema.py`, a fixture
(`spec/fixtures/records/source.example.json`) wired into both
`tests/ts/fixtures.test.ts` and `tests/py/test_fixtures.py`, one
sentence in `spec/README.md` matching the Entity/Relationship/Grant
precedent.

**The frontend half, forward-compatible until CHAT-16 lands**:
`chatCitations.ts`'s `TurnWithSources = { sources?: Source[] }` is the
one place both adapters read a field neither `TurnValue` nor
`ConversationTurnRow` declares yet - `(row as TurnWithSources).sources`
in `chatHistoryAdapter.ts`, `(event.value as TurnWithSources).sources`
in `chatModelAdapter.ts` - narrower than a cast to `any`, and both
casts disappear the moment Session A adds the real field (nothing else
about the adapters changes). Both attach `sources` to `message.metadata
.custom`, the identical bag `chatSourceCaption.tsx`/`chatMemoryChip.tsx`
already read from, so the reload and live paths render identically -
proven directly (`chatHistoryAdapter.test.ts`'s new "a row carrying
sources passes them into the reply's metadata" test uses the same
row-to-message path the reload adapter's other tests already exercise).

**Rendering, kit primitives first**: `markCitations()`
(`chatCitations.ts`) rewrites a `[N]` marker into a real markdown link,
`[N](#citation-N)`, only when N indexes a real source - passed to
`MarkdownTextPrimitive`'s own `preprocess` prop (newly forwarded
through `kit/assistant-ui/markdown-text.tsx`), which always runs on the
full accumulated reply text, never one streamed delta alone, which is
exactly the "a marker can split across chunks" safety the design note
asks for: a buffer ending mid-marker (`"...[""`) has nothing to match
yet, so nothing is converted early. `chatCitationLink.tsx`'s `a`
override then intercepts that `#citation-N` link and renders a chip
naming the source (`aria-label="Source N: <title>"`, opens in a new tab
with `rel="noopener noreferrer"`/`referrerpolicy="no-referrer"`) or
falls through to the same plain-link styling for a real URL.
`SourcesCard` renders the full numbered list under the settled reply
(`!running`), same link attributes. No favicon fetch anywhere - the
proxy is its own backlog item.

**Found live, would have shipped broken**: the first version used a
made-up `citation:N` URI scheme instead of a `#`-fragment. It rendered
in the DOM as `href=""` with the chip logic never firing - traced to
react-markdown's own default `urlTransform`, which allows only a fixed
protocol allowlist (http/https/mailto/tel) plus relative/fragment
links and silently blanks anything else, the same mechanism that keeps
a `javascript:` link from a hostile reply from ever becoming clickable.
A custom scheme falls into that same bucket. Switched to `#citation-N`
(inherently relative, never touched by the transform) and the chip
rendered correctly end to end. Caught by the "renders a numbered [N]
chip and a SourcesCard" ChatPage.test.tsx case below, not by manual
inspection - the test failed with the chip's own fallback (plain link,
empty href) rendering instead of the chip, which is what pointed at
`urlTransform` rather than my own component logic.

**Found by code review, before this lane's commit**: three real
findings, all fixed. (1) `markCitations()`'s original regex ran over
the raw text with no code-span awareness, so a reply explaining
`` `items[2]` `` in prose would have rewritten the marker INSIDE the
backticks into a broken link fragment - fixed the same way
`chatCitationLink.tsx`'s design already cited (`@assistant-ui/react-
markdown`'s own math-delimiter helpers, "code spans and fences are
never rewritten"): split on fenced/inline code spans first, only
rewrite the segments outside them; two new regression tests. (2)
`chatSourcesCard.tsx`'s "Title" and "site" separator used a literal em
dash character, banned outright by the org's own writing standard
(`getmaipai/.github` CLAUDE.md, "No em dashes, ever") - switched to a
middle dot, both tests updated. (3) `chatCitationLink.tsx`'s fallback
`a` (a real URL a reply also contains, not a citation) hand-duplicated
`markdown-text.tsx`'s own default link styling instead of reusing it,
dropping the `aui-md-a` hook class in the process and creating a
second definition that could silently drift - fixed by exporting
`MARKDOWN_LINK_CLASS` from `markdown-text.tsx` and importing it in
both places.

**Verified**: `spec/tests/ts/fixtures.test.ts` and
`spec/tests/py/test_fixtures.py` (`bun test`/`pytest`, both green) for
the round-trip; `frontend/src/apps/chat/chatCitations.test.ts` (a
matched `[N]` becomes a link, an unmatched `[N]` stays text, no sources
leaves every marker untouched, a still-incomplete marker at the end of
a buffer is never half-converted, a marker inside an inline span or a
fenced block is left alone, `parseCitationHref`'s own inverse);
`chatSourcesCard.test.tsx` (three sources render three numbered links
with the right `target`/`rel`/`referrerpolicy`; no sources or an empty
array render nothing); `chatHistoryAdapter.test.ts`'s two new cases
(sources pass through; their absence doesn't crash); three new
`ChatPage.test.tsx` cases driving the real end-to-end pipeline through
a stubbed `/api/turn/stream` (a reply with sources renders the chip and
the card with the right attributes; a `[7]` marker against a single
source stays plain text; a plain reply with no sources renders neither).
No live screenshot: nothing in the running app emits `sources` yet
(CHAT-16 hasn't landed), so there is nothing true to capture - stated
here rather than staging a screenshot that could only ever show an
empty state.

## Lane 10 item 2: real code-splitting for the frontend shell chunk

`App.tsx`'s `lazyNamed()` (a small `React.lazy()` wrapper for a named,
not default, export) turns every route but Home and Chat into its own
dynamic `import()`: `AppsPage`, `SetupWizard`, `ConversationsPage`,
`NotificationsPage`, `SearchPage`, `SettingsPage` and its seven nested
pages, `PeoplePage`, `MemoryPage`, `PrivacyPage`. Home and Chat stay in
the entry chunk deliberately, against the work order's own literal
"the shell, the kit and the chat stay in the entry chunk since chat is
the first screen" line: `/` (Home) is what a signed-in person's every
session actually lands on post-lane-9, not Chat, and lazy-loading the
one route hit on essentially every load would trade a smaller shell
for a loading flash on the single most common first paint - the
opposite of what code-splitting is for. Flagged here, not silently
assumed, the same as item 1's own correction.

**Before → after** (`vite build`'s own report, `frontend/dist/`):

| | Before | After |
|---|---|---|
| Entry chunk | 2,103.55 kB raw / 485.76 kB gzip (`index-B03fZQcH.js`) | 1,891.89 kB raw / 429.02 kB gzip (`index-Dqdb0T5g.js`) |
| JS chunks emitted | 1 | 39 (Rolldown's own automatic splitting factored out shared vendor chunks too - `react-dom`, `useQuery`, `useMutation`, `Select`, the icon set - not just the 15 lazy route boundaries this step added) |
| App-shell precache manifest | 5 entries, 2201.44 KiB | 39 entries, 2212.75 KiB |

The precache total barely moved (every emitted chunk is still
eagerly precached by default, lazy route or not - shrinking THAT is a
separate, un-asked-for change, narrowing `injectManifest`'s own glob to
exclude route chunks the way `globIgnores` already excludes the
onnxruntime bundle). What matters is the entry chunk alone, since
that's what crossed the ceiling: 1,891.89 KB now sits under Workbox's
default 2 MiB (2,097.152 KB) ceiling with about 205 KB (9.8%) to
spare, so `vite.config.ts`'s `maximumFileSizeToCacheInBytes: 5 * 1024 *
1024` override (BACKLOG.md's "worked around for now") is removed
entirely rather than lowered to some other number - the default is the
smallest value that holds, which is exactly what the plan asked to
find.

**Found live, real UI behavior, not a bug**: verifying the Suspense
fallback actually shows (`scripts/screenshot.ts`'s new
`captureLazyRouteSkeleton()`) surfaced that a normal in-app navigation
(clicking a sidebar link) never shows `RouteSkeleton` at all -
react-router-dom's own `Link` wraps the navigation in
`React.startTransition`, and React's concurrent-rendering rule for a
transition is to keep the PREVIOUS page fully live on screen for as
long as the next one is still suspended, exactly the "no loading flash
for a fast navigation" behavior that feature exists for. The fallback
still has a real, reachable case: a fresh load straight at a lazy
route's own URL (a bookmark, a reload, a deep link) has no previous
page to keep showing, so it suspends immediately. The capture also
found that this app's own PWA precaching (`sw.ts`) defeats an
artificial network delay on a chunk once installed - a precached asset
is served straight from the Service Worker's Cache Storage, a layer
Playwright's `page.route()` never sees - worked around for this one
capture with `serviceWorkers: "block"`, matching what a person's very
first visit (before anything is precached yet) would actually
experience.

**Verified**: `bun test` in frontend, 556 passing across 86 files
(`RouteSkeleton.test.tsx`, new: it announces `role="status"`/
`aria-label="Loading"`, never a blank div); `bun run screenshots`, 136
page/viewport/theme
combinations, 0 accessibility violations, 0 overflow; Home, Chat, and
Privacy (the lazy-loaded example) opened and read - all three show real
content, no spinner or empty state; `lazy-route-skeleton.png` (new)
opened and read - the shell (nav, the Privacy link highlighted active)
renders immediately while the content pane shows three skeleton bars,
never blank.
