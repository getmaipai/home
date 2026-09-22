// SRC-ICON-01 (c-99e5b part 2): the one place the hub reaches out to a
// cited site's own server, so the browser never has to. See
// lib/favicons.ts for the validation, fetch, and disk-cache mechanics;
// this file is only the HTTP boundary, the same split every other
// routes/*.ts file here takes over its own lib module.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { validateFaviconHost, getFavicon } from "@/lib/favicons";

export const faviconRoutes = apiRouter();

const getRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Sources"],
  summary: "A cited site's own icon, fetched and cached by the hub - never a third-party call from the browser",
  middleware: [requireAuth] as const,
  request: { query: z.object({ domain: z.string().openapi({ param: { name: "domain", in: "query" }, example: "wikipedia.org" }) }) },
  responses: {
    200: { content: { "image/*": { schema: z.string() } }, description: "The icon's own bytes, as fetched or served from cache." },
    204: { description: "The site has no icon (or none this route accepts), also cached so it's asked at most once." },
    ...errorResponses({ 400: "domain is not a valid, public hostname", 401: "Not signed in" }),
  },
});

faviconRoutes.openapi(getRoute, async (c) => {
  const { domain } = c.req.valid("query");
  const validation = await validateFaviconHost(domain);
  if (!validation.ok) return c.json({ error: validation.error }, 400);
  const result = await getFavicon(validation.host);
  if (!result.found) return c.body(null, 204);
  c.header("Content-Type", result.contentType);
  // A favicon changes rarely and this route is itself the cache - a
  // day is plenty to spare the browser a repeat request without ever
  // risking a genuinely stale icon for long.
  c.header("Cache-Control", "private, max-age=86400");
  // A fresh, plain ArrayBuffer-backed copy: `result.bytes` can be a
  // Node `Buffer` (readFileSync) or a view from lib/favicons.ts's own
  // capped reader, neither of which Hono's `c.body()` types accept
  // directly.
  return c.body(new Uint8Array(result.bytes), 200);
});
