// MUSIC-ID-01: POST /api/music/identify and the readiness row in /api/health, offline (fake fpcalc, real ffmpeg where present).
import { beforeEach, describe, expect, test, spyOn } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetIdentifyForTests, MAX_CLIP_BYTES } from "@/lib/music/identify";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { requestListen, __setListenCommandIssuerForTests, __resetListenRequestsForTests } from "@/lib/music/listenRequests";
import { lastIdentifyOutcome, resetIdentifyLast } from "@/lib/music/identifyLast";

async function owner() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return client;
}
/** PATH with only a directory that holds (or lacks) a fake fpcalc, so the real one never leaks in. */
function withPath<T>(fpcalc: boolean, run: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "id-route-"));
  if (fpcalc) { writeFileSync(join(dir, "fpcalc"), `#!/bin/sh\ncat >/dev/null\ncase "$*" in *-raw*) echo '{"duration":5,"fingerprint":[1,2,3]}';; *) echo '{"duration":5,"fingerprint":"AQAAx"}';; esac\n`); chmodSync(join(dir, "fpcalc"), 0o755); }
  const old = process.env.PATH;
  const oldOnly = process.env.MAIPAI_FPCALC_PATH_ONLY;
  process.env.PATH = `${dir}:/usr/bin:/bin`;
  process.env.MAIPAI_FPCALC_PATH_ONLY = "1";
  return run().finally(() => { process.env.PATH = old; if (oldOnly === undefined) delete process.env.MAIPAI_FPCALC_PATH_ONLY; else process.env.MAIPAI_FPCALC_PATH_ONLY = oldOnly; });
}
beforeEach(() => { resetDb(); __resetIdentifyForTests(); __resetListenRequestsForTests(); __setListenCommandIssuerForTests(null); resetIdentifyLast(); });

describe("POST /api/music/identify", () => {
  test("needs a signed-in person", async () => {
    const res = await new TestClient().postBytes("/api/music/identify", new Uint8Array(10), "audio/wav");
    expect(res.status).toBe(401);
  });
  test("an empty body and a pcm16 clip with no rate are plain 400 errors", async () => {
    const client = await owner();
    expect((await client.postBytes("/api/music/identify", new Uint8Array(0), "application/octet-stream")).status).toBe(400);
    expect((await client.postBytes("/api/music/identify?kind=pcm16", new Uint8Array(100), "application/octet-stream")).status).toBe(400);
  });
  test("a clip over 2 MB or over 20 seconds is refused with a plain 413", async () => {
    const client = await owner();
    const big = await client.postBytes("/api/music/identify", new Uint8Array(MAX_CLIP_BYTES + 1), "audio/wav");
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: string }).error).toContain("20 seconds");
    const long = await client.postBytes("/api/music/identify?kind=pcm16&rate=8000", new Uint8Array(21 * 8000 * 2), "application/octet-stream");
    expect(long.status).toBe(413);
    expect(lastIdentifyOutcome()).toMatchObject({ status: "failed", reason: "too_long", source: "person" });
  });
  test("no fpcalc on this computer: a typed not_ready, not an error", async () => {
    const client = await owner();
    await withPath(false, async () => {
      const res = await client.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(16000 * 2), "application/octet-stream");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "not_ready", reason: "fpcalc_missing" });
      expect(lastIdentifyOutcome()).toMatchObject({ status: "not_ready", reason: "fpcalc_missing" });
    });
  });
  test("no AcoustID key records and logs the not-ready reason", async () => {
    const client = await owner();
    const lines: string[] = [];
    const info = spyOn(console, "info").mockImplementation((...args) => { lines.push(args.join(" ")); });
    try {
      setHouseholdSettingValue("music.identify.online", "ask");
      await withPath(true, async () => {
        const res = await client.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(32000), "application/octet-stream");
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: "not_ready", reason: "no_key" });
      });
      expect(lastIdentifyOutcome()).toMatchObject({ status: "not_ready", reason: "no_key" });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("status=not_ready reason=no_key");
    } finally { info.mockRestore(); }
  });
  test("a second clip within 60 seconds from the same device is a typed rate_limited", async () => {
    const client = await owner();
    await withPath(true, async () => {
      setHouseholdSettingValue("music.identify.online", "off");
      const first = await client.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(16000 * 2), "application/octet-stream");
      expect(first.status).toBe(200);
      expect(((await first.json()) as { status: string }).status).not.toBe("rate_limited");
      const second = await client.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(16000 * 2), "application/octet-stream");
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({ status: "rate_limited" });
      expect(lastIdentifyOutcome()).toMatchObject({ status: "rate_limited" });
    });
  });

  test("logs one safe line per attempt and records the latest outcome", async () => {
    const client = await owner();
    const lines: string[] = [];
    const info = spyOn(console, "info").mockImplementation((...args) => { lines.push(args.join(" ")); });
    try {
      await withPath(true, async () => {
        setHouseholdSettingValue("music.identify.online", "ask");
        setHouseholdSettingValue("acoustid.client", "sensitive-test-key");
        const response = await client.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(32000), "application/octet-stream");
        expect(response.status).toBe(200);
      });
      expect(lastIdentifyOutcome()?.status).toBe("needs_confirm");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("[music-identify] device=person status=needs_confirm");
      expect(lines[0]).not.toContain("sensitive-test-key");
      expect(lines[0]).not.toContain("AQAAx");
    } finally { info.mockRestore(); }
  });
  test("ask each time with a key returns needs_confirm and makes no request", async () => {
    const client = await owner();
    setHouseholdSettingValue("music.identify.online", "ask");
    setHouseholdSettingValue("acoustid.client", "test-key");
    await withPath(true, async () => {
      if (!Bun.which("ffmpeg")) return;
      const res = await client.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(16000 * 2), "application/octet-stream");
      expect(await res.json()).toMatchObject({ status: "needs_confirm" });
    });
  });

  test("a robot identify request resolves only the waiter named by request", async () => {
    await owner();
    const personId = db.select({ id: people.id }).from(people).get()!.id;
    setHouseholdSettingValue("home.robots.enabled", true);
    const { token, deviceId } = issueDeviceToken(personId, "robot", "Test robot");
    storeRobotCredential(deviceId, "192.0.2.10", "pollen", "test-password");
    const robot = new TestClient();
    expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
    let requestId = "";
    __setListenCommandIssuerForTests((_deviceId, _kind, payload) => { requestId = String(payload.request_id); return {} as never; });
    const pending = requestListen(deviceId, { timeoutMs: 1000 });
    await withPath(false, async () => {
      const response = await robot.postBytes(`/api/music/identify?kind=pcm16&rate=16000&request=${requestId}`, new Uint8Array(32000), "application/octet-stream");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "not_ready", reason: "fpcalc_missing" });
    });
    expect(await pending).toMatchObject({ status: "not_ready", reason: "fpcalc_missing" });
  });

  test("without request the device route does not resolve a pending waiter", async () => {
    await owner();
    const personId = db.select({ id: people.id }).from(people).get()!.id;
    setHouseholdSettingValue("home.robots.enabled", true);
    const { token, deviceId } = issueDeviceToken(personId, "robot", "Test robot");
    storeRobotCredential(deviceId, "192.0.2.10", "pollen", "test-password");
    const robot = new TestClient();
    expect((await robot.post("/api/auth/devices/redeem", { token })).status).toBe(200);
    __setListenCommandIssuerForTests(() => ({} as never));
    const pending = requestListen(deviceId, { timeoutMs: 25 });
    await withPath(false, async () => {
      const response = await robot.postBytes("/api/music/identify?kind=pcm16&rate=16000", new Uint8Array(32000), "application/octet-stream");
      expect(response.status).toBe(200);
    });
    expect(await pending).toEqual({ status: "timeout" });
  });
});

describe("/api/health carries the one readiness answer", () => {
  test("engines.identify says why song naming cannot run", async () => {
    const client = await owner();
    await withPath(false, async () => {
      const body = (await (await client.get("/api/health")).json()) as { engines: { identify?: { identify_state: string; identify_line: string; availability: string } } };
      expect(body.engines.identify?.identify_state).toBe("fpcalc_missing");
      expect(body.engines.identify?.availability).toBe("unavailable");
      expect(body.engines.identify?.identify_line).toContain("song naming tool");
    });
  });
});
