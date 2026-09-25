import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getBackgroundClient, getBackgroundBackendKind, getBackgroundEngineIdentity, backgroundLaunchArgs, __resetBackgroundSupervisorForTests } from "@/lib/backgroundSupervisor";
import { LlamaServerClient } from "@maipai/spec/llm/ts/client.js";
import { ENGINE_START_STALL_TIMEOUT_MS } from "@/lib/sidecars";
import { listIssues, resolveIssue } from "@/lib/issues";

beforeEach(() => {
  __resetBackgroundSupervisorForTests();
});

afterEach(() => {
  __resetBackgroundSupervisorForTests();
  delete process.env.MAIPAI_BACKGROUND_URL;
});

describe("backgroundSupervisor getBackgroundClient()", () => {
  test("an orphaned startup becomes stalled once, raises Repairs, then clears after retry succeeds", async () => {
    const state = (globalThis as typeof globalThis & {
      __maipai_backgroundSupervisor?: { startingPromise: Promise<never> | null; startingStartedAtMs: number | null; startupStalled: boolean };
    }).__maipai_backgroundSupervisor!;
    const source = "background-engine";
    const key = "startup_stalled";
    state.startingPromise = new Promise<never>(() => {});
    state.startingStartedAtMs = Date.now() - ENGINE_START_STALL_TIMEOUT_MS - 1;
    state.startupStalled = false;
    try {
      expect(getBackgroundBackendKind()).toBe("stalled");
      expect(getBackgroundBackendKind()).toBe("stalled");
      expect(listIssues().filter((issue) => issue.source === source && issue.key === key)).toHaveLength(1);
      const client = await getBackgroundClient();
      expect(await client.health()).toBe(true);
      expect(getBackgroundBackendKind()).toBe("stub");
      expect(listIssues().filter((issue) => issue.source === source && issue.key === key)).toHaveLength(0);
    } finally {
      resolveIssue(source, key);
    }
  });

  test("reports no backend until the first call", () => {
    expect(getBackgroundBackendKind()).toBe("none");
  });

  test("falls back to the stub backend when no engine is installed", async () => {
    const client = await getBackgroundClient();
    expect(await client.health()).toBe(true);
    expect(getBackgroundBackendKind()).toBe("stub");
    const second = await getBackgroundClient();
    expect(second).toBe(client);
  });

  test("MAIPAI_BACKGROUND_URL points the client at an already-running server without spawning anything", async () => {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer();
    try {
      process.env.MAIPAI_BACKGROUND_URL = stub.url;
      const client = await getBackgroundClient();
      expect(getBackgroundBackendKind()).toBe("url");
      expect(await client.health()).toBe(true);
    } finally {
      await stub.stop();
    }
  });

  test("ENGINE-HOST-01: the URL tier reads the engine's identity (build, model file, health) and spawns nothing", async () => {
    const fake = Bun.serve({
      port: 0,
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path === "/props") return Response.json({ build_info: "b10797-832fd6f17", model_path: "/srv/models/qwen3-4b-q4-k-m.gguf" });
        return new Response("not found", { status: 404 });
      },
    });
    try {
      process.env.MAIPAI_BACKGROUND_URL = `http://127.0.0.1:${fake.port}`;
      await getBackgroundClient();
      expect(getBackgroundBackendKind()).toBe("url");
      expect(getBackgroundEngineIdentity()).toEqual({ host: "local", build: "b10797-832fd6f17", model: "qwen3-4b-q4-k-m.gguf", healthy: true });
    } finally {
      fake.stop(true);
    }
  });

  test("a caller mid-flight when a reset lands still gets back a real, live client", async () => {
    const clientPromise = getBackgroundClient();
    __resetBackgroundSupervisorForTests();
    const client = await clientPromise;
    expect(await client.health()).toBe(true);
  });
});

describe("backgroundSupervisor completeBackground()", () => {
  // BENCH-01: the bench's pinned seed reaches the judge's requests too,
  // and an unpinned request carries none.
  test("carries the bench's pinned sampler seed, and none otherwise", async () => {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const { __setSamplingSeedForBench } = await import("@/lib/benchSampling");
    const seen: Array<number | undefined> = [];
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => {
        seen.push(request.seed);
        return undefined;
      },
    });
    process.env.MAIPAI_BACKGROUND_URL = stub.url;
    try {
      const { completeBackground } = await import("@/lib/backgroundSupervisor");
      expect((await completeBackground([{ role: "user", content: "hello" }])).ok).toBe(true);
      __setSamplingSeedForBench(7);
      expect((await completeBackground([{ role: "user", content: "hello" }])).ok).toBe(true);
      expect(seen).toEqual([undefined, 7]);
    } finally {
      __setSamplingSeedForBench(null);
      await stub.stop();
    }
  });

  test("returns unavailable when the background URL is dead", async () => {
    process.env.MAIPAI_BACKGROUND_URL = "http://127.0.0.1:9999";
    const result = await import("@/lib/backgroundSupervisor").then((m) => m.completeBackground([{ role: "user", content: "hello" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unavailable).toBe(true);
    }
  });
});

describe("backgroundAssets", () => {
  test("BACKGROUND_MODEL_SHA256 is 64 hex characters", async () => {
    const { BACKGROUND_MODEL_SHA256 } = await import("@/lib/backgroundAssets");
    expect(BACKGROUND_MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  // MEM-05: the 4B is the household default; the 1.7B is the small
  // alternative behind MAIPAI_BACKGROUND_MODEL=qwen3-1.7b.
  test("the default background model is the 4B; MAIPAI_BACKGROUND_MODEL=qwen3-1.7b selects the small one", async () => {
    const { backgroundModelPath, BACKGROUND_MODEL_FILE, BACKGROUND_MODEL_SMALL_FILE } = await import("@/lib/backgroundAssets");
    delete process.env.MAIPAI_BACKGROUND_MODEL;
    expect(backgroundModelPath()).toContain(BACKGROUND_MODEL_FILE);
    expect(BACKGROUND_MODEL_FILE).toBe("qwen3-4b-q4-k-m.gguf");
    process.env.MAIPAI_BACKGROUND_MODEL = "qwen3-1.7b";
    try {
      expect(backgroundModelPath()).toContain(BACKGROUND_MODEL_SMALL_FILE);
    } finally {
      delete process.env.MAIPAI_BACKGROUND_MODEL;
    }
  });
});

// #97: the background engine grew to 11 GB over a day of judge runs
// because llama-server's server-side prompt cache (default 8192 MiB)
// kept the KV state of every distinct judge prompt. The launch line
// disables it and carries no --cache-reuse (nothing to reuse from).
describe("backgroundLaunchArgs() (#97)", () => {
  test("launches with --cache-ram 0 and no --cache-reuse, at 8192 context and the given GPU layers", () => {
    const args = backgroundLaunchArgs("/bin/llama-server", "/models/judge.gguf", 8789, 0);
    // The whole line: the rest is what spawnBackgroundServer() has always passed.
    expect(args).toEqual(["/bin/llama-server", "--model", "/models/judge.gguf", "--port", "8789", "--host", "127.0.0.1", "-c", "8192", "-ngl", "0", "-t", "4", "-fa", "on", "--reasoning", "off", "--jinja", "--no-webui", "--metrics", "--cache-ram", "0"]);
    expect(args).not.toContain("--cache-reuse");
  });
});
