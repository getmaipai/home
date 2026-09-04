// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/result.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**What a package's handle() (or a recipe's interpreted run) returns. See platform plan 4.9.*/
export const SkillResult = z
  .object({
    reply: z
      .object({ text: z.string(), speech: z.string().optional() })
      .strict()
      .optional(),
    data: z.any().optional(),
    synthesis_hint: z.string().optional(),
    actions: z.array(z.record(z.string(), z.any())).default([]),
    directive: z.record(z.string(), z.any()).optional(),
    confirm: z
      .object({
        prompt: z.string().optional(),
        on_confirm: z.record(z.string(), z.any()).optional(),
      })
      .strict()
      .optional(),
    /**Lets a deterministic follow-up match without a model (4.5).*/
    ask: z
      .object({ prompt: z.string().optional(), expects: z.string().optional() })
      .strict()
      .describe("Lets a deterministic follow-up match without a model (4.5).")
      .optional(),
    end_conversation: z.boolean().optional(),
    article: z.record(z.string(), z.any()).optional(),
  })
  .strict()
  .describe(
    "What a package's handle() (or a recipe's interpreted run) returns. See platform plan 4.9.",
  );
export type SkillResult = z.infer<typeof SkillResult>;
