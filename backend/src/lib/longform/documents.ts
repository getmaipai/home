// LONGFORM-01: the documents of a long-form production (treatment, bible, outline, scripts, shot lists): one versioned row per kind and key,
// owned by the production's owner. A change bumps the version and clears the approval; approval is a separate act by the person.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionDocuments } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";
import { getMediaProduction } from "@/lib/mediaProductions";
import type { PersonRow } from "@/types";

export const DOCUMENT_KINDS = ["treatment", "bible", "outline", "script", "shotlist"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const MAX_DOCUMENT_CHARS = 200_000;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export type DocumentSource = "model" | "person" | "rewrite";
export interface ProductionDocument { id: string; production_id: string; kind: DocumentKind; key: string; json: unknown; version: number; approved: boolean; provenance: string; created_at: string; updated_at: string }

function decode(row: typeof productionDocuments.$inferSelect): ProductionDocument {
  let json: unknown = null; try { json = JSON.parse(row.json); } catch { /* an unreadable row reads as empty and is replaced by the next save */ }
  return { id: row.id, production_id: row.productionId, kind: row.kind as DocumentKind, key: row.key, json, version: row.version, approved: row.approved, provenance: row.provenance, created_at: row.createdAt, updated_at: row.updatedAt };
}
const owns = (actor: PersonRow, productionId: string) => { const p = getMediaProduction(actor, productionId); return !!p && p.owner_person_id === actor.id; };

export type SaveResult = { ok: true; document: ProductionDocument } | { ok: false; line: string };

export function saveDocument(actor: PersonRow, input: { productionId: string; kind: DocumentKind; key?: string; json: unknown; source: DocumentSource }): SaveResult {
  if (!(DOCUMENT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, line: "That kind of document is not part of a production." };
  if (!owns(actor, input.productionId)) return { ok: false, line: "That production is not available to you." };
  const text = JSON.stringify(input.json);
  if (text === undefined || text.length > MAX_DOCUMENT_CHARS) return { ok: false, line: "That document is too large to keep. Make it shorter." };
  const key = input.key ?? "main", now = new Date().toISOString();
  if (!KEY_PATTERN.test(key)) return { ok: false, line: "That document name is not valid. Use letters, numbers and dashes." };
  const provenance = `longform-document:${JSON.stringify({ v: 1, source: input.source })}`;
  return db.transaction((): SaveResult => {
  const current = db.select().from(productionDocuments).where(and(eq(productionDocuments.productionId, input.productionId), eq(productionDocuments.kind, input.kind), eq(productionDocuments.key, key))).get();
  if (current) {
    db.update(productionDocuments).set({ json: text, version: current.version + 1, approved: false, provenance, updatedAt: now, hlc: nextHlc() }).where(eq(productionDocuments.id, current.id)).run();
    return { ok: true, document: decode(db.select().from(productionDocuments).where(eq(productionDocuments.id, current.id)).get()!) };
  }
  const id = `pdoc-${randomSuffix(10)}`;
  db.insert(productionDocuments).values({ id, productionId: input.productionId, ownerPersonId: actor.id, kind: input.kind, key, json: text, version: 1, approved: false, provenance, createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
  return { ok: true, document: decode(db.select().from(productionDocuments).where(eq(productionDocuments.id, id)).get()!) };
  });
}

export function getDocument(actor: PersonRow, productionId: string, kind: DocumentKind, key = "main"): ProductionDocument | null {
  if (!owns(actor, productionId)) return null;
  const row = db.select().from(productionDocuments).where(and(eq(productionDocuments.productionId, productionId), eq(productionDocuments.kind, kind), eq(productionDocuments.key, key))).get();
  return row ? decode(row) : null;
}
export function listDocuments(actor: PersonRow, productionId: string): ProductionDocument[] {
  if (!owns(actor, productionId)) return [];
  return db.select().from(productionDocuments).where(eq(productionDocuments.productionId, productionId)).all().map(decode);
}
/** The person approves the current version of a document. Only the owner can; a later save clears it. */
export function approveDocument(actor: PersonRow, productionId: string, kind: DocumentKind, key = "main"): ProductionDocument | null {
  const current = getDocument(actor, productionId, kind, key); if (!current) return null;
  db.update(productionDocuments).set({ approved: true, updatedAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(productionDocuments.id, current.id)).run();
  return getDocument(actor, productionId, kind, key);
}
