import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("GET /api/auth/sessions", () => {
  test("requires auth", async () => {
    const anon = new TestClient();
    expect((await anon.get("/api/auth/sessions")).status).toBe(401);
  });

  test("lists my own session, marked as current", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await client.get("/api/auth/sessions");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ isCurrent: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isCurrent).toBe(true);
  });

  test("only shows my own sessions, not another person's", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const ownerSessions = (await (await owner.get("/api/auth/sessions")).json()) as unknown[];
    expect(ownerSessions).toHaveLength(1);
  });
});

describe("DELETE /api/auth/sessions/:id", () => {
  test("revokes my own session - it stops authenticating immediately", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const [session] = (await (await client.get("/api/auth/sessions")).json()) as Array<{ id: string }>;

    const res = await client.request(`/api/auth/sessions/${session!.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  test("404 for a session that isn't mine", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await client.request("/api/auth/sessions/session-doesnotexist", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
