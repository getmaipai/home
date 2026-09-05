import { Hono } from "hono";
import { requireAuth } from "@/middleware/auth";
import { listPending, listHistory, markRead, dismiss, type NotificationOpResult } from "@/lib/notifications";
import type { AppEnv } from "@/types";

export const notificationsRoutes = new Hono<AppEnv>();

function fail<T>(result: Extract<NotificationOpResult<T>, { ok: false }>) {
  return { body: { error: result.error }, status: result.status } as const;
}

// A person's own pending list only - never another household member's,
// even for an owner/admin: unlike commands/plugins (household-wide by
// design), a notification is inherently personal (getmaipai/.github/docs/
// NOTIFICATIONS.md: "to the person"), so there is no admin-sees-all view
// here at all, the same posture lib/scheduler.ts's own listJobs() takes
// for a non-admin's jobs.
notificationsRoutes.get("/", requireAuth, async (c) => {
  return c.json(listPending(c.get("person")));
});

notificationsRoutes.get("/history", requireAuth, async (c) => {
  return c.json(listHistory(c.get("person")));
});

notificationsRoutes.post("/:id/read", requireAuth, async (c) => {
  const result = markRead(c.get("person"), c.req.param("id"));
  if (!result.ok) {
    const { body, status } = fail(result);
    return c.json(body, status);
  }
  return c.json(result.value);
});

notificationsRoutes.post("/:id/dismiss", requireAuth, async (c) => {
  const result = dismiss(c.get("person"), c.req.param("id"));
  if (!result.ok) {
    const { body, status } = fail(result);
    return c.json(body, status);
  }
  return c.json(result.value);
});
