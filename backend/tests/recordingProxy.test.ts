import { afterEach, describe, expect, test } from "bun:test";
import { startRecordingProxy } from "../scripts/bench/recordingProxy";

const servers: { stop: (closeActiveConnections?: boolean) => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  delete process.env.MAIPAI_BENCH_UPSTREAM;
});

function scriptedUpstream(healthOk: boolean) {
  const received: { path: string; body?: unknown }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = req.method === "POST" ? await req.json() : undefined;
      received.push({ path, body });
      if (path === "/healthz") return Response.json({ ok: healthOk }, { status: healthOk ? 200 : 503 });
      return Response.json({ received: body }, { status: 404 });
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, received };
}

describe("recording proxy Stack adapter", () => {
  test("adapts health only when the Stack flag is enabled", async () => {
    process.env.MAIPAI_BENCH_UPSTREAM = "stack";
    const ok = scriptedUpstream(true);
    const proxy = startRecordingProxy(ok.url);
    servers.push({ stop: () => proxy.stop() });
    const response = await fetch(`${proxy.url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(ok.received[0]?.path).toBe("/healthz");

    const down = scriptedUpstream(false);
    const failingProxy = startRecordingProxy(down.url);
    servers.push({ stop: () => failingProxy.stop() });
    const failed = await fetch(`${failingProxy.url}/health`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "error" });
  });

  test("rewrites judge, other chat models, and embeddings", async () => {
    process.env.MAIPAI_BENCH_UPSTREAM = "stack";
    const upstream = scriptedUpstream(true);
    const proxy = startRecordingProxy(upstream.url);
    servers.push({ stop: () => proxy.stop() });
    for (const [path, model] of [
      ["/v1/chat/completions", "background"],
      ["/v1/chat/completions", "some-home-model"],
      ["/v1/embeddings", "some-home-embed-model"],
    ]) {
      await fetch(`${proxy.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: "test" }),
      });
    }
    expect(upstream.received.map((entry) => (entry.body as { model: string }).model)).toEqual(["judge", "chat", "embed"]);
  });

  test("flag off preserves health pass-through and request model", async () => {
    delete process.env.MAIPAI_BENCH_UPSTREAM;
    const upstream = scriptedUpstream(true);
    const proxy = startRecordingProxy(upstream.url);
    servers.push({ stop: () => proxy.stop() });
    const health = await fetch(`${proxy.url}/health`);
    expect(health.status).toBe(404);
    const model = "original-home-model";
    await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    expect((upstream.received.at(-1)?.body as { model: string }).model).toBe(model);
  });
});
