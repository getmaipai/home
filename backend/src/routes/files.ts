// STORE-SHARE-01: the Library's own HTTP boundary - lib/shares.ts and
// lib/attachments.ts hold the rules, this is only the wire, the same
// split routes/lists.ts already takes over lib/lists.ts.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getAttachment, readAttachment } from "@/lib/attachments";
import { createShare, deleteShare, listSharesForFile, listFilesVisibleToActor, listPersonFilesVisibleToActor } from "@/lib/shares";
import { File as FileSchema } from "@maipai/spec/gen/ts/file.js";
import { Share as ShareSchema } from "@maipai/spec/gen/ts/share.js";

export const filesRoutes = apiRouter();
// A share is its own addressable resource (share.schema.json), so its
// one route (unsharing) is a separate router mounted at /api/shares in
// app.ts - the URL a client PATCH/DELETEs against a share should read
// share-shaped, not nested under /api/files/shares/{id}.
export const sharesRoutes = apiRouter();

const VisibleFileSchema = z.object({
  file: FileSchema,
  owner_person_id: z.string(),
  shared: z.boolean(),
  // STORE-DELETE-01: the owner was deleted while the file was shared, so
  // it is the household's; former_owner_name is who shared it.
  household: z.boolean(),
  former_owner_name: z.string().nullable(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Files"],
  summary: "My own Library, or (with ?owner=) one person's own files filtered to what I may see",
  middleware: [requireAuth] as const,
  // PEOPLE-PROFILE-02: `owner` scopes the same visibility rule to one
  // person's files (the profile page's shared-media grid) instead of
  // building a second listing mechanism - FilesPage.tsx's Library still
  // calls this with no `owner` at all and gets its own unfiltered list,
  // unchanged.
  request: { query: z.object({ owner: z.string().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(VisibleFileSchema) } }, description: "A shared file is listed under its real owner, once, whether shared directly or via the household." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
filesRoutes.openapi(listRoute, (c) => {
  const actor = c.get("person");
  const { owner } = c.req.valid("query");
  const visible = owner ? listPersonFilesVisibleToActor(actor, owner) : listFilesVisibleToActor(actor);
  const rows = visible.map((row) => ({ file: row.file, owner_person_id: row.ownerPersonId, shared: row.shared, household: row.household, former_owner_name: row.formerOwnerName }));
  return c.json(rows, 200);
});

const getRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Files"],
  summary: "One file - visible to its owner or to anyone a live share names",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: FileSchema } }, description: "Found." },
    ...errorResponses({ 401: "Not signed in", 404: "No such file, or not shared with you" }),
  },
});
filesRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const result = getAttachment(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});

// PEOPLE-PROFILE-02: the real bytes, gated by the exact same
// `canAccessFile` boundary `getAttachment`/`readAttachment` already
// enforce (lib/attachments.ts) - MediaGrid's `thumbnailUrl` has to
// point somewhere real, and nothing anywhere in this codebase served a
// file's own bytes over HTTP before this (checked directly: only
// lib/attachments.ts's `readAttachment` existed, called from
// documentExtraction.ts and tests, never a route). Same pattern as
// routes/favicon.ts's own image response.
const contentRoute = createRoute({
  method: "get",
  path: "/{id}/content",
  tags: ["Files"],
  summary: "A file's own bytes - visible to its owner or to anyone a live share names",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { content: { "image/*": { schema: z.string() } }, description: "The file's own bytes, its real media type." },
    206: { content: { "image/*": { schema: z.string() } }, description: "A `Range` request's own slice, for video seeking (MediaGrid's lightbox)." },
    ...errorResponses({ 401: "Not signed in", 404: "No such file, not shared with you, or its bytes are missing", 500: "Stored bytes failed an integrity check" }),
  },
});
filesRoutes.openapi(contentRoute, (c) => {
  const actor = c.get("person");
  const result = readAttachment(actor, c.req.valid("param").id);
  // readAttachment's own status type is the general AttachmentOpResult
  // union (400 | 403 | 404 | 500), broader than what it actually ever
  // returns (404 for no access/missing bytes, 500 for a failed
  // integrity check) - narrowed here the same way getRoute above
  // hardcodes 404 rather than passing `result.status` straight through.
  if (!result.ok) return c.json({ error: result.error }, result.status === 500 ? 500 : 404);
  const { bytes, record } = result.value;
  // A code review caught the first cut of this: sha256 content-addressing
  // (file.schema.json) makes the BYTES at this id immutable forever, but
  // it says nothing about whether the REQUESTING ACTOR is still allowed
  // to see them - a share can be revoked and "takes effect at once"
  // (lib/shares.ts's own deleteShare() comment), so an `immutable,
  // max-age=1y` response would have let a browser keep serving a
  // recipient cached bytes for a file unshared out from under them,
  // with no request ever reaching this access check again. Correctness
  // over cache efficiency: never cached.
  const headers: Record<string, string> = {
    "content-type": record.media_type,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  };

  // Range support (a code review, PEOPLE-PROFILE-02): MediaGrid's own
  // lightbox plays a shared video with a real `<video controls>` element,
  // and a browser seeking or starting playback sends a `Range` request -
  // returning a full 200 body unconditionally either breaks seeking or
  // (Safari in particular, per this codebase's own YouTube-wall history)
  // refuses to play at all. `lib/modelDownload.ts`'s own Range usage is
  // the opposite direction (this hub AS THE CLIENT resuming a download);
  // there was no existing server-side Range responder to reuse, so this
  // is the one place that needed it, kept minimal (a single "bytes=a-b"
  // range, the only shape a real browser's own video element sends). A
  // raw `Response` here, not `c.body()`, the same pattern `voice.ts`'s
  // own cloned-voice file route already uses for a binary body: two
  // 2xx statuses (200 and 206) sharing one content schema defeats
  // `c.body()`'s generated overloads (found live - both calls failed
  // `tsc --noEmit` with "Uint8Array is not assignable to null").
  const range = c.req.header("Range");
  const rangeMatch = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (rangeMatch) {
    const total = bytes.byteLength;
    // A code review caught the first cut of this treating an empty
    // start as `0` unconditionally - correct for "bytes=500-" (from
    // byte 500 to the end), wrong for the suffix form "bytes=-500"
    // (RFC 7233: the LAST 500 bytes), which this codebase's own tests
    // don't send today but a real video player's seek-to-end can. Both
    // empty means the whole file (`bytes=-` never occurs in practice,
    // handled the same way for safety).
    const hasStart = rangeMatch[1] !== "";
    const start = hasStart ? Number(rangeMatch[1]) : Math.max(total - Number(rangeMatch[2] || 0), 0);
    const end = hasStart && rangeMatch[2] ? Number(rangeMatch[2]) : total - 1;
    // An unsatisfiable range (past the end, reversed) falls through to
    // the plain full-body response below rather than a strict RFC 7233
    // 416 - a real browser's own video element computes ranges from the
    // Content-Length it was just given, so this only ever guards against
    // a range this server itself would never have implied.
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end < total) {
      const slice = bytes.subarray(start, end + 1);
      headers["content-range"] = `bytes ${start}-${end}/${total}`;
      // A code review caught this never being asserted (a real gap in
      // the exact case - partial video content - this route exists
      // for): set explicitly rather than assumed, since this test
      // harness's own `app.request()` doesn't compute it automatically
      // the way a real Bun.serve() response over the wire would.
      headers["content-length"] = String(slice.byteLength);
      return new Response(slice, { status: 206, headers });
    }
  }
  headers["content-length"] = String(bytes.byteLength);
  return new Response(bytes, { status: 200, headers });
});

const listSharesRoute = createRoute({
  method: "get",
  path: "/{id}/shares",
  tags: ["Files"],
  summary: "Who a file is shared with - visible to anyone who can already see the file",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.array(ShareSchema) } }, description: "Every live share pointer on this file." },
    ...errorResponses({ 401: "Not signed in", 404: "No such file, or not shared with you" }),
  },
});
filesRoutes.openapi(listSharesRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const found = getAttachment(actor, id);
  if (!found.ok) return c.json({ error: found.error }, 404);
  return c.json(listSharesForFile(id), 200);
});

const createShareRoute = createRoute({
  method: "post",
  path: "/{id}/shares",
  tags: ["Files"],
  summary: "Share a file with a named person or the household",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "file-a1b2c3"),
    body: { content: { "application/json": { schema: z.object({ to: z.string().min(1) }) } } },
  },
  responses: {
    201: { content: { "application/json": { schema: ShareSchema } }, description: "Shared - or, for a target already sharing the file, the existing pointer." },
    ...errorResponses({ 400: "Not a real household target", 401: "Not signed in", 403: "You do not have access to this file", 404: "No such file" }),
  },
});
filesRoutes.openapi(createShareRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const { to } = c.req.valid("json");
  const result = createShare(actor, { fileId: id, to });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 201);
});

const deleteShareRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Files"],
  summary: "Unshare - a real delete, takes effect at once",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "share-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ deletedShareIds: z.array(z.string()) }) } }, description: "This pointer, plus any re-share that depended on it." },
    ...errorResponses({ 401: "Not signed in", 403: "You may not remove this share", 404: "No such share" }),
  },
});
sharesRoutes.openapi(deleteShareRoute, (c) => {
  const actor = c.get("person");
  const result = deleteShare(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});
