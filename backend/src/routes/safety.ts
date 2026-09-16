import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { evaluateSafety } from "@/lib/safety";
import { speakerAgeBand } from "@/lib/ageBand";
import type { AppEnv } from "@/types";
import { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";

export const safetyRoutes = apiRouter();

const checkRoute = createRoute({
  method: "post",
  path: "/check",
  tags: ["Safety"],
  summary: "Check a person's own text against the safety layer",
  description: "Checks the signed-in person's own text in their own speaker context. No turn engine needed: this is a direct safety check surface.",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            text: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: SafetyResult } },
      description: "The safety layer's verdict on the submitted text.",
    },
    ...errorResponses({ 400: "text is required" }),
  },
});

// No turn engine exists yet to call the safety layer on a real
// conversation turn (4.5 is later in the roadmap, see docs/dev.md), so
// this route is today's real caller: it checks the signed-in person's own
// text in their own speaker context. The turn engine will call
// evaluateSafety() directly once it exists; this route stays useful after
// that too (a dev/diagnostics surface, 4.13).
safetyRoutes.openapi(checkRoute, async (c) => {
  const person = c.get("person");
  const body = c.req.valid("json") as { text?: string };
  if (!body.text || typeof body.text !== "string") {
    return c.json({ error: "text is required" }, 400);
  }
  const result = evaluateSafety(body.text, speakerAgeBand(person, new Date()));
  return c.json(result, 200);
});
