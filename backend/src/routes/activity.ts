// ACTIVITY-PAGE-01: the Activity page's list and its "seen" mark. Read-only over the existing job records; per viewer (rule 6a).
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { activityForViewer, clearActivity, markActivitySeen } from "@/lib/activity";

export const activityRoutes = apiRouter();

const ItemSchema = z.object({
  id: z.string(), source: z.enum(["picture", "video", "song", "job"]), state: z.enum(["waiting", "making", "done", "attention", "failed"]),
  title: z.string(), line: z.string().nullable(), percent: z.number().nullable(), typicalMinutes: z.number().nullable(), href: z.string().nullable(), at: z.string(),
});
const ListSchema = z.object({ items: z.array(ItemSchema), seenAt: z.string().nullable(), dot: z.enum(["none", "running", "attention", "finished"]) });

const listRoute = createRoute({ method: "get", path: "/", tags: ["Activity"], summary: "List the signed-in person's own past and current jobs across apps", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: ListSchema } }, description: "Newest change first, with the dot the Activity entry shows." }, ...errorResponses({ 401: "Sign in first" }) } });
activityRoutes.openapi(listRoute, (c) => c.json(activityForViewer(c.get("person")), 200));

const seenRoute = createRoute({ method: "post", path: "/seen", tags: ["Activity"], summary: "Mark everything finished so far as opened", middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.object({ seenAt: z.string() }) } }, description: "The time recorded." }, ...errorResponses({ 401: "Sign in first" }) } });
activityRoutes.openapi(seenRoute, (c) => c.json({ seenAt: markActivitySeen(c.get("person")) }, 200));

const clearRoute = createRoute({ method: "post", path: "/clear", tags: ["Activity"], summary: "Clear finished rows from the signed-in person's own Activity list", middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ keys: z.array(z.string().max(200)).max(500).optional(), all: z.boolean().optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: ListSchema } }, description: "The list after clearing. Only the list row is hidden: the picture, video or song and its files stay. Waiting and making rows are never cleared." }, ...errorResponses({ 401: "Sign in first" }) } });
activityRoutes.openapi(clearRoute, (c) => c.json(clearActivity(c.get("person"), c.req.valid("json")), 200));
