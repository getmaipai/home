// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/reply-constraint.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**CONS-01, dev.md section 16 part 9 rule 2: a live constraint the turn engine sets on the hub's next reply in a given conversation. kind banned_phrase: the hub must never say the value's phrase. kind shape: the reply must take the value's shape token. kind length: the reply must stay within the value's positive-integer character budget, carried as a string.*/
export const ReplyConstraint = z
  .object({
    id: z.string().regex(new RegExp("^rc-[a-z0-9]{6,}$")),
    /**The conversation this constraint applies to, for the duration of it. Required: a reply constraint with no conversation to constrain is meaningless.*/
    conversation_id: z
      .string()
      .regex(new RegExp("^conv-[a-z0-9]{6,}$"))
      .describe(
        "The conversation this constraint applies to, for the duration of it. Required: a reply constraint with no conversation to constrain is meaningless.",
      ),
    /**Who the constraint was set for, when there is a person the reply is about - null when the hub set it for the conversation itself.*/
    person: z
      .union([
        z
          .string()
          .regex(new RegExp("^person-[a-z0-9]{6,}$"))
          .describe(
            "Who the constraint was set for, when there is a person the reply is about - null when the hub set it for the conversation itself.",
          ),
        z
          .null()
          .describe(
            "Who the constraint was set for, when there is a person the reply is about - null when the hub set it for the conversation itself.",
          ),
      ])
      .describe(
        "Who the constraint was set for, when there is a person the reply is about - null when the hub set it for the conversation itself.",
      )
      .default(null),
    /**banned_phrase: the hub must never say the value's phrase. shape: the reply must take the value's shape token (list, number, one_line). length: the reply must stay within the value's character budget.*/
    kind: z
      .enum(["banned_phrase", "shape", "length"])
      .describe(
        "banned_phrase: the hub must never say the value's phrase. shape: the reply must take the value's shape token (list, number, one_line). length: the reply must stay within the value's character budget.",
      ),
    /**The constraint's own value, shaped by kind: the banned phrase itself, a shape token, or a positive-integer character budget as a string.*/
    value: z
      .string()
      .min(1)
      .describe(
        "The constraint's own value, shaped by kind: the banned phrase itself, a shape token, or a positive-integer character budget as a string.",
      ),
    set_at: z.string().datetime({ offset: true }),
    /**The turn that set this constraint, matching open-question.schema.json's provenance convention. Null when the constraint was set outside any recorded turn.*/
    set_by_turn: z
      .union([
        z
          .string()
          .regex(new RegExp("^turn-[a-z0-9]{6,}$"))
          .describe(
            "The turn that set this constraint, matching open-question.schema.json's provenance convention. Null when the constraint was set outside any recorded turn.",
          ),
        z
          .null()
          .describe(
            "The turn that set this constraint, matching open-question.schema.json's provenance convention. Null when the constraint was set outside any recorded turn.",
          ),
      ])
      .describe(
        "The turn that set this constraint, matching open-question.schema.json's provenance convention. Null when the constraint was set outside any recorded turn.",
      )
      .default(null),
    /**Hybrid logical clock: wall_ms:counter:node (7.3), the same shape every other synced record type uses.*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe(
        "Hybrid logical clock: wall_ms:counter:node (7.3), the same shape every other synced record type uses.",
      ),
  })
  .strict()
  .describe(
    "CONS-01, dev.md section 16 part 9 rule 2: a live constraint the turn engine sets on the hub's next reply in a given conversation. kind banned_phrase: the hub must never say the value's phrase. kind shape: the reply must take the value's shape token. kind length: the reply must stay within the value's positive-integer character budget, carried as a string.",
  );
export type ReplyConstraint = z.infer<typeof ReplyConstraint>;
