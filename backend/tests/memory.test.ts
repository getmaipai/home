import { describe, expect, test, beforeEach } from "bun:test";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { memoryRecords, memoryEmbeddings, pendingEmbeddings, people } from "@/db/schema";
import { recall, remember, bumpUsage, drainPendingEmbeddings, PROFILE_SOURCE } from "@/lib/memory";
import { compareHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";

// Test-only mirror of memory.ts's own (unexported) vectorToBuffer: lets
// these tests inject a known vector directly into memory_embeddings
// without going through a real embed() call, so recall()'s cosine
// scoring can be exercised with hand-picked, easy-to-reason-about
// numbers instead of the stub embedder's bag-of-words output.
function injectVector(memoryId: string, vector: number[]): void {
  db.insert(memoryEmbeddings)
    .values({ memoryId, space: "test", dims: vector.length, vector: Buffer.from(new Float32Array(vector).buffer), hlc: "test-hlc" })
    .run();
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerAndChild() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
  const child = (await created.json()) as { id: string };
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: child.id });
  return { owner, childClient, childId: child.id };
}

// Row-level counterpart of ownerAndChild() above: the direct recall()/
// remember() unit tests below (step 2) need a real PersonRow, not just
// an HTTP client.
async function ownerAndChildRows(): Promise<{ ownerRow: PersonRow; childId: string }> {
  const { childId } = await ownerAndChild();
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { ownerRow, childId };
}

describe("POST /api/memory (remember)", () => {
  test("requires auth", async () => {
    const res = await new TestClient().post("/api/memory", {});
    expect(res.status).toBe(401);
  });

  test("creates a household memory and returns a spec-valid record", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/memory", {
      text: "The family dog is named Sprout",
      category: "thing",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.6,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(() => MemoryRecord.parse(body)).not.toThrow();
    expect((body as MemoryRecord).id).toMatch(/^mem[0-9]+-[a-z0-9]{6}$/);
    expect((body as MemoryRecord).status).toBe("active");
    // Step 10: every write sets a real, spec-shaped hlc.
    expect((body as MemoryRecord).hlc).toMatch(/^[0-9]+:[0-9]+:[a-z0-9]{6,}$/);
  });

  // Step 10 (session-a-intelligence.md): "every write sets a monotonic
  // hlc." Two independent writes to two different records, in order,
  // must compare as increasing - proven with the real compareHlc()
  // rather than a string/lexical comparison, since hlc's own format
  // (wall_ms:counter:node) isn't lexically sortable once counters or
  // wall_ms values differ in digit length.
  test("successive writes get monotonically increasing hlcs", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const first = (await (
      await owner.post("/api/memory", {
        text: "First fact",
        category: "fact",
        tier: "durable",
        scope: "household",
        source: "test",
        importance: 0.5,
      })
    ).json()) as MemoryRecord;
    const second = (await (
      await owner.post("/api/memory", {
        text: "Second fact",
        category: "fact",
        tier: "durable",
        scope: "household",
        source: "test",
        importance: 0.5,
      })
    ).json()) as MemoryRecord;
    expect(compareHlc(second.hlc, first.hlc)).toBeGreaterThan(0);
  });

  test("a person cannot write a memory scoped to someone else", async () => {
    const { owner, childClient, childId } = await ownerAndChild();
    void owner;
    const res = await childClient.post("/api/memory", {
      text: "Sage likes tea",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: "person-someoneelse",
      source: "test",
      importance: 0.3,
    });
    expect(res.status).toBe(403);
    void childId;
  });

  test("a person can write a memory scoped to themself", async () => {
    const { childClient, childId } = await ownerAndChild();
    const res = await childClient.post("/api/memory", {
      text: "Bramble is scared of thunder",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.5,
    });
    expect(res.status).toBe(201);
  });

  test("only owner or admin may write self-scope memories", async () => {
    const { childClient } = await ownerAndChild();
    const res = await childClient.post("/api/memory", {
      text: "The companion feels curious today",
      category: "state",
      tier: "observation",
      scope: "self",
      source: "test",
      importance: 0.1,
    });
    expect(res.status).toBe(403);
  });

  test("rejects an invalid category with a spec-driven 400", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/memory", {
      text: "test",
      category: "not-a-real-category",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    expect(res.status).toBe(400);
  });

  test("a typo'd person id is a clean 400, not a raw FK-constraint 500", async () => {
    // A code review (2026-09-04) found this reaching the SQLite foreign
    // key and surfacing an uncaught "FOREIGN KEY constraint failed" 500.
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/memory", {
      text: "test",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: "person-doesnotexist",
      source: "test",
      importance: 0.5,
    });
    expect(res.status).toBe(400);
  });

  test("a soft-deleted person is not a valid write target either", async () => {
    // A follow-up review found the first cut of the FK-existence check
    // above didn't exclude deletedAt, unlike the deletedAt-awareness this
    // same pass added to resolveSession()/verify-secret.
    const { owner, childId } = await ownerAndChild();
    db.update(people)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(people.id, childId))
      .run();

    const res = await owner.post("/api/memory", {
      text: "test",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.5,
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/memory (list) and visibility", () => {
  test("household memories are visible to any signed-in person", async () => {
    const { owner, childClient } = await ownerAndChild();
    await owner.post("/api/memory", {
      text: "We're getting a new couch",
      category: "event",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.4,
    });
    const res = await childClient.get("/api/memory");
    const body = (await res.json()) as MemoryRecord[];
    expect(body.some((m) => m.text === "We're getting a new couch")).toBe(true);
  });

  test("a child's person-scoped memory IS visible to owner/admin", async () => {
    const { owner, childClient, childId } = await ownerAndChild();
    await childClient.post("/api/memory", {
      text: "Bramble's favorite color is green",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.3,
    });
    const res = await owner.get(`/api/memory?scope=person&person=${childId}`);
    const body = (await res.json()) as MemoryRecord[];
    expect(body.some((m) => m.text === "Bramble's favorite color is green")).toBe(true);
  });

  test("an adult's person-scoped memory is NOT visible to another owner/admin", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const createdAdmin = await owner.post("/api/people", {
      displayName: "Nova",
      role: "admin",
      secret: "correcthorse2",
    });
    const admin = (await createdAdmin.json()) as { id: string };

    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "correcthorse2" });
    await adminClient.post("/api/memory", {
      text: "Nova is planning a surprise trip",
      category: "goal",
      tier: "durable",
      scope: "person",
      person: admin.id,
      source: "test",
      importance: 0.5,
    });

    const res = await owner.get(`/api/memory?scope=person&person=${admin.id}`);
    const body = (await res.json()) as MemoryRecord[];
    expect(body.length).toBe(0);
  });

  test("scope=self is never returned, even to owner", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.post("/api/memory", {
      text: "The companion's own private note",
      category: "state",
      tier: "observation",
      scope: "self",
      source: "test",
      importance: 0.1,
    });
    const res = await owner.get("/api/memory?scope=self");
    const body = (await res.json()) as MemoryRecord[];
    expect(body.length).toBe(0);
  });

  test("a sensitive household memory is hidden from a non-admin", async () => {
    const { owner, childClient } = await ownerAndChild();
    await owner.post("/api/memory", {
      text: "Sensitive household fact",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
      sensitive: true,
    });
    const asChild = (await (await childClient.get("/api/memory")).json()) as MemoryRecord[];
    const asOwner = (await (await owner.get("/api/memory")).json()) as MemoryRecord[];
    expect(asChild.some((m) => m.text === "Sensitive household fact")).toBe(false);
    expect(asOwner.some((m) => m.text === "Sensitive household fact")).toBe(true);
  });

  test("list does not touch uses or last_used_at", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.post("/api/memory", {
      text: "Static fact",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    const before = ((await (await owner.get("/api/memory")).json()) as MemoryRecord[])[0]!;
    const after = ((await (await owner.get("/api/memory")).json()) as MemoryRecord[])[0]!;
    expect(after.uses).toBe(before.uses);
    expect(after.last_used_at).toBe(before.last_used_at);
  });
});

describe("POST /api/memory/recall", () => {
  test("scores by keyword overlap and touches usage on returned matches", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.post("/api/memory", {
      text: "Riff prefers oat milk in coffee",
      category: "preference",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.4,
    });
    await owner.post("/api/memory", {
      text: "The weather was rainy last Tuesday",
      category: "event",
      tier: "episodic",
      scope: "household",
      source: "test",
      importance: 0.1,
    });

    const res = await owner.post("/api/memory/recall", { q: "what milk does Riff like" });
    const body = (await res.json()) as Array<{ record: MemoryRecord; score: number }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]!.record.text).toContain("oat milk");
    expect(body[0]!.record.uses).toBe(1);
  });

  test("entity match boosts memories mentioning that entity", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.post("/api/memory", {
      record_kind: "entity",
      text: "Sprout: the family dog, a golden retriever",
      category: "thing",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.6,
      pinned: true,
    });
    await owner.post("/api/memory", {
      text: "Sprout needs a vet appointment next week",
      category: "event",
      tier: "episodic",
      scope: "household",
      source: "test",
      importance: 0.3,
    });
    await owner.post("/api/memory", {
      text: "The car needs an oil change",
      category: "event",
      tier: "episodic",
      scope: "household",
      source: "test",
      importance: 0.3,
    });

    const res = await owner.post("/api/memory/recall", { q: "Sprout" });
    const body = (await res.json()) as Array<{ record: MemoryRecord; score: number }>;
    const vetMatch = body.find((m) => m.record.text.includes("vet appointment"));
    const carMatch = body.find((m) => m.record.text.includes("oil change"));
    expect(vetMatch).toBeDefined();
    expect(carMatch).toBeUndefined();
  });

  test("entity matching is word-boundary safe, not a raw substring check", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await owner.post("/api/memory", {
      record_kind: "entity",
      text: "Ann: grandmother",
      category: "person",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.6,
    });
    await owner.post("/api/memory", {
      text: "The annual picnic is in June",
      category: "event",
      tier: "episodic",
      scope: "household",
      source: "test",
      importance: 0.3,
    });

    const res = await owner.post("/api/memory/recall", { q: "Ann" });
    const body = (await res.json()) as Array<{ record: MemoryRecord; score: number }>;
    const picnicMatch = body.find((m) => m.record.text.includes("annual picnic"));
    expect(picnicMatch).toBeUndefined();
  });
});

describe("supersede and archive", () => {
  test("supersede retires the old record and creates a new active one", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "Riff's favorite color is blue",
      category: "preference",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.3,
    });
    const original = (await created.json()) as MemoryRecord;

    const res = await owner.post(`/api/memory/${original.id}/supersede`, {
      text: "Riff's favorite color is green now",
      source: "test-update",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { old: MemoryRecord; created: MemoryRecord };
    expect(body.old.status).toBe("superseded");
    expect(body.old.superseded_by).toBe(body.created.id);
    expect(body.old.expired_at).not.toBeNull();
    expect(body.created.status).toBe("active");
    expect(body.created.text).toBe("Riff's favorite color is green now");
  });

  test("archive tombstones without deleting the row", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "A fact that will be archived",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.2,
    });
    const original = (await created.json()) as MemoryRecord;

    const res = await owner.post(`/api/memory/${original.id}/archive`, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryRecord;
    expect(body.status).toBe("archived");
    expect(body.expired_at).not.toBeNull();

    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, original.id)).get();
    expect(row).toBeDefined();
  });
});

describe("forget and export", () => {
  // Step 10 (session-a-intelligence.md): forget() tombstones, it no
  // longer hard-deletes - a hard delete cannot be told apart from "never
  // existed" once a robot or a second hub syncs, so a device offline
  // during the forget could resurrect the record right back.
  test("a person can forget their own memories; the row is tombstoned, not deleted", async () => {
    const { childClient, childId } = await ownerAndChild();
    await childClient.post("/api/memory", {
      text: "Bramble's own secret",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.5,
    });

    const res = await childClient.post("/api/memory/forget", { personId: childId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);

    const remaining = db.select().from(memoryRecords).where(eq(memoryRecords.person, childId)).all();
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.status).toBe("archived");
    expect(remaining[0]!.text).toBe("[forgotten]");
    expect(remaining[0]!.embeddingSpace).toBeNull();
    expect(remaining[0]!.deletedAt).not.toBeNull();
  });

  test("forgetting another person's memories is refused for a non-admin", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const createdA = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "pass1234" });
    const createdB = await owner.post("/api/people", { displayName: "Marsh", role: "adult", secret: "pass5678" });
    const a = (await createdA.json()) as { id: string };
    const b = (await createdB.json()) as { id: string };

    const clientA = new TestClient();
    await clientA.post("/api/auth/verify-secret", { personId: a.id, secret: "pass1234" });
    const res = await clientA.post("/api/memory/forget", { personId: b.id });
    expect(res.status).toBe(403);
  });

  // A code review (2026-09-04) found forget()/exportPerson() using a
  // BROADER rule than list()/recall()'s canRead(): an owner/admin could
  // not browse an adult's person-scoped memories but could export or
  // erase them wholesale. These two tests prove the fixed, shared rule:
  // owner/admin access to a person's memories (read, export, or forget)
  // matches exactly, same as a child's does above.
  test("an owner/admin cannot export an adult's memories, only a child's", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const createdAdult = await owner.post("/api/people", {
      displayName: "Nova",
      role: "adult",
      secret: "correcthorse2",
    });
    const adult = (await createdAdult.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "correcthorse2" });
    await adultClient.post("/api/memory", {
      text: "Nova's private memory",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: adult.id,
      source: "test",
      importance: 0.5,
    });

    const res = await owner.get(`/api/memory/export?personId=${adult.id}`);
    expect(res.status).toBe(403);
  });

  test("an owner/admin cannot forget an adult's memories, only a child's", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const createdAdult = await owner.post("/api/people", {
      displayName: "Nova",
      role: "adult",
      secret: "correcthorse2",
    });
    const adult = (await createdAdult.json()) as { id: string };

    const res = await owner.post("/api/memory/forget", { personId: adult.id });
    expect(res.status).toBe(403);
  });

  test("export returns every status, not just active", async () => {
    const { childClient, childId } = await ownerAndChild();
    const created = await childClient.post("/api/memory", {
      text: "A memory that will be archived",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.2,
    });
    const record = (await created.json()) as MemoryRecord;
    await childClient.post(`/api/memory/${record.id}/archive`, {});

    const res = await childClient.get(`/api/memory/export?personId=${childId}`);
    const body = (await res.json()) as MemoryRecord[];
    expect(body.length).toBe(1);
    expect(body[0]!.status).toBe("archived");
  });

  // Step 10: an ordinary archived record (above) still exports - its
  // content is real. A tombstoned one must not: showing TOMBSTONE_TEXT
  // back to the person who just asked to forget it would look exactly
  // like the erasure didn't actually happen.
  test("export omits a tombstoned (forgotten) record, unlike an ordinary archived one", async () => {
    const { childClient, childId } = await ownerAndChild();
    await childClient.post("/api/memory", {
      text: "A memory that will be forgotten",
      category: "fact",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.5,
    });

    await childClient.post("/api/memory/forget", { personId: childId });

    const res = await childClient.get(`/api/memory/export?personId=${childId}`);
    const body = (await res.json()) as MemoryRecord[];
    expect(body.length).toBe(0);
  });
});

describe("POST /api/memory/maintenance/run", () => {
  test("requires owner or admin", async () => {
    const { childClient } = await ownerAndChild();
    const res = await childClient.post("/api/memory/maintenance/run", {});
    expect(res.status).toBe(403);
  });

  test("archives unused, low-importance, unpinned memories", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "A low-importance fact nobody has used in a while",
      category: "fact",
      tier: "observation",
      scope: "household",
      source: "test",
      importance: 0.1,
    });
    const record = (await created.json()) as MemoryRecord;

    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    db.update(memoryRecords).set({ lastUsedAt: staleDate }).where(eq(memoryRecords.id, record.id)).run();

    const res = await owner.post("/api/memory/maintenance/run", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { archived: number };
    expect(body.archived).toBeGreaterThanOrEqual(1);

    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()!;
    expect(row.status).toBe("archived");
  });

  test("pinned memories are never archived by maintenance", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "A pinned fact that stays forever",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.05,
      pinned: true,
    });
    const record = (await created.json()) as MemoryRecord;
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    db.update(memoryRecords).set({ lastUsedAt: staleDate }).where(eq(memoryRecords.id, record.id)).run();

    await owner.post("/api/memory/maintenance/run", {});
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()!;
    expect(row.status).toBe("active");
  });

  test("a durable, unpinned, low-importance memory is never archived by decay, even if very stale", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "Riff prefers oat milk in coffee",
      category: "preference",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.05,
    });
    const record = (await created.json()) as MemoryRecord;
    const staleDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    db.update(memoryRecords).set({ lastUsedAt: staleDate }).where(eq(memoryRecords.id, record.id)).run();

    await owner.post("/api/memory/maintenance/run", {});
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()!;
    expect(row.status).toBe("active");
  });

  test("a state-category memory expires hard after 7 days regardless of importance", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "Feeling stressed about the deadline",
      category: "state",
      tier: "observation",
      scope: "household",
      source: "test",
      importance: 0.9,
    });
    const record = (await created.json()) as MemoryRecord;
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.update(memoryRecords)
      .set({ createdAt: eightDaysAgo, lastUsedAt: eightDaysAgo })
      .where(eq(memoryRecords.id, record.id))
      .run();

    await owner.post("/api/memory/maintenance/run", {});
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()!;
    expect(row.status).toBe("archived");
  });

  test("a fresh state-category memory (under 7 days) survives maintenance", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/memory", {
      text: "Feeling excited about the trip",
      category: "state",
      tier: "observation",
      scope: "household",
      source: "test",
      importance: 0.9,
    });
    const record = (await created.json()) as MemoryRecord;

    await owner.post("/api/memory/maintenance/run", {});
    const row = db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()!;
    expect(row.status).toBe("active");
  });
});

describe("recall() selfOnly (step 2 privacy fix)", () => {
  test("a parent's turn-scoped recall never returns a child's person-scope memory, even though it's otherwise readable to them", async () => {
    const { ownerRow, childId } = await ownerAndChildRows();
    const created = remember(ownerRow, {
      text: "the diary entry about a secret crush",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: childId,
      source: "test",
      importance: 0.8,
    });
    expect(created.ok).toBe(true);

    // Proves canAccessPerson() really would let the owner read this one
    // (a parent viewing a child's, the sanctioned parental-view case):
    // the fix is specifically about the turn's OWN call, not about
    // owner/admin losing that access everywhere.
    const unrestricted = recall(ownerRow, "secret crush diary entry", { bumpUsage: false });
    expect(unrestricted.some((m) => m.record.person === childId)).toBe(true);

    const turnScoped = recall(ownerRow, "secret crush diary entry", { selfOnly: true, bumpUsage: false });
    expect(turnScoped.some((m) => m.record.person === childId)).toBe(false);
  });

  test("selfOnly still returns the actor's own person-scope and household records", async () => {
    const { ownerRow } = await ownerAndChildRows();
    remember(ownerRow, {
      text: "my own allergy is peanuts",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: ownerRow.id,
      source: "test",
      importance: 0.8,
    });
    remember(ownerRow, {
      text: "household allergy note: peanuts are banned from the kitchen",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.8,
    });

    const results = recall(ownerRow, "peanuts allergy", { selfOnly: true, bumpUsage: false });
    expect(results.some((m) => m.record.scope === "person" && m.record.person === ownerRow.id)).toBe(true);
    expect(results.some((m) => m.record.scope === "household")).toBe(true);
  });
});

describe("recall() bumpUsage option (step 2: usage bumps only what reached the prompt)", () => {
  test("bumpUsage: false leaves uses untouched; a later explicit bumpUsage() call updates exactly the given matches", async () => {
    const { ownerRow } = await ownerAndChildRows();
    const created = remember(ownerRow, {
      text: "the calendar rule about pizza night",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const matches = recall(ownerRow, "the calendar rule about pizza night", { bumpUsage: false });
    expect(matches.length).toBeGreaterThan(0);
    const before = db.select().from(memoryRecords).where(eq(memoryRecords.id, created.value.id)).get()!;
    expect(before.uses).toBe(0);

    bumpUsage(matches);
    const after = db.select().from(memoryRecords).where(eq(memoryRecords.id, created.value.id)).get()!;
    expect(after.uses).toBe(1);
  });

  test("bumpUsage defaults to true, matching the existing direct-recall contract", async () => {
    const { ownerRow } = await ownerAndChildRows();
    const created = remember(ownerRow, {
      text: "the calendar rule about game night",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    recall(ownerRow, "the calendar rule about game night");
    const after = db.select().from(memoryRecords).where(eq(memoryRecords.id, created.value.id)).get()!;
    expect(after.uses).toBe(1);
  });
});

describe("recall() cosine scoring (step 5: real embeddings)", () => {
  test("a paraphrase with a matching vector recalls; a keyword-sharing decoy with a non-matching vector does not", async () => {
    const { ownerRow } = await ownerAndChildRows();
    // Deliberately no shared words with the query: proves the vector,
    // not keyword overlap, is what surfaces this record.
    const target = remember(ownerRow, {
      text: "the spare key lives in the lockbox by the garage",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    // Deliberately shares "house"/"key" with the query: proves keyword
    // overlap alone is no longer enough once a query vector is given -
    // its own vector must clear the tier's cosine floor too.
    const decoy = remember(ownerRow, {
      text: "the house key code for the front door alarm is 4517",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    if (!target.ok || !decoy.ok) throw new Error("setup failed");

    injectVector(target.value.id, [1, 0, 0, 0]);
    injectVector(decoy.value.id, [0, 1, 0, 0]);

    const matches = recall(ownerRow, "where do we keep the spare house key", { queryVector: new Float32Array([1, 0, 0, 0]) });
    const ids = matches.map((m) => m.record.id);
    expect(ids).toContain(target.value.id);
    expect(ids).not.toContain(decoy.value.id);
  });

  // A code review (2026-09-05) found that a pinned or entity-matched
  // record bypasses the cosine FLOOR (line above) but was still dropped
  // by the trailing `if (score > 0)` gate once its own weighted score
  // (0.7*cosine + 0.2*importance + 0.1*recency) went negative - real,
  // since unlike keyword overlap, cosine can be negative. This record's
  // vector is the exact opposite of the query's and its importance is 0,
  // so its score is guaranteed negative; "pinned" is the only reason it
  // should ever surface, and it must, all the way to the final list.
  test("a pinned record with a genuinely negative cosine score still surfaces (score > 0 must not undo the floor bypass)", async () => {
    const { ownerRow } = await ownerAndChildRows();
    const pinned = remember(ownerRow, {
      text: "a fact nothing in this query resembles at all",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0,
      pinned: true,
    });
    if (!pinned.ok) throw new Error("setup failed");
    injectVector(pinned.value.id, [-1, 0, 0, 0]);

    const matches = recall(ownerRow, "completely unrelated question", { queryVector: new Float32Array([1, 0, 0, 0]) });
    expect(matches.map((m) => m.record.id)).toContain(pinned.value.id);
  });

  // A post-hoc review (2026-09-05) found recall() had no exclusion for
  // the profile paragraph (step 7): turnEngine.ts's buildSystemPrompt()
  // already injects it unconditionally via getProfileParagraph(), so
  // without this exclusion its own `pinned: true` would force it past
  // recall()'s own floor/score gates and inject the SAME text a second
  // time as an ordinary scored match, wasting a memory-snippet slot on
  // every turn.
  test("never returns the profile paragraph as an ordinary recall candidate, even though it's pinned", async () => {
    const { ownerRow } = await ownerAndChildRows();
    const profile = remember(ownerRow, {
      text: "the household's own profile paragraph text",
      category: "identity",
      tier: "durable",
      scope: "person",
      person: ownerRow.id,
      source: PROFILE_SOURCE,
      importance: 0.9,
      pinned: true,
    });
    if (!profile.ok) throw new Error("setup failed");
    injectVector(profile.value.id, [1, 0, 0, 0]);

    const matches = recall(ownerRow, "the household's own profile paragraph text", { queryVector: new Float32Array([1, 0, 0, 0]) });
    expect(matches.map((m) => m.record.id)).not.toContain(profile.value.id);
  });

  test("falls back to keyword overlap when no query vector is available (embed backend down)", async () => {
    const { ownerRow } = await ownerAndChildRows();
    const created = remember(ownerRow, {
      text: "the recycling goes out on Tuesday",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    if (!created.ok) throw new Error("setup failed");

    // No queryVector passed at all - the exact shape a caller gets when
    // embedQueryForRecall() itself returned undefined.
    const matches = recall(ownerRow, "recycling Tuesday", { bumpUsage: false });
    expect(matches.map((m) => m.record.id)).toContain(created.value.id);
  });
});

describe("drainPendingEmbeddings (step 5: the retry job)", () => {
  test("embeds a queued record and clears it from the pending queue", async () => {
    const { ownerRow } = await ownerAndChildRows();
    const created = remember(ownerRow, {
      text: "the garage door code is 7734",
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.5,
    });
    if (!created.ok) throw new Error("setup failed");
    // Simulate an earlier failed embed-on-write: no vector row yet, but
    // queued for retry.
    db.insert(pendingEmbeddings).values({ memoryId: created.value.id, queuedAt: new Date().toISOString() }).onConflictDoNothing().run();

    const result = await drainPendingEmbeddings();
    expect(result.embedded).toBeGreaterThanOrEqual(1);
    expect(result.stillPending).toBe(0);

    const pendingRow = db.select().from(pendingEmbeddings).where(eq(pendingEmbeddings.memoryId, created.value.id)).get();
    expect(pendingRow).toBeUndefined();
    const vectorRow = db.select().from(memoryEmbeddings).where(eq(memoryEmbeddings.memoryId, created.value.id)).get();
    expect(vectorRow).toBeTruthy();
  });

  test("drops a queued id whose record no longer exists, without throwing", async () => {
    // pending_embeddings.memory_id carries a real FK to memory_records,
    // so an orphaned row can only exist via the exact fire-and-forget
    // race storeEmbedding()/queueForEmbedding()'s own comments describe
    // (a background embed call landing after the record it's about was
    // already deleted); PRAGMA off for one insert reproduces that
    // orphaned state without needing to win a real race.
    sqlite.exec("PRAGMA foreign_keys = OFF");
    try {
      db.insert(pendingEmbeddings).values({ memoryId: "mem1-doesnotexist", queuedAt: new Date().toISOString() }).run();
    } finally {
      sqlite.exec("PRAGMA foreign_keys = ON");
    }

    const result = await drainPendingEmbeddings();
    expect(result.stillPending).toBe(0);

    const pendingRow = db.select().from(pendingEmbeddings).where(eq(pendingEmbeddings.memoryId, "mem1-doesnotexist")).get();
    expect(pendingRow).toBeUndefined();
  });
});
