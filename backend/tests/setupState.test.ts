import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "@/app";
import { getSetupState } from "@/lib/setupState";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { __clearSessionCacheForTests } from "@/middleware/auth";

beforeEach(() => {
  resetDb();
  __clearSessionCacheForTests();
});

const result = (status = "done") => ({ status });
const allStepIds = ["welcome", "engine_location", "storage", "checks", "plan", "away", "owner", "face", "profile", "hello", "done"] as const;

describe("setup state routes", () => {
  test("unknown step is refused with a plain two-part error", async () => {
    const response = await new TestClient().post("/api/setup/not-a-step", result());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown setup step.", next: "Use one of the documented setup step ids." });
  });

  test("repeat replaces a step result instead of duplicating it", async () => {
    const client = new TestClient();
    await client.post("/api/setup/welcome", { status: "running" });
    const response = await client.post("/api/setup/welcome", result());
    const state = await response.json() as Awaited<ReturnType<typeof getSetupState>>;
    expect(state.steps.filter((step) => step.id === "welcome")).toHaveLength(1);
    expect(state.steps.find((step) => step.id === "welcome")?.status).toBe("done");
  });

  test("checks are refused until engine_location and storage are both done", async () => {
    const client = new TestClient();
    const blocked = await client.post("/api/setup/checks", result());
    expect(blocked.status).toBe(409);
    await client.post("/api/setup/engine_location", result());
    expect((await client.post("/api/setup/checks", result())).status).toBe(409);
    await client.post("/api/setup/storage", result());
    expect((await client.post("/api/setup/checks", result())).status).toBe(200);
  });

  test("GET state returns the server resume point after a partial setup", async () => {
    const client = new TestClient();
    await client.post("/api/setup/welcome", result());
    await client.post("/api/setup/engine_location", result());
    const response = await client.get("/api/setup/state");
    const state = await response.json() as Awaited<ReturnType<typeof getSetupState>>;
    expect(state.steps.map((step) => step.id)).toEqual([...allStepIds]);
    expect(state.steps.find((step) => step.status === "pending")?.id).toBe("storage");
  });

  test("all six schema step statuses are accepted", async () => {
    const statuses = ["pending", "running", "done", "skipped", "deferred", "failed"];
    const client = new TestClient();
    for (const status of statuses) expect((await client.post("/api/setup/welcome", { status })).status).toBe(200);
  });

  test("step status outside the six schema values is rejected", async () => {
    const response = await new TestClient().post("/api/setup/welcome", { status: "complete" });
    expect(response.status).toBe(400);
  });

  test("setup routes allow loopback peers and refuse LAN peers", async () => {
    expect((await new TestClient("127.0.0.1").get("/api/setup/state")).status).toBe(200);
    expect((await new TestClient("192.0.2.40").get("/api/setup/state")).status).toBe(403);
  });

  test("setup routes refuse X-Forwarded-For on a loopback peer", async () => {
    const response = await new TestClient("127.0.0.1").get("/api/setup/state", { "X-Forwarded-For": "127.0.0.1" });
    expect(response.status).toBe(403);
  });

  test("setup routes refuse Forwarded on a loopback peer", async () => {
    const response = await new TestClient("127.0.0.1").get("/api/setup/state", { Forwarded: "for=127.0.0.1" });
    expect(response.status).toBe(403);
  });

  test("setup routes refuse a foreign Host on a loopback peer", async () => {
    const response = await new TestClient("127.0.0.1").get("/api/setup/state", { Host: "home.example.test" });
    expect(response.status).toBe(403);
  });

  test("after an owner exists, GET gives only done to signed-out clients", async () => {
    const owner = new TestClient();
    expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const anonymous = await app.request("/api/setup/state");
    expect(await anonymous.json()).toEqual({ done: true });
    expect((await owner.get("/api/setup/state")).status).toBe(200);
  });

  test("after an owner exists, every pre-owner step returns the sign-in 409", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (const step of ["welcome", "engine_location", "storage", "checks", "plan", "away"]) {
      const response = await owner.post(`/api/setup/${step}`, result());
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Home is already set up. Sign in instead.", next: "Sign in to continue." });
    }
  });

  test("owner, face, profile, hello, and done require the signed-in owner session", async () => {
    const anon = new TestClient();
    await anon.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    for (const step of ["owner", "face", "profile", "hello", "done"]) {
      const response = await app.request(`/api/setup/${step}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(result()) });
      expect(response.status).toBe(401);
    }
    for (const step of ["owner", "face", "profile", "hello", "done"]) {
      expect((await anon.post(`/api/setup/${step}`, result())).status).toBe(200);
    }
  });
});
