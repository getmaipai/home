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
