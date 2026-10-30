import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { createTimer, doneComingUp, extendTimer, listComingUp, snoozeComingUp } from "@/lib/comingUp";

export const comingUpRoutes = apiRouter();

const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(["alarm", "reminder", "timer"]),
  text: z.string(),
  at: z.string(),
  total_seconds: z.number().optional(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Coming up"],
  summary: "My pending alarms, reminders and timers",
  middleware: [requireAuth] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(rowSchema) } },
      description: "The caller's own pending rows.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

comingUpRoutes.openapi(listRoute, (context) => context.json(listComingUp(context.get("person")), 200));

const createTimerRoute = createRoute({
  method: "post",
  path: "/timers",
  tags: ["Coming up"],
  summary: "Start a timer",
  middleware: [requireAuth] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            label: z.string().min(1).max(120),
            minutes: z.number().int().min(1).max(1440),
          }).strict(),
        },
      },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
      description: "Timer scheduled.",
    },
    ...errorResponses({ 400: "Invalid timer", 401: "Not signed in" }),
  },
});

comingUpRoutes.openapi(createTimerRoute, (context) => {
  const result = createTimer(context.get("person"), context.req.valid("json"));
  return result.ok ? context.json(result.value, 201) : context.json({ error: result.error }, 400);
});

const extendTimerRoute = createRoute({
  method: "post",
  path: "/{id}/extend",
  tags: ["Coming up"],
  summary: "Extend my timer by one minute",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ id: z.string(), at: z.string(), total_seconds: z.number() }) } },
      description: "Extended.",
    },
    ...errorResponses({ 400: "Not pending", 401: "Not signed in", 403: "Not yours", 404: "Not found" }),
  },
});

comingUpRoutes.openapi(extendTimerRoute, (context) => {
  const result = extendTimer(context.get("person"), context.req.valid("param").id);
  return result.ok
    ? context.json(result.value, 200)
    : context.json({ error: result.error }, result.status);
});

const doneRoute = createRoute({
  method: "post",
  path: "/{id}/done",
  tags: ["Coming up"],
  summary: "Mark my scheduled item done",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id") },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      description: "Cancelled.",
    },
    ...errorResponses({ 401: "Not signed in", 403: "Not yours", 404: "Not found" }),
  },
});

comingUpRoutes.openapi(doneRoute, (context) => {
  const result = doneComingUp(context.get("person"), context.req.valid("param").id);
  if (result.ok) return context.json({ ok: true as const }, 200);
  if (result.status === 404) return context.json({ error: result.error }, 404);
  return context.json({ error: result.error }, 403);
});

const snoozeRoute = createRoute({
  method: "post",
  path: "/{id}/snooze",
  tags: ["Coming up"],
  summary: "Snooze my scheduled item",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id"),
    body: {
      content: {
        "application/json": {
          schema: z.union([
            z.object({ minutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]) }).strict(),
            z.object({ until: z.literal("tomorrow_morning") }).strict(),
          ]),
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
      description: "Rescheduled.",
    },
    ...errorResponses({ 400: "Invalid or no longer pending", 401: "Not signed in", 403: "Not yours", 404: "Not found" }),
  },
});

comingUpRoutes.openapi(snoozeRoute, (context) => {
  const result = snoozeComingUp(
    context.get("person"),
    context.req.valid("param").id,
    context.req.valid("json"),
  );
  if (result.ok) return context.json({ ok: true as const }, 200);
  if (result.status === 404) return context.json({ error: result.error }, 404);
  if (result.status === 403) return context.json({ error: result.error }, 403);
  return context.json({ error: result.error }, 400);
});
