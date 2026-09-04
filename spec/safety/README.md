# The safety layer

Platform plan 4.3: a deterministic multi-signal classifier that runs
before any model and again on every streamed sentence, with no model in
the loop for the floor, on the hub and (independently) on the robot. This
directory holds the language-portable design and the labelled corpus;
`backend/src/lib/safety.ts` in the hub wraps it with the per-band policy
and (eventually) notification delivery.

## Scope of this pass

Text only. Image and video guards (the CSAM guard and identifiable-real-
people rules 4.3 also requires on the core generation ports) are deferred
until those ports exist (4.11, a later hub release): there is nothing to
guard yet.

**TS only, for now.** The classifier (`ts/classifier.ts`, `ts/signals.ts`)
is written to stay language-portable (plain string/regex matching, no
TS-only tricks) so a Python port slots in the same way
`interpreters/py/recipe_interpreter.py` mirrors
`interpreters/ts/recipe-interpreter.ts`, with conformance fixtures proving
the two agree. That port is Robot v0.1 work (platform plan chapter 13);
`bot` has no real content yet in this repo's history (see
`docs/dev.md`), so there is nothing to pin it to today. Building it now
would be logic with no consumer.

**Eight categories, per 4.3:** `self_harm`, `harmful_request`,
`credible_threat`, `csam`, `grooming`, `pii_extraction`,
`prompt_injection`, `jailbreak`. Each has its own detector in
`ts/signals.ts`.

## Design: why multi-signal, and what that means concretely

4.3 asks for a "deterministic multi-signal classifier", not a keyword
list. In this implementation that means: a category flags only when an
independent second signal corroborates the first, not on one loose match.
Concretely:

- `harmful_request` requires a dangerous-topic phrase **and** a separate
  actionable-instruction phrase ("how do I make", "step by step
  instructions"). A bare mention of a topic (a history question, a news
  reference) never flags alone.
- `credible_threat` requires a direct first-person threat verb with a
  target **and** either a weapon/method mention or an explicit plan
  marker (a time, "I have a plan"). This is what separates "I'm going to
  hurt her tomorrow" from "I'll kill you if you eat my leftovers again":
  the second has no method or plan signal.
- `pii_extraction` requires a sensitive-data noun **and** a third-party
  possessive construction ("Marlow's social security number"), so a
  person asking about their own data never flags.
- `self_harm` and `credible_threat` both carry an idiom backstop
  (`SELF_HARM_IDIOMS` in `ts/signals.ts`): common hyperbole ("kill me
  now", "dying of laughter") is worded so it doesn't match the direct
  patterns in the first place, and the idiom list is there as a second
  line of defense, tested in `spec/tests/ts/safety.test.ts`.

## Academic and fictional framing: detected, never a bypass

4.3 asks the classifier to distinguish "harmful requests versus academic
or fiction framing." This implementation detects that framing
(`harmful_request.academic_framing_present` in `matched_signals`) but
**does not let it downgrade the action**. `harmful_request` and `csam` are
part of the floor, and CLAUDE.md > Safety invariants is explicit: no
framing, setting, or admin override may weaken a non-removable protection.
`corpus.json`'s `harmful_request.academic_framing_still_refuses` entry is
the test that proves this.

## csam: adapted from the legacy hub's hardened blocklist

`detectCsam` (`ts/signals.ts`) is not written from scratch: it's adapted
from the legacy hub's `lib/safety/csamGuard.ts` `screenPrompt()`, which is
exactly principle 8's carve-out (hard-won logic, not feature scope or UI).
Two things worth knowing if you touch it:

- **Obfuscation resistance.** Text is NFKD-normalized and separator
  characters (spaces, dots, underscores, hyphens, asterisks) are both
  collapsed to a single space (`compact`, for multi-word phrases like
  "school girl") and stripped entirely (`tight`, so "l.o.l.i" and
  "l-o-l-i" both reduce to "loli"). `corpus.json`'s `csam.obfuscation.*`
  entries prove both forms actually catch something a naive `\b...\b`
  regex would miss.
- **A standalone-term list blocks regardless of context** (CSAM-coded
  terms that need no co-occurring sexual/age signal), separate from the
  minor-indicator-plus-sexual-term intersection the other detectors use.

The legacy file is honest about its own limits ("a blocklist is evadable
... responsible defense in depth ... not a guarantee"); that caveat
carries over unchanged, see Known limitations below. The legacy file's
`screenImage()` (a two-pass VLM confirmation before flagging a generated
image, requiring both passes to agree before acting on a single flag) is
a pattern worth reusing when image/video guards get built (4.11); not
built here since there's no generation port yet.

**Explicitly not carried over:** the legacy hub's `lib/safety/textFloor.ts`
prepended an "absolute limits" paragraph to every LLM system prompt and
trusted the model to honor it. That's the opposite of what 4.3 asks for
("no model in the loop for the floor") and exactly the design this
platform rebuild exists to move away from; nothing here reuses it.

## The floor's action per category

Every category except `self_harm` maps to `refuse` when flagged.
`self_harm` never blocks: it maps to `allow_with_resources` (crisis
resources offered alongside the reply, never instead of it), per
CLAUDE.md > Safety invariants: "Crisis resources: offer, never block...
not configurable off." This holds for every role including the household
owner; nothing a package declares can lower it either (4.3).

`notify_parent` is true whenever a category flags and the speaker is a
minor (4.3: "Safety-flagged turns raise an immediate notification to a
parent for minors"). This field only carries the fact
(`SafetyResult` never includes the checked text or a verbatim excerpt,
see `spec/schemas/safety-result.schema.json`); actual delivery through the
notification system (2.6) is a later hub release, so today a caller can
only log or stub this, not page anyone. See `backend/src/lib/safety.ts`.

## Known limitations (read before extending)

This is a first-pass deterministic baseline, not a claim of production-
grade coverage, and CLAUDE.md's wake-word training lesson applies here
too: "harvest the real failures and train on those." Specific gaps worth
knowing about before trusting this in a real household:

- `csam` is a term-intersection blocklist (adapted from the legacy hub's
  hardened, obfuscation-resistant guard, see above), still deliberately
  biased toward over-flagging ambiguous cases (a parenting question that
  happens to combine a sexual-content word with a child's age) rather than
  under-flagging, since a false refuse is a far smaller harm than a false
  allow in this one category. A blocklist, however hardened, is still
  evadable by phrasing its author didn't anticipate; the legacy file's own
  words apply unchanged: "responsible defense in depth... not a
  guarantee."
- `grooming`'s pattern list is small and literal; it will miss anything
  phrased differently, and a phrase like "keep this between us" can
  false-positive on an innocent shared secret (a surprise party, a school
  project) said to a minor. Not included in the corpus as a "should not
  flag" case for exactly that reason: it currently does flag, and that's
  the safer failure mode for now.
- None of the eight detectors have been run against adversarial paraphrase
  or non-English input. The bypass-suite entries in `corpus.json`
  (`bypass_suite.*`) cover only the injection/jailbreak framings named
  explicitly in 4.3's example list, not an exhaustive attack surface.
- No small local model "second opinion" for adults (4.3 allows one) is
  wired up; this is the deterministic floor only.

## Testing

`spec/tests/ts/safety.test.ts` runs every entry in `corpus/corpus.json`
through `checkSafety`, plus a handful of invariant tests (self-harm never
refuses, csam framing never bypasses, grooming is speaker-scoped,
`matched_signals` never leaks the checked text). Runs from `home`'s
`scripts/check.sh` via `spec`'s `bun test`, same as every other spec test.
