# The chat true-up: what stays because it was designed, what goes because it was not (2026-09-23)

Owner's rule, 2026-09-23 evening: the chat system is layers designed by
Fable and Astra and nothing else. Anything in the new path without a
design behind it comes out, and a mis-designed piece is rebuilt, never
patched (no second-pass rewrite). Amended the same evening: the
designed prose fallback is kept as an option and offered per tier once
the primary has been tested.

This record is the ARCH-BUILD-01 verdict table the coordinator owed. It
was made from a read-only inventory of the new path (118 components
across `backend/src/lib/turnMachine/`, `persona.ts`, `register.ts`,
`memoryFraming.ts`, `surfaceClass.ts`, `ruleNames.ts`, the prompt half of
`turnEngine.ts`; about 3,900 lines) checked against the designs: the
build plan (`simple-turn-pipeline-2026-09-22.md`), the state record
(`turn-machine-state-record-2026-09-22.md`), Astra's review
(`arch-review-2026-09-22.md`), ARCH-LAYERS-01 (BACKLOG, with its
adversarial amendment), and the dated rulings in `dev.md`.

## The verdict on the machine: designed, stays

Every node (`safety`, `commands`, `context`, `model`, `policy`, `tool`,
`answer`, `output_gate`), every transition guard (the state record's
"transition table, once"), the budget and deadline rules (U2), the trace
(U2b), the grounding checks (GROUND-01 and the 2a28e4e8 ruling), the
forced call and its recoveries (FORCED-CALL-01, ENGINE-CONTRACT-02 and
-03), the failure lines (DEADLINE-01, COMMAND-FAIL-01), the opener
gating (OPENER-01), the reasoning gates ("Reasoning is a second
output"), the reply plan and its tables (RESP-01, ARCH-LAYERS-01, the
reply floor) and the memory framing (CONTEXT-RECALL-01) each cite the
design that put them there. Nothing in this half is removed.

## The verdict on the prose: the table

"Prose" is any sentence the new path sends to the model. The design for
prose is: the identity, the privacy promise, the facts (window, memories,
profile, roster, clock), the plan line (ARCH-LAYERS-01's response plan
before generation), and the persona as dimensions plus examples
(ARCH-LAYERS-01) delivered by a decoding-time property, prose only as
its fallback (Astra 2026-09-22; the 2026-09-16 review's item 4). The
owner's floor rule (state record, "The reply floor") is the test any
prose must pass: it may change tone, never substance, structure or
usefulness.

| Prose component | Where | Design behind it | Verdict |
|---|---|---|---|
| `identityLine` | `turnEngine.ts:588` | U1, U4b (the stable prefix opens with identity) | stays |
| `STABLE_SYSTEM_SUFFIX_SENTENCES` sentence 0, "Be warm, concise and honest. Nothing you say leaves this house." | `turnEngine.ts:598` | the privacy promise is the product; "concise" contradicts the floor rule | **the privacy sentence stays, the rest of the sentence goes** |
| the safety-blocked sentence ("requests already blocked... never reach you") | same | none; the safety floor is code (`safety.ts`, SAFETY.md) and needs no announcement | **goes** |
| the world-knowledge and lookup sentence (#67, 2026-09-07) | same | none; a live patch on the old path for a tool-reach failure the forced call now handles by design (state record, the interim rule) | **goes**, with a replay row for #67's own words. Its removal exposed PHRASE-01's instruction lacking its referent, fixed there (dev.md, TRUEUP-01's own section) |
| the can't-watch-taste-visit sentence (baseline-fixes 2026-09-13) | same | none; an invention guard as prose, the plan's replacement is "a world answer without a search carries no sources and says so" (section 2) | **goes**, with a replay row |
| the remaining two suffix sentences | same | none stated | **go**; the replay set is the proof |
| `companionReanchorLine` ("Remember: you are X.") | `turnEngine.ts:983`, `messages.ts:208` | none; a Session C plan ("step 4") citing a legacy drift measurement; the confirmed cause of the "you" misread (dev.md, PREFIX-ROLE-01's arm 2) | **goes on both classes**; drift over ten spoken turns becomes a replay row, never a line in the prompt |
| `planLine` ("How to answer this one: ...") | `register.ts:210` | ARCH-LAYERS-01's response plan before generation; the reply floor; RESP-01 | stays on spoken; off on written adult (decided 2026-09-23); #145 fixes its target label after the flip |
| the memory block (header, bullets, trust line, "nothing stored") | `memoryFraming.ts`, `messages.ts:65` | CONTEXT-RECALL-01 (U5) | stays |
| `SOURCE_LABEL`, the dated context lines, the clock, the roster items | `messages.ts:38`, `context.ts` | GROUND-01, CONTEXT-RECALL-01, RULES-AND-LEARNED-COMPONENTS.md | stay |
| `NATURALNESS_POLICY` (spoken) | `persona.ts:191` | the state record names it as the spoken-class fragment; EVAL-03 names it as what the control vector replaces | stays on spoken as the designed fallback until EVAL-03 |
| `INFORMATION_HANDLING_POLICY` (spoken) | `persona.ts:155` | the platform plan 4.5 ("information policy" in the stable-first order) | stays on spoken |
| the four dial fragments and `examplesBlock` (spoken) | `persona.ts:233-369` | ARCH-LAYERS-01 ("dimensions plus examples, exactly the shape"); prose is the fallback delivery | stay on spoken as the designed fallback until EVAL-03 |
| the written twins: `*_FRAGMENT_WRITTEN`, `WRITTEN_POLICY`, `INFORMATION_HANDLING_POLICY_WRITTEN`, `WRITTEN_VOICE_POLICY`, the `WRITTEN_VOICE_PROSE` flag | `persona.ts:211-410` | Astra's designed fallback for the written class; measured to remove substance on tier 1 (dev.md "The written prompt on tier 1, decided"), so off there | stay declared and off (owner, 2026-09-23 evening: the fallback is kept as an option; the primary, EVAL-03, is tested first, then the fallback is offered per tier where it clears the floor) |
| `ANSWER_FROM_CONTEXT_TOOL` description | `model.ts:33` | the state record (off everywhere by Astra's ruling; a later item) | stays off, as recorded |

What this leaves on a written adult turn: the identity line, the
privacy sentence, the profile and roster lines, the window, the memory
block when a memory matched, the clock and tool results when present,
the question. On a spoken turn: the same plus the spoken persona
fragments, the two spoken policies, the examples and the plan line.
Personality on the written class returns through EVAL-03 (the control
vector for register, absorbing PERSONA-STEER-01), designed and tested
first; the prose fallback stays an option, offered per tier where it
clears the floor, never a second pass.

## The work order: TRUEUP-01 (Session B, after PHRASE-01, before WRITTEN-PARITY-01)

The old path is frozen except for safety defects and is deleted after
the flip (plan section 2), so nothing here edits a constant the old path
reads. The pattern is PREFIX-CLASS-01's: one table, one selector, the
new path selects differently.

1. `stableSuffixFor(class)` returns the privacy sentence only, for both
   classes; `STABLE_SYSTEM_SUFFIX` and the six-sentence table stay for
   the old path's `buildSystemPrompt` until its deletion, with a comment
   naming this record.
2. `contextToMessages` drops `companionReanchorLine` on both classes;
   the old path's own call stays until its deletion.
3. The written persona twins and the `WRITTEN_VOICE_PROSE` flag stay as
   they are (the designed fallback, off on tier 1); the flag's comment
   cites this record and says the option returns per tier after EVAL-03
   is tested. The PARITY-BISECT benches stay, since they measure that
   fallback.
4. Replay rows, added before the removals and green after them: #67's
   own follow-up ("where's it playing") reaching the tool through the
   forced call; a world question without a search answered with no
   sources and saying so; a ten-turn spoken conversation whose tenth
   reply still speaks as the persona (the drift row; a failure here is
   a finding for EVAL-03, never a reason to restore the line).
5. Tests in the item's own words: the written adult prompt contains no
   sentence beyond identity, the privacy sentence and the facts; no
   prompt on the new path contains "Remember: you are"; the spoken
   prefix is identity plus the privacy sentence plus the spoken persona
   composition; the old path's system prompt is byte-identical to
   today's.
6. Acceptance measurement, once, through the real `contextToMessages`
   with the tool block, thinking off, seeds 1 to 5, both questions:
   recorded beside PREFIX-CLASS-01's 0.30x and 0.26x; the bar is
   WRITTEN-PARITY-01's per-tier bar, and a miss is recorded, never
   tuned.
7. Gate as `check.sh` scopes it; review medium (the message list is a
   wire shape), one pass plus fix hunks; BACKLOG rows: TRUEUP-01 ticked
   at the hash, PERSONA-STEER-01 merged into EVAL-03 (one row, EVAL-03's
   name, the 2026-09-23 motivation added), WRITTEN-VOICE-TIER-01 kept
   and re-sequenced after EVAL-03 (the fallback as a per-tier option
   once the primary is tested).

Then WRITTEN-PARITY-01 measures the trued-up shape, TOKENS-PRIMARY-01,
rerun 3 once under a hold, the flip, the plan's section 2 deletions,
then EVAL-03's design pass.
