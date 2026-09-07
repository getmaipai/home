// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/result.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**What a package's handle() (or a recipe's interpreted run) returns. See platform plan 4.9.*/
export const PluginResult = z
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
    /**Fix B (docs/dev.md's 'Chat reliability: the 2026-09-07 incident' note): a handler's own typed report that it could not answer (an upstream fetch failure, say) - never present alongside `reply`. Distinct from a thrown exception (which the Tier 1 host maps to a strike and the manifest's fallback_reply already): this is a report of an EXPECTED failure mode a handler catches itself, so the caller can answer with the household-facing fallback without treating the package's own sandbox as unhealthy.*/
    error: z
      .object({
        /**One of spec/errors/errors.json's own codes.*/
        code: z
          .string()
          .describe("One of spec/errors/errors.json's own codes."),
        /**Developer-facing detail, never shown to the household - the household sees the manifest's own fallback_reply or the error catalogue's spoken_fallback instead.*/
        message: z
          .string()
          .describe(
            "Developer-facing detail, never shown to the household - the household sees the manifest's own fallback_reply or the error catalogue's spoken_fallback instead.",
          ),
      })
      .strict()
      .describe(
        "Fix B (docs/dev.md's 'Chat reliability: the 2026-09-07 incident' note): a handler's own typed report that it could not answer (an upstream fetch failure, say) - never present alongside `reply`. Distinct from a thrown exception (which the Tier 1 host maps to a strike and the manifest's fallback_reply already): this is a report of an EXPECTED failure mode a handler catches itself, so the caller can answer with the household-facing fallback without treating the package's own sandbox as unhealthy.",
      )
      .optional(),
  })
  .strict()
  .describe(
    "What a package's handle() (or a recipe's interpreted run) returns. See platform plan 4.9.",
  );
export type PluginResult = z.infer<typeof PluginResult>;
