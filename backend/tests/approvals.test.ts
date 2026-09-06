import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function ownerSession(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  return client;
}

async function makeChild(owner: TestClient, name: string): Promise<{ id: string; client: TestClient }> {
  const res = await owner.post("/api/people", { displayName: name, role: "child" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return { id, client };
}

async function makeAdult(owner: TestClient, name: string): Promise<{ id: string; client: TestClient }> {
  const res = await owner.post("/api/people", { displayName: name, role: "adult" });
  const { id } = (await res.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: id });
  return { id, client };
}

describe("POST /api/approvals", () => {
  test("a child can ask to install a package", async () => {
    const owner = await ownerSession();
    const { client } = await makeChild(owner, "Bramble");
    const res = await client.post("/api/approvals", { kind: "install_package", details: { packageName: "videos" } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; kind: string; personId: string };
    expect(body.status).toBe("pending");
    expect(body.kind).toBe("install_package");
  });

  test("an unknown kind is refused", async () => {
    const owner = await ownerSession();
    const { client } = await makeChild(owner, "Bramble");
    const res = await client.post("/api/approvals", { kind: "ask_for_dessert" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/approvals and deciding", () => {
  test("an adult sees the queue; a child cannot", async () => {
    const owner = await ownerSession();
    const { client: childClient } = await makeChild(owner, "Bramble");
    await childClient.post("/api/approvals", { kind: "browse_url", details: { url: "example.com" } });

    const asOwner = await owner.get("/api/approvals");
    expect(asOwner.status).toBe(200);
    expect(((await asOwner.json()) as unknown[]).length).toBe(1);

    const asChild = await childClient.get("/api/approvals");
    expect(asChild.status).toBe(403);
  });

  test("approving marks it decided, and a second decision is refused", async () => {
    const owner = await ownerSession();
    const { client } = await makeChild(owner, "Bramble");
    const created = (await (await client.post("/api/approvals", { kind: "browse_url", details: { url: "example.com" } })).json()) as { id: string };

    const approve = await owner.request(`/api/approvals/${created.id}/approve`, { method: "POST" });
    expect(approve.status).toBe(200);
    const body = (await approve.json()) as { status: string; decidedByPersonId: string | null };
    expect(body.status).toBe("approved");
    expect(body.decidedByPersonId).not.toBeNull();

    const again = await owner.request(`/api/approvals/${created.id}/deny`, { method: "POST" });
    expect(again.status).toBe(400);
  });

  test("denying marks it decided", async () => {
    const owner = await ownerSession();
    const { client } = await makeChild(owner, "Bramble");
    const created = (await (await client.post("/api/approvals", { kind: "browse_url", details: {} })).json()) as { id: string };
    const deny = await owner.request(`/api/approvals/${created.id}/deny`, { method: "POST" });
    expect(deny.status).toBe(200);
    expect(((await deny.json()) as { status: string }).status).toBe("denied");
  });

  test("an adult who filed the request cannot decide it themselves", async () => {
    const owner = await ownerSession();
    const { client } = await makeAdult(owner, "Marlow");
    const created = (await (await client.post("/api/approvals", { kind: "browse_url", details: {} })).json()) as { id: string };

    const selfApprove = await client.request(`/api/approvals/${created.id}/approve`, { method: "POST" });
    expect(selfApprove.status).toBe(403);

    // Someone else deciding it is still fine.
    const decided = await owner.request(`/api/approvals/${created.id}/approve`, { method: "POST" });
    expect(decided.status).toBe(200);
  });

  test("status filters the queue", async () => {
    const owner = await ownerSession();
    const { client } = await makeChild(owner, "Bramble");
    const a = (await (await client.post("/api/approvals", { kind: "browse_url", details: {} })).json()) as { id: string };
    await client.post("/api/approvals", { kind: "browse_url", details: {} });
    await owner.request(`/api/approvals/${a.id}/approve`, { method: "POST" });

    const pending = (await (await owner.get("/api/approvals?status=pending")).json()) as unknown[];
    expect(pending.length).toBe(1);
    const approved = (await (await owner.get("/api/approvals?status=approved")).json()) as unknown[];
    expect(approved.length).toBe(1);
  });
});
