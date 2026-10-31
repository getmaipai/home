import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { startFakeSshd } from "./fixtures/fakeSshd";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { hasRotatedRobotCredential, getRobotCredential, storeRobotCredential } from "@/lib/robotCredentials";
import { db } from "@/db";
import { people, memoryRecords, memoryEmbeddings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setHouseholdSettingValue } from "@/lib/settings";
import { privacyConnections } from "@/lib/privacy";
import { getHubInstanceId } from "@/lib/hubIdentity";
import { addManagedEndpoint } from "@/lib/hubEndpoints";
import { getDeviceById } from "@/lib/devices";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { buildStablePrefix } from "@/lib/turnShared";

beforeEach(() => { resetDb(); setHouseholdSettingValue("home.robots.enabled", true); });

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

  test("filters by kind, keeps the unfiltered list, and rejects unknown kinds", async () => {
    const { client, personId } = await owner();
    const robot = issueDeviceToken(personId, "robot", "StackChan");
    issueDeviceToken(personId, "tv", "Living room TV");

    const filtered = await client.get("/api/devices?kind=robot");
    expect(filtered.status).toBe(200);
    expect((await filtered.json() as Array<{ id: string; kind: string }>)).toEqual([
      expect.objectContaining({ id: robot.deviceId, kind: "robot" }),
    ]);

    const all = await client.get("/api/devices");
    expect(all.status).toBe(200);
    expect(await all.json()).toHaveLength(2);

    const invalid = await client.get("/api/devices?kind=unknown");
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("content-type")).toContain("application/json");
    expect(await invalid.json()).toHaveProperty("error");
  });
});

describe("robot names", () => {
  test("pairing suffixes duplicate robot names, but a TV may share the name", async () => {
    const { client, personId } = await owner();
    const first = issueDeviceToken(personId, "robot", "StackChan");
    const second = issueDeviceToken(personId, "robot", "StackChan");
    const tv = issueDeviceToken(personId, "tv", "StackChan");
    expect((await client.get("/api/devices").then((r) => r.json()) as Array<{ id: string; name: string }>).map(({ id, name }) => ({ id, name })))
      .toEqual(expect.arrayContaining([
        { id: first.deviceId, name: "StackChan" },
        { id: second.deviceId, name: "StackChan 2" },
        { id: tv.deviceId, name: "StackChan" },
      ]));
  });

  test("rename refuses another robot's name with the existing name in its message, and allows own name", async () => {
    const { client, personId } = await owner();
    const first = issueDeviceToken(personId, "robot", "StackChan");
    const second = issueDeviceToken(personId, "robot", "Rover");
    const refused = await client.request(`/api/devices/${second.deviceId}`, { method: "PATCH", body: { name: " stackchan " } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Another robot is already called StackChan. Pick a different name." });
    const allowed = await client.request(`/api/devices/${first.deviceId}`, { method: "PATCH", body: { name: " stackchan " } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ id: first.deviceId, name: "stackchan" });
    const renamedRobot = getDeviceById(first.deviceId)!;
    expect(buildStablePrefix(DEFAULT_PERSONA, "spoken", "", renamedRobot.name)).toStartWith("You are stackchan, a private, self-hosted AI assistant for this household.");
  });
});

describe("PATCH /api/devices/:id", () => {
  test("admin changes a robot name and area, clears the area, and returns 404 for an unknown id", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Old name");
    let response = await client.request(`/api/devices/${deviceId}`, { method: "PATCH", body: { name: "  StackChan  ", area: "  Kitchen  " } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: deviceId, name: "StackChan", area: "Kitchen" });
    response = await client.request(`/api/devices/${deviceId}`, { method: "PATCH", body: { area: null } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ area: null });
    response = await client.request("/api/devices/device-unknown", { method: "PATCH", body: { name: "Robot" } });
    expect(response.status).toBe(404);
  });

  test("rejects a non-admin and a 61-character name with the plain validation message", async () => {
    const { client: admin, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "robot", "Robot");
    const response = await admin.request(`/api/devices/${deviceId}`, { method: "PATCH", body: { name: "x".repeat(61) } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "A name is 1 to 60 characters." });
    const adult = new TestClient();
    const adultRes = await admin.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adultRow = await adultRes.json() as { id: string };
    await adult.post("/api/auth/select", { personId: adultRow.id });
    await adult.post("/api/auth/verify-secret", { personId: adultRow.id, secret: "0000" });
    expect((await adult.request(`/api/devices/${deviceId}`, { method: "PATCH", body: { name: "Robot" } })).status).toBe(403);
  });
});

describe("robot socket address", () => {
  test("stores the socket peer despite x-forwarded-for and exposes it only to an admin", async () => {
    const { client: admin, personId } = await owner();
    const { deviceId, token } = issueDeviceToken(personId, "robot", "Robot");
    storeRobotCredential(deviceId, "192.0.2.44", "robot", "a-freshly-rotated-password");
    const robot = new TestClient("192.0.2.44");
    await robot.post("/api/auth/devices/redeem", { token });
    expect((await robot.get("/api/devices/me/hub-endpoints", { "x-forwarded-for": "203.0.113.9" })).status).toBe(200);
    const rows = await admin.get("/api/devices/robots").then((response) => response.json()) as Array<{ id: string; ipAddress?: string }>;
    expect(rows.find((row) => row.id === deviceId)?.ipAddress).toBe("192.0.2.44");
    const adultRes = await admin.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const { id } = await adultRes.json() as { id: string };
    const adult = new TestClient();
    await adult.post("/api/auth/select", { personId: id });
    await adult.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
    const personal = await adult.get("/api/devices").then((response) => response.json()) as Array<Record<string, unknown>>;
    expect(personal.every((row) => !("ipAddress" in row))).toBe(true);
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

  test("stores and returns motor and thermal health (spec-v0.1.147)", async () => {
    const { personId, client } = await owner();
    const { deviceId, token } = issueDeviceToken(personId, "robot", "Reachy");
    storeRobotCredential(deviceId, "test-host", "pollen", "rotated-test-password");
    const robot = new TestClient();
    await robot.post("/api/auth/devices/redeem", { token });
    const response = await robot.put("/api/devices/me/state", {
      activity: "idle", muted: false, tracking: true,
      motors_latched: ["antenna_left"], motors_stuck: true, thermal: { level: "vision_slowed", temp_c: 71.5, vision_hz: 2, fault: false },
    });
    expect(response.status).toBe(204);
    const state = (await client.get("/api/devices").then((r) => r.json()) as Array<{ id: string; state: Record<string, unknown> }>).find((d) => d.id === deviceId)?.state;
    expect(state?.motors_latched).toEqual(["antenna_left"]);
    expect(state?.motors_stuck).toBe(true);
    expect(state?.thermal).toMatchObject({ level: "vision_slowed", temp_c: 71.5, vision_hz: 2, fault: false });
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
  test("deletes only memories bound to the forgotten robot", async () => {
    const { client, personId } = await owner();
    const a = issueDeviceToken(personId, "robot", "Rover").deviceId;
    const b = issueDeviceToken(personId, "robot", "Bruno").deviceId;
    const person = db.select().from(people).where(eq(people.id, personId)).get()!;
    const { remember } = await import("@/lib/memory");
    const joke = remember(person, { text: "Rover's private moon joke", category: "fact", tier: "durable", scope: "person", person: personId, device_id: a, source: "test", importance: 0.8 });
    // An embedding row references the record; Forget must clear it first or the delete fails.
    if (joke.ok) db.insert(memoryEmbeddings).values({ memoryId: joke.value.id, space: "test", dims: 1, vector: Buffer.from(new Float32Array([1]).buffer), hlc: "1:0:aaaaaa" }).run();
    remember(person, { text: "Bruno's private moon joke", category: "fact", tier: "durable", scope: "person", person: personId, device_id: b, source: "test", importance: 0.8 });
    remember(person, { text: "The family celebrates in May", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.8 });
    const res = await client.request(`/api/devices/${a}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const rows = db.select().from(memoryRecords).all();
    expect(rows.some((r) => r.deviceId === a)).toBe(false);
    expect(rows.some((r) => r.deviceId === b)).toBe(true);
    expect(rows.some((r) => r.deviceId === null)).toBe(true);
  });
  test("revokes a device I own", async () => {
    const { client, personId } = await owner();
    const { deviceId } = issueDeviceToken(personId, "phone", "My phone");

    const res = await client.request(`/api/devices/${deviceId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await client.get("/api/devices").then((r) => r.json())).toEqual([]);
  });

  test("an admin who did not pair a robot may forget it; an adult may not; a phone stays its owner's", async () => {
    const { client: ownerClient, personId } = await owner();
    const robot = issueDeviceToken(personId, "robot", "Reachy Mini").deviceId;
    const phone = issueDeviceToken(personId, "phone", "Sage phone").deviceId;
    const signIn = async (displayName: string, role: string) => {
      const created = (await (await ownerClient.post("/api/people", { displayName, role, secret: "0000" })).json()) as { id: string };
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
      return client;
    };
    const adult = await signIn("Quill", "adult");
    const admin = await signIn("Marlow", "admin");
    expect((await adult.request(`/api/devices/${robot}`, { method: "DELETE" })).status).toBe(404);
    expect((await admin.request(`/api/devices/${phone}`, { method: "DELETE" })).status).toBe(404);
    expect((await admin.request(`/api/devices/${robot}`, { method: "DELETE" })).status).toBe(200);
    expect(getDeviceById(robot)).toBeNull();
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
  test("any signed-in person sees every robot and its owner, without its IP address; a stranger is refused", async () => {
    const { client: ownerClient, personId } = await owner();
    const robot = issueDeviceToken(personId, "robot", "Reachy Mini").deviceId;
    const signIn = async (displayName: string, role: string) => {
      const created = (await (await ownerClient.post("/api/people", { displayName, role, secret: "0000" })).json()) as { id: string };
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
      return client;
    };
    expect((await new TestClient().get("/api/devices/robots")).status).toBe(401);
    for (const role of ["child", "teen", "adult"]) {
      const body = (await (await (await signIn(`Kid ${role}`, role)).get("/api/devices/robots")).json()) as Array<{ id: string; ownerName?: string; ipAddress?: string }>;
      expect(body).toEqual([expect.objectContaining({ id: robot, ownerName: "Sage" })]);
      expect(body[0]!.ipAddress).toBeUndefined();
    }
    expect((await (await ownerClient.get("/api/devices/robots")).json() as Array<{ ownerName?: string }>)[0]!.ownerName).toBe("Sage");
  });

  test("an adult may mute someone else's robot but not unmute it; a child may do neither", async () => {
    const { client: ownerClient, personId } = await owner();
    const robot = issueDeviceToken(personId, "robot", "Reachy Mini").deviceId;
    const signIn = async (displayName: string, role: string) => {
      const created = (await (await ownerClient.post("/api/people", { displayName, role, secret: "0000" })).json()) as { id: string };
      const client = new TestClient();
      await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
      return client;
    };
    const adult = await signIn("Quill", "adult");
    const child = await signIn("Nova", "child");
    expect((await adult.post(`/api/devices/${robot}/commands`, { kind: "mute" })).status).toBe(202);
    expect((await adult.post(`/api/devices/${robot}/commands`, { kind: "unmute" })).status).toBe(404);
    expect((await child.post(`/api/devices/${robot}/commands`, { kind: "mute" })).status).toBe(404);
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
