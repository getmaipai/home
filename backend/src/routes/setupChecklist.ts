import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getSetupChecklist } from "@/lib/setupChecklist";

export const setupChecklistRoutes = apiRouter();

const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  reason: z.string(),
  done: z.boolean(),
  open: z.object({ label: z.string(), href: z.string() }),
});

const getRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Setup"],
  summary: "Setup checklist from household facts",
  description: "Read-only checklist for the signed-in owner or admin.",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(ItemSchema) } }, description: "The current setup checklist." },
    ...errorResponses({ 401: "Not signed in", 403: "Only the owner and admins may read this checklist" }),
  },
});

setupChecklistRoutes.openapi(getRoute, async (c) => {
  const actor = c.get("person");
  if (actor.role !== "owner" && actor.role !== "admin") {
    return c.json({ error: "This checklist is for the owner and admins. Sign in with an owner or admin account." }, 403);
  }
  return c.json(await getSetupChecklist(actor), 200);
});
