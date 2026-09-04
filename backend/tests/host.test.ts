import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

describe("GET /api/host/hardware", () => {
  test("requires sign-in", async () => {
    const res = await new TestClient().get("/api/host/hardware");
    expect(res.status).toBe(401);
  });

  test("a non-admin adult is refused: this is host-level, not personal, data", async () => {
    const owner = await ownerClient();
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/select", { personId: adult.id });

    const res = await adultClient.get("/api/host/hardware");
    expect(res.status).toBe(403);
  });

  test("owner sees real detected hardware, not a stub shape", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/hardware");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalRamGb: number; cpuCount: number; cudaDevices: unknown[] };
    expect(body.totalRamGb).toBeGreaterThan(0);
    expect(body.cpuCount).toBeGreaterThan(0);
    expect(Array.isArray(body.cudaDevices)).toBe(true);
  });
});

describe("GET /api/host/models", () => {
  test("requires a valid role query param", async () => {
    const owner = await ownerClient();
    const missing = await owner.get("/api/host/models");
    expect(missing.status).toBe(400);
    const bad = await owner.get("/api/host/models?role=not-a-role");
    expect(bad.status).toBe(400);
  });

  test("chat role returns the real catalog entry with fit info against this machine", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/models?role=chat");
    expect(res.status).toBe(200);
    const fits = (await res.json()) as Array<{ model: { id: string }; fits: boolean }>;
    expect(fits.some((f) => f.model.id === "qwen3-8b-instruct-q4-k-m")).toBe(true);
  });

  test("image role returns entries marked not implemented, for pros/cons display only", async () => {
    const owner = await ownerClient();
    const res = await owner.get("/api/host/models?role=image");
    const fits = (await res.json()) as Array<{ model: { implemented: boolean } }>;
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.every((f) => f.model.implemented === false)).toBe(true);
  });
});
