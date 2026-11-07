// AUDIT-DUP-NET-01: the one size-capped body read. A body from a stranger's server is never held whole before it is counted: it is
// read chunk by chunk, the read stops (and the upstream is cancelled) the moment the cap is crossed or the caller's signal aborts,
// and a declared Content-Length over the cap is refused before a byte is read. Callers keep their own decoding.

export interface ReadLimitOptions {
  /** The most bytes to keep. */
  limit: number;
  /** Stops the read when it aborts (the result is null). */
  signal?: AbortSignal;
  /** Keep the first `limit` bytes of a longer body instead of refusing it (a favicon that only needs its header bytes). */
  truncate?: boolean;
}

async function cancelQuietly(target: { cancel(): Promise<void> } | null | undefined): Promise<void> {
  try { await target?.cancel(); } catch { /* an already-errored or closed stream has nothing to cancel */ }
}

/** The bytes of `stream` up to `limit`; null when it is longer (unless `truncate`), when it is missing, or when `signal` aborted. */
export async function readStreamLimited(stream: ReadableStream<Uint8Array> | null | undefined, options: ReadLimitOptions): Promise<Uint8Array | null> {
  const reader = stream?.getReader();
  if (!reader) return null;
  const { limit, signal, truncate = false } = options;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    if (signal?.aborted) { await cancelQuietly(reader); return null; }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await cancelQuietly(reader);
      if (!truncate) return null;
      chunks.push(value.subarray(0, value.byteLength - (size - limit)));
      size = limit;
      break;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** The body of `response` up to `limit` bytes, or null (see `readStreamLimited`; a declared Content-Length over the cap is refused first). */
export async function readBodyLimited(response: Response, options: ReadLimitOptions): Promise<Uint8Array | null> {
  if (!options.truncate) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > options.limit) { await cancelQuietly(response.body); return null; }
  }
  return readStreamLimited(response.body, options);
}
