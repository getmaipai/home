// CODE-AGENT-01: the person's audit trail for a Code session (spec coding-event). Person scope, owner only, exportable with the session. It holds what the
// spec's `detail` says for each kind, credential-redacted and length-capped; `secret_found` carries a path and a line, never the value. Household logs
// never read this table: they get typed events with ids and counts only (rule 6a), written by the callers through appendLogLine.
import { and, eq, sql } from "drizzle-orm";
import { CodingEvent } from "@maipai/spec/gen/ts/coding-event.js";
import { db } from "@/db";
import { codingEvents } from "@/db/schema";
import { newCodingEventId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { redactDeep } from "@/lib/codingRedact";

export type CodingEventKind = CodingEvent["kind"];
export type CodingEventWire = CodingEvent;
const MAX_TEXT = 500;

const clip = (v: unknown): unknown => (typeof v === "string" && v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}...` : v);

/** Writes one line of the trail. Returns the number of credentials removed from it (a count), so a caller can log that and nothing else. */
export function recordCodingEvent(input: { sessionId: string; personId: string; kind: CodingEventKind; detail: Record<string, unknown> }): { id: string; redacted: number } {
  // Redact first, then clip: a token that straddles the cut would otherwise survive as an undetectable fragment.
  const clean = redactDeep(input.detail);
  clean.value = Object.fromEntries(Object.entries(clean.value).map(([k, v]) => [k, clip(v)]));
  const at = new Date().toISOString();
  const row = { id: newCodingEventId(), sessionId: input.sessionId, personId: input.personId, at, kind: input.kind, detail: clean.value, provenance: "Recorded by the Code agent bridge", hlc: nextHlc() };
  CodingEvent.parse({ id: row.id, session_id: row.sessionId, at, kind: row.kind, detail: row.detail, provenance: row.provenance, hlc: row.hlc });
  db.insert(codingEvents).values(row).run();
  return { id: row.id, redacted: clean.found };
}

/** The owner's own trail, oldest first. */
export function listCodingEvents(personId: string, sessionId: string): CodingEventWire[] {
  return db.select().from(codingEvents).where(and(eq(codingEvents.sessionId, sessionId), eq(codingEvents.personId, personId))).orderBy(sql`rowid`).all()
    .map((r) => CodingEvent.parse({ id: r.id, session_id: r.sessionId, at: r.at, kind: r.kind, detail: r.detail, provenance: r.provenance, hlc: r.hlc }));
}
