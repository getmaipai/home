import { describe, expect, test } from "bun:test";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";
import { cacheRatio, summarize, buildMessages, streamOnce, runBench, type TurnTiming } from "../scripts/bench/latency";
import { percentile } from "../scripts/bench/stats";

// FAST-01: the latency bench's pure math and its wire path, driven
// against the stub engine and one tiny SSE fixture server, so the bench
// itself can never silently rot the way its first version did (it
// imported a function from the wrong module and had never run, and it
// read a cumulative metrics counter as a per-turn number). Real numbers
// only ever come from a real engine; this proves the script measures
// and reports what it claims.

describe("scripts/bench/stats.ts", () => {
  test("percentile picks the nearest-rank value on an unsorted list", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });
});

describe("scripts/bench/latency.ts math", () => {
  test("cache ratio is cached over cached plus processed, and 0 when the engine reported nothing", () => {
    expect(cacheRatio(250, 750)).toBeCloseTo(0.75);
    expect(cacheRatio(0, 0)).toBe(0);
  });

  test("summarize excludes turn 1 (cold by construction) from every figure", () => {
    const timings: TurnTiming[] = [
      { firstDeltaMs: 5000, totalMs: 9000, promptN: 2000, cacheN: 0 },
      { firstDeltaMs: 100, totalMs: 500, promptN: 100, cacheN: 900 },
      { firstDeltaMs: 120, totalMs: 600, promptN: 200, cacheN: 800 },
    ];
    const s = summarize(timings);
    expect(s.turns).toBe(3);
    expect(s.firstDeltaP50).toBe(100);
    expect(s.firstDeltaP95).toBe(120);
    expect(s.meanProcessed).toBe(150);
    expect(s.meanCacheRatio).toBeCloseTo(0.85);
  });
});

describe("scripts/bench/latency.ts prompt layouts", () => {
  test("current layout puts the volatile zone inside the one system message, before the history", () => {
    const msgs = buildMessages("current", "STABLE", 0, "hi", new Date("2026-09-12T15:41:00"));
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content.startsWith("STABLE")).toBe(true);
    expect(msgs[0]!.content).toContain("Local time:");
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(1);
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "hi" });
  });

  test("reordered layout keeps the stable prefix alone and puts the volatile zone after the history", () => {
    const msgs = buildMessages("reordered", "STABLE", 0, "hi", new Date("2026-09-12T15:41:00"));
    expect(msgs[0]).toEqual({ role: "system", content: "STABLE" });
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(2);
    expect(msgs[msgs.length - 2]!.role).toBe("system");
    expect(msgs[msgs.length - 2]!.content).toContain("Local time:");
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "hi" });
  });

  test("the volatile zone changes between turns (rotating bullets), the stable prefix does not", () => {
    const a = buildMessages("reordered", "STABLE", 0, "hi", new Date("2026-09-12T15:41:00"));
    const b = buildMessages("reordered", "STABLE", 1, "hi", new Date("2026-09-12T15:42:00"));
    expect(a[0]).toEqual(b[0]);
    expect(a[a.length - 2]!.content).not.toBe(b[b.length - 2]!.content);
  });
});

/** The smallest server that speaks llama-server's stream shape with a
 * final `timings` chunk, which the stub engine never emits. Optionally
 * sends no content at all, to prove an empty stream is a failed
 * measurement rather than a fast one. */
function startTimingsFixture(opts: { content: boolean }): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch() {
      const frames = [
        ...(opts.content ? ['data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n'] : []),
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"timings":{"prompt_n":143,"cache_n":1157}}\n\n',
        "data: [DONE]\n\n",
      ];
      return new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("scripts/bench/latency.ts wire path", () => {
  test("reads the engine's own prompt_n and cache_n from the final stream chunk", async () => {
    const fixture = startTimingsFixture({ content: true });
    try {
      const t = await streamOnce(fixture.url, buildMessages("reordered", "STABLE", 0, "hi"));
      expect(t.promptN).toBe(143);
      expect(t.cacheN).toBe(1157);
      expect(cacheRatio(t.promptN, t.cacheN)).toBeCloseTo(0.89, 2);
      expect(t.firstDeltaMs).toBeGreaterThan(0);
    } finally {
      fixture.stop();
    }
  });

  test("a stream with no content delta is a failed measurement, never a 0 ms first delta", async () => {
    const fixture = startTimingsFixture({ content: false });
    try {
      await expect(streamOnce(fixture.url, buildMessages("current", "STABLE", 0, "hi"))).rejects.toThrow(/without a single content delta/);
    } finally {
      fixture.stop();
    }
  });

  test("against the stub engine (no timings) a turn still measures, with processed and cached both 0", async () => {
    const stub = startStubLlmServer();
    try {
      const t = await streamOnce(stub.url, buildMessages("current", "STABLE", 0, "hello there"));
      expect(t.firstDeltaMs).toBeGreaterThan(0);
      expect(t.totalMs).toBeGreaterThanOrEqual(t.firstDeltaMs);
      expect(t.promptN).toBe(0);
      expect(t.cacheN).toBe(0);
    } finally {
      stub.stop();
    }
  });

  test("runBench completes every turn and reports a summary", async () => {
    const stub = startStubLlmServer();
    try {
      const s = await runBench(stub.url, "reordered", "STABLE");
      expect(s.turns).toBe(30);
      expect(s.firstDeltaP50).toBeGreaterThan(0);
      expect(s.meanCacheRatio).toBe(0);
    } finally {
      stub.stop();
    }
  });
});
