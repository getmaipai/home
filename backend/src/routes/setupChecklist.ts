import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getSetupChecklist } from "@/lib/setupChecklist";

export const setupChecklistRoutes = apiRouter();
const Item = z.object({ id: z.string(), title: z.string(), reason: z.string(), done: z.boolean(), open: z.object({ label: z.string(), href: z.string() }) });
const route = createRoute({ method: "get", path: "/", tags: ["Setup"], summary: "Setup checklist", middleware: [requireAuth] as const, responses: { 200: { content: { "application/json": { schema: z.array(Item) } }, description: "Follow-up setup items." }, ...errorResponses({ 401: "Not signed in", 403: "Owner or admin only" }) } });
setupChecklistRoutes.openapi(route, async (c) => {
  const actor = c.get("person");
  if (actor.role !== "owner" && actor.role !== "admin") return c.json({ error: "Only the owner and admins may read this checklist." }, 403);
  return c.json(await getSetupChecklist(actor), 200);
});
