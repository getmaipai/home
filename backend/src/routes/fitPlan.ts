import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getStackClient } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { fitNotFoundWording, fitUnavailableWording, fitWording } from "@/lib/fitWording";
import { StackFitPlan } from "@maipai/spec/gen/ts/stack-fit-plan.js";

export const fitPlanRoutes = apiRouter();

const SourceSchema = z.union([
  z.object({ url: z.string() }).strict(),
  z.object({ path: z.string() }).strict(),
  z.object({ repo: z.string(), revision: z.string().optional() }).strict(),
]);
const FitPlanRequestSchema = z.object({
  source: SourceSchema,
  context_tokens: z.number().int().positive().optional(),
  kv_cache_type: z.enum(["f16", "q8_0", "q4_0"]).optional(),
}).strict();
const WordingSchema = z.object({ verdict: z.enum(["yes", "slow", "no", "unknown"]), headline: z.string(), detail: z.string() });

const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Models"],
  summary: "Would this model fit this computer, before it is downloaded",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: FitPlanRequestSchema } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ plan: StackFitPlan.nullable(), wording: WordingSchema }) } }, description: "The Stack fit plan and Home's wording." },
    ...errorResponses({ 400: "The model source was bad", 401: "Not signed in" }),
  },
});

fitPlanRoutes.openapi(route, async (c) => {
  const body = c.req.valid("json");
  try {
    const plan = await getStackClient().fitPlan(body);
    return c.json({ plan, wording: fitWording(plan) }, 200);
  } catch (error) {
    if (error instanceof StackError && error.status === 404) {
      return c.json({ plan: null, wording: fitNotFoundWording() }, 200);
    }
    if (error instanceof StackError && error.status === 400) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ plan: null, wording: fitUnavailableWording() }, 200);
  }
});
