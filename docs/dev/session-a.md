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
