// CODE-FIX-02: GET /api/code/readiness, whether a Code message can run right now (additive). Any person who may use Code reads it; the wording is the owner's or admin's
// detail, or the plain line for everyone else. The probe and the sentences live in lib/codingReadiness.ts; nothing here starts or changes anything.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { codingSessionRefusal } from "@/lib/codingSessions";
import { codingReadiness, readinessLineFor } from "@/lib/codingReadiness";
import { isOwnerOrAdmin } from "@/lib/access";

export const codeReadinessRoutes = apiRouter();

const Readiness = z.object({
  ready: z.boolean(),
  reason: z.string().describe("One reason code, `ready` when a message can run; for logs and tests, never shown to a person."),
  line: z.string().nullable().describe("The plain sentence with the next step; null when ready."),
  can_fix: z.boolean().describe("True for an owner or admin: the line names the fix and the app shows a Repairs link."),
});
const readinessR = createRoute({
  method: "get", path: "/", tags: ["Code"], summary: "Can a Code message run right now, and if not, why and what to do", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: Readiness } }, description: "Read-only; shared for a few seconds." }, ...errorResponses({ 401: "Not signed in", 403: "Coding is not available to this person" }) },
});
codeReadinessRoutes.openapi(readinessR, async (c) => {
  const person = c.get("person");
  const refusal = codingSessionRefusal(person);
  if (refusal) return c.json({ error: refusal }, 403);
  const canFix = isOwnerOrAdmin(person);
  const readiness = await codingReadiness();
  return c.json({ ready: readiness.ready, reason: readiness.reason, line: readiness.ready ? null : readinessLineFor(readiness, canFix), can_fix: canFix }, 200);
});
