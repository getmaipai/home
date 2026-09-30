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
    chat: async () => undefined,
    embed: async () => { calls.push("embed"); },
    voice: async () => { calls.push("voice"); },
    background: async () => { calls.push("background"); },
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
  for (const role of ["chat", "embed", "voice", "background"] as const) {
    test(`${role} restart returns the contract body`, async () => {
      const client = await ownerClient();
      if (role === "chat") calls.push("chat");
      const res = await client.post(`/api/host/engines/${role}/restart`, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role, restarted: true });
      expect(calls).toContain(role);
    });
  }

  test("refuses a signed-out caller", async () => {
    expect((await new TestClient().post("/api/host/engines/embed/restart", {})).status).toBe(401);
  });

  test("refuses a non-admin adult without restarting anything", async () => {
    const owner = await ownerClient();
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const person = (await created.json()) as { id: string };
    const adult = new TestClient();
    await adult.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" });
    const res = await adult.post("/api/host/engines/embed/restart", {});
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("rejects an unknown role", async () => {
    const res = await (await ownerClient()).post("/api/host/engines/nope/restart", {});
    expect(res.status).toBe(400);
  });

  test("chat timeout returns 503 with an error", async () => {
    __setEngineRoleActionsForTests({
      chat: async () => { throw new Error("chat did not return in time"); },
      embed: async () => undefined,
      voice: async () => undefined,
      background: async () => undefined,
    });
    const res = await (await ownerClient()).post("/api/host/engines/chat/restart", {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "chat did not return in time" });
  });
});
