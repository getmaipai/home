// HOME-STACK-02b: a tiny scripted Stack, real HTTP (Bun.serve), for the
// llm.ts/tts.ts/stt.ts/voice.ts tests that need to inject a real
// StackClient via __setStackClientForTests() - the same "a real fixture
// server proves the real request, not a mock's assumptions about it"
// posture tts.test.ts's own MAIPAI_TTS_URL fixture already takes.
import { createStackClient, type StackClient } from "@/lib/stack/client";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { startStubLlmServer } from "@maipai/spec/llm/ts/stubServer.js";

export type StackFixtureHandler = (req: Request) => Response | Promise<Response>;

export interface StackFixture {
  url: string;
  client: StackClient;
  calls: string[];
  aborted(): number;
  stop(): void;
}

/** `routes` maps "METHOD path" (e.g. "POST /v1/chat/completions") to a
 * handler; an unmatched request 404s loudly rather than hanging, so a
 * missing route in a test reads as a clear failure. */
export function startStackFixture(routes: Record<string, StackFixtureHandler>): StackFixture {
  const calls: string[] = [];
  let aborted = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: async (req) => {
      req.signal.addEventListener("abort", () => { aborted++; }, { once: true });
      const url = new URL(req.url);
      calls.push(`${req.method} ${url.pathname}`);
      const handler = routes[`${req.method} ${url.pathname}`] ?? routes["*"];
      if (!handler) return Response.json({ error: `no fixture route for ${req.method} ${url.pathname}` }, { status: 404 });
      return handler(req);
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return { url, client: createStackClient({ baseUrl: url }), calls, aborted: () => aborted, stop: () => server.stop(true) };
}

export const IDENTITY_HEADERS: Record<string, string> = {
  "x-maipai-engine": "local b10797",
  "x-maipai-model": "qwen3-8b-instruct-q4_k_m.gguf",
  "x-maipai-revision": "b10797",
};

export function offlineResponse(role: string, offline_reason: string): Response {
  return Response.json({ error: `the ${role} role is offline`, role, state: "offline", offline_reason }, { status: 503 });
}

/** Default whole-suite scripted Stack. Its OpenAI-shaped engine uses the
 * same deterministic chat and embedding behavior as the deleted in-process
 * stubs, while the wrapper adds Stack identity headers. */
export function startDefaultScriptedStack(): StackFixture {
  const engine = startStubLlmServer(0);
  const now = new Date().toISOString();
  const scriptedJob = (id: string, state: "queued" | "done" | "cancelled" = "done") => ({
    id, kind: "image", role: "image", state, percent: state === "done" ? 100 : 0,
    completedBytes: 0, totalBytes: 0, status: state, position: null,
    input: { prompt: "a scripted image" }, result: state === "done" ? { images: [{ b64_json: "aGVsbG8=" }] } : null,
    reason: null, createdAt: now, updatedAt: now,
  });
  const unknownRange = { low: null, high: null, source: "unknown", as_of: now.slice(0, 10) };
  const updates = { checksEnabled: false, engines: [], models: { lastChecked: null, entries: [] }, recommendations: [] };
  const delayedStream = (req: Request): Response => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n'));
        const timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"A delayed answer."},"finish_reason":null}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }, 10_000);
        req.signal.addEventListener("abort", () => { clearTimeout(timer); controller.close(); }, { once: true });
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "x-maipai-engine": "local scripted-test", "x-maipai-model": "scripted-stub", "x-maipai-revision": "scripted-test" } });
  };
  const withIdentity = async (path: string, req: Request): Promise<Response> => {
    // A few turn tests install a controllable upstream stub through the
    // legacy URL. Proxying through it keeps their abort observation real
    // while the public call still goes through the Stack client.
    const legacyUpstream = path === "/v1/chat/completions" ? process.env.MAIPAI_LLAMA_SERVER_URL : undefined;
    const request = {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" ? undefined : await req.arrayBuffer(),
      ...(legacyUpstream ? { signal: req.signal } : {}),
    };
    let response: Response;
    try {
      response = await fetch(`${legacyUpstream ?? engine.url}${path}`, request);
    } catch {
      // A test may stop its per-test upstream while a proxied request is
      // still winding down. Model the Stack's ordinary upstream failure.
      return Response.json({ error: "engine unavailable" }, { status: 502 });
    }
    const headers = new Headers(response.headers);
    headers.set("x-maipai-engine", "local scripted-test");
    headers.set("x-maipai-model", "scripted-stub");
    headers.set("x-maipai-revision", "scripted-test");
    return new Response(response.body, { status: response.status, headers });
  };
  const fixture = startStackFixture({
    "POST /v1/chat/completions": async (req) => {
      const body = await req.clone().json().catch(() => null) as { messages?: Array<{ content?: unknown }> } | null;
      if (body?.messages?.some((message) => typeof message.content === "string" && message.content.includes("wait for me"))) return delayedStream(req);
      return withIdentity("/v1/chat/completions", req);
    },
    "POST /v1/embeddings": async (req) => {
      const body = await req.json().catch(() => null) as { input?: string | string[] } | null;
      const inputs = Array.isArray(body?.input) ? body.input : [body?.input ?? ""];
      return Response.json({ object: "list", model: "scripted-embedding", data: inputs.map((_text, index) => ({ object: "embedding", index, embedding: Array.from({ length: 8 }, (_, i) => (index + i + 1) / 100) })) }, { headers: IDENTITY_HEADERS });
    },
    // THIN-3B: the Stack's token count, answered by the spec stub's own
    // deterministic template and tokenizer.
    "POST /v1/tokenize": (req) => withIdentity("/v1/tokenize", req),
    "POST /v1/audio/transcriptions": async () => Response.json({ text: "the scripted transcription" }, { headers: IDENTITY_HEADERS }),
    "POST /v1/audio/speech": async () => new Response(new Uint8Array(44), { headers: { "content-type": "audio/wav", ...IDENTITY_HEADERS } }),
    "POST /v1/images/generations": async () => Response.json({ created: 1, job: "scripted-image", data: [] }, { status: 202, headers: IDENTITY_HEADERS }),
    "GET /stack/v1/roles": async () => Response.json({ roles: ["chat", "embed", "judge", "stt", "tts"].map((id) => ({ id, state: { state: "ready", since: "scripted-test" }, reason: null })) }),
    "GET /stack/v1/health": async () => Response.json({ health: [] }),
    "*": async (req) => {
      const { pathname } = new URL(req.url);
      const method = req.method;
      if (pathname === "/healthz") return Response.json({ ok: true, version: "scripted-test", uptimeSeconds: 1 });
      if (pathname === "/stack/v1/jobs" && method === "GET") return Response.json({ jobs: [] });
      if (pathname === "/stack/v1/jobs" && method === "POST") return Response.json({ job: scriptedJob("scripted-job", "queued") }, { status: 202 });
      if (pathname.startsWith("/stack/v1/jobs/")) {
        const id = decodeURIComponent(pathname.slice("/stack/v1/jobs/".length));
        return Response.json({ job: scriptedJob(id, method === "DELETE" ? "cancelled" : "done") });
      }
      if (pathname === "/stack/v1/engines") return Response.json({ engines: [] });
      if (pathname === "/stack/v1/models") return Response.json({ models: [] });
      if (pathname === "/stack/v1/health") return Response.json({ health: [] });
      if (pathname === "/stack/v1/settings" || pathname === "/stack/v1/settings/apply") return Response.json({ sections: [], settings: [] });
      if (pathname === "/stack/v1/search/preview" || pathname === "/stack/v1/search/revert") return Response.json({ ok: true, enabled: false });
      if (pathname === "/stack/v1/hardware/budget") return Response.json({ totalMemoryBytes: 0, capBytes: 0, freeMemoryBytes: 0, availablePercent: 0, pressure: "normal", memoryReadingDegraded: true, loaded: [], queue: [] });
      if (pathname === "/stack/v1/hardware") return Response.json({});
      if (pathname === "/stack/v1/fit-plan") return Response.json({ schema: 1, model: "scripted-model", context_tokens: 1, kv_cache_type: "f16", roles: [], total: unknownRange, cap: unknownRange, margin: unknownRange, paths: [{ path: "cpu", fits: false, verdict: "unknown" }], verdict: "unknown", bottleneck: "unknown" });
      if (pathname === "/stack/v1/updates" || pathname === "/stack/v1/updates/check") return Response.json(updates);
      if (/^\/stack\/v1\/updates\/engines\/[^/]+\/(apply|rollback)$/.test(pathname)) return Response.json(pathname.endsWith("/apply") ? { applied: true, tag: "scripted", previous: null } : { ok: true, tag: "scripted" });
      if (pathname === "/stack/v1/storage/sweep") return Response.json({ removed: [] });
      if (pathname === "/stack/v1/check") return Response.json({ at: now, ok: true, results: [], fitTogether: { ok: true, reason: null }, reason: null, generation: 1 });
      if (pathname.startsWith("/stack/v1/")) return Response.json({ ok: true });
      return Response.json({ error: `no scripted Stack route for ${method} ${pathname}` }, { status: 404 });
    },
  });
  return { ...fixture, stop: () => { fixture.stop(); void engine.stop(); } };
}

let defaultStackClient: StackClient | null = null;
let defaultStackFixture: StackFixture | null = null;
export function setDefaultScriptedStackFixture(fixture: StackFixture): void { defaultStackFixture = fixture; defaultStackClient = fixture.client; }
export function getDefaultScriptedStack(): StackFixture {
  if (!defaultStackFixture) throw new Error("default scripted Stack fixture is not installed");
  return defaultStackFixture;
}
export function restoreDefaultScriptedStack(): void { __setStackClientForTests(defaultStackClient); }
export function useDefaultScriptedStack(): void {
  __setStackClientForTests(defaultStackClient);
}
