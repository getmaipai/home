// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/reply-feedback.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**FEED-01: one person's rating of one assistant reply, kept as a human label for the review program. This record joins the conversation turn by turn_id and is per person, so a rating is never a hidden aggregate and never changes the reply it describes. The reason is a one-tap optional label for a down rating; the engine and classifier remain the only writers of reply content.*/
export const ReplyFeedback = z
  .object({
    /**The feedback record's stable id. A later change to this person's rating updates this record rather than creating a second label.*/
    id: z
      .string()
      .regex(new RegExp("^rf-[a-z0-9]{6,}$"))
      .describe(
        "The feedback record's stable id. A later change to this person's rating updates this record rather than creating a second label.",
      ),
    /**The assistant turn being rated, and the join key into RVW-1's weekly label export.*/
    turn_id: z
      .string()
      .regex(new RegExp("^turn-[a-z0-9]{6,}$"))
      .describe(
        "The assistant turn being rated, and the join key into RVW-1's weekly label export.",
      ),
    /**The household person who supplied the rating. Feedback is private to this actor's label, not a household-wide counter.*/
    person_id: z
      .string()
      .regex(new RegExp("^person-[a-z0-9]{6,}$"))
      .describe(
        "The household person who supplied the rating. Feedback is private to this actor's label, not a household-wide counter.",
      ),
    /**The person's one-tap verdict on the reply.*/
    verdict: z
      .enum(["up", "down"])
      .describe("The person's one-tap verdict on the reply."),
    /**Optional one-tap explanation, selected from FEED-01's fixed five-value list. The child band never exposes or stores a reason.*/
    reason: z
      .union([
        z.literal("wrong"),
        z.literal("too_long"),
        z.literal("did_not_listen"),
        z.literal("off"),
        z.literal("unsafe"),
        z.literal(null),
      ])
      .describe(
        "Optional one-tap explanation, selected from FEED-01's fixed five-value list. The child band never exposes or stores a reason.",
      )
      .default(null),
    /**Free-text provenance for the write path, matching the source field on sibling records.*/
    source: z
      .string()
      .min(1)
      .describe(
        "Free-text provenance for the write path, matching the source field on sibling records.",
      ),
    /**When this label was written.*/
    created_at: z
      .string()
      .datetime({ offset: true })
      .describe("When this label was written."),
    /**Hybrid logical clock: wall_ms:counter:node (7.3), the clock stamp used by every synced record shape.*/
    hlc: z
      .string()
      .regex(new RegExp("^[0-9]+:[0-9]+:[a-z0-9]{6,}$"))
      .describe(
        "Hybrid logical clock: wall_ms:counter:node (7.3), the clock stamp used by every synced record shape.",
      ),
  })
  .strict()
  .describe(
    "FEED-01: one person's rating of one assistant reply, kept as a human label for the review program. This record joins the conversation turn by turn_id and is per person, so a rating is never a hidden aggregate and never changes the reply it describes. The reason is a one-tap optional label for a down rating; the engine and classifier remain the only writers of reply content.",
  );
export type ReplyFeedback = z.infer<typeof ReplyFeedback>;
