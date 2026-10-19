# Factual references and the CSAM output floor, 2026-10-19

Investigation only. This note does not change the safety rule or classifier.
Only Jesse changes the safety rules.

## What happened on the Taxi Driver turn

Turn `turn-397hbv00my` was stopped by the adult written-chat output gate after
the model began a factual plot summary. The refusal category recorded was
`csam`. The user-reported excerpt says that the plot involved Iris, an
underage prostitute. The stream gate checks generated text as it arrives;
already released text stays visible, and the first refusing sentence ends the
stream. The gate also checks the accumulated released text with the next span,
so a signal split across sentence boundaries can refuse.

There is no classifier prompt. This is a deterministic text classifier, not a
model safety prompt. `backend/src/lib/contentCeiling.ts` includes `csam` in the
floor for every band and cannot configure it away. `backend/src/lib/safety.ts`
calls the pinned spec classifier through `evaluateSafety()` and changes a
flagged floor category to refusal for output. `backend/src/lib/turnMachine/
nodes/outputGate.ts` calls that same function in both the sentence and arrival
paths. An adult written turn uses arrival checks; children, spoken turns and
the default teen path use sentence checks.

The pinned classifier is in
`backend/node_modules/@maipai/spec/safety/ts/signals.ts`. Its CSAM detector
first refuses a closed set of standalone terms and phrases. Otherwise it
refuses when a minor indicator and a sexual indicator both match. The lists
include age terms such as `underage`, `minor`, `child` and `young girl`, and
sexual terms such as `sex`, `sexual`, `nude`, `porn`, `erotic`, `molest` and
others. `fold.ts` normalizes separators, obfuscation and selected look-alike
letters before matching. There is no factual, historical, fictional or
encyclopedic framing exception. The current corpus explicitly says academic
or fiction framing is detected but does not lower the action.

The supplied excerpt alone does not identify which exact matched signal was
recorded, and the turn's matched-signals field was not provided. The likely
path is an age indicator in the same checked sentence or accumulated span as
a sexual-list match. That is an inference, not a confirmed replay. A replay
with the exact generated text and the pinned spec revision is needed to name
the exact signals. Do not infer that `prostitute` itself is a configured
sexual term from this excerpt.

## Options for review

Every option below must keep the absolute line intact: no sexual content
involving minors, including non-explicit framing that becomes a depiction or
sexualization. None should let a setting, speaker request or factual label
override a definite depiction, explicit detail, sexual request or standalone
CSAM-coded term.

### 1. Add a narrowly defined factual-reference context to classification

Pass structured provenance from a trusted factual source or a clearly
identified plot/history lookup into a separate classifier decision. Allow
only neutral, minimal references that identify exploitation or a historical
fact without describing sexual conduct, bodies, or sexualized characteristics.
Keep standalone terms and explicit or depictive spans as hard refusals. The
context must be created by the lookup path, never by the model's prose or its
claim that an answer is factual.

Tests needed: factual plot and history summaries with neutral references;
explicit, eroticized and instructional versions that still refuse; a model
claim of "for research" without trusted provenance that still refuses;
cross-sentence, obfuscated and multi-signal absolute-line cases; identical
adult, teen, child and spoken floor checks.

Risk: a source or provenance bug could create an allow path for model-written
content. Even tightly scoped neutral terms can sound like a depiction in
context, and the distinction may not survive summarization.

### 2. Separate a non-depictive exploitation signal from sexual depiction

Retain the current absolute CSAM detector unchanged. Add an independent
signal for factual references to exploitation, and only let it affect copy or
review when no existing hard signal matches. This can make the false-positive
case visible without granting an exemption. A later owner decision could
consider a separate non-refusal treatment, but this option alone does not
change the gate action.

Tests needed: the Taxi Driver excerpt and other non-depictive reports must
show the new signal; all current CSAM corpus positives must keep their same
refusal; the new signal alone must not change `action`; test all stream grains
and sentence-boundary combinations.

Risk: it improves diagnosis and copy but does not stop this false positive.
The secondary label could also be mistaken for a safe classification in
logs or review tools.

### 3. Add a bounded semantic second opinion that can only increase blocking

Keep the deterministic floor authoritative. A local semantic checker could
identify whether a checked span is an encyclopedic reference or a depiction,
but its result may only add a refusal or diagnostic label. It cannot suppress
a deterministic refusal. This can measure the distinction before any rule
change and produce examples for a future owner review.

Tests needed: scripted local checker outputs for factual, ambiguous and
depictive spans; prove a "factual" result never overrides `csam`; checker
unavailable, timeout and malformed outputs fail closed; stream tests prove no
released content is retracted and the next sentence stops when either checker
refuses.

Risk: it cannot reduce false positives while it is only additive, adds model
latency and another failure mode, and may provide inconsistent labels across
models. A later suppressive use would need a separate owner decision and a
large adversarial test set.

## Code references

- `backend/src/lib/contentCeiling.ts`: immutable `csam` floor membership.
- `backend/src/lib/safety.ts`: output action mapping and call into the spec.
- `backend/src/lib/turnMachine/nodes/outputGate.ts`: streamed output checks.
- `backend/node_modules/@maipai/spec/safety/ts/classifier.ts` and
  `signals.ts`: deterministic category assembly and CSAM matching.
- `backend/node_modules/@maipai/spec/safety/corpus/corpus.json`: labelled
  conformance examples, including framing and obfuscation cases.
