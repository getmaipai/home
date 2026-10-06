import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speakerAgeBand } from "@/lib/ageBand";
import { getAnswerImage } from "@/lib/answerImages/cache";

export const answerImageRoutes = apiRouter();
const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Sources"],
  summary: "A checked answer picture served from Home's cache",
  middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string().regex(/^ai_[a-f0-9]{32}$/).openapi({ param: { name: "id", in: "path" } }) }), query: z.object({ v: z.enum(["tile", "full"]).default("tile") }) },
  responses: {
    200: { content: { "image/webp": { schema: z.string() } }, description: "A cached, re-encoded picture." },
    404: { description: "No picture is available for this person." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
answerImageRoutes.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { v } = c.req.valid("query");
  const actor = c.get("person");
  const band = speakerAgeBand(actor, new Date());
  const bytes = await getAnswerImage(id, band, v);
  if (!bytes) return c.body(null, 404);
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "private, max-age=86400");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  return c.body(new Uint8Array(bytes), 200);
});
