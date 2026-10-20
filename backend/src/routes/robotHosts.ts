import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { createRobotHost } from "@/lib/robotHost";
import { robotsEnabled, ROBOTS_OFF_MESSAGE } from "@/lib/robots";

export const robotHostRoutes = apiRouter();
const createRouteDef = createRoute({
  method: "post", path: "/hosts", tags: ["Robots"], summary: "Start a Bot app on Home for a StackChan",
  middleware: [requireRole("owner", "admin")] as const,
  request: { body: { content: { "application/json": { schema: z.object({ label: z.string().min(1).max(60) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ device_id: z.string(), ports: z.object({ voice: z.number(), avatar: z.number(), vision: z.number() }) }) } }, description: "Hosted robot created." }, ...errorResponses({ 403: "Robots are turned off or admin access is required", 500: "Robot host could not start" }) },
});
robotHostRoutes.openapi(createRouteDef, async (c) => {
  if (!robotsEnabled()) return c.json({ error: ROBOTS_OFF_MESSAGE }, 403);
  try { const result = await createRobotHost({ label: c.req.valid("json").label, personId: c.get("person").id }); return c.json({ device_id: result.deviceId, ports: result.ports }, 200); }
  catch (error) { return c.json({ error: `Could not start this robot host: ${(error as Error).message}. Check Repairs and try again.` }, 500); }
});
