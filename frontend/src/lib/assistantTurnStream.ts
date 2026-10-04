import { DataStreamDecoder, type AssistantStreamChunk } from "assistant-stream";
import type { TurnStreamEvent } from "@maipai/home-backend/src/wire";

// THIN-5E (rule 9): the web chat's reader for POST /api/turn/stream sent with
// `Accept: application/x-assistant-stream`. The installed DataStreamDecoder
// (assistant-stream 0.3.44) does the framing; the wire contract is the header
// of backend/src/lib/assistantStreamWire.ts. Nothing here buffers, re-splits
// or decides what is released: a text part's text-delta is a `delta`, a
// reasoning part's text-delta is a `reasoning` (each numbered by the
// `{type:"sequence"}` data chunk written just before it), and every other
// NDJSON event comes back unchanged from its data chunk. A tool-call part's
// own chunks are not read: its NDJSON line already rides a data chunk.
// Typed as the NDJSON wire union the adapter already narrows on; the spec's `t`-keyed tool lines ride it as before.
export type AssistantTurnEvent = TurnStreamEvent;

export async function* readAssistantTurnStream(response: Response): AsyncGenerator<AssistantTurnEvent, void, void> {
  const chunks = response.body!.pipeThrough(new DataStreamDecoder({ strict: false })).getReader();
  // part-start carries the parent path; the part's own index is its start order.
  const kinds: ("text" | "reasoning" | undefined)[] = [];
  let sequence: number | undefined;
  for (;;) {
    const { done, value } = await chunks.read();
    if (done) return;
    const chunk: AssistantStreamChunk = value;
    if (chunk.type === "part-start") {
      if (chunk.path.length === 0) kinds.push(chunk.part.type === "text" || chunk.part.type === "reasoning" ? chunk.part.type : undefined);
    } else if (chunk.type === "text-delta") {
      const kind = chunk.path.length === 1 ? kinds[chunk.path[0]!] : undefined;
      if (!kind) continue;
      yield { type: kind === "text" ? "delta" : "reasoning", text: chunk.textDelta, ...(sequence === undefined ? {} : { sequence }) } as AssistantTurnEvent;
      sequence = undefined;
    } else if (chunk.type === "data") {
      for (const entry of chunk.data as unknown as Record<string, unknown>[]) {
        if (entry.type === "sequence") sequence = Number(entry.sequence);
        else yield entry as unknown as AssistantTurnEvent;
      }
    }
  }
}
