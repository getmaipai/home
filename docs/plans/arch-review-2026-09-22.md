# Independent architecture review of the four ARCH rows, 2026-09-22

A read-only review by a separate session of the ARCH rows (ARCH-AGENT-01,
ARCH-MEM-01, ARCH-LAYERS-01, ARCH-POLICY-01, ARCH-BUILD-01), RESP-01 to
RESP-04, DECISIONS.md and `turnEngine.ts`, with every claim checked against
the code. It is input to the four design records, which have not been
written yet. The owner decides which findings amend which row; until then
the rows stand as written and this file is the counter-case they must answer.

## Why this file exists

The four ARCH rows were written from industry patterns and two adversarial
rounds. Each was checked against the code in places; this review checked
every cited line, and names where the row and the code disagree. Where it found the rows describing code that
does not exist, or missing code that does, the record should be corrected
before any design is built on it.

## The three most consequential findings

**1. ARCH-AGENT-01 keys the architecture on the wrong variable.** The class
table uses the Stack governor's memory tiers (`governor.ts:20-23`), which say
how much RAM the box has, not what the loaded chat model can do. The p32 row
("7B to 14B runs the agent-capable architecture with a one-round budget") is
the configuration the 2026-09-16 review measured as unfit: an 8B detects "no
tool fits" 42.7 to 79.1 percent of the time. The hub's chat role is an 8B
today (`modelCatalog.ts:31`). The model is already the decider for lookups on
every turn: websearch is always-offered (`turnEngine.ts:491`, `:3287`) and
rides the same completion as the answer (`:4613-4623`), so the loop adds a
second and third round that no recorded turn needed. **Instead:** keep the
shape that runs now (safety, a properties-admitted fast path, one completion
with tools), add the deterministic action-plan executor for side effects,
make the capability budget a per-model measured number from the existing
tool-calling bench (`llm.ts:252-256`) stored with the model in the catalog,
add a second round only when a bench row needs it, and keep the offered tool
set stable per model so the prefix cache survives.

**2. ARCH-POLICY-01's ingress boundary is right and unbuildable as specified.**
It needs every context item to carry provenance and subject to the prompt,
but the prompt is assembled as strings under character budgets
(`turnEngine.ts:914`); the typed evidence kinds (`turnContext.ts:65`) serve
the guards, not the pipeline. It needs entity resolution, which the memory
judge does not produce. And discretion by presence exists only on the robot:
`sensitiveAllowed` returns true for every other surface
(`turnContext.ts:54-60`), so a TV shows a parent's sensitive memories with
children in the room, and RESP-03's "the wire needs nothing new" is wrong.
**Instead:** one `ContextItem` type (text, source channel, subject ids,
disclosure) as the only thing the prompt is built from, the boundary as a
pure filter over that list, and presence as a turn input on every surface.

**3. The response contract cannot be delivered by RESP-01 as written.** The
typed-screen cap is not in `persona.ts`: `planFor` limits a question to 60
words and two sentences (`register.ts:47-49`), and both generation paths set
`max_tokens` from it (`turnEngine.ts:4622`, `:6115`). "Shorter" is described
as honored for a few turns, but `setReplyConstraint` writes a row with no
expiry that `constraintsFor` reads forever (`replyConstraints.ts:46-56`).
ARCH-LAYERS-01's new response-plan object duplicates the spec's existing
`reply-plan.json`. **Instead:** extend the existing ReplyPlan with the fact
classes and a surface-derived budget, derive `max_words` from surface and
evidence rather than the act table, give constraints a turn-count decay, and
make the plan the only place length is decided.

## Per question

**Turn engine.** What breaks first as tools grow is the prefix cache, not
accuracy: the prefix is stable (`turnEngine.ts:884`) but the offered tool set
varies per turn (top three over a 0.68 floor plus always-offer, `:1117`,
`:3447`), and chat templates render tools before the conversation. This is a
hypothesis until llama-server's cached versus evaluated prompt-token counts
are read on two consecutive turns with different offers. Second to break: the
single pending-ask slot per conversation (`conversationHistory.ts:904`); an
action plan with two confirmations has nowhere to live.

**Memory.** The four-subsystem split is a taxonomy; the real seams are what
is held true now, what happened, and what the person asked to keep. Gap three
is wrong as written: entity match is already a deterministic override in
ranking (`memory.ts:373-392`, `:680-704`). The "told me about his monitor"
case fails because the judge never creates entity records, not for lack of a
tool. Keep the absence of a memory-search tool until CUR-01 lands. The
unmentioned gap is the budget: five snippets and 800 characters
(`turnEngine.ts:580`, `:584`) against the 1,300 to 1,600 tokens the
2026-09-16 review says strong systems inject.

**Personality and modality.** The separation already leaks: the reply plan
mixes companion engagement with the act's length table (`register.ts:70-75`).
"Personality stays downstream, it phrases" is false in a single-generation
design; personality is an input to that generation. Making it orthogonal
means a decoding-time property (control vector or adapter, the 2026-09-16
review's item 4, which ARCH-LAYERS-01 dropped), with prose only as fallback.

**Policy and safety.** Real by construction: the output gate inside
`bareCompletion.ts:11-18`, and the retrieval filter before the prompt
(`memory.ts:62`). Ceremony: `llm.ts` exports the raw stream to any importer,
so "no exported way to get ungated tokens" covers one function, not the
system; the wake-word invariants exist only as prose, not in SAFETY.md, the
settings registry or code; and the safety floor is 494 lines of English regex
(`commons/spec/safety/ts/signals.ts`), which locks it to hand-kept
per-language lists. Non-removable is the invariant; regex is an
implementation.

## Everything else

Principle 6 misses: ARCH-BUILD-01's "tiny in-house TurnGraph" option is a
hand-built state machine where XState v5 is the maintained answer (runs on
Bun, no telemetry) and is not in the spike's list; sentence splitting is a
regex (`guards.ts:2286`) where `Intl.Segmenter` ships in the runtime; name
resolution is 1,084 hand-rolled lines (`unknownNames.ts`); the "cheap scorer"
reranker is an ONNX cross-encoder, not something to write.

Contradictions in the record: the 2026-09-16 review keeps the three-tier
router while ARCH-AGENT-01 retires it, both cited as live; the 8B numbers
versus the p32 row; the temporary-chat "no row" ruling had two uninventoried
writers, `setReplyConstraint` (`turnEngine.ts:2813`) and `queueOpenQuestion`
(`:2083`, `:2146`), where only `setPendingAsk` checks
(`conversationHistory.ts:906`), plus an artifacts foreign key on the
provisional turn row that `write_document` needs (TEMP-CHAT-01's acceptance
is widened to all of them);
"the model phrases, it does not judge" is now true only of policy; the
vendoring rule versus four pending-patch rows at "PR not yet opened"
(`dev.md`, the pending-patches table); the wake-word ruling cites SAFETY.md,
which has no wake-word text.

Expensive to reverse: a conversation belongs to one person (the conversation
schema requires `person`, `additionalProperties: false`); the English-only
hand-ported safety floor (one artifact both machines run, a WASM build or an
ONNX head behind the regex, serves "identical in every house" better); the
per-turn memory judge that CUR-01 will reverse; per-conversation state with no
spec home (PERSIST-CONV-01), so the in-process temporary-chat window dies on
restart and never reaches a paired robot; the hardware class is per machine
while the memory and policy rows treat it as per household; the single turn
lease and one engine slot, still open since the 2026-09-12 review, when two
children need to talk at once.

Motivated reasoning: ROUTE-FIND-03's two failures are cited as the ladder's
predicted failure mode, but they are a fast-path admission bug and a guard,
which the row's own "admit by properties" amendment fixes without a loop; the
loop is justified by two failures the fast-path fix resolves. "The controls are exactly ChatGPT's because ChatGPT has
none" is imitation, not derivation (the derivable rule is "no control whose
effect the plan already computes"); "we already hold four of the five pieces"
rests on manifest descriptions written as store copy (`turnEngine.ts:1209`),
not for a model to choose by; the 2026-09-07 incident ran with a 0.45 floor,
a separate call and temperature 0.8, all since fixed, so tool invention as a
function of model size is unmeasured on the fixed pipeline; "sized by
hardware class, checked" cites a memory tier.

Right as designed: safety before routing with the crisis state clearing
pending lookups; the credential line before the lease; the action-plan
executor; the retrieval filter before the prompt; the response plan built
before generation; Cedar as evaluator only; Home Assistant as the device
runtime; the "no row" instinct for temporary chats.

## What settles the rest

Three measurements, before ARCH-AGENT-01's record starts: the tool-calling
bench per model on the fixed pipeline (irrelevance detection at 10 repeats),
the prefix-cache hit counts across turns with varying offers, and the routing
corpus decision table ARCH-AGENT-01 already asks for.
