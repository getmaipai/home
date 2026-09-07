import { describe, expect, test, afterEach } from "bun:test";
import { getTtsClient, getTtsBackendKind, restartTtsBackend, spawnPocketTts, __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { __setCrashBootHoldForTests } from "@/lib/dirtyBoot";

afterEach(() => {
  __resetTtsSupervisorForTests();
  __setCrashBootHoldForTests(null);
  delete process.env.MAIPAI_TTS_URL;
});

describe("ttsSupervisor getTtsClient()", () => {
  test("reports no backend until the first call", () => {
    expect(getTtsBackendKind()).toBe("none");
  });

  test("falls back to the stub backend when uv spawning is disabled (every test run)", async () => {
    const client = await getTtsClient();
    expect(await client.health()).toBe(true);
    expect(getTtsBackendKind()).toBe("stub");
    // A second call reuses the same cached backend, not a new one.
    const second = await getTtsClient();
    expect(second).toBe(client);
  });

  test("a real, if fake, WAV streams back from the stub-backed synthesize call", async () => {
    const client = await getTtsClient();
    const result = await client.synthesizeStream("hello there");
    expect(result.contentType).toBe("audio/wav");
    // Drains the real stream the same way a browser's reader would,
    // rather than asserting on the ReadableStream object itself.
    const audio = new Uint8Array(await new Response(result.body).arrayBuffer());
    // RIFF/WAVE magic bytes: proves this is a real WAV structure, not an
    // arbitrary byte string standing in for one.
    const header = Buffer.from(audio.slice(0, 12));
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
  });

  test("MAIPAI_TTS_URL points the client at an already-running server without spawning anything", async () => {
    const { startStubTtsServer } = await import("@maipai/spec/voice/ts/stubServer.js");
    const stub = startStubTtsServer();
    try {
      process.env.MAIPAI_TTS_URL = stub.url;
      const client = await getTtsClient();
      expect(getTtsBackendKind()).toBe("url");
      expect(await client.health()).toBe(true);
    } finally {
      stub.stop();
    }
  });
});

describe("restartTtsBackend", () => {
  // A code review (2026-09-04) found restartTtsBackend() cleared the
  // cache but did nothing about a spawn already in flight: that spawn's
  // own `.then()` would later re-install itself into `ttsBackend`,
  // silently undoing the restart. No real timing/sleep needed to prove
  // this deterministically - restartTtsBackend() has no `await` inside,
  // so calling it (without awaiting) between starting and awaiting
  // getTtsClient() runs its whole body synchronously, in the same turn,
  // strictly before the in-flight spawn's `.then()` (always a
  // microtask) gets a chance to fire.
  //
  // A SECOND review pass (2026-09-04, found while building
  // embedSupervisor.ts's identical shape) caught that the first fix
  // wasn't quite enough: the CALLER who started that in-flight spawn -
  // a real, live path here, since saving or removing voice.hf_token
  // calls restartTtsBackend() while an earlier /api/tts request might
  // still be waiting on the household's first-ever spawn - already
  // committed to awaiting its own promise before the restart landed, so
  // it would still receive `.client` bound to the backend just stopped,
  // a dead client rather than a retry. Checking `health()` on the
  // client THIS call actually receives is what distinguishes "cache
  // stays clean" from "the caller also gets something that works": a
  // stopped stub server's `/health` fails.
  test("a caller mid-flight when a restart lands still gets back a real, live client", async () => {
    const clientPromise = getTtsClient();
    void restartTtsBackend();
    const client = await clientPromise;
    expect(await client.health()).toBe(true);
  });
});

// Issue #16: spawnPocketTts() used to have no crash-boot-hold check at
// all, unlike llmSupervisor.ts's/embedSupervisor.ts's own real-spawn
// paths - a household with TTS configured to spawn a real engine got it
// launched immediately after a crash-boot while chat/embed were
// correctly held back. Calls spawnPocketTts() directly (not through
// getTtsClient()/startTtsBackend(), which are gated behind
// MAIPAI_TTS_DISABLE_SPAWN and a real `commandExists("uvx")` check every
// test run) so this proves the hold fires before anything real spawns,
// with no dependency on uv/uvx actually being installed on the machine
// running the suite.
describe("spawnPocketTts crash-boot hold", () => {
  test("refuses to spawn a real pocket-tts process during a crash-boot hold", async () => {
    __setCrashBootHoldForTests(Date.now() + 60_000);
    await expect(spawnPocketTts()).rejects.toThrow(/recovered from an unexpected shutdown/);
  });
});
