import { createRoute, z } from "@hono/zod-openapi";
import { QuickTimer } from "@maipai/spec/gen/ts/quick-timer.js";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { createQuickTimer, deleteQuickTimer, listQuickTimers, updateQuickTimer } from "@/lib/quickTimers";

export const quickTimersRoutes = apiRouter();

const edit = z.object({
  name: z.string().optional(),
  minutes: z.number().int().optional(),
  position: z.number().int().min(0).optional(),
});

const list = createRoute({
  method: "get",
  path: "/",
  tags: ["Quick timers"],
  summary: "List my quick timers",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(QuickTimer) } }, description: "Quick timers" },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
quickTimersRoutes.openapi(list, (c) => c.json(listQuickTimers(c.get("person")), 200));

const create = createRoute({
  method: "post",
  path: "/",
  tags: ["Quick timers"],
  summary: "Create a quick timer",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: edit } } } },
  responses: {
    201: { content: { "application/json": { schema: QuickTimer } }, description: "Created" },
    ...errorResponses({ 400: "Invalid timer", 401: "Not signed in" }),
  },
});
quickTimersRoutes.openapi(create, (c) => {
  const result = createQuickTimer(c.get("person"), c.req.valid("json"));
  return result.ok ? c.json(result.value, 201) : c.json({ error: result.error }, 400);
});

const patch = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Quick timers"],
  summary: "Update my quick timer",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "qtimer-abcdef"),
    body: { content: { "application/json": { schema: edit } } },
  },
  responses: {
    200: { content: { "application/json": { schema: QuickTimer } }, description: "Updated" },
    ...errorResponses({ 400: "Invalid timer", 401: "Not signed in", 404: "No such timer" }),
  },
});
quickTimersRoutes.openapi(patch, (c) => {
  const result = updateQuickTimer(c.get("person"), c.req.valid("param").id, c.req.valid("json"));
  return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, result.status);
});

const del = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Quick timers"],
  summary: "Delete my quick timer",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "qtimer-abcdef") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Deleted" },
    ...errorResponses({ 401: "Not signed in", 404: "No such timer" }),
  },
});
quickTimersRoutes.openapi(del, (c) => {
  const result = deleteQuickTimer(c.get("person"), c.req.valid("param").id);
  return result.ok ? c.json(result.value, 200) : c.json({ error: result.error }, 404);
});
