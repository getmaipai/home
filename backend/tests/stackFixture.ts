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
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      req.signal.addEventListener("abort", () => { aborted++; }, { once: true });
      const url = new URL(req.url);
      calls.push(`${req.method} ${url.pathname}`);
      const handler = routes[`${req.method} ${url.pathname}`];
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
    const response = await fetch(`${legacyUpstream ?? engine.url}${path}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" ? undefined : await req.arrayBuffer(),
      ...(legacyUpstream ? { signal: req.signal } : {}),
    });
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
    "POST /v1/embeddings": (req) => withIdentity("/v1/embeddings", req),
    "GET /stack/v1/roles": async () => Response.json({ roles: ["chat", "embed", "judge", "stt", "tts"].map((id) => ({ id, state: { state: "ready", since: "scripted-test" }, reason: null })) }),
    "GET /stack/v1/health": async () => Response.json({ health: [] }),
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
