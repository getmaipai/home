# The simple turn pipeline: the build plan for the accepted design (2026-09-22)

For Jesse. The decision is yours. This page says what we build, what we
delete, how we know it works, and in what order, so the hub never gets
worse on the way.

## The short version

Today, when you type something, the hub runs it through about forty word
rules before the model ever sees it, then through about thirty more after
the model answers. Those rules decide whether to search, write the search
words themselves, and throw away answers they do not like. Every bad chat
today was one of those rules being wrong: the right answer about France
thrown away as a "repeat", "chile" not searched because it was typed in
lowercase, "he born" searched instead of the president's name, "search the
web" turned into a definition of the web, "did chatgpt 6 luna come out"
never searched because "come out" was not on the list.

The model itself was measured today and it is not the problem. Given the
search tool, the 8B made zero wrong tool calls in 100 tries. Its one
weakness is that it sometimes answers a question about the world from
memory instead of searching. That has a one-line fix.

The new pipeline has five steps and no word ladder:

1. **Safety first, unchanged.** The safety check, the crisis resources, the
   password catch, the child rules, temporary chat. All stay exactly as
   they are.
2. **A short list of instant commands.** Lights, timers, lists, reminders,
   "what time is it", "remember that", "forget that". These match exactly
   or not at all, and answer without the model. Nothing fuzzy.
3. **Context.** What the hub knows that is allowed for this person and this
   screen: memories (dated and labeled), the conversation, the clock.
4. **One model call with tools.** The model sees the conversation and the
   tools, decides, and writes the search words itself, so "he" becomes the
   president's name for free. One interim rule for the 8B, no word lists:
   a question about the outside world is always searched. A question about
   your own family never goes to the web.
5. **An answer with sources.** The model writes the answer from what the
   search returned, the sources show under it, the safety check runs on
   the way out, and that is all.

**One MaiPai, not several (a hard requirement).** There is one pipeline
and one code path, on the hub, on the robot and behind every client. It
never branches on the device. What changes from one machine to the next
is a small budget measured for the model that machine runs and stored
with that model in the catalog: how many tool rounds it may take, which
tools it is offered, whether the always-search rule is on, how much
context it gets. The hardware tier (how much memory the box has) never
decides any of that; the model's measured numbers do. The robot's Pi
runs the same five steps with the same contract; its budget simply has
the model-driven moves switched off, so it answers with the exact
commands, the context and its small model, and says plainly when a
question needs the hub. The proof is built in: the same replay set runs
through the same code on two different models, and only the budget
differs (unit U2's acceptance).

The whole thing is judged by one replay set: your own failed conversations
from today, run on every change. The new path is built next to the old one
behind a switch. The switch flips when the new path passes every replay
row and loses nothing on the rows that work today. Then the old rules are
deleted, one family per commit, and cannot come back.

On the 8B, "hi" goes from 3 to 5 seconds to about 1 second, a searched
question stays about 5 seconds. On the Studio both roughly divide by three,
and the design does not change; only the interim rule relaxes once the
bigger model is measured searching on its own.

## Phase 0: the tests before the build

Jesse asked whether the models and the stack he recommended were tested
first. Two things run before any loop or state code is written, and their
results are inputs to the build, not afterthoughts.

**(a) ARCH-BUILD-01, the buy-or-build spike** (M, two to three days,
Opus: it is judgment over measurements). It compares four ways to run the
new pipeline's loop and state on one representative turn (safety, model,
tool, model, output gate): today's engine, LangGraph JS embedded in our
Bun process (never its server), an in-house `TurnGraph` state machine,
and XState v5 (the maintained TypeScript state-machine library, no
telemetry, runs on Bun). Cedar is spiked as the authorization evaluator
behind one `authorize()` call, and Home Assistant stays the device
runtime (already the case). Letta's memory-block and archival concepts are
read for ARCH-MEM-01's record, not run. The measurements, per candidate:
boot and one real turn under Bun, install size and cold start; what breaks
with the network blocked (anything that phones home fails outright); how
many existing turn-engine lines become unnecessary versus merely wrapped;
what we lose if the project changes direction, and what an exit looks
like; whether the spec declares and the library evaluates, or the library
becomes a second source of truth; whether it runs, or is cleanly absent,
on the robot's Pi. The routing corpus, the safety corpus and the replay
set run through all four. Verdict per candidate: adopt, adopt partially,
reject, with one paragraph each in dev.md. The verdict decides U2's
orchestration; no unit that writes loop or state code starts before it.

**(b) ARCH-MEASURE-01, the per-model capability numbers** (M, Sonnet).
The tool-calling bench on the fixed pipeline at ten repeats per model:
the 8B and 4B are done today (below); Session B runs the 1.7B, the 27B
(in lane C's boundary window) and the robot-class model, on the same
commands, so nothing is redone. Plus the query-rewrite bench (15 two-turn
conversations with a pronoun in the second turn, ten repeats, pass when
the model's own search words carry the referent, the bar 90 percent of
rows at 9 of 10), taken from the paused REPLY-FIND-05 work. Together they
fill each model's budget record in the catalog: false-call rate, inverse
miss rate, rewrite pass rate, and from those the rounds, the offered set,
whether the always-search rule is on, and whether model-driven moves are
on at all.

Answered already: the 8B makes 0 false tool calls in 100 negative repeats
on both prompt shapes; the 4B makes 0 in 50 on the bare prompt and 5 in
50 on the production prompt; three of three world questions without a
search verb went unsearched on the 8B live today (the inverse miss); the
prefix cache breaks at 567 tokens whenever the tools block changes; the
routing corpus passes 169 of 170 rows on the embedding path.

**(c) Track 3, the local decider candidates** (M, Sonnet). The Jev-style
local reproductions named in `stack/docs/plans/jev-and-yue-2026-09-20.md`
(jeff/GliFormer at about 400M, openjev, open-jev-deberta) measured as the
"is this a question about the world, and should it search" decider,
against the routing corpus, A's draft rows, the owner's failed turns and
the labels already on the hub's rows, compared with the rule ladder and
with the 8B's own tool choice: accuracy, calibration of the probability,
latency per decision, and resident memory as the robot proxy, since a
decider of this size runs on the Pi where the 8B cannot. A winner here is
LOOKUP-HEAD-01's implementation and the interim rule's replacement; it is
judged with the other two tracks, and the routing-corpus bar from the
2026-09-16 review (five macro-F1 points over the rules) applies.

**Status, 2026-09-22 evening: phase 0 is running; (a) and (c) have their verdicts** ((c) in dev.md, "Track 3: the local decider verdict": the interim rule stays the one-line act-and-target rule for now; DeBERTa fine-tuned on household labels is LOOKUP-HEAD-01's path, not a zero-shot shadow run) (dev.md, "ARCH-BUILD-01: the buy-or-build verdict": XState v5 runs U2's machine, LangGraph and the in-house TurnGraph are rejected, Cedar waits for the policy record), so U2's state record can be written. Session A builds and
measures the spike and records numbers only (in the scratch folder, not
the repo); Session B runs the per-model benches; this session writes the
verdict table in dev.md from A's data and amends the ARCH rows, and has
stopped its own bench runs so the two do not compete for the machine.

**What can start today, gated on nothing:** U0 (the replay set and the
no-new-rules lint), U1 (the cache-stable prompt), U3 (the thinking
budget), U5 (dated memory lines). **Gated on (a):** U2 and everything
after it. **Gated on (c):** which decider the interim rule becomes,
never whether the loop is built. **Gated on (b):** U2's two-model acceptance, the budget records,
the flip, and the interim rule's relaxation on the Studio.

## The detail

### 1. What stays in code

Everything on this list is an invariant or a privacy rule, never a
judgment about phrasing.

- Input safety, the crisis state and its overlay, the credential line
  (`safety.ts`, `memoryContentPolicy.ts`, the top of `prepareTurn`).
- The output safety gate on every streamed sentence (`gateOutputSafety`),
  unconditional, as today.
- Age band, content ceilings, the memory disclosure filter before the
  prompt (`memory.ts` `canRead`), the child's short answers.
- Temporary chat (the in-process window, no rows), and the memory judge
  running only on eligible turns.
- The household-subject rule: a turn that names a family member is never
  sent to the web, and a lookup about a person asks first.
- Consent and confirmation for anything with a side effect: the typed
  action plan and its deterministic executor (ARCH-AGENT-01, accepted
  design). The model proposes; code checks permissions, exclusions,
  idempotency, then runs it.
- The honesty invariant: a reply may claim an action only when a package
  actually ran (`outcomes`), and a world answer without a search carries
  no sources and says so.
- The exact-match command list (step 2), maintained as a closed set with a
  hit counter per pattern, never a wildcard that swallows whatever follows
  ("search *" is how "search the web" became a definition of the web).
- Malformed-reply repair (an empty or cut-off reply is regenerated once).
- The one ReplyPlan: the surface's length budget and the child band
  (`register.ts`, as ARCH-LAYERS-01 accepted it). Length lives there only.
- The reply floor (owner's rule, 2026-09-23; the state record's "The
  reply floor"): the bare model's answer to the same words is the floor
  for content, structure and usefulness. The register, the persona, the
  plan line, the guards and safety change tone, length within the
  register's bounds and what a child is not shown, and never remove a
  point, a list, a heading or a step the bare reply had. A typed adult
  question gets the bare reply's completeness in the companion's voice.
  Measured by the written set's bare-parity column, a judge trend line
  beside the human verdict; U4b and PHRASE-01 accept on it.

### 2. What gets deleted

Sizes are function lengths measured today, so the numbers are honest
estimates, not promises. "Deleted" means removed in its own commit after
the flip, with the replay set green before and after.

| Family | Where | Lines | Why it goes |
|---|---|---|---|
| The lookup ladder: `lookupDecision`, `exactFieldOf`, `CURRENCY_MARK_RE`, `deliverableQuery`, the field stop list | `turnContext.ts` | ~200 | Word rules deciding "should we search"; the model plus the one interim rule replaces them |
| The query builders and forced lookup: `lookupQueryFor`, `runForcedLookup`, `notePendingLookup`, `worldAnswerQuery`, `holdForLookup`, `lookupConsent`, the lookup branch of `resolvePendingAsk` | `turnEngine.ts` | ~500 | The model writes the query from the conversation |
| The draft reader: `readLookupDraft`, `lookupShapeOf`, `hedgedFactShape`, the promise, offer and hedge regexes | `guards.ts` | ~120 | It read the model's words to guess whether to search; the search decision is made before the model speaks |
| The repeat guard and the stuck lines: `isRepeatReply`, `guardRepeatSentence`, `guardRepeatQuestion`, `CHAT_LOOP` | `guards.ts` | ~80 | It threw away a right answer to a repeated question |
| The deliverable rules: `composeDeliverable`, `deliverableKind`, `pictureDeliverableFor` and the "Here's a video" line | `turnEngine.ts`, `turnContext.ts` | ~60 | The model asks for a video or a picture through the tool and composes the answer |
| The register and assistant-register guards, the placeholder-echo guard | `guards.ts` | ~130 | Their failures cost more than their catches ("Noted." on a search request); the written register is a prompt policy |
| Tier 1 embedding routing as a decider, `selectOfferedTools`'s per-turn set | `routing.ts`, `turnEngine.ts` | ~400 | The tool set is fixed per model, so nothing ranks it; the corpus keeps only the exact-match rows |
| The utterance-only argument check | `unspokenArgs.ts` | ~150 of 262 | Replaced by a window check: an argument must come from the conversation, not just this line |
| The subject stack's world half and the pronoun machinery | `unknownNames.ts` | ~300 of 1,085 | The model resolves "he" from the window; the household half (who is Juniper) stays |

Roughly 1,900 lines of rules retire. What stays of the rule layer is the
dialogue-act signal (`turnSignal.ts`, which the interim rule reads) until
the learned head replaces its open-class part, and the household half of
the name resolver.

### 3. Deciding "is this a question about the world" without regex

Three answers, in the order they arrive.

- **Today (the interim rule).** (The answer-from-context escape is off
  initially; the rule is plain forced search until reuse of earlier
  evidence with freshness is built.) The turn signal already computes two
  fields on every turn: the act (question, inform, directive, greeting)
  and the target (world, self, hub, household). The rule is one line: a
  question whose target is the world runs the model call with the search
  tool required. No new words are added anywhere; a question the signal
  reads wrong is a signal bug with a corpus row, not a new rule. It
  over-searches a little ("why is the sky blue" gets a search), which
  costs seconds, never a wrong answer.
- **Next (the learned head, ROUTER-RLCD-01 then LOOKUP-HEAD-01).** A small
  calibrated classifier (a ModernBERT-class head or one of phase 0's
  track 3 candidates, about 30 ms, small enough for the Pi) trained on
  the hub's own rows, which already carry the label "which rung answered"
  and "was the next turn a correction". It replaces the interim rule and
  the open-class half of the signal when it beats them on the routing
  corpus's question rows and the replay set by the 2026-09-16 review's
  bar (five macro-F1 points), with its probability calibrated on our rows.
- **On the Studio.** The model's own tool call. The rule relaxes to "the
  model decides" for a model whose measured inverse-miss rate (a fitting
  search declined) on the replay set is under one in twenty. The 8B's is
  not (three of three world questions without a search verb went
  unsearched today); the 27B's is measured in ARCH-MEASURE-01. The
  relaxation is a field in that model's budget record, never a code
  branch, so the Studio and the laptop run the same file.
- **On the robot's Pi.** The same signal and the same loop, with the
  budget's model-driven transitions off: the exact commands, the
  context and the small model's phrasing answer, no search of its own;
  a world question it cannot serve says so, or goes to the hub when the
  hub is reachable.

### 4. The replay set

`backend/scripts/bench/datasets/owner-replay.json`, the exact words of the
owner's own turns today, none of which names a household member, run by
`scripts/bench/replay.ts` on both paths, three repeats each.

Failed rows (must pass): "who is the president of France" asked twice in
one conversation (the second answer is the same answer, never the stuck
line); "what did Apple announce this week" (a search runs, the reply
carries sources); "search who won the Seattle Mariners game yesterday" (a
search runs with the game in the query); "new trailer for primetime just
dropped" then "no, I was talking about the trailer" (a search with
"trailer" in the query, a video source in the reply); "who is the president
of chile", "when was he born", "yes" (a search with the president's name
or "president of chile" in the query, a sourced birth date); the
skeleton run's hallucinated-name follow-up as a permanent row ("who is
the president of chile" answered with an invented name, then "when was
he born": the follow-up must not search or answer for the invented
person); "did chatgpt 6
luna come out", "search the web" (a search, or a question back, never a
definition of the web), "search the web for when chatgpt 6 luna releases".

Control rows (must not regress): "when is dune 3 releasing", "when is the
carrie series releasing", "search the web for who won the Mariners game
yesterday", "hi", "say hi", "what's 12 plus 30", "what time is it in
tokyo", "remember that pizza night is Friday", plus the tool-call corpus's
five negatives (no tool call).

Pass bar per row: the deterministic checks (a search ran or did not, the
query carries the named terms, sources present, no stuck or honesty line,
no invented proper noun on a world question without a search) on all three
repeats; the benches' judge scores answer completeness only where a row
asks for it. The set grows with every bad chat the owner reports, in the
exact words, before the fix.

### 5. Latency on the 8B, and the Studio

From LAT-00 to LAT-03: the live engine prefills at 183 tokens per second
effective (405 on a fresh one-slot instance), decodes at 36, and today's
"hi" spends 3.3 to 5.5 seconds because the tools block breaks the prompt
cache every turn and a thinking-on first generation is thrown away.

New path, 8B: "hi" is one call over a cached prefix, about 150 new tokens
and a short reply, about 1 second. A searched question is two calls: the
tool call (about 1 second), the search (about 1 second), the answer over
the results (about 500 new tokens to read, then the reply), about 4 to 5
seconds to the first word of the answer, with a "Checking that" status
shown meanwhile. That is the same as today's forced ladder, with a right
query.

Studio (M5 Max, 27B class): prefill and decode roughly three times
faster, so "hi" under half a second and a searched question under 2
seconds. The design is identical; the interim rule relaxes per point 3.

### 6. Migration order, so the hub never gets worse

The new path is built beside the old one behind a household setting,
`turn.pipeline.next` (declared once in the settings registry, off by
default). Every unit lands with the replay set run on both paths and
recorded. The flip is one commit that sets the default on, allowed only
when the new path passes every failed row and matches or beats the old
path on every control row. Deletions come after the flip, one family per
commit, each with the replay set green. If a deletion turns a row red, the
deletion is reverted and the row becomes a unit, never a new rule.

### 7. The build units

Each is one backlog item. Floors: Sonnet where there is a verification
loop; Opus only for the one design record. Codex takes the S items.

- **U0, the replay set and the no-new-rules lint** (S each, Sonnet;
  starts today). The fixture above, `scripts/bench/replay.ts` mirroring
  `conversation.ts`'s runner, run on the old path today and recorded in
  dev.md as the baseline. And the lint, enforced by the gate and not by
  memory: `backend/scripts/lint/rule-budget.ts`, run by `scripts/check.sh`,
  counts regex literals (`/.../flags`, `new RegExp(`) and word lists (an
  array of three or more string literals) per turn-path file
  (`turnEngine.ts`, `turnContext.ts`, `guards.ts`, `unknownNames.ts`,
  `turnSignal.ts`, `utteranceShape.ts`, `routing.ts`, `replyConstraints.ts`,
  `unspokenArgs.ts`, `composer.ts`, and the new `turnNext.ts`) against a
  committed baseline `backend/rules-baseline.json`; it fails when a
  file's count exceeds its baseline unless every new line carries
  `// rule: <name>` naming a key in `ruleNames.ts` (the counter row the
  `[turn]` line already records hits for); the baseline may only go down,
  and a deleting commit lowers it. Protected modules are allow-listed
  (the safety signals in commons, `consentVocab.ts`,
  `memoryContentPolicy.ts`, `childDisclosure.ts`, `contentCeiling.ts`,
  `almanacCompute.ts`, `commands.ts`). Test: a fixture file with one
  unmarked regex fails the lint; the same line with a counter-row marker
  passes.
- **U1, a cache-stable prompt** (S, Codex; starts today). The tool set is fixed per
  model budget and sorted; the window precedes the context message. Test:
  two consecutive turns produce the same tools block. Acceptance:
  `cache_reuse_tokens` grows with conversation length on the dev hub.
- **U2, the one-call loop, the new path's core** (M, Sonnet; gated on
  ARCH-BUILD-01's verdict, which picks its orchestration; the loop's
  state record written first, Opus, half a day). `turnNext.ts` beside
  `turnEngine.ts`: safety, the exact commands, the context list, one model
  call with tools, the model's own tool arguments as the query (grounded
  against the window, not the line), one tool round, the answer with
  sources, the output gate. The interim rule from point 3. Consent and
  confirmation for side effects through the existing pending ask. Tests in
  the replay set's exact words with scripted model drafts. The budget is
  one record per model in `modelCatalog.ts` (`tool_calling`: rounds,
  offered set, always-search on or off, context tokens, model-driven
  transitions on or off), read by the loop and by nothing else; no
  device or tier check exists in `turnNext.ts`. Acceptance: the replay
  set on the new path, and the same replay set run through the same code
  on the 8B and the 4B with only the budget record differing, both
  recorded in dev.md.
- **U3, the thinking budget and the generation record** (S, Codex;
  starts today).
  LAT-00 landed the record; the budget is LAT-01: thinking on never cuts
  the visible answer. Acceptance: "hi" with thinking on is one generation.
- **U4, the answer register by surface** (M, Sonnet; after U2). RESP-01's two
  halves on the new path: the written policy for a typed screen, the
  spoken policy for voice, the plan's budget as the only length. The
  written-set bench and the seeded voice set.
- **U5, memory lines dated and labeled** (S, Codex; starts today, on
  the context list both paths share). REPLY-FIND-04 on the
  new path's context list.
- **U6, the flip** (S, the coordinator's call on the numbers; gated on
  ARCH-MEASURE-01's budget records for the models in the house). The
  replay set report on both paths, the default flipped, the old chat page
  unchanged.
- **D1 to D9, the deletions** (S each, Codex), one family per commit in
  the order of the table in point 2, the replay set and the trimmed
  routing corpus green after each.
- **After the flip:** ROUTER-RLCD-01 and LOOKUP-HEAD-01 (the learned
  head), ARCH-POLICY-01's ingress boundary over the context list (the
  list U2 introduces is its input), the action-plan executor's full
  shape, CUR-01.

### 8. Today's paused items

Fold in: REPLY-FIND-04 (into U5), REPLY-FIND-05 and -06 (they are U2's
core: the model writes the query, an offer becomes a search; the session
holding them moves to U2's brief instead of patching the old path), RESP-01
(into U4), LAT-01 and LAT-02 (into U3 and U1), the wake-word and
temporary-chat work (unchanged, on both paths).

Throw away: REPLY-FIND-01 (the repeat guard is deleted in D4; if the flip
is more than a week out, its one-line exemption may land as a stopgap, and
is deleted with the family), REPLY-FIND-02 and ROUTE-FIND-03 (a) (the
ladder is deleted), REPLY-FIND-03 (corrections are conversation; the model
reads the window), WO-Q3 (more admission rules for a ladder that is
going), ROUTE-FIND-03 (b)'s wildcard patterns (deleted in D7; "search",
"look up" and "google" become what the model already does).

Unchanged: PERF-ALERT-01, ARCH-BUILD-01's spike (it now compares the
in-house loop against LangGraph on U2's state record), the memory and
policy rows, the UI program.

### 9. What ARCH-MEASURE-01 still has to answer

See phase 0 at the top: the 8B and 4B numbers are in, and they are enough
to start U0, U1, U3 and U5 today. Still owed before the flip: the 27B's
inverse-miss rate (it sets when the interim rule relaxes on the Studio),
the query-rewrite bench (U2's own acceptance), and the 1.7B numbers (the
robot's floor, not the hub's).

### 11. Layers you can watch and swap (an owner requirement for U2's record)

Jesse's words: "then we can understand errors, delays, etc per layer and
more easily swap layers for better ones in the future." U2's state record
is written to this, and every later unit obeys it.

- **Every layer is a node with a typed contract.** Safety, commands,
  context, the model call, tools, answer, output gate: each is one node
  with a declared input type and output type, and nothing else crosses
  between them. A node knows nothing about its neighbours' internals.
- **Every turn carries a per-node trace.** For each node: its name, the
  implementation id and version that ran, start and end in milliseconds,
  the outcome (ok, skipped, or error with a code), and under the model
  node the generations LAT-00 already records (one entry per model call,
  with its reason and the engine's own timings). This extends LAT-00's
  generations array on the turn's stored stats and the `[turn]` line; it
  is not a second log.
- **One trace, every reader.** PERF-ALERT-01's stage split reads it for
  "where the time goes", and the replay bench reads it to report quality
  and time per node, so a slow layer and a wrong layer are both named by
  the same record.
- **Every node has a deadline, and it can be cut.** The budget record gives
  each node a deadline, and every node's work is abortable through a
  signal that reaches the engine request. The streaming call already
  takes a caller's signal with a re-armed idle timeout (COR-7); the
  non-streaming `chatComplete` has only a flat 120-second timeout and no
  way for a caller to pass a signal (COR-2), so the spec's chat client
  gains a signal first (LLM-TIMEOUT-01), then U2 uses it.
- **Swapping a layer is registration, not surgery.** A better
  implementation of a node registers under the same contract and is
  selected by the model's budget record or a declared setting; it is
  proven on the replay set with the per-node report, and no caller
  changes. The decider from phase 0's track 3, a different search
  package, or a new output checker each arrive this way.

### 10. End-state inventory

Every word-rule family in the turn path, what happens to it, and what
replaces it. Line counts are today's function and regex lengths, rounded.
"Nothing" means the behaviour it policed cannot occur on the new path.

| File | Symbols | Lines | Replacement |
|---|---|---|---|
| `turnContext.ts` | `lookupDecision`, `exactFieldOf`, `lookupRequest`, `deliverableQuery`, `deliverableInDenial`, `pictureDeliverableFor`, `CURRENCY_MARK_RE`, `FIELD_STOP_RE`, `LOOKUP_REQUEST_RE`, `ACTION_REQUEST_RE`, `PICTURE_FOLLOWUP_RE` | ~220 | The model's tool call in the one call; the interim always-search rule; then LOOKUP-HEAD-01 |
| `turnEngine.ts` | `lookupQueryFor` and its seven regexes, `runForcedLookup`, `notePendingLookup`, `lookupConsent`, `LOOKUP_IMPERATIVE_RE`, `worldAnswerQuery`, `holdForLookup`, the lookup branch of `resolvePendingAsk`, `composeDeliverable`, `deliverableKind`, the `IMAGE_*_RE` set, the world-subject capture family (`REFERS_BACK_RE`, `PRONOUN_RE`, `QUESTION_CAPTURE_RE`, `DETERMINER_KIND_RE`, `BARE_KIND_RE`) | ~550 | The model writes the query from the window; the pending ask keeps only consent and confirmation |
| `turnEngine.ts`, `routing.ts` | Tier 1 as decider: `routeSemantic`, `selectOfferedTools`, `pickTier1Winner`, `ensureRoutingEmbeddings`, `scoreByEmbedding`, the thresholds | ~400 | A fixed offered set per model budget; the embed engine keeps serving memory recall |
| `utteranceShape.ts`, `turnEngine.ts` | `utteranceShape`, `commandOpenersFrom`, `commandOpeners`, `COURTESY_PREFIX`, `EXCLAMATIVE_RE` | ~230 | Nothing; the exact commands need no shape, the signal's act covers the rest |
| `guards.ts` | the draft reader: `readLookupDraft`, `lookupShapeOf`, `hedgedFactShape`, `LOOKUP_PROMISE_RE`, `LOOKUP_OFFER_RE`, `HEDGE_MARK_RE`, `CHECKABLE_VALUE_RE`, `FALSE_CAPABILITY_RE`, `RECALL_CHECK_RE`, `LOOKUP_OBJECT_RE` | ~120 | Nothing; the search decision is made before the model speaks |
| `guards.ts` | the repeat family: `isRepeatReply`, `guardRepeatSentence`, `guardRepeatQuestion`, `normalizeForRepeat`, `repeatRetryNote`, `REPEAT_REQUEST_RE`, `OBJECTION_RE`, `CHAT_LOOP` | ~100 | Nothing |
| `guards.ts` | the register family: `guardAssistantRegister`, `isRegisterSentence`, `stripRegisterTail`, `isRegisterSkip`, `REGISTER_*_RE`, `CLOSER_*_RE`, `ACK_*_RE`, `GREETING_*_RE`, `TAG_QUESTION_RE`, `ADDRESSEE_TAIL_RE`, `RECIPROCAL_RE`; `guardPlaceholderEcho` | ~240 | The written and spoken policies in the prompt; the malformed repair |
| `guards.ts` | the world half of `guardInvention` (`CLAIMED_EXPERIENCE_RE`, `CONSUMPTION_EXPERIENCE_RE`, `PLANNED_EXPERIENCE_RE`, `LOCATION_CLAIM_RE`, `ACTIVITY_CLAIM_RE`, `PERSON_TRAIT_RE` and kin) | ~150 | Sources: a world answer without a search carries none and says so |
| `unknownNames.ts` | the world half: `worldAnswer`, `properNounsIn`'s world branch of `candidatesIn` and `resolveNames`, `WORLD_KIND_RE`, `WORLD_KIND_NOUN_RE`, `WORLD_MARK_RE`, `KIND_NOUN_AFTER_RE`, `LOWER_TITLE_RE`, `LOWER_TITLE_FOR_RE`, `PRODUCT_NOUN_RE`, `DETERMINER_BEFORE_RE`, `LOCALITY_RE`, `THIRD_PERSON_PRONOUN_RE` | ~300 | The model resolves names and pronouns from the window |
| `replyConstraints.ts` | `SHAPE_LIST`, `SHAPE_NUMBER`, `SHAPE_LINE`, `LENGTH_WORDS`, the "shorter" parse | ~30 | The model reads "shorter" in the window; the plan's budget bounds it; banned phrases stay |
| `unspokenArgs.ts` | the utterance-only grounding for read-only tools | ~150 | A window check of about 40 lines: an argument must come from the conversation |
| the websearch manifest | the `search *`, `look up *`, `google *` patterns | 3 | The model; a search verb with nothing after it is answered with a question, never a definition |

About 2,300 lines in all. Reviewed after the flip, not deleted with it:
`composer.ts` (it composes package results, which stay), and the
open-class half of `turnSignal.ts` (the emotion and stance regexes),
which LOOKUP-HEAD-01's head replaces on the 2026-09-16 bar.

Stays deterministic on purpose, per RULES-AND-LEARNED-COMPONENTS.md:

| What | Where | Why it stays |
|---|---|---|
| The safety floor, in and out | `commons/spec/safety/ts/signals.ts` (494 lines), `safety.ts`, `gateOutputSafety` | Non-removable architecture; identical in every house |
| The crisis state and its stop | `CRISIS_STOP_RE`, the crisis branch of `prepareTurn` | Offer, never block |
| The credential catch | `memoryContentPolicy.ts` | Nothing downstream may see a password |
| Consent and confirmation | `consentVocab.ts` (`AFFIRMATIVE_RE`, `NEGATIVE_RE`), the pending-ask protocol's consent and confirm kinds, the action executor | A yes is a yes by rule, never by a model's reading |
| Household privacy and disclosure | `memory.ts` `canRead`, `childDisclosure.ts`, `contentCeiling.ts`, the household-subject guard, temporary mode | Filtered before the prompt, never left to the model |
| The household half of name resolution | `unknownNames.ts`: `parseWhoAnswer`, `applyWhoAnswer`, the relation frames | It writes entity records, a consent path |
| The exact commands and household commands | `matchPattern` for closed intents whose argument is the remainder by definition ("remember that *", "add * to the list", "set a timer for *"), `commands.ts` | Instant, exact, testable; never a wildcard on a lookup |
| The almanac | `almanacCompute.ts` | Computed, not recalled |
| The argument quantity check for actions | `unspokenArgs.ts`'s number and duration matching | The executor runs what was said, never what was inferred |
| The honesty invariant | the `outcomes` check at the boundary | An action claim needs a package that ran |
| The reply plan's budget and child band | `register.ts` | The one place length is decided |
| The closed-set half of the turn signal | `turnSignal.ts`: greeting, closing, correction, household, hub-blame | Closed sets with a counter row, read by the interim rule |
| Malformed-reply repair | `wellFormed.ts` | A cut-off reply is regenerated once |
