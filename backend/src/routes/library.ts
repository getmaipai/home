import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listLibrary, librarySummary, LibraryCursorError } from "@/lib/library";

export const libraryRoutes = apiRouter();
const kind = z.enum(["image", "video", "audio", "document", "story", "file"]);
const query = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(60), cursor: z.string().optional(),
  type: kind.optional(), owner: z.string().min(1).optional(), shared: z.enum(["with-me", "by-me"]).optional(),
  search: z.string().max(1000).optional(), sort: z.enum(["newest", "oldest", "name", "size"]).default("newest"),
});
const totals = z.object({ items: z.number(), bytes: z.number() });
const item = z.object({
  id: z.string(), kind, name: z.string(), media_type: z.string(), size_bytes: z.number(), created_at: z.string(),
  owner: z.object({ id: z.string(), display_name: z.string() }), shared_with: z.object({ count: z.number(), household: z.boolean() }),
  retention: z.string(), audience: z.enum(["all-ages", "adult-only"]).nullable(), duration_seconds: z.number().nullable(),
  thumb_url: z.string().describe("Placeholder for LIBRARY-REVAMP-05; thumbnail serving is not built yet."), expires_at: z.string().nullable(), version_count: z.number(),
});
libraryRoutes.openapi(createRoute({ method: "get", path: "/", tags: ["Library"], summary: "Visible Library items, paged and filtered",
  middleware: [requireAuth] as const, request: { query }, responses: {
    200: { description: "One page. The next cursor keeps the same filters and sort.", content: { "application/json": { schema: z.object({ items: z.array(item), next_cursor: z.string().nullable() }) } } },
    ...errorResponses({ 400: "Invalid page address. Open the Library again.", 401: "Not signed in" }),
  } }), c => {
  try { return c.json(listLibrary(c.get("person"), c.req.valid("query")),200); }
  catch (error) { if (error instanceof LibraryCursorError) return c.json({ error: error.message },400); throw error; }
});
libraryRoutes.openapi(createRoute({ method: "get", path: "/summary", tags: ["Library"], summary: "Visible Library counts and stored bytes by kind",
  middleware: [requireAuth] as const, request: { query: query.omit({ cursor: true, limit: true, sort: true }) }, responses: {
    200: { description: "Item counts fold companions and versions. Bytes include all visible stored references, matching Storage. Trash and expiring remain zero until their providers exist.", content: { "application/json": { schema: totals.extend({ per_kind: z.record(z.string(),totals), trash: totals, expiring: totals }) } } },
    ...errorResponses({ 401: "Not signed in" }),
  } }), c => c.json(librarySummary(c.get("person"),c.req.valid("query")),200));
