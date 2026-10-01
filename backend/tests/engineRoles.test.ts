import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "@/app";
import { __setEngineRoleActionsForTests } from "@/routes/engineRoles";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

const calls: string[] = [];
beforeEach(() => {
  resetDb();
  calls.length = 0;
  __setEngineRoleActionsForTests({
    chat: { restart: async () => { calls.push("chat:restart"); }, stop: async () => { calls.push("chat:stop"); }, start: async () => { calls.push("chat:start"); } },
  });
});
afterEach(() => __setEngineRoleActionsForTests(null));

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

describe("POST /api/host/engines/{role}/restart", () => {
  for (const role of ["chat"] as const) {
    test(`${role} restart returns the contract body`, async () => {
      const client = await ownerClient();
      const res = await client.post(`/api/host/engines/${role}/restart`, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role, restarted: true });
      expect(calls).toContain(`${role}:restart`);
    });
  }

  test("does not expose Stack-owned engine actions", async () => {
    const client = await ownerClient();
    for (const role of ["embed", "background"] as const) expect((await client.post(`/api/host/engines/${role}/restart`, {})).status).toBe(400);
  });

  test("refuses a signed-out caller", async () => {
    expect((await new TestClient().post("/api/host/engines/chat/restart", {})).status).toBe(401);
  });

  test("refuses a non-admin adult without restarting anything", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const person = (await created.json()) as { id: string };
    const adult = new TestClient();
    await adult.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
    const res = await adult.post("/api/host/engines/chat/restart", {});
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("rejects an unknown role", async () => {
    const res = await (await ownerClient()).post("/api/host/engines/nope/restart", {});
    expect(res.status).toBe(400);
  });

  test("does not list a Home owned speech engine", async () => {
    const res = await (await ownerClient()).post("/api/host/engines/voice/restart", {});
    expect(res.status).toBe(400);
  });

  test("chat timeout returns 503 with an error", async () => {
    __setEngineRoleActionsForTests({
      chat: { restart: async () => { throw new Error("chat did not return in time"); }, stop: async () => {}, start: async () => {} },
    });
    const res = await (await ownerClient()).post("/api/host/engines/chat/restart", {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "chat did not return in time" });
  });
});

describe("POST /api/host/engines/{role}/{stop,start}", () => {
  for (const action of ["stop", "start"] as const) for (const role of ["chat"] as const) {
    test(`${role} ${action} is owner/admin-only and reaches its supervisor`, async () => {
      const client = await ownerClient();
      const res = await client.post(`/api/host/engines/${role}/${action}`, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role, [action === "stop" ? "stopped" : "started"]: true });
      expect(calls).toContain(`${role}:${action}`);
    });
  }

  test("a non-admin cannot stop or start an engine", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const person = (await created.json()) as { id: string };
    const adult = new TestClient();
    await adult.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
    for (const role of ["chat"] as const) {
      for (const action of ["stop", "start"] as const) expect((await adult.post(`/api/host/engines/${role}/${action}`, {})).status).toBe(403);
    }
    expect(calls).toEqual([]);
  });
});
