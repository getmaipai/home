// HOME-STACK-02b: a tiny scripted Stack, real HTTP (Bun.serve), for the
// llm.ts/tts.ts/stt.ts/voice.ts tests that need to inject a real
// StackClient via __setStackClientForTests() - the same "a real fixture
// server proves the real request, not a mock's assumptions about it"
// posture tts.test.ts's own MAIPAI_TTS_URL fixture already takes.
import { createStackClient, type StackClient } from "@/lib/stack/client";

export type StackFixtureHandler = (req: Request) => Response | Promise<Response>;

export interface StackFixture {
  url: string;
  client: StackClient;
  stop(): void;
}

/** `routes` maps "METHOD path" (e.g. "POST /v1/chat/completions") to a
 * handler; an unmatched request 404s loudly rather than hanging, so a
 * missing route in a test reads as a clear failure. */
export function startStackFixture(routes: Record<string, StackFixtureHandler>): StackFixture {
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return Response.json({ error: `no fixture route for ${req.method} ${url.pathname}` }, { status: 404 });
      return handler(req);
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  return { url, client: createStackClient({ baseUrl: url }), stop: () => server.stop(true) };
}

export const IDENTITY_HEADERS: Record<string, string> = {
  "x-maipai-engine": "local b10797",
  "x-maipai-model": "qwen3-8b-instruct-q4_k_m.gguf",
  "x-maipai-revision": "b10797",
};

export function offlineResponse(role: string, offline_reason: string): Response {
  return Response.json({ error: `the ${role} role is offline`, role, state: "offline", offline_reason }, { status: 503 });
}
