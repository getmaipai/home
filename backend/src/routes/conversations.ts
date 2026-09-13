import { type Context } from "hono";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRouter, errorResponses, idParamSchema } from "@/lib/openapi";
import { Conversation } from "@maipai/spec/gen/ts/conversation.js";
import { requireAuth } from "@/middleware/auth";
import {
  list,
  exportPerson,
  listConversations,
  resumeConversation,
  createConversation,
  getConversation,
  listConversationTurns,
  updateConversationTitle,
  deleteConversationById,
  batchDeleteConversations,
  clearConversations,
  type ConversationOpResult,
} from "@/lib/conversationHistory";
import { recallEpisodes } from "@/lib/episodes";
import { embedQueryForRecall } from "@/lib/memory";
import type { AppEnv } from "@/types";
import type { Surface } from "@/lib/turnEngine";

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
  return c.json(listConversations(actor, person));
});

conversationsRoutes.get("/turns", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person");
  return c.json(list(actor, person));
});

conversationsRoutes.get("/export", requireAuth, async (c) => {
  const actor = c.get("person");
  const person = c.req.query("person") ?? actor.id;
  const result = exportPerson(actor, person);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

conversationsRoutes.post("/", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { surface?: Surface; companion_id?: string | null };
  const result = createConversation(actor, { surface: body.surface, companionId: body.companion_id });
  if (!result.ok) return fail(c, result);
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
  const results = recallEpisodes(actor, q, vector, { limit });
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
  return c.json(result.value);
});

conversationsRoutes.get("/:id/turns", requireAuth, async (c) => {
  const actor = c.get("person");
  const since = c.req.query("since");
  const result = listConversationTurns(actor, c.req.param("id"), { since });
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
});

conversationsRoutes.patch("/:id", requireAuth, async (c) => {
  const actor = c.get("person");
  const body = (await c.req.json().catch(() => ({}))) as { title?: string | null };
  const result = updateConversationTitle(actor, c.req.param("id"), body.title ?? null);
  if (!result.ok) return fail(c, result);
  return c.json(result.value);
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
