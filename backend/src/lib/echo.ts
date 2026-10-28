// NAT-05 (docs/design/natural-speech-register-2026-10-27.md, section 3.6): the same question twice.
//
// The hub keeps, per conversation and subject, the last answer's subject id, an evidence fingerprint and the time.
// When the same subject is asked again inside ECHO_WINDOW_MS the evidence carries a typed `repeat` note: the result
// is unchanged ("Still X." or a shorter paraphrase is fine) or changed (name what changed). The model decides from
// the conversation whether the person did not hear it; shortening is allowed, never required.
//
// The ReplyPlan spec forbids a ninth move, so this is evidence beside the fact, like the NAT-03 band, not a plan move.
// Learned-components reading: the subject is the package id plus its bound call arguments and the fingerprint is a hash
// of the typed result data; nothing here reads the person's words or the model's reply (chat rules 1 to 3), and the
// record holds ids, hashes and a time, never reply text (rule 6a). In memory only: a restart forgets it, which is
// harmless inside a five-minute window.
//
// Surface scope (rule 5): the shortening note applies on spoken turns and on child or teen chat. On adult written chat
// the note only requires naming a change; nothing shortens the answer. A flagged safety turn gets no note at all.

import { createHash } from "node:crypto";
import { evictStaleIfFull } from "@maipai/core/src/boundedMap";
import type { ToolExecutionOutcome } from "@/lib/turnContext";

export const ECHO_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECORDS = 500;

export interface RepeatNote {
  /** Whole seconds since the same subject was last answered. */
  since_seconds: number;
  evidence: "unchanged" | "changed";
  /** One instruction for the model, built from the typed state only. */
  note: string;
}

export interface EchoContext {
  conversationId: string;
  turnId: string;
  /** The turn's prompt surface class and age band decide whether shortening may be suggested. */
  surfaceClass: "spoken" | "written";
  ageBand: "child" | "teen" | "adult";
  safetyFlagged: boolean;
  nowMs: number;
}

interface Record_ {
  turnId: string;
  fingerprint: string;
  at: number;
  note: RepeatNote | null;
}

const records = new Map<string, Record_>();

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The subject id of one succeeded outcome: its package and the exact arguments the call was bound to. */
export function subjectOf(outcome: ToolExecutionOutcome): string | null {
  if (outcome.status !== "succeeded" || !outcome.result) return null;
  return `${outcome.packageId}:${hash(stable(outcome.args ?? {}))}`;
}

/** A hash of what the outcome said, from its typed data (or its reply when it has no data). */
export function fingerprintOf(outcome: ToolExecutionOutcome): string {
  const result = outcome.result;
  return hash(stable(result?.data !== undefined ? result.data : result?.reply ?? null));
}

function noteFor(unchanged: boolean, sinceSeconds: number, shorten: boolean): RepeatNote {
  const ago = sinceSeconds < 90 ? "a moment ago" : `${Math.round(sinceSeconds / 60)} minutes ago`;
  if (!unchanged) {
    return { since_seconds: sinceSeconds, evidence: "changed", note: `The person asked this same thing ${ago} and the result is different now: say what changed ("seven minutes now, was ten").` };
  }
  return {
    since_seconds: sinceSeconds,
    evidence: "unchanged",
    note: shorten
      ? `The person asked this same thing ${ago} and nothing changed. If it sounds like they did not catch it, a short "still ..." or a shorter way of saying it is enough; otherwise answer as usual.`
      : `The person asked this same thing ${ago} and nothing changed. You may say so; answer as completely as you normally would.`,
  };
}

/**
 * Compare this turn's succeeded outcomes with the last answers in the conversation, record them, and return a note per
 * call id for those that repeat a subject inside the window. Idempotent within one turn: a later model round of the
 * same turn gets the same notes and does not count its own record as an earlier answer.
 */
export function repeatNotes(outcomes: readonly ToolExecutionOutcome[], ctx: EchoContext): Map<string, RepeatNote> {
  const notes = new Map<string, RepeatNote>();
  if (ctx.safetyFlagged) return notes;
  const shorten = ctx.surfaceClass === "spoken" || ctx.ageBand !== "adult";
  evictStaleIfFull(records, MAX_RECORDS, (r) => ctx.nowMs - r.at > ECHO_WINDOW_MS);
  for (const outcome of outcomes) {
    const subject = subjectOf(outcome);
    if (!subject) continue;
    const key = `${ctx.conversationId}|${subject}`;
    const previous = records.get(key);
    const fingerprint = fingerprintOf(outcome);
    if (previous && previous.turnId === ctx.turnId) {
      if (previous.note) notes.set(outcome.callId, previous.note);
      continue;
    }
    const age = previous ? ctx.nowMs - previous.at : Infinity;
    const note = previous && age >= 0 && age <= ECHO_WINDOW_MS ? noteFor(previous.fingerprint === fingerprint, Math.round(age / 1000), shorten) : null;
    records.set(key, { turnId: ctx.turnId, fingerprint, at: ctx.nowMs, note });
    if (note) notes.set(outcome.callId, note);
  }
  return notes;
}

/** Tests only. */
export function resetEchoRecords(): void {
  records.clear();
}
