import { createRoute, z } from "@hono/zod-openapi";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listStatusApps } from "@/lib/appNeeds";
import { appResponseWithLiveRoleHealth, componentForNeed } from "@/lib/statusApps";
import { serviceDiagnostics } from "@/lib/serviceHealth";
import type { StatusAppsWire } from "../wire";

export const statusAppsRoutes = apiRouter();
const NeedSchema = z.object({ kind: z.enum(["engine", "service", "internet"]), id: z.string(), name: z.string(), purpose: z.string(), required: z.boolean(), state: z.enum(["operational", "degraded", "down", "waiting", "unknown"]), last_success_at: z.string().nullable().optional(), last_error_class: z.string().nullable().optional(), success_count: z.number().optional(), failure_count: z.number().optional() });
const AppSchema = z.object({ id: z.string(), name: z.string(), state: z.enum(["operational", "degraded", "down", "waiting_for_internet"]), reason: z.string().nullable(), needs: z.array(NeedSchema).optional(), history: z.array(z.object({ date: z.string(), state: z.enum(["operational", "degraded", "down", "waiting_for_internet"]), uptime: z.number() })).length(90), uptimePercent: z.number() });
const ResponseSchema = z.array(AppSchema) satisfies z.ZodType<StatusAppsWire>;

export const appsRoute = createRoute({ method: "get", path: "/apps", tags: ["Status"], summary: "Read app health derived from declared needs",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: ResponseSchema } }, description: "App health and ninety daily uptime buckets. Needs are visible to owners and admins." }, ...errorResponses({ 401: "Not signed in" }) } });

export type StatusAppsRoute = typeof appsRoute;

statusAppsRoutes.openapi(appsRoute, async (c) => {
  const person = c.get("person");
  const showNeeds = person.role === "owner" || person.role === "admin";
  const events = db.select({ component: statusEvents.component, state: statusEvents.state, at: statusEvents.at }).from(statusEvents).all();
  const apps = await Promise.all(listStatusApps().map(async (app) => {
    const result = await appResponseWithLiveRoleHealth(app, events, showNeeds);
    if (showNeeds && result.needs) result.needs = result.needs.map((need) => need.kind === "service" ? { ...need, ...serviceDiagnostics(componentForNeed(need)) } : need);
    return result;
  }));
  return c.json(apps, 200);
});
