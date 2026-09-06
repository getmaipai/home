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
import type { AppEnv, PersonRow } from "@/types";

// apiRouter()'s OpenAPIHono extends Hono, so every plain `.post()`/`.get()`
// route below (unconverted, pre-dating getmaipai/.github/CLAUDE.md's
// @hono/zod-openapi requirement) keeps working exactly as it did on a
// bare `new Hono<AppEnv>()` - only the new route below (step 10) is
// declared through `.openapi()`, the minimum "any route you touch gets
// converted" the org standard actually asks for when the touch is one
// new endpoint, not a rewrite of a whole file's already-working routes.
export const memoryRoutes = apiRouter();

function fail(c: Context<AppEnv>, result: Extract<MemoryOpResult<unknown>, { ok: false }>) {
  return c.json({ error: result.error }, result.status);
}

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
});

// Derived from RememberBodySchema (a review, 2026-09-06, found the first
// version of this hand-copied six of its field validators): supersede
// doesn't take scope/person/record_kind (the old record's own values
// carry over), and every field but `text` is optional (an omitted one
// keeps the old record's value - lib/memory.ts's supersede() own `??
// old.<field>` fallbacks).
const SupersedeBodySchema = RememberBodySchema.pick({
  text: true,
  category: true,
  tier: true,
  importance: true,
  sensitive: true,
  pinned: true,
  valid_from: true,
  valid_to: true,
}).partial({ category: true, tier: true, importance: true, sensitive: true, pinned: true });

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
  if (!requested || requested === "memory") return requested;
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
  const parsed = RememberBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  const body = parsed.data;
  const result = remember(actor, {
    text: body.text,
    category: body.category,
    tier: body.tier,
    scope: body.scope,
    person: body.person ?? undefined,
    importance: body.importance,
    sensitive: body.sensitive,
    valid_from: body.valid_from,
    valid_to: body.valid_to,
    // Never from the client - see this file's own header on why.
    source: `api:${actor.id}`,
    pinned: sanitizedPinned(actor, body.pinned),
    record_kind: sanitizedRecordKind(actor, body.record_kind),
  });
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
  const rawBody = await c.req.json().catch(() => null);
  const parsed = SupersedeBodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  const body = parsed.data;
  const result = supersede(actor, c.req.param("id"), {
    text: body.text,
    category: body.category,
    tier: body.tier,
    importance: body.importance,
    sensitive: body.sensitive,
    valid_from: body.valid_from,
    valid_to: body.valid_to,
    // Never from the client, same as POST / above.
    source: `api:${actor.id}`,
    pinned: sanitizedPinned(actor, body.pinned),
  });
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
