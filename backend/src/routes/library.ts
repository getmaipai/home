import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { bodyLimit } from "hono/body-limit";
import { requireAuth } from "@/middleware/auth";
import { listLibrary, librarySummary, LibraryCursorError } from "@/lib/library";
import { uploadToLibrary, MAX_LIBRARY_UPLOAD_BYTES } from "@/lib/libraryUpload";

export const libraryRoutes = apiRouter();
const kind = z.enum(["image", "video", "audio", "document", "story", "file"]);
const query = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(60), cursor: z.string().optional(),
  type: kind.optional(), owner: z.string().min(1).optional(), shared: z.enum(["with-me", "by-me", "none"], { error: "Invalid shared filter. Choose with-me, by-me, or none." }).optional().describe("with-me: shared with the caller; by-me: owned by the caller with a share; none: owned by the caller with no shares (Only me)."),
  search: z.string().max(1000).optional(), sort: z.enum(["newest", "oldest", "name", "size"]).default("newest"),
});
const totals = z.object({ items: z.number(), bytes: z.number() });
const item = z.object({
  id: z.string(), kind, name: z.string(), media_type: z.string(), size_bytes: z.number(), created_at: z.string(),
  owner: z.object({ id: z.string(), display_name: z.string() }), shared_with: z.object({ count: z.number(), household: z.boolean() }),
  retention: z.string(), chat_id: z.string().nullable().describe("The chat that made or received this item, while it exists and only for the owner."), can_edit: z.boolean().describe("A picture the owner can open in the picture editor (it lives in its chat); false once the chat is gone."), audience: z.enum(["all-ages", "adult-only"]).nullable(), duration_seconds: z.number().nullable(),
  thumb_url: z.string().describe("Placeholder for LIBRARY-REVAMP-05; thumbnail serving is not built yet."), expires_at: z.string().nullable(), version_count: z.number(),
});
libraryRoutes.openapi(createRoute({ method: "get", path: "/", tags: ["Library"], summary: "Visible Library items, paged and filtered",
  middleware: [requireAuth] as const, request: { query }, responses: {
    200: { description: "One page. The next cursor keeps the same filters and sort.", content: { "application/json": { schema: z.object({ items: z.array(item), next_cursor: z.string().nullable() }) } } },
    ...errorResponses({ 400: "Invalid page address or filter. Use shared=with-me, by-me, or none.", 401: "Not signed in" }),
  } }), c => {
  try { return c.json(listLibrary(c.get("person"), c.req.valid("query")),200); }
  catch (error) { if (error instanceof LibraryCursorError) return c.json({ error: error.message },400); throw error; }
});
libraryRoutes.openapi(createRoute({ method: "get", path: "/summary", tags: ["Library"], summary: "Visible Library counts and stored bytes by kind",
  middleware: [requireAuth] as const, request: { query: query.omit({ cursor: true, limit: true, sort: true }) }, responses: {
    200: { description: "Item counts fold companions and versions. Bytes include all visible stored references, matching Storage. Trash counts the caller's own deleted files; expiring stays zero until the removal preview is wired.", content: { "application/json": { schema: totals.extend({ per_kind: z.record(z.string(),totals), trash: totals, expiring: totals }) } } },
    ...errorResponses({ 400: "Invalid filter. Use shared=with-me, by-me, or none.", 401: "Not signed in" }),
  } }), c => c.json(librarySummary(c.get("person"),c.req.valid("query")),200));

libraryRoutes.openapi(createRoute({ method: "post", path: "/upload", tags: ["Library"], summary: "Add one file to my Library (one file per request)",
  middleware: [requireAuth, bodyLimit({ maxSize: MAX_LIBRARY_UPLOAD_BYTES + 64 * 1024, onError: (c) => c.json({ error: "That file is bigger than 500 MB. Choose a smaller file." }, 413) })] as const,
  request: { body: { content: { "multipart/form-data": { schema: z.object({ file: z.any().describe("The file. Pictures, videos, songs, PDF, office documents and plain text, up to 500 MB.") }) } } } },
  responses: {
    201: { description: "Added and kept until deleted. `duplicate` is true when the same file was already in the Library.", content: { "application/json": { schema: z.object({ id: z.string(), name: z.string(), kind: z.string(), media_type: z.string(), size_bytes: z.number(), duplicate: z.boolean() }) } } },
    ...errorResponses({ 400: "Not a supported file, empty, or an unreadable picture", 401: "Not signed in", 403: "Storage is full, or a child (ask a grown-up)", 413: "Larger than 500 MB" }),
  } }), async c => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: "Choose a file to add." }, 400);
  // Refuse a declared size over the limit before the bytes are read into memory.
  if (file.size > MAX_LIBRARY_UPLOAD_BYTES) return c.json({ error: "That file is bigger than 500 MB. Choose a smaller file." }, 413);
  const result = await uploadToLibrary(c.get("person"), { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 201);
});
