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
  /** The model's own raw text for this request (the SSE deltas'
   * content, or the non-streamed message), before any guard: what a
   * replaced reply actually said. */
  responseText: string;
}

export interface RecordingProxy {
  url: string;
  requests: RecordedRequest[];
  reset(): void;
  /** Resolves once every teed reply has been read to its end. */
  settled(): Promise<void>;
  stop(): void;
}

/** The content of an OpenAI-shaped reply, streamed (SSE `data:` lines
 * with `choices[0].delta.content`) or not (`choices[0].message.content`). */
export function extractModelText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { choices?: { message?: { content?: string | null } }[] };
      return parsed.choices?.[0]?.message?.content ?? "";
    } catch {
      return "";
    }
  }
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string | null } }[] };
      text += parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      // a keepalive or a partial line
    }
  }
  return text;
}

/** A Bun.serve() that forwards every request to the real chat engine
 * and keeps, per completion request, the system messages the model saw
 * and the tool names offered. The response streams through untouched. */
export function startRecordingProxy(upstream: string): RecordingProxy {
  const requests: RecordedRequest[] = [];
  const pending = new Set<Promise<void>>();
  const base = upstream.replace(/\/$/, "");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.text() : undefined;
      // The record is captured here, before the upstream await, so two
      // completions in flight (a background summary beside the turn's
      // own) each keep their own reply text (a review).
      let recorded: RecordedRequest | undefined;
      if (body && url.pathname.endsWith("/chat/completions")) {
        try {
          const parsed = JSON.parse(body) as { messages?: { role: string; content: string }[]; tools?: { function?: { name: string } }[] };
          recorded = {
            systemText: (parsed.messages ?? []).filter((m) => m.role === "system").map((m) => m.content).join("\n"),
            tools: (parsed.tools ?? []).map((t) => t.function?.name ?? "?"),
            messages: parsed.messages?.length ?? 0,
            responseText: "",
          };
          requests.push(recorded);
        } catch {
          // a body that is not JSON is forwarded as is
        }
      }
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("content-length");
      const res = await fetch(`${base}${url.pathname}${url.search}`, { method: req.method, headers, body, signal: req.signal });
      if (!recorded || !res.body) return new Response(res.body, { status: res.status, headers: res.headers });
      const record = recorded;
      // Forward every chunk untouched and keep the text as it passes: a
      // transform on the one stream, not a tee (a tee's second branch
      // crashed the process with "null is not an object" when the bench
      // aborted the client side for the interruption row). The text is
      // updated per chunk, so an aborted reply still records what came.
      // Incremental: only the lines a chunk completes are parsed (a review
      // found the whole buffer re-parsed per chunk, O(n^2) on a long
      // reply, on the same machine whose timings the bench reports).
      let tail = "";
      let text = "";
      let nonStream = "";
      const streamed = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      const decoder = new TextDecoder();
      let finish: () => void = () => undefined;
      const reading = new Promise<void>((resolve) => (finish = resolve));
      pending.add(reading);
      void reading.finally(() => pending.delete(reading));
      const recordingStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const piece = decoder.decode(chunk, { stream: true });
          if (streamed) {
            tail += piece;
            const lines = tail.split("\n");
            tail = lines.pop() ?? "";
            text += extractModelText(lines.join("\n"));
            record.responseText = text;
          } else {
            nonStream += piece;
          }
          controller.enqueue(chunk);
        },
        flush() {
          record.responseText = streamed ? text + extractModelText(tail) : extractModelText(nonStream);
          finish();
        },
      });
      // An aborted client (the interruption row) cancels the pipe without
      // a flush, and an upstream body that errors mid-stream flushes
      // nothing either: the abort signal and a bounded wait in settled()
      // keep the bench from hanging on the record.
      req.signal.addEventListener("abort", () => finish(), { once: true });
      return new Response(res.body.pipeThrough(recordingStream), { status: res.status, headers: res.headers });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    reset: () => void requests.splice(0),
    settled: async () => void (await Promise.race([Promise.all([...pending]), new Promise<void>((resolve) => setTimeout(resolve, 5_000))])),
    stop: () => server.stop(true),
  };
}

