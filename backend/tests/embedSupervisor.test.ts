import { describe, expect, test, afterEach } from "bun:test";
import { getEmbedClient, getEmbedBackendKind, __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";

afterEach(() => {
  __resetEmbedSupervisorForTests();
  delete process.env.MAIPAI_EMBED_URL;
});

describe("embedSupervisor getEmbedClient()", () => {
  test("reports no backend until the first call", () => {
    expect(getEmbedBackendKind()).toBe("none");
  });

  test("falls back to the stub backend when no engine is installed (every test run)", async () => {
    const client = await getEmbedClient();
    expect(await client.health()).toBe(true);
    expect(getEmbedBackendKind()).toBe("stub");
    // A second call reuses the same cached backend, not a new one.
    const second = await getEmbedClient();
    expect(second).toBe(client);
  });

  test("a real vector comes back from the stub-backed embed call, one per input, in order", async () => {
    const client = await getEmbedClient();
    const response = await client.embed({ model: "embed", input: ["hello", "world"] });
    expect(response.data.length).toBe(2);
    expect(response.data[0]!.embedding.length).toBe(768);
    // Same text always yields the same vector; different text a
    // different one - proves the stub is deterministic, not random.
    const again = await client.embed({ model: "embed", input: ["hello"] });
    expect(again.data[0]!.embedding).toEqual(response.data[0]!.embedding);
    expect(again.data[0]!.embedding).not.toEqual(response.data[1]!.embedding);
  });

  test("MAIPAI_EMBED_URL points the client at an already-running server without spawning anything", async () => {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    try {
      process.env.MAIPAI_EMBED_URL = stub.url;
      const client = await getEmbedClient();
      expect(getEmbedBackendKind()).toBe("url");
      expect(await client.health()).toBe(true);
    } finally {
      stub.stop();
    }
  });

  // A caller who started a spawn already in flight when a reset lands
  // must still get back a real, live client, not one bound to the
  // backend the reset just stopped. restartTtsBackend()-style resets
  // have no `await` inside, so calling __resetEmbedSupervisorForTests()
  // between starting and awaiting getEmbedClient() runs synchronously,
  // strictly before the in-flight spawn's own `.then()` (always a
  // microtask) can fire - the same deterministic microtask-ordering
  // trick ttsSupervisor.test.ts's own equivalent race test uses. A first
  // pass fixed only "the stale backend must never populate the module
  // cache"; a second review pass (2026-09-04) found that alone still let
  // THIS caller's own already-in-flight promise resolve to `.client` of
  // the just-stopped backend - a dead client, not a retry. Checking
  // `health()` on the client this call actually receives is what
  // distinguishes the two: a stopped stub server's `/health` fails.
  test("a caller mid-flight when a reset lands still gets back a real, live client", async () => {
    const clientPromise = getEmbedClient();
    __resetEmbedSupervisorForTests();
    const client = await clientPromise;
    expect(await client.health()).toBe(true);
  });
});

describe("embedSupervisor waitForHealth (via getEmbedClient's stub path)", () => {
  test("the stub server used for embed answers /health like a real llama-server", async () => {
    const client = await getEmbedClient();
    expect(client).toBeInstanceOf(LlamaServerClient);
    expect(await client.health()).toBe(true);
  });
});
