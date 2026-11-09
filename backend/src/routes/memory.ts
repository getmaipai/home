import { Hono, type Context } from "hono";
import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import { hasDeclaredCredentialField, CREDENTIAL_SAFE_MESSAGE } from "@/lib/memoryContentPolicy";
import {
  remember,
  list,
  listPage,
  archive,
  restore,
  forget,
  forgetByIds,
  exportPerson,
  setChildDisclosure,
  runMaintenance,
  isPrivilegedRecordKind,
  type MemoryOpResult,
  type ListOptions,
} from "@/lib/memory";
import { runLegacyImport, LegacyImportError } from "@/lib/legacyImport";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import { apiRouter, errorResponses, ErrorSchema, refuseWith } from "@/lib/openapi";
import { isOwnerOrAdmin } from "@/lib/access";
import type { AppEnv, PersonRow } from "@/types";
import { db } from "@/db";
import { conversationTurns, memoryRecords, devices } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { savedFromTurnSource } from "@/lib/conversationHistory";

// apiRouter()'s OpenAPIHono extends Hono, so every plain `.post()`/`.get()`
// route below (unconverted, pre-dating getmaipai/.github/CLAUDE.md's
// @hono/zod-openapi requirement) keeps working exactly as it did on a
// bare `new Hono<AppEnv>()` - only the new route below (step 10) is
// declared through `.openapi()`, the minimum "any route you touch gets
// converted" the org standard actually asks for when the touch is one
// new endpoint, not a rewrite of a whole file's already-working routes.
export const memoryRoutes = apiRouter();

// SEC-4 (code review, 2026-09-06): remember(actor, body) used to trust
// EVERY field of the request body - `pinned` (rides in every household
// member's system prompt forever, and runMaintenance() never archives a
// pinned row), `source` (provenance is supposed to be the system's own
// record of where a fact came from, not caller-chosen), `record_kind`,
// `embedding_space`, and `precomputed_embedding` (a client-supplied
// vector of any size/shape, stored with no validation). This route's own
// Zod body only accepts the fields a real household member's own
// remember() call needs; source, record_kind: "entity"/"episode", and
// pinned each get a real, server-controlled value below instead.
const MAX_MEMORY_TEXT_LENGTH = 2_000;

const RememberBodySchema = z.object({
  text: z.string().min(1).max(MAX_MEMORY_TEXT_LENGTH),
  category: z.string(),
  tier: z.string(),
  scope: z.string(),
  person: z.string().nullish(),
  importance: z.number().min(0).max(1),
  sensitive: z.boolean().optional(),
  pinned: z.boolean().optional(),
  record_kind: z.enum(["memory", "entity", "episode"]).optional(),
  valid_from: z.string().nullish(),
  valid_to: z.string().nullish(),
  // ELEMENTS-ADOPT-02: "Remember this" on a reply names that turn, so the
  // reply's memory chips show what was saved from it. Verified below.
  turn_id: z.string().regex(/^turn-[a-z0-9]{6,}$/).optional(),
});

/** `pinned` (rides in every household member's prompt, permanently) and
 * a non-default `record_kind` (an entity/episode row, not an ordinary
 * fact) are owner/admin-only, regardless of what the body asked for -
 * the same "privileged field, silently downgraded rather than a 403"
 * shape lib/settings.ts's own secret-value redaction takes, since a
 * child's remember()/supersede() call is still a perfectly normal
 * request, just never one of these two things. A blocked `true` becomes
 * `undefined`, NOT `false` (a review, 2026-09-06, found the first version
 * of this returned a hard `false`): supersede()'s own
 * `input.pinned ?? old.pinned` treats a defined `false` as "unpin this",
 * a real, unrequested state change to an already-pinned record, not
 * merely a blocked escalation - `undefined` falls through to
 * `old.pinned` and leaves the record's existing state alone, the same as
 * never mentioning `pinned` at all. */
function sanitizedPinned(actor: PersonRow, requested: boolean | undefined): boolean | undefined {
  if (requested === true && !isOwnerOrAdmin(actor)) return undefined;
  return requested;
}

function sanitizedRecordKind(actor: PersonRow, requested: "memory" | "entity" | "episode" | undefined): "memory" | "entity" | "episode" | undefined {
  if (!requested || !isPrivilegedRecordKind(requested)) return requested;
  return isOwnerOrAdmin(actor) ? requested : "memory";
}

function parseListOptions(query: URLSearchParams): ListOptions {
  const opts: ListOptions = {};
  const scope = query.get("scope");
  if (scope === "household" || scope === "person" || scope === "self") opts.scope = scope;
  const person = query.get("person");
  if (person) opts.person = person;
  return opts;
}

memoryRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const rawBody = await c.req.json().catch(() => null);
  // CHAT-03: the declared-field half of the content policy, at the
  // boundary: a body carrying a credential-named field is refused by
  // name, before the schema strips unknown keys. The text itself meets
  // the same policy inside remember().
  if (hasDeclaredCredentialField(rawBody)) return c.json({ error: CREDENTIAL_SAFE_MESSAGE }, 400);
  const parsed = RememberBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  const body = parsed.data;
  // A named turn becomes the memory's provenance only when it is this
  // person's own saved turn. An Incognito turn is never saved, so it can
  // never be named (Incognito never remembers); a turn an admin can read
  // but did not say is not theirs to file a memory under.
  // The memory must be the person's own, too: a turn is never filed under
  // someone else's memory (an admin writing a child's memory names no turn).
  if (body.turn_id !== undefined) {
    if (body.scope !== "person" || (body.person ?? actor.id) !== actor.id) {
      return c.json({ error: "turn_id is only for a memory of your own" }, 400);
    }
    const turn = db.select({ personId: conversationTurns.personId }).from(conversationTurns).where(eq(conversationTurns.id, body.turn_id)).get();
    if (!turn || turn.personId !== actor.id) return c.json({ error: "turn not found" }, 404);
    // Saving the same reply twice (a second tap after a reload) returns the
    // memory already saved from it rather than filing a duplicate.
    const already = db
      .select({ id: memoryRecords.id })
      .from(memoryRecords)
      .where(and(eq(memoryRecords.source, savedFromTurnSource(body.turn_id)), eq(memoryRecords.person, actor.id), eq(memoryRecords.status, "active"), eq(memoryRecords.text, body.text)))
      .get();
    if (already) {
      const existing = list(actor, { person: actor.id }).find((record) => record.id === already.id);
      if (existing) return c.json(existing, 200);
    }
  }
  const result = remember(actor, {
    text: body.text,
    category: body.category,
    tier: body.tier,
    scope: body.scope,
    created_by: actor.id,
    person: body.person ?? undefined,
    importance: body.importance,
    sensitive: body.sensitive,
    valid_from: body.valid_from,
    valid_to: body.valid_to,
    // Never from the client - see this file's own header on why. The one
    // exception is a verified turn of the person's own (above), filed as
    // `saved:<turn id>` (savedFromTurnSource): the turn's memory_ids list it,
    // and an edit of that turn, which retires what the judge guessed from it
    // (archiveByProvenance), never retires what the person chose to keep.
    source: body.turn_id !== undefined ? savedFromTurnSource(body.turn_id) : `api:${actor.id}`,
    pinned: sanitizedPinned(actor, body.pinned),
    record_kind: sanitizedRecordKind(actor, body.record_kind),
  });
  if (!result.ok) return refuseWith(c, result);
  return c.json(result.value, 201);
});

// CHAT-08 (b): a memory read as of a given moment. `as_of` is an ISO
// date-time; `include_superseded` (only honoured when `as_of` is present)
// includes records already retired by a later supersession, so a
// historical read can show what the record looked like before it was
// replaced - a current read (no `as_of`) never shows superseded records.
const MemoryListQuerySchema = z.object({
  scope: z.enum(["household", "person", "self", "companion"]).optional(),
  person: z.string().optional(),
  companion_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().optional(),
  as_of: z.string().optional(),
  include_superseded: z.enum(["true", "false"]).optional(),
  state: z.enum(["active", "faded"]).optional(),
});
const MemoryWithDevice = MemoryRecord.extend({ device_name: z.string().optional().describe("The robot's current name, present when device_id is set.") });
const memoryListRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Memory"],
  summary: "List this person's memory records, optionally as of a given moment",
  middleware: [requireAuth] as const,
  request: { query: MemoryListQuerySchema.omit({ limit: true, cursor: true }) },
  responses: {
    200: { content: { "application/json": { schema: z.array(MemoryWithDevice) } }, description: "The first 100 visible memory records, in the usual list shape; robot-bound ones carry device_id and device_name. Use /page to read past 100." },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "as_of must be an ISO date-time" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Not signed in" },
  },
});
const memoryPageRoute = createRoute({
  method: "get",
  path: "/page",
  tags: ["Memory"],
  summary: "List this person's memory records one page at a time, with the total",
  middleware: [requireAuth] as const,
  request: { query: MemoryListQuerySchema },
  responses: {
    200: { content: { "application/json": { schema: z.object({ records: z.array(MemoryWithDevice), total: z.number(), next_cursor: z.string().nullable() }) } }, description: "One page of visible memories, the total count, and the cursor for the next page." },
    400: { content: { "application/json": { schema: ErrorSchema } }, description: "as_of must be an ISO date-time, or companion_id is missing for scope=companion" },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Not signed in" },
  },
});
function readMemoryPage(c: any, allowState = false): { error: string } | { records: ReturnType<typeof list>; total: number; nextCursor: string | null } {
  const actor = c.get("person");
  const { scope, person, companion_id, limit, cursor, as_of, include_superseded, state } = c.req.valid("query") as z.infer<typeof MemoryListQuerySchema>;
  const opts: ListOptions = { limit, cursor, robotBound: "all" };
  if (allowState && state === "faded") opts.faded = true;
  if (scope) opts.scope = scope;
  else opts.scopes = ["person", "household"];
  if (person) opts.person = person;
  if (scope === "companion") {
    if (!companion_id) return { error: "companion_id is required when scope=companion. Add the companion id and try again." };
    opts.companionId = companion_id;
  }
  let asOf: Date | undefined;
  if (as_of !== undefined) {
    const parsed = Date.parse(as_of);
    if (Number.isNaN(parsed)) return { error: "as_of must be an ISO date-time" };
    asOf = new Date(parsed);
  }
  if (asOf !== undefined && include_superseded === "true") opts.includeSuperseded = true;
  return listPage(actor, { ...opts, asOf });
}
function withDeviceNames(records: ReturnType<typeof list>) {
  const robotIds = [...new Set(records.flatMap((r) => r.device_id ? [r.device_id] : []))];
  const names = new Map(db.select({ id: devices.id, name: devices.name }).from(devices).where(robotIds.length ? inArray(devices.id, robotIds) : eq(devices.id, "")).all().map((d) => [d.id, d.name]));
  return records.map((r) => ({ ...r, ...(r.device_id ? { device_name: names.get(r.device_id) ?? "Robot" } : {}) }));
}
memoryRoutes.openapi(memoryListRoute, (c): ReturnType<typeof memoryListRoute extends never ? never : any> => {
  const page = readMemoryPage(c);
  if ("error" in page) return c.json({ error: page.error }, 400) as any;
  return c.json(withDeviceNames(page.records)) as any;
});
memoryRoutes.openapi(memoryPageRoute, (c): ReturnType<typeof memoryPageRoute extends never ? never : any> => {
  const page = readMemoryPage(c, true);
  if ("error" in page) return c.json({ error: page.error }, 400) as any;
  return c.json({ records: withDeviceNames(page.records), total: page.total, next_cursor: page.nextCursor }) as any;
});

memoryRoutes.get("/export", requireAuth, async (c) => {
  const actor = c.get("person");
  const personId = new URL(c.req.url).searchParams.get("personId");
  if (!personId) return c.json({ error: "personId is required" }, 400);
  const result = exportPerson(actor, personId);
  if (!result.ok) return refuseWith(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/forget", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { personId?: string };
  if (!body.personId) return c.json({ error: "personId is required" }, 400);
  const result = forget(actor, body.personId);
  if (!result.ok) return refuseWith(c, result);
  return c.json(result.value);
});

// Batch forget (docs/UI.md > Batch actions, lane 3 item 4, 2026-09-13):
// distinct from the personId-based /forget above, which erases every
// record for ONE person - this takes a caller-chosen set of ids
// (MemoryPage.tsx's own "forget selected"/"clear all"), one round trip
// regardless of how many are selected, rather than the client looping
// N single-forget calls.
const batchForgetRoute = createRoute({
  method: "post",
  path: "/batch-forget",
  tags: ["Memory"],
  summary: "Forget (tombstone) several memories at once",
  middleware: [requireAuth] as const,
  request: {
    body: { content: { "application/json": { schema: z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }) } } },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            outcomes: z.array(z.object({ id: z.string(), deleted: z.boolean(), reason: z.string().optional() })),
          }),
        },
      },
      description: "One outcome per requested id, in the same words the single-forget/archive routes would have used for a failure.",
    },
    ...errorResponses({ 400: "ids is missing, empty, or not a list of strings", 401: "Not signed in" }),
  },
});
memoryRoutes.openapi(batchForgetRoute, (c) => {
  const actor = c.get("person");
  const { ids = [], all } = c.req.valid("json");
  if (all) {
    const ids: string[] = [];
    for (let cursor: string | undefined; ;) {
      const page = listPage(actor, { scopes: ["person", "household"], robotBound: "all", limit: 500, cursor });
      ids.push(...page.records.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const result = forgetByIds(actor, ids);
    return c.json({ outcomes: result }, 200);
  }
  if (ids.length === 0) return c.json({ error: "no memories were selected" }, 400);
  return c.json({ outcomes: forgetByIds(actor, ids) }, 200);
});

memoryRoutes.post("/maintenance/run", requireRole("owner", "admin"), async (c) => {
  return c.json(runMaintenance());
});

memoryRoutes.post("/:id/archive", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = archive(actor, c.req.param("id"));
  if (!result.ok) return refuseWith(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/:id/restore", requireAuth, async (c) => {
  const result = restore(c.get("person"), c.req.param("id"));
  if (!result.ok) return refuseWith(c, result);
  return c.json(result.value);
});

const AudienceBodySchema = z.object({
  child_disclosure: z.enum(["child_ok", "teen_ok", "adult_only"]),
});

// AGE-01 (c): an adult chooses who may hear a household memory. The
// actor check (adult only, via speakerAgeBand in setChildDisclosure)
// and the scope check (household only) both live in the store, same as
// archive()'s own checks, so this route stays a thin pass-through.
memoryRoutes.post("/:id/audience", requireAuth, async (c) => {
  const actor = c.get("person");
  const rawBody = await c.req.json().catch(() => null);
  const parsed = AudienceBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  const result = setChildDisclosure(actor, c.req.param("id"), parsed.data.child_disclosure);
  if (!result.ok) return refuseWith(c, result);
  return c.json(result.value);
});

// ==== Step 10 (session-c-brain-and-voice.md): import from the legacy hub ====
//
// Owner-only, not owner-or-admin: like backups.ts's own restore route,
// this rewrites the household's actual roster and lifetime of memories
// from an external file - a household-identity-shaping action, the
// owner's call the same way a backup restore already is. No grant-
// actions.json vocabulary entry exists for this yet (a one-time
// migration tool has no natural repeating "capability" to delegate the
// way people.manage or backups.run do), so this stays on plain
// requireRole() rather than requireRoleOrGrant() - the same documented
// choice middleware/auth.ts's own requireRoleOrGrant() comment already
// names for host.ts/plugins.ts/scheduler.ts/totp.ts, applied here for
// the identical reason.
const LegacyImportRequestSchema = z.object({
  db_path: z.string().min(1).openapi({
    description: "Absolute path to the legacy app.db file on this same machine.",
    example: "/data/legacy/app.db",
  }),
  dry_run: z.boolean().optional().openapi({
    description: "Default true. A real import (false) additionally refuses without at least one backup already on file.",
  }),
});

const PersonResolutionSchema = z.object({
  legacyId: z.string(),
  displayName: z.string(),
  outcome: z.enum(["matched_existing", "created", "skipped_needs_parent_pick"]),
  personId: z.string().nullable(),
});

const LegacyImportCountsSchema = z.object({
  peopleMatched: z.number(),
  peopleCreated: z.number(),
  peopleSkippedMinor: z.number(),
  memoriesImported: z.number(),
  memoriesAlreadyPresent: z.number(),
  memoriesSkippedNoPerson: z.number(),
  conversationsImported: z.number(),
  conversationsAlreadyPresent: z.number(),
  conversationsSkippedNoPerson: z.number(),
  turnsImported: z.number(),
  turnsAlreadyPresent: z.number(),
  turnsSkippedSystemMessages: z.number(),
});

const LegacyImportResultSchema = z.object({
  dryRun: z.boolean(),
  people: z.array(PersonResolutionSchema),
  counts: LegacyImportCountsSchema,
  errors: z.array(z.string()),
});

const importLegacyRoute = createRoute({
  method: "post",
  path: "/import/legacy",
  tags: ["Memory"],
  summary: "Import people, memories, and chat history from a legacy hub database",
  middleware: [requireRole("owner")] as const,
  request: {
    body: { content: { "application/json": { schema: LegacyImportRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: LegacyImportResultSchema } }, description: "Dry run or real import result." },
    ...errorResponses({ 400: "Bad db_path, or a real import with no backup on file", 401: "Not signed in", 403: "Not owner" }),
  },
});
memoryRoutes.openapi(importLegacyRoute, (c) => {
  const actor = c.get("person");
  const body = c.req.valid("json");
  try {
    const result = runLegacyImport(actor, { dbPath: body.db_path, dryRun: body.dry_run });
    return c.json(result, 200);
  } catch (err) {
    if (err instanceof LegacyImportError) return c.json({ error: err.message }, 400);
    throw err;
  }
});
