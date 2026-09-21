import { db, sqlite } from "@/db";
import {
  memoryEmbeddings,
  memoryRecords,
  pendingMemoryWork,
  people,
} from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { nextHlc } from "@/lib/hlc";
import { newMemoryRecordId } from "@/lib/memoryId";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import { detectCredential, CREDENTIAL_SAFE_MESSAGE } from "@/lib/memoryContentPolicy";
import { isOwnerOrAdmin } from "@/lib/access";
import { getEmbedBackendKind } from "@/lib/embedSupervisor";
import { embed, type EmbedOpResult } from "@/lib/llm";

export type PersonRow = typeof people.$inferSelect;
export type IngestedRecord = typeof memoryRecords.$inferSelect;

/** Canonical display-form key for deduping: NFC, trimmed, whitespace
 * collapsed to single spaces, case-folded. */
export function canonicalKey(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function vectorToBuffer(vector: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function findActiveByKey(
  scope: string,
  person: string | null,
  key: string,
): IngestedRecord | null {
  const rows = db
    .select()
    .from(memoryRecords)
    .where(
      and(
        isNull(memoryRecords.deletedAt),
        eq(memoryRecords.status, "active"),
        eq(memoryRecords.scope, scope),
        person === null
          ? isNull(memoryRecords.person)
          : eq(memoryRecords.person, person),
      ),
    )
    .all();
  return rows.find((r) => canonicalKey(r.text) === key) ?? null;
}

function queuePendingWork(memoryId: string, reason: string): void {
  db.insert(pendingMemoryWork)
    .values({
      memoryId,
      reason,
      queuedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

function clearPendingWork(memoryId: string): void {
  db.delete(pendingMemoryWork)
    .where(eq(pendingMemoryWork.memoryId, memoryId))
    .run();
}

export function storeEmbeddingInTx(
  memoryId: string,
  space: string,
  vector: readonly number[],
  preprocess: string,
): boolean {
  return sqlite.transaction(() => {
    const existing = db
      .select({ id: memoryRecords.id })
      .from(memoryRecords)
      .where(eq(memoryRecords.id, memoryId))
      .get();
    if (!existing) return false;
    const row = {
      memoryId,
      space,
      dims: vector.length,
      vector: vectorToBuffer(vector),
      hlc: nextHlc(),
      preprocess,
    };
    db.insert(memoryEmbeddings)
      .values(row)
      .onConflictDoUpdate({ target: memoryEmbeddings.memoryId, set: row })
      .run();
    db.update(memoryRecords)
      .set({ embeddingSpace: space, hlc: nextHlc() })
      .where(eq(memoryRecords.id, memoryId))
      .run();
    clearPendingWork(memoryId);
    return true;
  })();
}

export type SupersedeInTxResult =
  | { ok: true; record: IngestedRecord }
  | { ok: false; status: number; error: string };

export function supersedeInTx(
  oldRecord: IngestedRecord,
  newCandidate: Omit<IngestedRecord, "id" | "hlc" | "createdAt" | "lastUsedAt" | "uses">,
): SupersedeInTxResult {
  return sqlite.transaction((): SupersedeInTxResult => {
    const newId = newMemoryRecordId(newCandidate.recordKind as "memory" | "entity" | "episode");
    const now = new Date().toISOString();
    const fullCandidate: IngestedRecord = {
      ...newCandidate,
      id: newId,
      hlc: nextHlc(),
      createdAt: now,
      lastUsedAt: now,
      uses: 0,
    };

    db.update(memoryRecords)
      .set({
        status: "superseded",
        supersededBy: newId,
        validTo: newCandidate.validTo ?? oldRecord.validTo,
        expiredAt: now,
        hlc: nextHlc(),
      })
      .where(eq(memoryRecords.id, oldRecord.id))
      .run();

    db.insert(memoryRecords)
      .values({
        id: fullCandidate.id,
        recordKind: fullCandidate.recordKind,
        text: fullCandidate.text,
        category: fullCandidate.category,
        tier: fullCandidate.tier,
        status: fullCandidate.status,
        scope: fullCandidate.scope,
        person: fullCandidate.person,
        subjectId: fullCandidate.subjectId,
        source: fullCandidate.source,
        importance: fullCandidate.importance,
        pinned: fullCandidate.pinned,
        sensitive: fullCandidate.sensitive,
        childDisclosure: fullCandidate.childDisclosure,
        childDisclosureSetBy: fullCandidate.childDisclosureSetBy,
        childDisclosureSetAt: fullCandidate.childDisclosureSetAt,
        uses: fullCandidate.uses,
        createdAt: fullCandidate.createdAt,
        lastUsedAt: fullCandidate.lastUsedAt,
        validFrom: fullCandidate.validFrom,
        validTo: fullCandidate.validTo,
        expiredAt: fullCandidate.expiredAt,
        supersededBy: fullCandidate.supersededBy,
        embeddingSpace: fullCandidate.embeddingSpace,
        hlc: fullCandidate.hlc,
        deletedAt: fullCandidate.deletedAt,
      })
      .run();

    return { ok: true, record: fullCandidate };
  })();
}

export type IngestInput = {
  actor: PersonRow;
  recordKind?: "memory" | "entity" | "episode";
  text: string;
  category: string;
  tier: string;
  scope: "self" | "person" | "household";
  person?: string | null;
  subjectId?: string | null;
  source: string;
  importance: number;
  pinned?: boolean;
  sensitive?: boolean;
  childDisclosure?: "child_ok" | "teen_ok" | "adult_only";
  validFrom?: string | null;
  validTo?: string | null;
  precomputedEmbedding?: { space: string; vector: readonly number[]; preprocess: string };
};

export type IngestResult =
  | { ok: true; record: IngestedRecord; deduped: false }
  | { ok: true; record: IngestedRecord; deduped: true; existingId: string }
  | { ok: false; status: number; error: string };

export function ingestMemory(input: IngestInput): IngestResult {
  const text = input.text;
  const scope = input.scope;
  const person = scope === "person" ? (input.person ?? null) : null;
  const key = canonicalKey(text);

  if (detectCredential(text).detected) {
    return { ok: false, status: 400, error: CREDENTIAL_SAFE_MESSAGE };
  }

  if (scope === "self" && !isOwnerOrAdmin(input.actor)) {
    return { ok: false, status: 403, error: "only owner or admin may write self-scope memories" };
  }
  if (scope === "person") {
    if (!person) return { ok: false, status: 400, error: "person is required when scope is person" };
    if (person !== input.actor.id && !isOwnerOrAdmin(input.actor)) {
      return { ok: false, status: 403, error: "cannot write a memory scoped to another person" };
    }
    const exists = db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, person), isNull(people.deletedAt)))
      .get();
    if (!exists) return { ok: false, status: 400, error: `person not found: ${person}` };
  }

  const existing = findActiveByKey(scope, person, key);
  if (existing) {
    return { ok: true, record: existing, deduped: true, existingId: existing.id };
  }

  const recordKind = input.recordKind ?? "memory";
  const now = new Date().toISOString();
  const candidate = {
    id: newMemoryRecordId(recordKind),
    record_kind: recordKind,
    text,
    category: input.category,
    tier: input.tier,
    status: "active" as const,
    scope,
    person,
    subject_id: input.subjectId ?? null,
    source: input.source,
    importance: input.importance,
    pinned: input.pinned ?? false,
    sensitive: input.sensitive ?? false,
    child_disclosure: input.childDisclosure ?? "child_ok",
    child_disclosure_set_by: null,
    child_disclosure_set_at: null,
    uses: 0,
    created_at: now,
    last_used_at: now,
    valid_from: input.validFrom ?? null,
    valid_to: input.validTo ?? null,
    expired_at: null,
    superseded_by: null,
    embedding_space: null,
    hlc: nextHlc(),
    deleted_at: null,
  };

  const parsed = MemoryRecord.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues.map((i: { message: string }) => i.message).join("; ") };
  }

  const memoryId = parsed.data.id;

  const record: IngestedRecord = {
    id: parsed.data.id,
    recordKind: parsed.data.record_kind,
    text: parsed.data.text,
    category: parsed.data.category,
    tier: parsed.data.tier,
    status: parsed.data.status,
    scope: parsed.data.scope,
    person: parsed.data.person ?? null,
    subjectId: parsed.data.subject_id ?? null,
    source: parsed.data.source,
    importance: parsed.data.importance,
    pinned: parsed.data.pinned,
    sensitive: parsed.data.sensitive,
    childDisclosure: parsed.data.child_disclosure ?? "child_ok",
    childDisclosureSetBy: parsed.data.child_disclosure_set_by,
    childDisclosureSetAt: parsed.data.child_disclosure_set_at,
    uses: parsed.data.uses,
    createdAt: parsed.data.created_at,
    lastUsedAt: parsed.data.last_used_at,
    validFrom: parsed.data.valid_from,
    validTo: parsed.data.valid_to,
    expiredAt: parsed.data.expired_at,
    supersededBy: parsed.data.superseded_by,
    embeddingSpace: parsed.data.embedding_space,
    hlc: parsed.data.hlc,
    deletedAt: parsed.data.deleted_at,
  };

  db.insert(memoryRecords)
    .values(record)
    .run();

  if (input.precomputedEmbedding) {
    storeEmbeddingInTx(memoryId, input.precomputedEmbedding.space, input.precomputedEmbedding.vector, input.precomputedEmbedding.preprocess);
  } else {
    const backend = getEmbedBackendKind();
    if (backend === "none" || backend === "starting") {
      queuePendingWork(memoryId, "embed_failed");
    } else {
      void (async () => {
        const result: EmbedOpResult = await embed([text]);
        if (result.ok) {
          storeEmbeddingInTx(memoryId, result.value.model, result.value.vectors[0]!, result.value.preprocess);
        } else {
          queuePendingWork(memoryId, "embed_failed");
        }
      })().catch(() => {
        queuePendingWork(memoryId, "embed_failed");
      });
    }
  }

  return { ok: true, record, deduped: false };
}

export type SupersedeInput = {
  actor: PersonRow;
  oldRecord: IngestedRecord;
  text: string;
  category: string;
  tier: string;
  scope: "self" | "person" | "household";
  person?: string | null;
  subjectId?: string | null;
  source: string;
  importance: number;
  pinned?: boolean;
  sensitive?: boolean;
  childDisclosure?: "child_ok" | "teen_ok" | "adult_only";
  validFrom?: string | null;
  validTo?: string | null;
  precomputedEmbedding?: { space: string; vector: readonly number[]; preprocess: string };
};

export type SupersedeResult =
  | { ok: true; record: IngestedRecord }
  | { ok: false; status: number; error: string };

export function supersedeMemory(input: SupersedeInput): SupersedeResult {
  const text = input.text;
  const scope = input.scope;
  const person = scope === "person" ? (input.person ?? null) : null;
  const key = canonicalKey(text);

  if (detectCredential(text).detected) {
    return { ok: false, status: 400, error: CREDENTIAL_SAFE_MESSAGE };
  }

  if (scope === "self" && !isOwnerOrAdmin(input.actor)) {
    return { ok: false, status: 403, error: "only owner or admin may write self-scope memories" };
  }
  if (scope === "person") {
    if (!person) return { ok: false, status: 400, error: "person is required when scope is person" };
    if (person !== input.actor.id && !isOwnerOrAdmin(input.actor)) {
      return { ok: false, status: 403, error: "cannot write a memory scoped to another person" };
    }
  }

  const existing = findActiveByKey(scope, person, key);
  if (existing && existing.id !== input.oldRecord.id) {
    sqlite.transaction(() => {
      db.update(memoryRecords)
        .set({
          status: "superseded",
          supersededBy: existing.id,
          validTo: input.validTo ?? input.oldRecord.validTo,
          expiredAt: new Date().toISOString(),
          hlc: nextHlc(),
        })
        .where(eq(memoryRecords.id, input.oldRecord.id))
        .run();
    })();
    return { ok: true, record: existing };
  }

  if (canonicalKey(input.oldRecord.text) === key) {
    return { ok: true, record: input.oldRecord };
  }

  const recordKind = input.oldRecord.recordKind;
  const newCandidate = {
    recordKind,
    text,
    category: input.category,
    tier: input.tier,
    status: "active" as const,
    scope,
    person,
    subjectId: input.subjectId ?? null,
    source: input.source,
    importance: input.importance,
    pinned: input.pinned ?? input.oldRecord.pinned,
    sensitive: input.sensitive ?? input.oldRecord.sensitive,
    childDisclosure: input.childDisclosure ?? (input.oldRecord.childDisclosure as "child_ok" | "teen_ok" | "adult_only"),
    childDisclosureSetBy: input.oldRecord.childDisclosureSetBy,
    childDisclosureSetAt: input.oldRecord.childDisclosureSetAt,
    validFrom: input.validFrom ?? input.oldRecord.validFrom,
    validTo: input.validTo ?? null,
    expiredAt: null,
    supersededBy: null,
    embeddingSpace: null,
    deletedAt: null,
  };

  const result = supersedeInTx(input.oldRecord, newCandidate);
  if (!result.ok) return result;

  const memoryId = result.record.id;
  if (input.precomputedEmbedding) {
    storeEmbeddingInTx(memoryId, input.precomputedEmbedding.space, input.precomputedEmbedding.vector, input.precomputedEmbedding.preprocess);
  } else {
    const backend = getEmbedBackendKind();
    if (backend === "none" || backend === "starting") {
      queuePendingWork(memoryId, "embed_failed");
    } else {
      void (async () => {
        const res: EmbedOpResult = await embed([text]);
        if (res.ok) {
          storeEmbeddingInTx(memoryId, res.value.model, res.value.vectors[0]!, res.value.preprocess);
        } else {
          queuePendingWork(memoryId, "embed_failed");
        }
      })().catch(() => {
        queuePendingWork(memoryId, "embed_failed");
      });
    }
  }

  return { ok: true, record: result.record };
}

export type DrainResult = { embedded: number; cleared: number; stillPending: number };

export async function drainPendingWork(): Promise<DrainResult> {
  const rows = db.select().from(pendingMemoryWork).all();
  let embedded = 0;
  let cleared = 0;
  let stillPending = 0;

  for (const row of rows) {
    if (row.reason === "dedupe_failed") {
      stillPending++;
      continue;
    }
    if (row.reason === "embed_failed") {
      const record = db
        .select()
        .from(memoryRecords)
        .where(eq(memoryRecords.id, row.memoryId))
        .get();
      if (!record || record.status !== "active") {
        clearPendingWork(row.memoryId);
        cleared++;
        continue;
      }
      const backend = getEmbedBackendKind();
      if (backend === "none" || backend === "starting") {
        stillPending++;
        continue;
      }
      try {
        const result: EmbedOpResult = await embed([record.text]);
        if (result.ok) {
          if (storeEmbeddingInTx(row.memoryId, result.value.model, result.value.vectors[0]!, result.value.preprocess)) {
            embedded++;
          } else {
            clearPendingWork(row.memoryId);
            cleared++;
          }
        } else {
          stillPending++;
        }
      } catch (err) {
        console.error(`[memoryIngestion] drain retry failed for ${row.memoryId}: ${(err as Error).message}`);
        stillPending++;
      }
    } else {
      clearPendingWork(row.memoryId);
      cleared++;
    }
  }

  return { embedded, cleared, stillPending };
}
