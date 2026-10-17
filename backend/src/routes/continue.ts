// MEDIA-PROGRESS-01: the Home page's "Pick up where you left off" rows. Own rows only (chats and unfinished media), newest first,
// three at most (lib/continue/registry.ts). The shelf draws them; this is the data.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { CONTINUE_BUDGET, continueRows } from "@/lib/continue/registry";
import "@/lib/continue/providers";

export const continueRoutes = apiRouter();

const RowSchema = z.object({
  source: z.string(), kind: z.enum(["chat", "media"]), id: z.string(), title: z.string(), subtitle: z.string().nullable(),
  href: z.string().describe("Where the row leads. Chats: /chat?conversation=<id>. Media: /media/<item id>, which the shell resolves to the app that plays it."),
  at: z.string(), percent: z.number().nullable(), media_kind: z.string().nullable(), artwork_url: z.string().nullable(),
});

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Continue"],
  summary: "Where I left off: my last chats and my unfinished titles, newest first, three at most",
  middleware: [requireAuth] as const,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(CONTINUE_BUDGET).default(CONTINUE_BUDGET) }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ rows: z.array(RowSchema) }) } }, description: "My rows. A guest gets none." }, ...errorResponses({ 401: "Not signed in" }) },
});
continueRoutes.openapi(route, (c) => c.json({ rows: continueRows(c.get("person"), c.req.valid("query").limit) }, 200));
