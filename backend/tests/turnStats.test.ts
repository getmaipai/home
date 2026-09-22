import { afterEach, describe, expect, test } from "bun:test";
import { startCompleteStream } from "@/lib/llm";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { buildTurnStats } from "@/lib/turnStats";
import { emptyTimings } from "@/lib/turnContext";

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function scriptedEngine() {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/health") return Response.json({ status: "ok" });
      if (path === "/props") return Response.json({ build_info: "b10797-test", model_path: "/models/family.gguf" });
      if (path === "/v1/chat/completions") {
        const body = [
          `data: ${JSON.stringify({ id: "turn", model: "chat", choices: [{ index: 0, delta: { content: "Hello." }, finish_reason: null }] })}\n\n`,
          `data: ${JSON.stringify({ id: "turn", model: "chat", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 143, completion_tokens: 37, total_tokens: 180 }, timings: { prompt_n: 143, cache_n: 1157, predicted_n: 37, predicted_ms: 200, predicted_per_second: 185 } })}\n\n`,
          "data: [DONE]\n\n",
        ].join("");
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("STATS-01 turn stats", () => {
  test("a scripted final stream chunk preserves usage, timings, and stop reason", async () => {
    const engine = scriptedEngine();
    process.env.MAIPAI_LLAMA_SERVER_URL = engine.url;
    try {
      const started = await startCompleteStream("chat", [{ role: "user", content: "hello" }]);
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      for await (const _delta of started.tokens) {
        // consume the body so the final telemetry frame is observed
      }
      const stats = buildTurnStats(started.stats, { ...emptyTimings(), first_token_ms: 120 }, 100, 1_000, { host: "local", build: "b10797-test", model: "family.gguf", healthy: true }, true);
      expect(stats.prompt_tokens).toBe(143);
      expect(stats.predicted_tokens).toBe(37);
      expect(stats.tokens_per_second).toBe(185);
      expect(stats.time_to_first_token_ms).toBe(120);
      expect(stats.total_time_ms).toBe(900);
      expect(stats.cache_reuse_tokens).toBe(1157);
      expect(stats.cache_reuse_percent).toBeCloseTo(89.0, 1);
      expect(stats.engine).toBe("local b10797-test family.gguf");
      expect(stats.stop_reason).toBe("stop");
      expect(stats.thinking).toBe(true);
    } finally {
      engine.stop();
    }
  });

  test("a stream without timing data yields nulls, never NaN", () => {
    const stats = buildTurnStats({ usage: null, timings: null, stopReason: null }, { ...emptyTimings(), first_token_ms: null }, 100, 90, null, undefined);
    expect(stats.prompt_tokens).toBeNull();
    expect(stats.predicted_tokens).toBeNull();
    expect(stats.tokens_per_second).toBeNull();
    expect(stats.time_to_first_token_ms).toBeNull();
    expect(stats.total_time_ms).toBeNull();
    expect(stats.cache_reuse_tokens).toBeNull();
    expect(stats.cache_reuse_percent).toBeNull();
    expect(stats.thinking).toBe(false);
    expect(Object.values(stats).every((value) => typeof value !== "number" || Number.isFinite(value))).toBe(true);
  });
});
