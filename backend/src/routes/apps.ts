// APP-KIND-03: the list of launchable package apps. lib/apps.ts holds the rules and the gate; this is only
// the HTTP boundary, the same split every other routes/*.ts file here takes over its lib module.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listApps } from "@/lib/apps";

export const appsRoutes = apiRouter();

const AppRow = z.object({
  package: z.string(),
  page: z.literal("index"),
  label: z.string(),
  icon: z.string(),
  description: z.string(),
  category: z.string(),
  keywords: z.array(z.string()),
  sections: z.array(z.object({ page: z.string(), label: z.string(), icon: z.string().nullable() })),
  sidebar: z.object({
    search: z.record(z.string(), z.unknown()).optional().describe("The app's search node, present only when its target page is the asking person's to open."),
    groups: z.array(z.object({
      id: z.string(),
      title: z.string().optional(),
      pages: z.array(z.object({ page: z.string(), label: z.string(), icon: z.string().nullable() })).optional(),
      rows: z.record(z.string(), z.unknown()).optional(),
    })),
  }).optional().describe("The app's own sidebar column (NEWS-SIDEBAR-01), already reduced to what the asking person may open."),
  to: z.string().describe("The app's route in the web shell: /apps/<package id>."),
  settings_area: z.record(z.string(), z.unknown()).optional().describe("The package's own settings area as its manifest declares it (present only when it declares one and the asking person's role may open it); the shell draws it at /settings/<id>."),
  pinned_by_default: z.boolean().optional().describe("The app's manifest asks to be pinned in the left rail for a person who has never chosen their own pins."),
  pin_order: z.number().int().optional().describe("Where this app sits among the default pins, lowest first."),
  incognito: z.enum(["blocked", "ephemeral", "unaffected"]).describe("The package's Incognito behaviour; the shell hides a blocked app while Incognito is on."),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Apps"],
  summary: "Every installed package app the asking person may open",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.array(AppRow) } }, description: "Apps at or below the person's role that are enabled, runnable here and have all their required capabilities." },
    ...errorResponses({ 401: "Sign in first" }),
  },
});
appsRoutes.openapi(listRoute, (c) => c.json(listApps(c.get("person")), 200));
