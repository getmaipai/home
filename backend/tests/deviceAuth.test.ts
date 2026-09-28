import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => resetDb());

describe("POST /api/auth/devices/redeem", () => {
  test("a valid device token sets a session cookie for whichever address answers", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const { token } = issueDeviceToken(person.id, "tv", "Living room TV");

    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token });
    expect(res.status).toBe(200);

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
  });

  test("401 for an unknown token, and no session cookie is set", async () => {
    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token: "not-a-real-token" });
    expect(res.status).toBe(401);

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  test("403 for a robot device token with no rotated password, and no session cookie is set", async () => {
    // ROBOT-DEVICE-01's own requirement: "a robot with the published
    // password is refused by Home's add flow until it is [rotated]." A
    // code review (2026-09-27) found the prior landing enforced this
    // only in one browser tab's own React state; this is the actual
    // server-side gate - the one place every device token is traded for
    // a working session.
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const { token } = issueDeviceToken(person.id, "robot", "Reachy Mini");

    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("robot_password_unrotated");

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(401);
  });

  test("a robot device token redeems normally once its password is rotated", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const { token, deviceId } = issueDeviceToken(person.id, "robot", "Reachy Mini");
    storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");

    const client = new TestClient();
    const res = await client.post("/api/auth/devices/redeem", { token });
    expect(res.status).toBe(200);

    const me = await client.get("/api/auth/me");
    expect(me.status).toBe(200);
  });
});
