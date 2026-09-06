import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { raiseIssue, registerFixHandler, __resetFixHandlersForTests } from "@/lib/issues";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
});

async function owner(): Promise<{ client: TestClient; row: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const row = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  return { client, row };
}

async function teen(ownerClient: TestClient): Promise<TestClient> {
  const created = await ownerClient.post("/api/people", { displayName: "Bramble", role: "teen" });
  const { id } = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return client;
}

describe("GET /api/repairs", () => {
  test("requires owner/admin, not just any signed-in person", async () => {
    const { client } = await owner();
    const teenClient = await teen(client);
    const res = await teenClient.get("/api/repairs");
    expect(res.status).toBe(403);
  });

  test("lists only unresolved issues by default", async () => {
    const { client } = await owner();
    await raiseIssue({ source: "a", key: "1", severity: "warning", title: "Open one", detail: "d" });
    const res = await client.get("/api/repairs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe("POST /api/repairs/:id/fix", () => {
  test("runs the registered fix and resolves the issue", async () => {
    const { client } = await owner();
    let ran = false;
    registerFixHandler("do_it", () => {
      ran = true;
    });
    const issue = await raiseIssue({
      source: "a",
      key: "1",
      severity: "error",
      title: "T",
      detail: "d",
      fix: { label: "Fix it", action: "do_it" },
    });
    const res = await client.post(`/api/repairs/${issue.id}/fix`);
    expect(res.status).toBe(200);
    expect(ran).toBe(true);

    const list = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test("404s for an unknown issue", async () => {
    const { client } = await owner();
    const res = await client.post("/api/repairs/issue-nope/fix");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/repairs/:id/dismiss", () => {
  test("resolves the issue", async () => {
    const { client } = await owner();
    const issue = await raiseIssue({ source: "a", key: "1", severity: "info", title: "T", detail: "d" });
    const res = await client.post(`/api/repairs/${issue.id}/dismiss`);
    expect(res.status).toBe(200);
    const list = (await (await client.get("/api/repairs")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });
});
