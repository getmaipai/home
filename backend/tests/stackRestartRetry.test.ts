// A message sent while the Stack restarts (an update, a memory restart) is
// asked again once after the Stack answers, instead of ending in a failed
// answer (2026-10-17). A stream that broke after a word was shown is not
// repeated.
import { afterEach, expect, test } from "bun:test";
import { startCompleteStreamPieces } from "@/lib/llm";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { isStackRestart } from "@/lib/stackRestart";

const encoder = new TextEncoder();
function sse(texts: string[], breakAfter?: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (breakAfter !== undefined && sent >= breakAfter) { controller.error(new TypeError("terminated")); return; }
      if (sent < texts.length) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: texts[sent] } }] })}\n\n`)); sent += 1; return; }
      controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
    },
  });
}
const headers = new Headers({ "x-maipai-engine": "llama-server", "x-maipai-model": "muse" });

afterEach(() => __resetStackEngineForTests());

async function collect(pieces: AsyncGenerator<{ text: string }, unknown, void>): Promise<string> {
  let text = "";
  for await (const piece of pieces) text += piece.text;
  return text;
}

test("a refused connection is retried once after the Stack answers healthz, and the answer arrives", async () => {
  let calls = 0;
  __setStackClientForTests({
    chat: async () => { calls += 1; if (calls === 1) throw new StackError("unreachable", "the Stack is not running: the socket refused"); return { stream: sse(["Hel", "lo"]), headers }; },
    healthz: async () => ({ ok: true, version: "x", uptimeSeconds: 1 }),
  } as never);
  const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "hi" }]);
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  expect(await collect(started.pieces)).toBe("Hello");
  expect(calls).toBe(2);
});

test("a stream cut before the first word is opened again once", async () => {
  let calls = 0;
  __setStackClientForTests({
    chat: async () => { calls += 1; return { stream: calls === 1 ? sse(["x"], 0) : sse(["Back", " again"]), headers }; },
    healthz: async () => ({ ok: true, version: "x", uptimeSeconds: 1 }),
  } as never);
  const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "hi" }]);
  if (!started.ok) throw new Error("not started");
  expect(await collect(started.pieces)).toBe("Back again");
  expect(calls).toBe(2);
});

test("a stream cut after a word was shown is not repeated", async () => {
  let calls = 0;
  __setStackClientForTests({
    chat: async () => { calls += 1; return { stream: sse(["Half"], 1), headers }; },
    healthz: async () => ({ ok: true, version: "x", uptimeSeconds: 1 }),
  } as never);
  const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "hi" }]);
  if (!started.ok) throw new Error("not started");
  await expect(collect(started.pieces)).rejects.toThrow();
  expect(calls).toBe(1);
});

test("what counts as a restart: refused, 503 stack_restarting, a closed socket; not a bad request", () => {
  expect(isStackRestart(new StackError("unreachable", "x"))).toBe(true);
  expect(isStackRestart(Object.assign(new StackError("unavailable", "The Stack is restarting. Try again in a few seconds."), { status: 503 }))).toBe(true);
  expect(isStackRestart(new TypeError("terminated"))).toBe(true);
  expect(isStackRestart(new StackError("unexpected", "bad request"))).toBe(false);
});
