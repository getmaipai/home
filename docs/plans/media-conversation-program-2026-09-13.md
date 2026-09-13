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
   8B declines.** Prompting harder cannot make that reliable. Exact
   public facts need a typed source when one exists (media, weather,
   the knowledge package's Wikipedia summary for anything else),
   routed to deterministically on a resolved subject of a matching
   kind, retained as turn evidence (not memory), and phrased through
   one composer in the companion's voice. The routing rule is by
   subject kind, never by a topic word. That is the planned media package (BACKLOG,
   Skills: "Music / media search"), CHAT-15 (typed outcomes retained),
   and CHAT-16 (one composed path).

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
| 3 | CHAT-13 with the subject half of CHAT-10: the active subject on the turn context (an entity with a kind, a name, a year when known), resolved from the current text or the last two same-thread user messages; pronoun and "that one" follow-ups resolve to it; a factual media follow-up on a resolved media subject routes to the media package deterministically | A | 2, and B's package for the live rows |
| 4 | CHAT-16: one composer for every factual result, phrased through the selected companion with the active subject and recent turns as context; no package text spoken as-is | A | 2, 3 |
| 5 | The film conversation and four more of the same shape on other subject kinds (a band, a city, a historical event, a video game: an opening statement, "have you heard of it", two factual follow-ups with pronouns, one opinion question) plus three household-subject conversations of the same shape (the family dog, a family member, a thing in the house: an opening statement that carries a fact, a friend-like reaction, a pronoun follow-up answered from what was just said, a follow-up two turns later that must not confuse the household subject with a world one of the same name) pass three identical runs end to end, with the four categories each shown by a row; the general subjects go through the knowledge package or model knowledge, proving the mechanism is not media-specific | A | 0 to 4 |

CHAT-12 (budgets) is a technical prerequisite CHAT-16 names; take it
inside step 4 if the composer needs it, not before. The judge's
subject-resolution item (baseline-fixes 3) follows this program; #98
and #99 are small items between steps.

## Rules

Each step's acceptance is three identical bench runs; the film rows
are the regression conversation and stay forever. The media package
adds an outbound connection: its `data_sources[]` rows are written
with the package and the privacy page gains the rows in the same
commit that bundles it (org rule). No package text reaches a reply
unphrased once step 4 lands; until then the package's own sentence is
the Tier 1 reply, as every package today.
