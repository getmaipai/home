import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { startFakeSshd } from "./fixtures/fakeSshd";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { hasRotatedRobotCredential, getRobotCredential } from "@/lib/robotCredentials";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";

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

  test("revokes a robot whose password was rotated, without a foreign-key violation", async () => {
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
    expect(hasRotatedRobotCredential(deviceId)).toBe(false);
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
