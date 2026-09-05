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
