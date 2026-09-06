import { Hono, type Context } from "hono";
import { createRoute, z } from "@hono/zod-openapi";
import { requireAuth, requireRole } from "@/middleware/auth";
import {
  remember,
  list,
  recall,
  archive,
  supersede,
  forget,
  exportPerson,
  runMaintenance,
  type MemoryOpResult,
  type ListOptions,
} from "@/lib/memory";
import { runLegacyImport, LegacyImportError } from "@/lib/legacyImport";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { isOwnerOrAdmin } from "@/lib/access";
import type { AppEnv } from "@/types";

// apiRouter()'s OpenAPIHono extends Hono, so every plain `.post()`/`.get()`
// route below (unconverted, pre-dating getmaipai/.github/CLAUDE.md's
// @hono/zod-openapi requirement) keeps working exactly as it did on a
// bare `new Hono<AppEnv>()` - only the new route below (step 10) is
// declared through `.openapi()`, the minimum "any route you touch gets
// converted" the org standard actually asks for when the touch is one
// new endpoint, not a rewrite of a whole file's already-working routes.
export const memoryRoutes = apiRouter();

const MEMORY_TEXT_MAX_LENGTH = 2_000;
const MEMORY_CATEGORY = z.enum([
  "person",
  "place",
  "thing",
  "preference",
  "identity",
  "event",
  "project",
  "goal",
  "relationship",
  "fact",
  "state",
]);
const MEMORY_TIER = z.enum(["durable", "episodic", "observation"]);
const MEMORY_SCOPE = z.enum(["household", "person", "self"]);
const MEMORY_RECORD_KIND = z.enum(["memory", "entity", "episode"]);
const PERSON_ID = z.string().regex(/^person-[a-z0-9]{6,}$/);
const MEMORY_DATE = z.string().datetime({ offset: true }).nullable().optional();

// The HTTP boundary is deliberately narrower than remember()'s core input:
// callers may describe a memory, but cannot forge its provenance, supply an
// embedding, or choose the embedding space. `.strict()` makes those fields a
// visible 400 instead of silently carrying an accidental future field into
// the core store.
const MemoryWriteSchema = z
  .object({
    record_kind: MEMORY_RECORD_KIND.optional().default("memory"),
    text: z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH),
    category: MEMORY_CATEGORY,
    tier: MEMORY_TIER,
    scope: MEMORY_SCOPE,
    person: PERSON_ID.nullable().optional(),
    // Accepted for compatibility with older clients, but never forwarded:
    // the route always replaces it with the authenticated actor's id below.
    source: z.string().min(1).max(200).optional(),
    importance: z.number().gte(0).lte(1),
    pinned: z.boolean().optional().default(false),
    sensitive: z.boolean().optional().default(false),
    valid_from: MEMORY_DATE,
    valid_to: MEMORY_DATE,
  })
  .strict();

const MemorySupersedeSchema = z
  .object({
    text: z.string().min(1).max(MEMORY_TEXT_MAX_LENGTH),
    category: MEMORY_CATEGORY.optional(),
    tier: MEMORY_TIER.optional(),
    // See MemoryWriteSchema: this value is intentionally ignored and
    // replaced with the authenticated actor's server-side provenance.
    source: z.string().min(1).max(200).optional(),
    importance: z.number().gte(0).lte(1).optional(),
    pinned: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    valid_from: MEMORY_DATE,
    valid_to: MEMORY_DATE,
  })
  .strict();

function invalidBody(c: Context<AppEnv>, error: { issues: Array<{ message: string }> }) {
  return c.json({ error: error.issues.map((issue) => issue.message).join("; ") }, 400);
}

function fail(c: Context<AppEnv>, result: Extract<MemoryOpResult<unknown>, { ok: false }>) {
  return c.json({ error: result.error }, result.status);
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
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "a JSON body is required" }, 400);
  const parsed = MemoryWriteSchema.safeParse(body);
  if (!parsed.success) return invalidBody(c, parsed.error);
  if ((parsed.data.record_kind === "entity" || parsed.data.pinned) && !isOwnerOrAdmin(actor)) {
    return c.json({ error: "only owner or admin may create entity or pinned memories" }, 403);
  }
  const result = remember(actor, { ...parsed.data, source: `api:${actor.id}` });
  if (!result.ok) return fail(c, result);
  return c.json(result.value, 201);
});

memoryRoutes.get("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const opts = parseListOptions(new URL(c.req.url).searchParams);
  return c.json(list(actor, opts));
});

// POST, not GET: recall has a real side effect (it bumps uses/
// last_used_at on every match, feeding decay scoring), so it isn't safe
// for a client, proxy, or browser prefetch to replay. A code review
// (2026-09-04) found this as a GET and pointed out exactly that risk
// (link-prefetch, a polling dashboard, or a retried request after a
// timeout silently inflating usage counts on records nobody actually
// used).
memoryRoutes.post("/recall", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as {
    q?: string;
    scope?: string;
    person?: string;
  };
  if (!body.q) return c.json({ error: "q is required" }, 400);
  const opts: ListOptions = {};
  if (body.scope === "household" || body.scope === "person" || body.scope === "self") {
    opts.scope = body.scope;
  }
  if (body.person) opts.person = body.person;
  return c.json(recall(actor, body.q, opts));
});

memoryRoutes.get("/export", requireAuth, async (c) => {
  const actor = c.get("person");
  const personId = new URL(c.req.url).searchParams.get("personId");
  if (!personId) return c.json({ error: "personId is required" }, 400);
  const result = exportPerson(actor, personId);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/forget", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { personId?: string };
  if (!body.personId) return c.json({ error: "personId is required" }, 400);
  const result = forget(actor, body.personId);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/maintenance/run", requireRole("owner", "admin"), async (c) => {
  return c.json(runMaintenance());
});

memoryRoutes.post("/:id/archive", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = archive(actor, c.req.param("id"));
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

memoryRoutes.post("/:id/supersede", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "a JSON body is required" }, 400);
  const parsed = MemorySupersedeSchema.safeParse(body);
  if (!parsed.success) return invalidBody(c, parsed.error);
  if (parsed.data.pinned === true && !isOwnerOrAdmin(actor)) {
    return c.json({ error: "only owner or admin may create pinned memories" }, 403);
  }
  const result = supersede(
    actor,
    c.req.param("id"),
    { ...parsed.data, source: `api:${actor.id}` },
    { enforcePrivilegedRoute: true },
  );
  if (!result.ok) return fail(c, result);
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
