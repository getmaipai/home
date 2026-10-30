import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { listHelperApps } from "@/lib/appHelperClient";
import { readOtherApps } from "@/lib/otherApps";

export const performanceAppsRoutes = apiRouter();
const AppsResponse = z.object({
  installed: z.boolean(),
  apps: z.array(z.object({ bundleId: z.string(), name: z.string(), bytes: z.number(), frontmost: z.boolean() })),
});
const appsRoute = createRoute({ method: "get", path: "/apps", tags: ["Performance"], summary: "List the apps running on this Mac, for admins",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: AppsResponse } }, description: "Running apps from the Mac app helper; installed is false when the helper is not running. Names reach admins only and are never stored." }, ...errorResponses({ 401: "Not signed in", 403: "Owner/admin only" }) } });
performanceAppsRoutes.openapi(appsRoute, async (c) => c.json(await listHelperApps(), 200));

const OtherAppsResponse = z.object({ source: z.enum(["helper", "stack", "none"]), apps: z.array(z.object({ name: z.string(), bytes: z.number() })) });
const otherAppsRoute = createRoute({ method: "get", path: "/other-apps", tags: ["Performance"], summary: "What else on this Mac is using memory, for admins",
  middleware: [requireRole("owner", "admin")] as const,
  responses: { 200: { content: { "application/json": { schema: OtherAppsResponse } }, description: "The biggest other apps, from the Mac app helper when it is installed, else the Stack's dev-load reading. Names reach admins only and are never stored." }, ...errorResponses({ 401: "Not signed in", 403: "Owner/admin only" }) } });
performanceAppsRoutes.openapi(otherAppsRoute, async (c) => c.json(await readOtherApps(), 200));
