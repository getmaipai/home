import { describe, expect, test } from "bun:test";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";
import { cacheRatio, summarize, buildMessages, streamOnce, runBench, syntheticActor, syntheticMatches, type TurnTiming, type PromptBuilders } from "../scripts/bench/latency";
import { percentile } from "../scripts/bench/stats";
import { buildSystemPrompt, buildPromptParts } from "@/lib/turnEngine";

// FAST-01 and FAST-02: the latency bench's pure math, its prompt layouts
// driven through the REAL assembly functions (the same code path main()
// uses, so a wrong layout fails here rather than in a live run), and its
// wire path against the stub engine and one tiny SSE fixture server.
// Real numbers only ever come from a real engine; this proves the script
// measures and reports what it claims.

/** A fake pair of builders whose output is inspectable, for the layout
 * tests that care about message order rather than prompt text. */
const fakeBuilders: PromptBuilders = {
  buildSystemPrompt: (_actor, text, matches) => `SYSTEM+CONTEXT for ${text} with ${matches.length} bullets: ${matches.map((m) => m.record.text).join(" | ")}`,
  buildPromptParts: (_actor, text, matches) => ({ stablePrefix: "STABLE", context: `CONTEXT for ${text}: ${matches.map((m) => m.record.text).join(" | ")}` }),
};

const realBuilders: PromptBuilders = { buildSystemPrompt, buildPromptParts };

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
  test("single-message layout puts the whole assembled prompt in one system message ahead of the history", () => {
    const msgs = buildMessages("single-message", fakeBuilders, 0, "hi");
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content.startsWith("SYSTEM+CONTEXT for hi with 3 bullets")).toBe(true);
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(1);
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "hi" });
  });

  test("reordered layout keeps the stable prefix alone and puts the context after the history, before the turn", () => {
    const msgs = buildMessages("reordered", fakeBuilders, 0, "hi");
    expect(msgs[0]).toEqual({ role: "system", content: "STABLE" });
    expect(msgs.filter((m) => m.role === "system")).toHaveLength(2);
    expect(msgs[msgs.length - 2]!.role).toBe("system");
    expect(msgs[msgs.length - 2]!.content.startsWith("CONTEXT for hi")).toBe(true);
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "hi" });
  });

  test("no two turns send the same context: every bullet is salted with the turn number", () => {
    const a = buildMessages("reordered", fakeBuilders, 0, "hi");
    const b = buildMessages("reordered", fakeBuilders, 8, "hi");
    expect(a[0]).toEqual(b[0]);
    expect(a[a.length - 2]!.content).not.toBe(b[b.length - 2]!.content);
    expect(syntheticMatches(3).map((m) => m.record.text).every((t) => t.endsWith("(mentioned in chat 4)"))).toBe(true);
  });

  test("through the real assembly: the reordered layout is the stable prefix, the history, a late context message, the turn", () => {
    const msgs = buildMessages("reordered", realBuilders, 2, "what's on the list");
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).not.toContain("Local time:");
    expect(msgs[0]!.content).not.toContain("Things this household has set up");
    const context = msgs[msgs.length - 2]!;
    expect(context.role).toBe("system");
    expect(context.content).toContain("Local time:");
    expect(context.content).toContain("Pippa likes painting (mentioned in chat 3)");
    expect(msgs[msgs.length - 1]).toEqual({ role: "user", content: "what's on the list" });
    // And the same actor and bullets through the single-message stand-in
    // land in ONE system message ahead of the history.
    const single = buildMessages("single-message", realBuilders, 2, "what's on the list");
    expect(single.filter((m) => m.role === "system")).toHaveLength(1);
    expect(single[0]!.content).toContain("Local time:");
    expect(syntheticActor().displayName).toBe("alfred");
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
      const t = await streamOnce(fixture.url, buildMessages("reordered", fakeBuilders, 0, "hi"));
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
      await expect(streamOnce(fixture.url, buildMessages("single-message", fakeBuilders, 0, "hi"))).rejects.toThrow(/without a single content delta/);
    } finally {
      fixture.stop();
    }
  });

  test("against the stub engine (no timings) a turn still measures, with processed and cached both 0", async () => {
    const stub = startStubLlmServer();
    try {
      const t = await streamOnce(stub.url, buildMessages("single-message", fakeBuilders, 0, "hello there"));
      expect(t.firstDeltaMs).toBeGreaterThan(0);
      expect(t.totalMs).toBeGreaterThanOrEqual(t.firstDeltaMs);
      expect(t.promptN).toBe(0);
      expect(t.cacheN).toBe(0);
    } finally {
      await stub.stop();
    }
  });

  test("runBench completes every turn through the real assembly and reports a summary", async () => {
    const stub = startStubLlmServer();
    try {
      const s = await runBench(stub.url, "reordered", realBuilders);
      expect(s.turns).toBe(30);
      expect(s.firstDeltaP50).toBeGreaterThan(0);
      expect(s.meanCacheRatio).toBe(0);
    } finally {
      await stub.stop();
    }
  });
});
