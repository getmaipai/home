# Session A: after the 2026-09-12 block

Work order: `docs/plans/session-a-post-block-2026-09-13.md`, then the
items the coordinator hands over one at a time. Backend lane on `main`
in the main checkout, shared with Session B (frontend); every commit
gated on a throwaway worktree holding this session's diff alone. From
ROUTE-01 on, this file holds the dated sections (one `## <item>:` per
shipped item) and `docs/dev.md` carries one index line per item, so
two sessions no longer append to the same file. The earlier sections
(#77, #79, #78, CHAT-22) are in `docs/dev.md` under "Session A, after
the block".

## ROUTE-01: the bot's shape guard and routing trace, design (2026-09-13)

Driven by getmaipai/home#80: the model is never asked about a tool
unless routing already likes it. `prepareTurn()` offers a package as a
native tool only when `ranked[0].score` clears `TIER2_AMBIGUOUS_FLOOR`
(0.68); on "the plumber's number is 555 9876 extension 12, please
remember it" nothing did, the offered set was websearch alone
(`always_offer`), and the 8B stored nothing. With `remember` in the
set it called it five of five. 147cd28 covered the two "please
remember" phrasings with Tier 0 patterns; the floor still hides every
paraphrase of every other package.

### What changes

Three pieces, in the order a turn meets them.

**1. No floor on the Tier 2 offer.** `selectOfferedTools(ranked,
shape)`, exported from `turnEngine.ts`, replaces the inline
`floorCleared` / `topRanked` / `alwaysOffered` block in
`prepareTurn()`: the top `MAX_TIER2_TOOLS_OFFERED` (3) of `ranked`
plus every `routing.always_offer` package not already among them, no
similarity floor. `TIER2_AMBIGUOUS_FLOOR` stays exported for the
routing bench's own noise-floor report but no longer gates anything;
its comment says so. The constant that once protected a separate model
round trip protects nothing now that Fix E folded the offer into the
one completion that answers the turn; the cost of an offer is prompt
tokens, and the model's own tool judgment is the gate. Whether that
judgment holds without the floor is the measurement below, not an
assumption.

**2. The shape guard.** Ported from the bot's `router.py` (the mirror,
`robot/robot/cognition/nlu/router.py`, tier 3 of its cascade), where
it sits after the example tier and before the model tier: a question
or a first-person statement the deterministic tiers could not place is
conversation, never a model's guess at a skill. Measured there on
2026-09-02 with a 0.6B: offered every skill id, it answered "who wrote
the book IT" with silence and "what do you mean" with a check-in
skill's "by what time?". The three expressions, copied not paraphrased:

    polite prefix   ^\s*(?:hey\s+\w+[,\s]+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?
    question        ^\s*(?:who|whose|what|whats|when|where|which|why|how|is|are|was|were|am|do|does|did|can|could|should|would|will|shall|have|has|had|any|anything|anyone)\b|\?\s*$
    first person    ^\s*(?:i|i'm|i've|i'd|i'll|we|we're|we've|we'd)\b

`conversationShaped(text)`: strip the polite prefix; if it stripped
anything the utterance is a polite command ("can you clear the
timer"), not a question, so false; otherwise question-shaped or
first-person-shaped. Lives in `routing.ts` next to the Tier 1 scorers
(pure, no engine), exported for its tests and for the trace.

Where it applies: only to the Tier 2 offer, after Tier 0 (patterns)
and Tier 1 (embedding winner over `TIER1_THRESHOLD` with margin) have
both missed. A conversation-shaped turn then gets the `always_offer`
set alone (websearch: "what's the latest Stephen King novel" is
question-shaped and is exactly what always-offer exists for); a
command-shaped turn gets the top three plus always-offer. Tier 0 and
Tier 1 wins are not touched: "what do you remember about pizza night"
is a question and `recall`'s own business, and a Tier 1 win is a
deterministic placement, which is the guard's stated exception.

The guard's cost is stated up front: a first-person memory command
that no pattern catches ("I'm allergic to peanuts, remember that")
goes to conversation. Today it goes there too (nothing clears the
floor), so nothing regresses; the remedy is a pattern on the package
(`remember` already has "remember that *" and the trailing forms from
147cd28), which is the cheap, deterministic fix the work order
prefers. If the tool-calling bench shows a first-person positive that
the guard blocks, that row is the evidence for a narrower guard, and
it gets recorded, not tuned around.

**3. The trace line.** One `[route]` line per model-bound decision,
printed where `prepareTurn()` has both halves in hand (after the Tier
0/1 miss and the offer selection), JSON like `[turn]`:

    [route] {"turn_id":"turn-…","tier":"tier2","shape":"question","winner":null,"top":{"id":"recall","score":0.612},"runner_up":{"id":"remember","score":0.541},"margin":0.071,"offered":["websearch"]}

Tier 0 and Tier 1 wins print the same line with `tier: "pattern"` or
`"embedding"`/`"keyword"` and the winner set, so a few hundred real
turns give the arithmetic the bot's router comment asks for: what share
each tier answers, and what the conversational fallthrough is made of
(real conversation, a missing package, or a missing example line).
Scores rounded to three places; never the utterance text (the `[turn]`
line's own rule: the log carries ids and numbers, not what was said).

### The prompt-cache cost, named

Tools ride llama-server's `tools` field and the Qwen3 template renders
them into the system message at the top of the prompt, so a tool set
that differs from the previous turn's is a prefix-cache miss for the
whole prompt. Today every ordinary turn offers the identical
always-offer set (cacheable); after this, command-shaped turns carry
their own top three. The shape guard is what keeps the common case
(questions, first-person talk) on the stable set. The live check
records time to first token for one command-shaped turn against the
same turn on the 6cccc7c backend so the cost is a number, not a
worry; if it is large, the follow-up is ordering the offered set
stably (by id) and a per-package "offer me" cap, not restoring the
floor.

### Measurement (acceptance, per the work order)

The tool-calling bench (`scripts/bench/tool-calling.ts`) measured a
fixed four-tool set on a bare prompt: it never saw routing at all, so
it cannot say what the floor's removal costs. It gets a second pass,
`routed`, that builds each row's offered set the way `prepareTurn()`
does (`routeSemantic()` on the real bundled manifests, then
`selectOfferedTools()` with the row's own shape) and sends the real
prompt shape (`buildPromptParts()` for a bench person, no history), so
the number is the production path's number. The fixed pass stays as
the corpus's own contract. In the routed pass a call is false when
the tool is not in `expect_calls` and not an always-offer package; an
always-offer call on a negative row (websearch on the Stephen King
row) is counted and printed separately as a lookup call, because that
is the designed behavior of always-offer, not a routing false call.
The two #77 phrasings ride the routed pass as extra positive rows
expecting `remember`, through `complete()` with the real offered set
and prompt (the Tier 0 pattern would catch them in `runTurn()`, which
is the point of measuring the model path directly).

Pass: every positive row 10 of 10 at ten repeats, negatives 0 of 50
false calls, the two #77 phrasings 10 of 10 on `remember`. If false
calls rise above zero the number is recorded here and the item stops
there; no new floor gets tuned to pass.

Unit tests (bun:test, stub engine): `conversationShaped()` on the
bot's own cases plus the polite-command exception; `selectOfferedTools()`
offers the top three without a floor for a command shape and only
always-offer for a conversation shape; a `runTurn()` regression with a
scripted stub that calls `remember` when offered proves a sub-floor
command-shaped utterance now reaches it; the `[route]` line is
printed once per decision with the named fields.

Out of scope: the guard on Tier 1 wins, any change to
`TIER1_THRESHOLD`/`TIER1_MARGIN`, the routing corpus's thresholds,
`conversationHistory.ts` and `routes/turn.ts` (Session B needs them
for #60).

## ROUTE-01: shipped, and the numbers (2026-09-13)

What landed, against the design above: `utteranceShape()` and
`conversationShaped()` in `routing.ts` (the bot's three expressions,
plus "please" as a courtesy prefix; after a courtesy prefix only the
opener counts, so "could you remember that pippa's recital is friday?"
is a command, the coordinator's condition on this item);
`selectOfferedTools(ranked, shape)` in `turnEngine.ts`, exported, the
inline floor block gone; `logRoute()` printing one `[route]` line per
decision (Tier 0 and Tier 1 wins included); the tool-calling bench's
routed pass with the two #77 rows; `TIER2_AMBIGUOUS_FLOOR` kept only
as the routing bench's noise ceiling.

One refinement found by FAST-04's own regression test ("what have I
told you to remember about the weather", `recall` at 0.771 on the real
scorer): a question or first-person turn offers the always-offer set
plus the one candidate Tier 1 placed (cleared `TIER1_THRESHOLD` with
`TIER1_MARGIN`, `pickTier1Winner` over `ranked`) but could not fire
because its required arg binds only from a literal pattern. `recall`
can never win Tier 1 for that reason, so without this the guard
removed it from every question; a placement that only lacks its
argument is still a deterministic placement, and the argument is what
the model's tool call supplies. The top three by mere rank are never
offered on a question.

Tests: `routing.test.ts` (six `conversationShaped()` cases from the
bot, the coordinator's two conversation-shaped and three polite
command-shaped phrasings, compound sentences, plain commands,
`utteranceShape()` names),
`tier2.test.ts` (`selectOfferedTools()` on a command, on a question
with and without a Tier 1 placement, the margin rule, an always-offer
package already in the top three; `runTurn()` on "Friday is pizza
night, keep that in mind", 0.63 under the stub's scorer and no pattern,
now reaching `remember`; a question offered websearch alone; the
`[route]` line's fields, and never the utterance).

First measurement, `bun run scripts/bench/tool-calling.ts` at ten repeats,
qwen3-8b-instruct-q4-k-m.gguf on llama-server b10797 at 8788, nomic
embed at 8794, a MacBook Pro (M-series), fresh temp data directory:

Fixed pass (four tools, bare prompt, the corpus's own contract): the
three positive rows 10/10 each, negatives 0/50 false calls.

Routed pass (offered set from `routeSemantic` + `selectOfferedTools`,
real prompt shape):

| row | shape | offered | result |
|---|---|---|---|
| remember that pizza night is Friday and what do you know about the wifi password | command | remember, recall, remind, websearch | 10/10 |
| what does ephemeral mean and remember that my dentist appointment is next week | question | websearch | 0/10 |
| give me a trivia question and what do you remember about pizza night | command | recall, remember, trivia, websearch | 7/10 (three called trivia alone) |
| should I dye my hair black | question | websearch | 10/10, no call |
| I might go see the new Spiderman movie | first_person | websearch | 10/10, no call |
| what's the latest Stephen king novel | question | websearch | 10/10 websearch (lookup call, designed) |
| good morning | command | remember, remind, joke, websearch | 10/10, no call |
| I'm feeling kind of down | first_person | websearch | 10/10, no call |
| the plumber's number is 555 9876 extension 12, please remember it (#77) | command | remind, remember, joke, websearch | 10/10 remember |
| Friday is pizza night, please remember (#77) | command | remember, recall, remind, websearch | 10/10 remember |

False calls on negative rows outside always-offer: 0/50. Lookup calls
(websearch on the Stephen King row): 10/50, the designed behavior.
The #77 phrasings select `remember` 10/10 each through the model path
with both their scores under the old floor (remind 0.546, remember
0.490 on the first), which is #80's case closed.

Two positive rows short of 10/10. The trivia row's offered set is
identical to the floor rule's (recall 0.781 cleared it) and the
messages are the production prompt; the fixed pass on a bare prompt
gets 10/10, so the three single-call replies are the real prompt shape
costing the second call on a compound turn, present before this item
and visible now because the routed pass measures the production path.
The ephemeral row is the guard's cost: it leads with "what", no Tier 1
placement (remember 0.692, define 0.667, margin under 0.08), so the
offer was websearch alone and the model could not call either; under
the old floor remember cleared 0.68 and the row passed. Recorded and
handed to the coordinator before anything was tuned.

The ruling: a compound sentence is its clauses. `utteranceShape()`
now splits on " and " and on a comma (a clause under two words, "Sage,
what time is it", is a vocative, not a clause), reads each clause with
the courtesy-prefix rule, and the turn is a command when any clause
is; otherwise a question when any clause is; otherwise first person.
"who won the 1998 world cup and what do you remember about pizza
night" stays a question, "I'm home now, turn the porch light off" is a
command, and the ephemeral row is a command. Second run, same engine
and repeats, only the rows that changed or fell short:

| row | shape | offered | result |
|---|---|---|---|
| what does ephemeral mean and remember that my dentist appointment is next week | command | remember, define, recall, websearch | 7/10 (two called remember alone, one called nothing) |
| give me a trivia question and what do you remember about pizza night | command | recall, remember, trivia, websearch | 8/10 (two called trivia alone) |

Everything else unchanged: the other positives 10/10, negatives 0/50
false calls outside always-offer, 10/50 lookup calls, the #77 rows
10/10 on `remember`. The guard no longer blocks the ephemeral row;
what remains on both compound rows has one cause, and it is not
routing's. With the identical offered set (`selectOfferedTools()`'s
own) the bare prompt calls both tools 10/10 on each row; adding the
stable prefix alone drops it to 5/10 and 2/10; the full production
prompt (prefix plus context) 6/10 and 2/10. The system prompt is what
costs the second call on a compound request. Filed as
getmaipai/home#83 ("A compound request only gets its first action"),
pointing at CHAT-16's shared composer and CHAT-15's typed outcomes,
with that table; the routed pass stays in the bench as the number to
watch, and the fixed pass (bare prompt) stays 10/10 as the corpus's
contract.

The review on the diff found the first clause rule wrong in the other
direction: it defaulted every opener-less fragment to command, so
"what's the difference between a crocodile and an alligator" was a
command by its noun phrase, "hey maipai, who won the world cup" by its
vocative, and "the plumber is coming tuesday, right?" lost its question
mark to a one-word tag. Rewritten: a vocative in front ("hey maipai,",
"Sage,") is dropped; a clause counts as a command only on an imperative
signal, a courtesy prefix or an opening word that opens one of the
installed packages' own literal patterns (`commandOpenersFrom()`, the
first word of each `routing.patterns` entry that is not a question
opener, a determiner or a wildcard: remember, turn, set, add, put,
tell, give, convert, define, remind, translate, search and the rest,
the packages' own declaration rather than a hand-kept verb list); a
trailing question mark makes the turn a question unless a clause was a
polite request; a clause with no signal decides nothing, and a turn
made only of those ("good morning", "keep that on file") stays a
command, today's default, which ROUTE-02 takes up for greetings. The
review's seven cases are in `routing.test.ts`. Third routed run after
that rewrite: every shape and every offered set identical to the
second run, negatives 0/50 outside always-offer, the #77 rows 10/10,
the two compound rows 4/10 and 6/10 (7/10 and 8/10 the run before,
same offered set, same prompt: the spread is #83's at temperature
0.7). The trace line also gained `outscored_by_skill` for a fuzzy Tier
1 winner a stronger skill match displaced, so that placement is not
counted as "nothing placed".

A delta review of that rewrite found two more, both fixed: a vocative
without its comma ("hey maipai what time is it", the shape a
transcript has) was never stripped and fell to the command default,
so both forms are stripped now, except when the word after "hey" (or
before the comma) is a courtesy word or a command opener, which is the
signal and not a name ("Remember, I have a dentist appointment next
week" and "hey remember that the gate code is 4412" are commands); and
a leading "please," is a courtesy on the whole turn, a command unless
the rest opens as a question. Two it named are recorded, not fixed:
the pattern-derived openers include "got" (from "got any jokes") and
"weather" (from "weather in *"), so "I'm home and got the groceries"
reads as a command, and the courtesy rule reads "can you hear me?" and
"would you rather have a dog or a cat?" as commands because nothing
looks at the verb after the prefix. Both misreads cost a top-three
offer (a prefix-cache miss and the model's own judgment, which the
routed pass puts at 0/50 false calls), never a wrong action; the fix
for both is a verb reading the guard does not have today, and a
hand-kept stative or noun list is the kind of list this item avoided
on purpose. Left for ROUTE-02, which changes what a command-shaped
misread costs in the first place.

The prompt-cache cost, measured: a spare-port backend at HEAD
(aaaf724, the floor rule) and one at this diff, each on a fresh temp
directory against the same 8B on 8788, the same eight-turn sequence
in one conversation (a greeting, a question twice, a command twice,
the question again, the command again, the greeting again), time to
first delta in ms, two runs each:

| turn | HEAD run 1 | HEAD run 2 | ROUTE-01 run 1 | ROUTE-01 run 2 |
|---|---|---|---|---|
| Q1 "should I dye my hair black" | 766 | 452 | 1421 | 1043 |
| Q2 same again | 834 | 523 | 176 | 381 |
| C1 "tell me something nice about mornings" | 810 | 834 | 1360 | 1420 |
| C2 same again | 809 | 774 | 510 | 488 |
| Q3 question after the command | 834 | 527 | 999 | 998 |
| C3 command after the question | 815 | 994 | 1334 | 1429 |

At HEAD the tool set never changes (websearch alone on every one of
these turns), and the numbers sit between 450 and 1000 ms with no
pattern. With this diff the pattern is the tool set: a turn whose set
matches the previous turn's starts in 180 to 510 ms, and a turn whose
set differs (the question after the command, the command after the
question, the first of each) starts in 1000 to 1430 ms, about half a
second to a second more than the same turn at HEAD. The greeting is
command-shaped under the clause rule ("good morning" has no opener),
so it carries its own three (remember, remind, joke) and switches the
set too. The cost is real and bounded, and it lands on command-shaped
turns that follow a different set; the follow-up named in the design
(a stable offered set across ordinary turns, so only a genuinely
placed candidate changes it) is the coordinator's to schedule, not a
reason to restore the floor. Both spare-port backends were started by
pid and stopped by pid with 8809 and 8810 confirmed free; the shared
engines were never restarted.

## ROUTE-02: a stable ordinary tool set, design (2026-09-13)

The problem ROUTE-01 measured: the offered set now changes between a
question-shaped and a command-shaped turn, and every change is a
prefix-cache miss of half a second to a second of time to first token
on that turn. Two facts fix where the answer can live. First, the
Qwen3 chat template (read from the running engine's `/props`) renders
the `tools` list inside the first system message, right after
`messages[0].content` and before every history message and the late
context message; nothing we pass can move it, so "put the block after
history" is not available without hand-rolling the template, which is
the hand-built answer the org rule forbids. Second, the chat engine
already runs with `--cache-reuse 256`, so llama-server can shift and
reuse cached chunks after a changed segment, but only chunks of 256
tokens or more, and a household turn's history messages are shorter
than that; what a switch re-evaluates is the tool block itself (four
tools with FAST-03's descriptions and their arg schemas are several
hundred tokens) plus everything after it. The only stable position is
therefore a stable block: the same tools, in the same order, on every
ordinary turn, with a command turn's extras appended after them so
the common prefix survives.

### What changes

**1. The ordinary set.** `ordinaryToolSet(loaded)`: every
`routing.always_offer` package, plus the N most used packages by
`routingStats().byPlugin` (the `plugin` turns each package has
answered; a Tier 2 multi-call id "a+b" counts for both), N = 5, tied
and empty households falling back to a fixed default order (the
bundled memory pair `remember` and `recall` first, then `timer`,
`remind`, `weather`), always sorted by id so the rendered block is
byte-identical across turns. Computed once at boot and again only
when the installed set changes (`packages` install or remove, the
same hook that invalidates the routing embeddings), never per turn,
so a household's usage moves the set between boots, not between
sentences. Every conversation-shaped turn sends exactly this set (plus
the one Tier 1 placed-but-unbindable candidate, appended, when there
is one).

**2. Command extras, appended.** A command-shaped turn keeps ROUTE-01's
top three, but as an addition after the ordinary set, and only the
ones the set does not already hold; `selectOfferedTools(ranked,
shape, ordinary)` returns `[...ordinary, ...extras]` in that order.
With N = 5 covering what the household actually uses, most command
turns add nothing and stay on the cached block; a rare package costs
its own tokens once.

**3. No signal is conversation.** ROUTE-01 left "a turn with no
signal at all is a command" as today's default; it made "good
morning" carry its own three. Now a turn with no imperative signal
(no courtesy word, no opener the installed patterns declare, no
question or first-person opener) is conversation-shaped, named
`statement` in the trace, and offers the ordinary set. "good
morning", "thanks", "okay" are the tests. The cost is the one ROUTE-01
named: "keep that on file" with no opener rides the ordinary set,
which holds `remember` on every household that uses it (and by
default), so the model still sees it.

### Measurement (acceptance)

The same eight-turn sequence as ROUTE-01's table, spare-port backends
at HEAD (the ROUTE-01 commit) and at this diff, two runs each: time
to first delta on the question-after-command and command-after-
question turns within 100 ms of aaaf724's, and the greeting on the
ordinary set. The routed tool-calling pass unchanged: 0/50 false
calls outside always-offer, the #77 rows 10/10. If a command turn
whose top three fall outside the ordinary set still pays for its
extras, that number is recorded with the extras' token count and the
item stops there; N is not raised to pass, because the block's size
is prompt tokens on every turn for every household.

Unit tests: `ordinaryToolSet()` from a stats fixture (usage order,
the "a+b" split, the default order on an empty household, sorted by
id, always-offer always present); `selectOfferedTools()` order
(ordinary first, extras after, no duplicates); `utteranceShape()` on
"good morning", "thanks", "okay" as `statement`; a `runTurn()` case
proving two consecutive conversational turns send byte-identical
`tools`.

Out of scope: tool description length (FAST-03's sentences stay),
the template, `--cache-reuse`'s chunk size, #83.
