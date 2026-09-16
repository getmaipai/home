# Chat architecture review: is the deterministic pipeline the right shape? (2026-09-16)

An evidence-backed review of the hub's chat architecture, written by a
design session on the stronger model at the owner's request. It answers
one question: the pipeline that decides what a turn is, what it is
about, whether to look something up, what the reply may do, what gets
cut, and what gets remembered is mostly deterministic (regular
expressions, word banks, if-then rules), and the owner's worry is that
this is non-intelligent, brittle and hard to maintain, that every live
chat adds another list, and that a model's judgment should make those
decisions, keep the tone consistent and bring memories into a reply
naturally. The review takes that worry seriously, says where it is
right, and says what replaces each rule that should go.

Read for it: `docs/dev.md` sections 12 (the act and the emotion of a
turn, the reply plan), 13 (the child band), 16 (the 2026-09-14 evening
findings, the twelve items, the composer chunking), the "One ephemeral
turn context" and "Structured execution and bounded composition"
decisions, and `docs/plans/media-conversation-program-2026-09-13.md`
(findings 25 to 48); then the code on `main` at 6270644
(`turnSignal.ts`, `unknownNames.ts`, `subjects.ts`, `routing.ts`,
`routeLiteral()` and `routeSemantic()` in `turnEngine.ts`,
`turnContext.ts`, `guards.ts`, `memoryJudge.ts`, `register.ts`,
`persona.ts`, `personaJudge.ts`; the composer's K2 has not landed); then
the constraints (an 8B chat model on one consumer GPU with a 16 GB
card arriving, nothing leaving the house, first token under a second,
a 4B memory judge in the background, and org principle 6, "prebuilt
over hand-built", including its sentence on activation steering versus
a paragraph of personality prose). The literature was searched fresh
for this review (2024 to 2026 work as well as the classic references);
every citation in the reference list was fetched and read, and the few
claims that could not be confirmed against a source are marked
`[unverified]` where they appear. No household turn is quoted; every
example uses the persona roster.

**The verdict in three sentences.** The shape is right: every shipped
assistant and agent framework that has to be fast and predictable puts
the decisions in code and lets the model write, and the published
numbers say an 8B model is measurably bad at exactly the decisions the
owner would hand it (staying quiet when no tool fits, reading emotion,
asking instead of answering, judging its own output, holding a persona
past turn eight). The owner is right about the word lists in a specific
way: the rules are the correct precision-first floor, and the wrong
tool for the open-class judgments the pipeline has been asking of them
(the emotion lexicon, the inform-versus-commissive residual, stance,
the checkable-fact and hedge shapes, the lookup field classes), where
a small trained classifier on human-labeled household data beats both a
rule and an 8B prompt at microseconds to milliseconds per turn. The
corrections are therefore not "replace rules with the model" but
"replace the open-class rules with trained heads fed by the labels the
hub already produces, keep the invariants deterministic, shrink the
persona prose toward a measured vector or adapter, and give the memory
a bigger, typed slice of the prompt", in the order section 5 gives.

## 0. The owner's concern, answered directly

**"It is non-intelligent."** The pipeline is a policy, and the question
is who makes each decision, not whether a model is involved. The
platform's own shape (the engine decides, the model writes the words)
is the one every current framework converges on: LangGraph fixes the
state graph in code and lets the model choose among allowed edges [61];
Google's ADK runs its workflow agents "without consulting an AI model"
for orchestration [62]; OpenAI's agents guide says a deterministic
solution "may suffice" unless the rules are hard to maintain, and lists
regex filters beside learned classifiers as a layered defense [59];
Anthropic's guidance separates workflows on predefined code paths from
agents and says to increase complexity only when needed [60]; Home
Assistant runs its template matcher first and sends only the residue to
a model, because a model is "slow and/or expensive" [26]. None of these
is a hand-built exception; they are the field's answer to the same
constraints we have.

**"A model's judgment should make the decisions."** The measured 8B
numbers say no, for the specific decisions in question:

- Whether to call a tool: Llama-3.1-8B detects "no tool fits" 42.7
  percent of the time and Qwen3-8B 79.1 percent on the Berkeley
  function-calling leaderboard [21]; When2Call measures a 67 percent
  tool-hallucination rate for Llama 3.1 8B [22]. Every 8B calls when it
  should (87 to 94 percent); the failure is calling when it should not,
  which for a household where most turns are talk means false timers.
- What emotion a turn expresses: zero-shot Llama2-7b scores 9.7 macro F1
  on DailyDialog's seven emotions (chance is near that), Llama-3-8B 19.7
  against a supervised 65.9 on EmoWOZ, and the small models over-predict
  neutral [2, 4].
- Whether to ask instead of answer: models "overwhelmingly default to
  direct answers" even when they can recognize the ambiguity when asked,
  and retrieved context makes them ask less [40]. ASK-01 exists because
  the live hub did exactly this.
- Whether its own reply is right: 7B to 8B judges score below chance on
  JudgeBench (Llama-3.1-8B 40.9 percent, Prometheus2-7B 34.9) [47], and
  self-preference is causal and worst where the generator erred [48,
  49].
- Whether it is still in character: instruction stability drops 10 to 15
  points within eight rounds on 70B-class models, with emotional
  disclosure as the accelerant [51, 53]; no 8B curve is published, and
  nothing suggests it is flatter.

An 8B prompt is the most expensive and least accurate classifier
available on this hardware: 100 to 700 ms of serialized GPU time per
decision, against microseconds for a head and 12 to 20 ms for a small
encoder, at 20 to 40 macro-F1 points worse on emotion [1, 6].

**"It is brittle and every live chat adds another word list."** This is
right, and the repo's own history shows it: section 16 added about ten
new regex families in one evening (the hedge shape, the false capability
denial, the wish family, the tag questions, the objection shapes, the
imperative consent forms, the experience forms). `guards.ts` holds 87
regular expression literals in 2,358 lines; the signal, resolver,
context and engine files hold about 125 more. The measured character of
such rules is high precision and low recall: on a five-way intent task
a learned rule system reached 97.6 precision at 61.0 recall, against
95.0 for a logistic head on sentence embeddings and 98.0 for an LLM
[9]. That is the right property for a floor and the wrong one for the
whole decision. Two things in the current design make the growth worse
than it needs to be: nothing reports which rules fire and which never
do, so lists only grow; and several families are open-class (how a
person hedges, jokes, reports someone else's words, expresses fear),
where every new phrasing is a new regex forever. Section 3 sorts every
list into "stays, because it is a closed set or an invariant" and
"becomes a classifier, because it is open-class".

**"The model should keep the tone consistent and integrate memories
naturally."** On tone, the model cannot be the keeper of its own
consistency (drift is documented at every size) and the prose paragraph
is the weakest measured lever on small models: personality prompting is
less reliable on smaller models [55, 56], few-shot exemplars "do
basically nothing" for sycophancy control on a 7B while activation
addition works [57], and the hub's own steering spike found a
72-character prompt plus a control vector held register better than the
707-character paragraph at 26 percent fewer tokens. On memory, the
measured "friend who remembers" effect comes from a system bringing up
the other person's past (engaging on 62.1 percent of turns against 53.0,
referencing earlier topics 33.8 percent against 14.5) [76], and the
strong systems inject about 1,300 to 1,600 tokens of typed memory per
turn [70, 79], where the hub's context carries about 200. Section 4
takes both up.

## 1. The architecture as built

Nine layers, in the order a turn meets them. Each paragraph ends with
what is deterministic in the layer and what a model decides. File
names are the hub's (`backend/src/lib/`); the robot pins the same spec
shapes and mirrors the pure modules.

**The signal** (`turnSignal.ts`, ACT-01). Before routing, the engine
reads the utterance once into a frozen `TurnSignal`: a primary act
(inform, question, directive, commissive, greeting, closing,
backchannel), the other clauses' acts, an expressed emotion from the
DailyDialog seven with an intensity band, a target (self, other, hub,
world), a repair flag, and one entry per clause with its stance
(asserted, reported, quoted, hypothetical, joke, unknown) and subject.
Production is a fixed precedence: an answer the pending-ask state
machine consumed is that answer; then rules (a question mark or
question opener, a declared command opener or an everyday imperative,
an exact greeting or closing, a one-to-three-word backchannel, a
commissive opener, unmistakable stance markers, an emotion lexicon of
about a dozen cue lists with intensifier, shouting, expletive and
diminisher adjustments); then a conservative fallback (inform, neutral,
every clause unknown). The heads over the utterance embedding that
section 12 planned (ACT-02) were trained and did not ship: on
DailyDialog's test split the act head lost 4.4 macro-F1 points against
the rules alone and the emotion head lost 10.1 on neutral-versus-not,
because the 4B-labeled act corpus and GoEmotions' written-comment
domain did not transfer to spoken household turns. Measured today: act
macro F1 66.1 percent on DailyDialog and 96.3 percent on the fixture's
218 human-labeled turns; emotion neutral-versus-not F1 89.2 percent
(precision 83.3, recall 96.0). The file holds about 30 regular
expressions and four word sets. *Deterministic: everything on the
interactive path. A model decides: nothing; the 4B labels training
data offline.*

**Subjects** (`unknownNames.ts`, `subjects.ts`, ASK-01, ASK-02, CHAT-13).
The resolver builds the turn's `SubjectRef` stack before routing: the
`compromise` part-of-speech tagger marks proper-noun candidates, a stop
set and the tagger's own expression and predicate tags remove
interjections, brands ahead of a product noun, typos and words the last
three turns used as common words; relation frames from the spec's
relationship vocabulary ("my coworker Quill") and world-kind frames
("the new Marsh Lantern film", a lower-cased title before its kind
noun) set a candidate's kind and recency; the roster and the entity
registry resolve known names to household entities; anything left is
`unresolved` at a confidence that decides whether the engine appends a
who-question. A carried subject decays after two turns; a succeeded
lookup's title supersedes an unresolved carry; a name the hub's own
reply or outcome introduced is world with provenance and never asked
back. The who-answer parser reads the person's reply into a household
kind, a relation or a world kind, and only that answer, or an adult's
confirmation, promotes a candidate entity the judge inferred. About 37
regular expressions and three word sets. *Deterministic: candidate
extraction, framing, the stack, the carry, the ask decision, the answer
parse. A model decides: the 4B proposes an entity kind or relation as
a candidate; the 8B may phrase its own question about a name.*

**Routing** (`routing.ts`, `routeLiteral()` and `routeSemantic()` in
`turnEngine.ts`, ALM-01). Three tiers. Tier 0 is a literal pattern a
package declares, with wildcard capture, a courtesy and connective
prefix, and yields (a household name, arithmetic, an unresolved
reference that resolves to the live subject instead). ALM-01's
derived date and time grammar runs as a compute before routing. Tier 1
embeds the utterance once with nomic-embed-text v1.5 on a literal miss
and takes the maximum cosine against each package's stored example
embeddings; a winner needs 0.75 and an 0.08 margin over the runner-up,
must not be consequential, must declare it answers the entity kinds the
utterance captured (`routing.answers`), and must bind its arguments
deterministically. The routing corpus scores 107 of 107 with a null-row
noise floor at p95 0.602. Tier 2 offers native tool calls to the same
completion that answers: the top three ranked packages plus every
`always_offer` package (websearch) on a command-shaped turn, the
always-offer set alone otherwise, under `tool_choice: auto`.
*Deterministic: tiers 0 and 1, the offered set, argument validation,
the two-call cap, consequential confirmation. A model decides: whether
to call an offered tool at tier 2 and with what arguments.*

**The lookup ladder and the decision before generation**
(`lookupDecision()` and `exactFieldOf()` in `turnContext.ts`, LOOKUP-01,
LOOKUP-02, `runForcedLookup()`). Section 16 moved the world-fact decision
off the model: a question whose asked field is exact (nine regex field
classes: name, who, price, count, date, cast, spec, policy, synopsis)
and whose stack head is an undated world subject or a kinded unresolved
one is a `lookup` turn. The engine writes the query from the subject's
display name, the field and any currency marker, runs a completion
under `tool_choice: required` over the lookup family (the typed source,
then websearch), falls through a failed rung, and narrates a failure
as a failed lookup. After generation, four sentence shapes read in the
draft's first two sentences or 160 characters (a promise, an offer, a
hedged checkable value, a false capability denial) invalidate the draft
and run the same forced lookup; a confirmed offer binds the offered
question, never the utterance. *Deterministic: the claim-type decision,
the query, the rung order, the confession shapes, the failed line. A
model decides: which lookup tool under `required`, and the answer to a
stable question ("why is the sky blue") from its weights.*

**Generation with the reply plan** (`register.ts`, `buildPromptParts()`,
ACT-03 (a)). The prompt is a stable prefix (identity, seven policy
sentences, the companion's four dial sentences and three to five
example lines, the information-handling and naturalness policies) and a
context message placed after the history so the prefix cache holds
(first delta p50 385 ms on the bench, about 700 to 840 ms live). The
context carries the household and speaker lines, the subject lines, at
most five memory bullets in 800 characters with a trust reminder,
recalled episodes, a companion re-anchor, the rolling summary and up to
three matching skills, and the local time. `planFor()` turns the
signal, the band, the surface, the evidence counts and the companion's
dials into a typed `ReplyPlan`: each of eight moves required, allowed
or forbidden, playfulness, a sentence and word cap. `planLine()`
renders it as one sentence ahead of the memory section. Sampling is
temperature 0.7 with min-p, XTC and DRY, so variety is the sampler's
job and no prompt sentence asks the model to vary itself.
*Deterministic: the plan, the evidence selection, the prompt bytes, the
sampler. A model decides: every word of the reply.*

**The composer** (CHAT-16, K2 not yet landed; the design in "Structured
execution and bounded composition" and section 16 part 13). One shared
path from retained outcomes to a reply: one succeeded outcome with a
`reply` and no synthesis hint is delivered as it is; a data-only result,
a hinted result, or two outcomes take one final completion (the turn's
second and last model call) with the results as native tool-result
messages, no tools offered, the persona and context as on a model turn;
every failure takes deterministic safe text; a requested shape (a list,
one line, the number) is a parameter rendered from the rows; every date
a source returned is annotated with its relation to the frozen clock by
`almanacCompute`. What has landed of CHAT-16 is the sources on the wire
and the row, the deliverables (link, picture, video), the denied
deliverable and the status events; the websearch recipe's own summary
step still writes prose today. *Deterministic: the decision table, the
call budget, the shape rendering, the date relation, the failure text.
A model decides: the phrasing of a composed answer.*

**The output guards** (`guards.ts`, the safety classifier in
`spec/safety`). Two boundaries on every reply source. The safety
classifier is deterministic and multi-signal (eight categories, each
needing a corroborating second signal; 84 corpus rows), runs on the
utterance before routing and on every streamed sentence after, and its
self-harm path adds crisis resources and never blocks. The guards then
read each sentence against the turn context: about two dozen reasons in
three classes. A skippable sentence is dropped wherever it sits (an
assistant register phrase, a claimed experience or statement, a
repeated sentence, a self-assertion, a banned phrase, a pronoun slip, a
false capability); a cuttable one ends the reply there (an invention
about the household, unrelated recall, a false familiarity); anything
else replaces the reply with a bank line and the engine retries once
with a system note. The grounding pool is the included evidence alone,
so the prompt and the guards read the same facts. About 87 regular
expressions, a dozen replacement banks, and a 111-row guard corpus.
*Deterministic: every check and every replacement. A model decides: the
retry text.*

**The memory judge and curator** (`memoryJudge.ts`, MEM-06, CUR-01). In
the background, the 4B (Qwen3-4B, about 1.8 s per turn) extracts facts
from a queued turn under a JSON schema and a prose rulebook (source,
time, possessive, state and trip, date format). A deterministic
validator then decides what survives: a prompt-example echo, a
placeholder or a credential is dropped; a fact keeps half its content
words and every proper noun and number in the speaker's own words or is
`ungrounded`; a state with a conversational verb is `passing`; a fact
about the turn's world subject is `world` unless it is the speaker's
own preference or plan; each fact cites the eligible clause (inform or
commissive, asserted or reported) it shares the most words with, and a
quoted, hypothetical or joking clause, an ineligible act, or a subject
mismatch rejects it. Dedupe runs a cosine band (0.60 to 0.92) and asks
the 4B for ADD, UPDATE, SUPERSEDE or NOOP; a contradiction check asks
the 4B on a narrower band; the profile paragraph is a 4B rewrite capped
at 600 characters. The curator archives a record past `valid_to` with
provenance, extends an exact re-assertion, and will mark disputes and
raise open questions. Before MEM-06 the coordinator's sample read found
about one record in ten was a real memory; the LongMemEval oracle
baseline is 14 of 35. *Deterministic: eligibility, grounding, the
subject rules, the importance bands, the lifetimes, the read boundary.
A model decides: which facts to propose and how to word them, dedupe
and supersede, contradiction, the profile paragraph.*

**Persona and tone** (`persona.ts`, `personaJudge.ts`, section 12's
plan line, EVAL-03). A companion is a catalog package whose manifest
sets four dials (formality, complexity, engagement, filler density)
and three to five example lines; `composePersonaPrompt()` renders each
dial as one canned sentence and the examples as a few-shot block in
the stable prefix, and a re-anchor line repeats the name in the
context. The plan now owns the register decisions the engagement dial
used to make in prose. The persona judge is the 8B grading batched
exchanges under a JSON schema for "sounds like this character", run by
the bench only; REVIEW-01's nightly pass is designed and unbuilt. The
2026-09-05 steering spike trained a control vector on fifteen generic
casual-versus-formal pairs: a 72-character system prompt held casual
register on 23 of 30 turns against the 707-character paragraph's 19 of
30 at 26 percent fewer prompt tokens, but lost the companion's specific
markers; the recorded next step is a vector trained on the companion's
own example lines. *Deterministic: the dial prose, the examples, the
plan. A model decides: the voice of every sentence, and the judge's
verdict.*

## 2. The state of the art, per layer

### 2.1 Dialogue act and emotion recognition

The numbers on DailyDialog's own labels set the scale. For acts, a
fine-tuned BERT on the lone utterance reaches 83.2 percent accuracy;
two turns of context lift hierarchical models to 85.8 [3]. RoBERTa
features with a logistic head go from 75.6 to 82.2 macro F1 when a
contextual model over the same features is added, and the macro gain is
larger than the accuracy gain because context rescues the minority
acts, commissive and directive, which is exactly the residual the hub's
rules punt on [2]. For the seven emotions with neutral excluded,
fine-tuned encoders with context sit at 51 to 58 macro F1 (COSMIC
51.05, a 2024 Siamese model 57.71); on the same test set a frozen
all-MiniLM-L6-v2 embedding plus a plain classifier scores 20.2 macro F1
and zero-shot Llama2-7b 9.7, with a Matthews correlation of 0.08 [1].
Zero-shot 7B to 8B prompting is 20 to 40 points behind supervised
models on every conversation-emotion corpus checked and over-predicts
neutral [4]. On GoEmotions, BERT's baseline is 0.46 macro F1 on 28
labels and 0.64 on the Ekman six [5]; the 2026 study of 640,000 LLM
responses finds LLMs catch emotions with explicit lexical markers and
miss the ones needing inference, which is what a lexicon does too [6].

Two results matter for a head over an existing vector. A frozen encoder
trained for sentence similarity plus a small head matches full
fine-tuning on intent (USE plus ConveRT with an MLP 93.4 on BANKING77
against 93.7 for fine-tuned BERT), but a frozen encoder not trained for
it loses 6 to 16 points [7]; and the frozen-MiniLM number above says
emotion is the harder case for any sentence embedding. The stronger
cheap option is a probe on the chat model's own hidden states: a linear
probe on Llama-3.1-8B-Instruct reaches 86.9 percent on six-class
emotion against 44.6 for the same model prompted and 87.7 for a
fine-tuned DeBERTa, with the useful layers early in the network and
inference 86 percent cheaper than a full pass [8]; logistic regression
on Llama2-7B embeddings with 100 labels beats GPT-4 zero-shot on
average and beats BGE sentence embeddings by 13 points on four-class
emotion [10]. Calibration favors heads: fine-tuned transformers
calibrate well in-domain with temperature scaling [11], while LLM label
outputs do not track human uncertainty and post-hoc fixes close at most
14 percent of the gap [6]. Intensity is learnable to roughly human
agreement (SemEval-2018 emotion-intensity regression winner Pearson
0.799 against 0.520 for an SVM on unigrams; EmoBank valence 0.829
against an annotator ceiling of 0.74) [12, 13]; the winning systems
strip punctuation and elongation in preprocessing and attribute their
gains to lexicons and transfer, and no source isolates capitals or
punctuation as a predictor, so the hub's surface-cue intensity rule is
a plausible heuristic with no published support either way.

Stance splits. Reported speech and its source are found by a BERT token
classifier at 82.6 macro F1 on news and 87.1 on debate text, with the
errors in indirect reports [14]; counterfactual and hypothetical
sentences are detected at 90.9 F1 by an encoder ensemble against 19.7
for a tf-idf SVM [15]. Sarcasm is not solved: the iSarcasmEval winner
reached 0.605 F1 against a BERT baseline of 0.348, third-party
annotators agree with authors at only 0.616, and zero-shot LLaMA-3-8B
scores 22.7 with few-shot falling to 11.5 against a supervised RoBERTa
at 63.5 [16, 17]. "Maybe joking" is a low-confidence flag from a small
encoder, never a decision an 8B prompt can make, which is what section
12 already says.

Licenses, confirmed against each source: DailyDialog CC BY-NC-SA 4.0,
EmpatheticDialogues CC BY-NC 4.0, Switchboard DAMSL CC BY-NC-SA 3.0 over
LDC data, MELD a GPL repo over third-party text; clean are GoEmotions
(Apache 2.0), Taskmaster-1 and CCPE-M (CC BY 4.0) and the ICSI meeting
corpus (CC BY 4.0, with the dialogue-act label file's own terms
`[unverified]`, the host refused the connection) [18]. No surveyed
assistant runs an act or emotion classifier: hassil, Adapt and
Padatious are rules or memorizing nets, Rasa's DIET is the one real
embedding classifier, and Leon, Khoj, Open WebUI, LibreChat and Letta
route through the LLM [19, 20]. Cost, measured in this review's own
session: a 768 by 7 linear head takes 3.4 microseconds per call in Bun
on Apple Silicon and a 768 by 256 by 7 MLP 132 microseconds; a
MiniLM-L6 encoder is 12 to 20 ms per utterance on a four-core CPU [25];
an extra 8B classification call is 100 to 250 ms on a 4090-class card
and 300 to 700 ms on a 4060 Ti, serialized against the reply [24].

### 2.2 Intent and tool routing

The approaches sort by cost and by what each is good at. A literal
matcher is a string comparison and no GPU: Home Assistant's hassil
returns the first template match, and Adapt is keyword and regex
vocabularies [26, 27]. An embedding router (aurelio-labs
semantic-router, the vLLM semantic router, Rasa DIET) costs one encoder
pass plus a cosine over the stored examples; frozen similarity-trained
encoders with a small classifier reach 93.4 percent on BANKING77 and
97.2 on CLINC150 with full data and 85.2 and 93.3 with ten examples per
intent, matching fine-tuned BERT-Large [7]. A small trained router
(SetFit on MPNet 94.0 micro-F1 on BANKING77; Model2Vec static
embeddings, up to 500 times faster on CPU, which Open Voice OS made its
default intent matcher on 2026-09-06 with confidence tiers at 0.7, 0.5
and 0.15) costs microseconds to low milliseconds [28, 29]. An LLM as
router loses to a trained head (GPT-4 with three shots 83.1 on
BANKING77 against 94.0) and costs a full prefill plus decode [28].

Native tool calling on 8B models picks a tool well and stays quiet
badly. On the Berkeley leaderboard's single-turn columns Llama-3.1-8B,
Qwen3-8B, ToolACE-2-8B and xLAM-2-8b sit at 84 to 88 percent
abstract-syntax accuracy, while irrelevance detection is 42.7 percent
for Llama-3.1-8B, 79.1 for Qwen3-8B and 90.8 for ToolACE-2-8B [21];
When2Call attributes over-calling to training sets full of call
examples and nearly empty of "do not call" ones [22]. Constrained
decoding fixes syntax, not judgment: a grammar-constrained Llama-3.2-3B
reaches 77.75 percent correct calls where an unconstrained
Llama-3.1-70B gets 45.60, "primarily by eliminating malformed tool
calls" [31], and a JSON-schema mask can make tool-call tokens
unreachable, so any grammar must keep a no-call branch or the decision
must precede the grammar [32]. Meta's own model card warns that the 8B
"can not reliably maintain a conversation alongside tool calling
definitions" [23]. Every shipped system is a cascade with an explicit
abstain: Home Assistant's templates then the model only on a miss; OVOS
by matcher and confidence tier; Rasa with RulePolicy priority 6 over
its learned policy at 1 and a fallback classifier at 0.7 that asks the
person to rephrase [26, 29, 30]; the cost cascades (FrugalGPT's
DistilBERT scorer, RouteLLM's 3.66 times cost cut at 95 percent of GPT-4
quality) reduce to the same shape [33, 34].

On the card that is arriving, the measured llama.cpp numbers for an 8B
at Q4_K_M are 4,792 prompt tokens per second, 88 generated tokens per
second and 279 ms to first token on an RTX 4080, and 3,561, 54 and 364
ms on a 4070 Ti Super [24]; a 1,500-token uncached prompt costs 310 to
470 ms of the one-second budget, so the tool schemas must sit in the
cached prefix (llama-server's `cache_prompt` is on by default) [35]. The
hub's FAST-01 and FAST-02 work already measured and fixed exactly this
(cache ratio 0.86, 144 processed tokens per turn). Multi-intent
utterances ("add oat milk, and when is Pippa's appointment") are handled
only by the model layer; Qwen3-8B scores 75 to 92 percent on the
parallel categories against 46 to 88 for Llama-3.1-8B, and llama.cpp
ships parallel calls off by default [21, 36]. One detail for the
routing head: nomic-embed-text v1.5 documents task prefixes
(`search_query:`, `classification:`), and the hub embeds the utterance
unprefixed because the same vector serves recall [37].

### 2.3 Adaptive retrieval, hallucination detection, abstention

Who decides to retrieve. Self-RAG puts the decision in the generator's
own reflection tokens and needs a fine-tuned model [38]; FLARE retrieves
when any token in a tentative next sentence falls below a probability
threshold, at roughly two generations per answer [39]; Adaptive-RAG
trains a T5 classifier on which strategy answered each question, finds
no difference between a 60M and a 770M classifier, and reports the
trained router at 50.9 F1 against an oracle router at 62.8, so the
labels are where the headroom sits [41]; DRAGIN triggers on entropy
times attention, which a local model exposes for free [42]; SKR found
kNN over previously seen questions beat prompting the model about its
own knowledge [43]; a 2025 study of question-only features
(entity popularity, hop count, question type) matches uncertainty
methods on Llama-3.1-8B at one model call per question instead of 1.7
to 2.0 [44]; and a 2026 baseline study reaches 93.2 percent routing
accuracy on 7,727 queries with TF-IDF and an SVM [45]. The pattern is
consistent: a small classifier is at least as good as letting the model
decide, and cheaper.

Hallucination detection under one second rules out every sampling
method (SelfCheckGPT at 20 samples, semantic entropy at about ten,
EigenScore at ten) and leaves single-pass probes: exact-answer-token
probes at 0.85 AUROC on Mistral-7B against 0.66 for asking the model
P(True) [46]; semantic entropy probes that predict the expensive
quantity from one pass [88]; Lookback Lens, an attention-ratio
classifier for "did this come from the retrieved context" that
transfers from 7B to 13B without retraining [89]; and 2026 mid-layer
linear probes on 4-bit Llama-3.1-8B at 0.91 to 1.00 AUROC
in-distribution [90]. The caveat is transfer: probes trained on one
task type show "limited or no meaningful generalization" to another
[46], so a household-fact probe needs household-fact labels, which the
guards' own verdicts are. On abstention, AbstentionBench (Llama 3.1 8B
included) finds scaling barely helps, reasoning fine-tuning lowers
abstention by about 24 percent, and a carefully written system prompt
raises abstention without hurting its precision [91]; a 2026 study on
2B to 14B models finds answer confidence "nearly blind" to
answerability and a hidden-state probe recovering it [92]. HalluLens
measures Llama-3.1-8B-Instruct still writing a biography for 13.2
percent of nonexistent entities [93], the published form of the
false-familiarity defect the resolver's roster gate exists for.

On currency, FreshQA shows every model size failing on fast-changing
facts [94]; EverGreenQA trains an E5-Large classifier to 0.906 F1 on
whether an answer stays true over time, and that evergreen-ness
correlates 0.77 with a frontier model's own retrieval decisions against
0.36 for the best uncertainty signal [95]. Among shipped assistants only
Home Assistant is deterministic-first; Open WebUI searches every message
when toggled, Khoj, Perplexica and the LangGraph and LlamaIndex routers
use a model prompt or tool call, LibreChat and Letta let the model call
the tool [96].

### 2.4 Output verification and guardrails

Learned guards sort by weight. A 7B to 12B guard (Llama Guard 3 8B at F1
0.939 and a 4.0 percent false-positive rate on Meta's set; WildGuard;
Granite Guardian 8B, the one family that also scores groundedness at
mean AUC 0.85) fits on 16 GB beside a Q4 8B but doubles the GPU work
per reply [97, 98]. Llama Guard 3 1B (0.94 GB, 0.165 s per check, F1
0.899 at 9.0 percent false positives) and Prompt Guard 2 (22M
parameters, 19 ms, inputs only) run beside the chat model without
contention [99, 100]. The learned guards' own false-positive rates, 4
to 11 percent, are the honest bar for a regex: a word-boundary list
with under one percent false positives on household traffic beats them
on precision and loses only on recall for phrasings it never listed.

Fact checking against a retrieved context has a benchmark of record.
On LLM-AggreFact, MiniCheck-Flan-T5-Large (770M) scores 74.7 balanced
accuracy against GPT-4's 75.3 at about a four-hundredth of the cost;
AlignScore 70.4; SummaC 62 to 68 [101]. The models that fit the hub's
budget and license are LettuceDetect, a ModernBERT token classifier
that marks unsupported spans at 79.2 example-level F1 on RAGTruth and
runs 30 to 60 examples per second on one GPU [102], and Vectara's
HHEM-2.1-Open, under 600 MB and about 1.5 s per 2,000-token input on a
CPU, ahead of GPT-4 on three RAG sets [103]; Bespoke-MiniCheck-7B tops
the leaderboard at 77.4 but is CC BY-NC and as heavy as the chat model
[104]. The 8B must never judge itself: beyond JudgeBench [47], the
self-preference papers show judges rate lower-perplexity text higher
whoever wrote it, which is the case when a model reads its own reply,
and the harmful kind concentrates where the generator was wrong [48,
49, 50].

Constrained decoding does not hurt when measured fairly. The paper
that found reasoning declines under format constraints used different
prompts per condition; rerun with matched prompts on Llama-3-8B,
structured output scored 0.78 against 0.77 on GSM8K and 0.77 against
0.73 on a letter task [105, 106]; llama.cpp's grammars, Outlines,
XGrammar and vLLM's guided decoding run at near-zero overhead, with the
llama.cpp caution that repeated optionals are slow and that a schema is
never injected into the prompt [107, 31]. Streaming guards converge on
one pattern: sentence units, a short hold, stop-and-replace, never
retroactive edits (NeMo's rolling buffer, Guardrails AI per sentence,
SentGuard's 90.5 percent caught within two sentences at a 7.41 percent
streaming false-positive rate) [108, 109]. On word lists specifically,
the Scunthorpe failures are substring matches without word boundaries,
not lists as such; Perspective API scored 61 percent of real non-toxic
profanity as toxic and is being retired at the end of 2026, so a
hosted classifier is not a stable spec and a regex is [110, 111]; and
for PII the rule-based Presidio was the best of eight systems on a
2026 benchmark, with its regexes covering dates, emails and phones
that transformer NER missed [112]. Register phrases ("as an AI",
"noted") have no published detector; the one study scanning for them
uses a word bank because it works [113]. Echo in small instruct models
is now named as structural, driven by induction heads, so a lexical
overlap check against the person's turn is justified [114]. Repetition
belongs first at the sampler: the DRY penalty the hub already runs
(multiplier, base, allowed length) is the published answer, with the
output guard as a backstop [115].

### 2.5 Memory for assistants

The shipped designs cluster into three shapes. The agent edits free-text
blocks (MemGPT and Letta's memory blocks, with sleep-time agents
rewriting them offline) [64, 65]; a prompt emits candidate facts and a
model picks ADD, UPDATE, DELETE or NOOP against the top ten similar
records (Mem0, LangMem) [66]; or facts become graph edges with explicit
validity intervals (Zep's Graphiti, Mem0's graph variant) [67]. Only
Zep publishes a bi-temporal record (`t_valid` and `t_invalid` on the
event timeline, created and expired on the transaction timeline) with a
contradiction handled by closing the interval and never deleting, which
is the closest published analogue to the hub's `valid_to` and
supersede-not-delete [67]. None of the shipped systems grounds a fact
to the speaker's own span; Cognee grounds to an ontology, and 2026 work
(Eywa's provenance-first store, a schema-grounded extractor with write-
time validation gates at 97.1 F1) validates against source support, but
nothing published is as strict as "every proper noun and number must
appear in the turn" [68, 69].

The benchmarks are contested. LoCoMo is criticized by Zep and Letta
(the conversations fit any modern window, no knowledge-update questions,
a category without ground truth, speaker-attribution errors), and a
full-context baseline at about 73 beats Mem0's best 68 on it; Letta
scored 74.0 with the transcript in files the agent greps [70, 71, 72].
LongMemEval is the one that tests updates and abstention, and every
vendor number on it used GPT-4o-mini or larger for extraction [73];
a 2026 paper shows the judge's target choice alone flips rankings on
83 to 94 percent of queries, so vendor tables are not comparable [74].
The single 4B-class result is MemReader-4B, a Qwen3-4B trained with
supervised fine-tuning then GRPO to write, defer, retrieve or discard:
83.0 on LongMemEval, 91.0 on knowledge updates, a 0.32 percent
hallucination rate on HaluMem-Medium [75]; a prompted stock 4B has no
published number.

Hallucinated memories are measured. HaluMem puts Mem0 and Supermemory
near 60 percent extraction accuracy and 16 to 26 percent update
accuracy with GPT-4o backbones, and errors propagate to answers [77].
"Manufactured Confidence" is the direct evidence for the validator's
reported-speech rule: consolidation turned "probably promoted" into a
flat fact; "reportedly" was obeyed as often as an assertion (0.68 to
0.81 against 0.81); an "unverified" tag was unreliable, a "do not trust"
instruction made things worse, and only rejection or a second
independent source restored correct behavior [78]. MemGuard names
"context-specific events become overgeneralized claims" as a primary
failure and fixes it with a functional type on every memory at write
time, composing only compatible types at read time [79]. On emotional
state versus trait, no paper or postmortem from Replika, Character.AI or
Pi publishes a design; the nearest evidence is MemoryBank's Ebbinghaus
decay and the finding that models saturating memory benchmarks still
fail at sustained user understanding [80, 81]. A bounded `valid_to` on
moods is motivated by the literature and untested in it.

How memory should enter a reply: the MSC human study is the key number
(a summarization-memory model rated engaging on 62.1 percent of turns
against 53.0, referencing the partner's earlier topics 33.8 percent
against 14.5, with the gain coming from bringing up the other person's
past) [76]; "Lost in the Middle" says the middle of a long context is
underused [82]; the strong systems inject 1,300 to 1,600 tokens of
typed memory per turn rather than raw top-k prose [67, 83]; and
"proactive" memory work makes the timing of raising a past topic its
own task with a detector [84]. Per-person scoping has commercial
precedent (Alexa's per-speaker id separate from the account, absent when
unrecognized; Google's Voice Match, six per home) and one direct result
(per-speaker stores lift persona attribution from 35.7 to 61.3 percent)
[85, 86, 87]; no published work covers consent for a fact one member
states about another, so rejecting third-party clauses is ahead of the
literature.

### 2.6 Persona consistency and tone

Drift is measured. Instruction stability falls on the order of 10 to 15
points within eight rounds on LLaMA2-70B and GPT-3.5, by attention decay
on the system prompt; split-softmax, a training-free rescaling of
attention to the prompt, is the published inference fix [51]. Persona
responses converge toward the base persona over 100-plus rounds [52];
drift is driven by conversations "demanding meta-reflection on the
model's processes or featuring emotionally vulnerable users", which is
the companion setting, and clamping activations along the "assistant
axis" stabilizes it [53]; a companion-app audit of 2,008 conversations
found no memory configuration that fixes trajectory accuracy (44.4
percent) [54]; asking a model to first pick a fitting persona in the
prompt deepens collapse, while training the choice in fixed it [58]. No
paper gives a 7B or 8B drift curve `[unverified]`; none suggests a
flatter one.

The levers, with 7B to 8B numbers. System-prompt prose shapes traits
less reliably on smaller models [55, 56] and does not improve task
performance [116]. Few-shot exemplars for behavior control "do
basically nothing" on Llama-2-7B where activation addition works [57].
Activation steering has real 7B numbers (contrastive activation
addition moves refusal from 0.56 to 0.86 and stacks on a system prompt
from 0.79 to 0.93 with MMLU within a point) [57], and Anthropic's
persona vectors are extracted on exactly the target class, Qwen2.5-7B
and Llama-3.1-8B [117]; the critiques are also real (steerability
"highly variable across inputs", brittle to prompt changes, a fraction
of anti-steerable inputs), and the practical reading is that "warmer",
"briefer", "more playful" are coherent directions while "the whole
persona" is not [118, 119]. Engine support: llama.cpp loads control
vectors at process start (`--control-vector`, GGUF, trained by repeng in
under a minute) with no per-request field, so per-companion vectors
mean a process per companion or a scaling trick `[unverified beyond the
README]`; LoRA adapters are per request in both llama.cpp and vLLM at
about 2 ms per token of overhead, with llama.cpp not batching requests
that carry different adapters [120, 121, 122]. Character fine-tunes on
7B hold identity in multi-turn and approach ChatGPT-level judged
quality [123, 124], with the cost that warmth fine-tunes raised error
rates by 10 to 30 points and validation of false beliefs, most when the
user sounded sad [125].

Judging tone. A trained character reward model reaches Pearson 0.631
with human annotators against 0.375 for three-shot GPT-4; PersonaGym's
score correlates at Spearman 0.75 with a Fleiss kappa of 0.71 among
humans; the 7B Prometheus 2 judge sits at Pearson 0.55 to 0.67 with
73.5 percent pairwise agreement; and frontier judges reach only 69
percent on the prerequisite task of telling who is speaking, against
90.8 for humans [126, 127, 128, 129]. An 8B nightly judge is usable
for relative trends and rankings, never absolute pass marks [130].

Register and length control on an 8B: IFEval 80.4 for Llama 3.1 8B and
83.0 for Qwen3-8B [131, 132]; FollowBench's hard satisfaction falls from
58 to 35 percent as constraints stack from one to five on a 7B [133];
Llama3-8B violates length instructions 7 to 20 percent of the time,
cut to 3 to 11 by a length-aware preference tune [134]. One or two
verifiable rules per turn is what an 8B follows. On reply planning, the
strongest small-model evidence is ESConv: eight support strategies
prepended as a token to a 90M model beat vanilla generation 51 to 34 in
human tests and beat random strategies 56 to 36 [135]; CICERO's 2.7B
dialogue model realizes intents from an external planner [136]; SAGE
adds state and action tokens before every reply [137]; and the
counter-evidence, above, is that a plan requested in the same prompt as
the reply is weaker than one produced by a trained or external policy
[58]. Companion products publish little: XiaoIce's empathetic computing
module and engagement-as-MDP framing [138]; Character.AI's prompt
assembly and 95 percent prefix-cache rate, nothing on consistency
[139]; Anthropic's character trained through a constitutional
preference model, not carried in a system prompt [140].

### 2.7 Rules versus learned components, and what keeps each honest

Nobody in the literature argues either extreme. Google's rules of
machine learning say to launch on a heuristic and switch to a model
when the heuristic becomes hard to maintain, which is a maintainability
trigger rather than an accuracy one [141]; Rasa's docs say "don't
overuse rules" because rules "don't have the power to generalize", its
founder calls edge-casing with if-statements "a house of cards", and
Rasa's answer is conversation-driven development, where real
conversations become tests and training data, not model judgment [30,
142, 143]; the hidden-technical-debt paper is the counterweight, that a
learned component moves maintenance into data, entanglement and
evaluation rather than removing it [144]. The measured brittleness runs
both ways. Rules: 97.6 precision at 61.0 recall on the intent task
above [9]; Scunthorpe substring failures; word-based toxicity
interventions cutting coverage of dialects [145]. Models: up to 76
accuracy points from prompt formatting alone on a 13B [146]; 15 percent
run-to-run variance at temperature zero and 80 distinct completions from
1,000 identical greedy requests [147, 148]; GPT-4's prime-identification
accuracy from 84 to 51 percent in three months, which a pinned local
model avoids until the day the model changes [149]; verbalized
confidence overconfident at 0.52 to 0.61 AUROC for failure prediction,
improving only with size [150, 151]. Retraining a small model from
labeled production failures degraded by up to 43 points without
regression constraints and improved on every scenario with them [152].

What keeps either honest is the same thing: evals as tests. Every
vendor now documents it (automate, prioritize volume, include edge
cases; rerun on every model change; hundreds of assertions grown from
observed failures; align a judge on 25 to 50 examples and measure its
precision and recall separately; "every incident becomes a permanent
regression test"; block CI on deterministic metrics and treat judge
scores as warnings until they stabilize) [153, 154, 155, 156], and the
org already has the rule in its verification section. Prebuilt beats
home-grown for rule-shaped jobs: Presidio for PII, duckling and chrono
for dates and numbers, weighted finite-state grammars for text
normalization because "this task has extremely low tolerance to
unrecoverable errors"; a hybrid of regex plus a model reached 0.605 PII
recall against 0.362 for NER alone and 0.437 for an unconstrained model
that "hallucinated entities outside the defined set" [112, 157, 158,
159]. In every one of these the rule-shaped job is still done by rules,
but by rules someone else maintains against a public corpus.

## 3. Verdict per layer

The verdicts use three words. *Keep*: the layer's mechanism is the
state of the art for our constraints and stays deterministic. *Evolve*:
the mechanism is right and a named part of it should become learned or
prebuilt, with the rule staying as the floor. *Replace*: the mechanism
should go. Cost per turn is on the arriving 16 GB card (RTX 4070 Ti
Super to 4080 class, 3,561 to 4,792 prompt tokens per second, 54 to 88
generated, 279 to 364 ms first token for an 8B at Q4_K_M) [24], with the
dev hub's Mac numbers where the hub has measured them.

| Layer | Verdict | What changes | Cost per turn | Maintenance story |
|---|---|---|---|---|
| Signal | Evolve | The protocol layer and the closed-set rules (question, command opener, greeting, closing, backchannel, repair, consent) stay; the emotion lexicon, the inform-versus-commissive residual, and the reported and hypothetical stance markers become a small trained encoder on human-labeled turns, precision-first, with the rules as the floor and DailyDialog as validation only | Rules: microseconds (`signal_us` is on the `[turn]` line); an encoder: 12 to 20 ms on CPU at p95 under 20 ms, off the GPU | Labels, not lists: a reviewed fixture row per phenomenon, retrained under the regression corpus |
| Subjects | Keep | The candidate gate and the stack are set membership and provenance, which no classifier beats; the stop lists shrink as the tagger's own tags take over (ASK-02's own rule); a name from a lookup outcome is world by provenance, already designed | Microseconds; the `compromise` tagger on one utterance | Each stop-list entry carries its row; the world-frame nouns are one spec vocabulary shared with the robot |
| Routing | Keep | Tiers 0 and 1 are exactly the shipped cascade shape (templates, then an embedding with an abstain, then the model); one measured fix: try the `classification:` prefix on a routing-only vector when a routing head is next trained, and pin Qwen3-class for the tool-call residue (79 percent irrelevance detection against 43) | Literal: microseconds; embed: 10 to 30 ms CPU, once per turn and reused by recall; tier 2: rides the answering completion | The routing corpus (107 rows, 100 percent) and the null-row floor, re-measured per package change |
| Lookup decision | Evolve | The engine's claim-type decision stays as the day-one rule and the fast path; the field classes and the currency marker become a trained router on the answering-rung labels the turn row can record, plus an evergreen classifier for currency; a free low-probability trigger from the model's own logits joins the hedge words as a second confession | Rule: microseconds; a router head: microseconds on the existing vector; the forced lookup itself: one extra completion, about 250 to 500 ms plus the search | The label is "which rung answered", logged per turn; the oracle gap (50.9 against 62.8 F1 in Adaptive-RAG) is the headroom |
| Generation with the plan | Keep | The plan is an external policy realized by the model, which is the shape with human-tested gains; keep the plan line to one or two verifiable constraints per turn, because an 8B loses rules as they stack; the ask-back rate calibrated to the human reference (finding 23) stays | The plan: microseconds; the prompt: cached prefix plus about 144 to 300 context tokens | The fixture's signal and move expectations; the question rate printed per run beside the reference |
| Composer | Keep | Land K2 as designed; the composition call is the right place for a typed move schema (grammar-constrained, no-call branch kept) so the plan guards read fields, never prose | One composition completion on a data turn, inside the two-call budget | The decision table's rows in the fixture |
| Output guards | Evolve | The safety floor, the roster and outcome checks, the register and closer phrase lists, the banned phrase and the objection shapes stay deterministic; DRY is documented as the first repetition line with the guard as backstop; the household-fact grounding gains an encoder check (LettuceDetect or HHEM-2.1-Open) as a measured candidate beside the content-word rule, adopted only if its false-positive rate on the bench is at or under the rule's; the 8B never judges itself | Rules: microseconds per sentence; an encoder: tens of ms per sentence on the GPU, or a CPU pass on the composed reply | Every reason has its corpus rows; the weekly report prints hits per rule; a rule with no hit in 90 days and no protected row is retired |
| Memory judge and curator | Evolve | The validator is stronger than anything published and stays; the ADD-versus-SUPERSEDE decision gains a deterministic rule before the 4B (same subject and category with a conflicting value closes the old interval, Zep's shape); the stock 4B is measured on HaluMem-Medium; MemReader-4B is evaluated as a candidate extractor package once its license is confirmed | Background only; 1.8 s per judged turn today | The judge-eval rows and the LongMemEval sample; the drop counts per reason on the log line |
| Persona and tone | Evolve | Shrink the dial prose toward the plan line plus the example lines; run the recorded next step (a control vector trained on the companion's own example lines) as a bench; if several companions must be live at once, a per-companion LoRA is the engine-supported path; the persona judge rubric takes the CharacterEval or PersonaGym shape and reports trends, never pass marks | Vector: one add per steered layer per token, effectively free; LoRA: about 2 ms per token, per request | The steering bench with three seeded runs; the household bench's protected rows unchanged under any voice change |

### 3.1 The word lists, sorted

**Legitimate deterministic layers, which stay and why.**

- The safety classifier (`spec/safety`): an invariant. A learned guard
  carries 4 to 11 percent false positives of its own and a hosted one
  changes under you; the floor must be testable, portable to the robot,
  and identical in every house. Llama Guard 3 1B (about 1 GB, 0.17 s) is
  the one learned guard that could run beside it as a second signal
  later, never as the floor.
- The roster and entity registry checks (false familiarity, the
  household guess, the pronoun for a known entity, the who-ask
  candidate gate): set membership against a closed household list. No
  classifier beats the set, and the resolver's job of refusing to
  invent a biography for an unknown name is the published fix for a
  13 percent fabrication rate.
- The action-claim and capability checks: a claim read against a typed
  outcome record. The verb families are the rule-shaped part and could
  one day be an entailment check, but the ground truth is the outcome
  row, and that is a lookup, not a judgment.
- The protocol layer: consent, cancel, confirmation, the pending ask,
  the imperative consent forms. A "yes" must never wait on a model.
- The almanac compute and the date relation: exact arithmetic; the only
  question is whether the parse uses a maintained library (chrono or
  duckling) instead of the repo's own grammar, per principle 6.
- The memory validator (grounding, eligibility, subject, the reported
  cap, the intensity bands, the lifetimes): the strongest-supported
  piece of the whole pipeline (HaluMem, Manufactured Confidence,
  MemGuard, Zep).
- The child band, the audience default, the adult-to-tell vocabulary,
  the worrying-conversation class: invariants that must be adult-
  written and testable. The known weakness is recall (a death described
  in words not on the list); the mitigation is the memorialized-person
  rule and the adult's flip, and a classifier may one day add recall as
  a second signal and never replace the rule as the default.
- The register and closer phrase lists, the tag questions, the banned
  phrase, the objection and self-assertion shapes: closed sets with no
  published detector; the field's own scanners use word banks.
- The repeat guards: DRY at the sampler does the first line of this for
  free; the cross-turn guard stays as the backstop.

**Should become a trained classifier or an embedding decision, and with
what data.**

- The emotion lexicon and intensity cues: a fine-tuned small encoder
  (MiniLM or ModernBERT class through the ONNX runtime the backend
  already carries, section 12's own fallback) trained on human-labeled
  household turns and validated on DailyDialog's test split. Data we
  have: the fixture's 218 human-labeled turns, the 500-turn review sheet
  awaiting a person's hours, DailyDialog as validation only (CC BY-NC-
  SA), GoEmotions as pre-training at most (wrong domain, measured). The
  ACT-02 run is the evidence for the data rule, not against the head:
  a frozen sentence vector is the weak encoder for emotion (20.2 macro
  F1 with MiniLM on DailyDialog) and 4B-made labels shaped the act
  weights. If the serving stack ever exposes the chat model's early
  hidden states during prefill, a probe there is the strongest cheap
  option (86.9 percent on six-class emotion); llama-server does not
  expose them per request today.
- The inform-versus-commissive residual and indirect questions: the same
  encoder, human labels from the review sheet, Taskmaster-1 and CCPE-M
  for the phenomena (clean licenses), never the 4B's own labels as
  ground truth.
- The reported and hypothetical stance markers: solved by small encoders
  at 82.6 and 90.9 F1; the marker rules stay as the precision floor and
  the encoder adds recall. Joke and irony stay a low-confidence flag
  (unsolved at 0.605 F1), precision-first, writing nothing to memory.
- The lookup decision's field classes and currency marker: a router
  trained on the answering rung recorded per turn (typed source,
  search, model knowledge, failed), with an evergreen feature; a
  TF-IDF-and-SVM or a head on the existing vector. Data we have: the
  checkable-fact and ladder rows, every live `[turn]` line once it
  records the rung, and the LongMemEval abstention class for the
  household side.
- The hedge-plus-checkable-value and claimed-experience sentence shapes:
  open-class by nature (people hedge in endless ways). The rule stays
  as day one; the learned replacement is not a text classifier but the
  model's own logits (a low-probability token in a sentence carrying a
  number or a name is the hub's FLARE trigger) and, on the composition
  path, the typed plan fields the guards read instead of prose.
- The household-fact grounding (`invention`, `unrelated_recall`): the
  content-word rule stays as the floor (a name or number absent from the
  evidence is invented, no model needed); an encoder over (included
  evidence, sentence) is the candidate for the paraphrase case, measured
  on the guard corpus (111 rows) plus the bench before adoption.

**Should be dropped, because a model or a library does it better at
acceptable cost.**

- The prose halves of decisions the engine now owns: the engagement
  dial's follow-up sentence and the persona's reaction prose (section
  12 already retires them once the plan is enforced), the extraction
  prompt's rules that the validator enforces mechanically (keep the
  prompt short; the validator is the gate), and any guard whose only
  job is to catch a model copying a bank line back (WINDOW-01's fix
  removes the cause).
- The hand grammar for relative dates, once a maintained parser is
  measured against it on the derived-dates rows.
- The nomic emotion and act heads as trained (retired already); not the
  idea of a head.

### 3.2 Maintainability, head-on

A rule-plus-corpus system fails by recall (61 percent on the measured
intent task), by the Scunthorpe class when a boundary is missed, by
unbounded growth when nothing retires an entry, by entanglement between
lists (finding 38: a replacement bank rendered back into the window
and copied), and by a fix landing at the wrong layer because the symptom
was visible there. What keeps it honest is already the org's rule with
two additions: every entry has its regression row and its commit names
the inventory (in place); the weekly report prints hits per rule from
the `[turn]` line's guard array and signal source, so a rule that never
fires is retired and a family that keeps growing is a classifier
candidate (missing); and every rule family has a stated recall
measurement on a held-out slice, so "precision-first" is a number, not
a mood (missing).

A learned-plus-eval system fails by silent regression on retrain (up to
43 points without constraints), by domain shift (ACT-02's own numbers),
by label debt (a corpus the 4B labeled is the 4B's opinion), by prompt
and format sensitivity and sampling nondeterminism when the learned
component is a prompted model, by judge unreliability (an 8B judge below
chance on correctness), and by a version bump that changes behavior
everywhere at once. What keeps it honest: a human-labeled held-out set
the prompt writers never see (EVAL-07's rule), retraining only under
the regression corpus with no protected row moving (section 11's gate),
shadow mode before a learned component takes a decision (log its answer
beside the rule's for a month), deterministic checks blocking and judge
scores warning, and a versioned artifact with a checksum a person can
roll back (section 11's four conditions).

Both are kept honest by the same substrate, and it is the one thing
this review found under-built rather than wrong: the label harvest.
The turn row already records the signal's source, the guard reasons,
the outcome's `via`, the subjects and the lookup shape; a person's
correction, a forced lookup after a hedge, a guard hit, a thumb, and
the rung that finally answered are all labels for the classifiers
above, and today they are read by nobody. Rasa's conversation-driven
development and every vendor's evals guidance say the same thing in
different words: the failures are the training set, and the corpus is
the product.

## 4. Tone and memory

### 4.1 A consistent personality on a small model

The evidence against the prose paragraph is consistent: prompted
personality is less reliable on smaller models, few-shot exemplars
barely move a 7B on behavior, attention to the system prompt decays
within eight rounds, and emotionally vulnerable turns (the companion's
whole point) accelerate the drift. The evidence for the alternatives on
7B to 8B: a control vector stacks on a system prompt and holds a
coherent direction (0.79 to 0.93 on corrigibility with MMLU within a
point), Anthropic's persona vectors are extracted on Qwen2.5-7B and
Llama-3.1-8B, and the hub's own spike reproduced the token saving (26
percent) and the register gain (23 of 30 against 19 of 30) while losing
the companion's specific markers because it was trained on generic
pairs. The critiques say a vector is reliable for one coherent
direction and unreliable for "the whole persona". So the shape that the
literature and the hub's own measurement both support is:

- The plan line carries the register decision (one or two verifiable
  constraints per turn: the moves, the length), because that is what an
  8B follows and FollowBench says stacking more loses them.
- The companion's example lines stay, because they are the one part of
  the prose the spike found carried the specific voice, and because a
  vector trained on them is the recorded next step.
- One or two control vectors for the coherent dials (warmth and
  playfulness are the candidates; formality is plausibly one; "the
  whole companion" is not), trained with repeng on the companion's own
  example lines against neutral rewrites, benched on the steering
  spike's thirty turns with three seeded runs, and adopted per dial only
  where the bench and the persona judge's relative score agree. The
  engine constraint is real: llama.cpp loads a control vector at
  process start, so a household with several companions live at once
  (CONC-01's slots) cannot switch vectors per request; that household
  needs a per-companion LoRA, which both engines take per request at
  about 2 ms per token, with the llama.cpp caveat that mixed-adapter
  requests do not batch. Section 11 already lists a companion adapter as
  a candidate "if activation steering is shown unable to make a
  companion distinct"; the bench above is that test.
- Re-anchoring, which the hub already does with one line in the
  context, is the published cheap fix for drift (a single-shot anchor
  restores the trained register); split-softmax is the stronger
  inference-time fix and is not available in llama.cpp.
- The warmth caution: fine-tuning for warmth raised error rates by 10
  to 30 points and sycophancy, most when the user sounded sad. The
  hub's care moves live in the plan, not the weights, which is the
  right side of that finding; any companion adapter is trained on voice,
  never on "be warmer".

The persona judge as built (an 8B, batched exchanges, "does this sound
like the character") is fine as a bench trend line and wrong as a gate:
7B judges sit at Pearson 0.55 to 0.67 with humans, and frontier judges
reach only 69 percent on telling who is speaking. REVIEW-01's nightly
pass should use the CharacterEval or PersonaGym rubric shape (knowledge
consistency, persona-behavior consistency, persona-utterance
consistency, linguistic habits, each with the stored signal, plan and
outcome printed so the judge never re-guesses them), report relative
movement week over week, and never tick or fail an item on its own;
the structural checks (address form, length, forbidden phrases, the
plan violations) remain the gate.

### 4.2 How a remembered fact enters a reply

The measured "friend who remembers" effect is the assistant bringing up
the person's own past at the right moment (engaging on 62.1 percent of
turns against 53.0, earlier topics referenced 33.8 percent against
14.5), and the failure mode the hub has seen (a memory said back as
the reply to a statement, finding 25; a fact recited rather than used)
is the database reciting. Four changes, each with its reference:

1. *A bigger, typed slice.* The hub renders at most five bullets in 800
   characters, about 200 tokens; the strong systems inject 1,300 to
   1,600 tokens of typed memory and beat both full context and large
   top-k. Raise the memory section's budget in measured steps on the
   LongMemEval sample and the household bench, keeping the reordered
   layout's cache ratio; render each bullet with its category, its date
   and its subject label ("preference, Sage, 2026-09-02: dislikes
   cilantro"), because MemGuard's finding is that a moment read as a
   trait is the over-generalization bug and the type in the prompt is
   the fix.
2. *A move for it.* The plan gains `recall` as a move with the record
   id: allowed after an inform or a greeting when the record's subject
   is the turn's subject or the person's own recent state, forbidden on
   a directive, a closing or a question the record does not answer, and
   realized as a reaction or a question about it ("how did the dentist
   go?"), never as a recitation ("you told me you were nervous about the
   dentist"). The typed field is what lets REVIEW-01 record which memory
   helped (section 11's retrieval feedback), and the rate is calibrated
   the way the ask-back rate is.
3. *Proactive timing as its own decision.* The published version makes
   "may this past topic be raised now" a detector; the hub's version is
   the greeting row's memory-driven prompt (B3, F1) generalized: a
   `valid_to` state about the speaker whose date has passed, a goal
   whose date is today, or a follow-through question queued by CUR-01,
   surfaced once, on a greeting or a backchannel, never twice.
4. *The extractor's next step.* The validator stays as it is; the
   supersede decision gets its deterministic first rule (same subject
   and category with a conflicting value closes the old record's
   interval, the 4B asked only in the ambiguous band), because HaluMem
   measures the LLM-chosen operation at 16 to 26 percent update accuracy
   and the hub's own judge-eval saw both small models choose ADD and
   leave a stale fact standing; the stock 4B is measured on HaluMem-
   Medium so its precision is a number; MemReader-4B (a Qwen3-4B trained
   for exactly this, 91.0 on knowledge updates) is evaluated as a
   candidate model package once its license is read, which is section
   11's "fine-tuned extractor" candidate with a concrete model behind
   it.

The bounded emotional state (`valid_to` at 24 hours or seven days, never
a trait) has no published counterpart and the closest evidence supports
it; it stays, and the household's own re-assertion and expiry counts
from CUR-01 are the measurement.

## 5. Corrections, in order

Each carries what it replaces, the acceptance evidence, what stays, and
its references. Sizes use the backlog's scale.

1. **The label harvest and the per-rule report (S-M, first, because
   every learned item below eats from it).** The turn row and the
   `[turn]` line gain the answering rung (`typed_source | search |
   model_knowledge | failed | none`) and a `corrected_next_turn` flag
   read from the next turn's `repair` and `target: hub`; a
   `scripts/bench/labels.ts` exports, per week, every guard hit, forced
   lookup, correction, rung and signal source with the turn's text
   redacted to the roster form (EVAL-07's safe loop), into the
   git-ignored data directory; the weekly report prints hits per guard
   reason and per signal rule. Replaces: nothing; it makes items 2, 3
   and 6 trainable and makes retirement of a rule a fact. Acceptance: a
   week of the dev hub exported, the counts reconciled against the log,
   a rule with zero hits named. Stays: every rule. References: Rasa's
   conversation-driven development [143]; Adaptive-RAG's oracle gap
   [41]; Langfuse and Husain on evals [155, 156].
2. **Human labels for the signal, then the encoder (a person's hours,
   then M).** The 500-turn review sheet is reviewed (act, stance,
   emotion, intensity) and joined to the fixture's 218 turns and the
   Taskmaster-1 and CCPE-M phenomenon rows; a MiniLM or ModernBERT-class
   encoder is fine-tuned SetFit-style on those labels for act (the
   inform-versus-commissive residual and indirect questions), stance
   (reported, hypothetical) and the seven emotions, calibrated by
   temperature scaling, thresholds chosen on precision, run through the
   ONNX runtime the backend carries; the rules keep every decision they
   make today and the encoder decides only the residual. Replaces: the
   emotion lexicon's recall role, the 0.6-confidence inform fallback,
   the reported and hypothetical regexes as the only reading. Acceptance
   (section 12's own, unchanged): a 5-point macro-F1 margin over the
   rules alone on DailyDialog's test split for act and for emotion
   neutral-versus-not, no regression on the fixture, warm CPU p95 under
   20 ms, the fallback rate printed; ships as a fetched artifact under
   the model-capabilities spec. Stays: the protocol layer, the closed-set
   rules, joke as a marker-only flag. References: [1, 2, 3, 7, 8, 11,
   14, 15, 16, 25]; the ACT-02 report in `docs/dev.md`.
3. **The lookup router and the logit trigger (S-M).** From item 1's rung
   labels, a router (TF-IDF plus SVM, or a logistic head on the
   utterance vector with the `classification:` prefix) predicts the
   rung for a world question, with an evergreen feature trained from
   EverGreenQA's released labels if their license allows and the hub's
   own currency rows otherwise; llama-server's per-token logprobs feed a
   FLARE-style trigger (a token under a threshold inside a sentence
   carrying a number or a proper noun on a world question is a
   confession, beside the hedge words). Replaces: `exactFieldOf()` as
   the sole decision (it stays as the fast path and the day-one rule);
   the hedge regex as the only hedge signal. Acceptance: on the
   checkable-fact, hedged-draft and ladder rows plus a held-out set of
   live world questions, lookup precision and recall against the rule
   alone, no added model call, first token unchanged. Stays: the engine
   builds the query, the ladder order, the failed line. References:
   [39, 41, 43, 44, 45, 95, 22].
4. **The companion voice bench and the prose cut (S, then the owner's
   call).** Run the recorded next step: control vectors trained with
   repeng on each bundled companion's example lines against neutral
   rewrites, one per candidate dial (warmth, playfulness), on the
   steering spike's thirty turns with three seeded runs, scored by the
   structural checks and the persona judge's relative score; in the same
   item, cut the dial prose to the plan line plus the examples and
   measure the register rows. If a vector wins a dial, it ships as a
   catalog artifact and the dial's sentence goes; if the household needs
   several companions live at once, the item after is a per-companion
   QLoRA adapter under section 11's four conditions, trained on voice
   only. Replaces: the four dial sentences, one at a time, only where
   measured. Acceptance: the bench's register rows and the household
   bench's protected rows unchanged under any voice change; prompt
   tokens per turn before and after. Stays: the example lines, the
   re-anchor, the plan. References: [57, 117, 118, 119, 120, 121, 122,
   125, 51, 53]; the spike in `docs/dev/session-c.md`.
5. **Memory in the reply (M, rides with ACT-03 and CUR-01).** The typed
   bullet rendering, the memory budget raised in measured steps, the
   `recall` move with its record id on the plan and the composed turn,
   the proactive surfacing rule for expired states and dated goals, and
   the deterministic supersede rule ahead of the 4B. Replaces: the
   prose "prefer these facts" reminder as the only instruction; the 4B
   as the sole supersede decider. Acceptance: the LongMemEval sample
   per class (abstention and knowledge-update first) against the 14 of
   35 baseline; the milestone gate's rows 1, 4 and 6 (a disclosure
   recalled by subject, an emotional moment as a dated state, a return
   the next day that does not recite); the judge-eval's knowledge-update
   case passing on the 4B. Stays: the validator, the clause contract,
   the bounded states. References: [76, 79, 82, 83, 84, 67, 77, 78, 75].
6. **The encoder grounding check, in shadow mode (S-M, after item 1).**
   LettuceDetect (or HHEM-2.1-Open on the CPU) scores every included
   evidence line against each reply sentence on the composition path
   and, in shadow, on the model path, logging its verdict beside the
   `invention` and `unrelated_recall` rule's; adopted as a second signal
   only if its false-positive rate on the guard corpus and the household
   bench is at or under the rule's. Replaces: nothing until the numbers
   say so. Acceptance: a month of shadow verdicts, precision and recall
   of each against the corrected-next-turn label. Stays: the content-word
   floor. References: [101, 102, 103, 47, 48].
7. **What stays as it is, stated so nobody spends a session on it.** The
   safety classifier, the roster and outcome checks, the protocol layer,
   the almanac compute (with a library measured against the grammar
   when convenient), the memory validator, the child band and its
   vocabulary, the register and closer lists, the plan as an external
   policy, the three-tier router, the two-call budget and the composer's
   decision table. References: sections 2.2, 2.4, 2.5 and 2.7 above.

The order puts the substrate first, the two classifiers with the
clearest evidence next, the persona bench third because it is cheap
and answers principle 6 with a measurement, memory fourth because it
rides on items already queued, and the encoder guard last because it
must earn its place in shadow.

## One page for the phone

**Is the pipeline the right shape?** Yes. Every fast, private assistant
and every 2025 to 2026 agent framework puts the decisions in code and
lets the model write. An 8B is measurably bad at the decisions you would
hand it: it calls tools when none fits (Llama 42.7 percent, Qwen3 79
percent irrelevance detection), reads emotion near chance zero-shot,
answers instead of asking, grades its own output below chance, and drifts
from a persona within eight turns.

**Where you are right.** The word lists are the correct floor and the
wrong ceiling. Rules measure at 97.6 precision and 61 recall; open-class
judgments (how someone hedges, jokes, reports, feels; whether a question
is checkable) grow a regex per phrasing forever. Nothing today reports
which rules fire, so lists only grow. The ACT-02 heads failed on data
(a 4B labeled the acts, GoEmotions is the wrong domain), not on the
idea; the literature's cheap winners are a fine-tuned small encoder on
human labels (12 to 20 ms, CPU) and, if the engine ever exposes them, a
probe on the chat model's own activations.

**What stays deterministic, and why.** Safety (a learned guard has 4 to
11 percent false positives; the floor must be testable and identical in
every house), the roster and outcome checks (set membership), consent
and confirmation, the almanac, the memory validator (stronger than
anything published; the hearsay-flattening and hallucinated-memory
papers justify it), the child band, the register and closer lists (no
detector exists), and the plan as an external policy (the shape with
human-tested gains).

**What changes, in order.**

1. A label harvest and a per-rule hit report from the turn rows; a rule
   that never fires is retired, a family that keeps growing becomes a
   classifier.
2. Human labels for the signal (the 500-turn sheet), then a small
   encoder for the residual: emotion, inform-versus-commissive, reported
   and hypothetical. Rules keep their decisions; the encoder takes the
   rest.
3. A lookup router from "which rung answered" labels, an evergreen
   feature for currency, and the model's own token probabilities as a
   second hedge signal.
4. The companion bench: control vectors trained on each companion's
   own example lines, one per dial; the dial prose cut to the plan line
   plus examples; a per-companion adapter only if several companions
   must be live at once.
5. Memory in the reply: typed bullets with category and date, a bigger
   measured budget (the strong systems use 1,300 to 1,600 tokens; we use
   about 200), a `recall` move in the plan realized as a reaction or a
   question, never a recitation, and a deterministic supersede rule
   ahead of the 4B.
6. An encoder grounding check in shadow mode, adopted only if it beats
   the rule's false-positive rate.

**Tone.** The paragraph is the weakest lever on a small model; the plan
line plus the example lines plus one measured vector per dial is the
supported shape. The persona judge is a trend line, never a gate.

**Memory.** A friend who remembers brings your past up at the right
moment (62 versus 53 percent engaging in the human study); the fix is a
typed move with a record id, a typed bullet, and a bigger slice, not a
prompt sentence asking the model to be natural.

## References

Every entry was fetched and read for this review on 2026-09-15; the
items marked `[unverified]` in the text are the ones whose specific
claim could not be confirmed from the fetched page.

1. Gendron, Guibon. Context-Aware Siamese Networks for Efficient Emotion Recognition in Conversation. LREC-COLING 2024. https://arxiv.org/pdf/2404.11141
2. Ghosal, Majumder, Mihalcea, Poria. Utterance-level Dialogue Understanding: An Empirical Study. arXiv 2020. https://arxiv.org/abs/2009.13902
3. Dai, Fu, Zhu, Cui, Li, Qi. Local Contextual Attention with Hierarchical Structure for Dialogue Act Recognition. arXiv 2020. https://arxiv.org/pdf/2003.06044
4. Feng, Sun, Lubis, Wu, Zhang, Gašić. Affect Recognition in Conversations Using Large Language Models. SIGDIAL 2024. https://aclanthology.org/2024.sigdial-1.23.pdf
5. Demszky, Movshovitz-Attias, Ko, Cowen, Nemade, Ravi. GoEmotions: A Dataset of Fine-Grained Emotions. ACL 2020. https://aclanthology.org/2020.acl-main.372/
6. Inoshita, Zhou, Kawai, Yada. LLMs Capture Emotion Labels, Not Emotion Uncertainty. arXiv 2026. https://arxiv.org/abs/2604.27345
7. Casanueva, Temčinas, Gerz, Henderson, Vulić. Efficient Intent Detection with Dual Sentence Encoders. arXiv 2020. https://arxiv.org/abs/2003.04807
8. Di Palma, De Bellis, Servedio, Anelli, Narducci, Di Noia. LLaMAs Have Feelings Too. ACL 2025. https://arxiv.org/html/2505.16491v1
9. Kovács, Verdha, Recski. RuleChef: Grounding LLM Task Knowledge in Human-Editable Rules. arXiv 2026. https://arxiv.org/pdf/2607.01293
10. Buckmann, Hill. Logistic Regression makes small LLMs strong and explainable tens-of-shot classifiers. arXiv 2024. https://arxiv.org/pdf/2408.03414
11. Desai, Durrett. Calibration of Pre-trained Transformers. EMNLP 2020. https://arxiv.org/abs/2003.07892
12. Mohammad, Bravo-Marquez, Salameh, Kiritchenko. SemEval-2018 Task 1: Affect in Tweets. SemEval 2018. https://aclanthology.org/S18-1001/
13. Park, Kim, Ye, Jeon, Park, Oh. Dimensional Emotion Detection from Categorical Emotion. arXiv 2021. https://arxiv.org/abs/1911.02499
14. Jo, Visser, Reed, Hovy. Extracting Implicitly Asserted Propositions in Argumentation. EMNLP 2020. https://arxiv.org/abs/2010.02654
15. Yang, Obadinma, Zhao, Zhang, Matwin, Zhu. SemEval-2020 Task 5: Counterfactual Recognition. SemEval 2020. https://arxiv.org/abs/2008.00563
16. Abu Farha, Oprea, Wilson, Magdy. SemEval-2022 Task 6: iSarcasmEval. SemEval 2022. https://aclanthology.org/2022.semeval-1.111/
17. Zhang, Zou, Lian, Tiwari, Qin. SarcasmBench. arXiv 2024. https://arxiv.org/abs/2408.11319
18. Dataset cards and licenses: DailyDialog https://huggingface.co/datasets/li2017dailydialog/daily_dialog; GoEmotions https://github.com/google-research/google-research/tree/master/goemotions; Taskmaster-1 https://github.com/google-research-datasets/Taskmaster/blob/master/TM-1-2019/README.md; CCPE-M https://github.com/google-research-datasets/ccpe/blob/main/README.md; EmpatheticDialogues https://raw.githubusercontent.com/facebookresearch/EmpatheticDialogues/master/LICENSE; Switchboard DAMSL https://convokit.cornell.edu/documentation/switchboard.html; ICSI https://groups.inf.ed.ac.uk/ami/icsi/download/
19. Bunk, Varshneya, Vlasov, Nichol. DIET: Lightweight Language Understanding for Dialogue Systems. arXiv 2020. https://arxiv.org/abs/2004.09936
20. OVOS Padatious pipeline plugin (marked legacy). https://github.com/OpenVoiceOS/ovos-padatious-pipeline-plugin; Leon https://github.com/leon-ai/leon; Khoj https://docs.khoj.dev/features/chat/; Open WebUI task models https://docs.openwebui.com/features/administration/task-models/; LibreChat agents https://www.librechat.ai/docs/features/agents; Letta concepts https://docs.letta.com/concepts/letta/
21. Berkeley Function Calling Leaderboard v4, data file fetched 2026-09-15. https://gorilla.cs.berkeley.edu/data_overall.csv; category definitions: Yan et al. 2024, https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html
22. Ross, Mahabaleshwarkar, Suhara. When2Call: When (not) to Call Tools. NAACL 2025. https://arxiv.org/html/2504.18851
23. Meta. Llama 3.1 model card and prompt formats. https://developer.meta.com/ai/docs/model-cards-and-prompt-formats/llama3_1/
24. LocalScore, Llama 3.1 8B Instruct Q4_K_M results by GPU. https://www.localscore.ai/model/1; method https://www.localscore.ai/about
25. Schmid. Accelerate Sentence Transformers with Hugging Face Optimum. 2022. https://www.philschmid.de/optimize-sentence-transformers
26. Home Assistant. Create a personality with AI (prefer handling commands locally). https://www.home-assistant.io/voice_control/assist_create_open_ai_personality/; 2024.12 release notes https://www.home-assistant.io/blog/2024/12/04/release-202412/; hassil https://github.com/OHF-Voice/hassil
27. OpenVoiceOS. ovos-adapt-pipeline-plugin. https://github.com/OpenVoiceOS/ovos-adapt-pipeline-plugin
28. Loukas, Stogiannidis, Malakasiotis, Vassos. Breaking the Bank with ChatGPT. 2023. https://arxiv.org/abs/2308.14634; Tunstall et al. Efficient Few-Shot Learning Without Prompts (SetFit). arXiv 2022. https://arxiv.org/abs/2209.11055
29. OpenVoiceOS. ovos-config PR 321 (Model2Vec default, 2026-09-06). https://github.com/OpenVoiceOS/ovos-config/pull/321; ovos-m2v-pipeline https://github.com/OpenVoiceOS/ovos-m2v-pipeline; MinishLab model2vec https://github.com/MinishLab/model2vec
30. Rasa. Policies (priorities) https://legacy-docs-oss.rasa.com/docs/rasa/policies/; Fallback and Human Handoff https://legacy-docs-oss.rasa.com/docs/rasa/fallback-handoff/; Rules https://legacy-docs-oss.rasa.com/docs/rasa/rules/
31. Li, Dong, Wang, Xu, Jiang, Chen. XGrammar-2. arXiv 2026. https://arxiv.org/html/2601.04426; Dong et al. XGrammar. MLSys 2025. https://arxiv.org/html/2411.15100
32. Li, Zhang, Lv. Constraint Tax in Open-Weight LLMs. arXiv 2026. https://arxiv.org/abs/2606.25605
33. Chen, Zaharia, Zou. FrugalGPT. arXiv 2023. https://arxiv.org/abs/2305.05176
34. Ong, Almahairi, Wu, Chiang, Wu, Gonzalez, Kadous, Stoica. RouteLLM: Learning to Route LLMs with Preference Data. arXiv 2024. https://arxiv.org/html/2406.18665
35. ggml-org. llama.cpp server README (cache_prompt). https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
36. ggml-org. llama.cpp function calling docs (parallel calls off by default). https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md
37. Nomic. nomic-embed-text-v1.5 model card (task prefixes). https://huggingface.co/nomic-ai/nomic-embed-text-v1.5; Nussbaum et al. Nomic Embed. arXiv 2024. https://arxiv.org/abs/2402.01613
38. Asai, Wu, Wang, Sil, Hajishirzi. Self-RAG. arXiv 2023. https://arxiv.org/abs/2310.11511
39. Jiang et al. Active Retrieval Augmented Generation (FLARE). EMNLP 2023. https://arxiv.org/abs/2305.06983
40. Su, Cardie. Knowing but Not Showing. arXiv 2026. https://arxiv.org/abs/2605.25284
41. Jeong, Baek, Cho, Hwang, Park. Adaptive-RAG. NAACL 2024. https://arxiv.org/abs/2403.14403
42. Su, Tang, Ai, Wu, Liu. DRAGIN. arXiv 2024. https://arxiv.org/abs/2403.10081
43. Wang, Li, Sun, Liu. Self-Knowledge Guided Retrieval Augmentation (SKR). arXiv 2023. https://arxiv.org/abs/2310.05002
44. Marina, Ivanov, Pletenev et al. LLM-Independent Adaptive RAG. arXiv 2025. https://arxiv.org/abs/2505.04253
45. Bansal, Agarwal. RAGRouter-Bench baseline study. arXiv 2026. https://arxiv.org/abs/2604.03455
46. Orgad et al. LLMs Know More Than They Show. arXiv 2024/2025. https://arxiv.org/abs/2410.02707
47. Tan et al. JudgeBench. ICLR 2025. https://arxiv.org/abs/2410.12784
48. Panickssery, Bowman, Feng. LLM Evaluators Recognize and Favor Their Own Generations. NeurIPS 2024. https://proceedings.neurips.cc/paper_files/paper/2024/hash/7f1f0218e45f5414c79c0679633e47bc-Abstract-Conference.html
49. Chen et al. Do LLM Evaluators Prefer Themselves for a Reason? arXiv 2025. https://arxiv.org/abs/2504.03846
50. Wataoka et al. Self-Preference Bias in LLM-as-a-Judge. NeurIPS 2024 workshop. https://arxiv.org/abs/2410.21819
51. Li et al. Measuring and Controlling Instruction (In)Stability in Language Model Dialogs. COLM 2024. https://arxiv.org/abs/2402.10962
52. Luz de Araujo et al. Persistent Personas? Role-Playing, Instruction Following, and Safety in Extended Interactions. arXiv 2025. https://arxiv.org/abs/2512.12775
53. Lu et al. The Assistant Axis. arXiv 2026. https://arxiv.org/abs/2601.10387
54. Venkit et al. Best Friends, Not Forever. arXiv 2026. https://arxiv.org/abs/2607.28818
55. Serapio-García et al. Personality Traits in Large Language Models. arXiv 2023, rev. 2025. https://arxiv.org/abs/2307.00184
56. Lee et al. TRAIT. arXiv 2024. https://arxiv.org/abs/2406.14703
57. Rimsky et al. Steering Llama 2 via Contrastive Activation Addition. ACL 2024. https://aclanthology.org/2024.acl-long.828/
58. Kumar et al. Diagnosing and Repairing Persona Collapse in LLM Advice. arXiv 2026. https://arxiv.org/abs/2607.08326
59. OpenAI. A practical guide to building agents. 2025. https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
60. Anthropic. Building effective agents. 2024. https://www.anthropic.com/research/building-effective-agents
61. LangGraph Graph API. https://docs.langchain.com/oss/python/langgraph/graph-api
62. Google ADK workflow agents. https://adk.dev/agents/workflow-agents/
63. OpenAI Agents SDK guardrails. https://openai.github.io/openai-agents-python/guardrails/
64. Packer et al. MemGPT: Towards LLMs as Operating Systems. arXiv 2023. https://arxiv.org/abs/2310.08560; Letta memory blocks https://www.letta.com/blog/memory-blocks/
65. Lin et al. Sleep-time Compute. arXiv 2025. https://arxiv.org/abs/2504.13171; Letta sleep-time agents https://docs.letta.com/guides/agents/architectures/sleeptime/
66. Chhikara, Khant, Aryan, Singh, Yadav. Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory. arXiv 2025. https://arxiv.org/html/2504.19413
67. Rasmussen, Paliychuk, Beauvais, Ryan, Chalef. Zep: A Temporal Knowledge Graph Architecture for Agent Memory. arXiv 2025. https://arxiv.org/html/2501.13956
68. Joshi. Eywa: Provenance-Grounded Long-Term Memory for AI Agents. arXiv 2026. https://arxiv.org/abs/2605.30771
69. Petrov et al. From Unstructured Recall to Schema-Grounded Memory. arXiv 2026. https://arxiv.org/abs/2604.27906
70. Zep. Is Mem0 Really SOTA? 2025. https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
71. Letta. Is a Filesystem All You Need? 2025. https://www.letta.com/blog/benchmarking-ai-agent-memory/
72. Maharana et al. Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo). ACL 2024. https://aclanthology.org/2024.acl-long.747/
73. Wu et al. LongMemEval. ICLR 2025. https://arxiv.org/abs/2410.10813
74. Panthi, Abdelfattah. Same Ranking, Different Winner. arXiv 2026. https://arxiv.org/abs/2605.24060
75. Kang et al. MemReader. arXiv 2026. https://arxiv.org/html/2604.07877v2
76. Xu, Szlam, Weston. Beyond Goldfish Memory: Long-Term Open-Domain Conversation. ACL 2022. https://aclanthology.org/2022.acl-long.356/
77. Chen et al. HaluMem: Evaluating Hallucinations in Memory Systems of Agents. arXiv 2025/2026. https://arxiv.org/html/2511.03506
78. Kwon. Manufactured Confidence: How Memory Consolidation Turns Hearsay into Confident Facts. arXiv 2026. https://arxiv.org/html/2606.29279
79. Ha et al. MemGuard. arXiv 2026. https://arxiv.org/abs/2605.28009
80. Zhong, Guo, Gao, Ye, Wang. MemoryBank. AAAI 2024. https://arxiv.org/abs/2305.10250
81. Wu et al. LifeSide. arXiv 2026. https://arxiv.org/abs/2606.04660
82. Liu et al. Lost in the Middle: How Language Models Use Long Contexts. TACL 2024. https://aclanthology.org/2024.tacl-1.9/
83. Borro et al. Memori. arXiv 2026. https://arxiv.org/abs/2603.19935
84. Wu et al. Interpersonal Memory Matters. arXiv 2025. https://arxiv.org/abs/2503.05150
85. Amazon. Personalize Your Alexa Experience with Voice Profiles. 2019. https://developer.amazon.com/en-US/blogs/alexa/alexa-skills-kit/2019/10/recognize-voices-and-personalize-your-skills
86. Google. Set up and manage Voice Match. https://support.google.com/googlenest/answer/7342711?hl=en
87. Al-Ratrout et al. AFA: Identity-Aware Memory for Preventing Persona Confusion in Multi-User Dialogue. arXiv 2026. https://arxiv.org/abs/2604.25022
88. Kossen, Han, Razzak, Schut, Malik, Gal. Semantic Entropy Probes. arXiv 2024. https://arxiv.org/abs/2406.15927
89. Chuang et al. Lookback Lens. EMNLP 2024. https://arxiv.org/abs/2407.07071
90. Aiersilan. Single-probe hallucination detection on 4-bit Llama-3.1-8B, Mistral-7B and Qwen2.5-7B. arXiv 2026. https://arxiv.org/abs/2606.02628
91. Kirichenko, Ibrahim, Chaudhuri, Bell. AbstentionBench. arXiv 2025. https://arxiv.org/abs/2506.09038
92. Wagner. Two Axes of LLM Abstention. arXiv 2026. https://arxiv.org/abs/2607.08456
93. Bang et al. HalluLens. arXiv 2025. https://arxiv.org/abs/2504.17550
94. Vu et al. FreshLLMs. arXiv 2023. https://arxiv.org/abs/2310.03214
95. Pletenev et al. EverGreenQA. arXiv 2025. https://arxiv.org/abs/2505.21115
96. Open WebUI discussion 19998 https://github.com/open-webui/open-webui/discussions/19998; Khoj online search https://docs.khoj.dev/features/online_search/; Perplexica architecture https://github.com/ItzCrazyKns/Perplexica/blob/master/docs/architecture/WORKING.md; LibreChat web search https://www.librechat.ai/docs/features/web_search; Letta v1 agent https://www.letta.com/blog/letta-v1-agent/; LlamaIndex routers https://developers.llamaindex.ai/python/framework/module_guides/querying/router/; LangGraph agentic RAG https://docs.langchain.com/oss/python/langgraph/agentic-rag
97. Meta. Llama Guard 3-8B model card. https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Guard3/8B/MODEL_CARD.md; Han et al. WildGuard. NeurIPS 2024. https://arxiv.org/abs/2406.18495
98. Padhi et al. Granite Guardian. arXiv 2024. https://arxiv.org/abs/2412.07724; 8B card https://huggingface.co/ibm-granite/granite-guardian-3.0-8b
99. Meta. Llama Guard 3-1B model card. https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Guard3/1B/MODEL_CARD.md; Shahin, Alsmadi. Benchmarking LLAMA Model Security Against OWASP Top 10. arXiv 2026. https://arxiv.org/abs/2601.19970
100. Meta. Llama Prompt Guard 2 model card. https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Prompt-Guard-2/86M/MODEL_CARD.md
101. Tang, Laban, Durrett. MiniCheck: Efficient Fact-Checking of LLMs on Grounding Documents. EMNLP 2024. https://arxiv.org/abs/2404.10774; leaderboard https://llm-aggrefact.github.io/
102. Kovács, Recski. LettuceDetect: A Hallucination Detection Framework for RAG Applications. arXiv 2025. https://arxiv.org/abs/2502.17125
103. Vectara. HHEM-2.1-Open model card. https://huggingface.co/vectara/hallucination_evaluation_model
104. Bespoke Labs. Bespoke-MiniCheck-7B (CC BY-NC 4.0). https://huggingface.co/bespokelabs/Bespoke-MiniCheck-7B
105. Tam et al. Let Me Speak Freely? EMNLP 2024 Industry. https://aclanthology.org/2024.emnlp-industry.91/
106. Kurt. Say What You Mean: A Response to "Let Me Speak Freely". dottxt 2024. https://blog.dottxt.ai/say-what-you-mean.html
107. ggml-org. llama.cpp grammars README. https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md; Willard, Louf. Efficient Guided Generation for Large Language Models (Outlines). arXiv 2023. https://arxiv.org/abs/2307.09702
108. NVIDIA NeMo Guardrails, output rail streaming. https://docs.nvidia.com/nemo/guardrails/configure-guardrails/yaml-schema/streaming/output-rail-streaming; Guardrails AI streaming https://guardrailsai.com/guardrails/docs/concepts/streaming
109. Yu et al. SentGuard: Sentence-Level Streaming Guardrails for Large Language Models. arXiv 2026. https://arxiv.org/abs/2606.02041
110. Scunthorpe problem. https://en.wikipedia.org/wiki/Scunthorpe_problem
111. Surge AI. Are popular toxicity models simply profanity detectors? https://surgehq.ai/blog/are-popular-toxicity-models-simply-profanity-detectors; Hartmann et al. Bye Bye Perspective API. arXiv 2026. https://arxiv.org/abs/2604.25580
112. Microsoft Presidio. https://github.com/microsoft/presidio; Jha. PIIBench. arXiv 2026. https://arxiv.org/abs/2604.15776
113. Chen et al. Stop DDoS Attacking the Research Community with AI-Generated Survey Papers. arXiv 2025. https://arxiv.org/abs/2510.09686
114. Okulska et al. Mirror, Mirror on the Wall: Prompt Echoing in Small Instruct Language Models. EMNLP 2026. https://arxiv.org/abs/2609.15045
115. p-e-w. DRY: A modern repetition penalty that reliably prevents looping. text-generation-webui PR 5677, 2024. https://github.com/oobabooga/text-generation-webui/pull/5677; llama.cpp PR 9702 https://github.com/ggml-org/llama.cpp/pull/9702
116. Zheng et al. When A Helpful Assistant Is Not Really Helpful. Findings of EMNLP 2024. https://arxiv.org/abs/2311.10054
117. Chen et al. Persona Vectors. Anthropic, arXiv 2025. https://arxiv.org/abs/2507.21509
118. Tan et al. Analysing the Generalisation and Reliability of Steering Vectors. NeurIPS 2024. https://arxiv.org/abs/2407.12404
119. Braun et al. Understanding (Un)Reliability of Steering Vectors. ICLR 2025 workshop. https://arxiv.org/abs/2505.22637
120. ggml-org. llama.cpp control vectors, PR 5970 (2024-03-15). https://github.com/ggml-org/llama.cpp/pull/5970; vgel. repeng. https://github.com/vgel/repeng
121. Chen et al. Punica: Multi-Tenant LoRA Serving. arXiv 2023. https://arxiv.org/abs/2310.18547; vLLM LoRA docs https://docs.vllm.ai/en/latest/features/lora/
122. Dettmers et al. QLoRA. arXiv 2023. https://arxiv.org/abs/2305.14314
123. Shao et al. Character-LLM. EMNLP 2023. https://aclanthology.org/2023.emnlp-main.814/
124. Lu et al. Ditto: Large Language Models Are Superhuman Role-Play Learners. arXiv 2024. https://arxiv.org/abs/2401.12474
125. Ibrahim et al. Training language models to be warm and empathetic makes them less reliable and more sycophantic. arXiv 2025. https://arxiv.org/abs/2507.21919
126. Tu et al. CharacterEval. ACL 2024. https://aclanthology.org/2024.acl-long.638/
127. Samuel et al. PersonaGym. arXiv 2024. https://arxiv.org/abs/2407.18416
128. Kim et al. Prometheus 2. EMNLP 2024. https://arxiv.org/abs/2405.01535
129. Zhou et al. PersonaEval. COLM 2025. https://arxiv.org/abs/2508.10014
130. Thakur et al. Judging the Judges. arXiv 2024. https://arxiv.org/abs/2406.12624
131. Zhou et al. IFEval. arXiv 2023. https://arxiv.org/abs/2311.07911; Meta Llama 3.1 model card https://github.com/meta-llama/llama-models/blob/main/models/llama3_1/MODEL_CARD.md
132. Qwen Team. Qwen3 Technical Report. arXiv 2025. https://arxiv.org/html/2505.09388
133. Jiang et al. FollowBench. arXiv 2023. https://arxiv.org/html/2310.20410
134. Yuan et al. Following Length Constraints in Instructions. arXiv 2024. https://arxiv.org/html/2406.17744
135. Liu et al. Towards Emotional Support Dialog Systems (ESConv). ACL 2021. https://aclanthology.org/2021.acl-long.269/
136. Meta AI. CICERO. 2022. https://ai.meta.com/blog/cicero-ai-negotiates-persuades-and-cooperates-with-people/
137. Zhang, Jaitly. SAGE. Apple, NLPerspectives 2025. https://aclanthology.org/2025.nlperspectives-1.11.pdf
138. Zhou, Gao, Li, Shum. The Design and Implementation of XiaoIce, an Empathetic Social Chatbot. Computational Linguistics 46(1), 2020. https://aclanthology.org/2020.cl-1.2/
139. Character.AI. Prompt Design at Character.AI. 2024. https://blog.character.ai/prompt-design-at-character-ai/
140. Anthropic. Claude's Character. 2024. https://www.anthropic.com/research/claude-character
141. Zinkevich. Rules of Machine Learning. Google. https://developers.google.com/machine-learning/guides/rules-of-ml
142. Nichol. 5 Levels of Conversational AI: 2020 Update. Rasa. https://rasa.com/blog/5-levels-of-conversational-ai-2020-update
143. Rasa. Conversation-Driven Development. 2020. https://rasa.com/blog/conversation-driven-development-a-better-approach-to-building-ai-assistants/
144. Sculley et al. Hidden Technical Debt in Machine Learning Systems. NeurIPS 2015. https://proceedings.neurips.cc/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html
145. Welbl et al. Challenges in Detoxifying Language Models. Findings of EMNLP 2021. https://arxiv.org/abs/2109.07445
146. Sclar, Choi, Tsvetkov, Suhr. Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design. ICLR 2024. https://arxiv.org/abs/2310.11324
147. Atil et al. Non-Determinism of "Deterministic" LLM Settings. arXiv 2024. https://arxiv.org/abs/2408.04667
148. He. Defeating Nondeterminism in LLM Inference. Thinking Machines, 2025. https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
149. Chen, Zaharia, Zou. How is ChatGPT's behavior changing over time? arXiv 2023. https://arxiv.org/abs/2307.09009
150. Xiong et al. Can LLMs Express Their Uncertainty? ICLR 2024. https://arxiv.org/abs/2306.13063
151. Kadavath et al. Language Models (Mostly) Know What They Know. arXiv 2022. https://arxiv.org/abs/2207.05221
152. Atreja et al. Pioneer Agent: Continual Improvement of Small Language Models in Production. arXiv 2026. https://arxiv.org/abs/2604.09791
153. Anthropic. Develop tests (define success criteria). https://platform.claude.com/docs/en/test-and-evaluate/develop-tests
154. OpenAI. Evals guide. https://developers.openai.com/api/docs/guides/evals
155. Husain. Your AI Product Needs Evals. 2024. https://hamel.dev/blog/posts/evals/
156. Langfuse. LLM regression testing. https://langfuse.com/resources/engineering/llm-regression-testing
157. Facebook. duckling. https://github.com/facebook/duckling; wanasit. chrono. https://github.com/wanasit/chrono
158. Zhang, Bakhturina, Gorman, Ginsburg. NeMo Inverse Text Normalization. arXiv 2021. https://arxiv.org/abs/2104.05055
159. Rajgarhia et al. An Evaluation Study of Hybrid Methods for Multilingual PII Detection. arXiv 2025. https://arxiv.org/pdf/2510.07551
