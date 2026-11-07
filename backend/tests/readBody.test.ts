// AUDIT-DUP-NET-01: the one size-capped body read behind the feed, podcast, picture, favicon, package and document readers.
import { describe, expect, test } from "bun:test";
import { readBodyLimited, readStreamLimited } from "@/lib/net/readBody";

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
function streamOf(chunks: string[], onCancel?: () => void): ReadableStream<Uint8Array> {
  const parts = chunks.map((chunk) => new TextEncoder().encode(chunk));
  return new ReadableStream({ pull(controller) { const next = parts.shift(); if (next) controller.enqueue(next); else controller.close(); }, cancel() { onCancel?.(); } });
}

describe("readBodyLimited", () => {
  test("a body under the cap is read whole, across chunks", async () => {
    expect(text(await readBodyLimited(new Response(streamOf(["abc", "def"])), { limit: 10 }))).toBe("abcdef");
  });

  test("a body exactly at the cap is kept", async () => {
    expect(text(await readBodyLimited(new Response("abcd"), { limit: 4 }))).toBe("abcd");
  });

  test("a body over the cap is null and the upstream is cancelled", async () => {
    let cancelled = false;
    const bytes = await readBodyLimited(new Response(streamOf(["abc", "def", "ghi"], () => { cancelled = true; })), { limit: 5 });
    expect(bytes).toBeNull();
    expect(cancelled).toBe(true);
  });

  test("a declared Content-Length over the cap is refused before a byte is read", async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled = true; controller.close(); } });
    const bytes = await readBodyLimited(new Response(body, { headers: { "content-length": "999" } }), { limit: 10 });
    expect(bytes).toBeNull();
    expect(pulled).toBe(false);
  });

  test("truncate keeps the first bytes of a longer body", async () => {
    expect(text(await readBodyLimited(new Response(streamOf(["abc", "def", "ghi"])), { limit: 5, truncate: true }))).toBe("abcde");
    expect(text(await readBodyLimited(new Response("abcdefghij", { headers: { "content-length": "10" } }), { limit: 4, truncate: true }))).toBe("abcd");
  });

  test("an aborted signal stops the read with null", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await readBodyLimited(new Response("abc"), { limit: 10, signal: controller.signal })).toBeNull();
  });

  test("a signal aborted between chunks stops the read", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new TextEncoder().encode("ab")); controller.abort(); } });
    expect(await readBodyLimited(new Response(body), { limit: 100, signal: controller.signal })).toBeNull();
  });

  test("a response with no body is null, and an empty body is empty", async () => {
    expect(await readBodyLimited(new Response(null), { limit: 10 })).toBeNull();
    expect(text(await readBodyLimited(new Response(""), { limit: 10 }))).toBe("");
  });

  test("cancelling an already-errored stream does not throw", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("abcdefgh")); }, cancel() { throw new Error("already errored"); } });
    expect(await readStreamLimited(body, { limit: 3 })).toBeNull();
  });
});
