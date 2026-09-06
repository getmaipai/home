// Step 9: the widgets half of the frozen D-to-E contract
// (docs/plans/wave-2.md). lib/widgets.ts holds the rules; this is only
// the HTTP boundary, the same split every other routes/*.ts file here
// takes over its own lib module.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listWidgets, getWidgetData } from "@/lib/widgets";

export const widgetsRoutes = apiRouter();

const WidgetDescriptor = z.object({
  package: z.string(),
  id: z.string(),
  title: z.string(),
  size: z.enum(["card", "row"]),
  refresh_s: z.number().int(),
});

const WidgetItem = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  value: z.string().optional(),
  icon: z.string().optional(),
  href: z.string().optional(),
  image: z.string().optional(),
});

const WidgetData = z.object({
  as_of: z.string(),
  items: z.array(WidgetItem),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Widgets"],
  summary: "Every widget my own role clears, across every bundled or installed package",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(WidgetDescriptor) } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
widgetsRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  return c.json(listWidgets(actor), 200);
});

const dataRoute = createRoute({
  method: "get",
  path: "/{package}/{id}/data",
  tags: ["Widgets"],
  summary: "One widget's own current data - runs its package's own recipe with its declared inputs, the same way a warm tick already does",
  middleware: [requireAuth] as const,
  request: {
    params: z.object({
      package: z.string().openapi({ example: "weather" }),
      id: z.string().openapi({ example: "current" }),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: WidgetData } }, description: "Found." },
    ...errorResponses({ 400: "The widget's own recipe failed", 401: "Not signed in", 403: "Role too low", 404: "No such package or widget" }),
  },
});
widgetsRoutes.openapi(dataRoute, async (c) => {
  const actor = c.get("person");
  const { package: packageId, id } = c.req.valid("param");
  const result = await getWidgetData(actor, packageId, id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});
