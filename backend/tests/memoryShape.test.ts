import { describe, expect, test, beforeEach } from "bun:test";
import { toMemoryRecord } from "@/lib/memoryShape";
import { db } from "@/db";
import { memoryRecords, people } from "@/db/schema";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

function insertMemoryRecord(overrides: Partial<typeof memoryRecords.$inferInsert> = {}) {
  const now = new Date().toISOString();
  const id = overrides.id ?? "mem1234-abcd12";
  const row = {
    id,
    recordKind: "memory",
    text: "A test memory",
    category: "preference",
    tier: "durable",
    status: "active",
    scope: "household",
    person: null,
    subjectId: null,
    source: "test",
    importance: 0.5,
    pinned: false,
    sensitive: false,
    childDisclosure: "child_ok",
    childDisclosureSetBy: null,
    childDisclosureSetAt: null,
    uses: 0,
    createdAt: now,
    lastUsedAt: now,
    validFrom: null,
    validTo: null,
    expiredAt: null,
    supersededBy: null,
    embeddingSpace: null,
    hlc: "1700000000000:0:testfix",
    deletedAt: null,
    ...overrides,
  };
  db.insert(memoryRecords).values(row).run();
  return db.select().from(memoryRecords).all()[0]!;
}

describe("toMemoryRecord", () => {
  test("converts a valid row to the spec shape", () => {
    const row = insertMemoryRecord();
    const record = toMemoryRecord(row);
    expect(record.id).toBe("mem1234-abcd12");
    expect(record.record_kind).toBe("memory");
    expect(record.text).toBe("A test memory");
    expect(record.category).toBe("preference");
    expect(record.tier).toBe("durable");
    expect(record.status).toBe("active");
    expect(record.scope).toBe("household");
    expect(record.person).toBeNull();
    expect(record.subject_id).toBeNull();
    expect(record.source).toBe("test");
    expect(record.importance).toBe(0.5);
    expect(record.pinned).toBe(false);
    expect(record.sensitive).toBe(false);
    expect(record.child_disclosure).toBe("child_ok");
    expect(record.child_disclosure_set_by).toBeNull();
    expect(record.child_disclosure_set_at).toBeNull();
    expect(record.uses).toBe(0);
    expect(record.created_at).toBe(row.createdAt);
    expect(record.last_used_at).toBe(row.lastUsedAt);
    expect(record.hlc).toBe(row.hlc);
  });

  test("handles a person-scoped record with subject", () => {
    const personId = "person-abc123";
    const now = new Date().toISOString();
    db.insert(people)
      .values({
        id: personId,
        displayName: "Test Person",
        role: "adult",
        avatarSeed: personId,
        source: "hub",
        enabled: true,
        guestExpiresAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        hlc: "1700000000000:0:testfix",
      })
      .run();
    const row = insertMemoryRecord({
      scope: "person",
      person: personId,
      subjectId: "ent-abc123",
      importance: 1,
      pinned: true,
      sensitive: true,
      childDisclosure: "adult_only",
      childDisclosureSetBy: personId,
      childDisclosureSetAt: "2026-01-01T00:00:00.000Z",
    });
    const record = toMemoryRecord(row);
    expect(record.scope).toBe("person");
    expect(record.person).toBe(personId);
    expect(record.subject_id).toBe("ent-abc123");
    expect(record.importance).toBe(1);
    expect(record.pinned).toBe(true);
    expect(record.sensitive).toBe(true);
    expect(record.child_disclosure).toBe("adult_only");
    expect(record.child_disclosure_set_by).toBe(personId);
    expect(record.child_disclosure_set_at).toBe("2026-01-01T00:00:00.000Z");
  });

  test("validates against the spec schema and rejects bad values", () => {
    const row = insertMemoryRecord({ category: "bogus" as any });
    expect(() => toMemoryRecord(row)).toThrow();
  });

  test("passes null for optional fields", () => {
    const row = insertMemoryRecord({ id: "mem1235-efgh34" });
    const record = toMemoryRecord(row);
    expect(record.valid_from).toBeNull();
    expect(record.valid_to).toBeNull();
    expect(record.expired_at).toBeNull();
    expect(record.superseded_by).toBeNull();
    expect(record.embedding_space).toBeNull();
    expect(record.deleted_at).toBeNull();
  });
});
