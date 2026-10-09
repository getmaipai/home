import { AssistantStream, DataStreamEncoder, createAssistantStreamController, type AssistantStreamChunk, type AssistantStreamController } from "assistant-stream";
import type { TurnStreamEvent } from "@/wire";
import type { TurnStreamEvent as ToolStreamEvent } from "@maipai/spec/stack/ts/turn-stream-event.js";

// THIN-5D (rule 9): the web chat's wire. The released NDJSON events of
// POST /api/turn/stream are written, one for one, into the installed
// assistant-stream package (0.3.44) and framed by its own DataStreamEncoder
// (node_modules/assistant-stream/src/core/serialization/data-stream/DataStream.ts).
// Nothing here decides what is released: the route hands this sink exactly
// the events it would write as NDJSON, so the output gate, the age bands and
// the crisis resources are upstream of both wires and cannot be bypassed.
//
// The mapping, which THIN-5E's decoder reads:
//   delta       -> a text part's text-delta        (`0:` frame)
//   reasoning   -> a reasoning part's text-delta   (`g:` frame)
//   tool_call / tool_result / tool_error -> a tool-call part (toolCallId =
//                  call_id, toolName = package_id, args, then its result)
//   every event except delta and reasoning ALSO rides a `data` chunk
//                  (`2:` frame) holding the NDJSON event object unchanged:
//                  turn_meta, signal, status, spoken_cue, tool_*, done, error
//   delta and reasoning carry the shared resume sequence in a
//                  `{ "type": "sequence", "sequence": n }` data chunk
//                  written immediately before the text frame it numbers
//   images      -> data(images), the open text part finished, then one
//                  `answer-images` data part (ANSWER-IMG-02)
//   done        -> data(done), then message-finish (`d:`), then the stream ends
//   error       -> data(error: code, crisis_resources), then an error chunk
//                  (`3:`), then the stream ends; a stream ends in exactly one
//                  of done or error, as on NDJSON
//
// Every chunk goes through controller.enqueue() (the controller's documented
// raw-protocol method): appendText() and the part writers run on merged
// child streams, so a data chunk enqueued beside them could land after the
// frame it numbers, and resume depends on that order.
type Event = TurnStreamEvent | ToolStreamEvent;

export interface AssistantStreamSink {
  readonly readable: ReadableStream<Uint8Array>;
  readonly headers: Headers;
  write(event: Event): void;
  close(): void;
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0 } as const;

export function createAssistantStreamSink(onCancel: () => void = () => {}): AssistantStreamSink {
  const [stream, controller]: readonly [ReadableStream<AssistantStreamChunk>, AssistantStreamController] = createAssistantStreamController();
  const encoder = new DataStreamEncoder();
  const reader = AssistantStream.toByteStream(stream, encoder).getReader();
  const readable = new ReadableStream<Uint8Array>({
    async pull(out) {
      const { done, value } = await reader.read();
      if (done) out.close();
      else out.enqueue(value);
    },
    cancel(reason) {
      onCancel();
      return reader.cancel(reason);
    },
  });

  let parts = 0;
  let open: { kind: "text" | "reasoning"; index: number } | undefined;
  const tools = new Map<string, number>();
  let ended = false;

  const closeOpen = () => {
    if (open) controller.enqueue({ type: "part-finish", path: [open.index] });
    open = undefined;
  };
  const data = (entry: Record<string, unknown>) => controller.enqueue({ type: "data", path: [], data: [entry as never] });
  const append = (kind: "text" | "reasoning", text: string) => {
    if (open?.kind !== kind) {
      closeOpen();
      controller.enqueue({ type: "part-start", path: [], part: { type: kind } });
      open = { kind, index: parts++ };
    }
    controller.enqueue({ type: "text-delta", path: [open.index], textDelta: text });
  };

  return {
    readable,
    headers: encoder.headers,
    write(event) {
      if (ended) return;
      if (!("type" in event)) {
        // The spec's `t`-keyed tool lines.
        data(event as unknown as Record<string, unknown>);
        closeOpen();
        if (event.t === "tool_call") {
          const index = parts++;
          tools.set(event.call_id, index);
          controller.enqueue({ type: "part-start", path: [], part: { type: "tool-call", toolCallId: event.call_id, toolName: event.package_id } });
          controller.enqueue({ type: "text-delta", path: [index], textDelta: JSON.stringify(event.args) });
          controller.enqueue({ type: "tool-call-args-text-finish", path: [index] });
        } else {
          // GENUI-02 blocks are already emitted as their own data event; they do not replace or fail the package's
          // tool result part. GENUI-13c: the open text part ended above (closeOpen), the block is one `answer_block`
          // data part in place, as the picture set is one `answer-images` part, and the next delta opens a new text part.
          if (event.t === "block") {
            const index = parts++;
            controller.enqueue({ type: "part-start", path: [], part: { type: "data", name: "answer_block", data: event.block as never } });
            controller.enqueue({ type: "part-finish", path: [index] });
            return;
          }
          const index = tools.get(event.call_id);
          if (index === undefined) return;
          controller.enqueue(event.t === "tool_result"
            ? { type: "result", path: [index], result: event.outcome as never, isError: false }
            : { type: "result", path: [index], result: { error: event.error }, isError: true });
          controller.enqueue({ type: "part-finish", path: [index] });
        }
        return;
      }
      if (event.type === "delta" || event.type === "reasoning") {
        if (event.sequence !== undefined) data({ type: "sequence", sequence: event.sequence });
        append(event.type === "delta" ? "text" : "reasoning", event.text);
        return;
      }
      data(event as unknown as Record<string, unknown>);
      if (event.type === "images") {
        // ANSWER-IMG-02: the open text part ends at the paragraph break, the
        // picture set is one `answer-images` data part in place, and the
        // next delta opens a new text part after it.
        closeOpen();
        const { type: _type, turn_id: _turnId, ...set } = event;
        const index = parts++;
        controller.enqueue({ type: "part-start", path: [], part: { type: "data", name: "answer-images", data: set as never } });
        controller.enqueue({ type: "part-finish", path: [index] });
        return;
      }
      if (event.type === "done") {
        closeOpen();
        controller.enqueue({ type: "message-finish", path: [], finishReason: "stop", usage: NO_USAGE });
        this.close();
      } else if (event.type === "error") {
        closeOpen();
        controller.enqueue({ type: "error", path: [], error: event.error, ...(event.code ? { code: event.code } : {}) });
        this.close();
      }
    },
    close() {
      if (ended) return;
      ended = true;
      controller.close();
    },
  };
}
