// MEDIA-LIB-01 (docs/design/media-apps-blend-2026-10-17.md, sections 7, 8, 11): the media library's HTTP boundary. Sources (library
// folders) are admin-only to add, remove or rescan; reads are for everyone signed in, filtered by the person's band (a child reads
// only `band_ok: child` items) and by each source's `visible_to`. lib/media/ holds the rules; this file is only the wire.
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, isNull } from "drizzle-orm";
import { hashSessionToken } from "@/lib/session";
import { db, sqlite } from "@/db";
import { mediaItems, mediaSources, people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { trackBackgroundWork } from "@/lib/backgroundWork";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { MediaItem } from "@maipai/spec/gen/ts/media-item.js";
import { MediaSource } from "@maipai/spec/gen/ts/media-source.js";
import { isMediaAdmin, readableItem, sourceVisibleTo } from "@/lib/media/access";
import { findDuplicates } from "@/lib/media/duplicates";
import { hideItem, itemDetail, listGroups, listItems, removeItem, rowById } from "@/lib/media/items";
import { isScanning, scanRoot, syncMediaScanner, type ScanSummary } from "@/lib/media/scan";
import { serveItemArtwork, serveItemBytes } from "@/lib/media/serve";
import { createRootSource, listSourcesFor, removeSource, ROOT_KINDS } from "@/lib/media/sources";
import { itemFromRow, sourceFromRow } from "@/lib/media/model";
import { MediaProgress } from "@maipai/spec/gen/ts/media-progress.js";
import { MediaCollection } from "@maipai/spec/gen/ts/media-collection.js";
import { extendMediaBudget, mediaBudget, mediaTimeUpRefusal } from "@/lib/media/watchTime";
import { correctedStamp, getProgress, getProgressMany, writeProgress, type ProgressWrite, type WriteRefusal } from "@/lib/media/progress";
import { addItem, createCollection, deleteCollection, listCollections, MADE_KINDS, removeItemFrom, renameCollection, reorderItems, resolveCollection, setPointer, setSharedTo, sharedVisibleTo } from "@/lib/media/collections";

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
    ...errorResponses({ 401: "Not signed in", 403: "Screen time is done for today (code media_time_up)", 404: "No such title, or its file is not there right now", 416: "Range not satisfiable", 422: "A folder audiobook: play its parts" }),
  },
});
mediaRoutes.openapi(contentRoute, async (c) => {
  const actor = c.get("person");
  const item = readableItem(actor, c.req.valid("param").id);
  if (!item) return c.json({ error: "That title is not in the library." }, 404);
  const timeUp = mediaTimeUpRefusal(actor);
  if (timeUp) return c.json(timeUp, 403);
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


/** The metering cursor key: the authenticated session cookie (hashed). requireAuth guarantees it; never read from the body. */
function meterKeyOf(c: Context): string {
  const session = getCookie(c, "session");
  return session ? `s:${hashSessionToken(session)}` : "-";
}

// ---- private daily media budget ----
const BudgetSchema = z.object({ limit_min: z.number(), used_min: z.number(), left_min: z.number(), exhausted: z.boolean() });
const budgetRoute = createRoute({
  method: "get", path: "/budget", tags: ["Media"], summary: "My daily media minutes across all screens",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: BudgetSchema } }, description: "Zero limit means unlimited." }, ...errorResponses({ 401: "Sign in to read your budget" }) },
});
mediaRoutes.openapi(budgetRoute, (c) => c.json(mediaBudget(c.get("person").id), 200));

const extendBudgetRoute = createRoute({
  method: "post", path: "/budget/{personId}/extend", tags: ["Media"], summary: "Add media minutes for today only",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ personId: z.string() }), body: { content: { "application/json": { schema: z.object({ minutes: z.number().int().min(1).max(1440) }) } } } },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Minutes added. The person's own budget read shows the new limit." }, ...errorResponses({ 400: "Choose whole minutes from 1 to 1440", 403: "Ask a grown-up to add minutes", 404: "Pick a person from People and try again" }) },
});
mediaRoutes.openapi(extendBudgetRoute, (c) => {
  const { personId } = c.req.valid("param");
  if (!db.select({ id: people.id }).from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get()) {
    return c.json({ error: "That person was not found. Open People and pick them again." }, 404);
  }
  extendMediaBudget(personId, c.req.valid("json").minutes);
  // No person's usage is returned to the admin who extended the allowance.
  return c.json({ success: true as const }, 200);
}, (result, c) => {
  if (!result.success) return c.json({ error: "Those minutes could not be added. Choose a whole number from 1 to 1440 and try again." }, 400);
});

// ---- progress (MEDIA-PROGRESS-01, design section 10) ----
// A person reads and writes only their own rows. The merge is lib/media/progress.ts's `mergeProgress`: newest wins by the server stamp
// after skew correction, a rewind applies when newer, `completed` is a latch, marks union, a minor's row is written only from their
// own screen.

const PositionSchema = z.union([
  z.object({ seconds: z.number().min(0) }).strict(),
  z.object({ locator: z.object({ kind: z.enum(["cfi", "page"]), cfi: z.string().nullable().optional(), page: z.number().int().min(1).nullable().optional(), spine_index: z.number().int().min(0).nullable().optional(), block_index: z.number().int().min(0).nullable().optional() }).strict(), percent: z.number().min(0).max(100) }).strict(),
]);
const MarkSchema = z.object({ at_s: z.number().min(0), label: z.string().max(200).nullable().optional() });
const WriteBody = z.object({
  position: PositionSchema,
  duration_s: z.number().min(0).nullable().optional(),
  completed: z.boolean().optional().describe("true: the person says it is done (a book). false: the person clears it."),
  event: z.enum(["play", "skip", "finish"]).optional().describe("One thing that happened: a play started, a skip, or a finish. Each adds one."),
  counts: z.object({ plays: z.number().int().min(0).optional(), skips: z.number().int().min(0).optional(), finishes: z.number().int().min(0).optional() }).optional().describe("Absolute counts as the device knows them (an offline batch); the larger wins."),
  marks: z.array(MarkSchema).max(500).optional(),
  device_id: z.string().regex(/^device-[a-z0-9]{6,}$/).nullable().optional(),
  sampled_at: z.string().datetime().optional().describe("The device's clock when it read the position."),
  client_now: z.string().datetime().optional().describe("The device's clock when it sent this, so the hub can correct for a clock that is off."),
  immediate: z.boolean().optional().describe("Store now (pause, seek, unload). A playing title's 10-second ticks are coalesced into one row."),
});
type WriteBodyType = z.infer<typeof WriteBody>;

function writeFrom(body: WriteBodyType, serverNow: Date): ProgressWrite {
  return {
    position: body.position as ProgressWrite["position"], duration_s: body.duration_s, completed: body.completed, counts: body.counts, marks: body.marks?.map((m) => ({ at_s: m.at_s, label: m.label ?? null })),
    events: body.event ? { [body.event]: true } : undefined, device_id: body.device_id ?? null, stamp: correctedStamp({ sampledAt: body.sampled_at, clientNow: body.client_now, serverNow }),
  };
}

const REFUSAL_LINES: Record<WriteRefusal, string> = {
  other_persons_device: "This screen belongs to someone else, so it cannot save your place. Sign in on your own screen.",
  no_such_title: "That title is not in the library.",
  wrong_position_shape: "A book saves a place in the text; everything else saves seconds.",
};

const putProgressRoute = createRoute({
  method: "put",
  path: "/progress/{media_id}",
  tags: ["Media"],
  summary: "Save my place in a title. The hub merges it with what is stored: the newest wins, a finished title stays finished",
  middleware: [requireAuth] as const,
  request: { params: z.object({ media_id: z.string() }), body: { content: { "application/json": { schema: WriteBody } } } },
  responses: {
    200: { content: { "application/json": { schema: z.object({ budget: BudgetSchema, progress: MediaProgress, applied: z.boolean().describe("false: a newer place was already stored; only counts, marks and a finish were merged.") }) } }, description: "The row as it now stands." },
    ...errorResponses({ 401: "Not signed in", 403: "This screen belongs to someone else", 404: "No such title, or not one I may see", 422: "Wrong kind of position for this title" }),
  },
});
mediaRoutes.openapi(putProgressRoute, (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  const item = readableItem(actor, c.req.valid("param").media_id);
  if (!item) return c.json({ error: REFUSAL_LINES.no_such_title }, 404);
  const now = new Date();
  const outcome = writeProgress(actor, item, writeFrom(body, now), { now, immediate: body.immediate, meterKey: meterKeyOf(c) });
  if (!outcome.ok) return c.json({ error: REFUSAL_LINES[outcome.refusal] }, outcome.refusal === "other_persons_device" ? 403 : 422);
  return c.json({ progress: outcome.progress, applied: outcome.positionApplied, budget: outcome.budget! }, 200);
});

const batchRoute = createRoute({
  method: "post",
  path: "/progress/batch",
  tags: ["Media"],
  summary: "Save many places at once, such as the ones a phone kept while it was offline. Each is merged by the same rule as a single save",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ client_now: z.string().datetime().optional(), writes: z.array(WriteBody.extend({ media_id: z.string() })).min(1).max(500) }) } } } },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ results: z.array(z.object({ media_id: z.string(), status: z.enum(["applied", "older", "refused", "unknown_title"]), reason: z.string().nullable(), progress: MediaProgress.nullable(), budget: BudgetSchema.optional() })) }) } },
      description: "One result per write, in order. `older` means a newer place was already stored.",
    },
    ...errorResponses({ 401: "Not signed in" }),
  },
});
mediaRoutes.openapi(batchRoute, (c) => {
  const actor = c.get("person");
  const { writes, client_now } = c.req.valid("json");
  const now = new Date();
  const results = writes.map((entry) => {
    const item = readableItem(actor, entry.media_id);
    if (!item) return { media_id: entry.media_id, status: "unknown_title" as const, reason: REFUSAL_LINES.no_such_title, progress: null };
    const outcome = writeProgress(actor, item, writeFrom({ ...entry, client_now: entry.client_now ?? client_now }, now), { now, immediate: true, meterKey: meterKeyOf(c) });
    if (!outcome.ok) return { media_id: entry.media_id, status: "refused" as const, reason: REFUSAL_LINES[outcome.refusal], progress: null };
    return { media_id: entry.media_id, status: outcome.positionApplied ? ("applied" as const) : ("older" as const), reason: null, progress: outcome.progress, budget: outcome.budget };
  });
  return c.json({ results }, 200);
});

const getProgressRoute = createRoute({
  method: "get",
  path: "/progress/{media_id}",
  tags: ["Media"],
  summary: "My place in one title",
  middleware: [requireAuth] as const,
  request: { params: z.object({ media_id: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: z.object({ progress: MediaProgress.nullable() }) } }, description: "Null when I have not started it." }, ...errorResponses({ 401: "Not signed in", 404: "No such title" }) },
});
mediaRoutes.openapi(getProgressRoute, (c) => {
  const actor = c.get("person");
  const item = readableItem(actor, c.req.valid("param").media_id);
  if (!item) return c.json({ error: REFUSAL_LINES.no_such_title }, 404);
  return c.json({ progress: getProgress(actor.id, item.id) }, 200);
});

const manyProgressRoute = createRoute({
  method: "get",
  path: "/progress",
  tags: ["Media"],
  summary: "My places in several titles at once (up to 100), for the bars on a shelf",
  middleware: [requireAuth] as const,
  request: { query: z.object({ ids: z.string().min(1).describe("Title ids, comma separated.") }) },
  responses: { 200: { content: { "application/json": { schema: z.array(MediaProgress) } }, description: "The ones I have started." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(manyProgressRoute, (c) => {
  const actor = c.get("person");
  const ids = [...new Set(c.req.valid("query").ids.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  const readable = ids.filter((id) => readableItem(actor, id) !== null);
  return c.json(getProgressMany(actor.id, readable), 200);
});

// ---- collections ----

const CollectionId = z.object({ id: z.string().describe("A collection id, or liked, watch_later or queue for mine.") });

const listCollectionsRoute = createRoute({
  method: "get",
  path: "/collections",
  tags: ["Media"],
  summary: "My collections: liked, watch later and up next always exist; playlists, watchlists and pins when I make them",
  middleware: [requireAuth] as const,
  request: { query: z.object({ kind: z.enum(["liked", "watch_later", "queue", "playlist", "watchlist", "pins"]).optional() }) },
  responses: { 200: { content: { "application/json": { schema: z.array(MediaCollection) } }, description: "Mine." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(listCollectionsRoute, (c) => c.json(listCollections(c.get("person").id, c.req.valid("query").kind).map((collection) => visibleView(c.get("person"), collection)), 200));

const sharedCollectionsRoute = createRoute({
  method: "get",
  path: "/collections/shared",
  tags: ["Media"],
  summary: "Collections other people shared with me or with the household",
  middleware: [requireAuth] as const,
  responses: { 200: { content: { "application/json": { schema: z.array(MediaCollection) } }, description: "Shared with me." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(sharedCollectionsRoute, (c) => c.json(sharedVisibleTo(c.get("person")).map((collection) => visibleView(c.get("person"), collection)), 200));

/** A collection as this person may see it: titles they may not read (the band, a removed folder) are left out. */
function visibleView(actor: Parameters<typeof readableItem>[0], collection: ReturnType<typeof listCollections>[number]) {
  const items = collection.items.filter((entry) => readableItem(actor, entry.media_id) !== null);
  return items.length === collection.items.length ? collection : { ...collection, items };
}

const makeCollectionRoute = createRoute({
  method: "post",
  path: "/collections",
  tags: ["Media"],
  summary: "Make a playlist, a watchlist or a set of pins",
  middleware: [requireAuth] as const,
  request: { body: { content: { "application/json": { schema: z.object({ kind: z.enum(MADE_KINDS), title: z.string().min(1).max(100) }) } } } },
  responses: { 201: { content: { "application/json": { schema: MediaCollection } }, description: "Made." }, ...errorResponses({ 401: "Not signed in" }) },
});
mediaRoutes.openapi(makeCollectionRoute, (c) => {
  const body = c.req.valid("json");
  return c.json(createCollection(c.get("person").id, body.kind, body.title), 201);
});

const getCollectionRoute = createRoute({
  method: "get",
  path: "/collections/{id}",
  tags: ["Media"],
  summary: "One collection of mine, or one shared with me",
  middleware: [requireAuth] as const,
  request: { params: CollectionId },
  responses: { 200: { content: { "application/json": { schema: MediaCollection } }, description: "Found." }, ...errorResponses({ 401: "Not signed in", 404: "No such collection" }) },
});
mediaRoutes.openapi(getCollectionRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const own = resolveCollection(actor.id, id);
  const found = own ?? sharedVisibleTo(actor).find((collection) => collection.id === id) ?? null;
  return found ? c.json(visibleView(actor, found), 200) : c.json({ error: "That collection is not there." }, 404);
});

const patchCollectionRoute = createRoute({
  method: "patch",
  path: "/collections/{id}",
  tags: ["Media"],
  summary: "Rename one of my collections, move its queue pointer, or choose who it is shared with (nobody, the household, or people)",
  middleware: [requireAuth] as const,
  request: { params: CollectionId, body: { content: { "application/json": { schema: z.object({ title: z.string().min(1).max(100).optional(), pointer: z.number().int().min(0).nullable().optional(), shared_to: z.union([z.null(), z.literal("household"), z.array(PersonId)]).optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: MediaCollection } }, description: "Updated." }, ...errorResponses({ 401: "Not signed in", 404: "No such collection of mine" }) },
});
mediaRoutes.openapi(patchCollectionRoute, (c) => {
  const actor = c.get("person");
  let collection = resolveCollection(actor.id, c.req.valid("param").id);
  if (!collection || collection.person_id !== actor.id) return c.json({ error: "That collection is not there." }, 404);
  const body = c.req.valid("json");
  if (body.title !== undefined) collection = renameCollection(collection, body.title);
  if (body.pointer !== undefined) collection = setPointer(collection, body.pointer);
  if (body.shared_to !== undefined) collection = setSharedTo(collection, body.shared_to);
  return c.json(collection, 200);
});

const deleteCollectionRoute = createRoute({
  method: "delete",
  path: "/collections/{id}",
  tags: ["Media"],
  summary: "Delete a playlist, watchlist or pins of mine. Liked, watch later and up next stay",
  middleware: [requireAuth] as const,
  request: { params: CollectionId },
  responses: { 200: { content: { "application/json": { schema: z.object({ success: z.literal(true) }) } }, description: "Deleted." }, ...errorResponses({ 401: "Not signed in", 404: "No such collection of mine", 409: "One of the three that always exist" }) },
});
mediaRoutes.openapi(deleteCollectionRoute, (c) => {
  const actor = c.get("person");
  const collection = resolveCollection(actor.id, c.req.valid("param").id);
  if (!collection || collection.person_id !== actor.id) return c.json({ error: "That collection is not there." }, 404);
  if (!deleteCollection(collection)) return c.json({ error: "Liked, watch later and up next are always there. Clear them instead." }, 409);
  return c.json({ success: true as const }, 200);
});

const addToCollectionRoute = createRoute({
  method: "post",
  path: "/collections/{id}/items",
  tags: ["Media"],
  summary: "Add a title to one of my collections (a title already there only has its status updated)",
  middleware: [requireAuth] as const,
  request: { params: CollectionId, body: { content: { "application/json": { schema: z.object({ media_id: z.string(), at: z.number().int().min(0).optional(), status: z.enum(["want", "watching", "completed"]).nullable().optional() }) } } } },
  responses: { 200: { content: { "application/json": { schema: MediaCollection } }, description: "Updated." }, ...errorResponses({ 401: "Not signed in", 404: "No such collection of mine, or no such title" }) },
});
mediaRoutes.openapi(addToCollectionRoute, (c) => {
  const actor = c.get("person");
  const collection = resolveCollection(actor.id, c.req.valid("param").id);
  if (!collection || collection.person_id !== actor.id) return c.json({ error: "That collection is not there." }, 404);
  const body = c.req.valid("json");
  if (!readableItem(actor, body.media_id)) return c.json({ error: REFUSAL_LINES.no_such_title }, 404);
  return c.json(addItem(collection, body.media_id, { at: body.at, status: body.status ?? undefined }), 200);
});

const reorderRoute = createRoute({
  method: "put",
  path: "/collections/{id}/items",
  tags: ["Media"],
  summary: "Put the titles of one of my collections in a new order",
  middleware: [requireAuth] as const,
  request: { params: CollectionId, body: { content: { "application/json": { schema: z.object({ media_ids: z.array(z.string()).max(5000) }) } } } },
  responses: { 200: { content: { "application/json": { schema: MediaCollection } }, description: "Reordered." }, ...errorResponses({ 401: "Not signed in", 404: "No such collection of mine" }) },
});
mediaRoutes.openapi(reorderRoute, (c) => {
  const actor = c.get("person");
  const collection = resolveCollection(actor.id, c.req.valid("param").id);
  if (!collection || collection.person_id !== actor.id) return c.json({ error: "That collection is not there." }, 404);
  return c.json(reorderItems(collection, c.req.valid("json").media_ids), 200);
});

const removeFromCollectionRoute = createRoute({
  method: "delete",
  path: "/collections/{id}/items/{media_id}",
  tags: ["Media"],
  summary: "Take a title out of one of my collections",
  middleware: [requireAuth] as const,
  request: { params: CollectionId.extend({ media_id: z.string() }) },
  responses: { 200: { content: { "application/json": { schema: MediaCollection } }, description: "Updated." }, ...errorResponses({ 401: "Not signed in", 404: "No such collection of mine" }) },
});
mediaRoutes.openapi(removeFromCollectionRoute, (c) => {
  const actor = c.get("person");
  const { id, media_id } = c.req.valid("param");
  const collection = resolveCollection(actor.id, id);
  if (!collection || collection.person_id !== actor.id) return c.json({ error: "That collection is not there." }, 404);
  return c.json(removeItemFrom(collection, media_id), 200);
});
