// FACE-01: enrollment is always hub-owned (CLAUDE.md-level product
// decision, 2026-09-28, confirmed explicitly with Jesse) - a capture
// surface (a bot, a browser) sends the embedding here, it never creates
// its own print. One row per accepted sample (an iOS-Face-ID-style
// coverage-grid enrollment makes several: frontal/left/right/up/down),
// never one row per person holding an array inside it, so a single bad
// sample can be revoked alone without touching the rest.
//
// The embedding never leaves this module in the clear: encrypted at
// rest (lib/secrets.ts, the reversible module - matching needs the
// plaintext vector back) and never included in any API response, the
// same treatment a credential hash gets. Only a matcher running
// server-side ever calls decryptSecret() on it.
//
// Consent: a child never consents for themself (the design's own
// invariant). Self-enrollment is open to anyone else on the ladder;
// enrolling someone ELSE - including a child - needs the same
// owner/admin authority personLifecycle.ts's MANAGEABLE_BY already uses
// for editing or deleting that person, so this reuses that table rather
// than inventing a second ladder.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { biometricPrints, people } from "@/db/schema";
import { newBiometricPrintId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { canManage } from "@/lib/personLifecycle";
import type { PersonRow } from "@/types";
import { validateBiometricPrint } from "@maipai/spec/records/ts/validate.js";
import { BiometricPrint } from "@maipai/spec/gen/ts/biometric-print.js";
import type { BiometricPrint as BiometricPrintT } from "@maipai/spec/gen/ts/biometric-print.js";

export type OpResult<T> = { ok: true; status: 200 | 201; value: T } | { ok: false; status: 400 | 403 | 404; error: string };

type PrintRow = typeof biometricPrints.$inferSelect;

/** Never includes the embedding - see this file's own header. */
export type BiometricPrintSummary = Omit<BiometricPrintT, "embedding">;

// The only model/hash pairs a print may claim, so a write can't silently
// point at a model nobody actually verified provenance for (this
// repo's own "download, don't vendor" discipline, applied to what a
// caller is allowed to assert about a model it doesn't ship). Voice
// (CAM++, hub-side per the design record) has no verified pin yet -
// added here the day that lands, never assumed.
const KNOWN_MODELS: Record<string, { modality: "face" | "voice"; sha256: string; dim: number }> = {
  "sface-2021dec": { modality: "face", sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79", dim: 128 },
};

function toSummary(row: PrintRow): BiometricPrintSummary {
  return {
    id: row.id,
    person_id: row.personId,
    modality: row.modality as "face" | "voice",
    model_id: row.modelId,
    model_sha256: row.modelSha256,
    dim: row.dim,
    captured_by: row.capturedBy,
    consent_at: row.consentAt,
    consented_by_person_id: row.consentedByPersonId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
    hlc: row.hlc,
  };
}

// Reuses personLifecycle.ts's own canManage() (self-or-MANAGEABLE_BY)
// rather than re-deriving that rule a second time - a code review
// (2026-09-28) found it hand-reimplemented here and in
// deleteBiometricPrint(), which would silently drift if canManage() ever
// grows its own carve-outs (its own comment notes birthdate/localOnly
// already needed one).
function canConsentFor(actor: PersonRow, target: { id: string; role: string }): boolean {
  // The one absolute in the design on top of canManage()'s ordinary
  // self-case: a child never consents for themself, full stop.
  if (target.role === "child" && actor.id === target.id) return false;
  return canManage(actor, target);
}

export interface BiometricPrintCreate {
  person_id: string;
  model_id: string;
  embedding: number[];
  captured_by?: string | null;
}

export function createBiometricPrint(actor: PersonRow, input: BiometricPrintCreate): OpResult<BiometricPrintSummary> {
  const target = db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.id, input.person_id), isNull(people.deletedAt))).get() as
    | { id: string; role: string }
    | undefined;
  if (!target) return { ok: false, status: 400, error: "person_id does not name an existing person" };

  const known = KNOWN_MODELS[input.model_id];
  if (!known) return { ok: false, status: 400, error: `Unknown biometric model "${input.model_id}"` };
  if (input.embedding.length !== known.dim) return { ok: false, status: 400, error: `${input.model_id} embeddings must have ${known.dim} dimensions` };

  if (!canConsentFor(actor, target)) {
    return {
      ok: false,
      status: 403,
      error: target.role === "child" ? "Only an owner or admin can consent to enroll a child's biometric print" : "Not allowed to enroll a biometric print for this person",
    };
  }

  const now = new Date().toISOString();
  const candidate: BiometricPrintT = {
    id: newBiometricPrintId(),
    person_id: input.person_id,
    modality: known.modality,
    model_id: input.model_id,
    model_sha256: known.sha256,
    dim: known.dim,
    embedding: input.embedding,
    captured_by: input.captured_by ?? null,
    consent_at: now,
    consented_by_person_id: actor.id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: nextHlc(),
  };
  const parsed = BiometricPrint.safeParse(candidate);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.message };
  const problems = validateBiometricPrint(parsed.data);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join("; ") };

  db.insert(biometricPrints)
    .values({
      id: parsed.data.id,
      personId: parsed.data.person_id,
      modality: parsed.data.modality,
      modelId: parsed.data.model_id,
      modelSha256: parsed.data.model_sha256,
      dim: parsed.data.dim,
      embeddingEncrypted: encryptSecret(JSON.stringify(parsed.data.embedding)),
      capturedBy: parsed.data.captured_by,
      consentAt: parsed.data.consent_at,
      consentedByPersonId: parsed.data.consented_by_person_id,
      createdAt: parsed.data.created_at,
      updatedAt: parsed.data.updated_at,
      deletedAt: null,
      hlc: parsed.data.hlc,
    })
    .run();

  const { embedding: _embedding, ...summary } = parsed.data;
  return { ok: true, status: 201, value: summary };
}

/** Metadata only - see this file's own header on why the embedding never
 * comes back out through here. Gated the same way create is (self, or
 * MANAGEABLE_BY authority over the target's role): a code review
 * (2026-09-28) found this list ungated entirely, letting any signed-in
 * household member - a guest, a teen, anyone - read who was
 * biometrically enrolled, by whom and when, for every other person in
 * the household. No child carve-out here (unlike consent): reading
 * one's OWN enrollment metadata is always allowed regardless of role. */
export function listBiometricPrints(actor: PersonRow, personId: string): OpResult<BiometricPrintSummary[]> {
  const target = db.select({ id: people.id, role: people.role }).from(people).where(and(eq(people.id, personId), isNull(people.deletedAt))).get() as
    | { id: string; role: string }
    | undefined;
  if (!target) return { ok: false, status: 400, error: "personId does not name an existing person" };
  if (!canManage(actor, target)) return { ok: false, status: 403, error: "Not allowed to see this person's biometric prints" };

  const rows = db
    .select()
    .from(biometricPrints)
    .where(and(eq(biometricPrints.personId, personId), isNull(biometricPrints.deletedAt)))
    .all() as PrintRow[];
  return { ok: true, status: 200, value: rows.map(toSummary) };
}

/** The plaintext embedding, for a matcher only - never routed to an API
 * response. Returns null for a tombstoned print (embedding scrubbed) or
 * one that doesn't exist. */
export function decryptBiometricPrintEmbedding(printId: string): number[] | null {
  const row = db.select().from(biometricPrints).where(eq(biometricPrints.id, printId)).get() as PrintRow | undefined;
  if (!row || !row.embeddingEncrypted) return null;
  return JSON.parse(decryptSecret(row.embeddingEncrypted)) as number[];
}

/** Revoking one's OWN print is always allowed regardless of role
 * (including a child, who could not have consented to it themself in
 * the first place) - withdrawal is safety-positive, not a new
 * capability being granted, so it isn't gated the same way creation is.
 * Revoking someone ELSE's needs the same MANAGEABLE_BY authority as
 * creation. */
export function deleteBiometricPrint(actor: PersonRow, printId: string): OpResult<{ success: true }> {
  const row = db.select().from(biometricPrints).where(and(eq(biometricPrints.id, printId), isNull(biometricPrints.deletedAt))).get() as PrintRow | undefined;
  if (!row) return { ok: false, status: 404, error: "No such biometric print" };

  if (actor.id !== row.personId) {
    const target = db.select({ id: people.id, role: people.role }).from(people).where(eq(people.id, row.personId)).get() as { id: string; role: string } | undefined;
    if (!target || !canManage(actor, target)) return { ok: false, status: 403, error: "Not allowed to revoke this biometric print" };
  }

  const now = new Date().toISOString();
  db.update(biometricPrints).set({ embeddingEncrypted: null, deletedAt: now, updatedAt: now, hlc: nextHlc() }).where(eq(biometricPrints.id, printId)).run();
  return { ok: true, status: 200, value: { success: true } };
}
