import { describe, expect, test, beforeEach } from "bun:test";
import { Person } from "@maipai/spec/gen/ts/person.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

async function ownerClient(): Promise<TestClient> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", {
    displayName: "Sage",
    secret: "correcthorse",
  });
  expect(res.status).toBe(201);
  return client;
}

describe("creating people", () => {
  test("owner can create any role, including another owner", async () => {
    const owner = await ownerClient();
    for (const role of ["owner", "admin", "adult", "teen", "child", "guest"]) {
      const needsSecret = role === "owner" || role === "admin";
      const res = await owner.post("/api/people", {
        displayName: `Test ${role}`,
        role,
        secret: needsSecret ? "correcthorse2" : undefined,
      });
      expect(res.status).toBe(201);
    }
  });

  test("a created person's roster shape validates against the spec, minus birthdate", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const body = (await res.json()) as Record<string, unknown>;
    // Never returned by this API surface (3.1: birthdate is core-only).
    expect(body.birthdate).toBeUndefined();
    // Filling it back in with null (its schema default) must still satisfy
    // Person, proving nothing else drifted from the spec shape.
    expect(() => Person.parse({ ...body, birthdate: null })).not.toThrow();
  });

  test("admin cannot create another admin or an owner", async () => {
    const owner = await ownerClient();
    const adminRes = await owner.post("/api/people", {
      displayName: "Nova",
      role: "admin",
      secret: "correcthorse2",
    });
    expect(adminRes.status).toBe(201);
    const admin = (await adminRes.json()) as { id: string };

    const adminClient = new TestClient();
    const login = await adminClient.post("/api/auth/verify-secret", {
      personId: admin.id,
      secret: "correcthorse2",
    });
    expect(login.status).toBe(200);

    const tryAdmin = await adminClient.post("/api/people", {
      displayName: "Marlow",
      role: "admin",
      secret: "correcthorse3",
    });
    expect(tryAdmin.status).toBe(403);

    const tryOwner = await adminClient.post("/api/people", {
      displayName: "Marsh",
      role: "owner",
      secret: "correcthorse3",
    });
    expect(tryOwner.status).toBe(403);

    const tryChild = await adminClient.post("/api/people", {
      displayName: "Rover",
      role: "child",
    });
    expect(tryChild.status).toBe(201);
  });

  test("non-admin roles cannot create people at all", async () => {
    const owner = await ownerClient();
    const childRes = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await childRes.json()) as { id: string };

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const res = await childClient.post("/api/people", { displayName: "Quill", role: "guest" });
    expect(res.status).toBe(403);
  });

  test("an owner or admin profile without a secret is refused", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/people", { displayName: "Nova", role: "admin" });
    expect(res.status).toBe(400);
  });

  test("an invalid role is refused", async () => {
    const owner = await ownerClient();
    const res = await owner.post("/api/people", { displayName: "Quill", role: "superuser" });
    expect(res.status).toBe(400);
  });
});

describe("listing people", () => {
  test("any signed-in person can see the household roster", async () => {
    const owner = await ownerClient();
    await owner.post("/api/people", { displayName: "Bramble", role: "child" });

    const res = await owner.get("/api/people");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body.every((p) => !("birthdate" in p))).toBe(true);
  });
});
