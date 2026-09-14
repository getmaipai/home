// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/reply-plan.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**
 * SPEC-01 (dev.md section 12 part 3, amended by section 13 part 9 and the coherence review, question 1). A plan of permitted moves, not an order: the engine turns the signal, the protocol state, the surface, an explicit brevity request, the age band and the available evidence into this, and the composer realizes it in the companion's voice. Replaces the composer's earlier fixed 'react, pick, say, point' order (dev.md section 6 part 1, amended). A value shape, carried on conversation-turn.schema.json's own `plan` field, never synced independently. The move vocabulary is declared once, exactly here: react, care, say, pick, point, ask_back, close, defer - no item may add a ninth.
 *
 * What this deliberately does not carry (ACT-03 narrowed, the coherence review's over-design finding): no `claim_state` (section 14, deferred to CRED-01), no `credulity` block (section 15, deferred), no typed move fields on a streamed chat turn (those exist only on a composed/lookup turn's ComposedTurn, off the interactive path per the review's cost analysis - a streamed reply is checked against this plan at the guard boundary instead, by deterministic signs in the sentences).
 */
export const ReplyPlan = z
  .object({
    moves: z
      .object({
        /**A short reaction to the emotion or the news.*/
        react: z
          .enum(["required", "allowed", "forbidden"])
          .describe("A short reaction to the emotion or the news."),
        /**An acknowledgment of a marked emotion, ahead of any other content.*/
        care: z
          .enum(["required", "allowed", "forbidden"])
          .describe(
            "An acknowledgment of a marked emotion, ahead of any other content.",
          ),
        /**The substantive answer or acknowledgment.*/
        say: z
          .enum(["required", "allowed", "forbidden"])
          .describe("The substantive answer or acknowledgment."),
        /**Choosing one of several candidates the evidence offers.*/
        pick: z
          .enum(["required", "allowed", "forbidden"])
          .describe("Choosing one of several candidates the evidence offers."),
        /**Citing a source, a link, or a document - forbidden on the child band (section 13 part 1).*/
        point: z
          .enum(["required", "allowed", "forbidden"])
          .describe(
            "Citing a source, a link, or a document - forbidden on the child band (section 13 part 1).",
          ),
        /**A follow-up question.*/
        ask_back: z
          .enum(["required", "allowed", "forbidden"])
          .describe("A follow-up question."),
        /**A reciprocal closing.*/
        close: z
          .enum(["required", "allowed", "forbidden"])
          .describe("A reciprocal closing."),
        /**AGE-01 (section 13 part 3): naming a trusted adult as the place for what the hub will not decide or recite, rather than pointing to a source. The trusted-adult move, distinct from `point`.*/
        defer: z
          .enum(["required", "allowed", "forbidden"])
          .describe(
            "AGE-01 (section 13 part 3): naming a trusted adult as the place for what the hub will not decide or recite, rather than pointing to a source. The trusted-adult move, distinct from `point`.",
          ),
      })
      .strict(),
    /**Forbidden under every negative-emotion override and on the child band whenever a negative emotion or a harm/illness/death/living-thing question is in play (section 13 part 1).*/
    playfulness: z
      .enum(["allowed", "forbidden"])
      .describe(
        "Forbidden under every negative-emotion override and on the child band whenever a negative emotion or a harm/illness/death/living-thing question is in play (section 13 part 1).",
      ),
    max_sentences: z.number().int().gte(1),
    max_words: z.number().int().gte(1),
    /**Copied from the frozen TurnSignal.age_band, so the plan is self-contained for the composer and the guards without a second read of the signal.*/
    age_band: z
      .enum(["child", "teen", "adult"])
      .describe(
        "Copied from the frozen TurnSignal.age_band, so the plan is self-contained for the composer and the guards without a second read of the signal.",
      ),
    /**Section 13 part 1's own `complexity` dial, renamed and moved here (the coherence review, question 1: 'vocabulary_level replaces a forced complexity dial, one field'). `simple` forced on the child band; capped at `standard` on the teen band; the companion's own dial on adult, never above what the band allows.*/
    vocabulary_level: z
      .enum(["simple", "standard", "advanced"])
      .describe(
        "Section 13 part 1's own `complexity` dial, renamed and moved here (the coherence review, question 1: 'vocabulary_level replaces a forced complexity dial, one field'). `simple` forced on the child band; capped at `standard` on the teen band; the companion's own dial on adult, never above what the band allows.",
      ),
    /**Section 13 part 1: `concrete` on the child band (concrete words, no abstractions, no idioms a child cannot parse); `plain` on the teen band (no talking down); `full` on the adult band (the companion's own register). AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.*/
    explanation_style: z
      .enum(["concrete", "plain", "full"])
      .describe(
        "Section 13 part 1: `concrete` on the child band (concrete words, no abstractions, no idioms a child cannot parse); `plain` on the teen band (no talking down); `full` on the adult band (the companion's own register). AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.",
      ),
    /**Section 13 part 3: how the `defer` move, when present, should read. `name_adult`: name a trusted adult as the place for the answer. `offer_to_ask`: also offer to relay the child's question to them (queues an OpenQuestion of kind `relay`). `none` when `defer` is not `required` or `allowed` this turn. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.*/
    trusted_adult_move: z
      .enum(["none", "name_adult", "offer_to_ask"])
      .describe(
        "Section 13 part 3: how the `defer` move, when present, should read. `name_adult`: name a trusted adult as the place for the answer. `offer_to_ask`: also offer to relay the child's question to them (queues an OpenQuestion of kind `relay`). `none` when `defer` is not `required` or `allowed` this turn. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.",
      ),
    /**Section 13 part 2: whether every piece of evidence handed to the composer this turn was shown in full, or at least one item was summarized or withheld by the content ceiling or a household record's child_disclosure - so the reply can say so honestly ('some of what came back is for grown-ups') rather than pretending nothing was found. The per-item detail lives on the bench's own evidenceDisposition expectation, not here; this is the one summary bit the plan carries. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.*/
    content_disclosure: z
      .enum(["full", "some_withheld"])
      .describe(
        "Section 13 part 2: whether every piece of evidence handed to the composer this turn was shown in full, or at least one item was summarized or withheld by the content ceiling or a household record's child_disclosure - so the reply can say so honestly ('some of what came back is for grown-ups') rather than pretending nothing was found. The per-item detail lives on the bench's own evidenceDisposition expectation, not here; this is the one summary bit the plan carries. AGE-01/ACT-03's own field to build against; this shape is a starting point, not yet read by any engine code.",
      ),
  })
  .strict()
  .describe(
    "SPEC-01 (dev.md section 12 part 3, amended by section 13 part 9 and the coherence review, question 1). A plan of permitted moves, not an order: the engine turns the signal, the protocol state, the surface, an explicit brevity request, the age band and the available evidence into this, and the composer realizes it in the companion's voice. Replaces the composer's earlier fixed 'react, pick, say, point' order (dev.md section 6 part 1, amended). A value shape, carried on conversation-turn.schema.json's own `plan` field, never synced independently. The move vocabulary is declared once, exactly here: react, care, say, pick, point, ask_back, close, defer - no item may add a ninth.\n\nWhat this deliberately does not carry (ACT-03 narrowed, the coherence review's over-design finding): no `claim_state` (section 14, deferred to CRED-01), no `credulity` block (section 15, deferred), no typed move fields on a streamed chat turn (those exist only on a composed/lookup turn's ComposedTurn, off the interactive path per the review's cost analysis - a streamed reply is checked against this plan at the guard boundary instead, by deterministic signs in the sentences).",
  );
export type ReplyPlan = z.infer<typeof ReplyPlan>;
