// MEDIA-LIB-01 (docs/design/media-apps-blend-2026-10-17.md, sections 7, 8, 11): the media library's HTTP boundary. Sources (library
// folders) are admin-only to add, remove or rescan; reads are for everyone signed in, filtered by the person's band (a child reads
// only `band_ok: child` items) and by each source's `visible_to`. lib/media/ holds the rules; this file is only the wire.
import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { MediaItem } from "@maipai/spec/gen/ts/media-item.js";
import { MediaSource } from "@maipai/spec/gen/ts/media-source.js";
import { isMediaAdmin, readableItem, sourceVisibleTo } from "@/lib/media/access";
import { findDuplicates } from "@/lib/media/duplicates";
import { hideItem, itemDetail, listGroups, listItems, removeItem, rowById, KINDS } from "@/lib/media/items";
import { isScanning, scanRoot, syncMediaScanner, type ScanSummary } from "@/lib/media/scan";
import { serveItemArtwork, serveItemBytes } from "@/lib/media/serve";
import { createRootSource, listSourcesFor, removeSource, ROOT_KINDS } from "@/lib/media/sources";
import { itemFromRow, sourceFromRow } from "@/lib/media/model";

export const mediaRoutes = apiRouter();

const ItemKind = z.enum(["video", "episode", "film", "track", "podcast_episode", "book", "audiobook", "chapter"]);
const PersonId = z.string().regex(/^person-[a-z0-9]{6,}$/);

const ScanSummarySchema = z.object({
  scanId: z.string(), sourceId: z.string(), status: z.enum(["ok", "root_missing", "failed"]), added: z.number(), updated: z.number(), unchanged: z.number(), skipped: z.number(),
  errors: z.number(), missing: z.number(), pruned: z.number(), probed: z.number(), guards: z.array(z.string()), startedAt: z.string(), durationMs: z.number(),
});

const SourceView = z.object({
  source: MediaSource,
  item_count: z.number().describe("Live items under this source."),
  scanning: z.boolean(),
  last_scan: ScanSummarySchema.nullable(),
});

function sourceView(row: typeof mediaSources.$inferSelect, admin: boolean) {
  const source = sourceFromRow(row);
  if (!admin && source.root) source.root = { ...source.root, path: "" }; // only an admin sees where a folder lives on the disk
  const count = (sqlite.query("SELECT count(*) AS n FROM media_items WHERE source_id = ? AND deleted_at IS NULL").get(row.id) as { n: number }).n;
  return { source, item_count: count, scanning: isScanning(row.id), last_scan: row.lastScanSummary ? (JSON.parse(row.lastScanSummary) as ScanSummary) : null };
}

// ---- sources ----

const listSourcesRoute = createRoute({
  method: "get",
  path: "/sources",
  tags: ["Media"],
  summary: "The library folders I may see. An admin also sees where each lives and how the last scan went",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.array(SourceView) } }, description: "Live sources visible to me." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(listSourcesRoute, (c) => {
  const actor = c.get("person");
  const admin = isMediaAdmin(actor);
  const visible = new Set(listSourcesFor((source) => sourceVisibleTo(source, actor)).map((source) => source.id));
  const rows = db.select().from(mediaSources).all().filter((row) => visible.has(row.id));
  return c.json(rows.map((row) => sourceView(row, admin)), 200);
});

const addRootRoute = createRoute({
  method: "post",
  path: "/sources",
  tags: ["Media"],
  summary: "Add a library folder (a root): a folder on this computer or on a mounted network share. Roots may not overlap",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            label: z.string().min(1).max(80),
            path: z.string().min(1).describe("The full path of the folder, starting with /."),
            mount_id: z.string().nullable().optional().describe("A network share set up under Settings, Storage, when the folder is on one."),
            kinds: z.array(z.enum(ROOT_KINDS)).min(1).describe("What the folder holds."),
            visible_to: z.union([z.literal("household"), z.array(PersonId)]).optional(),
            poll_minutes: z.number().int().min(5).max(1440).optional(),
            prune: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: SourceView } }, description: "Added; the first scan starts in the background." },
    ...errorResponses({ 400: "Not a folder, or nothing said about what it holds", 403: "Owner or admin only", 404: "No such network share", 409: "Overlaps a folder that is already scanned" }),
  },
});
mediaRoutes.openapi(addRootRoute, (c) => {
  const body = c.req.valid("json");
  const result = createRootSource(c.get("person"), { label: body.label, path: body.path, mountId: body.mount_id ?? null, kinds: body.kinds, visibleTo: body.visible_to, pollMinutes: body.poll_minutes, prune: body.prune });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  syncMediaScanner();
  trackBackgroundWork(scanRoot(result.source.id).catch(() => undefined));
  return c.json(sourceView(db.select().from(mediaSources).where(eq(mediaSources.id, result.source.id)).get()!, true), 201);
});

const removeSourceRoute = createRoute({
  method: "delete",
  path: "/sources/{id}",
  tags: ["Media"],
  summary: "Take a library folder out of use. Its titles are hidden and kept for 30 days; no file on the disk is touched",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Removed." }, ...errorResponses({ 403: "Owner or admin only", 404: "No such folder" }) },
});
mediaRoutes.openapi(removeSourceRoute, (c) => {
  const result = removeSource(c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  syncMediaScanner();
  return c.json({ success: true as const }, 200);
});

const rescanRoute = createRoute({
  method: "post",
  path: "/sources/{id}/rescan",
  tags: ["Media"],
  summary: "Scan a library folder now. A scan already running is joined, not doubled",
  middleware: [requireRole("owner", "admin")] as const,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: z.object({ force: z.boolean().optional().describe("Read every file again, not only the new and changed ones.") }) } }, required: false },
  },
  responses: { 202: { content: { "application/json": { schema: z.object({ scanning: z.literal(true) }) } }, description: "Started." }, ...errorResponses({ 403: "Owner or admin only", 404: "No such folder" }) },
});
mediaRoutes.openapi(rescanRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = db.select().from(mediaSources).where(eq(mediaSources.id, id)).get();
  if (!row || row.deletedAt || row.kind !== "root") return c.json({ error: "That folder is not in the library." }, 404);
  const body = c.req.valid("json") as { force?: boolean } | undefined;
  trackBackgroundWork(scanRoot(id, { force: body?.force === true }).catch(() => undefined));
  return c.json({ scanning: true as const }, 202);
});

// ---- items ----

const PageSchema = z.object({ items: z.array(MediaItem), total: z.number(), next_offset: z.number().nullable() });

const listItemsRoute = createRoute({
  method: "get",
  path: "/items",
  tags: ["Media"],
  summary: "Titles in the library, one kind at a time, in pages. A child sees only the titles cleared for a child",
  middleware: [requireAuth] as const,
  request: {
    query: z.object({
      kind: ItemKind.optional(),
      source_id: z.string().optional(),
      parent_id: z.string().optional().describe("The parts of a folder audiobook."),
      series: z.string().optional(), album: z.string().optional(), q: z.string().max(200).optional(),
      sort: z.enum(["default", "title", "added"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: { 200: { content: { "application/json": { schema: PageSchema } }, description: "One page." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(listItemsRoute, (c) => {
  const q = c.req.valid("query");
  return c.json(listItems(c.get("person"), { kind: q.kind, sourceId: q.source_id, parentId: q.parent_id, series: q.series, album: q.album, q: q.q, sort: q.sort, limit: q.limit, offset: q.offset }), 200);
});

const DetailSchema = z.object({
  item: MediaItem,
  parts: z.array(MediaItem).describe("The files of a folder audiobook, in order."),
  linked: z.array(MediaItem).describe("The book or audiobook of the same title in the same folder: offer Listen and Read on one page."),
  page_count: z.number().nullable().describe("A PDF's page count."),
});
const idParam = z.object({ id: z.string() });

const getItemRoute = createRoute({
  method: "get",
  path: "/items/{id}",
  tags: ["Media"],
  summary: "One title with its parts and linked edition",
  middleware: [requireAuth] as const,
  request: { params: idParam },
  responses: { 200: { content: { "application/json": { schema: DetailSchema } }, description: "Found." }, ...errorResponses({ 401: "Not signed in", 404: "No such title, or not one I may see" }) },
});
mediaRoutes.openapi(getItemRoute, (c) => {
  const actor = c.get("person");
  const item = readableItem(actor, c.req.valid("param").id);
  if (!item) return c.json({ error: "That title is not in the library." }, 404);
  return c.json(itemDetail(actor, item), 200);
});

const patchItemRoute = createRoute({
  method: "patch",
  path: "/items/{id}",
  tags: ["Media"],
  summary: "An adult hides a title, or marks who may see it. A title an adult has marked keeps that mark through rescans",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParam, body: { content: { "application/json": { schema: z.object({ hidden: z.boolean().optional(), band_ok: z.enum(["child", "teen", "adult"]).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: MediaItem } }, description: "Updated." }, ...errorResponses({ 403: "Owner or admin only", 404: "No such title" }) },
});
mediaRoutes.openapi(patchItemRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const row = rowById(id);
  if (!row || row.deletedAt) return c.json({ error: "That title is not in the library." }, 404);
  if (body.hidden !== undefined) hideItem(id, body.hidden);
  if (body.band_ok !== undefined) db.update(mediaItems).set({ bandOk: body.band_ok, verifiedByPersonId: actor.id, hlc: nextHlc() }).where(eq(mediaItems.id, id)).run();
  return c.json(itemFromRow(rowById(id)!), 200);
});

const deleteItemRoute = createRoute({
  method: "delete",
  path: "/items/{id}",
  tags: ["Media"],
  summary: "Remove a title from the library. It stays gone after a rescan; the file on the disk is not touched",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: idParam },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Removed." }, ...errorResponses({ 403: "Owner or admin only", 404: "No such title" }) },
});
mediaRoutes.openapi(deleteItemRoute, (c) => {
  if (!removeItem(c.req.valid("param").id)) return c.json({ error: "That title is not in the library." }, 404);
  return c.json({ success: true as const }, 200);
});

// ---- bytes and artwork ----

const contentRoute = createRoute({
  method: "get",
  path: "/items/{id}/content",
  tags: ["Media"],
  summary: "The title's own file, with Range support, in its own media type (no transcoding)",
  middleware: [requireAuth] as const,
  request: { params: idParam },
  responses: {
    200: { content: { "application/octet-stream": { schema: z.string() } }, description: "The whole file." },
    206: { content: { "application/octet-stream": { schema: z.string() } }, description: "The requested range." },
    ...errorResponses({ 401: "Not signed in", 404: "No such title, or its file is not there right now", 416: "Range not satisfiable", 422: "A folder audiobook: play its parts" }),
  },
});
mediaRoutes.openapi(contentRoute, async (c) => {
  const actor = c.get("person");
  const item = readableItem(actor, c.req.valid("param").id);
  if (!item) return c.json({ error: "That title is not in the library." }, 404);
  const served = await serveItemBytes(actor, item, c.req.header("Range"));
  if (served instanceof Response) return served as never;
  return c.json({ error: served.error }, served.status);
});

const artworkRoute = createRoute({
  method: "get",
  path: "/items/{id}/artwork",
  tags: ["Media"],
  summary: "The title's picture: a poster, cover or embedded album art",
  middleware: [requireAuth] as const,
  request: { params: idParam },
  responses: { 200: { content: { "image/*": { schema: z.string() } }, description: "The picture." }, ...errorResponses({ 401: "Not signed in", 404: "No such title, or no picture" }) },
});
mediaRoutes.openapi(artworkRoute, async (c) => {
  const actor = c.get("person");
  const item = readableItem(actor, c.req.valid("param").id);
  if (!item) return c.json({ error: "That title is not in the library." }, 404);
  const served = await serveItemArtwork(actor, item);
  if (served instanceof Response) return served as never;
  return c.json({ error: served.error }, served.status);
});

// ---- groups and duplicates ----

const GroupSchema = z.object({ key: z.string(), count: z.number(), sample_id: z.string().describe("A title to take artwork from."), year: z.number().nullable(), subtitle: z.string().nullable() });
const groupsRoute = createRoute({
  method: "get",
  path: "/groups",
  tags: ["Media"],
  summary: "Shows (by series), albums, authors or artists: one row each",
  middleware: [requireAuth] as const,
  request: { query: z.object({ by: z.enum(["series", "album", "author", "artist"]), kind: ItemKind.optional() }) },
  responses: { 200: { content: { "application/json": { schema: z.array(GroupSchema) } }, description: "The groups." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(groupsRoute, (c) => {
  const q = c.req.valid("query");
  return c.json(listGroups(c.get("person"), q.by, q.kind), 200);
});

const duplicatesRoute = createRoute({
  method: "get",
  path: "/duplicates",
  tags: ["Media"],
  summary: "Titles that appear in more than one place with the same size, length and name. Reported only: nothing is changed",
  middleware: [requireRole("owner", "admin")] as const,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(z.object({ key: z.string(), title: z.string(), size: z.number(), duration_s: z.number().nullable(), items: z.array(z.object({ id: z.string(), kind: ItemKind, location: z.any(), source_id: z.string(), source_label: z.string().nullable() })) })) } },
      description: "Duplicate groups, largest first.",
    },
    ...errorResponses({ 403: "Owner or admin only" }),
  },
});
mediaRoutes.openapi(duplicatesRoute, (c) => c.json(findDuplicates(), 200));

export { KINDS };
