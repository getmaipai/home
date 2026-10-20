import { beforeEach, describe, expect, test } from "bun:test";
import { setHouseholdSettingValue } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { app } from "@/app";
import { db, sqlite } from "@/db";
import { deviceCommands, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { upsertDeviceState } from "@/lib/deviceStates";
import { startRobotSelfTest, __setRobotSelfTestTimeoutForTests } from "@/lib/robotSelfTestRuns";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => { resetDb(); setHouseholdSettingValue("home.robots.enabled", true); });

async function setup(capabilities = ["speaker", "eyes", "head_pan_tilt", "lights", "mic", "no_vendor_login"]): Promise<{ admin: TestClient; robot: TestClient; deviceId: string; personId: string }> {
  const admin = new TestClient();
  await admin.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const personId = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!.id;
  const { token, deviceId } = issueDeviceToken(personId, "robot", "Rover", capabilities);
  const robot = new TestClient();
  expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
  return { admin, robot, deviceId, personId };
}


describe("robot part self-tests", () => {
  test("refuses an unreported part and returns offline immediately", async () => {
    const { admin, deviceId } = await setup(["speaker", "no_vendor_login"]);
    expect((await admin.post(`/api/devices/${deviceId}/self-test`, { part: "face" })).status).toBe(400);
    const started = Date.now();
    const response = await admin.post(`/api/devices/${deviceId}/self-test`, { part: "speaker" });
    expect(response.status).toBe(409);
    expect(Date.now() - started).toBeLessThan(500);
    expect(await response.json()).toMatchObject({ code: "robot_offline" });
  });

  test("a reachable silent robot times out and an authenticated result resolves the waiting request", async () => {
    const { admin, robot, deviceId } = await setup();
    upsertDeviceState(deviceId, { activity: "idle", muted: false, tracking: false });
    const request = admin.post(`/api/devices/${deviceId}/self-test`, { part: "speaker" });
    const command = await new Promise<Record<string, unknown>>((resolve) => {
      const timer = setInterval(() => {
        const row = db.select().from(deviceCommands).all().find((item) => item.kind === "self_test");
        if (row) { clearInterval(timer); resolve(JSON.parse(row.payload) as Record<string, unknown>); }
      }, 5);
    });
    const runId = command.run_id as string;
    const result = await robot.post(`/api/devices/me/self-test/${runId}`, { run_id: runId, part: "speaker", ok: true, detail: "Sound is clear", took_ms: 90 });
    expect(result.status, JSON.stringify(await result.clone().json().catch(() => null))).toBe(204);
    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ run_id: runId, part: "speaker", ok: true, detail: "Sound is clear" });

    __setRobotSelfTestTimeoutForTests(20);
    const silent = await admin.post(`/api/devices/${deviceId}/self-test`, { part: "mic" });
    expect(silent.status).toBe(504);
    expect(await silent.json()).toMatchObject({ code: "robot_no_answer", error: "The robot did not answer the test. Restart it, then try again." });
  });

  test("rejects another robot's run, an overlong detail, and an adult caller", async () => {
    const { admin, robot, deviceId, personId } = await setup();
    const run = startRobotSelfTest(deviceId, "speaker", { timeoutMs: 2_000 });
    const other = issueDeviceToken(personId, "robot", "Other", ["speaker", "no_vendor_login"]);
    const otherRobot = new TestClient();
    await otherRobot.post("/api/auth/devices/redeem", { token: other.token });
    const body = { run_id: run.runId, part: "speaker", ok: true, detail: "ok", took_ms: 1 };
    expect((await otherRobot.post(`/api/devices/me/self-test/${run.runId}`, body)).status).toBe(404);
    expect((await robot.post(`/api/devices/me/self-test/${run.runId}`, { ...body, detail: "x".repeat(201) })).status).toBe(400);
    const adultResponse = await admin.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = new TestClient();
    const adultId = (await adultResponse.json() as { id: string }).id;
    expect((await adult.post("/api/auth/verify-secret", { personId: adultId, secret: "0000" })).status).toBe(200);
    expect((await adult.post(`/api/devices/${deviceId}/self-test`, { part: "speaker" })).status).toBe(403);
    const response = await robot.post(`/api/devices/me/self-test/${run.runId}`, body);
    expect(response.status).toBe(204);
    expect(await run.result).toMatchObject({ ok: true });
  });

  test("does not persist result records", async () => {
    const { robot, deviceId } = await setup();
    const run = startRobotSelfTest(deviceId, "speaker", { timeoutMs: 2_000 });
    const tableCounts = () => {
      const names = sqlite.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      return Object.fromEntries(names.map(({ name }) => [name, sqlite.query<{ count: number }, []>(`SELECT count(*) AS count FROM "${name}"`).get()!.count]));
    };
    const before = tableCounts();
    const response = await robot.post(`/api/devices/me/self-test/${run.runId}`, { run_id: run.runId, part: "speaker", ok: true, detail: "Clear", took_ms: 4 });
    expect(response.status).toBe(204);
    // The command predates this snapshot. The result callback itself leaves every table unchanged.
    expect(tableCounts()).toEqual(before);
  });
});

describe("robot self-test results that do not match a waiting run", () => {
  test("refuses a late result, a run id that differs from the path, and the wrong part", async () => {
    const { robot, deviceId } = await setup();
    const late = startRobotSelfTest(deviceId, "speaker", { timeoutMs: 5 });
    expect(await late.result).toBeNull();
    const lateBody = { run_id: late.runId, part: "speaker", ok: true, detail: "ok", took_ms: 1 };
    expect((await robot.post(`/api/devices/me/self-test/${late.runId}`, lateBody)).status).toBe(404);

    const run = startRobotSelfTest(deviceId, "speaker", { timeoutMs: 2_000 });
    const body = { run_id: run.runId, part: "speaker", ok: true, detail: "ok", took_ms: 1 };
    expect((await robot.post(`/api/devices/me/self-test/other-run`, body)).status).toBe(404);
    expect((await robot.post(`/api/devices/me/self-test/${run.runId}`, { ...body, part: "lights" })).status).not.toBe(204);
    expect((await robot.post(`/api/devices/me/self-test/${run.runId}`, body)).status).toBe(204);
    expect(await run.result).toMatchObject({ part: "speaker", ok: true });
  });
});
