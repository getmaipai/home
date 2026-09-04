// Reads a ReadableStreamDefaultReader<Uint8Array> as newline-delimited
// text, decoding and buffering across chunk boundaries. Yields each
// complete, trimmed, non-empty line as soon as it's available, and gives
// TextDecoder a final, non-streaming flush once the source exhausts -
// its streaming mode (`{ stream: true }`) can otherwise buffer an
// incomplete multi-byte UTF-8 sequence split across the last two network
// chunks and silently drop it (a real, live-verified bug, 2026-09-04:
// `spec/llm/ts/client.ts`'s SSE reader and the hub frontend's `api.ts`'s
// ndjson reader each independently needed this same fix once, because
// each had its own hand-rolled copy of this exact buffering logic -
// centralized here so a future fix to the mechanics only has to land
// once. Callers still own their own per-line meaning (SSE `data:`
// framing, plain JSON, whatever): this only ever hands back trimmed
// lines, never parses them.
// A minimal, structural reader shape rather than the full DOM
// `ReadableStreamDefaultReader<Uint8Array>` type: Bun's own bundled DOM
// types add extra members (e.g. `readMany`) that a plain browser
// `getReader()` result doesn't have, so requiring the full type here
// would make this unusable from whichever side didn't happen to produce
// it. Every real reader (browser fetch, Bun's own fetch) satisfies this
// shape - it's all `read()` ever actually calls.
export interface ByteStreamReader {
  read(): Promise<{ done?: boolean; value?: Uint8Array }>;
}

export async function* readTextLines(reader: ByteStreamReader): AsyncGenerator<string, void, void> {
  const decoder = new TextDecoder();
  let buffer = "";
  function* drain(): Generator<string, void, void> {
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    yield* drain();
  }
  buffer += decoder.decode();
  yield* drain();
}
