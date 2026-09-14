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

CHAT-12 (budgets) is a technical prerequisite CHAT-16 names; take it
inside step 4 if the composer needs it, not before. The judge's
subject-resolution item (baseline-fixes 3) follows this program; #98
and #99 are small items between steps.

## Findings from live use, 2026-09-13 evening (design pending)

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

Read together: the hub never asks about what it does not know, acts as
if it knows what it was never told, copies other conversations into
this one, and sends broken text. Those four are the priority for the
design pass, ahead of every media-specific item.

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

## Rules

Each step's acceptance is three identical bench runs; the film rows
are the regression conversation and stay forever. The media package
adds an outbound connection: its `data_sources[]` rows are written
with the package and the privacy page gains the rows in the same
commit that bundles it (org rule). No package text reaches a reply
unphrased once step 4 lands; until then the package's own sentence is
the Tier 1 reply, as every package today.
