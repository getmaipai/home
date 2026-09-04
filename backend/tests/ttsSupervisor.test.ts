import { describe, expect, test, afterEach } from "bun:test";
import { getTtsClient, getTtsBackendKind, waitForHealth, __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { PocketTtsClient } from "@maipai/spec/voice/ts/client.js";

afterEach(() => {
  __resetTtsSupervisorForTests();
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

describe("waitForHealth", () => {
  // A code review (2026-09-04) found the original version had no
  // visibility into whether the spawned process had already died,
  // polling client.health() for the entire timeout regardless - a
  // real, if fast, child process that genuinely exits (not a mock of
  // Bun.Subprocess) proves the fast-fail path fires in well under the
  // timeout, not just that the logic looks right on paper.
  test("fails fast, not after the full timeout, once the process has already exited", async () => {
    const proc = Bun.spawn(["sh", "-c", "exit 1"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited; // guarantee the exit has actually landed before polling starts
    const client = new PocketTtsClient("http://127.0.0.1:1"); // never healthy
    const started = Date.now();
    await expect(waitForHealth(client, 60_000, proc)).rejects.toThrow(/exited early/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("still succeeds normally when the process stays alive and becomes healthy", async () => {
    const { startStubTtsServer } = await import("@maipai/spec/voice/ts/stubServer.js");
    const stub = startStubTtsServer();
    const proc = Bun.spawn(["sleep", "5"], { stdout: "ignore", stderr: "ignore" });
    try {
      const client = new PocketTtsClient(stub.url);
      await expect(waitForHealth(client, 5_000, proc)).resolves.toBeUndefined();
    } finally {
      proc.kill();
      stub.stop();
    }
  });
});
