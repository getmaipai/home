import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { people } from "@/db/schema";
import { medianMinutes, estimateVideoMinutes } from "../src/lib/videos/estimate";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

describe("medianMinutes", () => {
  test("fewer than three clips is no estimate", () => { expect(medianMinutes([120, 130])).toBeNull(); });
  test("the median in whole minutes, at least one", () => {
    expect(medianMinutes([100, 200, 900])).toBe(3);
    expect(medianMinutes([10, 20, 30])).toBe(1);
    expect(medianMinutes([60, 120, 180, 600])).toBe(3);
  });
});

describe("estimateVideoMinutes and GET /api/videos/estimate", () => {
  let client: TestClient; let ownerId: string;
  beforeEach(async () => { resetDb(); client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); ownerId = db.select().from(people).where(eq(people.displayName, "Sage")).get()!.id; });
  function job(i: number, seconds: number, spentSeconds: number, tier?: string) {
    const created = new Date(Date.UTC(2026, 10, 1, 10, i)).toISOString(), updated = new Date(Date.UTC(2026, 10, 1, 10, i) + spentSeconds * 1000).toISOString();
    db.insert(videoJobs).values({ id: `vj-${i}`, personId: ownerId, kind: "generate", state: "done", percent: 100, prompt: "p", request: JSON.stringify({ size: "832x480", seconds, seed: null, loras: [], source_file_id: null, audience: "adult", ...(tier ? { tier } : {}) }), files: "[]", createdAt: created, updatedAt: updated, hlc: `1:${i}:t` } as never).run();
  }
  test("uses only this home's finished clips at the same level and length", async () => {
    job(1, 5, 300); job(2, 5, 360); job(3, 5, 420); job(4, 10, 900); job(5, 5, 1200, "max");
    expect(estimateVideoMinutes({ tier: "standard", seconds: 5 })).toMatchObject({ minutes: 6, samples: 3 });
    expect(estimateVideoMinutes({ tier: "max", seconds: 5 })).toMatchObject({ minutes: null, samples: 1 });
    const res = await client.get("/api/videos/estimate?seconds=5");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ minutes: 6, samples: 3 });
    expect((await new TestClient().get("/api/videos/estimate?seconds=5")).status).toBe(401);
  });
});
