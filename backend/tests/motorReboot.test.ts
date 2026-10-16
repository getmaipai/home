// ROBOT-SPEC-V1 / MOTOR-REBOOT-CARD: the hub stores the robot's motor reboot offer, an adult answers it on the
// Devices card, and only a yes sends the `motor_reboot` command (and only for the offered, still-latched motors).
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { deviceCommands, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { getDeviceSettingValue } from "@/lib/settings";

beforeEach(() => resetDb());

async function household() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const ownerRow = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const add = async (displayName: string, role: string) => {
    const res = await owner.post("/api/people", role === "adult" ? { displayName, role, secret: "correcthorse2" } : { displayName, role });
    expect(res.status).toBe(201);
    return db.select().from(people).where(eq(people.id, (await res.json() as { id: string }).id)).get()!;
  };
  const adult = await add("Iris", "adult");
  const teen = await add("Tempo", "teen");
  const robotFor = async (personId: string) => {
    const { token, deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
    storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
    const robot = new TestClient();
    expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
    return { robot, deviceId };
  };
  const login = async (personId: string, secret?: string) => {
    const client = new TestClient();
    await client.post("/api/auth/select", { personId });
    if (secret) await client.post("/api/auth/verify-secret", { personId, secret });
    return client;
  };
  return { owner, ownerRow, adult, teen, robotFor, login };
}

const frame = { activity: "idle", muted: false, tracking: true, motors_latched: ["body_yaw", "stewart_3"], motors_stuck: true } as const;
const offerFrame = { ...frame, motors_reboot_offer: ["stewart_3"] };
const commandKinds = (deviceId: string) => db.select().from(deviceCommands).all().filter((r) => r.deviceId === deviceId).map((r) => r.kind);
const stateOf = async (client: TestClient, deviceId: string) =>
  ((await (await client.get("/api/devices")).json()) as Array<{ id: string; state: { motors_reboot_offer?: string[] } | null }>).find((d) => d.id === deviceId)?.state;

describe("motor reboot offer: storage", () => {
  test("the offer on a state frame is stored and returned with the robot's state", async () => {
    const { owner, ownerRow, robotFor } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    expect((await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame })).status).toBe(204);
    expect((await stateOf(owner, deviceId))?.motors_reboot_offer).toEqual(["stewart_3"]);
    await robot.request("/api/devices/me/state", { method: "PUT", body: frame });
    expect((await stateOf(owner, deviceId))?.motors_reboot_offer).toBeUndefined();
  });

  test("an offer naming a motor that is not latched is cut back; the rest of the frame is kept", async () => {
    const { ownerRow, robotFor, owner } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    const res = await robot.request("/api/devices/me/state", { method: "PUT", body: { ...frame, motors_reboot_offer: ["antenna_left", "stewart_3"] } });
    expect(res.status).toBe(204);
    expect((await stateOf(owner, deviceId))?.motors_reboot_offer).toEqual(["stewart_3"]);
    await robot.request("/api/devices/me/state", { method: "PUT", body: { ...frame, motors_latched: [], motors_reboot_offer: ["body_yaw"] } });
    const state = await stateOf(owner, deviceId);
    expect(state?.motors_reboot_offer).toBeUndefined();
    expect(state).toMatchObject({ reachable: true });
    // Even a stored bad offer could not be answered: the command names only offered, still-latched motors.
    expect((await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "yes" })).status).toBe(409);
  });

  test("only an adult sees the offer on the device list; the robot's own session cannot answer it", async () => {
    const { owner, ownerRow, teen, robotFor, login } = await household();
    const { robot, deviceId } = await robotFor(teen.id);
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    const teenClient = await login(teen.id);
    expect((await stateOf(teenClient, deviceId))?.motors_reboot_offer).toBeUndefined();
    expect((await stateOf(teenClient, deviceId))).not.toBeNull();
    const own = await robotFor(ownerRow.id);
    await own.robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    expect((await own.robot.post(`/api/devices/${own.deviceId}/motor-reboot`, { answer: "yes" })).status).toBe(403);
    expect(commandKinds(own.deviceId)).not.toContain("motor_reboot");
    void owner;
  });
});

describe("motor reboot offer: the answer", () => {
  test("no command is sent until an adult says yes; yes sends motor_reboot for the offered motors", async () => {
    const { owner, ownerRow, robotFor } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    expect(commandKinds(deviceId)).not.toContain("motor_reboot");
    const res = await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "yes" });
    expect(res.status).toBe(202);
    const rows = db.select().from(deviceCommands).all().filter((r) => r.kind === "motor_reboot");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload)).toEqual({ motors: ["stewart_3"] });
    expect((await stateOf(owner, deviceId))?.motors_reboot_offer).toBeUndefined();
    // The same offer is not answerable twice.
    const again = await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "yes" });
    expect(again.status).toBe(409);
    expect(commandKinds(deviceId).filter((k) => k === "motor_reboot")).toHaveLength(1);
  });

  test("the command names the stored offer, never what the browser sends", async () => {
    const { owner, ownerRow, robotFor } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "yes", motors: ["body_yaw"] });
    const row = db.select().from(deviceCommands).all().find((r) => r.kind === "motor_reboot")!;
    expect(JSON.parse(row.payload)).toEqual({ motors: ["stewart_3"] });
  });

  test("yes with no offer pending is refused and sends nothing", async () => {
    const { owner, ownerRow, robotFor } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    await robot.request("/api/devices/me/state", { method: "PUT", body: frame });
    const res = await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "yes" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("No motor");
    expect(commandKinds(deviceId)).not.toContain("motor_reboot");
  });

  test("no sends nothing, hides the offer, and keeps it hidden until the robot stops and re-raises it", async () => {
    const { owner, ownerRow, robotFor } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    expect((await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "no" })).status).toBe(204);
    expect(commandKinds(deviceId)).not.toContain("motor_reboot");
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    expect((await stateOf(owner, deviceId))?.motors_reboot_offer).toBeUndefined();
    await robot.request("/api/devices/me/state", { method: "PUT", body: frame });
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    expect((await stateOf(owner, deviceId))?.motors_reboot_offer).toEqual(["stewart_3"]);
    expect(commandKinds(deviceId)).not.toContain("motor_reboot");
  });

  test("a teen cannot answer even on their own robot; a stranger adult does not see the robot; an adult who owns it can", async () => {
    const { owner, adult, teen, robotFor, login } = await household();
    const teenRobot = await robotFor(teen.id);
    await teenRobot.robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    const teenClient = await login(teen.id);
    expect((await teenClient.post(`/api/devices/${teenRobot.deviceId}/motor-reboot`, { answer: "yes" })).status).toBe(403);
    const adultRobot = await robotFor(adult.id);
    await adultRobot.robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    const adultClient = await login(adult.id, "correcthorse2");
    expect((await adultClient.post(`/api/devices/${teenRobot.deviceId}/motor-reboot`, { answer: "yes" })).status).toBe(404);
    expect((await adultClient.post(`/api/devices/${adultRobot.deviceId}/motor-reboot`, { answer: "yes" })).status).toBe(202);
    expect(commandKinds(teenRobot.deviceId)).not.toContain("motor_reboot");
    // an owner/admin may answer for any robot
    expect((await owner.post(`/api/devices/${teenRobot.deviceId}/motor-reboot`, { answer: "yes" })).status).toBe(202);
  });

  test("an unknown answer is refused", async () => {
    const { owner, ownerRow, robotFor } = await household();
    const { robot, deviceId } = await robotFor(ownerRow.id);
    await robot.request("/api/devices/me/state", { method: "PUT", body: offerFrame });
    expect((await owner.post(`/api/devices/${deviceId}/motor-reboot`, { answer: "maybe" })).status).toBe(400);
    expect(commandKinds(deviceId)).not.toContain("motor_reboot");
  });
});

describe("robot.sleep.auto", () => {
  test("defaults on, only an admin changes it, and the change reaches the robot as settings_changed", async () => {
    const { owner, ownerRow, adult, robotFor, login } = await household();
    const { deviceId } = await robotFor(ownerRow.id);
    expect(getDeviceSettingValue(deviceId, "robot.sleep.auto")).toBe(true);
    const adultClient = await login(adult.id, "correcthorse2");
    const refused = await adultClient.request("/api/settings", { method: "PUT", body: { scope: `device:${deviceId}`, key: "robot.sleep.auto", value: false } });
    expect(refused.status).toBe(403);
    expect(commandKinds(deviceId)).not.toContain("settings_changed");
    const ok = await owner.request("/api/settings", { method: "PUT", body: { scope: `device:${deviceId}`, key: "robot.sleep.auto", value: false } });
    expect(ok.status).toBe(200);
    const row = db.select().from(deviceCommands).all().find((r) => r.deviceId === deviceId && r.kind === "settings_changed")!;
    expect(JSON.parse(row.payload)).toEqual({ values: { "robot.sleep.auto": false } });
    expect(getDeviceSettingValue(deviceId, "robot.sleep.auto")).toBe(false);
    void adult;
  });
});
