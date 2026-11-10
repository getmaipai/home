// Step 9: the widgets half of the frozen D-to-E contract
// (docs/plans/wave-2.md). lib/widgets.ts holds the rules; this is only
// the HTTP boundary, the same split every other routes/*.ts file here
// takes over its own lib module.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, respond } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listWidgets, getWidgetData, orderHomeCards, arrangeHomeCards, saveHomeArrangement } from "@/lib/widgets";
import type { WidgetDescriptor } from "@/lib/widgets";

export const widgetsRoutes = apiRouter();

const WidgetDescriptor = z.object({
  package: z.string(),
  id: z.string(),
  title: z.string(),
  size: z.enum(["card", "row", "tiles"]),
  refresh_s: z.number().int(),
  min_role: z.string(), priority: z.number().int(), hero: z.boolean(), data: z.string().optional(),
  surfaces: z.array(z.enum(["home", "tv", "robot"])), inputs: z.record(z.string(), z.unknown()).optional(), installed_at: z.string(),
});

const OrderedCards = z.object({ hero: WidgetDescriptor.nullable(), cards: z.array(WidgetDescriptor), more: z.array(WidgetDescriptor) });

const WidgetItem = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  value: z.string().optional(),
  icon: z.string().optional(),
  href: z.string().optional(),
  image: z.string().optional(),
  at: z.string().optional(),
});

const WidgetData = z.object({
  as_of: z.string(),
  items: z.array(WidgetItem),
  // Fix B (docs/dev.md's "Chat reliability" B2): set only when `items` is
  // showing a Tier 1 handler's own fallback_reply text, not real data -
  // see lib/widgets.ts's WidgetData for why this exists.
  degraded: z.literal(true).optional(),
  tiles: z.array(z.object({ id: z.string(), name: z.string(), state: z.string(), icon: z.string(), on: z.boolean() })).optional(),
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
widgetsRoutes.openapi(listRoute, (c) => c.json(listWidgets(c.get("person")), 200));

const homeRoute = createRoute({
  method: "get",
  path: "/home",
  tags: ["Widgets"],
  summary: "My Home cards for one surface: the hero, the first four and the rest, ordered and filtered for me",
  middleware: [requireAuth] as const,
  request: { query: z.object({ surface: z.enum(["home", "tv", "robot"]).default("home") }) },
  responses: {
    200: { content: { "application/json": { schema: OrderedCards } }, description: "Ordered Home slots for the requested surface." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
widgetsRoutes.openapi(homeRoute, (c) => {
  const actor = c.get("person");
  return c.json(orderHomeCards(listWidgets(actor), actor, c.req.valid("query").surface), 200);
});

const ArrangeCard = WidgetDescriptor.extend({ key: z.string(), hidden: z.boolean() });
const ArrangeList = z.object({ cards: z.array(ArrangeCard) });

const arrangeGetRoute = createRoute({
  method: "get",
  path: "/home/arrange",
  tags: ["Widgets"],
  summary: "Every Home card I may see, hidden ones included, in my current order, for the Arrange screen",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: ArrangeList } }, description: "My cards with hidden flags." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
widgetsRoutes.openapi(arrangeGetRoute, (c) => {
  const actor = c.get("person");
  return c.json({ cards: arrangeHomeCards(listWidgets(actor), actor) }, 200);
});

const arrangePutRoute = createRoute({
  method: "put",
  path: "/home/arrange",
  tags: ["Widgets"],
  summary: "Save my Home card order and hidden list (empty lists restore the default)",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ order: z.array(z.string()).max(200), hidden: z.array(z.string()).max(200) }) } } } },
  responses: {
    200: { content: { "application/json": { schema: ArrangeList } }, description: "Saved; my cards as they now stand." },
    ...errorResponses({ 400: "A card is not available to me", 401: "Not signed in", 403: "Not allowed" }),
  },
});
widgetsRoutes.openapi(arrangePutRoute, (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const result = saveHomeArrangement(actor, listWidgets(actor), body.order, body.hidden);
  if (!result.ok) return respond(c, result);
  return c.json({ cards: result.value }, 200);
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
  if (!result.ok) return respond(c, result);
  return c.json(result.value, 200);
});
