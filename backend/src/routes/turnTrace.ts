import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { db } from "@/db";
import { conversationTurns, conversations } from "@/db/schema";
import { isTemporaryConversation } from "@/lib/conversationHistory";
import { makeTurnTrace } from "@/lib/turnTrace";
import type { TurnStats } from "@/wire";

export const turnTraceRoutes = apiRouter();

const SpanSchema = z.object({
  id: z.string(), name: z.string(), depth: z.number().int(), startMs: z.number(), durationMs: z.number(),
  status: z.enum(["running", "completed", "failed"]),
});
const TraceSchema = z.object({ spans: z.array(SpanSchema), totalMs: z.number() });
const traceRoute = createRoute({
  method: "get",
  path: "/:id/trace",
  tags: ["Admin"],
  summary: "Read a turn's safe timing trace",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ id: z.string().min(1).openapi({ param: { name: "id", in: "path" } }) }) },
  responses: {
    200: { content: { "application/json": { schema: TraceSchema } }, description: "Stored timings and statuses only; minor turns never include engine error codes." },
    ...errorResponses({ 403: "Not owner/admin", 404: "Turn not found or temporary" }),
  },
});

turnTraceRoutes.openapi(traceRoute, async (c) => {
  const { id } = c.req.valid("param");
  const turn = db.select({ id: conversationTurns.id, conversationId: conversationTurns.conversationId, minorSpeaker: conversationTurns.minorSpeaker, stats: conversationTurns.stats, outcomes: conversationTurns.outcomes })
    .from(conversationTurns).where(eq(conversationTurns.id, id)).get();
  if (!turn || !turn.conversationId || isTemporaryConversation(turn.conversationId)) return c.json({ error: "not_found", message: "Turn not found" }, 404);
  const conversation = db.select({ mode: conversations.mode }).from(conversations).where(eq(conversations.id, turn.conversationId)).get();
  if (!conversation || conversation.mode === "temporary") return c.json({ error: "not_found", message: "Turn not found" }, 404);
  let stats: TurnStats | null = null;
  try { stats = turn.stats ? JSON.parse(turn.stats) as TurnStats : null; } catch { stats = null; }
  return c.json(makeTurnTrace(stats, turn.minorSpeaker, turn.outcomes), 200);
});
