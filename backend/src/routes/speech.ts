// PACK-06b: GET /api/speech/cmu, the pronouncing dictionary for the companion pack's mouth cues. The browser fetches it
// only when a pack companion first speaks, then the HTTP cache keeps it. No dialog text passes through here.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { speechDictionary } from "@/lib/speechDictionary";

export const speechRoutes = apiRouter();

const cmuRoute = createRoute({
  method: "get",
  path: "/cmu",
  tags: ["Voice"],
  summary: "Pronouncing dictionary for companion mouth cues",
  description: "Returns a JSON object of word to phonemes. Served gzip-compressed when the browser accepts it, with an ETag and a long private cache.",
  middleware: [requireAuth] as const,
  responses: {
    200: { content: { "application/json": { schema: z.record(z.string(), z.string()) } }, description: "The dictionary." },
    304: { description: "The browser's cached copy is current." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});

speechRoutes.openapi(cmuRoute, (async (c: any) => {
  const dict = await speechDictionary();
  const headers: Record<string, string> = { ETag: dict.etag, "Cache-Control": "private, max-age=604800", "Content-Type": "application/json", Vary: "Accept-Encoding" };
  if (c.req.header("if-none-match") === dict.etag) return new Response(null, { status: 304, headers });
  if (/\bgzip\b/.test(c.req.header("accept-encoding") ?? "")) return new Response(dict.gzip, { status: 200, headers: { ...headers, "Content-Encoding": "gzip" } });
  return new Response(dict.json, { status: 200, headers });
}) as never);
