import { type Context } from "hono";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, emptyJsonBodyAsObject, errorResponses, idParamSchema } from "@/lib/openapi";
import { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import { ReplyFeedback } from "@maipai/spec/gen/ts/reply-feedback.js";
import { TurnArtifact } from "@maipai/spec/gen/ts/turn-artifact.js";
import { requireAuth } from "@/middleware/auth";
import { db } from "@/db";
import { conversationTurns, replyFeedback } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessPerson } from "@/lib/access";
import { projectDocument } from "@/lib/composer";
import { speakerAgeBand } from "@/lib/ageBand";
import { nextHlc } from "@/lib/hlc";
import { newReplyFeedbackId } from "@/lib/id";
import {
  list,
  exportPerson,
  listConversations,
  listTemporaryConversations,
  discardTemporarySessions,
  resumeConversation,
  createConversation,
  getConversation,
  listConversationTurns,
  updateConversationTitle,
  updateConversationArchived,
  updateConversationFolder,
  updateConversationMode,
  updateConversationSettings,
  deleteConversationById,
  batchDeleteConversations,
  clearConversations,
  chooseConversationTurn,
  forkConversationAtTurn,
  type ConversationOpResult,
} from "@/lib/conversationHistory";
import { recallEpisodes } from "@/lib/episodes";
import { ensureConversationTitleScheduled } from "@/lib/conversationTitle";
import { embedQueryForRecall } from "@/lib/memory";
import type { AppEnv, PersonRow } from "@/types";
import type { Surface } from "@/lib/turnShared";

export const conversationsRoutes = apiRouter();

// Matches every sibling route file's own fail() (memory.ts, commands.ts,
// notifications.ts, scheduler.ts, settings.ts) - a code review,
// 2026-09-05, found this file was the one inlining the identical
// `{ error: result.error }, result.status` shape four times instead.
function fail(c: Context<AppEnv>, result: Extract<ConversationOpResult<unknown>, { ok: false }>) {
  return c.json({ error: result.error }, result.status);
}

// list() enforces the real visibility rule (self, or owner/admin for a
// child) internally and returns an empty result rather than an error for
// anyone else's target: a household member asking for someone they can't
// see gets "nothing here," matching memory.ts's list()/recall() browsing
// precedent. export is a privileged single-target action (memory.ts's own
// exportPerson() precedent), so it returns a real 403 instead.

// Session A step 3: GET / now lists the actor's conversation THREADS
// (the contract's new shape). The pre-existing flat-turn-list behaviour
// moves to GET /turns unchanged. NOTE (found by this step's own code
// review, 2026-09-05): frontend/src/apps/chat/ChatPage.tsx's history
// load calls plain `/api/conversations` today and expects the OLD flat-
// turn-list shape - this is a REAL, LIVE break for the shipped chat UI,
// not just a latent one, until Session B repoints that one call to
// `/api/conversations/turns` (see docs/dev.md's frontend note for the
// full list of what else needs updating).
conversationsRoutes.get("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person");
  const query = c.req.query("q");
  // HOME-UI-02e: was `query ? undefined : person` - a search query
  // silently discarded whatever person was being viewed, sending an
  // admin who typed a search while viewing a child's own thread list
  // back to searching their own conversations instead, with nothing on
  // screen saying so. `listConversations` itself already scopes the
  // search to whichever target `personId` names (`target = personId ??
  // actor.id`, conversationHistory.ts), so there was never a reason to
  // drop it here.
  const archived = c.req.query("archived");
  return c.json(listConversations(actor, person, query, { archived: archived === "include" || archived === "only" ? archived : "exclude" }));
});

conversationsRoutes.get("/incognito", requireAuth, async (c) => {
  const actor = c.get("person");
  return c.json(listTemporaryConversations(actor, c.req.query("person")));
});

conversationsRoutes.post("/incognito/discard", requireAuth, async (c) => {
  const actor = c.get("person");
  const target = c.req.query("person") ?? actor.id;
  if (!canAccessPerson(actor, target)) return c.json({ error: "Person not found" }, 404);
  return c.json({ discarded: discardTemporarySessions(target) });
});

conversationsRoutes.get("/turns", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person");
  return c.json(list(actor, person));
});

conversationsRoutes.post("/turns/:id/choose", requireAuth, async (c) => {
  const result = chooseConversationTurn(c.get("person"), c.req.param("id"));
  if (!result.ok) return fail(c, result);
  return c.json({ turn_id: result.value.id, parent_turn_id: result.value.parentTurnId, branch_chosen: result.value.branchChosen });
});

conversationsRoutes.post("/turns/:id/fork", requireAuth, async (c) => {
  const result = forkConversationAtTurn(c.get("person"), c.req.param("id"));
  if (!result.ok) return fail(c, result);
  return c.json(result.value, 201);
});

conversationsRoutes.get("/export", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person") ?? actor.id;
  const result = exportPerson(actor, person);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

// PROJECTS-01a: converted to @hono/zod-openapi when touched. The body
// fields stay loosely typed here so each keeps its own, already tested,
// error message from the checks below.
const CreateConversationBody = z.object({
  surface: z.string().optional().describe("Where the chat happens; defaults to chat."),
  companion_id: z.string().nullable().optional().describe("The companion for this chat."),
  mode: z.unknown().optional().describe("chat, research or temporary."),
  carry_from: z.unknown().optional().describe("A conversation id whose summary seeds this chat (THIN-3G)."),
  folder_id: z.unknown().optional().describe("A project (chat folder) id to start the chat inside (PROJECTS-01a). Never for a temporary chat."),
});

const createConversationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Conversations"],
  summary: "Start a conversation",
  middleware: [requireAuth, emptyJsonBodyAsObject] as const,
  request: { body: { required: false, content: { "application/json": { schema: CreateConversationBody } } } },
  responses: {
    201: { content: { "application/json": { schema: Conversation } }, description: "The new conversation." },
    ...errorResponses({ 400: "Bad surface, mode, carry_from or folder_id", 401: "Sign in first", 403: "Temporary chat is not available for minors", 404: "carry_from not found" }),
  },
});

conversationsRoutes.openapi(createConversationRoute, (c) => {
  const actor = c.get("person");
  const body = (c.req.valid("json") ?? {}) as { surface?: Surface; companion_id?: string | null; mode?: unknown; carry_from?: unknown; folder_id?: unknown };
  const mode = body.mode === undefined ? undefined : Conversation.shape.mode.safeParse(body.mode);
  if (mode && !mode.success) return c.json({ error: "invalid conversation mode" }, 400);
  if (body.carry_from !== undefined && body.carry_from !== null && typeof body.carry_from !== "string") return c.json({ error: "carry_from must be a conversation id" }, 400);
  if (body.folder_id !== undefined && body.folder_id !== null && typeof body.folder_id !== "string") return c.json({ error: "folder_id must be a project id" }, 400);
  // THIN-3G: carry_from seeds the new chat with that chat's summary.
  // PROJECTS-01a: folder_id starts the chat inside one of the person's projects.
  const result = createConversation(actor, { surface: body.surface, companionId: body.companion_id, mode: mode?.data, carryFrom: (body.carry_from as string | null | undefined) ?? null, folderId: (body.folder_id as string | null | undefined) ?? null });
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 201);
});

// The two static routes above (/turns, /export) are registered before
// this dynamic /:id family so they aren't shadowed by it - Hono matches
// route definition order, and "export"/"turns" would otherwise parse as
// a conversation id.
conversationsRoutes.post("/batch-delete", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids)) return c.json({ error: "ids is required" }, 400);
  return c.json(batchDeleteConversations(actor, body.ids));
});

conversationsRoutes.post("/clear", requireAuth, async (c) => {
  const actor = c.get("person");
  return c.json(clearConversations(actor));
});

// Registered before the "/:id" routes on purpose: Hono matches in
// registration order, and "/search" would otherwise be read as an id.
const SearchQuerySchema = z.object({
  q: z.string().min(1).describe("Search query"),
  limit: z.coerce.number().int().min(1).max(20).default(5).describe("Results to return"),
});

// ELEMENTS-ADOPT-02: `reasons` and `note` are the "What went wrong?" form
// (the kit's feedback-dialog). Both optional, so an older client's
// one-tap body is unchanged.
// Their spec defaults are dropped here so an absent field stays absent and
// a plain one-tap down can keep the details already saved.
const FeedbackBodySchema = ReplyFeedback.pick({ verdict: true, reason: true }).extend({
  reasons: ReplyFeedback.shape.reasons.unwrap().optional(),
  note: ReplyFeedback.shape.note.unwrap().optional(),
});

function storedReasons(raw: string): NonNullable<ReplyFeedback["reasons"]> {
  try {
    const parsed = ReplyFeedback.shape.reasons.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toReplyFeedback(row: typeof replyFeedback.$inferSelect) {
  return ReplyFeedback.parse({
    id: row.id,
    turn_id: row.turnId,
    person_id: row.personId,
    verdict: row.verdict,
    reason: row.reason,
    reasons: storedReasons(row.reasons),
    note: row.note,
    source: row.source,
    created_at: row.createdAt,
    hlc: row.hlc,
  });
}

const feedbackRouteRequest = {
  params: idParamSchema("id", "turn-example123"),
  body: { content: { "application/json": { schema: FeedbackBodySchema } } },
};

const feedbackResponses = {
  200: { content: { "application/json": { schema: ReplyFeedback.nullable() } }, description: "The current person's label, or null when this turn has not been rated." },
  ...errorResponses({ 400: "Invalid feedback, or a child supplied a reason or a note", 401: "Sign in first", 404: "Turn not found or not visible" }),
};

const getFeedbackRoute = createRoute({
  method: "get",
  path: "/turns/{id}/feedback",
  tags: ["Conversations"],
  summary: "Read my label for an assistant turn",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "turn-example123") },
  responses: feedbackResponses,
});

const postFeedbackRoute = createRoute({
  method: "post",
  path: "/turns/{id}/feedback",
  tags: ["Conversations"],
  summary: "Label an assistant turn",
  middleware: [requireAuth] as const,
  request: feedbackRouteRequest,
  responses: feedbackResponses,
});

const documentRoute = createRoute({
  method: "get",
  path: "/turns/{id}/document",
  tags: ["Conversations"],
  summary: "Read the details document for an assistant turn",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "turn-example123") },
  responses: {
    200: { content: { "application/json": { schema: TurnArtifact } }, description: "The validated details document." },
    ...errorResponses({ 401: "Sign in first", 404: "Turn or details document not found" }),
  },
});

function visibleTurn(actor: PersonRow, id: string) {
  const turn = db.select().from(conversationTurns).where(eq(conversationTurns.id, id)).get();
  if (!turn || !canAccessPerson(actor, turn.personId)) return null;
  return turn;
}

conversationsRoutes.openapi(getFeedbackRoute, (c) => {
  const actor = c.get("person");
  const turn = visibleTurn(actor, c.req.valid("param").id);
  if (!turn) return c.json({ error: "turn not found" }, 404);
  const row = db
    .select()
    .from(replyFeedback)
    .where(and(eq(replyFeedback.turnId, turn.id), eq(replyFeedback.personId, actor.id)))
    .get();
  return c.json(row ? toReplyFeedback(row) : null, 200);
});

conversationsRoutes.openapi(postFeedbackRoute, (c) => {
  const actor = c.get("person");
  const { id } = c.req.valid("param");
  const turn = visibleTurn(actor, id);
  if (!turn) return c.json({ error: "turn not found" }, 404);
  const body = c.req.valid("json");
  const reasons = body.reasons ?? [];
  // A note that is only whitespace is no note.
  const note = body.note?.trim() ? body.note.trim() : null;
  // The child band never exposes or stores a reason or a note (FEED-01,
  // ELEMENTS-ADOPT-02). The band is the stricter of role and birthdate
  // (speakerAgeBand), so a person whose birthdate makes them a child is
  // refused too, whatever their role.
  if (speakerAgeBand(actor, new Date()) === "child" && (body.reason !== null || reasons.length > 0 || note !== null)) {
    return c.json({ error: "child-band feedback cannot include a reason or a note" }, 400);
  }
  // Reasons and a note only explain a down rating; an up rating clears them.
  const down = body.verdict === "down";
  const existing = db
    .select()
    .from(replyFeedback)
    .where(and(eq(replyFeedback.turnId, id), eq(replyFeedback.personId, actor.id)))
    .get();
  // A plain one-tap down (the thumbs again, or an older client) carries no
  // details: it keeps the reasons and note already saved for this reply
  // rather than wiping them. Only an up rating or details sent explicitly
  // replace them.
  const keepDetails = down && body.reasons === undefined && body.note === undefined && body.reason === null && existing?.verdict === "down";
  const keptReasons = keepDetails && existing ? storedReasons(existing.reasons) : reasons;
  const keptNote = keepDetails && existing ? existing.note : note;
  const keptReason = keepDetails && existing ? existing.reason : (body.reason ?? reasons[0] ?? null);
  const now = new Date().toISOString();
  const parsed = ReplyFeedback.parse({
    id: existing?.id ?? newReplyFeedbackId(),
    turn_id: id,
    person_id: actor.id,
    verdict: body.verdict,
    reason: down ? keptReason : null,
    reasons: down ? keptReasons : [],
    note: down ? keptNote : null,
    source: `api:${actor.id}`,
    created_at: now,
    hlc: nextHlc(),
  });
  db.insert(replyFeedback)
    .values({
      id: parsed.id,
      turnId: parsed.turn_id,
      personId: parsed.person_id,
      verdict: parsed.verdict,
      reason: parsed.reason,
      reasons: JSON.stringify(parsed.reasons),
      note: parsed.note,
      source: parsed.source,
      createdAt: parsed.created_at,
      hlc: parsed.hlc,
    })
    .onConflictDoUpdate({
      target: [replyFeedback.turnId, replyFeedback.personId],
      set: {
        verdict: parsed.verdict,
        reason: parsed.reason,
        reasons: JSON.stringify(parsed.reasons),
        note: parsed.note,
        source: parsed.source,
        createdAt: parsed.created_at,
        hlc: parsed.hlc,
      },
    })
    .run();
  const saved = db
    .select()
    .from(replyFeedback)
    .where(and(eq(replyFeedback.turnId, id), eq(replyFeedback.personId, actor.id)))
    .get()!;
  return c.json(toReplyFeedback(saved), 200);
});

conversationsRoutes.openapi(documentRoute, (c) => {
  const actor = c.get("person");
  const turn = visibleTurn(actor, c.req.valid("param").id);
  if (!turn || !turn.document) return c.json({ error: "document not found" }, 404);
  try {
    const parsed = TurnArtifact.safeParse(JSON.parse(turn.document));
    if (!parsed.success || parsed.data.turn_id !== turn.id) return c.json({ error: "document not found" }, 404);
    // COMP-01d: the stored artifact is the adult document. A child gets the
    // same bounded content after the shared projection removes every source
    // link, so the details pane cannot disclose an external citation.
    const projected = projectDocument(parsed.data, speakerAgeBand(actor, new Date()));
    if (!projected) return c.json({ error: "document not found" }, 404);
    return c.json(projected as typeof parsed.data, 200);
  } catch {
    return c.json({ error: "document not found" }, 404);
  }
});

const EpisodeSchema = z.object({
  turn_id: z.string().describe("The turn this was said in"),
  conversation_id: z.string().nullable().describe("The conversation that turn belongs to"),
  created_at: z.string().describe("When it was said (ISO 8601)"),
  speaker: z.enum(["user", "assistant"]).describe("Who said it: you, or the assistant"),
  text: z.string().describe("What was said, verbatim"),
  paired_text: z.string().describe("The other side of the same turn"),
  score: z.number().describe("Fused relevance rank score; higher is more relevant"),
});

const searchRoute = createRoute({
  method: "get",
  path: "/search",
  tags: ["Conversations"],
  summary: "Search episode history across conversations",
  middleware: [requireAuth] as const,
  request: { query: SearchQuerySchema },
  responses: {
    200: { content: { "application/json": { schema: z.array(EpisodeSchema) } }, description: "Recalled episodes ranked by relevance." },
    ...errorResponses({ 401: "Sign in first" }),
  },
});

conversationsRoutes.openapi(searchRoute, async (c) => {
  const actor = c.get("person");
  const { q, limit } = c.req.valid("query");
  // The turn engine passes its own utterance vector; a search request
  // has none yet, so it embeds once here (undefined when the embed
  // engine is down, in which case lexical recall alone answers).
  const vector = await embedQueryForRecall(q);
  // #88: the history view keeps what was said; RECALL-02b: both sides,
  // the side that matched returned verbatim (a person searching their
  // history wants the hub's answers too; the prompt's own recall reads
  // the person's side only).
  const results = recallEpisodes(actor, q, vector, { limit, includeSuperseded: true, sides: "both" });
  return c.json(
    results.map((m) => ({
      turn_id: m.episode.turnId,
      conversation_id: m.episode.conversationId ?? null,
      created_at: m.episode.createdAt,
      speaker: m.episode.speaker,
      text: m.episode.text,
      paired_text: m.pairedText,
      score: m.score,
    })),
    200,
  );
});

conversationsRoutes.get("/:id", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = getConversation(actor, c.req.param("id"));
  if (!result.ok) return fail(c, result);
  // CHAT-TITLE-01: a stored chat read with no title and nothing on its way gets its title asked for again.
  if (result.value.title == null && result.value.mode !== "temporary") ensureConversationTitleScheduled(result.value.id);
  return c.json(result.value);
});

conversationsRoutes.get("/:id/turns", requireAuth, async (c) => {
  const actor = c.get("person");
  const since = c.req.query("since");
  const result = listConversationTurns(actor, c.req.param("id"), { since });
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

// PROJECTS-01a: converted to @hono/zod-openapi when touched; one field
// per request, each branch keeping its own checks and messages.
const PatchConversationBody = z.object({
  title: z.unknown().optional().describe("A new title, or null to let the model name it."),
  pinned: z.unknown().optional().describe("Keep it at the top of the list."),
  archived: z.unknown().optional().describe("Shelve or restore the chat (CONV-ARCHIVE-01)."),
  mode: z.unknown().optional().describe("chat, research or temporary."),
  settings: z.unknown().optional().describe("A key-wise settings patch; null removes a key."),
  folder_id: z.unknown().optional().describe("Move the chat into a project (chat folder) id, or out with null (PROJECTS-01a)."),
});

const patchConversationRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Conversations"],
  summary: "Change a conversation",
  middleware: [requireAuth, emptyJsonBodyAsObject] as const,
  request: { params: idParamSchema("id", "conv-example123"), body: { required: false, content: { "application/json": { schema: PatchConversationBody } } } },
  responses: {
    200: { content: { "application/json": { schema: Conversation } }, description: "The changed conversation." },
    ...errorResponses({ 400: "A bad value", 401: "Sign in first", 403: "Not allowed for this person", 404: "Conversation not found" }),
  },
});

conversationsRoutes.openapi(patchConversationRoute, (c) => {
  const actor = c.get("person");
  const body = (c.req.valid("json") ?? {}) as { title?: string | null; pinned?: boolean; archived?: boolean; mode?: Conversation["mode"]; settings?: unknown; folder_id?: unknown };
  const id = c.req.valid("param").id;
  // PROJECTS-01a: move the chat into a project, or out of one with null.
  if (Object.hasOwn(body, "folder_id")) {
    const result = updateConversationFolder(actor, id, body.folder_id);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
    return c.json(result.value, 200);
  }
  if (body.archived !== undefined) {
    const result = updateConversationArchived(actor, id, body.archived);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
    return c.json(result.value, 200);
  }
  if (body.mode !== undefined) {
    const mode = Conversation.shape.mode.safeParse(body.mode);
    if (!mode.success || mode.data === undefined) return c.json({ error: "invalid conversation mode" }, 400);
    const result = updateConversationMode(actor, id, mode.data);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
    return c.json(result.value, 200);
  }
  if (Object.hasOwn(body, "settings")) {
    const result = updateConversationSettings(actor, id, body.settings);
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
    return c.json(result.value, 200);
  }
  const result = updateConversationTitle(actor, id, body.title, body.pinned);
  if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 403 | 404);
  return c.json(result.value, 200);
});

conversationsRoutes.delete("/:id", requireAuth, async (c) => {
  const actor = c.get("person");
  const result = deleteConversationById(actor, c.req.param("id"));
  if (!result.ok) return fail(c, result);
  return c.json({ ok: true });
});


const resumeRoute = createRoute({
  method: "post",
  path: "/{id}/resume",
  tags: ["Conversations"],
  summary: "Continue my saved conversation",
  middleware: [requireAuth] as const,
  request: { params: idParamSchema("id", "conv-example123") },
  responses: {
    200: { content: { "application/json": { schema: Conversation } }, description: "Active conversation, with history preserved." },
    ...errorResponses({ 401: "Sign in first", 404: "Conversation not found" }),
  },
});
conversationsRoutes.openapi(resumeRoute, (c) => {
  const result = resumeConversation(c.get("person"), c.req.valid("param").id);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result.value, 200);
});
