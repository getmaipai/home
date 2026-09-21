// SHELL-01: the one aggregate GET the template's modern-dashboard
// widgets read - see lib/dashboard.ts's own header for the person-
// scoping rule (`repairs_open`/`engines` owner/admin only, everything
// else every signed-in person's own view). Backend-only per the
// coordinator's item scope: no route mounts this into a page yet.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getDashboard } from "@/lib/dashboard";

export const dashboardRoutes = apiRouter();

const ActivityRowSchema = z.object({
  turn_id: z.string(),
  person_id: z.string(),
  display_name: z.string(),
  created_at: z.string(),
  surface: z.string(),
  source: z.string(),
});

const TurnsPerDaySchema = z.object({ date: z.string(), count: z.number().int() });

const EngineCountsSchema = z.object({
  critical: z.number().int(),
  error: z.number().int(),
  warning: z.number().int(),
  total: z.number().int(),
});

const DashboardSchema = z.object({
  people_count: z.number().int(),
  updates_available: z.boolean(),
  recent_activity: z.array(ActivityRowSchema),
  turns_per_day: z.array(TurnsPerDaySchema),
  // Additive, owner/admin only - absent from the wire entirely for
  // anyone else (never a zeroed or null placeholder that could misread
  // as "nothing wrong").
  repairs_open: z.number().int().optional(),
  engines: EngineCountsSchema.nullable().optional(),
});

const getRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Dashboard"],
  summary: "The household's own glanceable state for the modern dashboard",
  description: "Every signed-in person: people_count, updates_available, recent_activity and turns_per_day (scoped through the same canAccessPerson() rule every other read of turn data already uses - an owner/admin sees a child's activity, never a teen's or another adult's). Owner/admin only: repairs_open and engines (Health/Repairs and the Stack are machine internals a child never needs).",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: DashboardSchema } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
dashboardRoutes.openapi(getRoute, async (c) => {
  const actor = c.get("person");
  return c.json(await getDashboard(actor), 200);
});
