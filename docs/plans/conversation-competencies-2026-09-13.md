# What a natural, memory-rich conversation needs, and where each piece stands (2026-09-13)

Written by the coordinating session after Jesse twice named a
mechanism the plan had not (a friend-like reaction to "I'm watching
Cobra"; a household subject like the family dog going through the same
subject tracker). The fixes so far were picked one symptom at a time.
This file is the checklist: every competency a conversation with the
hub needs to feel like talking to someone who knows you and knows
things, mapped to what exists, what is planned, and what is missing,
with a bench conversation per row so the next gap is found by a run.
It is reviewed by an outside reader (Codex) for holes before the
subject tracker is built. Status words: **built** (on `main`, in the
bench), **planned** (a BACKLOG item), **missing** (no item).

## A. Following the conversation

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| A1 | An active subject: what "it", "she", "that one" mean, across turns, for world and household subjects alike | planned | CHAT-13, CHAT-10, TURN-01; the program file | the film set, the four world kinds, the three household kinds |
| A2 | Subject switch and return: "anyway, about the recital" after a digression | missing | add to CHAT-13's note: a subject stack of depth two, return by name | a conversation that digresses and returns |
| A3 | A correction changes the record and the reply: "no, I meant Friday", "actually she's seven" | planned | baseline-fixes 3 (judge), #88 (edits) | correction rows exist |
| A4 | "Never mind" and "forget it" cancel the pending thing, cleanly | missing | a pending-ask cancel rule; the confirm path has it, the ask path does not | one row |
| A5 | Multi-intent turns: two actions or a question plus an action in one sentence | planned (#83) | CHAT-15, CHAT-16 | compound rows exist |
| A6 | Clarify only when genuinely ambiguous, else best guess plus a one-clause hedge | planned | TURN-01's rule | one row with a real ambiguity, one with a false one |

## B. Knowing the person

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| B1 | Knows who is talking (name, role, age band) in every channel | built for chat and the API token; missing for voice (no speaker id) | the audit's #2; bot has BLE presence hints | a row per surface |
| B2 | Remembers what it was told and can say it back, days later | built for model turns; assertions in package, command, error and confirmation turns are not captured (CHAT-07 open) | MEM-01..04, JOIN-01, episodes | disclosure-then-recall rows |
| B3 | Brings a memory up unprompted when relevant ("wasn't Pippa's recital Friday?") | missing | the Proactive section names the skill-lookup case only; no item for memory-driven prompts | a row where the person mentions Friday and the hub is expected to connect it |
| B4 | Knows the household: who is related to whom, pets, things, places | stored (entities, relationships) but never read by the turn engine, and People holds account holders only; pets and things need entity rows | CHAT-13 must read the entity registry | the household-subject rows |
| B5 | Keeps a person's private memories private from other members | built and hard-tested | FAST/CHAT-01, the bench's hard row | exists |
| B6 | Speaks to a child in a child's register, to an adult as an adult | age band feeds safety only; the per-person speech profile (complexity, pace, vocabulary) is open and tone is unmeasured | persona-eval measures register per companion, not per age | a child-speaker row |
| B7 | Notices how someone is doing ("ugh, long day") and responds to the feeling before the task | missing | the safety overlay covers crisis only; no warmth measure | two rows: a bad day, a good one |

## C. Knowing the world

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| C1 | Answers world questions from what it knows; never "nobody told me" for the world | in flight | #67 as corrected | film rows |
| C2 | Looks things up when unsure, without being asked, and says what it found in its own voice | planned | CHAT-15, CHAT-16; the media package; INVEST-01 later | film and world-kind rows |
| C3 | Separates experience (never claimed), familiarity, exact facts, household facts | planned | the program file's four categories | film rows |
| C4 | Knows the date, the time, the season, and what "tonight" and "yesterday" mean | date and time supplied; no season; "tonight" and "yesterday" understanding unmeasured (the next-day row proves recall only) | FAST-02, MEM-04 | the next-day row |
| C5 | Knows the weather, the news, what is on today, when asked or when relevant | weather needs a named place ("what's the weather?" alone is not built; #98); news planned; "when relevant" missing | Skills section; Proactive section (L) | one row each |

## D. Sounding like someone

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| D1 | Reacts like a friend to a statement: an opinion, a detail, a question back; never a closer | in flight | #67 (opening turn), #95 (closers) | the opening-turn rows |
| D2 | Asks questions back when a friend would ("what do you think of it so far?") | missing as a measured behavior | persona prose only | a row where the expected reply contains a question |
| D3 | Reply length matches the moment: short for chat, longer when asked for detail | planned | CHAT-12, the detail flag in CHAT-01 | a short-question row, an "in detail" row |
| D4 | Does not repeat itself; varies phrasing | samplers on; only duplicate two-word openings measured; repeated substance unmeasured | FAST-06 samplers; persona-eval repeated-framing 0 of 40 | exists |
| D5 | Humor and a consistent personality per companion | companions exist; the live persona judge scored Tutor 0 of 10 and the default string checks are uninformative; unmeasured in practice | EVAL-03 control vector later | one row per companion |
| D6 | Expresses uncertainty naturally ("I think", "if I remember right") rather than refusing | hedges are permitted through the guard (FAST-05); whether uncertainty is expressed when warranted is unmeasured | guards | one row |
| D7 | Speaks numbers, times, names as a person says them (voice) | numbers and times yes; no name pronunciation; Roman numerals open (#61); benches read reply.text, never reply.speech | normalizeForSpeech; #61 open (roman numerals) | naturalness rows |

## E. Doing things inside the conversation

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| E1 | Runs a package and says what happened, truthfully | built | CHAT-04 narrates from typed outcomes | tool rows |
| E2 | Confirms before a consequential action, once, and never runs it twice | built and hard-tested | FAST-03 confirm; the bench's hard row | exists |
| E3 | Answers a follow-up about a running thing ("how long is left on it") from state, or says it cannot | missing | #94 | one row |
| E4 | Handles being interrupted, in voice and in chat | planned | VOICE-01, CHAT-17 | the interruption row exists |
| E5 | Mentions what it is doing when it will take a moment, in its own words | built | FAST-04's cue; INVEST-01 later | a tool row with a cue check |

## F. Across time

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| F1 | Picks up a thread from yesterday ("how was the movie?") when the person returns | missing | episodes exist; nothing prompts from them | a two-conversation row |
| F2 | Follows through on its own promises ("I'll remind you") | built for timers and reminders; missing for a promise made in plain words | the reminder package; CHAT-04 forbids the false promise | one row |
| F3 | Learns the household's habits and speaks to them ("pizza night again?") | missing | the Proactive section (L, needs a design pass) | later |


## G. Added by the outside review (Codex, 2026-09-13)

| # | Competency | Status | Where | Bench row |
|---|---|---|---|---|
| G1 | Personalization: known preferences, constraints, routines and past choices shape advice, recommendations and actions | missing | no item; CHAT-11's profile refresh is the nearest | a row where a stored preference must change the recommendation |
| G2 | Memory control in conversation: "forget what I told you", changing a memory's scope, confirming what was forgotten | missing in chat (the Memory page has it) | a chat-side forget and scope path through the same forgetByIds | one row per verb, checked on the record's status |
| G3 | Prior-reply grounding: "yes", "the second one", "what did you mean?" resolve against what the hub just said or offered | planned in part | TURN-01 names options and pending choices | three rows against an offered list |
| G4 | Voice repair: mishearing, low-confidence transcription, "say that again", silence, a speaker change mid-conversation | missing | VOICE-01 covers barge-in only | voice bench rows (the bot has the patterns) |
| G5 | Freshness and provenance: knows when its knowledge may be stale, distinguishes a remembered fact from a live result, can say where a fact came from | missing | CHAT-15's typed outcomes carry source and as_of; nothing surfaces them | a row asking "how do you know" after a lookup |

## Bench-row rule, from the same review

A row proves a competency only by observing the effect, never the
words: a correction is proved by the old record's status changing and
the new one active (A3); a cancel by the pending ask being gone (A4);
a compound request by both package outcomes present (A5); a household
subject by a read of the entity registry, with the fact seeded in the
registry and not in the transcript (B4); a lookup by a lookup outcome
with a source (C2); "have you heard of it" by the absence of any
experience claim, not only of refusal phrases (C3); "never twice" by
the package's own effect count, not turn rows (E2); an interruption
by the audio or transcript reconciled and inference stopped (E4); a
privacy row by the other person's memory content absent in any
paraphrase, checked against the record's key facts (B5); a promise by
the scheduler's later delivery, which the runner must observe (F2).
Every existing row named there is rewritten to that standard before
new rows are added.

## What this changes now

1. CHAT-13's design note covers A1, A2, A4, and B4 together (one
   tracker, a depth-two subject stack, a cancel rule, the entity
   registry as the household source).
2. The bench fixture first rewrites the rows the review found weak
   (A3, A4, A5, B4, B5, C2, C3, E2, E4, F2) to the effect standard
   above, then gains one conversation per "missing" row
   (A2, A4, A6, B3, B6, B7, D2, D3, E3, F1, F2, G1 to G5) written to fail today,
   so the table shows the gap and the fix is judged the same way as
   every other item. Rows that need a human read (B7, D1, D2, D5) are
   reader's rows.
3. Three missing items get BACKLOG entries with this file as their
   design pointer: memory-driven prompts (B3, F1) as one S-M item
   after CHAT-16; a cancel rule for a pending ask (A4, S); a warmth
   measure (B7, S, bench only).
4. Nothing else in the program's order changes: #67, CHAT-15, CHAT-13,
   CHAT-16, then the items the enlarged table ranks.
