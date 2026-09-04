import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

describe("POST /api/safety/check", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/safety/check", { text: "hello" });
    expect(res.status).toBe(401);
  });

  test("rejects a missing text field", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/safety/check", {});
    expect(res.status).toBe(400);
  });

  test("evaluates the caller's own text and never echoes it back", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });

    const res = await owner.post("/api/safety/check", {
      text: "I want to kill myself",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(true);
    expect(body.categories).toEqual(["self_harm"]);
    expect(body.action).toBe("allow_with_resources");
    expect(JSON.stringify(body)).not.toContain("kill myself");
  });

  test("uses the signed-in person's own role for the minor context", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });

    const res = await childClient.post("/api/safety/check", {
      text: "This is our secret, don't tell your parents",
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(true);
    expect(body.categories).toEqual(["grooming"]);
    expect(body.notify_parent).toBe(true);
  });

  test("returns allow for benign text", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const res = await owner.post("/api/safety/check", { text: "What's the weather like" });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.flagged).toBe(false);
    expect(body.action).toBe("allow");
  });
});
