// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/error-entry.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**One code in the shared error catalogue (spec/errors/errors.json). Every package error the host wraps maps to one of these. See platform plan 4.9 and docs/ENGINEERING.md > Errors.*/
export const ErrorEntry = z
  .object({
    code: z.string().regex(new RegExp("^[a-z][a-z0-9_]*$")),
    /**Developer-facing, goes in logs and diagnostics.*/
    message: z
      .string()
      .describe("Developer-facing, goes in logs and diagnostics."),
    /**What the robot or a voice surface says when this error surfaces mid-conversation.*/
    spoken_fallback: z
      .string()
      .describe(
        "What the robot or a voice surface says when this error surfaces mid-conversation.",
      ),
    /**What the shell shows: specific title, what happened, what to do (docs/UI.md pattern table > Errors).*/
    ui_message: z
      .string()
      .describe(
        "What the shell shows: specific title, what happened, what to do (docs/UI.md pattern table > Errors).",
      ),
    retriable: z.boolean(),
  })
  .strict()
  .describe(
    "One code in the shared error catalogue (spec/errors/errors.json). Every package error the host wraps maps to one of these. See platform plan 4.9 and docs/ENGINEERING.md > Errors.",
  );
export type ErrorEntry = z.infer<typeof ErrorEntry>;
