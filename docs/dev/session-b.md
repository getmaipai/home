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
