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

- **Today (the interim rule).** The turn signal already computes two
  fields on every turn: the act (question, inform, directive, greeting)
  and the target (world, self, hub, household). The rule is one line: a
  question whose target is the world runs the model call with the search
  tool required. No new words are added anywhere; a question the signal
  reads wrong is a signal bug with a corpus row, not a new rule. It
  over-searches a little ("why is the sky blue" gets a search), which
  costs seconds, never a wrong answer.
- **Next (the learned head, ROUTER-RLCD-01 then LOOKUP-HEAD-01).** A small
  calibrated classifier (a ModernBERT-class head, about 30 ms) trained on
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
or "president of chile" in the query, a sourced birth date); "did chatgpt 6
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

- **U0, the replay set and its runner** (S, Sonnet). The fixture above,
  `scripts/bench/replay.ts` mirroring `conversation.ts`'s runner, run on
  the old path today and recorded in dev.md as the baseline.
- **U1, a cache-stable prompt** (S, Codex). The tool set is fixed per
  model budget and sorted; the window precedes the context message. Test:
  two consecutive turns produce the same tools block. Acceptance:
  `cache_reuse_tokens` grows with conversation length on the dev hub.
- **U2, the one-call loop, the new path's core** (M, Sonnet; the loop's
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
- **U3, the thinking budget and the generation record** (S, Codex).
  LAT-00 landed the record; the budget is LAT-01: thinking on never cuts
  the visible answer. Acceptance: "hi" with thinking on is one generation.
- **U4, the answer register by surface** (M, Sonnet). RESP-01's two
  halves on the new path: the written policy for a typed screen, the
  spoken policy for voice, the plan's budget as the only length. The
  written-set bench and the seeded voice set.
- **U5, memory lines dated and labeled** (S, Codex). REPLY-FIND-04 on the
  new path's context list.
- **U6, the flip** (S, the coordinator's call on the numbers). The
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

Answered today, enough to start U0 to U3 now: the 8B makes 0 false tool
calls in 100 negative repeats on both prompt shapes; the 4B makes 0 in 50
on the bare prompt and 5 in 50 on the production prompt; the prefix-cache
question is settled by the 567 evidence; the routing corpus passes 169 of
170 rows on the embedding path today (the trimmed corpus after D7 keeps
the exact-match rows only).

Still needed before the flip, not before the build: the 27B's inverse-miss
rate on the replay set, which sets when the interim rule relaxes on the
Studio; the query-rewrite bench (15 two-turn rows, 10 repeats, the 90
percent bar), which is U2's own acceptance; the 1.7B numbers, which
matter for the robot's floor and not for the hub.
