import { describe, expect, test, beforeEach } from "bun:test";
import { MemoryRecord } from "@maipai/spec/gen/ts/memory-record.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memoryRecords, people } from "@/db/schema";

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
  test("a person can forget their own memories; the row is actually deleted", async () => {
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
    expect(remaining.length).toBe(0);
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
