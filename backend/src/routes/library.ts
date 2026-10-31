import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { listLibrary, librarySummary, LibraryCursorError } from "@/lib/library";
import { assertLibraryUploadAllowed, beginLibraryUpload, appendLibraryUpload, finishLibraryUpload, cancelLibraryUpload, UploadError } from "@/lib/libraryUploadStream";
import { MAX_LIBRARY_UPLOAD_BYTES } from "@/lib/libraryUpload";
import { libraryMultipart } from "@/lib/libraryMultipart";

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
  retention: z.string(), origin: z.enum(["made", "sent", "fetched"]), chat_id: z.string().nullable().describe("The chat that made or received this item, while it exists and only for the owner."), turn_id: z.string().nullable(), chat_title: z.string().nullable(), chat_deleted: z.boolean(), can_edit: z.boolean().describe("A picture the owner can open in the picture editor (it lives in its chat); false once the chat is gone."), audience: z.enum(["all-ages", "adult-only"]).nullable(), duration_seconds: z.number().nullable(),
  thumb_url: z.string().describe("Same-origin thumbnail URL served by the file thumbnail route."), expires_at: z.string().nullable(), version_count: z.number(),
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

libraryRoutes.openAPIRegistry.registerPath(createRoute({ method: "post", path: "/upload", tags: ["Library"], summary: "Add one file; use /uploads sessions above the server body limit",
  middleware: [requireAuth] as const,
  request: { body: { content: { "multipart/form-data": { schema: z.object({ file: z.any().describe("The file. Pictures, videos, songs, PDF, office documents and plain text. Use /uploads sessions above the server body limit (128 MB).") }) } } } },
  responses: {
    201: { description: "Added and kept until deleted. `duplicate` is true when the same file was already in the Library.", content: { "application/json": { schema: z.object({ id: z.string(), name: z.string(), kind: z.string(), media_type: z.string(), size_bytes: z.number(), duplicate: z.boolean() }) } } },
    ...errorResponses({ 400: "Not a supported file, empty, or an unreadable picture", 401: "Not signed in", 403: "Storage is full, or a child (ask a grown-up)", 413: "File too large. Use chunks for files above the server limit", 404: "Upload unavailable", 409: "Upload busy" }),
  } }));
// Register the handler directly: zod-openapi form validation would buffer the multipart body.
libraryRoutes.post("/upload", requireAuth, async c => {
  let id: string | undefined;
  try {
    const actor = c.get("person");
    // Authorize before reading any bytes, including multipart headers.
    assertLibraryUploadAllowed(actor);
    const upload = await libraryMultipart(c.req.raw);
    let named;
    try { named = await beginLibraryUpload(actor, upload.name, Infinity); }
    catch (error) { await upload.body.cancel().catch(() => {}); throw error; }
    id = named.upload_id;
    // Legacy single-request uploads retain Bun's default body limit; larger files use sessions.
    await appendLibraryUpload(actor, id, upload.body, 0, MAX_LIBRARY_UPLOAD_BYTES);
    const result = await finishLibraryUpload(actor, id); id = undefined;
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.value, 201);
  } catch (error) {
    if (id) await cancelLibraryUpload(c.get("person"), id).catch(() => {});
    if (error instanceof UploadError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

libraryRoutes.openapi(createRoute({
  method: "post", path: "/uploads", tags: ["Library"], summary: "Start a streamed Library upload up to 500 MB",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ name: z.string().min(1).max(1000) }) } } } },
  responses: { 201: { description: "An owner-bound session expires after one hour. PUT sequential chunks, then POST finish. No Library record exists before finish.", content: { "application/json": { schema: z.object({ upload_id: z.string(), chunk_bytes: z.number(), max_bytes: z.number() }) } } }, ...errorResponses({ 400: "Invalid upload", 404: "Upload unavailable", 413: "Upload too large", 401: "Not signed in", 403: "Ask a grown-up", 409: "Finish or cancel an upload first" }) },
}), async c => {
  try { return c.json(await beginLibraryUpload(c.get("person"), c.req.valid("json").name), 201); }
  catch (e) { if (e instanceof UploadError) return c.json({ error: e.message }, e.status); throw e; }
});
const uploadParam = z.object({ id: z.string() });
const uploadErrors = errorResponses({ 400: "Upload stopped or file unreadable. Add it again.", 401: "Not signed in", 403: "Storage full or uploads unavailable", 404: "Upload unavailable. Add it again.", 409: "Chunk out of order or upload busy", 413: "File or chunk too large. Use smaller chunks or a smaller file." });
libraryRoutes.openapi(createRoute({
  method: "put", path: "/uploads/{id}", tags: ["Library"], summary: "Stream the next chunk (up to 8 MB)", middleware: [requireAuth] as const,
  request: { params: uploadParam, query: z.object({ offset: z.coerce.number().int().nonnegative() }), body: { content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } } } },
  responses: { 200: { description: "Next byte offset; wait for this response before sending another chunk.", content: { "application/json": { schema: z.object({ offset: z.number() }) } } }, ...uploadErrors },
}), async c => {
  try { return c.json(await appendLibraryUpload(c.get("person"), c.req.valid("param").id, c.req.raw.body, c.req.valid("query").offset), 200); }
  catch (e) { if (e instanceof UploadError) return c.json({ error: e.message }, e.status); throw e; }
});
libraryRoutes.openapi(createRoute({
  method: "post", path: "/uploads/{id}/finish", tags: ["Library"], summary: "Validate and store a finished upload", middleware: [requireAuth] as const,
  request: { params: uploadParam }, responses: { 201: { description: "The kept Library file, deduplicated by hash.", content: { "application/json": { schema: z.object({ id: z.string(), name: z.string(), kind: z.string(), media_type: z.string(), size_bytes: z.number(), duplicate: z.boolean() }) } } }, ...uploadErrors },
}), async c => {
  try { const result = await finishLibraryUpload(c.get("person"), c.req.valid("param").id); if (!result.ok) return c.json({ error: result.error }, result.status); return c.json(result.value, 201); }
  catch (e) { if (e instanceof UploadError) return c.json({ error: e.message }, e.status); throw e; }
});
libraryRoutes.openapi(createRoute({
  method: "delete", path: "/uploads/{id}", tags: ["Library"], summary: "Cancel an upload and remove its staging file", middleware: [requireAuth] as const,
  request: { params: uploadParam }, responses: { 200: { description: "Cancelled", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } }, ...uploadErrors },
}), async c => {
  try { await cancelLibraryUpload(c.get("person"), c.req.valid("param").id); return c.json({ ok: true }, 200); }
  catch (e) { if (e instanceof UploadError) return c.json({ error: e.message }, e.status); throw e; }
});
