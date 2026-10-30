import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { doneComingUp, listComingUp, snoozeComingUp } from "@/lib/comingUp";

export const comingUpRoutes = apiRouter();
const rowSchema = z.object({ id: z.string(), kind: z.enum(["alarm", "reminder", "timer"]), text: z.string(), at: z.string() });
const listRoute = createRoute({ method: "get", path: "/", tags: ["Coming up"], summary: "My pending alarms, reminders and timers", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: z.array(rowSchema) } }, description: "The caller's own pending rows." }, ...errorResponses({ 401: "Not signed in" }) } });
comingUpRoutes.openapi(listRoute, (c) => c.json(listComingUp(c.get("person")), 200));

const doneRoute = createRoute({ method: "post", path: "/{id}/done", tags: ["Coming up"], summary: "Mark my scheduled item done", middleware: [requireAuth] as const, request: { params: idParamSchema("id") }, responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Cancelled." }, ...errorResponses({ 401: "Not signed in", 403: "Not yours", 404: "Not found" }) } });
comingUpRoutes.openapi(doneRoute, (c) => {
  const result = doneComingUp(c.get("person"), c.req.valid("param").id);
  if (result.ok) return c.json({ ok: true as const }, 200);
  if (result.status === 404) return c.json({ error: result.error }, 404);
  return c.json({ error: result.error }, 403);
});

const snoozeRoute = createRoute({ method: "post", path: "/{id}/snooze", tags: ["Coming up"], summary: "Snooze my scheduled item", middleware: [requireAuth] as const, request: { params: idParamSchema("id"), body: { content: { "application/json": { schema: z.union([z.object({ minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]) }).strict(), z.object({ until: z.literal("tomorrow_morning") }).strict()]) } } } }, responses: { 200: { content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } }, description: "Rescheduled." }, ...errorResponses({ 400: "Invalid or no longer pending", 401: "Not signed in", 403: "Not yours", 404: "Not found" }) } });
comingUpRoutes.openapi(snoozeRoute, (c) => {
  const result = snoozeComingUp(c.get("person"), c.req.valid("param").id, c.req.valid("json"));
  if (result.ok) return c.json({ ok: true as const }, 200);
  if (result.status === 404) return c.json({ error: result.error }, 404);
  if (result.status === 403) return c.json({ error: result.error }, 403);
  return c.json({ error: result.error }, 400);
});
