// The baseline conversation bench's recording proxy: a Bun.serve() in
// front of the chat engine that forwards every request and keeps, per
// completion request, the system messages the model saw and the tool
// names offered, so "recall in context" is read from what the model
// was actually given, never from the reply. No database import on
// purpose: conversationLive.ts starts it before setup.ts (which must
// load before anything reaches "@/db") reads MAIPAI_LLAMA_SERVER_URL.

export interface RecordedRequest {
  systemText: string;
  tools: string[];
  messages: number;
}

export interface RecordingProxy {
  url: string;
  requests: RecordedRequest[];
  reset(): void;
  stop(): void;
}

/** A Bun.serve() that forwards every request to the real chat engine
 * and keeps, per completion request, the system messages the model saw
 * and the tool names offered. The response streams through untouched. */
export function startRecordingProxy(upstream: string): RecordingProxy {
  const requests: RecordedRequest[] = [];
  const base = upstream.replace(/\/$/, "");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.text() : undefined;
      if (body && url.pathname.endsWith("/chat/completions")) {
        try {
          const parsed = JSON.parse(body) as { messages?: { role: string; content: string }[]; tools?: { function?: { name: string } }[] };
          requests.push({
            systemText: (parsed.messages ?? []).filter((m) => m.role === "system").map((m) => m.content).join("\n"),
            tools: (parsed.tools ?? []).map((t) => t.function?.name ?? "?"),
            messages: parsed.messages?.length ?? 0,
          });
        } catch {
          // a body that is not JSON is forwarded as is
        }
      }
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("content-length");
      const res = await fetch(`${base}${url.pathname}${url.search}`, { method: req.method, headers, body, signal: req.signal });
      return new Response(res.body, { status: res.status, headers: res.headers });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, reset: () => void requests.splice(0), stop: () => server.stop(true) };
}

