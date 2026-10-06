import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { startFakeSshd } from "./fixtures/fakeSshd";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { hasRotatedRobotCredential, getRobotCredential, storeRobotCredential } from "@/lib/robotCredentials";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setHouseholdSettingValue } from "@/lib/settings";
import { privacyConnections } from "@/lib/privacy";
import { getHubInstanceId } from "@/lib/hubIdentity";
import { addManagedEndpoint } from "@/lib/hubEndpoints";

beforeEach(() => resetDb());

async function owner(): Promise<{ client: TestClient; personId: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const person = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, personId: person.id };
}

describe("GET /api/devices", () => {
  test("requires auth", async () => {
    const anon = new TestClient();
    const res = await anon.get("/api/devices");
    expect(res.status).toBe(401);
  });

  test("lists only devices paired to me", async () => {
    const { client, personId } = await owner();
    issueDeviceToken(personId, "tv", "Living room TV");

    const res = await client.get("/api/devices");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; kind: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.name).toBe("Living room TV");
    expect(body[0]!.kind).toBe("tv");
  });
});

describe("GET /api/devices/me/hub-endpoints", () => {
  test("requires a paired robot device session", async () => {
    const anon = new TestClient();
    expect((await anon.get("/api/devices/me/hub-endpoints")).status).toBe(401);
    const { personId } = await owner();
    const { token } = issueDeviceToken(personId, "phone", "Phone");
    const phone = new TestClient();
    await phone.post("/api/auth/devices/redeem", { token });
    expect((await phone.get("/api/devices/me/hub-endpoints")).status).toBe(403);
  });

  test("always returns LAN endpoints and filters every overlay endpoint while opt-in is off", async () => {
    const { personId } = await owner();
    addManagedEndpoint("Tailnet", "https://hub.example.ts.net");
    const { token, deviceId } = issueDeviceToken(personId, "robot", "Reachy");
    storeRobotCredential(deviceId, "test-host", "pollen", "rotated-test-password");
    const robot = new TestClient();
    expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
    setHouseholdSettingValue("robot.offlan.tailnet", false);
    const response = await robot.get("/api/devices/me/hub-endpoints");
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ kind: string; url: string; instanceId: string }>;
    expect(body.some((endpoint) => endpoint.kind === "lan")).toBe(true);
    expect(body.some((endpoint) => endpoint.kind === "overlay" || endpoint.url.includes(".ts.net") || endpoint.url.match(/^https?:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./))).toBe(false);
  });

  test("includes overlay endpoints with the stable hub instance id when opted in", async () => {
    const { personId } = await owner();
    addManagedEndpoint("Tailnet", "https://hub.example.ts.net");
    const { token, deviceId } = issueDeviceToken(personId, "robot", "Reachy");
    storeRobotCredential(deviceId, "test-host", "pollen", "rotated-test-password");
    const robot = new TestClient();
    expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
    setHouseholdSettingValue("robot.offlan.tailnet", true);
    const response = await robot.get("/api/devices/me/hub-endpoints");
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ kind: string; url: string; instanceId: string }>;
    expect(body.some((endpoint) => endpoint.kind === "overlay" && endpoint.url === "https://hub.example.ts.net")).toBe(true);
    expect(body.filter((endpoint) => endpoint.kind === "overlay").every((endpoint) => endpoint.instanceId === getHubInstanceId())).toBe(true);
  });

  test("the privacy table explains robot endpoint sharing", () => {
    const row = privacyConnections().find((connection) => connection.id === "platform:robot-hub-endpoints");
    expect(row?.direction).toBe("inbound");
    expect(row?.when).toContain("paired robot");
    expect(row?.what).toContain("LAN addresses");
    expect(row?.what).toContain("tailnet");
  });
});

describe("PUT /api/devices/me/state", () => {
  test("accepts spec motion fields and returns them from the device projection", async () => {
    const { client, personId } = await owner();
    const { deviceId, token } = issueDeviceToken(personId, "robot", "Reachy");
    storeRobotCredential(deviceId, "test-host", "pollen", "rotated-test-password");
    const robot = new TestClient();
    await robot.post("/api/auth/devices/redeem", { token });
    const response = await robot.put("/api/devices/me/state", {
      activity: "idle", muted: false, tracking: true, motion: "held", put_down_count: 3,
    });
    expect(response.status).toBe(204);
    const state = (await client.get("/api/devices").then((r) => r.json()) as Array<{ id: string; state: { motion: string | null; put_down_count?: number } }>).find((d) => d.id === deviceId)?.state;
    expect(state?.motion).toBe("held");
    expect(state?.put_down_count).toBe(3);
  });

  test("accepts null motion and frames that omit both new fields", async () => {
    const { personId } = await owner();
    const { deviceId, token } = issueDeviceToken(personId, "robot", "Reachy");
    storeRobotCredential(deviceId, "test-host", "pollen", "rotated-test-password");
    const robot = new TestClient();
    const redeemed = await robot.post("/api/auth/devices/redeem", { token });
    expect(redeemed.status).toBe(200);
    for (const frame of [
      { activity: "idle", muted: false, tracking: true, motion: null },
      { activity: "idle", muted: false, tracking: true },
    ]) {
      expect((await robot.put("/api/devices/me/state", frame)).status).toBe(204);
    }
  });
});

describe("DELETE /api/devices/:id", () => {
  test("revokes a device I own", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "phone", "My phone");

    const res = await client.request(`/api/devices/${deviceId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await client.get("/api/devices").then((r) => r.json())).toEqual([]);
  });

  test("404 for a device that isn't mine", async () => {
    const { client } = await owner();
    const res = await client.request("/api/devices/device-doesnotexist", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("revokes a robot whose password was rotated, without a foreign-key violation, and the credential survives for a future re-pair", async () => {
    // A code review (2026-09-28) changed this from the credential being
    // deleted alongside the device (the original 2026-09-27 fix for the
    // FK violation) to it deliberately surviving: robot_credentials.
    // device_id is no longer a foreign key at all, precisely so a
    // rotated password isn't lost the moment its device row is revoked -
    // 1.8's own fix needs the row to still be there for a future
    // getMostRecentRobotCredentialForHost(host) lookup.
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 0 }),
    });
    try {
      await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: sshd.port,
        sshUsername: "pollen",
        currentPassword: "reachy-default",
      });
    } finally {
      await sshd.close();
    }
    expect(hasRotatedRobotCredential(deviceId)).toBe(true);

    const res = await client.request(`/api/devices/${deviceId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(hasRotatedRobotCredential(deviceId)).toBe(true);
  });
});

describe("GET /api/devices/robots", () => {
  test("requires admin", async () => {
    const { client: ownerClient, personId } = await owner();
    const adultRes = await ownerClient.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    issueDeviceToken(personId, "robot", "Reachy Mini");

    const res = await adultClient.get("/api/devices/robots");
    expect(res.status).toBe(403);
  });

  test("lists a robot household-wide, even for an admin who didn't pair it", async () => {
    const { client: ownerClient, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    issueDeviceToken(personId, "tv", "Living room TV");
    const adminRes = await ownerClient.post("/api/people", { displayName: "Marlow", role: "admin", secret: "0000" });
    const admin = (await adminRes.json()) as { id: string };
    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "0000" });

    const res = await adminClient.get("/api/devices/robots");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; kind: string }>;
    expect(body).toEqual([expect.objectContaining({ id: deviceId, kind: "robot" })]);
  });
});

describe("POST /api/devices/:id/rotate-robot-password", () => {
  test("requires auth", async () => {
    const res = await new TestClient().post("/api/devices/device-x/rotate-robot-password", {
      host: "127.0.0.1",
      currentPassword: "x",
    });
    expect(res.status).toBe(401);
  });

  test("404 for an unknown device", async () => {
    const { client } = await owner();
    const res = await client.post("/api/devices/device-doesnotexist/rotate-robot-password", {
      host: "127.0.0.1",
      currentPassword: "x",
    });
    expect(res.status).toBe(404);
  });

  test("400 for a device that isn't a robot", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "tv", "Living room TV");
    const res = await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
      host: "127.0.0.1",
      currentPassword: "x",
    });
    expect(res.status).toBe(400);
  });

  test("rotates a real robot's password over a real SSH connection and stores it encrypted", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    let receivedStdin = "";
    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: (stdin) => {
        receivedStdin = stdin;
        return { code: 0 };
      },
    });

    try {
      expect(hasRotatedRobotCredential(deviceId)).toBe(false);

      const res = await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: sshd.port,
        sshUsername: "pollen",
        currentPassword: "reachy-default",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: true; rotatedAt: string };
      expect(body.success).toBe(true);

      expect(hasRotatedRobotCredential(deviceId)).toBe(true);
      const stored = getRobotCredential(deviceId)!;
      expect(receivedStdin).toBe(`pollen:${stored.password}`);
      // The response body never carries the password itself.
      expect(JSON.stringify(body)).not.toContain(stored.password);
    } finally {
      await sshd.close();
    }
  });

  test("a wrong default password is refused and nothing is stored", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 0 }),
    });

    try {
      const res = await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: sshd.port,
        sshUsername: "pollen",
        currentPassword: "wrong-password",
      });
      expect(res.status).toBe(400);
      expect(hasRotatedRobotCredential(deviceId)).toBe(false);
    } finally {
      await sshd.close();
    }
  });

  test("'Rotate again' needs no password typed - the server tries the device's own stored credential first", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    const firstSshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 0 }),
    });
    try {
      await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: firstSshd.port,
        sshUsername: "pollen",
        currentPassword: "reachy-default",
      });
    } finally {
      await firstSshd.close();
    }
    const firstRotated = getRobotCredential(deviceId)!.password;

    // The robot's real password is now whatever the first rotation set -
    // a second fake sshd stands in for the same unit, now only accepting
    // that password, never the original vendor default again.
    const secondSshd = await startFakeSshd({
      username: "pollen",
      password: firstRotated,
      onCommand: () => ({ code: 0 }),
    });
    try {
      const res = await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: secondSshd.port,
        sshUsername: "pollen",
        // No currentPassword at all.
      });
      expect(res.status).toBe(200);
      expect(getRobotCredential(deviceId)!.password).not.toBe(firstRotated);
    } finally {
      await secondSshd.close();
    }
  });

  test("re-pairing a revoked robot at the same host succeeds with no password typed, using the credential its predecessor left behind", async () => {
    // ROBOT-DEVICE-01's own bug (a code review, 2026-09-27): revoke a
    // rotated robot and re-pair the same physical unit, and the new
    // device row's own rotation used to demand the vendor default, which
    // no longer opens a unit whose password was already changed - the
    // only way out was a factory reflash. This is the fix's own
    // acceptance test.
    const { client, personId } = await owner();
    const { deviceId: firstDeviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    const firstSshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 0 }),
    });
    try {
      await client.post(`/api/devices/${firstDeviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: firstSshd.port,
        sshUsername: "pollen",
        currentPassword: "reachy-default",
      });
    } finally {
      await firstSshd.close();
    }
    const rotatedPassword = getRobotCredential(firstDeviceId)!.password;

    const revokeRes = await client.request(`/api/devices/${firstDeviceId}`, { method: "DELETE" });
    expect(revokeRes.status).toBe(200);

    // The same physical unit, re-paired: a brand-new device row that has
    // never itself been rotated.
    const { deviceId: secondDeviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    expect(hasRotatedRobotCredential(secondDeviceId)).toBe(false);

    const secondSshd = await startFakeSshd({
      username: "pollen",
      password: rotatedPassword,
      onCommand: () => ({ code: 0 }),
    });
    try {
      const res = await client.post(`/api/devices/${secondDeviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: secondSshd.port,
        sshUsername: "pollen",
        // No currentPassword: the admin doesn't know the last rotation's
        // password, only the hub does.
      });
      expect(res.status).toBe(200);
      expect(hasRotatedRobotCredential(secondDeviceId)).toBe(true);
    } finally {
      await secondSshd.close();
    }
  });

  test("a non-admin adult is refused: rotating credentials is a household admin action", async () => {
    const { client: ownerClient, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    const adultRes = await ownerClient.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const res = await adultClient.post(`/api/devices/${deviceId}/rotate-robot-password`, {
      host: "127.0.0.1",
      currentPassword: "x",
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/devices/:id/robot-password-status", () => {
  test("400 for a device that isn't a robot", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "tv", "Living room TV");
    const res = await client.get(`/api/devices/${deviceId}/robot-password-status`);
    expect(res.status).toBe(400);
  });

  test("false before rotation, true after", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");

    const before = await client.get(`/api/devices/${deviceId}/robot-password-status`);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ rotated: false });

    const sshd = await startFakeSshd({
      username: "pollen",
      password: "reachy-default",
      onCommand: () => ({ code: 0 }),
    });
    try {
      await client.post(`/api/devices/${deviceId}/rotate-robot-password`, {
        host: "127.0.0.1",
        port: sshd.port,
        sshUsername: "pollen",
        currentPassword: "reachy-default",
      });
    } finally {
      await sshd.close();
    }

    const after = await client.get(`/api/devices/${deviceId}/robot-password-status`);
    expect(await after.json()).toEqual({ rotated: true });
  });
});
