import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { acquireMicStream, MIC_GRACE_MS, resetMicStreamForTests } from "./micStream";

let opened = 0;
let stopped = 0;
const open = async () => {
  opened++;
  return { getTracks: () => [{ readyState: "live", stop() { stopped++; } }] } as unknown as MediaStream;
};
const realSetTimeout = globalThis.setTimeout;
let timers: { fn: () => void; ms: number }[] = [];

beforeEach(() => {
  resetMicStreamForTests();
  opened = 0; stopped = 0; timers = [];
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }) as unknown;
  (globalThis as unknown as { clearTimeout: unknown }).clearTimeout = ((id: number) => { if (timers[id - 1]) timers[id - 1] = { fn: () => {}, ms: 0 }; }) as unknown;
});
afterEach(() => { globalThis.setTimeout = realSetTimeout; });

describe("shared mic stream", () => {
  test("grace is 10 seconds", () => expect(MIC_GRACE_MS).toBe(10_000));

  test("two opens within the grace call getUserMedia once", async () => {
    (await acquireMicStream("k", open)).release();
    expect(timers.at(-1)?.ms).toBe(10_000);
    (await acquireMicStream("k", open)).release();
    expect(opened).toBe(1);
    expect(stopped).toBe(0);
  });

  test("an open after the grace asks again, and the tracks were stopped", async () => {
    (await acquireMicStream("k", open)).release();
    timers.at(-1)!.fn(); // the 10 s grace elapses
    expect(stopped).toBe(1);
    (await acquireMicStream("k", open)).release();
    expect(opened).toBe(2);
  });

  test("tracks stay open while another holder has the stream, and stop after the last release", async () => {
    const a = await acquireMicStream("k", open);
    const b = await acquireMicStream("k", open);
    expect(opened).toBe(1);
    a.release();
    a.release(); // idempotent
    expect(timers.length).toBe(0);
    b.release();
    timers.at(-1)!.fn();
    expect(stopped).toBe(1);
  });

  test("a different stream shape stops the idle one at once", async () => {
    (await acquireMicStream("a", open)).release();
    (await acquireMicStream("b", open)).release();
    expect(opened).toBe(2);
    expect(stopped).toBe(1);
  });
});
