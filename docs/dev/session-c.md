# Session C: the brain and the voice loop

Work order: `docs/plans/session-c-brain-and-voice.md`, under
`docs/plans/wave-2.md`. Worktree `../home-c`, branch
`session-c-brain-and-voice`, `MAIPAI_DATA_DIR=data-c PORT=8801`.

## Step 0: setup

Worktree, own data dir/port, `bun install`, baseline `check.sh` green.

**A and B's merge, found broken, not assumed clean.** Neither
`session-a-intelligence` nor `session-b-ui` had merged to `main` when this
session started (wave-2.md's own precondition for C). Rather than branch
against stale files this session would own past Wave 1, `main` was merged
with both first: `session-a-intelligence` (through its step 10 - steps
11-12 are still that session's own to finish later, on a fresh worktree),
then `session-b-ui` (through its step 7). Both merges' `check.sh` had been
read as green from a backgrounded shell that had not actually finished;
re-run for real, the merge left three real gaps (stray dead migration
files from the conflict resolution, nine frontend test fixtures missing
the now-required `Person.hlc`, and `turn_meta` - the turn stream's new
first-line contract event - being treated as a fatal stream error
everywhere it wasn't yet explicitly handled, breaking every single chat
turn end to end). Found independently in this worktree while getting a
clean baseline; a concurrent session fixed and committed the canonical
version to `main` (`2956e1f`) before this session's own local copy of the
same fix landed, so `session-c-brain-and-voice` rebased onto it rather
than shipping a duplicate - see this repo's `git log` for the full
before/after, not repeated here.

**Per-person turn/LLM rate limiting, shipped now per the plan's own
fallback.** A's step 11 (the per-person request limiter on `POST
/api/turn`, `/api/turn/stream` and `/api/llm/*`) was confirmed absent from
the merged `main` (no `tryConsume` call anywhere in `routes/turn.ts` or
`routes/llm.ts`). Per `session-c-brain-and-voice.md` step 0's own text
("If A's step 11 is not on main when C starts, C ships the turn and LLM
route half"), shipped here: `lib/llm.ts`'s new `personWithinTurnBudget()`
wraps `lib/rateLimiter.ts`'s existing token bucket (F's file, reused
as-is, not forked) at `capacity: 5, refillPerSecond: 0.5` - a burst of
five, then one every two seconds - keyed `turn:<personId>`, one shared
budget across all four routes since a turn's own reply generation goes
through the identical model call `POST /api/llm/chat` does. Lives in
`lib/llm.ts` rather than either route file: it is the one module both
`routes/turn.ts` (via `lib/turnEngine.ts`) and `routes/llm.ts` already sit
above, so both routers depend on it without a route-to-route import in
either direction. New catalogue code `spec/errors/errors.json`'s
`turn_rate_limited` (a 429), reusing the existing `rate_limited` code's
`ui_message`/`spoken_fallback` wording was considered and rejected: that
entry's `message` field is specific to `host.fetch`'s own bucket, and
repurposing it without correcting the text would leave the catalogue
lying about which limiter fired. F's `lib/telegramChannel.ts`/
`voiceCatalog.ts` fetch-side half of A's step 11 is F's own to ship (its
own dev file already names it deferred to its step 3).

A medium-effort `code-review` on this diff caught the rate-limit check
duplicated near-verbatim across all four route handlers with the error
text already drifted between the two files (`"Too many turns too
quickly."` vs `"Too many requests too quickly."` for the identical code) -
fixed by consolidating into `lib/llm.ts`'s single `personWithinTurnBudget`
plus one shared `RATE_LIMIT_RESPONSE` constant per route file, both
importing the same wording. The review's other two findings (a single
budget shared across all four endpoints rather than scoped per feature;
every route here still a plain Hono handler rather than
`@hono/zod-openapi`, per `CLAUDE.md`'s documentation rule) are real but
pre-existing/deliberate, not fixed: the shared budget is this step's
whole point (see above), and zod-openapi conversion is a codebase-wide gap
on every route today, not something this diff uniquely regresses - noted
here rather than silently skipped.

**Stub LLM and embed backends confirmed in tests**, no action needed:
`lib/llm.ts`'s `complete()`/`embed()` already pick the in-process stub
whenever neither `MAIPAI_LLAMA_SERVER_URL`/`MAIPAI_LLAMA_SERVER_BIN` nor
`MAIPAI_EMBED_URL` is set (true for this worktree and the test suite),
and `backend/tests/llm.test.ts` already asserts the stub's canned-reply
wording directly.

**Bench command, for when a later step needs the real engine** (recorded
here once so later steps just point at it): set `MAIPAI_LLAMA_SERVER_BIN`
to a downloaded `llama-server` binary (`lib/engineCatalog.ts`'s pinned
builds) and `MAIPAI_CHAT_MODEL_PATH` to a local GGUF, or `MAIPAI_LLAMA_SERVER_URL`
to point at one already running; `MAIPAI_EMBED_URL` the same way for a
real embedding server (or it reuses the chat engine binary with
`--embedding` once a chat model has been downloaded at least once).
Neither is set anywhere in this repo today, so every `bun test` run and
every dev-server boot without them is the stub, on purpose.

`scripts/check.sh` is green (one flaky pre-existing test under full-suite
load, `runTurnStream() ordinary conversation streams real
sentence-chunked deltas`, confirmed by re-running in isolation and by a
clean second full run - not a regression from this step, not investigated
further here).

## Step 1: Tier 1 routing on embeddings, and the routing corpus

**Shipped:** `lib/routing.ts` (new) - `ensureRoutingEmbeddings()` embeds
every `routing.examples` entry not already stored under its current
SHA-256 hash (a changed example re-embeds under a new hash; the old
row is left in place, orphaned but harmless, never deleted), one batched
`embed()` call for everything missing rather than one per example;
`embedUtterance()` embeds the turn's own text once; `scoreByEmbedding()`
is max cosine per candidate over its own stored rows; `pickTier1Winner()`
is the real firing rule (`TIER1_THRESHOLD = 0.62`, `TIER1_MARGIN = 0.08`,
both this step's own starting values). The store (`routing_embeddings`,
schema v12) mirrors `memoryEmbeddings`'s buffer shape, keyed by
`(package_id, example_hash, space)`; `vectorToBuffer`/`bufferToVector`
exported from `lib/memory.ts` rather than duplicated.

`turnEngine.ts`'s `route()` now calls this for its Tier 1 branch (Tier 0
patterns are completely unchanged, still always win outright, checked
first and returned immediately). A candidate with no stored embedding
yet (just added, or a batch embed failure) falls back to the existing
`exampleScore()` keyword-overlap function for itself alone - the ranking
runs on whatever mix of real and fallback scores a turn actually has,
never all-or-nothing on "the embed backend is down." `route()` and
`matchingSkills()` (skills' own composition relevance, unchanged, still
keyword-overlap - see "not touched" below) are now exported, along with
`loadAllManifests()`, so the corpus test can drive them directly instead
of paying a full `runTurn()`'s cost per row.

**The live-found bug this step exists to fix, actually fixed:** "tell me
a bedtime story about a fox" now correctly reaches `storytime-style`
over `joke` (`backend/tests/turnEngine.test.ts`'s existing regression
test, unmodified, still passes) - not because embeddings are smarter
about "bedtime story" than keyword overlap on their own (the STUB
embedder is bag-of-words, no real semantics), but because
`pickTier1Winner()`'s margin requirement is what the old single
`EXAMPLE_MATCH_THRESHOLD` check structurally couldn't express: two
candidates landing close together from shared filler words ("tell me a")
now correctly fails to fire *either* one, and `joke`'s real score against
this utterance is low enough on its own not to matter here regardless.

**A real, pre-existing architecture limit the corpus surfaced, not
introduced:** `deterministicArgs()` (unchanged, already documented) never
binds a required arg without a `routing.patterns` wildcard capture - Tier
1 (fuzzy, no capture) can NEVER fire `recall`/`remember`/`define`/
`weather`, regardless of embedding quality, for any phrasing that doesn't
literally match one of their own patterns. Three of `recall`'s five and
two of `remember`'s five own declared `routing.examples` don't actually
match either package's own patterns, so they always fall through to
`null` today - not a bug this step introduces or should fix (a real Tier
2 tool call, step 2, is what should eventually route these, per the
existing "tier 2 native tool calling... not built" comment on
`deterministicArgs`). The corpus (`spec/llm/routing-corpus.json`)
records this honestly (`expect: null` with a `note` field explaining why)
rather than asserting a decision the system can't currently make.

**The other legacy misroute this step's corpus proves is genuinely
fixed, not just avoided:** "do you remember when we first met" - the
legacy bug was this phrasing getting treated as a `remember` (storage)
instruction, silently storing the question text as junk memory. Here it
matches `recall`'s own `"do you remember *"` pattern (Tier 0, unrelated
to embeddings) and correctly retrieves instead of storing - the corpus
row expects `"recall"`, not `null`.

**Tests:** `backend/tests/routing.test.ts` (15, `lib/routing.ts` unit:
re-embed-on-change vs. skip-on-unchanged, `embedUtterance`'s real
failure-returns-undefined contract via `embed()`'s own empty-string
rejection - no mocking layer, matching `memory.test.ts`'s established
"exercise the real contract" precedent - `scoreByEmbedding`'s
missing-candidate absence, `pickTier1Winner`'s threshold/margin/empty
cases, and the `onConflictDoUpdate` race guard). `backend/tests/
routingCorpus.test.ts` (49 rows, one `test()` per utterance) runs
`spec/llm/routing-corpus.json` against the real bundled packages and
skills through the stub embedder - every bundled package's own
`routing.examples` as positives, the anti-hijack case, and the legacy
misroutes above. `backend/scripts/bench/routing.ts` runs the identical
corpus against whichever real embed backend the machine resolves and
prints precision/recall per package; run once here against the stub
only (`MAIPAI_EMBED_URL`/`MAIPAI_LLAMA_SERVER_BIN`+`MAIPAI_CHAT_MODEL_PATH`
unset in this environment, see step 0's bench-command note) -
`bun run backend/scripts/bench/routing.ts` - 49/49, 1.00 precision and
recall on every package, which is expected and NOT evidence the
0.62/0.08 thresholds are right: the stub has no real semantics, so this
run only proves the mechanism (embedding storage, scoring, precedence,
fallback) is wired correctly end to end, not that the numbers hold
against a real model. **Re-run this bench against a real embedder before
trusting 0.62/0.08 in production** - genuinely not done in this
environment (no GGUF/llama-server available here).

**`RoutingStatsSection` (tier and score per decision):** `conversation_
turns` gained nullable `routing_tier`/`routing_score` columns (schema
v13, additive), set at `logTurn()` time from `TurnValue.routing` (new
optional field, only present on a `source: "plugin"` turn -
`{tier: "pattern"|"embedding"|"keyword", score}`). `RoutingStats.byPlugin`
gained `tier` (a `{pattern, embedding, keyword}` count breakdown) and
`avgScore` (null-safe for a turn logged before this step) per entry -
additive fields alongside the existing `pluginId`/`count`.
**`frontend/src/apps/settings/RoutingStatsSection.tsx` is Session E's
file, not touched here** (frontend/** ownership, wave-2.md): it still
renders exactly what it did before; the new fields are there for E to
pick up whenever they want to show tier/score in the UI. Noted here
rather than in the backlog since it's a one-line, low-priority pickup,
not a gap anyone's blocked on.

**Not touched:** `matchingSkills()`/`skillsSection()` (skill relevance
for prompt COMPOSITION - which skills' text gets injected, up to
`MAX_MATCHING_SKILLS`) still use the keyword-overlap `exampleScore()`
directly, not the new embedding path. Considered unifying these too
(skills already share the identical scoring primitive plugins used to),
but `buildSystemPrompt()`'s entire call chain is synchronous today and
many existing tests call it without `await` - upgrading skill
composition to real embeddings would mean making `buildSystemPrompt()`
async, a much larger blast radius than this step's own goal needs (the
anti-hijack fix only needed `route()`'s own Tier 1 to get real
embeddings, confirmed by the existing regression test passing unmodified
against the STUB's crude scoring). Left as a named, real gap rather than
force-fit: skill composition is a "which skills are worth composing in"
soft signal, not the hard Tier 1 routing decision this step's text is
actually about ("Tier 1 of the deterministic plugin floor" - the
section's own pre-existing header, unchanged).

## Step 2: Tier 2, grammar-constrained tool calls

**Shipped:** `lib/llm.ts` gains `tools`/`tool_choice` on `LlmCompleteOptions`
and `tool_calls` on `LlmCompleteValue`. Not OpenAI-wire tool-calling: the
mechanism is `response_format`'s existing JSON-schema grammar (session-a-
intelligence.md step 6's memory-judge precedent, reused not reinvented) -
offering `tools` builds a `oneOf`-discriminated array schema (`{tool,
args}`, `args` shaped by whichever tool's own schema `tool` names,
`minItems`/`maxItems` 0-2 or 1-2 by `tool_choice`) and the reply is parsed
against it. `parseToolCalls()` never trusts the grammar blindly
(llama.cpp's lazy grammars still let a malformed call through on recent
Qwen builds, upstream issue 24807, this step's own text names it):
`undefined` (a reply that isn't the requested shape at all, or names an
unoffered tool, or exceeds two entries) is distinct from `[]` (the model
looked and genuinely chose nothing) - callers "ask again" on `undefined`,
never treat it as a decision. A tool's own `args` shape is deliberately
NOT re-validated at this layer - `runPlugin()`'s existing ajv-compiled
schema check is the real "verified before acting," reused via the normal
call path rather than a second, divergent copy of the same check.

`turnEngine.ts`'s `route()` now returns `{winner, ranked}` instead of a
bare `RoutedPlugin | null`: `ranked` is every Tier 1-scored candidate
(this step's own pre-filter, "offer only the top few Tier 1 candidates as
tools"), including `consequential` packages - excluded from ever WINNING
Tier 1 (via `canFire`, alongside the existing arg-binding check, both now
folded into `pickTier1WinnerAmong()`'s retry rather than filtered out of
`eligible` entirely), but still real candidates for Tier 2 to OFFER, since
the model may propose one. `attemptTier2Tools()` (its own function,
exported, called from `prepareTurn()` only when Tier 0/1 found no winner):
offers the top 3 ranked candidates, caps execution at 2 calls, runs
independent non-consequential calls in parallel and combines their
replies, and routes a proposed `consequential` package into the same
confirmation flow below instead of ever calling `runPlugin()` for it
directly. A `consequential` proposal alongside a non-consequential one in
the same batch: the consequential one wins the turn, the other is
dropped for that turn (a documented simplification - one confirmation
question at a time, not "yes, and also...").

**Confirmation and `ask` continuation, one shared mechanism
(`conversations.pending_ask`, schema v14):** a Tier 2 proposal for a
`consequential` package, and a recipe result's own `confirm`/`ask` field
(spec/schemas/result.schema.json, typed since session-a-intelligence.md
step 6), both store a `PendingAsk` and ask the person instead of running
or replying outright. `resolvePendingAsk()` matches the NEXT utterance
against it before the floor (commands, Tier 0/1/2) and always clears it
after one try, matched or not - a stale confirmation waiting indefinitely
for a "yes" that never comes is worse than dropping it. `kind: "confirm"`:
a word-list match (`AFFIRMATIVE_RE`/`NEGATIVE_RE`, matched at the START of
the trimmed reply so "no thanks" and "yeah, go for it" work, not just a
bare "yes"/"no") - deliberately not a model call, since a "yes" waiting on
an LLM round trip to be recognized as "yes" is its own reliability problem
to invite for nothing. `kind: "ask"`: the raw next utterance is bound to
the package's own single required arg via `deterministicArgs()` (already
existed, reused rather than a second copy) - `ask.expects` is genuinely
just a free-text hint in the spec today, not a structured matcher, so
that's as far as this can honestly go without a spec change neither
session owns.

**A real, honestly-scoped gap, not silently papered over:**
`spec/interpreters/ts/recipe-interpreter.ts`'s own hand-written
`PluginResult` (Session D's file) only types `reply`/`actions` - no
recipe `Step` can set `confirm`/`ask` at all (no op exists for it), so no
bundled package can produce either field today. `pendingAskFromPluginResult()`
widens the type locally (`PluginResultWithConfirmAsk`, a superset cast -
today's real runtime objects simply lack both keys, which is safe and
exactly what the tests below prove) rather than editing D's file. This
consumption path is real and tested against a hand-built `PluginResult`,
genuinely unreachable by any bundled package until D adds the interpreter
op - not something this session can close.

**`exposes.queries`** (D's manifest change, wave-2.md's contract): D's
own branch (`home-d`, not yet merged) already shipped the exact schema
this step was told to build against as a fixture. Not consumed here -
none of C's bundled packages declare a query, and building a fixture
manifest for a feature with no real candidate to route to would be
testing the parser, not the routing; deferred honestly rather than
built against an imagined shape. Revisit once D merges and a real
package declares one.

**Tests:** `backend/tests/llm.test.ts` (+9, `complete()`'s tool-call
plumbing: valid single/double calls, an empty decision, a parse failure,
an unoffered tool, more than two calls, `tool_choice: required`'s
`minItems`, no tools offered at all). `backend/tests/tier2.test.ts` (17):
`attemptTier2Tools()` against real, network-free bundled packages
(`remember`/`recall` - `weather`/`joke`/`trivia` all make real HTTP
fetches, deliberately avoided per the org's "a unit test does not call a
... network service" standard) for the "a call actually runs" and
"combines two replies" cases, a hand-built `consequential` fixture
manifest (no file on disk needed - the confirmation path never reaches
`runPlugin()`) for the confirmation-gate cases, `resolvePendingAsk()`'s
confirm (yes/no/ambiguous) and ask (binds/can't-bind) paths, and
`pendingAskFromPluginResult()` directly. `backend/tests/toolCallCorpus.test.ts`
+ `spec/llm/tool-call-corpus.json` (3 rows, "Routing corpus rows for
multi-call utterances"): exercises `complete()`'s tools plumbing directly
for realistic two-tool utterances via a scripted reply (proving the
grammar/parser handle two independent, unrelated tools correctly), not
routed through real package execution (two of the three rows use network-
fetching packages). `backend/scripts/bench/tool-calling.ts` is the real
model half ("Bench: Qwen3-4B-Instruct-2507 and Gemma 4 E4B on the corpus,
numbers recorded") - run once here against the stub only
(`bun run backend/scripts/bench/tool-calling.ts`, 0/3, expected: the stub
has no real understanding, so it never produces valid tool-call JSON for
these prompts). **The actual bench numbers against a real model are not
recorded** - no llama-server/GGUF available in this environment, same gap
step 1's own routing bench left open.

**A medium-effort `code-review` on this diff caught three real bugs, all
fixed:** `backend/scripts/bench/routing.ts` (step 1's own bench script)
never updated for `route()`'s new `{winner, ranked}` return shape,
silently reporting every corpus row as a miss (`backend/tsconfig.json`
never typechecked `scripts/` at all - fixed too, added to `include`, so
this class of bug fails `check.sh` from now on rather than only
surfacing at bench-run time); `parseToolCalls()` checked the array's
upper bound (`> 2`) but not `tool_choice: "required"`'s own lower bound
(`0`), so a lazy-grammar `[]` under "required" would have been accepted
as a real "no tool needed" decision instead of the parse failure it
should be; and `attemptTier2Tools()`'s parallel-call path discarded a
successfully-run call's own reply text whenever the OTHER call in the
same batch carried `confirm`/`ask`, telling the person only about the
pending one and silently dropping the first's real answer - fixed by
combining both into one reply. That last one is real and tested at the
unit level (`pendingAskFromPluginResult()`'s own tests, and
`attemptTier2Tools()`'s existing "two independent calls" and
"consequential proposal" tests each cover one half) but not integration-
tested for the exact one-ok-one-pending combination: no bundled recipe
can produce `confirm`/`ask` at all yet (this step's own "real, honestly-
scoped gap" above), and this codebase has no established mocking layer
for `runPlugin()` to fake one - verified correct by inspection instead.

**A fourth review finding, considered and NOT applied:** that Tier 0's
exact pattern-match branch never checks `manifest.consequential` before
firing, "bypassing" this step's new confirmation gate. This reads
plausible but contradicts the pre-existing, deliberate design `route()`'s
own header comment already stated before this step touched it:
"a `consequential` package... raises the routing bar: it only fires on a
real pattern match, never on a fuzzy example score, however high" - a
pattern match has always been trusted to fire a consequential package
outright, precisely because it is a deliberate, unambiguous, household-
authored trigger (the same "a real trigger phrase always wins outright"
property this file states for the ordinary Tier 0/skill case too).
Confirmation is what this step ADDS specifically for a MODEL's own
proposal (Tier 2, no deliberate trigger involved) - the plan's own text
says "the model may propose it," not "a pattern match now needs
confirmation too." Applying this finding would have been a real
regression: "lock the front door" typed verbatim would stop working
outright and start demanding a second "yes" for no safety benefit, since
the pattern match is already the safety boundary. Recorded here so a
future pass doesn't reach the same plausible-but-wrong conclusion without
this context.

**Not touched:** `matchingSkills()`/`skillsSection()` (skill relevance
for prompt COMPOSITION - which skills' text gets injected, up to
`MAX_MATCHING_SKILLS`) still use the keyword-overlap `exampleScore()`
directly, not the new embedding path. Considered unifying these too
(skills already share the identical scoring primitive plugins used to),
but `buildSystemPrompt()`'s entire call chain is synchronous today and
many existing tests call it without `await` - upgrading skill
composition to real embeddings would mean making `buildSystemPrompt()`
async, a much larger blast radius than this step's own goal needs (the
anti-hijack fix only needed `route()`'s own Tier 1 to get real
embeddings, confirmed by the existing regression test passing unmodified
against the STUB's crude scoring). Left as a named, real gap rather than
force-fit: skill composition is a "which skills are worth composing in"
soft signal, not the hard Tier 1 routing decision step 1's text is
actually about ("Tier 1 of the deterministic plugin floor" - the
section's own pre-existing header, unchanged).
