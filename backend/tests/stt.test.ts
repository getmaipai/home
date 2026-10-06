import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { transcribeUtterance } from "@/lib/stt";
import { encodeWav } from "@/lib/sttSession";
import { websocket } from "hono/bun";
import { app } from "@/app";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { listIssues } from "@/lib/issues";
import { startStackFixture, IDENTITY_HEADERS, offlineResponse, type StackFixture } from "./stackFixture";

let fixture: StackFixture | undefined;

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __setStackClientForTests(null);
});

afterEach(() => {
  fixture?.stop();
  fixture = undefined;
  __resetStackEngineForTests();
});

async function owner(): Promise<TestClient> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

function fixtureWav(): Uint8Array {
  const samples = new Float32Array(1600); // 0.1s @ 16kHz
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * 0.4;
  return encodeWav(samples, 16_000);
}

describe("POST /api/stt/transcribe", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/stt/transcribe");
    expect(res.status).toBe(401);
  });

  test("returns the scripted transcription for a fixture WAV", async () => {
    fixture = startStackFixture({ "POST /v1/audio/transcriptions": async () => Response.json({ text: "the fixture said this" }, { headers: IDENTITY_HEADERS }) });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    const client = await owner();
    const res = await client.postBytes("/api/stt/transcribe", fixtureWav(), "audio/wav");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe("the fixture said this");
  });

  test("rejects a non-WAV body with 400, not a 500", async () => {
    const client = await owner();
    const res = await client.postBytes("/api/stt/transcribe", new Uint8Array([1, 2, 3, 4]), "audio/wav");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/voice/stt/status", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.get("/api/voice/stt/status");
    expect(res.status).toBe(401);
  });

  test("reports ready state for the configured Stack role and keeps legacy asset fields false", async () => {
    fixture = startStackFixture({ "GET /stack/v1/roles": async () => Response.json({ roles: [{ id: "stt", state: { state: "ready" } }] }) });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    const client = await owner();
    const res = await client.get("/api/voice/stt/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { installed: boolean; stackState: string; sileroInstalled: boolean; moonshineInstalled: boolean; recognizerLoaded: boolean };
    expect(body.installed).toBe(true);
    expect((body as typeof body & { stackState: string }).stackState).toBe("ready");
    expect(body.sileroInstalled).toBe(false);
    expect(body.moonshineInstalled).toBe(false);
    expect(body.recognizerLoaded).toBe(false);
  });

  test("reports an offline Stack role state as not installed", async () => {
    fixture = startStackFixture({ "GET /stack/v1/roles": async () => Response.json({ roles: [{ id: "stt", state: { state: "offline", reason: "worker stopped" } }] }) });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    const client = await owner();
    const res = await client.get("/api/voice/stt/status");
    const body = (await res.json()) as { installed: boolean; stackState: string };
    expect(body.installed).toBe(false);
    expect(body.stackState).toBe("offline");
  });
});

// A real Bun.serve() + WebSocket client, not app.request() (Hono's own
// test helper can't drive a WS upgrade) - the same real-mechanism
// standard llmSupervisor.ts's own process tests hold to. Spun up fresh
// per test (port 0 = OS-assigned) rather than shared, so a test that
// leaves a socket open can't wedge a later one.
describe("WS /api/stt/stream", () => {
  test("a malformed binary frame (not a multiple of 4 bytes) gets a wire error, not a dead connection", async () => {
    // A code review (2026-09-06) found this threw an uncaught RangeError
    // (verified live) that silently killed the whole stream - this test
    // reproduces the exact failure shape and asserts the fix: a clean
    // {t:"error"} event, and the connection still processing messages
    // afterward.
    const client = await owner();
    const cookie = client.getCookie();
    if (!cookie) throw new Error("no session cookie captured - did auth/setup run first?");
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/stt/stream`, { headers: { cookie } });
      const events: Record<string, unknown>[] = [];
      await new Promise<void>((resolve, reject) => {
        ws.onerror = reject;
        ws.onmessage = (evt) => events.push(JSON.parse(evt.data as string));
        ws.onopen = () => {
          ws.send(new Uint8Array([1, 2, 3]).buffer); // 3 bytes, not a multiple of 4
          setTimeout(resolve, 100);
        };
      });
      expect(events.some((e) => e.t === "error")).toBe(true);
      ws.close();
    } finally {
      server.stop(true);
    }
  });
});

// Speech always routes through the configured Stack transcription endpoint.
describe("lib/stt.ts routed through a configured Stack", () => {
  test("configured Stack routes listening through its client", async () => {
    fixture = startStackFixture({ "POST /v1/audio/transcriptions": async () => Response.json({ text: "Stack heard this" }) });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    expect(await transcribeUtterance(new Float32Array(1600), 16_000)).toBe("Stack heard this");
    expect(fixture.calls).toEqual(["POST /v1/audio/transcriptions"]);
  });

  test("transcribes through the Stack, sending a real WAV file", async () => {
    let receivedFile: File | null = null;
    fixture = startStackFixture({
      "POST /v1/audio/transcriptions": async (req) => {
        const form = await req.formData();
        receivedFile = form.get("file") as File | null;
        return Response.json({ text: "the stack heard this" }, { headers: IDENTITY_HEADERS });
      },
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const samples = new Float32Array(1600);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * 0.4;
    const text = await transcribeUtterance(samples, 16_000);
    expect(text).toBe("the stack heard this");
    expect(receivedFile).not.toBeNull();
    expect((receivedFile as unknown as File).name).toBe("utterance.wav");
  });

  test("a scripted 503 raises a Repairs entry carrying offline_reason and still throws", async () => {
    fixture = startStackFixture({
      "POST /v1/audio/transcriptions": async () => offlineResponse("stt", "the stt engine process is not running"),
    });
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    __setStackClientForTests(fixture.client);

    const samples = new Float32Array(1600);
    await expect(transcribeUtterance(samples, 16_000)).rejects.toThrow();
    const issue = listIssues().find((i) => i.source === "stack" && i.key === "offline.stt");
    expect(issue?.detail).toBe("the stt engine process is not running");
  });
});
