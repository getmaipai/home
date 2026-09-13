# The first fixes chosen from the baseline table (2026-09-13)

Coordinator's pick from the baseline run recorded in
`docs/dev/session-a.md` (da97e37, run five: 56 of 60 rows, two
conversations broken every run, first delta p50 836 ms). Each item is
Session A's, one commit each, acceptance judged across three
identical bench runs (the baseline showed five rows moving between
runs at temperature 0.7; one green run proves nothing). After each
item, re-run the bench three times and record all three in the
item's section. Session B runs EVAL-01 on the same fixture while
these are coded; live checks wait for its engines to be down.

## 1. #92: a lookup miss is not a reply, and a literal pattern must not claim a household question (S-M)

Two halves. Engine: a Tier 0 pattern winner whose package returns a
typed "not found" (the knowledge summary 404, and any package outcome
of that status) does not end the turn in `plugin_error`; the turn
proceeds to the model path with the outcome recorded on the
`TurnContext` so the guards see a failed lookup and the reply is
narrated from it (CHAT-04's mechanism), never the package's placeholder
text (`[Knowledge could not answer.]` was spoken aloud in the reader's
rows). Manifest: the knowledge package's `what is *` pattern claims
"what is Pippa allergic to" and "what is two plus two"; a literal
pattern never claims an utterance whose subject is a roster name or an
arithmetic expression, either by narrowing the pattern in the package
(catalog side, FAST-03's procedure) or by a routing-side rule that a
Tier 0 pattern yields to memory recall when the subject is a household
name (one definition; pick the one that generalizes and say why).
Acceptance: the two #92 conversations pass three runs; "what is the
capital of France" answers "Paris"; the placeholder string appears in
no reply in the bench or the guard corpus; tool-calling bench
unchanged. Closes #92.

## 1b. #67: world-knowledge questions get the household honesty line (M, ahead of #93 by severity)

Live on the restarted dev hub, 2026-09-13 11:03, six turns about a
film: "have you seen it" got "I don't actually have that - nobody's
told me."; "do you know what it's about", "its runtime", "a
description" each got "I don't (actually) know that one, sorry.";
only "its rating" was answered. The hub log shows every reply with
source `model`, guard `[]`, safety allow, 790 to 924 ms: the model's
own words, not a guard replacement, and `websearch` offered on every
turn (`offered: ["remember","weather","websearch"]`) and never called.
So the cause is the prompt: the information policy is written around
household facts ("say you were not told"), and the 8B applies it to
the world; and nothing in the prompt tells it that not knowing a
world fact means calling the offered lookup. This is #67's exact
symptom, a week old, and the most visible defect a parent meets.

Do: (1) add the film conversation to the bench fixture as a
world-knowledge row set (six turns as above, persona-safe; rubric: a
rating, runtime or premise question is answered from knowledge or
through a websearch outcome, and the reply never contains the
honesty phrases "nobody's told me" / "I don't know that one"; an
"have you seen it" turn may say it cannot watch films but must not
claim it was never told). (2) Split the policy prose into two
sentences the model cannot conflate: household facts (people, plans,
the home) are answered only from what it was told, and a question
about the world is answered from what it knows or, when unsure, by
using the lookup tool it was offered; never the household line for a
world question. Keep it short (FAST-02's budget); do not re-add the
plugins list. (3) If the model still declines the lookup with the
policy fixed, the fallback is CHAT-17's forced-lookup retry brought
forward narrowly: a model reply that matches the honesty phrases on
a question-shaped world turn with websearch offered triggers one
retry with tool_choice required on websearch (the mechanism exists
in runTurn for the invention case); measure the cost. Acceptance:
the film rows pass three identical runs; the guard corpus's
household negatives still hold (a household question with no memory
still gets the honesty line); naturalness rows unchanged; no
regression on the other bench rows. Closes #67.

Also, same commit or the #73 one (lib/log.ts is in both): every
`[turn]` line is written twice to hub.log since 677d4c4, because the
turn logger appends to the file itself and the console mirror now
appends it again. One writer: the logger prints to the console and
the mirror persists.

## 2. #93: recall has a relevance floor that was never measured (S-M)

`memory.ts` passes durable records at cosine 0.37 and episodic at
0.55; its own comment says these came from legacy and "must be
re-measured on the bench before v0.1". ROUTE-01 measured the null
floor for this embed model at p95 0.60 on routing text. Measure
recall's null floor the same way (thirty unrelated queries against a
seeded household, record the max cosine of the top hit), set the
floors above it per tier, and make an empty recall result an explicit
"nothing relevant" outcome for both the tool path and the prompt's
memory block, so the model answers a general question from its own
knowledge instead of narrating an unrelated memory. Acceptance: the
"what year did the second world war end" row passes three runs; the
judge-eval abstention probe recalls nothing; the memory bench holds
its 12 of 15 and 7 of 8 (a drop is recorded and stops the item).
Closes #93.

## 3. The judge's subject resolution and the spoken correction (M)

Two rows from the table: "she also loves painting" stored as the
speaker's fact, and "can you remember that Marlow's birthday is in
June" stored as "Sage remembers that ..."; and the spoken correction
"no, I meant Friday at four" kept in two runs of three. Give the
extraction prompt the previous user turn and the speaker's name as
explicit context for pronoun and possessive resolution (the judge
already runs at temperature 0.1), and make a spoken correction of a
fact stated earlier in the same conversation a supersede, not a new
record, on the judge's contradiction path (the code exists for the
edit path, #88). Acceptance: the two misattribution rows and the
correction row pass three runs; judge-eval precision and recall hold.
If the 1.7B cannot resolve pronouns reliably with the context added,
record the numbers and stop; that becomes MEM-05's evidence.

## 4. From the 47-conversation run (d4a27c7): three small items ahead of CHAT-15, by severity

The failing rows landed and the run (119 of 159) showed, beyond the
designed misses, things the hub does rather than declines. In order:

**4a. A tool never runs on an argument the person did not say (S).**
"set a timer" with no length ran a ten-minute timer the model
invented; "add it to the list" added the word "it". Rule, in the
tool-call resolution before any package runs: an argument whose value
is a number, duration or time that does not appear in the utterance,
or a bare pronoun (it, that, this, them), is not run; the turn asks
for the value through the existing ask path ("How long?", "Add what
to the list?"). A pronoun argument resolves through the active subject
once CHAT-13 lands; until then it asks. Tests: the two rows; a timer
with a spoken length still runs; a list add with a spoken item still
runs. Bench rows updated to expect the ask.

**4b. Telling the hub to forget is honored or refused, never "Got it."
with the record kept (S-M).** "Forget what I told you" got "Got it."
and the record stayed active: a privacy lie. Build the chat-side
forget: a Tier 0 command ("forget that", "forget what I (just) told
you", "don't remember that") that retires the records whose provenance
is the last remembered turns of this conversation (the judge's
provenance ids; `forgetByIds()` exists) and replies with what it
forgot; when nothing was remembered yet, it says so and marks the
pending turns not to be judged. Until the command exists on a path,
"forget" is an action claim with no outcome and CHAT-04's narration
must say it cannot, never "Got it.". Tests on the record's status
(the effect standard). Closes the G2 row's first verb.

**4c. The household invention guard reads activities, not only traits
and places (S).** The film opening turn told Sage "Sage is watching it
too!": a roster name plus a present-tense activity, invented, and the <!-- prose-lint: allow -->
guards (traits, locations, claimed experience) do not read it. Add an
activity claim about a roster name or a second-person form to the
household invention family (present progressive or "is at/doing"),
grounded only by a memory or a turn that says so; corpus rows both
ways ("Pippa is at soccer practice" with the memory passes; without
it, cut).

Then #102, #99, #98 (small, already ruled), then CHAT-15. Recorded
for the items that own them, not fixed here: the knowledge package's
whole summary spoken for "the capital of Portugal" (CHAT-16 composes
it), "how do you know" after a lookup narrated as "I didn't look that
up" (CHAT-15 retains outcomes across turns), the next-day thread
(F1), the judge writing nothing from "my coworker Quill likes seltzer"
(step 3a; check the third-party-fact filter first).

## 5. BENCH-01: the live bench pins its sampling (S)

Twenty rows flipped between three runs of 4b's bench on the same
code, so "three identical runs" was measurable only for the row an
item targeted; the film and household rows (program step 5) are
judged by that rule and cannot be while the sampler's dice decide
them. `lib/llm.ts` sends chat at temperature 0.7 with no seed;
llama-server takes a per-request `seed`. The bench (conversationLive)
pins one seed for every chat and judge request of its run through a
bench-only switch (`lib/benchSampling.ts`, read by `llm.ts` and
`backgroundSupervisor.ts`; the app never sets it, production stays at
0.7 unseeded), `--seed N` picks another, `--seed none` runs unpinned,
and the run header records the seed and what to expect of it.
Acceptance: two runs on the same commit with the same seed produce
the same pass set (rows, not only totals); a third run with a
different seed may differ and says so in its header. If pinning does
not make two runs identical (llama-server's batching can still vary),
the residual variance is reported by row name; that is a finding, not
a failure.

- [x] BENCH-01, verified at the commit that carries this line: see
  [docs/dev/session-a.md](../dev/session-a.md) "BENCH-01" for the two
  same-seed pass sets, the different-seed run, and the residual
  variance by row.

## Filed, not fixed here

- The timer follow-up ("how long is left on it") invented a remaining
  time; the timer package has no status query. Issue: an honest "I
  can't check that" until a status query exists.
- Emoji and "let me know if you need anything else" endings on the
  reader's rows: FAST-06's samplers did not remove the canned closer;
  a naturalness item, after the fixes above.

## Rule for this file

Acceptance is three identical runs, all passing the item's rows, with
the three totals recorded. A fix that passes once and fails once is
not done.
