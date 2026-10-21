import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { searchMedia } from "@/lib/media/search";

export const mediaSearchRoutes = apiRouter();

const RowSchema = z.object({
  id: z.string(), app: z.enum(["videos", "shows", "music", "podcasts", "books"]), kind: z.string(), title: z.string(),
  subtitle: z.string().nullable(), artwork_url: z.string().nullable(), href: z.string(), percent: z.number().nullable(), at: z.string(),
});

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Media"],
  summary: "Search readable media titles and made-at-home songs and clips",
  middleware: [requireAuth] as const,
  request: { query: z.object({ q: z.string().min(1).openapi({ param: { name: "q", in: "query" } }) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            groups: z.array(z.object({
              app: z.enum(["videos", "shows", "music", "podcasts", "books"]),
              heading: z.string(),
              rows: z.array(RowSchema),
            })),
          }),
        },
      },
      description: "Matching readable titles, grouped by app.",
    },
    ...errorResponses({ 400: "Missing or empty q", 401: "Not signed in" }),
  },
});

mediaSearchRoutes.openapi(route, (c) => c.json({ groups: searchMedia(c.get("person"), c.req.valid("query").q) }, 200));
