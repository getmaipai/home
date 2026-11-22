// CODE-AGENT-01: a Code session's transcript, stored like a conversation's message list in part form. Every part is credential-redacted on the way in
// (lib/codingRedact.ts); what is stored is what the page shows, so a leaked token is never recoverable from disk.
import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { codingMessages } from "@/db/schema";
import { newCodingMessageId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { redactDeep } from "@/lib/codingRedact";

/** The part shapes the agent bridge writes. `tool` covers a command or a file change; `approval` is a held host request; `stopped` is the stopped-run card. */
export type CodingPart =
  | { type: "text"; text: string }
  | { type: "plan"; items: { text: string; done: boolean }[] }
  | { type: "tool"; tool: "command" | "file_write" | "read" | "fetch"; status: "running" | "done" | "failed"; summary: string; exit_code?: number; output?: string }
  | { type: "approval"; request_id: string; effect: string; status: "pending" | "allowed" | "denied" }
  | { type: "stopped"; reason: "user" | "wall_clock" | "error" | "denied" }
  | { type: "notice"; text: string };
export interface CodingMessageWire { id: string; session_id: string; seq: number; role: "user" | "agent" | "system"; parts: CodingPart[]; created_at: string }

const MAX_PARTS_TEXT = 200_000;

export function appendCodingMessage(input: { sessionId: string; personId: string; role: CodingMessageWire["role"]; parts: CodingPart[] }): { id: string; seq: number; redacted: number } {
  const clean = redactDeep(input.parts.map((p) => (p.type === "text" && p.text.length > MAX_PARTS_TEXT ? { ...p, text: p.text.slice(0, MAX_PARTS_TEXT) } : p)));
  const seq = (db.select({ top: max(codingMessages.seq) }).from(codingMessages).where(eq(codingMessages.sessionId, input.sessionId)).get()?.top ?? 0) + 1;
  const id = newCodingMessageId();
  db.insert(codingMessages).values({ id, sessionId: input.sessionId, personId: input.personId, seq, role: input.role, parts: clean.value as unknown as Record<string, unknown>[], createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  return { id, seq, redacted: clean.found };
}

/** Replaces one message's parts (a streaming reply grows, a pending approval resolves). Redacted again. */
export function replaceCodingMessageParts(personId: string, messageId: string, parts: CodingPart[]): void {
  const clean = redactDeep(parts);
  db.update(codingMessages).set({ parts: clean.value as unknown as Record<string, unknown>[], hlc: nextHlc() }).where(and(eq(codingMessages.id, messageId), eq(codingMessages.personId, personId))).run();
}

export function listCodingMessages(personId: string, sessionId: string): CodingMessageWire[] {
  return db.select().from(codingMessages).where(and(eq(codingMessages.sessionId, sessionId), eq(codingMessages.personId, personId))).orderBy(asc(codingMessages.seq)).all()
    .map((r) => ({ id: r.id, session_id: r.sessionId, seq: r.seq, role: r.role, parts: r.parts as unknown as CodingPart[], created_at: r.createdAt }));
}
