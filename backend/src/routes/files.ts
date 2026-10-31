import { recheckFileAudience } from "@/lib/libraryAudience";
import { fileThumbnail } from "@/lib/fileThumbnails";
// STORE-SHARE-01: the Library's own HTTP boundary - lib/shares.ts and
// lib/attachments.ts hold the rules, this is only the wire, the same
// split routes/lists.ts already takes over lib/lists.ts.
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { requireAuth } from "@/middleware/auth";
import { getAttachment, readAttachment } from "@/lib/attachments";
import { canDeleteInherited, trashFile } from "@/lib/libraryTrash";
import { updateLibraryFile } from "@/lib/libraryEdit";
import { createShare, deleteShare, listSharesForFile, listFilesVisibleToActor, listPersonFilesVisibleToActor } from "@/lib/shares";
import { File as FileSchema } from "@maipai/spec/gen/ts/file.js";
import { Share as ShareSchema } from "@maipai/spec/gen/ts/share.js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, conversations } from "@/db/schema";
import { musicJobs, people } from "@/db/schema";
import { musicVersions, getMusicJobFor } from "@/lib/music/jobs";
import { sungLyricsFromLrc, withoutLastLines } from "@/lib/music/sections";
import { canAccessFile } from "@/lib/access";

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
    200: { content: { "application/json": { schema: FileSchema.extend({ chat_id: z.string().nullable().optional(), turn_id: z.string().nullable().optional(), chat_title: z.string().nullable().optional(), chat_deleted: z.boolean().optional(), music: z.object({ id: z.string(), title: z.string().nullable(), description: z.string().nullable(), lyrics: z.string().nullable(), timed_lyrics: z.array(z.object({ t: z.number(), line: z.string(), section: z.string().nullable() })).nullable(), cover_url: z.string().nullable(), versions: z.array(z.object({ id: z.string(), label: z.string(), url: z.string() })), current_id: z.string().nullable(), owner: z.boolean() }).optional() }) } }, description: "Found. Chat provenance is included only for the file owner. Home-made song player data follows file access." },
    ...errorResponses({ 401: "Not signed in", 404: "No such file, or not shared with you" }),
  },
});
filesRoutes.openapi(getRoute, (c) => {
  const actor = c.get("person");
  const result = getAttachment(actor, c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  const songRow = db.select().from(musicJobs).where(eq(musicJobs.fileId, c.req.valid("param").id)).get();
  let music: { id: string; title: string | null; description: string | null; lyrics: string | null; timed_lyrics: { t: number; line: string; section: string | null }[] | null; cover_url: string | null; versions: { id: string; label: string; url: string }[]; current_id: string | null; owner: boolean } | undefined;
  if (songRow && songRow.state === "done") {
    const ownerPerson = db.select().from(people).where(eq(people.id, songRow.personId)).get();
    const root = ownerPerson ? getMusicJobFor(ownerPerson, songRow.id) : null;
    if (ownerPerson && root) {
      const versions = (musicVersions(ownerPerson, root).length ? musicVersions(ownerPerson, root) : [root]).filter(version => version.fileId && canAccessFile(actor, ownerPerson.id, version.fileId));
      const current = [...versions].sort((a, b) => (b.chosenAt ?? b.createdAt).localeCompare(a.chosenAt ?? a.createdAt) || b.id.localeCompare(a.id))[0];
      const request = current?.request ?? root.request;
      let lyrics = request.instrumental ? null : request.lyrics ?? null;
      if (lyrics && current?.lrc) {
        const sung = sungLyricsFromLrc(current.lrc, current.durationS);
        const timed = sungLyricsFromLrc(current.lrc, null, { keepSqueezed: true });
        if (sung.length && sung.length < timed.length) lyrics = withoutLastLines(lyrics, timed.length - sung.length);
      }
      music = {
        id: root.id, title: (current?.request.title ?? request.title) ?? null, description: (current?.request.description ?? request.description) ?? null,
        lyrics,
        timed_lyrics: current?.lrc && !current.request.instrumental ? sungLyricsFromLrc(current.lrc, current.durationS).map(({ t, line, section }) => ({ t, line, section })) : null,
        cover_url: (current?.coverFileId ?? root.coverFileId) ? `/api/files/${songRow.fileId}/thumb?w=640` : null,
        versions: versions.map((version, index) => ({ id: version.fileId!, label: `Version ${index + 1}`, url: `/api/files/${version.fileId}/content` })),
        current_id: current?.fileId ?? songRow.fileId, owner: actor.id === ownerPerson.id,
      };
    }
  }
  const attachment = db.select({ ownerPersonId: attachments.ownerPersonId, conversationId: attachments.conversationId, turnId: attachments.turnId }).from(attachments).where(eq(attachments.id, c.req.valid("param").id)).get();
  if (!attachment || attachment.ownerPersonId !== actor.id) return c.json(music ? { ...result.value, music } : result.value, 200);
  const conversation = attachment.conversationId
    ? db.select({ id: conversations.id, title: conversations.title, status: conversations.status }).from(conversations).where(eq(conversations.id, attachment.conversationId)).get()
    : undefined;
  const live = conversation && conversation.status !== "deleted" ? conversation : undefined;
  return c.json({ ...result.value, ...(music ? { music } : {}), chat_id: live?.id ?? null, turn_id: live?.id ? attachment.turnId : null, chat_title: live?.title ?? null, chat_deleted: Boolean(attachment.conversationId && !live) }, 200);
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

const thumbnailRoute = createRoute({
  method: "get", path: "/{id}/thumb", tags: ["Files"], summary: "A private derived preview, revalidated through file access",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3"), query: z.object({ w: z.string().optional() }) },
  responses: {
    200: { content: { "image/webp": { schema: z.string() } }, description: "A preview bounded to 320 or 640 pixels." },
    304: { description: "Preview unchanged after checking access." },
    400: { content: { "text/plain": { schema: z.string() } }, description: "Use w=320 or w=640." },
    404: { content: { "text/plain": { schema: z.string() } }, description: "File unavailable or no preview." },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
filesRoutes.openapi(thumbnailRoute, (c) => {
  const { w } = c.req.valid("query");
  if (w !== "320" && w !== "640") return c.text("Use w=320 or w=640.",400);
  return fileThumbnail(c.get("person"),c.req.valid("param").id,Number(w) as 320 | 640,c.req.header("If-None-Match"));
});

const deleteFileRoute = createRoute({
  method: "delete", path: "/{id}", tags: ["Files"], summary: "Move one of my own Library files to Trash",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string(), deleted_at: z.string(), trash_until: z.string() }) } }, description: "In Trash until trash_until; Restore from Trash brings it back with its sharing." },
    ...errorResponses({ 401: "Not signed in", 403: "Only the person who owns a file can delete it", 404: "No such file in your Library" }),
  },
});
filesRoutes.openapi(deleteFileRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const found = getAttachment(actor, id);
  if (!found.ok) return c.json({ error: "That file is not in your Library. Refresh the page and try again." }, 404);
  // Issue 213: a file inherited from someone who left the household can be deleted by an owner or admin; it goes to Trash like any other.
  if (found.value.owner_person_id !== actor.id && !canDeleteInherited(actor, found.value.owner_person_id)) {
    return c.json({ error: "Only the person who added this file can delete it. You can stop seeing it by asking them to unshare." }, 403);
  }
  const result = trashFile(actor, id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

const patchFileRoute = createRoute({
  method: "patch", path: "/{id}", tags: ["Files"], summary: "Rename one of my own Library files, or Keep it (pin) so storage rules never remove it",
  middleware: [requireAuth] as const,
  request: {
    params: idParamSchema("id", "file-a1b2c3"),
    body: { content: { "application/json": { schema: z.object({ name: z.string().max(1000).nullable().optional().describe("New name; empty or null goes back to the name Home derives."), keep: z.boolean().optional().describe("true pins the item; false lets a generated item follow the storage rules again.") }) } } },
  },
  responses: {
    200: { content: { "application/json": { schema: z.object({ id: z.string(), name: z.string().nullable(), retention: z.string() }) } }, description: "The item as it now stands." },
    ...errorResponses({ 400: "No usable change, a name that is too long, or Keep off for a file the person added", 401: "Not signed in", 403: "Only the owner can change a file", 404: "No such file in your Library" }),
  },
});
filesRoutes.openapi(patchFileRoute, (c) => {
  const result = updateLibraryFile(c.get("person"), c.req.valid("param").id, c.req.valid("json"));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});

filesRoutes.openapi(createRoute({
  method: "post", path: "/{id}/recheck-audience", tags: ["Files"], summary: "Recheck my adult-only picture for an all-ages audience",
  middleware: [requireAuth] as const, request: { params: idParamSchema("id", "file-a1b2c3") },
  responses: {
    200: { description: "The stored picture passed the existing picture check.", content: { "application/json": { schema: z.object({ audience: z.literal("all-ages") }) } } },
    ...errorResponses({ 400: "Picture stays adult-only. Try again later or choose another picture.", 401: "Not signed in", 404: "No eligible picture owned by this adult", 429: "Too many checks. Wait an hour." }),
  },
}), async c => {
  const result = await recheckFileAudience(c.get("person"), c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.value, 200);
});
