import { createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { apiRouter, errorResponses } from "@/lib/openapi";
import { requireRole } from "@/middleware/auth";
import { db } from "@/db";
import { conversationTurns, conversations } from "@/db/schema";
import type { TurnGeneration, TurnNodeExecution } from "@/wire";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import { canReadErrorDetail } from "@/lib/turnErrorDetail";

export const turnTraceRoutes = apiRouter();

const SpanSchema = z.object({
  id: z.string(),
  name: z.string(),
  depth: z.number().int().min(0).max(1),
  startMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["running", "completed", "failed", "skipped"]),
  error_code: z.string().optional(),
});
const TraceSchema = z.object({ spans: z.array(SpanSchema), totalMs: z.number().nonnegative(), visibleCount: z.number().int().nonnegative() });

type StoredStats = { nodes?: TurnNodeExecution[]; generations?: TurnGeneration[] };

function json<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

function projectTrace(input: {
  stats: StoredStats | undefined;
  outcomes: ToolExecutionOutcome[] | undefined;
  createdAt: string;
  adultAdmin: boolean;
  minorSpeaker: boolean;
}) {
  const spans: z.infer<typeof SpanSchema>[] = [];
  const nodes = input.stats?.nodes ?? [];
  nodes.forEach((node, index) => {
    const status = "skipped" in node.outcome ? "skipped" : node.outcome.ok ? "completed" : "failed";
    spans.push({
      id: `node-${index}`,
      name: `${node.node} · ${node.impl} ${node.version}`,
      depth: 0,
      startMs: Math.max(0, node.startMs),
      durationMs: Math.max(0, node.endMs - node.startMs),
      status,
      ...(!input.minorSpeaker && input.adultAdmin && node.node === "model" && "ok" in node.outcome && !node.outcome.ok ? { error_code: node.outcome.code } : {}),
    });
  });

  (input.stats?.generations ?? []).forEach((generation, index) => {
    const timeToFirstToken = Math.max(0, (generation.first_delta_ms ?? generation.request_sent_ms) - generation.request_sent_ms);
    spans.push({
      id: `generation-${index}`,
      name: "Model generation",
      depth: 1,
      startMs: Math.max(0, generation.request_sent_ms),
      durationMs: timeToFirstToken + Math.max(0, generation.predicted_ms ?? 0),
      status: generation.error ? "failed" : "completed",
      ...(!input.minorSpeaker && input.adultAdmin && generation.error ? { error_code: generation.failure_kind ?? "generation_failed" } : {}),
    });
  });

  const turnStart = Date.parse(input.createdAt);
  (input.outcomes ?? []).forEach((outcome, index) => {
    if (!outcome.at || outcome.durationMs === undefined || !Number.isFinite(turnStart)) return;
    const endedAt = Date.parse(outcome.at);
    if (!Number.isFinite(endedAt)) return;
    spans.push({
      id: `tool-${index}`,
      name: "Tool call",
      depth: 1,
      startMs: Math.max(0, endedAt - turnStart - outcome.durationMs),
      durationMs: Math.max(0, outcome.durationMs),
      status: outcome.status === "failed" ? "failed" : outcome.status === "pending" ? "running" : outcome.status === "rejected" ? "skipped" : "completed",
    });
  });

  spans.sort((a, b) => a.startMs - b.startMs || a.depth - b.depth);
  const totalMs = spans.reduce((max, span) => Math.max(max, span.startMs + span.durationMs), 0);
  return { spans, totalMs, visibleCount: spans.length };
}

const getRoute = createRoute({
  method: "get",
  path: "/{id}/trace",
  tags: ["turn"],
  summary: "Read one turn's timing trace (owner/admin only)",
  description: "Returns names and timings only. Turn content, tool arguments, result text, and identity are omitted.",
  middleware: [requireRole("owner", "admin")] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: TraceSchema } }, description: "Timing-only trace spans." },
    ...errorResponses({ 403: "Not owner/admin", 404: "Unknown, temporary, or Incognito turn" }),
  },
});

turnTraceRoutes.openapi(getRoute, (c) => {
  const id = c.req.valid("param").id;
  const row = db.select({
    stats: conversationTurns.stats,
    outcomes: conversationTurns.outcomes,
    createdAt: conversationTurns.createdAt,
    minorSpeaker: conversationTurns.minorSpeaker,
    mode: conversations.mode,
  }).from(conversationTurns)
    .leftJoin(conversations, eq(conversationTurns.conversationId, conversations.id))
    .where(and(eq(conversationTurns.id, id), eq(conversationTurns.status, "done")))
    .get();
  if (!row || row.mode === "temporary" || row.mode === "incognito") return c.json({ error: "Not found" }, 404);

  const actor = c.get("person") as PersonRow;
  const result = projectTrace({
    stats: json<StoredStats>(row.stats),
    outcomes: json<ToolExecutionOutcome[]>(row.outcomes),
    createdAt: row.createdAt,
    adultAdmin: canReadErrorDetail(actor),
    minorSpeaker: row.minorSpeaker,
  });
  return c.json(result, 200);
});
