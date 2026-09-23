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
  /** URLs in the tool-result messages of a composition (CHAT-16's
   * composer phrasing a lookup's rows), or in a one-shot completion
   * with no system message (a recipe's own `llm_complete`): a lookup's
   * evidence reaching the model, never a URL the person typed into the
   * turn's own prompt (the effect standard's C2 row). */
  sourceUrls: string[];
  /** The upstream reply was read to its end (its stream flushed). */
  completed: boolean;
  /** The client aborted the request before the upstream reply ended. */
  aborted: boolean;
  /** GROUND-01's live rerun (ENGINE-CONTRACT-01's ruling, dev.md
   * 2026-09-23): the request's own `tool_choice`, `undefined` when the
   * request didn't send one - read here, not reconstructed later, so
   * "was this call forced" is never guessed from context. */
  toolChoice?: string;
  /** Whether the reply carried at least one tool call, streamed or not -
   * `required_honored` for a request whose `toolChoice` was `"required"`
   * is exactly this flag; false on a `tool_choice: "required"` reply
   * that answered in plain text instead is ENGINE-CONTRACT-01's own
   * defect, caught here at the wire, never inferred from the trace. */
  hasToolCalls: boolean;
  /** llama-server's own OpenAI-shaped extension,
   * `usage.prompt_tokens_details.cached_tokens` - `undefined` when the
   * engine's response carried no `usage` at all (the test stub, an
   * older engine). */
  cachedTokens?: number;
  /** `usage.prompt_tokens` - `undefined` on the same terms as
   * `cachedTokens`. */
  promptTokens?: number;
}

export interface RecordingProxy {
  url: string;
  requests: RecordedRequest[];
  /** LOOKUP-02: the next ordinary completion (never a forced one under
   * `tool_choice: required`, which still goes to the engine so the
   * real model picks the rung) answers with this text in the engine's
   * own wire shape, so a fixture's `seedReply` is a draft that goes
   * through the reply boundary like any model reply (the read, the
   * forced lookup, the guards), never a reply pasted past it. */
  scriptNextReply(text: string): void;
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

export interface ModelMeta {
  hasToolCalls: boolean;
  cachedTokens?: number;
  promptTokens?: number;
}

/** ENGINE-CONTRACT-01's own rerun harness (dev.md 2026-09-23): whether
 * a reply carried a tool call (streamed as `delta.tool_calls` fragments,
 * or `message.tool_calls` whole on a non-streamed reply) and the
 * engine's own cache telemetry, read the same line-by-line way
 * extractModelText() already does - never a second SSE parser, just a
 * second thing read off the same lines. `usage` typically arrives only
 * on the final chunk/object, so the last one seen wins. */
export function extractModelMeta(raw: string): ModelMeta {
  const trimmed = raw.trim();
  type Usage = { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  let hasToolCalls = false;
  let usage: Usage | undefined;
  const consider = (parsed: { choices?: { delta?: { tool_calls?: unknown[] }; message?: { tool_calls?: unknown[] } }[]; usage?: Usage }) => {
    const choice = parsed.choices?.[0];
    if ((choice?.delta?.tool_calls?.length ?? 0) > 0 || (choice?.message?.tool_calls?.length ?? 0) > 0) hasToolCalls = true;
    if (parsed.usage) usage = parsed.usage;
  };
  if (trimmed.startsWith("{")) {
    try {
      consider(JSON.parse(trimmed));
    } catch {
      // not JSON - nothing to read
    }
  } else {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        consider(JSON.parse(payload));
      } catch {
        // a keepalive or a partial line
      }
    }
  }
  return { hasToolCalls, cachedTokens: usage?.prompt_tokens_details?.cached_tokens, promptTokens: usage?.prompt_tokens };
}

/** A Bun.serve() that forwards every request to the real chat engine
 * and keeps, per completion request, the system messages the model saw
 * and the tool names offered. The response streams through untouched. */
export function startRecordingProxy(upstream: string): RecordingProxy {
  const requests: RecordedRequest[] = [];
  const pending = new Set<Promise<void>>();
  let scripted: string | null = null;
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
      let parsedBody: { messages?: { role: string; content: string }[]; tools?: { function?: { name: string } }[]; tool_choice?: string; stream?: boolean; model?: string } | undefined;
      if (body && url.pathname.endsWith("/chat/completions")) {
        try {
          const parsed = JSON.parse(body) as NonNullable<typeof parsedBody>;
          parsedBody = parsed;
          recorded = {
            systemText: (parsed.messages ?? []).filter((m) => m.role === "system").map((m) => m.content).join("\n"),
            tools: (parsed.tools ?? []).map((t) => t.function?.name ?? "?"),
            messages: parsed.messages?.length ?? 0,
            responseText: "",
            sourceUrls: (parsed.messages ?? []).some((m) => m.role === "tool")
              ? (parsed.messages ?? []).filter((m) => m.role === "tool" && typeof m.content === "string").flatMap((m) => m.content.match(/https?:\/\/[^\s"'<>)\]\\]+/g) ?? [])
              : (parsed.messages ?? []).some((m) => m.role === "system")
                ? []
                : (parsed.messages ?? []).filter((m) => typeof m.content === "string").flatMap((m) => m.content.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []),
            completed: false,
            aborted: false,
            toolChoice: parsed.tool_choice,
            hasToolCalls: false,
          };
          requests.push(recorded);
        } catch {
          // a body that is not JSON is forwarded as is
        }
      }
      // The scripted draft (seedReply): the engine's own wire shape,
      // streamed or not as the request asked, recorded like a reply.
      // The turn's own completion, never a post-turn summary refresh or
      // a judge call (those carry no live user turn last; a review).
      // CHAT-16: a composition (tool-result messages before its last
      // user-role instruction) is never the seeded draft's request.
      const isTurn = (parsedBody?.messages ?? []).length > 0 && parsedBody!.messages![parsedBody!.messages!.length - 1]!.role === "user" && !parsedBody!.messages!.some((m) => m.role === "tool");
      if (recorded && scripted !== null && parsedBody && parsedBody.tool_choice !== "required" && isTurn) {
        const text = scripted;
        scripted = null;
        recorded.responseText = text;
        recorded.completed = true;
        const id = `seed-${Date.now()}`;
        const model = parsedBody.model ?? "seed";
        if (parsedBody.stream) {
          const encoder = new TextEncoder();
          const line = (choice: unknown) => encoder.encode(`data: ${JSON.stringify({ id, model, choices: [choice] })}\n\n`);
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(line({ index: 0, delta: { role: "assistant" }, finish_reason: null }));
              text.split(" ").forEach((word, i) => controller.enqueue(line({ index: 0, delta: { content: i === 0 ? word : ` ${word}` }, finish_reason: null })));
              controller.enqueue(line({ index: 0, delta: {}, finish_reason: "stop" }));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ id, model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
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
            const joined = lines.join("\n");
            text += extractModelText(joined);
            record.responseText = text;
            const meta = extractModelMeta(joined);
            if (meta.hasToolCalls) record.hasToolCalls = true;
            if (meta.cachedTokens !== undefined) record.cachedTokens = meta.cachedTokens;
            if (meta.promptTokens !== undefined) record.promptTokens = meta.promptTokens;
          } else {
            nonStream += piece;
          }
          controller.enqueue(chunk);
        },
        flush() {
          const finalRaw = streamed ? tail : nonStream;
          record.responseText = streamed ? text + extractModelText(tail) : extractModelText(nonStream);
          const meta = extractModelMeta(finalRaw);
          if (meta.hasToolCalls) record.hasToolCalls = true;
          if (meta.cachedTokens !== undefined) record.cachedTokens = meta.cachedTokens;
          if (meta.promptTokens !== undefined) record.promptTokens = meta.promptTokens;
          record.completed = true;
          finish();
        },
      });
      // An aborted client (the interruption row) cancels the pipe without
      // a flush, and an upstream body that errors mid-stream flushes
      // nothing either: the abort signal and a bounded wait in settled()
      // keep the bench from hanging on the record.
      req.signal.addEventListener(
        "abort",
        () => {
          // The same signal is the upstream fetch's, so the engine's
          // completion is cancelled with the client's read (E4's
          // "inference stopped", read from this flag, never assumed).
          if (!record.completed) record.aborted = true;
          finish();
        },
        { once: true },
      );
      return new Response(res.body.pipeThrough(recordingStream), { status: res.status, headers: res.headers });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    scriptNextReply: (text) => {
      scripted = text;
    },
    reset: () => void requests.splice(0),
    settled: async () => void (await Promise.race([Promise.all([...pending]), new Promise<void>((resolve) => setTimeout(resolve, 5_000))])),
    stop: () => server.stop(true),
  };
}

