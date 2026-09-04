// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/safety-result.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**The safety layer's verdict on one piece of text (a turn, or a generation prompt), before any model runs and again on every streamed sentence. See platform plan 4.3. Deliberately abstract: `matched_signals` names which detectors fired, never the text that triggered them, so a SafetyResult can be logged and used in a notification without ever carrying a transcript (4.3: "logged with the fact, never the transcript").*/
export const SafetyResult = z
  .object({
    /**Whether any category matched. False means every field below is empty/allow.*/
    flagged: z
      .boolean()
      .describe(
        "Whether any category matched. False means every field below is empty/allow.",
      ),
    /**Which of the floor's categories matched (4.3). Empty when not flagged.*/
    categories: z
      .array(
        z.enum([
          "self_harm",
          "harmful_request",
          "credible_threat",
          "csam",
          "grooming",
          "pii_extraction",
          "prompt_injection",
          "jailbreak",
        ]),
      )
      .describe(
        "Which of the floor's categories matched (4.3). Empty when not flagged.",
      ),
    /**allow_with_resources is self-harm's floor behavior: crisis resources are offered, never blocking (CLAUDE.md > Safety invariants). Every other flagged category is refuse; a category never lowers this.*/
    action: z
      .enum(["allow", "allow_with_resources", "refuse"])
      .describe(
        "allow_with_resources is self-harm's floor behavior: crisis resources are offered, never blocking (CLAUDE.md > Safety invariants). Every other flagged category is refuse; a category never lowers this.",
      ),
    /**True when the speaker is a minor and a category flagged (4.3: "Safety-flagged turns raise an immediate notification to a parent for minors"). Delivery through the notification system (2.6) is a later hub release; this field is the fact that a caller wires up once it exists.*/
    notify_parent: z
      .boolean()
      .describe(
        'True when the speaker is a minor and a category flagged (4.3: "Safety-flagged turns raise an immediate notification to a parent for minors"). Delivery through the notification system (2.6) is a later hub release; this field is the fact that a caller wires up once it exists.',
      ),
    /**Internal detector ids that fired (e.g. "self_harm.direct_intent_phrase"), for audit logging. Never a verbatim excerpt of the checked text.*/
    matched_signals: z
      .array(z.string())
      .describe(
        'Internal detector ids that fired (e.g. "self_harm.direct_intent_phrase"), for audit logging. Never a verbatim excerpt of the checked text.',
      ),
    checked_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .describe(
    'The safety layer\'s verdict on one piece of text (a turn, or a generation prompt), before any model runs and again on every streamed sentence. See platform plan 4.3. Deliberately abstract: `matched_signals` names which detectors fired, never the text that triggered them, so a SafetyResult can be logged and used in a notification without ever carrying a transcript (4.3: "logged with the fact, never the transcript").',
  );
export type SafetyResult = z.infer<typeof SafetyResult>;
