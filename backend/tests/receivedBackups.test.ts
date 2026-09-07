import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { createDevice } from "@/lib/devices";
import { receivedBackupsDir } from "@/lib/paths";

function resetReceivedDir(): void {
  if (!existsSync(receivedBackupsDir)) return;
  for (const f of readdirSync(receivedBackupsDir)) rmSync(join(receivedBackupsDir, f), { force: true, recursive: true });
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  resetReceivedDir();
});

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

function fakeArchive(): FormData {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "robot-backup.db.enc"));
  return form;
}

describe("POST /api/backups/received", () => {
  test("a device's own backup is stored and listed", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const device = createDevice("robot", "Home robot", me.id);

    const form = fakeArchive();
    form.append("deviceId", device.id);
    const res = await client.postForm("/api/backups/received", form);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { deviceId: string; filename: string; bytes: number };
    expect(body.deviceId).toBe(device.id);
    expect(body.bytes).toBe(4);

    const list = (await (await client.get("/api/backups/received")).json()) as Array<{ deviceId: string }>;
    expect(list.some((b) => b.deviceId === device.id)).toBe(true);
  });

  test("refuses a device that isn't the caller's own", async () => {
    const client = await owner();
    const adultRes = await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const theirDevice = createDevice("robot", "Their robot", adult.id);

    const form = fakeArchive();
    form.append("deviceId", theirDevice.id);
    const res = await client.postForm("/api/backups/received", form);
    expect(res.status).toBe(404);
  });

  test("refuses an unknown deviceId", async () => {
    const client = await owner();
    const form = fakeArchive();
    form.append("deviceId", "device-doesnotexist");
    const res = await client.postForm("/api/backups/received", form);
    expect(res.status).toBe(404);
  });

  test("two devices uploading the same filename never collide", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const deviceA = createDevice("robot", "Robot A", me.id);
    const deviceB = createDevice("robot", "Robot B", me.id);

    const formA = fakeArchive();
    formA.append("deviceId", deviceA.id);
    await client.postForm("/api/backups/received", formA);

    const formB = fakeArchive();
    formB.append("deviceId", deviceB.id);
    await client.postForm("/api/backups/received", formB);

    const list = (await (await client.get("/api/backups/received")).json()) as Array<{ deviceId: string; filename: string }>;
    expect(list.filter((b) => b.filename === "robot-backup.db.enc")).toHaveLength(2);
  });

  test("only sees received backups for one's own devices", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const myDevice = createDevice("robot", "My robot", me.id);
    const form = fakeArchive();
    form.append("deviceId", myDevice.id);
    await client.postForm("/api/backups/received", form);

    const adultRes = await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const list = (await (await adultClient.get("/api/backups/received")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });
});

describe("DELETE /api/backups/received/:id", () => {
  test("removes the row and the file", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const device = createDevice("robot", "Home robot", me.id);
    const form = fakeArchive();
    form.append("deviceId", device.id);
    const created = (await (await client.postForm("/api/backups/received", form)).json()) as { id: string };

    const del = await client.request(`/api/backups/received/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const list = (await (await client.get("/api/backups/received")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test("refuses to delete someone else's received backup", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const device = createDevice("robot", "Home robot", me.id);
    const form = fakeArchive();
    form.append("deviceId", device.id);
    const created = (await (await client.postForm("/api/backups/received", form)).json()) as { id: string };

    const adultRes = await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const del = await adultClient.request(`/api/backups/received/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(404);
  });
});

describe("cleanup on device/person removal", () => {
  test("deleting a device that has pushed a backup does not throw a foreign-key error", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const device = createDevice("robot", "Home robot", me.id);
    const form = fakeArchive();
    form.append("deviceId", device.id);
    await client.postForm("/api/backups/received", form);

    const res = await client.request(`/api/devices/${device.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const list = (await (await client.get("/api/backups/received")).json()) as unknown[];
    expect(list).toHaveLength(0);
  });

  test("memorializing a person whose device pushed a backup does not throw a foreign-key error", async () => {
    const owner_ = await owner();
    const adultRes = await owner_.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });

    const device = createDevice("robot", "Marlow's phone", adult.id);
    const form = fakeArchive();
    form.append("deviceId", device.id);
    await adultClient.postForm("/api/backups/received", form);

    const res = await owner_.request(`/api/people/${adult.id}/memorialize`, { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("storeReceivedBackup() filename safety", () => {
  test("refuses a filename of \"..\" instead of writing outside the device directory", async () => {
    const client = await owner();
    const me = (await (await client.get("/api/auth/me")).json()) as { id: string };
    const device = createDevice("robot", "Home robot", me.id);

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], ".."));
    form.append("deviceId", device.id);
    const res = await client.postForm("/api/backups/received", form);
    expect(res.status).toBe(400);
  });
});
