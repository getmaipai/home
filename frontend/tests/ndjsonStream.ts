/** Builds a real newline-delimited-JSON response body matching
 * POST /api/turn/stream's real wire shape (wire.ts's TurnStreamEvent) -
 * one JSON object per line, split into individual chunks fed to the
 * ReadableStream one at a time (not one giant write) so the frontend's
 * own chunk-by-chunk reader loop is exercised for real. */
export function ndjsonStream(lines: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      controller.close();
    },
  });
}

/** Same shape as ndjsonStream, but enqueues `firstLines` immediately and
 * holds `restLines` back until `release()` is called - lets a test
 * inspect state genuinely in between the two batches, which a fully
 * synchronous stream (everything enqueued in one `start()`) never
 * allows: by the time any assertion runs against it, the whole thing has
 * already drained. */
export function staggeredNdjsonStream(
  firstLines: unknown[],
  restLines: unknown[],
): { stream: ReadableStream<Uint8Array>; release: () => void } {
  const encoder = new TextEncoder();
  let release = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of firstLines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      release = () => {
        for (const line of restLines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        controller.close();
      };
    },
  });
  return { stream, release };
}
