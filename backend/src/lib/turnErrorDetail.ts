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
import { lookupFailureKind } from "@/lib/turnMachine/nodes/lookupFallback";
import type { ToolExecutionOutcome } from "@/lib/turnContext";
import type { PersonRow } from "@/types";
import type { FailureAdviceDetail, GenerationFailureDetail, ToolFailureDetail, TurnErrorDetail, TurnGeneration, TurnStats, TurnStreamEvent, TurnValue } from "@/wire";
import { FAILURE_ADVICE, TOOL_FAILURE_ADVICE, stackRefusalKind, type FailureKind } from "@/lib/failureCopy";
import { classifyGenerationFailure } from "@/lib/generationFailure";

export type { ToolFailureDetail, GenerationFailureDetail, FailureAdviceDetail, TurnErrorDetail } from "@/wire";

/** Whether this person may read raw error details: an owner or admin who is an adult. */
export function canReadErrorDetail(actor: PersonRow): boolean {
  return (actor.role === "owner" || actor.role === "admin") && speakerAgeBand(actor, new Date()) === "adult";
}

/** The raw error text a failed run kept (T5/R2 `detail`; older rows kept it in `userMessage`). */
function rawText(o: ToolExecutionOutcome): string | undefined {
  return o.detail ?? o.userMessage;
}

/** Whose turn it is, or null when there is no such turn. */
export function turnOwnerId(turnId: string): string | null {
  return db.select({ personId: conversationTurns.personId }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()?.personId ?? null;
}

/** The stored detail of one turn, redacted, or null when the turn does not exist. */
export function turnErrorDetail(turnId: string): TurnErrorDetail | null {
  const row = db.select({ outcomes: conversationTurns.outcomes, stats: conversationTurns.stats }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  if (!row) return null;
  return turnErrorDetailFrom(turnId, parse<ToolExecutionOutcome[]>(row.outcomes) ?? [], parse<TurnStats>(row.stats)?.generations ?? []);
}

/** The detail built from a turn's own outcomes and generation records -
 * the stored row's (above) or a live turn's (the stream's error event,
 * turnNext.ts), so both read the same shape. Every text is redacted. */
export function turnErrorDetailFrom(turnId: string, outcomes: readonly ToolExecutionOutcome[], records: readonly TurnGeneration[]): TurnErrorDetail {
  const tools: ToolFailureDetail[] = [];
  for (const o of outcomes) {
    if (o.status !== "failed") continue;
    tools.push({
      tool_id: o.packageId,
      call_id: o.callId,
      kind: lookupFailureKind(o),
      ...(o.errorCode ? { error_code: redactCredentials(o.errorCode) } : {}),
      ...(rawText(o) ? { error_text: redactCredentials(rawText(o)!) } : {}),
      ...(o.at ? { at: o.at } : {}),
      ...(o.durationMs !== undefined ? { duration_ms: o.durationMs } : {}),
    });
  }
  const generations: GenerationFailureDetail[] = [];
  let generationKind: FailureKind | undefined;
  for (const g of records) {
    const error = g.stack_error ?? g.error;
    if (!error) continue;
    // The kind fixed on the record when it failed; an older record without
    // one is read from its own facts, never from the engine's state now.
    generationKind ??= g.failure_kind ?? (g.state ? stackRefusalKind(g.state, g.offline_reason ?? undefined) : classifyGenerationFailure(g.error ?? g.stack_error).kind);
    generations.push({
      reason: g.reason,
      error: redactCredentials(error),
      request_sent_ms: g.request_sent_ms,
      ...(g.offline_reason ? { offline_reason: redactCredentials(g.offline_reason) } : {}),
      ...(g.http_status !== undefined ? { http_status: g.http_status } : {}),
      ...(g.state ? { state: g.state } : {}),
      ...(g.raw_body ? { raw_body: redactCredentials(g.raw_body) } : {}),
      ...(g.engine_id ? { engine_id: redactCredentials(g.engine_id) } : {}),
      ...(g.model_id ? { model_id: redactCredentials(g.model_id) } : {}),
      ...(g.failed_ms !== undefined ? { failed_ms: g.failed_ms } : {}),
      ...(g.failed_at ? { failed_at: g.failed_at } : {}),
    });
  }
  const advice = generationKind ? FAILURE_ADVICE[generationKind] : tools[0] ? toolAdvice(tools[0]) : undefined;
  return { turn_id: turnId, found: true, ...(advice ? { advice } : {}), tools, generations };
}

function toolAdvice(tool: ToolFailureDetail): FailureAdviceDetail {
  const advice = TOOL_FAILURE_ADVICE[tool.kind];
  return { cause: `The ${tool.tool_id} tool ${advice.verb}.`, next_step: advice.next_step, repairs: advice.repairs };
}

/** The answer for a turn with no stored row (a temporary chat, or a turn
 * that stopped before it was logged): reported as such, never an error. */
export function missingTurnErrorDetail(turnId: string): TurnErrorDetail {
  return { turn_id: turnId, found: false, tools: [], generations: [] };
}

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}

/** The raw fields of a generation record that only an admin reads (rule 6). */
type RawGenerationField = "offline_reason" | "stack_error" | "http_status" | "state" | "raw_body" | "engine_id" | "model_id" | "failure_kind";

function scrubGeneration(g: TurnGeneration): TurnGeneration {
  const { error: _error, offline_reason: _reason, stack_error: _stackError, http_status: _status, state: _state, raw_body: _body, engine_id: _engine, model_id: _model, failure_kind: _kind, ...rest } = g;
  const kept: Omit<TurnGeneration, RawGenerationField | "error"> = rest;
  return { ...kept, error: null };
}

/** `stats` without the raw generation cause, for anyone who may not read it. */
export function statsForViewer<S extends Pick<TurnStats, "generations"> | undefined>(stats: S, actor: PersonRow): S {
  if (!stats || canReadErrorDetail(actor)) return stats;
  return { ...stats, generations: stats.generations.map(scrubGeneration) };
}

/** A turn value for the wire: raw generation errors only for an admin. */
export function valueForViewer<V extends Pick<TurnValue, "stats">>(value: V, actor: PersonRow): V {
  if (canReadErrorDetail(actor)) return value;
  const { failed_generation: _failedGeneration, ...safeValue } = value as V & Pick<TurnValue, "failed_generation">;
  const stats = value.stats ? statsForViewer(value.stats, actor) : undefined;
  return (stats ? { ...safeValue, stats } : safeValue) as V;
}

/** CHAT-CALM-ERRORS-01b (C1, C3): a stream event for the wire. A `done`
 * value goes through valueForViewer(); an `error` event's additive
 * `detail` reaches an adult owner or admin only. Every other event is
 * unchanged. */
export function streamEventForViewer(event: TurnStreamEvent, actor: PersonRow): TurnStreamEvent {
  if (event.type === "done") return { ...event, value: valueForViewer(event.value, actor) };
  if (event.type === "error" && event.detail !== undefined && !canReadErrorDetail(actor)) {
    const { detail: _detail, ...rest } = event;
    return rest;
  }
  return event;
}
