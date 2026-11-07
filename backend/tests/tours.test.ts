import { describe, expect, test, beforeEach } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function signedIn(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

function storedCounts(): Record<string, number> {
  const row = db.select().from(settingsValues).where(and(eq(settingsValues.scope, "household"), eq(settingsValues.key, "_tours.target-missing"))).get();
  return row ? (JSON.parse(row.value) as Record<string, number>) : {};
}

describe("POST /api/tours/missing-target (AUDIT-ROUTES-01)", () => {
  test("ids are length-checked (120 characters at most; no manifest lookup exists): a 200-character id is 400", async () => {
    const client = await signedIn();
    const res = await client.post("/api/tours/missing-target", { package_id: "pkg", tour_id: "t".repeat(200), step_id: "s" });
    expect(res.status).toBe(400);
    expect(Object.keys(storedCounts())).toHaveLength(0);
  });

  test("the 501st distinct key drops the oldest one", async () => {
    const client = await signedIn();
    for (let i = 0; i < 501; i++) {
      expect((await client.post("/api/tours/missing-target", { package_id: "pkg", tour_id: "tour", step_id: `step-${i}` })).status).toBeLessThan(300);
    }
    const counts = storedCounts();
    expect(Object.keys(counts)).toHaveLength(500);
    expect(counts["pkg:tour:step-0"]).toBeUndefined();
    expect(counts["pkg:tour:step-500"]).toBe(1);
  }, 60_000);

  test("repeating a stored key counts up without dropping anything", async () => {
    const client = await signedIn();
    await client.post("/api/tours/missing-target", { package_id: "pkg", tour_id: "tour", step_id: "a" });
    await client.post("/api/tours/missing-target", { package_id: "pkg", tour_id: "tour", step_id: "a" });
    expect(storedCounts()["pkg:tour:a"]).toBe(2);
  });
});
