import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memoryEmbeddings, memoryRecords, people } from "@/db/schema";
import { ingestMemory, storeEmbeddingInTx } from "@/lib/memoryIngestion";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

beforeEach(() => resetDb());

async function createMemory() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const result = ingestMemory({
    actor: person,
    text: "A memory awaiting its embedding",
    category: "fact",
    tier: "durable",
    scope: "person",
    person: person.id,
    source: "test",
    importance: 0.5,
  });
  if (!result.ok) throw new Error(result.error);
  return result.record;
}

describe("storeEmbeddingInTx after erasure", () => {
  test("does not store an embedding for an erased memory", async () => {
    const record = await createMemory();
    db.update(memoryRecords)
      .set({ status: "archived", deletedAt: new Date().toISOString(), embeddingSpace: null })
      .where(eq(memoryRecords.id, record.id))
      .run();

    expect(storeEmbeddingInTx(record.id, "late-space", [0.1, 0.2], "v1")).toBe(false);
    expect(db.select().from(memoryEmbeddings).where(eq(memoryEmbeddings.memoryId, record.id)).get()).toBeUndefined();
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()?.embeddingSpace).toBeNull();
  });

  test("stores an embedding for a live memory", async () => {
    const record = await createMemory();

    expect(storeEmbeddingInTx(record.id, "live-space", [0.1, 0.2], "v1")).toBe(true);
    expect(db.select().from(memoryEmbeddings).where(eq(memoryEmbeddings.memoryId, record.id)).get()?.space).toBe("live-space");
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.id, record.id)).get()?.embeddingSpace).toBe("live-space");
  });
});
