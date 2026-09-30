import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "@/app";
import { db } from "@/db";
import { maintenanceWindows, statusNotes } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); db.delete(statusNotes).run(); db.delete(maintenanceWindows).run(); });

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}

describe("status routes", () => {
  test("signed-out board is rejected", async () => {
    expect((await new TestClient().get("/api/status/board")).status).toBe(401);
  });

  test("an authenticated child reads the board without admin fields", async () => {
    const owner = await ownerClient();
    expect((await owner.post("/api/status/note", { body: "Water will be off" })).status).toBe(201);
    expect((await owner.post("/api/status/maintenance", { title: "Updates", components: ["hub"], starts_at: "2026-10-02T12:00:00Z", ends_at: "2026-10-02T13:00:00Z" })).status).toBe(201);
    const created = await owner.post("/api/people", { displayName: "Marlow", role: "child", secret: "0000" });
    const person = (await created.json()) as { id: string };
    const child = new TestClient();
    expect((await child.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
    const res = await child.get("/api/status/board");
    expect(res.status).toBe(200);
    const body = await res.json() as { note: unknown; maintenance: unknown[] };
    expect(body.maintenance).toHaveLength(1);
    expect(Object.keys(body.maintenance[0]!).sort()).toEqual(["components", "description", "ends_at", "id", "starts_at", "status", "title"]);
    expect(body.note).toMatchObject({ body: "Water will be off", posted_by_name: "Sage" });
    expect(Object.keys(body.note as object).sort()).toEqual(["body", "id", "posted_at", "posted_by_name"]);
  });

  test("owner posts a note and maintenance; members cannot post them", async () => {
    const owner = await ownerClient();
    const signedOut = new TestClient();
    expect((await signedOut.post("/api/status/note", { body: "No" })).status).toBe(401);
    expect((await signedOut.request("/api/status/note", { method: "DELETE" })).status).toBe(401);
    expect((await signedOut.post("/api/status/maintenance", {})).status).toBe(401);
    expect((await signedOut.post("/api/status/maintenance/maint-a1b2c3/cancel", {})).status).toBe(401);
    expect((await owner.post("/api/status/note", { body: "Planned work" })).status).toBe(201);
    const maintenance = await owner.post("/api/status/maintenance", { title: "Updates", components: ["hub"], starts_at: "2026-10-02T12:00:00Z", ends_at: "2026-10-02T13:00:00Z" });
    expect(maintenance.status).toBe(201);
    expect((await new TestClient().post("/api/status/note", { body: "No" })).status).toBe(401);
    expect((await app.request("/api/status/note", { method: "DELETE" })).status).toBe(401);
  });

  test("reports plain errors for invalid and completed maintenance", async () => {
    const owner = await ownerClient();
    const invalid = await owner.post("/api/status/maintenance", { title: "Bad", components: ["hub"], starts_at: "2026-10-02T13:00:00Z", ends_at: "2026-10-02T12:00:00Z" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Maintenance must end after it starts." });
    const created = await owner.post("/api/status/maintenance", { title: "Done", components: ["hub"], starts_at: "2026-09-29T12:00:00Z", ends_at: "2026-09-29T13:00:00Z" });
    expect(created.status).toBe(400);
  });

  test("adult, teen, child and guest cannot use admin routes", async () => {
    const owner = await ownerClient();
    for (const role of ["adult", "teen", "child", "guest"] as const) {
      const created = await owner.post("/api/people", { displayName: `Test ${role}`, role, secret: "0000" });
      expect(created.status).toBe(201);
      const person = await created.json() as { id: string };
      const member = new TestClient();
      expect((await member.post("/api/auth/verify-secret", { personId: person.id, secret: "0000" })).status).toBe(200);
      expect((await member.post("/api/status/note", { body: "No" })).status).toBe(403);
      expect((await member.request("/api/status/note", { method: "DELETE" })).status).toBe(403);
      expect((await member.post("/api/status/maintenance", { title: "No", components: ["hub"], starts_at: "2026-10-02T12:00:00Z", ends_at: "2026-10-02T13:00:00Z" })).status).toBe(403);
      expect((await member.post("/api/status/maintenance/maint-a1b2c3/cancel", {})).status).toBe(403);
    }
  });
});
