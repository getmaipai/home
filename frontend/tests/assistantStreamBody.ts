import { AssistantStream, DataStreamEncoder, createAssistantStreamController, type AssistantStreamChunk } from "assistant-stream";

// A real assistant-stream response body for POST /api/turn/stream sent with
// `Accept: application/x-assistant-stream`: the installed DataStreamEncoder
// frames the chunks in the order backend/src/lib/assistantStreamWire.ts
// writes them (its header comment is the contract). `events` are the same
// objects the NDJSON wire carries (wire.ts's TurnStreamEvent, plus the
// spec's `t`-keyed tool lines). The fixture only writes; it decides nothing.
export function assistantStreamWriter(): { body: ReadableStream<Uint8Array>; write(events: unknown[]): void; end(): void } {
  const [stream, controller] = createAssistantStreamController();
  let parts = 0;
  let open: { kind: "text" | "reasoning"; index: number } | undefined;
  const tools = new Map<string, number>();
  const data = (entry: Record<string, unknown>) => controller.enqueue({ type: "data", path: [], data: [entry as never] } as AssistantStreamChunk);
  const closeOpen = () => {
    if (open) controller.enqueue({ type: "part-finish", path: [open.index] });
    open = undefined;
  };
  let finished = false;
  const write = (events: unknown[]) => {
  for (const raw of events) {
    const event = raw as Record<string, unknown>;
    if (finished) return;
    if (!("type" in event)) {
      data(event);
      closeOpen();
      if (event.t === "tool_call") {
        const index = parts++;
        tools.set(String(event.call_id), index);
        controller.enqueue({ type: "part-start", path: [], part: { type: "tool-call", toolCallId: String(event.call_id), toolName: String(event.package_id) } });
        controller.enqueue({ type: "text-delta", path: [index], textDelta: JSON.stringify(event.args ?? {}) });
        controller.enqueue({ type: "tool-call-args-text-finish", path: [index] });
      } else {
        const index = tools.get(String(event.call_id));
        if (index === undefined) continue;
        controller.enqueue(event.t === "tool_result"
          ? { type: "result", path: [index], result: event.outcome as never, isError: false }
          : { type: "result", path: [index], result: { error: event.error } as never, isError: true });
        controller.enqueue({ type: "part-finish", path: [index] });
      }
      continue;
    }
    if (event.type === "delta" || event.type === "reasoning") {
      const kind = event.type === "delta" ? "text" : "reasoning";
      if (event.sequence !== undefined) data({ type: "sequence", sequence: event.sequence });
      if (open?.kind !== kind) {
        closeOpen();
        controller.enqueue({ type: "part-start", path: [], part: { type: kind } });
        open = { kind, index: parts++ };
      }
      controller.enqueue({ type: "text-delta", path: [open.index], textDelta: String(event.text) });
      continue;
    }
    data(event);
    if (event.type === "done") {
      closeOpen();
      controller.enqueue({ type: "message-finish", path: [], finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0 } });
      controller.close();
      finished = true;
      break;
    }
    if (event.type === "error") {
      closeOpen();
      controller.enqueue({ type: "error", path: [], error: String(event.error), ...(event.code ? { code: event.code } : {}) } as AssistantStreamChunk);
      controller.close();
      finished = true;
      break;
    }
  }
  };
  const end = () => {
    if (finished) return;
    finished = true;
    controller.close();
  };
  return { body: AssistantStream.toByteStream(stream, new DataStreamEncoder()), write, end };
}

/** A whole body at once; a body with neither done nor error just ends. */
export function assistantStreamBody(events: unknown[]): ReadableStream<Uint8Array> {
  const writer = assistantStreamWriter();
  writer.write(events);
  writer.end();
  return writer.body;
}

/** `firstEvents` now, `restEvents` once release() runs, as staggeredNdjsonStream does. */
export function staggeredAssistantStreamBody(firstEvents: unknown[], restEvents: unknown[]): { stream: ReadableStream<Uint8Array>; release: () => void } {
  const writer = assistantStreamWriter();
  writer.write(firstEvents);
  return { stream: writer.body, release: () => { writer.write(restEvents); writer.end(); } };
}

export const ASSISTANT_STREAM_HEADERS = { "content-type": "text/plain; charset=utf-8", "x-vercel-ai-data-stream": "v1" } as const;
