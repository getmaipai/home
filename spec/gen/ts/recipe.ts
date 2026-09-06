// GENERATED FILE. Do not edit by hand.
// Source: spec/schemas/recipe.schema.json
// Regenerate with: cd spec && bun run gen:ts

import { z } from "zod";

/**A Tier 0 declarative package body, interpreted natively by the TS and Python interpreters in spec/interpreters/. See platform plan 5.2. A recipe is a named set of inputs plus a list of steps; each step is one of the primitives below.*/
export const Recipe = z
  .object({
    id: z.string().min(1),
    /**Selectors a family fills in to instantiate this recipe (e.g. 'bedtime reminder for {person}').*/
    inputs: z
      .array(
        z
          .object({
            name: z.string().regex(new RegExp("^[a-z][a-z0-9_]*$")),
            selector: z.enum([
              "number",
              "select",
              "text",
              "boolean",
              "duration",
              "time",
              "entity",
              "area",
              "person",
              "media",
            ]),
            required: z.boolean().default(true),
          })
          .strict(),
      )
      .describe(
        "Selectors a family fills in to instantiate this recipe (e.g. 'bedtime reminder for {person}').",
      )
      .optional(),
    steps: z
      .array(
        z.any().superRefine((x, ctx) => {
          const schemas = [
            z
              .object({
                op: z.literal("fetch"),
                /**Binds the result into the recipe's variable scope under this name.*/
                as: z
                  .string()
                  .describe(
                    "Binds the result into the recipe's variable scope under this name.",
                  ),
                /**May reference input/variable names in {braces}.*/
                url: z
                  .string()
                  .describe("May reference input/variable names in {braces}."),
                method: z.enum(["GET", "POST"]).default("GET"),
                headers: z.record(z.string(), z.string()).optional(),
                body: z.any().optional(),
              })
              .strict()
              .describe(
                "Goes through host.fetch (the rate limiter's single choke point). A recipe never bypasses it.",
              ),
            z
              .object({
                op: z.literal("pick"),
                as: z.string(),
                /**A variable name to read from.*/
                from: z.string().describe("A variable name to read from."),
                /**A dotted path into that variable, e.g. results.0.title.*/
                path: z
                  .string()
                  .describe(
                    "A dotted path into that variable, e.g. results.0.title.",
                  )
                  .optional(),
              })
              .strict(),
            z
              .object({
                op: z.literal("format"),
                as: z.string(),
                /**A template with {variable} interpolation for the on-screen reply.*/
                text: z
                  .string()
                  .describe(
                    "A template with {variable} interpolation for the on-screen reply.",
                  ),
                /**A template for the spoken form. Falls back to text if omitted.*/
                speech: z
                  .string()
                  .describe(
                    "A template for the spoken form. Falls back to text if omitted.",
                  )
                  .optional(),
              })
              .strict(),
            z
              .object({
                op: z.literal("home.call_service"),
                domain: z.string(),
                service: z.string(),
                target: z.record(z.string(), z.any()),
                data: z.record(z.string(), z.any()).optional(),
              })
              .strict()
              .describe(
                "Goes through host.home.call_service; security domains are never covered by a wildcard target (4.2).",
              ),
            z
              .object({
                op: z.literal("action"),
                kind: z.string(),
                payload: z.record(z.string(), z.any()).optional(),
              })
              .strict()
              .describe(
                "Emits an action via host.action.emit; kind must match the recipe's declared permissions (actions:<kind>).",
              ),
            z
              .object({
                op: z.literal("remember"),
                text: z.string(),
                category: z
                  .enum([
                    "person",
                    "place",
                    "thing",
                    "preference",
                    "identity",
                    "event",
                    "project",
                    "goal",
                    "relationship",
                    "fact",
                    "state",
                  ])
                  .optional(),
                scope: z.enum(["household", "person", "self"]).optional(),
              })
              .strict()
              .describe("Calls host.memory.remember."),
            z
              .object({
                op: z.literal("recall"),
                as: z.string(),
                /**May reference input/variable names in {braces}.*/
                query: z
                  .string()
                  .describe("May reference input/variable names in {braces}."),
                scope: z.enum(["household", "person", "self"]).optional(),
                limit: z.number().int().gte(1).lte(10).default(3),
              })
              .strict()
              .describe(
                "Calls host.memory.recall and binds a ready-to-speak summary of the top matches into the recipe's variable scope - a plain 'nothing found' phrase if there are none, since the recipe language has no conditional step to branch on that itself.",
              ),
            z
              .object({
                op: z.literal("schedule"),
                /**A one-shot ISO time or a recurrence expression.*/
                when: z
                  .string()
                  .describe("A one-shot ISO time or a recurrence expression."),
                /**The job id this schedules, resolved by host.schedule.*/
                job: z
                  .string()
                  .describe(
                    "The job id this schedules, resolved by host.schedule.",
                  )
                  .optional(),
              })
              .strict()
              .describe("Calls host.schedule."),
            z
              .object({
                op: z.literal("integration.call"),
                /**Binds the result into the recipe's variable scope under this name.*/
                as: z
                  .string()
                  .describe(
                    "Binds the result into the recipe's variable scope under this name.",
                  ),
                /**The integration id, e.g. "home_assistant". Requires the manifest to declare integration:<id>.*/
                id: z
                  .string()
                  .describe(
                    'The integration id, e.g. "home_assistant". Requires the manifest to declare integration:<id>.',
                  ),
                /**An id-specific method name, e.g. Home Assistant's "get_state" or "call_service".*/
                method: z
                  .string()
                  .describe(
                    'An id-specific method name, e.g. Home Assistant\'s "get_state" or "call_service".',
                  ),
                /**Every string value, at any depth, may reference input/variable names in {braces} - unlike fetch's own body, which is passed through as-is.*/
                args: z
                  .record(z.string(), z.any())
                  .describe(
                    "Every string value, at any depth, may reference input/variable names in {braces} - unlike fetch's own body, which is passed through as-is.",
                  )
                  .optional(),
              })
              .strict()
              .describe(
                "Goes through host.integration.call - a typed read or action against a household-configured third-party integration beyond Home Assistant's own dedicated home.call_service step (session-d-packages-and-store.md step 4).",
              ),
            z
              .object({
                op: z.literal("compute"),
                as: z.string(),
                /**A math/unit-conversion expression, e.g. "12 miles to km" or "{amount} * 1.08". {variable} references are substituted before evaluation, the same interpolation every other step's text fields use.*/
                expression: z
                  .string()
                  .describe(
                    'A math/unit-conversion expression, e.g. "12 miles to km" or "{amount} * 1.08". {variable} references are substituted before evaluation, the same interpolation every other step\'s text fields use.',
                  ),
              })
              .strict()
              .describe(
                "A restricted math/unit expression evaluator (session-d-packages-and-store.md step 4) - no network call, no host access, real numbers and unit conversion only. Backs math/convert without either package needing its own fetch-based service.",
              ),
            z
              .object({
                op: z.literal("llm_complete"),
                /**Binds the result ({"text": string}, the same raw-object shape fetch's own `as` binds) into the recipe's variable scope. Read the reply out with a `pick` step (`path: "text"`) before a `format` step interpolates it, the same two-step shape fetch+pick already uses.*/
                as: z
                  .string()
                  .describe(
                    'Binds the result ({"text": string}, the same raw-object shape fetch\'s own `as` binds) into the recipe\'s variable scope. Read the reply out with a `pick` step (`path: "text"`) before a `format` step interpolates it, the same two-step shape fetch+pick already uses.',
                  ),
                /**A template with {variable} interpolation, sent as a single user-role message to the household's own local chat model. No system prompt, no conversation history: a one-shot completion for a lookup, not a chat turn.*/
                prompt: z
                  .string()
                  .describe(
                    "A template with {variable} interpolation, sent as a single user-role message to the household's own local chat model. No system prompt, no conversation history: a one-shot completion for a lookup, not a chat turn.",
                  ),
              })
              .strict()
              .describe(
                "Goes through host.llm.complete (permission llm:complete) - the household's own local chat model (session-d-packages-and-store.md step 7's own translate package is the first caller). A network translation service is explicitly opt-in per the platform plan and not this step's concern: a recipe that wants one calls it through its own fetch step instead.",
              ),
            z
              .object({
                op: z.literal("ask"),
                /**A template with {variable} interpolation, spoken/shown as the follow-up question.*/
                prompt: z
                  .string()
                  .describe(
                    "A template with {variable} interpolation, spoken/shown as the follow-up question.",
                  ),
                /**What kind of answer the next utterance should satisfy, e.g. a variable name the recipe would otherwise have asked for. Free text, matched by the turn engine (wave-2.md's C-to-D contract), not this interpreter.*/
                expects: z
                  .string()
                  .describe(
                    "What kind of answer the next utterance should satisfy, e.g. a variable name the recipe would otherwise have asked for. Free text, matched by the turn engine (wave-2.md's C-to-D contract), not this interpreter.",
                  )
                  .optional(),
              })
              .strict()
              .describe(
                "Sets the result's ask field (result.schema.json, 4.5) so a recipe that can't disambiguate on its own (\"which Springfield\") can ask a deterministic follow-up instead of guessing or failing outright. Always the recipe's last step: nothing after an ask step can run in the same pass, since there is nothing left to compute until the follow-up answer arrives on a later turn.",
              ),
          ];
          const { errors, failed } = schemas.reduce<{
            errors: z.core.$ZodIssue[];
            failed: number;
          }>(
            ({ errors, failed }, schema) =>
              ((result) =>
                result.error
                  ? {
                      errors: [...errors, ...result.error.issues],
                      failed: failed + 1,
                    }
                  : { errors, failed })(schema.safeParse(x)),
            { errors: [], failed: 0 },
          );
          const passed = schemas.length - failed;
          if (passed !== 1) {
            ctx.addIssue(
              errors.length
                ? {
                    path: [],
                    code: "invalid_union",
                    errors: [errors],
                    message:
                      "Invalid input: Should pass single schema. Passed " +
                      passed,
                  }
                : {
                    path: [],
                    code: "custom",
                    errors: [errors],
                    message:
                      "Invalid input: Should pass single schema. Passed " +
                      passed,
                  },
            );
          }
        }),
      )
      .min(1),
  })
  .strict()
  .describe(
    "A Tier 0 declarative package body, interpreted natively by the TS and Python interpreters in spec/interpreters/. See platform plan 5.2. A recipe is a named set of inputs plus a list of steps; each step is one of the primitives below.",
  );
export type Recipe = z.infer<typeof Recipe>;
