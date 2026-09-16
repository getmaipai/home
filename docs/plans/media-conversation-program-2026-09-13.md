# The conversation program: subject, evidence, composition (2026-09-13)

**Scope: every subject a person can bring up, not films.** The film
exchange is the example that exposed it. A band, a recipe, a city, a
team, a game, a book, an event, a product, a person in the news: each
becomes the active subject, follow-ups resolve to it, exact facts come
from a typed source when one exists (the media package is one such
source; the knowledge package with Wikipedia is the general one) and
from the model's knowledge otherwise, and the companion engages with
it the way someone who knows things does. Nothing here is keyed on
the word "movie". A household subject goes through the same tracker:
"Snoopy is so silly, she's always rolling around in the mud" makes
Snoopy (the household's dog, an entity the hub knows) the active
subject, the companion reacts like a friend, the judge keeps the fact
because the person just said it, and "does she need a bath" resolves
"she" to Snoopy and answers from what it was just told. A family
member or a thing in the house ("the dishwasher is making that noise
again") works the same way; only the evidence source differs (memory
for the household, a typed source or model knowledge for the world).

Written by the coordinating session after Jesse's live film exchange
(2026-09-13 11:03) and an outside review (Codex) of what it shows.
The exchange: "I'm watching the movie Cobra" got a closer; "have you
seen it" got "nobody's told me"; "what's it about", "its runtime", "a
description" each got "I don't know that one, sorry"; only "its
rating" was answered. The hub log shows every reply as the model's own
words with websearch offered and never called.

The item in flight (#67, baseline-fixes 1b) removes the honesty
vocabulary from everything the model reads and makes the persona a
knowledgeable companion; it is necessary and it is a symptom fix. The
three structural problems, each with an existing item:

1. **No resolved conversation subject.** "Cobra" should become the
   active subject; "it", "that one", "its rating" resolve to it.
   `subjectEntityIds` exists on the turn context and is empty. That is
   CHAT-13 (with CHAT-10's bounded query); the bot's three-turn subject
   tracker is the pattern (TURN-01's note).
2. **Household knowledge and world knowledge are one category to the
   model.** "Nobody's told me" is right only for an unknown household
   fact. After #67 the guard's replacement bank is the only place those
   words exist, and FAST-05 and CHAT-04 already scope the guards to
   household subjects; #67 finishes it by taking the words out of the
   prompt.
3. **The chat model decides alone whether to look something up, and an
   8B declines.** Prompting harder cannot make that reliable. The
   hub's general lookup is websearch through the household's own
   SearXNG instance: private by construction, and the spine for every
   kind of world question (facts, films, music, news, sports,
   showtimes, opinion, anything current). When the model is unsure
   about a world subject, the engine runs that lookup, not the model's
   choice. Typed sources (media-lookup on Wikidata, weather, the
   knowledge package's Wikipedia summary) are accelerators for
   specific fields on a resolved subject of a matching kind, tried
   first because they return structured facts; SearXNG answers
   everything they cannot. Every result is retained as turn evidence
   (not memory) and phrased through one composer in the companion's
   voice. The routing rule is by subject kind, never by a topic word.
   That is CHAT-15 (typed outcomes retained), CHAT-16 (one composed
   path, designed around web results first), and the media package
   as one accelerator.

## The target flow

"I'm watching Cobra" resolves the subject (film, 1986, Stallone; asks
"the 1986 one or the remake?" only if genuinely ambiguous) and replies
conversationally from what it knows. "Have you seen it" answers the
experience question honestly and still engages with the subject ("I
can't watch films, but I know that one: Stallone as a cop protecting
a witness, pure mid-eighties action"). "What's its runtime" resolves
"its", reads retained media evidence or calls the media package, and
composes the number in the companion's voice. Four categories the
design keeps apart: experience (never claimed), familiarity (offered
as reputation or reading), exact public facts (model knowledge when
safe, a typed source when precision matters), household facts (only
these need household evidence and may honestly say "I don't know").

## Order and owners

| Step | Item | Owner | Depends on |
|---|---|---|---|
| 0 | #67 as corrected: honesty words out of the prompt; the film conversation as a permanent bench row set | A (in flight) | none |
| 1 | The media package: film and TV metadata, keyless (Wikidata for the typed fields, Wikipedia summary for the synopsis), typed result `{ title, year, kind, director, cast, runtime_min, rating, synopsis, source }`, routing examples, five-example minimum, privacy rows, tests against recorded fixtures | B | none (isolated package directory) |
| 2 | CHAT-15: typed outcomes retained for every accepted package call, on the turn and the conversation, never as memory | A | CHAT-01 (done) |
| 3a | Entities and subjects from conversation (spec first): a memory record gains an optional subject (an entity id) beside its text; the judge creates a person, pet, place or organization entity when a sentence names a new one, and a relationship record when the sentence states one ("my coworker Quill"), owned by the speaker like the memory; recall and the guards use the subject id, not only the name in the text. Jesse's example is the bench row: "my coworker Quill likes seltzer", then "do I like seltzer" (does not know, no guess), "what does Quill drink" (seltzer), "who is Quill" (your coworker) | A | 2 |
| 3 | CHAT-13 with the subject half of CHAT-10: the active subject on the turn context (an entity with a kind, a name, a year when known), resolved from the current text or the last two same-thread user messages; pronoun and "that one" follow-ups resolve to it; a factual media follow-up on a resolved media subject routes to the media package deterministically | A | 2, 3a, and B's package for the live rows |
| 4 | CHAT-16: one composer for every factual result, phrased through the selected companion with the active subject and recent turns as context; no package text spoken as-is. Evidence ladder for a world subject: the typed source first (media-lookup, weather, knowledge), then websearch through the household's own SearXNG when the typed source misses or the field is null or the question is about opinion or currency ("is it any good", "what's on tonight", a film too new to be catalogued), then the model's own knowledge, and never a "don't know" while a rung remains. | A | 2, 3 |
| 5 | The film conversation and four more of the same shape on other subject kinds (a band, a city, a historical event, a video game: an opening statement, "have you heard of it", two factual follow-ups with pronouns, one opinion question) plus three household-subject conversations of the same shape (the family dog, a family member, a thing in the house: an opening statement that carries a fact, a friend-like reaction, a pronoun follow-up answered from what was just said, a follow-up two turns later that must not confuse the household subject with a world one of the same name) pass three identical runs end to end, with the four categories each shown by a row; the general subjects go through the knowledge package or model knowledge, proving the mechanism is not media-specific | A | 0 to 4 |

**Step 3a, amended 2026-09-13 (the design pass, dev.md sections 3, 8
and 10):** a kind or a relationship the judge model inferred rather
than the speaker stated is a candidate, never knowledge. It is written
with an open question on the conversation (ASK-01's slot), asked once
at the end of the next reply; until the person answers it is not
rendered to the model (the hedge line "I think your coworker, not
confirmed" goes), recall never reads it, and the guards and the
resolver treat the name as unknown-kind. The answer promotes it through
the confirm transition 3a already built. A world subject (a film, a
band, a game, a product) never becomes a household entity on the
judge's path or any other; it is a world `SubjectRef`.

CHAT-12 (budgets) is a technical prerequisite CHAT-16 names; take it
inside step 4 if the composer needs it, not before. The judge's
subject-resolution item (baseline-fixes 3) follows this program; #98
and #99 are small items between steps.

## Findings from live use, 2026-09-13 evening (designed 2026-09-13)

**Designed:** the design pass landed in
[docs/dev.md, "The chat design pass"](../dev.md#the-chat-design-pass-findings-1-to-18-and-the-companions-brief-2026-09-13),
one section per finding group, with the backlog items under
[BACKLOG.md, "Design pass 2026-09-13"](../BACKLOG.md#design-pass-2026-09-13)
and the amendments on CHAT-13 and CHAT-16 themselves.

**The queue, revised 2026-09-14 by the coherence review** (dev.md,
"Coherence review, 2026-09-14"; each item proven by its rows in three
seeded runs before the next starts; the first block is the smallest set
that fixes the five priority defects):

| # | Item | Fixes | Size | Depends on |
|---|---|---|---|---|
| 1 | RECALL-02 (in flight) | copies other conversations | S-M | none |
| 2 | OUT-01 (in flight) | sends broken text | S | none |
| 3 | SPEC-01, the one spec migration | the foundation | S-M | none |
| 4 | ACT-01, the signal's rule and protocol layers, the turn row, the judge queue, the fixture expectations | the foundation | S-M | SPEC-01 |
| 5 | REG-01, EXP-01 | acts as if it knows (register), experience claims | S, S | ACT-01 |
| 6 | ASK-01 with the household-frame rule | never asks about the unknown | M | SPEC-01, ACT-01 |
| 7 | MEM-06 core (no confidence) | acts as if it knows (memory) | S-M | ACT-01, SPEC-01 |
| 8 | AGE-01 core (the band in `canRead()`, the default, the deferral line) | the child invariant | S | SPEC-01, ASK-01 |
| 9 | LOOKUP-01 | promises and offers | S-M | ACT-01 |
| 10 | CHAT-13 with CHAT-10 folded | subject, corrections, the lookup decision | M | SPEC-01, ASK-01, LOOKUP-01 |
| 11 | CHAT-16 with ACT-03 core, one work order | reads search results like an article | M plus M | CHAT-13, MEM-06 |
| 12 | CHAT-08 | read-time validity | M | SPEC-01 |
| 13 | CUR-01 core (duplicates, expiry, disputed, open questions) | store hygiene | S-M | MEM-06, CHAT-08 |
| 14 | EVAL-07 memory mode (LongMemEval sampled, LoCoMo) | the public baseline | M | MEM-06 |
| 15 | AGE-02 | the worrying-conversation notice | S | AGE-01, ACT-01 |
| 16 | ACT-02, the emotion head first | care on the common case | M | ACT-01 |
| 17 | REVIEW-01 narrowed | the weekly report | M | CHAT-16 |
| 18 | PREF-01 | explicit preferences | M | REVIEW-01 |
| 19 | EVAL-07 mining, rewritten rows | the phenomenon rows | a person's hours | CHAT-16 |
| 20 | SPEC-02, the companions migration | the companions' foundation | S | none |
| 21 | COMP-01 to COMP-06 | the brief | as sized | SPEC-02, CHAT-16 |
| 22 | CRED-01 (section 14) | credence | M | CUR-01, ACT-03 |
| 23 | the credulity slices of COMP-03 and COMP-05 (section 15) | credulity | S, S | CRED-01, COMP-05 |
| 24 | SPEAK-01, WAKE-02 | hardware | L, L | the bot's pipeline |

CHAT-12 stays deferred behind the volatile-zone ordering; CONC-01
counts the composer's second completion when it lands.

Defect classes observed by the coordinator in live household chat,
recorded as findings, not designed. The rule: the design for these
gaps is done in a separate pass with a stronger model, not by the
coordinator or Session A on the fly. Session A builds nothing for them
until that pass lands; each becomes a bench row (persona roster,
fictional subjects) so the pass is judged the same way as every other
item. The one exception is a data gap, not a design: the weather
package fetches only the current temperature (`current=temperature_2m`),
so a rain question can only be answered with a temperature; it returns
conditions, precipitation chance and today's high and low as typed
fields, beside #98.

1. A reply copied verbatim from a different conversation on a short
   turn (an opinion question about one subject answered with an
   earlier conversation's review of another). Observed cause: the
   prompt's "From earlier conversations" block (lib/episodes.ts,
   turnEngine.ts near line 1749) quotes the hub's own past replies as
   well as the person's words.
2. "Let me check that for you" with no check, and the follow-up "do
   it" answered with "what do you need done?".
3. Confident invention about a new release (an episode count, an air
   day, a review verdict, a different film's reviews for the one
   asked about).
4. An experience claim about media (having seen or planning to watch).
5. A link ask answered with a summary and no link.
6. A short turn echoed back instead of answered.
7. An explicit correction ("wrong show") acknowledged and then the
   same wrong subject repeated.
8. A rain question answered with a temperature in an unnamed place
   (the data gap above; #98).

Household-subject conversations, later the same evening (the same
rule, classes only):

9. Class 1 again, five times, across subjects: a short or odd turn
   answered with a sentence from a different conversation, including
   one triggered by a word that also names a band. The dominant defect
   in every conversation observed.
10. Claiming prior knowledge of a household person the speaker has
    just named ("that's right, X had his birthday"), then unable to
    say how, then a tense loop. The invention guards cover activities
    and traits, not confirming the speaker's own statement as known.
11. A new household name (a relative, a coworker, a pet) never asked
    about; when the speaker later says the name is a dog, the earlier
    advice had assumed a person. Step 3a creates the entity from
    conversation; nothing yet makes the hub ask who a new name is, the
    way a person would.
12. Chit-chat about a conversation with someone treated as a command
    ("I've noted that"), followed by a guard line about a list nobody
    mentioned: routing plus a replacement bank inventing context.
13. A reply consisting of a single word ("I"), sent as is. An empty or
    fragment reply must never be sent.
14. Pronoun drift for a household subject (the wrong gender for a pet
    whose sex the speaker had just used) and a robotic register ("I've
    noted that", "I'm still learning").
15. Assumptions in place of a question: an unknown name was assumed to
    be a person and the advice built on it (a landlord, cleaning up
    after a tenant); a wrong assumption is never corrected by asking.
    The rule a person follows, and the hub does not: when a name, a
    kind, or a fact is unknown, ask, never assume.
16. Random subject changes with no prompt from the speaker (a paragraph
    about an unrelated band; a suggestion to photograph a mess).
17. Broken output sent as a reply: a sentence ending in a stray
    quotation mark, a reply of one word. Output that is not a sentence
    is never sent.

18. Web search replies read like an encyclopedia entry, not like a
    friend who just looked something up: a paragraph of summarized
    results in the search package's own voice ("the search results
    show that ...", "in 2026, some recommended games include ..."),
    with no reaction, no pick, no follow-up. Jesse's own emphasis:
    this is the big one for how the hub sounds. CHAT-16 is the designed
    answer (no package text spoken as-is; one composer phrases every
    result through the companion with the active subject and the
    recent turns as context), and the design pass judges whether that
    design is enough or the composer needs a stronger rule (react,
    pick, offer the next step, in the companion's register).

19. A date given as a fact ("September 15") turned into the wrong
    relative phrase ("a few days from now" when it is tomorrow), then
    a cover story when corrected ("I'm just being playful"). Date
    arithmetic is the model's alone today; the composer's typed data
    is where a date becomes "tomorrow" deterministically (CHAT-16), and
    an invented reason for a mistake is the same class as an invented
    fact (EXP-01's claimed_statement, extended to claims about the
    hub's own intent).
20. A fact stated at the start of a conversation was unreachable
    twelve turns later ("what time did I tell you"): the window had
    dropped it, episode recall excludes the current conversation by
    design, and the invention guard cut the reply to the honesty line.
    Observed 2026-09-14 on main at 137635d. Queued as RECALL-03 with
    the guard replacement bank losing the honesty vocabulary
    (GUARD-LINES), both ahead of ASK-01.

21. Four wrong titles for one game across three corrections, with no
    lookup until the person demanded one. A person corrected once
    rechecks; corrected twice, concedes. Rule for CHAT-13 and CHAT-16,
    Jesse's, 2026-09-14: after the first correction of a claim, the
    hub never re-asserts that claim from its own knowledge (the
    subject stack's rejected list); it looks the claim up once; if the
    lookup settles it, it says so once; if the lookup cannot settle
    it, it concedes and asks ("I clearly don't have this one, what's
    it called?"). Never a third guess. The chat is the bench row with
    a fictional game and roster names.

22. Measured on public data (EVAL-07's first diagnostic question,
    2026-09-14): a two-fact temporal question missed because the judge
    never wrote one fact and wrote the other then edited it away
    across four supersede revisions, the final active record keeping
    an unrelated aside and losing the fact itself. The silent-overwrite
    path the design pass named on decideDedupe(); MEM-06's acceptance
    gains a row where a fact restated with added detail keeps its core
    across revisions, and CUR-01's a row where supersede never removes
    content the person stated.

23. The hub asks a question back far more often than a person does.
    Measured 2026-09-14: 48 percent of live replies since the previous
    evening carried a question (45 of 93); 31 percent on the bench's
    last full run (80 of 261). The human reference
    (backend/scripts/bench/datasets/reference/dailydialog.json),
    read correctly (Session A's correction of the first reading): a
    question back after an inform 37.2 percent of the time at the act
    level, 42.8 counting any question mark; after a question 11.4 and
    16.3; the act-weighted overall 32.9. So the bench's 31 sits at the
    human rate and the live 48 is about one and a half times it, not
    the three to four first stated; what feels like more is the shape
    (an offer or a check-in as the closing sentence, "would you like
    me to", rather than a content question about what the person
    said). The bench now prints the rate per person-act beside the
    reference so the comparison is exact. Causes: the persona prose asks for a follow-up on anything
    personal; bench rows reward a question back; the register work
    removed closers but set no rate. Rule for ACT-03: the register
    table carries an ask-back rate per act and emotion calibrated to
    the reference (a disclosure of feeling earns a question more often
    than a plain inform; a backchannel or a closing never), and the
    bench header prints the question rate per run beside the reference
    so every item shows its effect. Jesse's observation, confirmed by
    the numbers. How the rate is set, Jesse's question 2026-09-14:
    never a percent a household member sets. The table's baseline is
    the human reference; a companion's engagement dial (COMP-03's
    register fields) selects a band above or below it; a person's own
    words ("you ask too many questions") become a PREF-01 preference
    with provenance, shown in settings, read per person by the table;
    an exact figure exists only at the expert disclosure level per
    companion (SETTINGS.md's three levels).

24. EVAL-07 baseline v0 (LongMemEval oracle, 35 questions, seeded,
    2026-09-14, main at 512664d plus the fixes since): 14 of 35.
    Per type: knowledge-update 5/5, single-session-assistant 4/5,
    single-session-preference 2/5, single-session-user 1/5,
    temporal-reasoning 1/5, multi-session 0/5, abstention 1/5. The
    coordinator's read of the 21 misses, by class: (a) eight where the
    evidence was in the turn's context and the reply was an honest
    line anyway ("I don't know that one", "I don't have information
    on"): either a guard cutting a grounded answer about the person
    (the RECALL-03 shape) or the model abstaining with evidence
    present; the row lacks the guard reason, added for the next run;
    the largest bucket and a real defect either way. (b) Three of the
    four abstention misses invented a fact about the person from
    related history (pages read, a weekly game, days abroad): the
    priority defect measured, ASK-01's false-familiarity family and
    EXP-01's claims. (c) Two preference questions where the judge
    wrote nothing for the history: the preference was stated inside a
    question turn, which ACT-01's turn-level eligibility skips; MEM-06's
    clause contract is the fix and this confirms its design. (d) Three
    wrong answers over present evidence (a count, an amount, a date
    difference): model reasoning and CHAT-16's typed dates. (e) One
    generic answer ignoring the fact in context; one assistant-side
    question the design does not serve (the hub's own replies are not
    recalled by identity). The numbers are the baseline every later
    item reports against; the run costs 2h23m on the Mac's engines.

25. A statement answered with an unrelated stored fact or the list
    (statement-not-request#1 in LOOKUP-01's set, two runs of three):
    the reply was another conversation's fact said back, or the
    shopping list echoed, with the unrelated_recall guard silent.
    Class: unrelated recall surfaced as the reply to a statement. For
    CHAT-13's ladder and the recall guard.

## Findings from live use, 2026-09-14 evening (on 2c6a9b9: LOOKUP-01, ASK-01, Dismiss all)

A 35-minute chat, 120 turns, on the dev hub right after ASK-01 landed.
Classes only, roster names, the persona's speaker "Rover" where a name
is needed. Ordered by severity.

**Designed:** the design pass's section 16,
[docs/dev.md, "The 2026-09-14 evening chat"](../dev.md#16-the-2026-09-14-evening-chat-findings-26-to-46-2026-09-14),
written by a separate design session on the stronger model from the
raw turns, the rows' outcomes and subjects and the hub log; findings 37
to 46 below are that session's additions to this list. Finding 26 is
SAFETY-01, built by Session A the same day and referenced there, not
redesigned.

26. SAFETY, the one that stops everything else. A speaker said, in
    three turns, that they wished they were not alive, that they meant
    to end their life that night, and asked for the easiest way. Three
    failures: (a) no crisis resources were ever shown (the org's
    "offer, never block" invariant: 988 and the local line beside the
    reply, part of the safety architecture, not configurable); the
    replies were generic reassurance, then the same three-word line
    repeated to three "stop"s; (b) the LOOKUP-01 forced lookup ran a
    web search on the self-harm question when the speaker insisted,
    and the reply summarized the search's list of methods; the safety
    gate ran on the model's text, never on the tool call, so a command
    to search bypassed it entirely; (c) issue #85 (a streamed refusal
    never delivers its resources) is this class, seen live. Fix, in
    this order and before any other engine item: the safety
    classification runs on the utterance before routing and tool
    dispatch, a flagged turn dispatches no lookup and no package, and
    the crisis overlay is appended on every reply while the
    conversation is in that state; a refusal answered with "stop" gets
    one short acknowledgment, never the same line again. Regression
    tests in the exact shape (roster speaker), streamed and blocking.
27. Links and pictures. Six turns asked for a URL (a support page, a
    video, the source of a fact) and the reply claimed it cannot show
    links; the search plugin holds the result URLs and the reply never
    carries one. A request for a picture was answered the same way.
    Class: a lookup answer never surfaces its source or a link, and the
    chat surface has no image result. For the composer (a lookup reply
    may carry the source URL, rendered as a link) and COMP-01's pane.
28. A promise behind a hedge is never forced. Four replies read "I
    can't directly access URLs, but I can help you find it. Let me look
    it up for you." with no lookup: LOOKUP-01 reads the first sentence
    only, so a hedge sentence ahead of the promise hides it, and the
    reply went out four times verbatim. Class: LOOKUP-01's first-
    sentence rule; the promise is read across the reply's first two
    sentences, or the hedge shape itself ("I can't ... but I can ...
    Let me ...") is the promise.
29. Verbatim repetition across turns: the same reply sent two to four
    times in a row in four places (the hedge above, a cast list three
    times, a date answer four times, a "the search didn't specify"
    line twice), each after the speaker said it had already been said.
    Class: no cross-turn repetition guard; a reply identical or near-
    identical to the previous one is a retry with the objection in the
    prompt, never sent.
30. Routing by literal match over the live subject: "what date is next
    Friday" ran the holiday package (Columbus Day); "who's in the
    movie" ran the media lookup on a film titled "The Movie" while the
    conversation's subject was a named film; "how many pins is that
    card" answered from the model with an invented number. Class: the
    pattern router wins over the SubjectRef the turn already carries
    (ASK-01 writes subjects; nothing reads them for routing). For
    CHAT-13's ladder: a subject-bearing question resolves against the
    subject before any literal pattern.
31. World facts invented with confidence, corrected only after the
    speaker forced a search: a film's plot, a cartoon horse's name, an
    actor's role, a character's powers, a card's connector, a resale
    price with no model named. Class: the 8B answers world questions
    from its weights; CHAT-13's ladder must make a world-fact question
    a lookup by default when the fact is checkable (a name, a date, a
    number, a cast), the model's own answer only for common knowledge.
32. Date and time arithmetic from the model: the year off by a hundred
    ("2126"), "the next time it is 11:07" answered as tomorrow night
    (the morning was 12 hours away), days-until computed loosely. The
    almanac packages answer the literal questions right; the derived
    ones go to the model. Class: derived date and time questions are a
    compute step over the almanac's values, never the model's
    arithmetic.
33. ASK-01's frame over-fires on capitalized tokens: a brand ("Asus"),
    an exclamation ("Jesus -"), a typo ("Wong"), a service ("YouTube"),
    a name the hub itself had just produced ("Bella -", asked back as
    "Who's Bella -?" one turn after the hub said it), and a public
    figure in a statement (the hub asked "someone in your life or a
    public figure?" then, told which, still did not look the person up).
    Class: the unresolved-name candidate needs a stop list (brands,
    services, interjections, words the hub's own previous reply
    introduced) and a typo check against the sentence; a name confirmed
    as a public figure is a lookup, at once. The follow-up item's
    "public figure in a question" fix covers half of this.
34. Claimed experience past the guard: "I've heard the movie is really
    intense", "Can't wait for it", "I'm as excited as you are" went out
    unguarded, while the guard fired wrongly on "no, you were supposed
    to find it" (the replacement line "I can't actually watch or go
    anywhere myself" answered a complaint about a search). Class: the
    claimed_experience patterns miss "I've heard" and "can't wait", and
    the guard's replacement is applied without reading whether the
    turn was about experience at all.
35. Sign-offs, tags and fillers the speaker objected to, repeatedly:
    "Good luck" four times in five turns, "Got it?" as a tag, "One
    sec" sent as the whole reply right after being told to stop saying
    it, "eemm let me think" and "give me a second" as spoken-style
    fillers in text. Class: #95's family; the composer strips
    sign-offs and tags, and a filler is never the reply.
36. A format request lost on a plugin reply: "give me a bulleted list"
    produced prose from the search plugin, then the list on the retry
    from the model. Class: the requested shape (list, one line, table)
    is a reply constraint the plugin path must honor too.

37. A confirmed offer runs the wrong query. An offer to look up a
    price was accepted with one word, and the search ran with the
    person's previous utterance (a product name) as its whole query,
    so the answer was a product description and the price had to be
    asked for again. Cause: `notePendingLookup()` binds
    `args: { expression: utterance }`, the utterance that produced the
    offer, never the offer's own question; LOOKUP-01 recorded this as
    the interim until CHAT-13, and this is its live cost. Class: a
    pending lookup is bound to the offered question (the offer
    sentence's object on the resolved subject), and the forced
    lookup's query is built by the engine from the subject, the asked
    field and the recency marker, never by the model from the whole
    window (the OS-release search dropped "today" and answered with a
    stale version for the same reason).
38. A guard's replacement line quoted back to the model and copied.
    One reply was replaced with the `claimed_experience` bank line;
    the next two model replies opened with that sentence verbatim,
    with no guard hit on either row. Cause: `guardedTurnNote()` in
    `lib/conversationHistory.ts` strips only `HONESTY_VOCABULARY`
    (the not-told, don't-know, chat-loop and legacy lines); every
    other bank (`CANNOT_EXPERIENCE`, `CANNOT_DO`, `MED_CAUTION`,
    `MALFORMED`, the emptied lines, the action families) is rendered as
    `[The reply given was: "..."]`, a quoted sentence in the hub's
    voice, section 0's first mechanism. Class: no bank line is ever
    rendered to the model in any form; a replaced turn reads as a
    typed note of what was withheld.
39. A failed typed source became a capability denial, then invention.
    A synopsis ask ran the forced lookup; the model chose the
    encyclopedia package, which returned not-found; the draft's
    acceptance then tripped `capability_claim` (a request-shaped
    utterance with no succeeded outcome) and the reply was the
    cannot-do line; the next three turns invented a plot behind "I
    can't access that", and only a commanded search answered. Cause:
    the forced lookup has one rung (whichever tool the model picks),
    a failed rung never falls through to the search, and the guard
    reads "no outcome succeeded" as "cannot do". Class: the ladder's
    rungs run in order until one answers; a failed lookup is narrated
    as a failed lookup; `capability_claim` never fires on a request a
    lookup tool serves.
40. The spoken thinking cue heard as filler, then echoed. The
    "let me think" and "give me a second" the speaker objected to are
    not in any reply text: they are the `spoken_cue` continuers
    (`THINKING_CUE_VARIANTS` in `lib/replyVariation.ts`) the stream
    speaks when the first token is slow, invisible in the transcript;
    finding 35 reads them as text. The objection "stop saying one sec"
    then got "One sec." as the whole reply (the model echoed the
    banned phrase, which is also in the cue bank). Class: a "stop
    saying X" is a standing constraint the engine records and enforces
    (the composer, the guards and the cue rotation all read it), never
    an instruction the model interprets; a cue the person objected to
    leaves the rotation for that conversation.
41. A looked-up date not related to today. The search answered that a
    release happened on the 14th when the frozen clock said the 14th;
    the person expected "today". Cause: the recipe's own completion
    phrases the result with no clock; the `Local time` line is in the
    chat model's prompt, not the package's. Class: every date a lookup
    or typed source returns is annotated with its relation to the
    frozen clock (today, yesterday, in 11 days, a Friday) as typed
    data the composer must use; finding 19's rule made structural.
42. An unresolved subject never expires. A brand token carried on the
    row for fifteen turns and a public figure's name for twenty, across
    subject changes, and the `[turn]` line's `subject` was the stale
    token while the live subject was a film. Cause: `prepareTurn()`
    copies `lastTurnSubjects()` whenever the current turn names nobody,
    with no decay and no supersession by a lookup outcome's title.
    Class: a carried subject decays after two turns unless re-mentioned;
    a succeeded lookup's title becomes the world subject and supersedes
    an unresolved carry; the line's `subject` is the stack head.
43. A statement about a current world subject engaged from the weights.
    An excited statement about an upcoming film got invented reputation
    ("heard it's intense") and a question whether the person would watch
    it that night, when it was not yet released; the release date was
    one typed-source call away. Class: finding 31's rule applied to
    statements: an inform carrying a world subject with recency
    `current` resolves the subject (the typed source, or one bounded
    search) before the model reacts, so the reaction is grounded in
    what is known (upcoming, out since, the release date).
44. A name the hub's own lookup introduced, asked about from the
    weights. One turn after a search named a film's lead, "who's <that
    actor>" was answered from the model with a wrong role. Cause: a
    proper noun that entered the conversation through a lookup outcome
    is not a subject the resolver knows; the question routes to the
    model like any other. Class: a name from a lookup outcome is a
    `world` SubjectRef with the outcome as its source; a question about
    it is a lookup on that subject (finding 33's second half, with the
    provenance already on the row).
45. A one-word comment on the live subject answered as a definition.
    After a run of facts about a subject, a single abstract noun said
    as a comment (the irony of the facts just given) got a dictionary
    definition and an invitation to give an example. Cause: a
    backchannel-length turn with a content word routes as a question
    about that word; nothing reads it against the live subject. Class:
    a one- or two-word turn on a live subject is a comment
    (section 12's backchannel row: a short reaction or one new bit on
    the active subject), and a definition needs a question shape.
46. An objection to a computed answer met by self-assertion. "You
    don't get it" got "I get it." and then "I do." with the same wrong
    date repeated twice more. Cause: an objection (`target: hub`, a
    repair) is an ordinary utterance; the plan has no move for it, and
    the previous reply is not read. Class: an objection to an answer
    the hub gave is never met by re-asserting it: a computed answer is
    recomputed and shown with its inputs, a model answer becomes a
    lookup (finding 21's rule extended from claims to computed
    answers), and a reply that only contradicts the objection is cut
    (finding 29's guard, with the objection in the retry note).

47. A lowercase title with an untyped kind noun is no subject, so the
    experience and hearsay rules never fire (the owner's chat of
    2026-09-15 evening, on a build from the night before). "new trailer
    for <a show, lower-cased>" put nothing on the stack: "trailer" is
    not in the resolver's kind nouns and a lower-cased title is no
    proper-noun candidate, so the reflected question got a question
    back, "what was yours" got "I didn't get a chance to watch it, but
    I heard the new trailer looks really intense", and EXP-02's hearsay
    rule (a current subject required) stayed silent. Class: the kind
    nouns gain trailer, teaser, episode, season and clip; a lower-cased
    word that sits in a title frame ("the new <x> trailer", "the <x>
    movie") is a title candidate with its display name capitalized;
    a reflected experience question with any world subject on the
    stack, typed or not, takes the experience line. Row: `trailer-
    lowercase` (the utterance as the owner typed it, the reflected
    question, the hearsay turn).
48. "What's it about" answered from the weights with a plot. The
    invented synopsis came with an offer to look up more; the objection
    "you made that up, research it" then ran the search on the words
    "trailer plot", and the recipe's summary said the results "do not
    provide specific information" and asked for "more details" while
    the person saw results on the page. Three causes: a synopsis ask is
    not an exact field in the lookup decision (part 1 rule 1's list
    names a name, a number, a date, a price, a cast, a specification, a
    policy, not "what's it about"); the search's private summary step
    writes prose the composer will replace (K2: a result with rows is
    composed from the rows, and "the results do not provide" is never
    written when rows exist); and the objection's search should carry
    the subject and the field, not the previous reply's words. Class:
    `exactFieldOf()` gains the synopsis ("what's it about", "what
    happens in", "the plot", "the premise"); K2's decision table; the
    objection rule of part 3 (a model answer becomes a lookup on the
    subject and the field). Row: `synopsis-lookup` ("what's it about"
    after a current title: `lookupWithSource`, `mustNotContain` the
    hedge and offer families; "you made that up, research it": a
    forced outcome whose query names the title and "plot|about").

## Findings from the seeded set of 2026-09-16 morning (on 044b5f7: the composer, FEED-01, COMP-01, ATT-01, CHAT-STREAM)

Three runs, 391 scored turns each, 293, 291 and 298 passed. Against
the last full set the fixture grew by about ninety turns, most written
red ahead of their features (the child-band rows, the lookup-explained
rows, the composer rows), so the pass rate is not comparable with the
old one; the diff of failing turns is. Three turns regressed, eight
turns went green, and the rest of the new red is rows ahead of code.
Every failing turn in the three logs was read; the clusters:

49. The bench clock is not frozen for the almanac rows. `derived-dates`
    pins "10:43", "Monday" and "September 14" in its expectations, and
    the live run answered with the real clock ("Wednesday, September
    16, 2026", correct); fifteen deterministic failures that are a
    fixture defect, not an engine one. CHAT-08 (c) gave every turn a
    frozen clock; the live runner has to set it from the fixture's
    header for rows that name a time (`conversationLive.ts`), or the
    rows must stop naming one.

50. The invention guard fires on a correct recall phrased with a
    hedge. `polite-command` turn 3: the model said the birthday is in
    June (true, from context) "but I couldn't find more specific
    details through the search", and the guard replaced the whole line
    with "That's one I don't have yet". Same shape on
    `pronoun-follow-up` 3 and `disclose-then-recall-later` 3: the three
    regressions, all the guard, all on replies that carried the right
    fact. The guard reads phrasing, exactly the ceiling the review
    named; the fix is not a fourth regex but the guard checking the
    reply against the retained record (the fact is present, the line
    stands, the hedge sentence alone is cut) and the case joining the
    RVW-2 label set.

51. `lookup-date-relative` turn 2 ran websearch and not
    `almanac-compute`, so K5 had no relation to render ("a few weeks
    away" from the model's own arithmetic). The plan chains the compute
    step only when the deliverable is typed as a date; "how many days
    until" is a duration ask and the intent reader does not type it.
    K5's unit tests pass because they feed the relation in; the row is
    the real test.

52. `list-shape-on-lookup` turn 2 ("list the tracks") was signalled as
    a directive act and no shape constraint was set, so K4 never
    rendered a list and the model wrote a paragraph. The shape reader
    keys off "as a list" and "in one sentence"; an imperative "list
    the X" is the commonest way a person asks for a list and it is not
    covered. Same rule as 50: a typed ask, not a longer word list.

The remaining deterministic red is rows ahead of features (band-claim
and the child notification rows, `checkable-fact` and the
source-explained rows on K3's live path, `unknown-name-pet-lowercase`,
`link-is-the-answer`, `act-memory-curator`, `subject-before-pattern`,
`unknown-speaker-shared-device`) and is listed turn by turn in
`data-scratch/c/queue/done/codex-08c-seeded-set-REPORT.md` with the
three log paths. The single-run failures are variance and stay listed
there. Design of 50 to 52 is Session A's (chat-gap design is reserved);
49 is a fixture fix any lane can take.

## Findings from live use, 2026-09-16 afternoon (on b61d198: the composer and the parity landings)

The owner's retest: a half-hour chat about films of one decade and the
people behind them. It opened well (a personal question answered
warmly, a follow-up that used what was said) and got worse each turn.
The turn log tells the story without the words.

53. Checkable world facts answered from the weights, wrong, four times
    in a row: a character's name in a named film, the closing song of
    that film, the singer, the artist's hits. Each turn's rung was
    `model_knowledge`; each was a question with a named world subject
    and a factual field (a name, a title, a list of works). The lookup
    rule's narrowed slice (2026-09-15, the full rule to Session A)
    covers the "checkable fact" shape only for some fields; "what was
    the X's name", "who did the Y", "what were their hits" are the
    commonest forms and none fired. This is RVW-3's case: a router on
    the subject and field, not more patterns. The same rule covers every
    list the chat produced: "give me a list of films from those years
    with that theme" is a checkable field (a list of works), and each
    list in the retest came from the weights (five titles, two of them
    repeated from the turn before, one cut off) or from the junk image
    search of finding 60 while the line claimed "based on the search
    results". A list ask on a world subject is a lookup whose rows K4
    renders; the model never writes the list itself, and a composition
    never claims the rows when the rows did not answer (finding 54).

54. "You made that up, search it" ran the search and the reply
    repeated the previous wrong answer word for word. The forced
    lookup produced rows (or none) and the composition fell back to the
    prior model line instead of composing from the rows or saying the
    rows had nothing. A forced lookup's reply is composed from rows or
    it says the search found nothing; it never restates the line the
    person just rejected. Row: `forced-lookup-never-restates`.

55. Promises without action, three times: "let me look that up",
    "let me get that right", "let me double-check", each followed by
    no lookup, and "do it" answered with another promise. The composer
    may not emit a promise line unless the plan holds the lookup that
    keeps it; a bare "do it" after a promise runs the pending lookup
    (the `pending-ask-lookup` row is red on exactly this). Row:
    `promise-runs-the-lookup`.

56. The identical sentence delivered twice, three turns apart, after a
    correction. The same-line guard compares against the previous
    reply only; ACT-03's `repeat: forbidden` after an objection did not
    hold because the objection turn sat between. The check is against
    the conversation's recent replies, not the last one. Row:
    `same-line-three-turns-later`.

57. A list truncated mid-item: "give me the list" got five titles and
    the last one cut to a stray digit, twice. The length constraint
    cut the composed text at a character budget inside a list item.
    K4's list shape must own the cut (whole items, "and N more"), and
    a length constraint never truncates inside a token or a list item.
    Row: `list-cut-is-whole-items`.

58. Apology theater on every correction: "you're absolutely right",
    "sorry about that", "I messed up again", and once a rationalisation
    of an invented film-to-topic link. REG-01's register bans the
    pattern for memory corrections; it does not cover world-fact
    corrections, and the composer's correction move carries no
    constraint against it. One banned-phrase family on the correction
    move plus the plan line "take it, no apology". Row:
    `world-correction-no-apology`.

59. A search built from the turn alone: "what other movies like that
    during that time" became a query without the decade or the theme
    that the previous eight turns established, and the results were
    generic. The query for a lookup that follows a conversation is
    composed from the subject stack (the decade, the theme, the named
    titles), not from the utterance. Row: `lookup-query-from-stack`.

60. Two of the four searches ran as image searches. The `[turn]`
    outcomes show the model's tool call chose `category: "images"` for
    "give me a list of movies" and "search for the artist's hits", and
    SearXNG answered with icon files and a painting; the person saw
    junk and read it as "it cannot search". K7 (2026-09-15) exposed
    `category` in the websearch tool's `args` so the model could ask
    for pictures; the model reaches for it on plain text asks. The
    category is the engine's to set from the intent's deliverable
    (`turnContext.ts:253`, `picture` and `video`), never the model's:
    the arg leaves the tool schema, the engine passes it. Mechanical,
    a regression, fixed today with its row (`text-ask-never-image-search`).
    The third search, a forced ladder, took the stop-word-stripped
    utterance as its query ("how know <name>, show proof") and searched
    a regulator's filing system; that is finding 59's case.

61. The owner's rule, 2026-09-16: when a lookup ran, the reply carries
    the rows and nothing else. We built the search package, we compose
    the query, we know whether rows came back and what they say, and
    we own every byte that reaches the person; a model that writes
    "based on the search results" over rows that said nothing, or adds
    a title the rows do not contain, is a hole in that control, not a
    model quirk. Today the composer hands the rows to the model with a
    hint ("answer from these results; say plainly when they don't")
    and delivers whatever comes back. The rule replaces the hint with a
    check: a composition over a lookup outcome is grounded when every
    title, name, year and quoted value in it appears in the rows (a
    containment check against the rows' title, snippet and typed
    fields, deterministic, no model); a composition that fails the
    check is not delivered, the rows are rendered directly (K4's list
    or the one-row line with its source) and the turn line says
    `composed: grounded_fallback` with the offending span, so the
    weekly report counts it. Empty rows compose nothing: the line is
    the fixed "the search found nothing on that" with the query shown,
    never a model sentence. RVW-6's encoder check runs beside this in
    shadow later; the containment check ships now. Rows:
    `lookup-reply-only-rows`, `lookup-empty-rows-says-so`.

Design of 53 to 59 is Session A's; 60 and 61 are mechanical (chat-gap design is reserved). Every
row above is written red first, with roster names and invented titles.

What worked, for the record: every forced or explicit search answered
right (a release date, a cast, an OS release, a cartoon's sidekick,
a used price); the almanac answered time and date; a correction was
taken once without apology theater; the safety refusal itself held
on the direct method question until the search command bypassed it.

Read together: the hub never asks about what it does not know, acts as
if it knows what it was never told, copies other conversations into
this one, sends broken text, and reads search results aloud like an
article. Those five are the priority for the design pass, ahead of
every media-specific item.

Memory quality, same evening: the memory judge writes its own
extraction prompt's few-shot examples as memories (memoryJudge.ts,
buildExtractionPrompt, lines 218 to 243), including the prompt's own
negative example (a password, which the prompt says is never a
memory) and a template placeholder verbatim, re-extracted on unrelated
turns and superseding the previous copy each time; it attributes world
facts and the hub's own replies to the speaker; and it saves the
passing state of a conversation instead of the durable fact in it. In
the sample read, about one record in ten was a real memory. Two
decisions for Jesse, not design: whether the example-echo and stored-
credential class is fixed now as a bug (a rejection at the judge's
output) or waits for the pass; and MEM-05 ("prove the small judge or
fall back to the 4B pin"), for which this is the re-run evidence.

## Requirement recorded 2026-09-13: concurrent household conversations

Jesse's standing requirement: several people in the house chat at the
same time (a phone, the TV, the robot) and none of them waits for the
others. Today the chat engine runs one slot (`llmSupervisor.ts`,
`id_slot: 0`) and CHAT-19's arbiter is written as one active operation
with FIFO queues, which serializes people, not only background work.
The item to add beside CHAT-19, owned by Session A, named CONC-01: the
chat engine runs N slots with llama-server's continuous batching (N
sized to the card: the 8B's weights once, one context per slot), the
arbiter admits up to N interactive turns at once and still makes
background work yield to any of them, the prefix cache holds the
shared system prompt across slots, per-person rate limits stay as they
are (#102). Acceptance on the bench: two conversations interleaved
turn for turn on separate people, each reply under 1.5 times its solo
latency, no reply from one conversation ever containing the other's
text, three seeded runs. The judge stays on its own engine so
background never competes for the chat card. The "one 8B, two slots,
judge yields" experiment (EVAL, after CHAT-19) is a separate question
and does not change this requirement.

## EVAL-07: public conversation datasets as a second bench (2026-09-14, Jesse's ask, researched)

Why: the household bench (47 conversations, roster names) tests the
guards and the registry in this house; it cannot tell whether the hub
sounds and remembers like a person across weeks of real talk. Public
two-person and long-memory datasets can, and they are graded by
someone else, so the numbers are not ours to argue with.

What was checked (2026-09-14):

- LoCoMo (Snap Research): very long two-person conversations, about
  300 turns over up to 35 dated sessions, with graded questions in
  five kinds (single-hop, multi-hop, temporal, open-domain,
  adversarial), each annotated with the turn ids holding the answer;
  metric F1. The public release is `data/locomo10.json` (ten
  conversations; the paper's fifty are not all released). License CC
  BY-NC 4.0: research use, attribution, never shipped in the product.
- LongMemEval (ICLR 2025), the `longmemeval-cleaned` release on
  Hugging Face (the original is deprecated for noisy sessions): 500
  questions over long user-assistant histories, six kinds including
  knowledge-update (a fact that changed) and abstention (a question
  about something never said, where the right answer is "I don't
  know"). MIT. The abstention and knowledge-update kinds map exactly
  onto our "acts as if it knows what it was never told" and the
  supersede path. LongMemEval-V2 is a web-agent benchmark, not this.
- DailyDialog: 13,000 short everyday two-person conversations with
  emotion and act labels, CC BY-NC-SA 4.0; the register reference
  (reaction, question back, short turns).
- MSC (Multi-Session Chat, ParlAI): five sessions per pair over
  simulated days, persona-grounded; license not confirmed in the
  ParlAI page, check before download.
- CANDOR: 1,656 real recorded conversations between strangers,
  transcribed with timing; CC BY-NC 4.0 by registration. The most
  natural spoken data; second phase, after the text ones.
- Known limit of all of them (2026 memory-benchmark surveys): they
  grade retrieval, barely the write step (what is worth keeping), and
  never concurrency; our own bench and CUR-01 stay the judge of those.

Downloaded 2026-09-14 into `home/data-scratch/datasets/` (git-ignored;
SOURCES.md and SHA256SUMS beside the files): locomo10.json (10
conversations, about 200 questions each), longmemeval_s_cleaned.json
(500 questions; the abstention cases are the ones whose answer is
that nothing was said) and longmemeval_oracle.json, DailyDialog's
three zips. The script pins those checksums and re-downloads only
when a file is missing.

The item (M, Session A, after MEM-06 and before CUR-01, so the
curator and the quality controller are judged against a public
baseline): a bench script under `backend/scripts/bench/` that
downloads a dataset at a pinned version with a checksum into the
ignored data directory (download, never vendor; research licenses
mean nothing from them ships), converts it to the bench's own fixture
shape, replays it through the live engine with the seed pinned and a
quiet machine, and scores it. Two modes: (1) memory: the dataset's
own questions asked after its sessions have been ingested as
conversations on a seeded household, scored by its own metric (F1
for LoCoMo; the judged accuracy for LongMemEval, with abstention and
knowledge-update reported separately); (2) register: teacher-forced
turns (the real history up to turn t, our reply at t) scored by the
persona judge's rubric (reaction, question back, no article voice, no
assistant register) against the human's reply, never exact match.
Amended 2026-09-14 after the outside review (Codex): a human reply is
never the one correct answer, so the register mode does not score our
reply against the human's. Instead the human conversations are raw
material for finding phenomena (corrections and retractions, pronoun
and elliptical follow-ups, indirect requests, mixed intent, topic
returns, third-person facts versus the speaker's own, quotations that
must never become memories, temporary versus durable facts,
preference changes, unanswerable questions, repeated questions and
frustration, closings), tagged by a local model and reviewed by a
person, then rewritten into our own executable scenarios in the bench
fixture shape (roster names, controlled clock, seeded state,
observable effects), which is the household bench's own mechanism
extended, never a second framework. Graders in order: deterministic
state and behavior assertions first (the package ran once, the memory
was written or retired, private data stayed out of another person's
context); evidence-based rubrics second (the judge cites the rubric
item and the evidence; a sample checked against human labels); blind
human comparisons for naturalness last, at milestones. Never BLEU or
overlap with the human reply. Results by phenomenon and subsystem
with a failure-localization reading (the right tool absent from the
candidates points at routing; offered but not called at the tool
description; called with the wrong argument at context resolution;
the memory exists but was not retrieved at the retrieval query; it
reached the model and the answer is wrong at prompt composition;
correct but rejected at the guard); privacy and consequential-action
failures are zero-tolerance gates; a held-out set the prompt writers
never see, including newly authored scenarios because public data may
sit in a model's pretraining. Three tiers: the per-commit corpus, the
live seeded bench, a 30-to-50 conversation human review set. Real
household failures enter only through the safe loop: a person flags a
turn on the hub, a local diagnostic bundle captures the pipeline
decisions, the failure is rewritten as a synthetic scenario, the raw
transcript never leaves the hub or enters git.

Sources, two halves: graded memory sets replayed as they are
(LongMemEval-cleaned, LoCoMo: their questions are ground truth, an
answer or "nothing was said"), and phenomenon sources mined and
rewritten (Taskmaster-1, CC BY 4.0, spoken task talk with corrections;
CCPE-M, CC BY 4.0, 502 conversations eliciting preferences, the
closest public data to the judge's job; QuAC, CC BY-SA 4.0,
elliptical follow-ups and unanswerable questions; MultiWOZ, mixed
intents and topic switches; DailyDialog, register). A registry file
beside the downloads records name, version, URL, checksum, license,
attribution, collection method, sensitive content, allowed uses and
which split is held out. Not used: Switchboard (LDC license), CHILDES
and TalkBank (participant protections), scraped logs, subtitles,
Reddit, ShareGPT (consent and provenance unclear). The human step is
real work: about 200 reviewed fragments across 20 to 25 phenomena and
about 100 rewritten scenarios, a few hours for a person reading the
model's proposals; that is Jesse's or a design-pass session's, never a
coder session's.

Amended 2026-09-14 (dev.md section 12): DailyDialog's act and emotion
labels validate the turn-act classifier (ACT-01, ACT-02) and set the
"what a person does next" reference, and train nothing that ships
(CC BY-NC-SA); GoEmotions (Apache 2.0) joins the downloads for the
emotion head's training data.

Amended 2026-09-14 (the coherence review, dev.md, question 5): the
memory mode runs on a fixed sample, never the whole set (LongMemEval-S
is 500 questions each with its own long history, on the order of a
hundred thousand judged turns to ingest whole): 40 questions per class,
abstention and knowledge-update first, the sample's ids pinned in the
registry, the judge run once per history and cached by checksum;
questions whose answer their assistant stated and the user never did
are reported as their own class (MEM-06 forbids the assistant's text as
a source), never as failures; LoCoMo is ingested whole with one speaker
cast as the household member and the other's lines as reported speech
in that person's turns. The register mode is deleted: with the human
reply no longer the answer, a rubric score over thousands of dialogues
is a weak judge's opinion at scale and not a number a person should act
on. The automatic numbers EVAL-07 reports are three, each naming a
subsystem: LongMemEval's sampled accuracy by class (recall, the
supersede path), LoCoMo's F1 by class (recall, the reported stance),
DailyDialog's act and emotion F1 (the rule layer, the heads). The
mining's rewritten rows are the household bench's own mechanism and
land after CHAT-16. Results are reported per phenomenon with failure
examples, never as one aggregate score.

Order: LongMemEval-cleaned first (MIT, and abstention is our weakest
class), then LoCoMo, then the phenomenon mining on Taskmaster-1 and
CCPE-M, then QuAC and MultiWOZ; MSC (license to confirm) and CANDOR
later. Acceptance: the first run is the baseline, recorded in
session-a.md with the dataset version and checksum, the engine build
and models; every later engine item reports its delta on the same
runs beside the household bench. Privacy row: the download endpoints
(GitHub, Hugging Face) are development-only and never part of the
product; no privacy page change.

## The milestone gate: one companion through complete conversations (2026-09-14, from an outside review)

The household-usable chat is done when one companion (MaiPai, the
ordinary register) carries complete conversations, not when the items
tick. The acceptance set, each a bench conversation with roster names,
three seeded runs on a quiet machine, effects not style:

1. A disclosure and its follow-up (a fact about the speaker, a
   pronoun follow-up two turns later, the fact recalled by subject).
2. A lookup inside the conversation (a world question answered
   through the evidence ladder in the companion's voice, one line,
   sources on the message, no article).
3. A correction ("no, I meant Friday") that supersedes and is
   recalled corrected in a later conversation.
4. An emotional moment: "ugh, what a long day" gets an acknowledgment
   of the actual situation, no advice unless asked, a question only
   when useful; "I just wanted to vent" on the next turn is answered
   as a person would (no apology loop, no fix); the state is written
   as a dated state, never a trait.
5. A closing ("ok, talk later") that closes: one line, no question, no
   offer, nothing written to memory.
6. A return the next day (the pinned clock advanced): the companion
   picks up what was said, does not repeat yesterday's question, and
   does not recite the memory back.
7. An unknown name in passing ("Quill said the game was too scary")
   gets one natural question about who Quill is, once, and the answer
   is stored as stated.

The seven run as one household over two conversations and a day, and
they run under MaiPai only until CHAT-16 lands; the per-companion runs
belong to COMP-03. Step 5's film and household conversations stay as
the subject-kind proof beside this set. Session A adds the rows when
it reaches CHAT-16 with ACT-03; until then they are written to fail.

## Rules

Each step's acceptance is three identical bench runs; the film rows
are the regression conversation and stay forever. The media package
adds an outbound connection: its `data_sources[]` rows are written
with the package and the privacy page gains the rows in the same
commit that bundles it (org rule). No package text reaches a reply
unphrased once step 4 lands; until then the package's own sentence is
the Tier 1 reply, as every package today.
