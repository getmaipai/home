// Proves PocketTtsClient against the stub server end to end (real HTTP
// over a real loopback socket, not a mocked fetch): the same client code
// the hub's ttsSupervisor.ts points at a real `pocket-tts serve` when one
// is spawned. See spec/voice/README.md for what this pass covers.
import { describe, expect, test, afterEach } from "bun:test";
import { PocketTtsClient, TtsClientError } from "../../voice/ts/client.js";
import { startStubTtsServer, type StubTtsServerHandle } from "../../voice/ts/stubServer.js";

let handle: StubTtsServerHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
});

describe("PocketTtsClient against the stub server", () => {
  test("health reports healthy once the stub is up", async () => {
    handle = startStubTtsServer();
    const client = new PocketTtsClient(handle.url);
    expect(await client.health()).toBe(true);
  });

  test("health returns false, not a throw, when nothing is listening", async () => {
    const client = new PocketTtsClient("http://127.0.0.1:1");
    expect(await client.health()).toBe(false);
  });

  test("synthesizeStream returns a real, readable WAV stream for the requested text", async () => {
    handle = startStubTtsServer();
    const client = new PocketTtsClient(handle.url);
    const result = await client.synthesizeStream("hello there");
    expect(result.contentType).toBe("audio/wav");
    // Drains the real stream the same way a browser's reader would,
    // rather than asserting on the ReadableStream object itself.
    const audio = new Uint8Array(await new Response(result.body).arrayBuffer());
    expect(Buffer.from(audio.slice(0, 4)).toString("ascii")).toBe("RIFF");
  });

  test("synthesizeStream throws TtsClientError when the server is unreachable", async () => {
    const client = new PocketTtsClient("http://127.0.0.1:1");
    await expect(client.synthesizeStream("hi")).rejects.toThrow(TtsClientError);
  });

  test("synthesizeStream throws TtsClientError on a non-2xx response", async () => {
    const fixtureServer = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 503 }) });
    try {
      const client = new PocketTtsClient(`http://127.0.0.1:${fixtureServer.port}`);
      await expect(client.synthesizeStream("hi")).rejects.toThrow(TtsClientError);
    } finally {
      fixtureServer.stop(true);
    }
  });
});
