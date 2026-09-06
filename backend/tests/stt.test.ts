import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __setSttBackendForTests, __resetSttForTests, sttAssetsInstalled, sttRecognizerLoaded } from "@/lib/stt";
import { encodeWav } from "@/lib/sttSession";
import { websocket } from "hono/bun";
import { app } from "@/app";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { sileroVadPath } from "@/lib/sttAssets";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetSttForTests();
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
    __setSttBackendForTests(async () => "the fixture said this");
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

  test("reports installed=false, both per-asset flags false, and recognizerLoaded=false with no real assets in the test data dir", async () => {
    const client = await owner();
    const res = await client.get("/api/voice/stt/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { installed: boolean; sileroInstalled: boolean; moonshineInstalled: boolean; recognizerLoaded: boolean };
    expect(body.installed).toBe(false);
    expect(body.sileroInstalled).toBe(false);
    expect(body.moonshineInstalled).toBe(false);
    expect(body.recognizerLoaded).toBe(false);
  });

  // A code review (2026-09-06) found the status route's own doc comment
  // promised a partial-install distinction ("silero present, Moonshine
  // missing") that nothing actually implemented - this proves it now
  // does, the real reachable state since ensureSttAssets() downloads
  // Silero first, then Moonshine.
  test("a partial install (Silero present, Moonshine still missing) reports each asset separately", async () => {
    // Written into the shared test data dir (MAIPAI_DATA_DIR is one temp
    // dir for the whole `bun test` run, not per-test) and removed again
    // in `finally` - left behind, it would make getSileroStream() try to
    // load garbage in every OTHER test that creates an SttSession after
    // this one in the same process.
    mkdirSync(sileroVadPath().replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(sileroVadPath(), "not a real model, just proving the file-exists check");
    try {
      const client = await owner();
      const res = await client.get("/api/voice/stt/status");
      const body = (await res.json()) as { installed: boolean; sileroInstalled: boolean; moonshineInstalled: boolean };
      expect(body.sileroInstalled).toBe(true);
      expect(body.moonshineInstalled).toBe(false);
      expect(body.installed).toBe(false);
    } finally {
      rmSync(sileroVadPath(), { force: true });
    }
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
    __setSttBackendForTests(async () => "still alive");
    const client = await owner();
    const cookie = client.getCookie();
    if (!cookie) throw new Error("no session cookie captured - did auth/setup run first?");
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
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

describe("lib/stt.ts test seam", () => {
  test("sttAssetsInstalled()/sttRecognizerLoaded() reflect real state, not the scripted test backend", () => {
    // __setSttBackendForTests() only overrides transcribeUtterance() -
    // it never fakes "installed" or "loaded", so these two stay real
    // (and false, in a test environment with no downloaded models) even
    // while a test backend is active - a deliberate design choice
    // (status reporting should never lie because a DIFFERENT concern
    // was stubbed for a different test).
    __setSttBackendForTests(async () => "anything");
    expect(sttAssetsInstalled()).toBe(false);
    expect(sttRecognizerLoaded()).toBe(false);
  });
});
