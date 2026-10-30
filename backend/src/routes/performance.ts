import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { listHelperApps } from "@/lib/appHelperClient";

export const performanceRoutes = apiRouter();
const AppsResponse = z.object({
  installed: z.boolean(),
  apps: z.array(z.object({ bundleId: z.string(), name: z.string(), bytes: z.number(), frontmost: z.boolean() })),
});
const appsRoute = createRoute({ method: "get", path: "/apps", tags: ["Performance"], summary: "List the apps running on this Mac, for admins",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: AppsResponse } }, description: "Running apps from the Mac app helper; installed is false when the helper is not running. Names reach admins only and are never stored." }, ...errorResponses({ 401: "Not signed in", 403: "Owner/admin only" }) } });
performanceRoutes.openapi(appsRoute, async (c) => c.json(await listHelperApps(), 200));
