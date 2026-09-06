import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listPending, listHistory, markRead, dismiss } from "@/lib/notifications";

export const notificationsRoutes = apiRouter();

const NotificationSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  text: z.string(),
  channels: z.array(z.enum(["in_app", "telegram"])),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});

const IdParamSchema = idParamSchema("id", "notif-a1b2c3");

// A person's own pending list only - never another household member's,
// even for an owner/admin: unlike commands/plugins (household-wide by
// design), a notification is inherently personal (getmaipai/.github/docs/
// NOTIFICATIONS.md: "to the person"), so there is no admin-sees-all view
// here at all, the same posture lib/scheduler.ts's own listJobs() takes
// for a non-admin's jobs.
const listPendingRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Notifications"],
  summary: "The signed-in person's own pending (not dismissed) notifications",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(NotificationSchema) } }, description: "Pending notifications, newest first." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
notificationsRoutes.openapi(listPendingRoute, (c) => c.json(listPending(c.get("person")), 200));

const listHistoryRoute = createRoute({
  method: "get",
  path: "/history",
  tags: ["Notifications"],
  summary: "The signed-in person's full notification history, dismissed or not",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(NotificationSchema) } }, description: "Every delivery, newest first." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
notificationsRoutes.openapi(listHistoryRoute, (c) => c.json(listHistory(c.get("person")), 200));

const readRoute = createRoute({
  method: "post",
  path: "/{id}/read",
  tags: ["Notifications"],
  summary: "Mark one of the signed-in person's own notifications read",
  middleware: [requireAuth] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: NotificationSchema } }, description: "Marked read." },
    ...errorResponses({ 401: "Not signed in", 403: "Not this person's notification", 404: "No such notification" }),
  },
});
notificationsRoutes.openapi(readRoute, (c) => {
  const result = markRead(c.get("person"), c.req.valid("param").id);
  if (!result.ok) {
    return result.status === 403 ? c.json({ error: result.error }, 403) : c.json({ error: result.error }, 404);
  }
  return c.json(result.value, 200);
});

const dismissRoute = createRoute({
  method: "post",
  path: "/{id}/dismiss",
  tags: ["Notifications"],
  summary: "Dismiss one of the signed-in person's own notifications",
  middleware: [requireAuth] as const,
  request: { params: IdParamSchema },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string() }) } }, description: "Dismissed." },
    ...errorResponses({ 401: "Not signed in", 403: "Not this person's notification", 404: "No such notification" }),
  },
});
notificationsRoutes.openapi(dismissRoute, (c) => {
  const result = dismiss(c.get("person"), c.req.valid("param").id);
  if (!result.ok) {
    return result.status === 403 ? c.json({ error: result.error }, 403) : c.json({ error: result.error }, 404);
  }
  return c.json(result.value, 200);
});
