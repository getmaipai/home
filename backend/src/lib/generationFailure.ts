// THIN-DL-02 (owner's rule, 2026-10-03): a person never meets "Sorry, I
// couldn't do that." when a generation fails. The failure is classified
// once, from what the Stack or the client reported, and the one table below
// is the only place the wording lives. Where no model can voice the reply,
// plain copy says what happened and what to try: no codes, no vendor text.
// The raw detail stays on the stored generation record (turnStats.ts).
import { OFFLINE_COMPANION_LINE, stackRefusal } from "@/lib/stackEngine";
import type { FailureKind } from "@/lib/failureCopy";

export * from "@/lib/failureCopy";


export interface ClassifiedFailure {
  kind: FailureKind;
  /** A quiet retry may help: the engine was loading, queued or slow, or the
   * connection dropped. Never true for "nothing is running" or an unknown
   * cause. */
  transient: boolean;
}

function anyOf(text: string, ...needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/** Classifies a failed generation from its own diagnostic text (the
 * engine's wire message, never a person's words) and, for a Stack 503, the
 * refusal Home remembered from that body's offline_reason. */
export function classifyGenerationFailure(message: string | undefined): ClassifiedFailure {
  const text = (message ?? "").toLowerCase();
  if (anyOf(text, "deadline exceeded", "stalled")) return { kind: "slow", transient: true };
  if (anyOf(text, "could not reach", "connection refused", "econnrefused", "foreignportholder", "not running", "unreachable")) return { kind: "unreachable", transient: false };
  // A Stack 503 reaches here as the companion line (stackEngine.ts); its
  // stated reason was remembered when it arrived.
  const refusal = text.startsWith(OFFLINE_COMPANION_LINE.toLowerCase()) ? stackRefusal("chat") : null;
  // CHAT-CALM-ERRORS-01b: the kind the Stack's own state decided; a
  // stopped engine does not come back on a quiet retry.
  if (refusal) return { kind: refusal.kind, transient: refusal.kind !== "stopped" };
  // THIN-GROUND-01: the engine's 400 when the prompt does not fit its context
  // (llama.cpp: "exceeds the available context size", exceed_context_size_error).
  // Not transient: the same prompt would be refused again; model.ts retries
  // once itself with the evidence cut.
  if (anyOf(text, "exceed_context_size", "exceeds the available context", "exceeds the context")) return { kind: "context_too_large", transient: false };
  if (anyOf(text, "timed out", "timeout")) return { kind: "slow", transient: true };
  if (anyOf(text, "connection reset", "econnreset", "socket hang up", "closed unexpectedly")) return { kind: "unreachable", transient: true };
  if (anyOf(text, "loading", "queue", "memory")) return { kind: text.includes("memory") ? "memory" : "busy", transient: true };
  return { kind: "other", transient: false };
}

/** The retry plan (THIN-DL-02): an adult's written turn retries a
 * transient failure up to two more times, a child's, a teen's or a spoken
 * turn once, each after a short pause. */
export const RETRY_BACKOFF_MS: { adult: readonly number[]; minor: readonly number[] } = {
  adult: [500, 1500],
  minor: [500],
};

