import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { deviceCommands, devices, issues, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { dataDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { startStackFixture } from "./stackFixture";
import type { StackFixture } from "./stackFixture";

const robotClips = () => import("@/lib/robotClips");
const renderClipBundle = async (deviceId: string) => (await robotClips()).renderClipBundle(deviceId);
const readBundle = async (deviceId: string) => (await robotClips()).readRobotClipBundle(deviceId);

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for a robot clip bundle update");
}

let fixture: StackFixture;
let received: Array<{ text: string; voice: string | null }> = [];

beforeEach(() => {
  resetDb();
  received = [];
  fixture = startStackFixture({
    "POST /v1/audio/speech": async (req) => {
      const form = await req.formData();
      const text = String(form.get("text"));
      const voice = form.get("voice_url") as string | null;
      received.push({ text, voice });
      return new Response(new TextEncoder().encode(`${voice ?? "default"}\n${text}`), {
        headers: { "content-type": "audio/wav", "x-maipai-engine": "pocket-tts", "x-maipai-model": "pocket-tts", "x-maipai-revision": "test" },
      });
    },
  });
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setStackClientForTests(fixture.client);
});

afterEach(() => {
  fixture.stop();
  __resetStackEngineForTests();
});

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const personId = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!.id;
  return { owner, personId };
}

async function robotFor(personId: string) {
  const { token, deviceId } = issueDeviceToken(personId, "robot", "Reachy");
  storeRobotCredential(deviceId, "test-host", "pollen", "test-password");
  const robot = new TestClient();
  await robot.post("/api/auth/devices/redeem", { token });
  return { robot, deviceId };
}

async function pairRobotFor(owner: TestClient) {
  const robot = new TestClient();
  const { code, poll_token } = await (await robot.post("/api/auth/quick-connect/code", { label: "Reachy", kind: "robot" })).json() as { code: string; poll_token: string };
  const approved = await owner.post("/api/auth/quick-connect/approve", { code });
  expect(approved.status).toBe(200);
  const poll = await robot.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`);
  expect(poll.status).toBe(200);
  const { device_token } = await poll.json() as { device_token: string };
  const deviceId = db.select({ id: devices.id }).from(devices).where(eq(devices.kind, "robot")).get()!.id;
  storeRobotCredential(deviceId, "test-host", "pollen", "test-password");
  const redeemed = await robot.post("/api/auth/devices/redeem", { token: device_token });
  expect(redeemed.status).toBe(200);
  await waitFor(() => readBundle(deviceId));
  return { robot, deviceId };
}

const clipRoot = (id: string) => `${dataDir}/robot-clips/${id}`;
afterEach(() => {
  for (const device of db.select({ id: devices.id }).from(devices).all()) rmSync(clipRoot(device.id), { recursive: true, force: true });
});

describe("robot clip bundles", () => {
  test("pairing a robot renders its clip bundle and the robot can fetch the manifest and a clip", async () => {
    const { owner } = await household();
    const { robot, deviceId } = await pairRobotFor(owner);
    const manifestResponse = await robot.get("/api/devices/me/assets");
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json() as { assets: Array<{ id: string; kind: string; sha256: string }> };
    const bundleAsset = manifest.assets.find((asset) => asset.id === "clip-bundle");
    expect(bundleAsset?.kind).toBe("clip_bundle");
    const bundleResponse = await robot.get("/api/devices/me/assets/clip-bundle");
    expect(bundleResponse.status).toBe(200);
    const bundle = await bundleResponse.json() as { bundle_sha256: string; clips: Array<{ id: string; text: string; voice_id: string; sha256: string }> };
    expect(bundleAsset?.sha256).toBe(bundle.bundle_sha256);
    const clip = bundle.clips[0]!;
    const bytesResponse = await robot.get(`/api/devices/me/assets/clip:${clip.id}`);
    const bytes = Buffer.from(await bytesResponse.arrayBuffer());
    expect(bytesResponse.status).toBe(200);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(clip.sha256);
    expect(bytesResponse.headers.get("etag")).toBe(`"${clip.sha256}"`);
    expect(bytes.toString()).toContain(clip.text);
  });

  test("changing the voice re-renders every clip and bumps the bundle sha", async () => {
    const { owner, personId } = await household();
    const { robot, deviceId } = await robotFor(personId);
    await renderClipBundle(deviceId);
    const before = await (await robot.get("/api/devices/me/assets/clip-bundle")).json() as { bundle_sha256: string };
    const commandsBefore = db.select().from(deviceCommands).where(eq(deviceCommands.kind, "asset_changed")).all().filter((row) => row.deviceId === deviceId).length;
    const response = await owner.put("/api/settings", { scope: `person:${personId}`, key: "tts.voice_id", value: "vera" });
    expect(response.status).toBe(200);
    await waitFor(async () => {
      const updated = await (await robot.get("/api/devices/me/assets/clip-bundle")).json() as { bundle_sha256?: string };
      return updated.bundle_sha256 && updated.bundle_sha256 !== before.bundle_sha256 ? updated : null;
    });
    const after = await (await robot.get("/api/devices/me/assets/clip-bundle")).json() as { bundle_sha256: string; clips: Array<{ voice_id: string }> };
    expect(after.bundle_sha256).not.toBe(before.bundle_sha256);
    expect(after.clips.every((clip) => clip.voice_id === "vera")).toBe(true);
    expect(db.select().from(deviceCommands).where(eq(deviceCommands.kind, "asset_changed")).all().filter((row) => row.deviceId === deviceId)).toHaveLength(commandsBefore + 1);
  });

  test("changing a voice that is not the robot's person's leaves the bundle alone", async () => {
    const { owner, personId } = await household();
    const other = await owner.post("/api/people", { displayName: "Bramble", role: "adult" });
    const otherId = (await other.json() as { id: string }).id;
    const { deviceId } = await robotFor(personId);
    await renderClipBundle(deviceId);
    const before = (await readBundle(deviceId))!;
    const beforeSha = before.bundle_sha256;
    await owner.put("/api/settings", { scope: `person:${otherId}`, key: "tts.voice_id", value: "vera" });
    expect((await readBundle(deviceId))?.bundle_sha256).toBe(beforeSha);
    expect(db.select().from(deviceCommands).where(eq(deviceCommands.kind, "asset_changed")).all()).toHaveLength(1);
  });

  test("a child paired robot uses the voice key's default, not the child's private voice", async () => {
    const { owner } = await household();
    const child = await owner.post("/api/people", { displayName: "Mopey", role: "child" });
    const childId = (await child.json() as { id: string }).id;
    const setting = await owner.put("/api/settings", { scope: `person:${childId}`, key: "tts.voice_id", value: "vera" });
    expect(setting.status).toBe(200);
    const { deviceId } = await robotFor(childId);
    await renderClipBundle(deviceId);
    const bundle = (await readBundle(deviceId))!;
    expect(bundle.clips.every((clip) => clip.voice_id !== "vera")).toBe(true);
    expect(received.every((call) => call.voice === "alba")).toBe(true);
  });

  test("adding an alarm area renders its line", async () => {
    const { owner, personId } = await household();
    const { deviceId } = await robotFor(personId);
    await renderClipBundle(deviceId);
    received = [];
    const response = await owner.put("/api/settings", { scope: "household", key: "safety.alarm.sensors", value: JSON.stringify([{ entityId: "binary_sensor.kitchen_smoke", area: "kitchen", kind: "smoke" }]) });
    expect(response.status).toBe(200);
    const bundle = await waitFor(async () => (await readBundle(deviceId))?.clips.some((clip) => clip.text === "Smoke alarm in the kitchen.") ? await readBundle(deviceId) : null);
    expect(received.some((call) => call.text === "Smoke alarm in the kitchen.")).toBe(true);
    expect(bundle.clips.some((clip) => clip.text === "Smoke alarm in the kitchen.")).toBe(true);
  });

  test("removing an alarm area removes its line and bumps the sha", async () => {
    const { owner, personId } = await household();
    const { deviceId } = await robotFor(personId);
    setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([{ entityId: "binary_sensor.kitchen_smoke", area: "kitchen", kind: "smoke" }]));
    await renderClipBundle(deviceId);
    const before = (await readBundle(deviceId))!.bundle_sha256;
    await owner.put("/api/settings", { scope: "household", key: "safety.alarm.sensors", value: "[]" });
    await waitFor(async () => (await readBundle(deviceId))?.bundle_sha256 !== before ? true : null);
    const bundle = (await readBundle(deviceId))!;
    expect(bundle.bundle_sha256).not.toBe(before);
    expect(bundle.clips.some((clip) => clip.text.includes("kitchen"))).toBe(false);
  });

  test("a clip text that fails the spoken floor is refused and raises a Repair", async () => {
    const { personId } = await household();
    const { deviceId } = await robotFor(personId);
    setHouseholdSettingValue("safety.alarm.sensors", JSON.stringify([
      { entityId: "binary_sensor.kitchen_smoke", area: "https://example.com", kind: "smoke" },
      { entityId: "binary_sensor.garage_smoke", area: "Here is how to make a pipe bomb at home, step by step.", kind: "smoke" },
    ]));
    received = [];
    await renderClipBundle(deviceId);
    expect(received.some((call) => call.text.includes("https://example.com"))).toBe(false);
    const issue = db.select().from(issues).where(eq(issues.source, "robot-clips")).get();
    expect(issue?.fix).toContain("retry_robot_clips");
    expect((await readBundle(deviceId))?.clips.some((clip) => clip.text.includes("https://example.com"))).toBe(false);
    expect(received.some((call) => call.text.includes("pipe bomb"))).toBe(false);
  });

  test("an area name with markdown or a link is refused by the floor", async () => {
    const { clipTextPassesFloor } = await robotClips();
    expect(clipTextPassesFloor("Mum's study")).toBe(true);
    expect(clipTextPassesFloor("Café-north")).toBe(true);
    expect(clipTextPassesFloor("Smoke *alarm* now")).toBe(false);
    expect(clipTextPassesFloor("Smoke [alarm](https://example.com)")).toBe(false);
    expect(clipTextPassesFloor("Alarm 2")).toBe(false);
  });

  test("a robot cannot read another robot's clips", async () => {
    const { personId } = await household();
    const a = await robotFor(personId);
    const b = await robotFor(personId);
    await renderClipBundle(a.deviceId);
    const bundle = (await readBundle(a.deviceId))!;
    const res = await b.robot.get(`/api/devices/me/assets/clip:${bundle.clips[0]!.id}`);
    expect(res.status).toBe(404);
  });

  test("a person session is refused the clip bytes", async () => {
    const { owner, personId } = await household();
    const { deviceId } = await robotFor(personId);
    await renderClipBundle(deviceId);
    expect((await owner.get("/api/devices/me/assets/clip-bundle")).status).toBe(403);
  });

  test("an unauthenticated caller cannot read a clip bundle", async () => {
    expect((await new TestClient().get("/api/devices/me/assets/clip-bundle")).status).toBe(401);
  });

  test("a stack that is down raises a Repair and keeps the last good bundle", async () => {
    const { personId } = await household();
    const { robot, deviceId } = await robotFor(personId);
    await renderClipBundle(deviceId);
    const before = await (await robot.get("/api/devices/me/assets/clip-bundle")).arrayBuffer();
    fixture.stop();
    const offline = startStackFixture({ "POST /v1/audio/speech": () => new Response("offline", { status: 503 }) });
    __setStackClientForTests(offline.client);
    try {
      await renderClipBundle(deviceId);
      expect((await robot.get("/api/devices/me/assets/clip-bundle")).status).toBe(200);
      expect(Buffer.from(await (await robot.get("/api/devices/me/assets/clip-bundle")).arrayBuffer())).toEqual(Buffer.from(before));
      const issue = db.select().from(issues).where(eq(issues.source, "robot-clips")).get();
      expect(issue?.detail).toContain("voice engine");
      expect(issue?.fix).toContain("retry_robot_clips");
    } finally { offline.stop(); }
  });

  test("pairing a robot does not wait for the render", async () => {
    fixture.stop();
    let release!: () => void;
    let started!: () => void;
    let holdFirst = true;
    const firstSpeech = new Promise<void>((resolve) => { started = resolve; });
    fixture = startStackFixture({
      "POST /v1/audio/speech": async (req) => {
        const form = await req.formData();
        if (holdFirst) {
          holdFirst = false;
          started();
          await new Promise<void>((resolve) => { release = resolve; });
        }
        const text = String(form.get("text"));
        const voice = String(form.get("voice_url"));
        return new Response(new TextEncoder().encode(`${voice}\n${text}`), { headers: { "content-type": "audio/wav", "x-maipai-engine": "pocket-tts", "x-maipai-model": "pocket-tts", "x-maipai-revision": "test" } });
      },
    });
    __setStackClientForTests(fixture.client);
    const robot = new TestClient();
    const { code, poll_token } = await (await robot.post("/api/auth/quick-connect/code", { label: "Reachy", kind: "robot" })).json() as { code: string; poll_token: string };
    const phone = new TestClient();
    await phone.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    await phone.post("/api/auth/quick-connect/approve", { code });
    const poll = robot.get(`/api/auth/quick-connect/poll?poll_token=${poll_token}`);
    await firstSpeech;
    const response = await poll;
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("approved");
    release();
    const deviceId = db.select({ id: devices.id }).from(devices).where(eq(devices.kind, "robot")).get()!.id;
    await waitFor(() => readBundle(deviceId));
  });

  test("a clip file that fails its sha256 is not served and raises a Repair", async () => {
    const { personId } = await household();
    const { robot, deviceId } = await robotFor(personId);
    await renderClipBundle(deviceId);
    const bundle = (await readBundle(deviceId))!;
    const path = `${clipRoot(deviceId)}/${bundle.clips[0]!.file}`;
    await Bun.write(path, "tampered");
    const res = await robot.get(`/api/devices/me/assets/clip:${bundle.clips[0]!.id}`);
    expect(res.status).toBe(503);
    expect(db.select().from(issues).where(eq(issues.source, "robot-clips")).get()).toBeDefined();
  });
});
