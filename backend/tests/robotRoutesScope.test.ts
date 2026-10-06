import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { robotSessionMayReach } from "@/middleware/auth";

beforeEach(() => resetDb());

async function ownerSession(): Promise<{ client: TestClient; personId: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  const person = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, personId: person.id };
}

async function deviceSession(personId: string, kind: "robot" | "tv"): Promise<TestClient> {
  const { token, deviceId } = issueDeviceToken(personId, kind, "Test device");
  if (kind === "robot") storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
  const client = new TestClient();
  expect((await client.post("/api/auth/devices/redeem", { token })).status).toBe(200);
  return client;
}

describe("ROBOT-ROUTES-01: a robot's session is scoped to its own routes", () => {
  test("a robot session gets 403 on routes a robot has no reason to call", async () => {
    const { personId } = await ownerSession();
    const robot = await deviceSession(personId, "robot");
    for (const path of ["/api/people", "/api/settings", "/api/conversations", "/api/backups", "/api/auth/sessions"]) {
      expect(`${path} ${(await robot.get(path)).status}`).toBe(`${path} 403`);
    }
  });

  test("a robot session gets 403 on the right path with the wrong method", async () => {
    const { personId } = await ownerSession();
    const robot = await deviceSession(personId, "robot");
    expect((await robot.get("/api/devices")).status).toBe(403);
    expect((await robot.request("/api/auth/quick-connect/approve", { method: "POST", body: { code: "ABCDEF" } })).status).toBe(403);
    expect((await robot.request("/api/auth/logout", { method: "POST" })).status).toBe(403);
    expect((await robot.request("/api/people", { method: "POST", body: { displayName: "Nova" } })).status).toBe(403);
  });

  test("a robot session still reaches turn, cancel, stt, tts, its state report and its prints sync", async () => {
    const { personId } = await ownerSession();
    const robot = await deviceSession(personId, "robot");
    const state = await robot.request("/api/devices/me/state", { method: "PUT", body: { activity: "idle", muted: false, tracking: false } });
    expect(state.status).toBe(204);
    // Reaching the route is the claim: the gate must not answer 403. The
    // route's own answer (a 400 for an empty body, a 404 for an unknown
    // turn) is whatever it always was.
    const reached = [
      await robot.request("/api/turn", { method: "POST", body: {} }),
      await robot.request("/api/turn/stream", { method: "POST", body: {} }),
      await robot.request("/api/turn/no-such-turn/cancel", { method: "POST" }),
      await robot.request("/api/stt/transcribe", { method: "POST", body: {} }),
      await robot.request("/api/tts", { method: "POST", body: {} }),
      await robot.get("/api/devices/me/assets"),
      await robot.get("/api/devices/me/assets/unknown-asset"),
    ];
    for (const res of reached) expect([401, 403]).not.toContain(res.status);
  });

  test("a person's session and a non-robot device session are not scoped", async () => {
    const { client: owner, personId } = await ownerSession();
    const tv = await deviceSession(personId, "tv");
    expect((await owner.get("/api/people")).status).toBe(200);
    expect((await tv.get("/api/people")).status).toBe(200);
  });

  test("a revoked robot's session is 401, not a scope answer", async () => {
    const { client: owner, personId } = await ownerSession();
    const { token, deviceId } = issueDeviceToken(personId, "robot", "Test device");
    storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
    const robot = new TestClient();
    await robot.post("/api/auth/devices/redeem", { token });
    expect((await owner.request(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(200);
    expect((await robot.get("/api/people")).status).toBe(401);
  });
});

describe("robotSessionMayReach", () => {
  test("admits exactly the listed method and path pairs", () => {
    expect(robotSessionMayReach("POST", "/api/turn")).toBe(true);
    expect(robotSessionMayReach("POST", "/api/turn/stream")).toBe(true);
    expect(robotSessionMayReach("POST", "/api/turn/abc/cancel")).toBe(true);
    expect(robotSessionMayReach("POST", "/api/tts")).toBe(true);
    expect(robotSessionMayReach("GET", "/api/stt/stream")).toBe(true);
    expect(robotSessionMayReach("GET", "/api/devices/me/assets")).toBe(true);
    expect(robotSessionMayReach("GET", "/api/devices/me/assets/example-model")).toBe(true);
  });

  test("refuses lookalikes and siblings", () => {
    expect(robotSessionMayReach("POST", "/api/turn/bare")).toBe(false);
    expect(robotSessionMayReach("POST", "/api/turn/a/b/cancel")).toBe(false);
    expect(robotSessionMayReach("GET", "/api/turn")).toBe(false);
    expect(robotSessionMayReach("POST", "/api/tts/voices")).toBe(false);
    expect(robotSessionMayReach("GET", "/api/people")).toBe(false);
    expect(robotSessionMayReach("GET", "/api/devices/me/assets/one/two")).toBe(false);
    expect(robotSessionMayReach("PUT", "/api/devices/me/state/../../people")).toBe(false);
  });
});
