import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { deviceStates, people } from "@/db/schema";
import { deleteDevice } from "@/lib/devices";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";

beforeEach(() => resetDb());

async function ownerSession(): Promise<{ client: TestClient; personId: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(res.status).toBe(201);
  const person = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, personId: person.id };
}

async function deviceSession(personId: string, kind: "robot" | "tv" = "robot"): Promise<{ client: TestClient; deviceId: string }> {
  const { token, deviceId } = issueDeviceToken(personId, kind, "Test device");
  if (kind === "robot") storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
  const client = new TestClient();
  const res = await client.post("/api/auth/devices/redeem", { token });
  expect(res.status).toBe(200);
  return { client, deviceId };
}

const frame = {
  activity: "listening",
  muted: false,
  tracking: true,
  on_battery: null,
  battery_level: 0.73,
  daemon_version: "1.2.3",
} as const;

describe("PUT /api/devices/me/state", () => {
  test("a robot report is stored and returned by both device list routes", async () => {
    const { client: owner, personId } = await ownerSession();
    const { client: robot, deviceId } = await deviceSession(personId);
    const sent = await robot.request("/api/devices/me/state", { method: "PUT", body: frame });
    expect(sent.status).toBe(204);

    const ownDevices = (await (await owner.get("/api/devices")).json()) as Array<{ id: string; state: Record<string, unknown> | null }>;
    const robots = (await (await owner.get("/api/devices/robots")).json()) as Array<{ id: string; state: Record<string, unknown> | null }>;
    const state = ownDevices.find((device) => device.id === deviceId)?.state;
    expect(state).toMatchObject({ ...frame, reachable: true, unreachableSince: null });
    expect(robots.find((device) => device.id === deviceId)?.state).toEqual(state);
    expect(db.select().from(deviceStates).where(eq(deviceStates.deviceId, deviceId)).get()?.reportedAt).toBeString();
  });

  test("a person's session gets 403", async () => {
    const { client } = await ownerSession();
    expect((await client.request("/api/devices/me/state", { method: "PUT", body: frame })).status).toBe(403);
  });

  test("a non-robot device session gets 403", async () => {
    const { personId } = await ownerSession();
    const { client } = await deviceSession(personId, "tv");
    expect((await client.request("/api/devices/me/state", { method: "PUT", body: frame })).status).toBe(403);
  });

  test("a stale report is unreachable since its hub-stamped report time", async () => {
    const { client: owner, personId } = await ownerSession();
    const { client: robot, deviceId } = await deviceSession(personId);
    await robot.request("/api/devices/me/state", { method: "PUT", body: frame });
    const reportedAt = new Date(Date.now() - 60_000).toISOString();
    db.update(deviceStates).set({ reportedAt }).where(eq(deviceStates.deviceId, deviceId)).run();

    const robots = (await (await owner.get("/api/devices/robots")).json()) as Array<{ id: string; state: { reachable: boolean; unreachableSince: string | null } | null }>;
    expect(robots.find((device) => device.id === deviceId)?.state).toMatchObject({ reachable: false, unreachableSince: reportedAt });
  });

  test("deleting a device cascades to its state row", async () => {
    const { personId } = await ownerSession();
    const { client: robot, deviceId } = await deviceSession(personId);
    await robot.request("/api/devices/me/state", { method: "PUT", body: frame });
    expect(db.select().from(deviceStates).where(eq(deviceStates.deviceId, deviceId)).get()).toBeDefined();

    expect(deleteDevice(deviceId, personId)).toBe(true);
    expect(db.select().from(deviceStates).where(eq(deviceStates.deviceId, deviceId)).get()).toBeUndefined();
  });

  test("an invalid activity enum gets 400", async () => {
    const { personId } = await ownerSession();
    const { client: robot } = await deviceSession(personId);
    expect((await robot.request("/api/devices/me/state", { method: "PUT", body: { ...frame, activity: "dancing" } })).status).toBe(400);
  });
});
