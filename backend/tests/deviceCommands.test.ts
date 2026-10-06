import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { websocket } from "hono/bun";
import { app } from "@/app";
import { db } from "@/db";
import { deviceCommands, people } from "@/db/schema";
import { issueDeviceToken } from "@/lib/deviceTokens";
import { storeRobotCredential } from "@/lib/robotCredentials";
import { WAKEWORD_ALL_ASSETS, areWakewordAssetsInstalled, wakewordAssetPath } from "@/lib/wakewordAssets";
import { wakewordDir } from "@/lib/paths";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { __setDeviceHeartbeatIntervalForTests } from "@/lib/deviceCommands";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
afterEach(() => rmSync(wakewordDir, { recursive: true, force: true }));

function installWakewordPlaceholders(): void {
  mkdirSync(wakewordDir, { recursive: true });
  for (const asset of WAKEWORD_ALL_ASSETS) writeFileSync(wakewordAssetPath(asset.file), "placeholder");
}

async function ownerSession(): Promise<{ client: TestClient; personId: string }> {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const person = db.select({ id: people.id }).from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, personId: person.id };
}

async function robotSession(personId: string): Promise<{ client: TestClient; deviceId: string }> {
  const { token, deviceId } = issueDeviceToken(personId, "robot", "Reachy Mini");
  storeRobotCredential(deviceId, "192.0.2.10", "pollen", "a-freshly-rotated-password");
  const client = new TestClient();
  expect((await client.post("/api/auth/devices/redeem", { token })).status).toBe(200);
  return { client, deviceId };
}

interface WireMessage {
  type?: string;
  id?: string;
  kind?: string;
  payload?: Record<string, unknown>;
  state?: { muted?: boolean };
  [key: string]: unknown;
}

class DeviceSocket {
  readonly ws: WebSocket;
  private readonly buffered: WireMessage[] = [];
  private readonly waiters: Array<{ match: (message: WireMessage) => boolean; resolve: (message: WireMessage) => void }> = [];

  constructor(url: string, headers: Record<string, string>) {
    this.ws = new WebSocket(url, { headers });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as WireMessage;
      const index = this.waiters.findIndex((waiter) => waiter.match(message));
      if (index < 0) this.buffered.push(message);
      else this.waiters.splice(index, 1)[0]!.resolve(message);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("WebSocket handshake failed")), { once: true });
    });
  }

  next(match: (message: WireMessage) => boolean, timeoutMs = 2_000): Promise<WireMessage> {
    const index = this.buffered.findIndex(match);
    if (index >= 0) return Promise.resolve(this.buffered.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("timed out waiting for device event"));
      }, timeoutMs);
      this.waiters.push({ match, resolve: (message) => { clearTimeout(timer); resolve(message); } });
    });
  }
}

describe("GET /api/devices/me/events", () => {
  test("refuses a WebSocket upgrade without a device session", async () => {
    expect((await app.request("/api/devices/me/events")).status).toBe(401);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/devices/me/events`);
      let opened = false;
      await new Promise<void>((resolve) => {
        socket.onopen = () => { opened = true; resolve(); };
        socket.onerror = () => resolve();
        setTimeout(resolve, 1_000);
      });
      expect(opened).toBe(false);
      socket.close();
    } finally {
      server.stop(true);
    }
  });

  test("refuses robot offer answers whose declared source is not voice", async () => {
    const { client: owner, personId } = await ownerSession();
    const { client: robot } = await robotSession(personId);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    const cookie = robot.getCookie();
    if (!cookie) throw new Error("robot session cookie missing");
    try {
      const socket = new DeviceSocket(`ws://127.0.0.1:${server.port}/api/devices/me/events`, { cookie });
      await socket.open();
      socket.ws.send(JSON.stringify({ kind: "offer_answer", payload: { offer_id: "offer-test", approved: true, source: "gesture" } }));
      const response = await socket.next((message) => message.type === "error");
      expect(response.message).toContain("invalid");
      socket.ws.close();
    } finally {
      server.stop(true);
    }
  });

  test("replays a disconnected mute with the same id, then stops after its ack", async () => {
    const { client: owner, personId } = await ownerSession();
    const { client: robot, deviceId } = await robotSession(personId);
    const accepted = await owner.request(`/api/devices/${deviceId}/commands`, { method: "POST", body: { kind: "mute" } });
    expect(accepted.status).toBe(202);
    const { id } = (await accepted.json()) as { id: string };

    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    const cookie = robot.getCookie();
    if (!cookie) throw new Error("robot session cookie missing");
    try {
      const connect = async (lastEventId?: string) => {
        const headers: Record<string, string> = { cookie };
        if (lastEventId) headers["last-event-id"] = lastEventId;
        const socket = new DeviceSocket(`ws://127.0.0.1:${server.port}/api/devices/me/events`, headers);
        await socket.open();
        return socket;
      };

      const first = await connect();
      const command = await first.next((message) => message.type === "device-command" && message.id === id);
      expect(command).toMatchObject({ id, kind: "mute", payload: {} });
      first.ws.send(JSON.stringify({ type: "ack", id, state: { muted: true } }));
      await Bun.sleep(25);
      const devices = (await (await owner.get("/api/devices/robots")).json()) as Array<{ id: string; state: { muted: boolean } | null }>;
      expect(devices.find((device) => device.id === deviceId)?.state?.muted).toBe(true);
      first.ws.close();

      const reconnected = await connect(id);
      await expect(reconnected.next((message) => message.type === "device-command" && message.id === id, 150)).rejects.toThrow("timed out");
      reconnected.ws.close();
    } finally {
      server.stop(true);
    }
  });

  test("sends a device-scoped setting change over the open channel", async () => {
    const { client: owner, personId } = await ownerSession();
    const { client: robot, deviceId } = await robotSession(personId);
    installWakewordPlaceholders();
    expect(areWakewordAssetsInstalled()).toBe(true);
    expect(getRegistryKey("voice.wakeword.enabled")).toBeDefined();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    const cookie = robot.getCookie();
    if (!cookie) throw new Error("robot session cookie missing");
    try {
      const socket = new DeviceSocket(`ws://127.0.0.1:${server.port}/api/devices/me/events`, { cookie });
      await socket.open();
      const result = await owner.request("/api/settings", {
        method: "PUT",
        body: { scope: `device:${deviceId}`, key: "voice.wakeword.enabled", value: true },
      });
      expect(result.status).toBe(200);
      expect(db.select({ kind: deviceCommands.kind }).from(deviceCommands).all().map((row) => row.kind)).toContain("settings_changed");
      const event = await socket.next((message) => message.type === "device-command" && message.kind === "settings_changed");
      expect(event.payload).toEqual({ values: { "voice.wakeword.enabled": true } });

      const personSetting = await owner.request("/api/settings", {
        method: "PUT",
        body: { scope: `person:${personId}`, key: "ui.show_turn_stats", value: true },
      });
      expect(personSetting.status).toBe(200);
      const personEvent = await socket.next((message) => message.type === "device-command" && message.kind === "settings_changed");
      expect(personEvent.payload).toEqual({ values: { "ui.show_turn_stats": true } });
      socket.ws.close();
    } finally {
      server.stop(true);
    }
  });

  test("sends a typed hub-time command and exchanges heartbeats in both directions", async () => {
    const { personId } = await ownerSession();
    const { client: robot } = await robotSession(personId);
    const cookie = robot.getCookie();
    if (!cookie) throw new Error("robot session cookie missing");
    __setDeviceHeartbeatIntervalForTests(20);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    try {
      const socket = new DeviceSocket(`ws://127.0.0.1:${server.port}/api/devices/me/events`, { cookie });
      await socket.open();
      const time = await socket.next((message) => message.type === "device-command" && message.kind === "time");
      expect(time.payload?.hub_time).toBeString();
      expect(Date.parse(String(time.payload?.hub_time))).not.toBeNaN();
      expect(time.hlc).toBeString();
      expect(Date.parse(String(time.issued_at))).not.toBeNaN();
      expect(Date.parse(String(time.expires_at)) - Date.parse(String(time.issued_at))).toBe(24 * 60 * 60 * 1000);

      const heartbeat = await socket.next((message) => message.type === "heartbeat");
      expect(Date.parse(String(heartbeat.hub_time))).not.toBeNaN();
      socket.ws.send(JSON.stringify({ type: "heartbeat", device_time: new Date().toISOString() }));
      const ack = await socket.next((message) => message.type === "heartbeat_ack");
      expect(ack.device_time).toBeString();
      expect(ack.drift_ms).toBeNumber();
      socket.ws.close();
    } finally {
      server.stop(true);
    }
  });

  test("a second connection for one robot replaces the first", async () => {
    const { personId } = await ownerSession();
    const { client: robot, deviceId } = await robotSession(personId);
    const cookie = robot.getCookie();
    if (!cookie) throw new Error("robot session cookie missing");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    try {
      const url = `ws://127.0.0.1:${server.port}/api/devices/me/events`;
      const first = new DeviceSocket(url, { cookie });
      await first.open();
      const firstTime = await first.next((message) => message.type === "device-command" && message.kind === "time");
      const second = new DeviceSocket(url, { cookie });
      await second.open();
      await second.next((message) => message.type === "device-command" && message.kind === "time");
      await new Promise<void>((resolve) => {
        if (first.ws.readyState === WebSocket.CLOSED) return resolve();
        first.ws.addEventListener("close", () => resolve(), { once: true });
        setTimeout(resolve, 500);
      });
      expect(first.ws.readyState).toBe(WebSocket.CLOSED);
      expect(db.select({ deviceId: deviceCommands.deviceId }).from(deviceCommands).all().every((row) => row.deviceId === deviceId)).toBe(true);
      expect(firstTime.id).toBeString();
      second.ws.close();
    } finally {
      server.stop(true);
    }
  });
});
