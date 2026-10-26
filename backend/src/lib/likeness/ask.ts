// PERUSE-2026-10-25 (docs/design/per-use-consent-2026-10-25.md): the per-use consent ask. The one place that touches
// `likeness_asks`. A household adult asks for adult content that looks like another household adult; Home holds the job and
// shows the pictured adult the exact prompt with Consent and Decline. One ask covers one generation.
//
// The signed proof the Stack needs is minted here, only after the ask is `approved` (releaseAsk), so no caller can skip the ask.
// Logs: nothing here logs an ask id, a person id, a hash or the prompt (rule 6a). The prompt text lives on the row only while the
// ask is `waiting` or `approved` and is cleared at every final state; `prompt_sha256` is the audit record.
//
// This file imports no media code: jobs register a listener (onAskChange) to react to a decision.
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { likenessAsks, people } from "@/db/schema";
import { newLikenessAskId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { trigger } from "@/lib/notifications";
import { householdLikenessOn, perUseOn, subjectName } from "./decide";
import { subjectEligibility } from "./resolve";
import { ensureStackTrust, mintProof } from "./proof";
import type { PersonRow } from "@/types";

export type AskState = "waiting" | "approved" | "declined" | "expired" | "consumed" | "cancelled";
export type AskMedium = "picture" | "video";
export type AskReason = "decline" | "timeout" | "requester" | "changed" | "unavailable" | "mismatch";

/** How long a waiting ask lasts, how long an approved one may wait for the Stack, the decline cool-down, and the hourly ask cap. */
export const ASK_WAIT_MS = 10 * 60_000;
export const ASK_APPROVED_MS = 4 * 60 * 60_000;
export const ASK_COOLDOWN_MS = 60 * 60_000;
export const ASK_HOURLY_CAP = 3;

export const ASK_TEMPORARY_LINE = "Adult content of another person can't be made in a temporary chat, because nothing is kept there. Use a normal chat.";

type Row = typeof likenessAsks.$inferSelect;
const FINAL: readonly AskState[] = ["declined", "expired", "consumed", "cancelled"];
const isFinal = (state: string): boolean => (FINAL as readonly string[]).includes(state);

/** The line the requester reads when an ask ends without a picture. Every line says what happened and what to do. */
export function askOutcomeLine(reason: AskReason, subject: string): string {
  switch (reason) {
    case "decline": return `${subject} said no. Nothing was made.`;
    case "timeout": return `${subject} did not answer in 10 minutes. Nothing was made. Ask again when they are with you.`;
    case "requester": return "You cancelled the request. Nothing was made.";
    case "mismatch": return "The request changed after it was approved. Nothing was made. Ask again.";
    case "unavailable": return `${subject} can no longer be asked. Nothing was made.`;
    case "changed": return "Pictures and videos of people in this household were switched off, so this was not made.";
  }
}

export const ASK_WAITING_LINE = (subject: string): string => `${subject} needs to say yes first. Show them this screen.`;

export function promptHash(prompt: string): string { return createHash("sha256").update(prompt, "utf8").digest("hex"); }

export interface AskEvent { id: string; state: AskState; reason: AskReason | null; subjectId: string; requesterId: string; subjectName: string }
const listeners = new Set<(event: AskEvent) => void>();
/** Jobs register here to fail a held job when its ask ends, or to start it when the ask is approved. Returns the remover. */
export function onAskChange(listener: (event: AskEvent) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

function nameOf(personId: string): string {
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  return person ? subjectName(person as PersonRow) : "That person";
}

function emit(row: Row, state: AskState, reason: AskReason | null): void {
  const event: AskEvent = { id: row.id, state, reason, subjectId: row.subjectPersonId, requesterId: row.requesterPersonId, subjectName: nameOf(row.subjectPersonId) };
  for (const listener of listeners) { try { listener(event); } catch { /* one listener never blocks another */ } }
}

function load(id: string): Row | undefined { return db.select().from(likenessAsks).where(eq(likenessAsks.id, id)).get(); }

/** Moves a non-final ask to a final state: clears the prompt text, stamps it, tells the listeners. False when it was already final. */
function finish(row: Row, state: Extract<AskState, "declined" | "expired" | "cancelled">, reason: AskReason, decidedBy?: "subject" | "requester"): boolean {
  const now = new Date().toISOString();
  const result = db.update(likenessAsks).set({ state, prompt: null, updatedAt: now, hlc: nextHlc(), ...(decidedBy ? { decidedAt: now, decidedBy } : {}) })
    .where(and(eq(likenessAsks.id, row.id), inArray(likenessAsks.state, ["waiting", "approved"]))).returning({ id: likenessAsks.id }).all();
  if (result.length !== 1) return false;
  emit(row, state, reason);
  return true;
}

/** Why an open ask can no longer proceed, or null: the option is off, the household option is off, or someone is gone. */
function stillAskable(row: Row): AskReason | null {
  if (!perUseOn() || !householdLikenessOn()) return "changed";
  if (!subjectEligibility(row.subjectPersonId).ok) return "unavailable";
  if (!db.select().from(people).where(eq(people.id, row.requesterPersonId)).get()) return "unavailable";
  return null;
}

/** Ends every ask that ran out of time or can no longer proceed. Runs on read, at boot and on a five minute pass. Returns how many ended. */
export function expireAsks(now: number = Date.now()): number {
  let count = 0;
  for (const row of db.select().from(likenessAsks).where(inArray(likenessAsks.state, ["waiting", "approved"])).all()) {
    const late = row.expiresAt !== null && Date.parse(row.expiresAt) <= now;
    if (late && finish(row, "expired", "timeout")) { count += 1; continue; }
    const why = stillAskable(row);
    if (why && finish(row, "cancelled", why)) count += 1;
  }
  return count;
}

/** Ends the open asks that involve a person who left the household. */
export function cancelAsksInvolving(personId: string): number {
  let count = 0;
  for (const row of db.select().from(likenessAsks).where(inArray(likenessAsks.state, ["waiting", "approved"])).all()) {
    if ((row.subjectPersonId === personId || row.requesterPersonId === personId) && finish(row, "cancelled", "unavailable")) count += 1;
  }
  return count;
}

export interface OpenAskInput {
  subjectId: string;
  requesterId: string;
  medium: AskMedium;
  /** The exact prompt Home will send. */
  prompt: string;
  count: number;
  styleName: string | null;
  /** The saved styles of the subject the job will apply; each gets its own proof on release. */
  styleIds: readonly string[];
  source: "chat" | "editor";
}
export type OpenAskResult = { ok: true; id: string; subjectName: string } | { ok: false; line: string };

/** Opens an ask and tells the pictured adult. Refuses (with a plain line) when the option is off, the subject is not an eligible adult, the same prompt was just declined, or too many asks went out this hour. */
export function openAsk(input: OpenAskInput): OpenAskResult {
  const subject = subjectEligibility(input.subjectId);
  if (!perUseOn() || !householdLikenessOn() || !subject.ok || input.subjectId === input.requesterId || input.styleIds.length === 0) {
    return { ok: false, line: !subject.ok ? askOutcomeLine("unavailable", nameOf(input.subjectId)) : askOutcomeLine("changed", "") };
  }
  const name = subjectName(subject.person);
  expireAsks();
  const hash = promptHash(input.prompt);
  const since = new Date(Date.now() - ASK_COOLDOWN_MS).toISOString();
  const recent = db.select().from(likenessAsks).where(and(eq(likenessAsks.requesterPersonId, input.requesterId), eq(likenessAsks.subjectPersonId, input.subjectId), gt(likenessAsks.createdAt, since))).orderBy(desc(likenessAsks.createdAt)).all();
  if (recent.some((row) => row.state === "declined" && row.promptSha256 === hash)) return { ok: false, line: `${name} said no to this a little while ago. Ask for something different, or try again in an hour.` };
  if (recent.length >= ASK_HOURLY_CAP) return { ok: false, line: `You have asked ${name} ${ASK_HOURLY_CAP} times in the last hour. Wait a while before asking again.` };
  const id = newLikenessAskId();
  const now = new Date().toISOString();
  db.insert(likenessAsks).values({
    id, subjectPersonId: input.subjectId, requesterPersonId: input.requesterId, medium: input.medium, way: "style", state: "waiting", promptSha256: hash, prompt: input.prompt,
    count: Math.max(1, Math.round(input.count)), styleName: input.styleName, styleIds: JSON.stringify([...input.styleIds]), source: input.source,
    expiresAt: new Date(Date.now() + ASK_WAIT_MS).toISOString(), createdAt: now, updatedAt: now, hlc: nextHlc(),
  }).run();
  void trigger("likeness.ask", { requester: nameOf(input.requesterId) }, { personId: input.subjectId, subjectPersonId: input.requesterId }).catch(() => {});
  return { ok: true, id, subjectName: name };
}

/** Records which job an ask holds. */
export function attachJob(id: string, jobId: string): void {
  db.update(likenessAsks).set({ jobId, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(and(eq(likenessAsks.id, id), inArray(likenessAsks.state, ["waiting", "approved"]))).run();
}

export type DecideResult = { ok: true; state: AskState } | { ok: false; code: "not_found" | "closed"; line: string };

/**
 * The pictured adult's click (or, on the same screen, anyone signed in as the requester or the pictured adult). Presence
 * confirmation, not authentication (design section 8): the click is recorded with which of the two accounts made it.
 * No session is issued and no secret is checked.
 */
export function decideAsk(id: string, caller: PersonRow, decision: "consent" | "decline"): DecideResult {
  expireAsks();
  const row = load(id);
  if (!row || (row.subjectPersonId !== caller.id && row.requesterPersonId !== caller.id)) return { ok: false, code: "not_found", line: "That request isn't here any more." };
  if (row.state !== "waiting") return { ok: false, code: "closed", line: row.state === "approved" ? "This was already approved." : "This request has ended. Nothing more to do." };
  const by = caller.id === row.subjectPersonId ? "subject" : "requester";
  if (decision === "decline") { finish(row, "declined", "decline", by); return { ok: true, state: "declined" }; }
  const why = stillAskable(row);
  if (why) { finish(row, "cancelled", why); return { ok: false, code: "closed", line: askOutcomeLine(why, nameOf(row.subjectPersonId)) }; }
  const now = new Date().toISOString();
  const result = db.update(likenessAsks).set({ state: "approved", decidedAt: now, decidedBy: by, expiresAt: new Date(Date.now() + ASK_APPROVED_MS).toISOString(), updatedAt: now, hlc: nextHlc() })
    .where(and(eq(likenessAsks.id, id), eq(likenessAsks.state, "waiting"))).returning({ id: likenessAsks.id }).all();
  if (result.length !== 1) return { ok: false, code: "closed", line: "This request has ended. Nothing more to do." };
  emit(row, "approved", null);
  return { ok: true, state: "approved" };
}

/** The requester stops their own waiting ask. */
export function cancelAsk(id: string, caller: PersonRow): DecideResult {
  const row = load(id);
  if (!row || row.requesterPersonId !== caller.id) return { ok: false, code: "not_found", line: "That request isn't here any more." };
  return finish(row, "cancelled", "requester") ? { ok: true, state: "cancelled" } : { ok: false, code: "closed", line: "This request has ended. Nothing more to do." };
}

/** Cancels a still-open ask because the job it was opened for never started (the tool failed after opening it). */
export function dropAsk(id: string): void {
  const row = load(id);
  if (row) finish(row, "cancelled", "requester");
}

export interface AskStatus { state: AskState; subjectId: string; requesterId: string; jobId: string | null; reason?: AskReason }
/** What a job guard needs to know: the state and who the ask was between. Null when there is no such ask. */
export function askStatus(id: string): AskStatus | null {
  const row = load(id);
  return row ? { state: row.state as AskState, subjectId: row.subjectPersonId, requesterId: row.requesterPersonId, jobId: row.jobId } : null;
}
/** True while the pictured adult has not answered yet: the held job stays out of the household queue. */
export function askWaiting(id: string): boolean { return load(id)?.state === "waiting"; }
/** True only while the ask is approved and not yet used: the held job may be released. */
export function askApproved(id: string): boolean { return load(id)?.state === "approved"; }

export interface AskView {
  id: string;
  state: AskState;
  medium: AskMedium;
  count: number;
  style_name: string | null;
  requester_name: string;
  subject_name: string;
  /** The exact prompt, only while the ask is open; null once it has ended. */
  prompt: string | null;
  expires_at: string | null;
  created_at: string;
  decided_at: string | null;
  /** Which side the reader is on. */
  as: "subject" | "requester";
}

function view(row: Row, caller: PersonRow): AskView {
  return {
    id: row.id, state: row.state as AskState, medium: row.medium as AskMedium, count: row.count, style_name: row.styleName,
    requester_name: nameOf(row.requesterPersonId), subject_name: nameOf(row.subjectPersonId),
    prompt: row.state === "waiting" || row.state === "approved" ? row.prompt : null,
    expires_at: row.state === "waiting" || row.state === "approved" ? row.expiresAt : null,
    created_at: row.createdAt, decided_at: row.decidedAt, as: row.subjectPersonId === caller.id ? "subject" : "requester",
  };
}

/** One ask for the card, only to the requester or the pictured adult. */
export function askFor(id: string, caller: PersonRow): AskView | null {
  expireAsks();
  const row = load(id);
  return row && (row.subjectPersonId === caller.id || row.requesterPersonId === caller.id) ? view(row, caller) : null;
}

/** The asks a person is part of, newest first: as the pictured adult every ask about them, as the requester only their own. */
export function asksFor(caller: PersonRow, limit = 50): AskView[] {
  expireAsks();
  return db.select().from(likenessAsks).orderBy(desc(likenessAsks.createdAt)).all()
    .filter((row) => row.subjectPersonId === caller.id || row.requesterPersonId === caller.id).slice(0, limit).map((row) => view(row, caller));
}

export type ReleaseResult = { ok: true; proofs: Map<string, string> } | { ok: false; line: string };

export interface ReleaseInput {
  askId: string;
  jobId: string;
  subjectId: string;
  requesterId: string;
  medium: AskMedium;
  /** The prompt exactly as it is about to be sent. */
  prompt: string;
  /** Every style the job is about to send. */
  styleIds: readonly string[];
}

/**
 * The only way to a proof for adult content of another person. Succeeds once per ask: the ask must be `approved` (a repeat for
 * the SAME job after it started, as a memory requeue does, is allowed while the approval is still fresh), the prompt and people
 * must be exactly what was shown, every style that was shown must still be in the job, and the Stack must trust Home's key.
 * A mismatch cancels the ask.
 */
export async function releaseAsk(input: ReleaseInput): Promise<ReleaseResult> {
  const first = load(input.askId);
  if (!first) return { ok: false, line: askOutcomeLine("mismatch", "") };
  const subjectLabel = nameOf(first.subjectPersonId);
  const retry = first.state === "consumed" && first.jobId === input.jobId && first.consumedAt !== null && Date.now() - Date.parse(first.consumedAt) < ASK_APPROVED_MS;
  if (first.state !== "approved" && !retry) return { ok: false, line: isFinal(first.state) ? askOutcomeLine(first.state === "declined" ? "decline" : first.state === "expired" ? "timeout" : "unavailable", subjectLabel) : ASK_WAITING_LINE(subjectLabel) };
  const why = stillAskable(first);
  if (why) { finish(first, "cancelled", why); return { ok: false, line: askOutcomeLine(why, subjectLabel) }; }
  const shown = new Set<string>(JSON.parse(first.styleIds) as string[]);
  const same = first.subjectPersonId === input.subjectId && first.requesterPersonId === input.requesterId && first.medium === input.medium && first.promptSha256 === promptHash(input.prompt)
    && [...shown].every((s) => input.styleIds.includes(s)) && (first.jobId === null || first.jobId === input.jobId);
  if (!same) { if (first.state === "approved") finish(first, "cancelled", "mismatch"); return { ok: false, line: askOutcomeLine("mismatch", subjectLabel) }; }
  const trust = await ensureStackTrust();
  if (!trust.ok) return { ok: false, line: trust.line };
  if (!retry) {
    const now = new Date().toISOString();
    const result = db.update(likenessAsks).set({ state: "consumed", consumedAt: now, jobId: input.jobId, prompt: null, updatedAt: now, hlc: nextHlc() })
      .where(and(eq(likenessAsks.id, input.askId), eq(likenessAsks.state, "approved"))).returning({ id: likenessAsks.id }).all();
    if (result.length !== 1) return { ok: false, line: askOutcomeLine("mismatch", subjectLabel) };
  }
  // Proofs go only to the styles the pictured adult was shown; any other style in the body carries none and the Stack refuses it.
  return { ok: true, proofs: new Map([...shown].map((styleId) => [styleId, mintProof({ purpose: "style_use", subject: input.subjectId, requester: input.requesterId, bind: styleId })] as const)) };
}
