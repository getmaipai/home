// THIN-1E (docs/design/RULES.md rule 6): the raw detail of a failed tool
// call or generation is read from what the turn row already stores (the
// `outcomes` column and the generation records inside `stats`) and goes to
// an admin only. Everyone else's payloads are scrubbed here, at the one
// place both the stored-turn listing and the turn route's done values call.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { speakerAgeBand } from "@/lib/ageBand";
import { redactCredentials } from "@/lib/memoryContentPolicy";
import { lookupFailureKind, type LookupFailureKind } from "@/lib/turnMachine/nodes/lookupFallback";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import type { TurnStats, TurnValue } from "@/wire";

export interface ToolFailureDetail {
  tool_id: string;
  call_id: string;
  kind: LookupFailureKind;
  error_code?: string;
  error_text?: string;
  at?: string;
  duration_ms?: number;
}

export interface GenerationFailureDetail {
  reason: string;
  error: string;
  request_sent_ms: number;
  offline_reason?: string;
}

export interface TurnErrorDetail {
  turn_id: string;
  tools: ToolFailureDetail[];
  generations: GenerationFailureDetail[];
}

/** Whether this person may read raw error details: an owner or admin who is an adult. */
export function canReadErrorDetail(actor: PersonRow): boolean {
  return (actor.role === "owner" || actor.role === "admin") && speakerAgeBand(actor, new Date()) === "adult";
}

/** The stored detail of one turn, redacted, or null when the turn does not exist. */
export function turnErrorDetail(turnId: string): TurnErrorDetail | null {
  const row = db.select({ outcomes: conversationTurns.outcomes, stats: conversationTurns.stats }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  if (!row) return null;
  const tools: ToolFailureDetail[] = [];
  for (const o of parse<ToolExecutionOutcome[]>(row.outcomes) ?? []) {
    if (o.status !== "failed") continue;
    tools.push({
      tool_id: o.packageId,
      call_id: o.callId,
      kind: lookupFailureKind(o),
      ...(o.errorCode ? { error_code: redactCredentials(o.errorCode) } : {}),
      ...(o.userMessage ? { error_text: redactCredentials(o.userMessage) } : {}),
      ...(o.at ? { at: o.at } : {}),
      ...(o.durationMs !== undefined ? { duration_ms: o.durationMs } : {}),
    });
  }
  const generations: GenerationFailureDetail[] = [];
  for (const g of parse<TurnStats>(row.stats)?.generations ?? []) {
    if (!g.error) continue;
    generations.push({
      reason: g.reason,
      error: redactCredentials(g.error),
      request_sent_ms: g.request_sent_ms,
      ...(g.offline_reason ? { offline_reason: redactCredentials(g.offline_reason) } : {}),
    });
  }
  return { turn_id: turnId, tools, generations };
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}

/** `stats` without the raw generation cause, for anyone who may not read it. */
export function statsForViewer<S extends Pick<TurnStats, "generations"> | undefined>(stats: S, actor: PersonRow): S {
  if (!stats || canReadErrorDetail(actor)) return stats;
  return { ...stats, generations: stats.generations.map(({ error: _error, offline_reason: _reason, ...rest }) => ({ ...rest, error: null })) };
}

/** A turn value for the wire: raw generation errors only for an admin. */
export function valueForViewer<V extends Pick<TurnValue, "stats">>(value: V, actor: PersonRow): V {
  return value.stats ? { ...value, stats: statsForViewer(value.stats, actor) } : value;
}
