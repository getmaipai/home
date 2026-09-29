import { describe, expect, test } from "bun:test";
import { submitEmbeddings, type SubmitResult } from "@/apps/people/submitEmbeddings";

describe("submitEmbeddings", () => {
  test("cancelling while a post is in flight aborts it and records no success", async () => {
    const controller = new AbortController();
    const started: number[][] = [];
    const results: Array<{ embedding: number[]; result: SubmitResult }> = [];
    let sawAborted = false;

    // A slow/pending fetch stand-in: never resolves on its own, only
    // rejects once the real AbortSignal fires - the same shape a real
    // fetch(..., { signal }) takes when aborted mid-flight.
    const postOne = (_embedding: number[], signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          sawAborted = signal.aborted;
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    const run = submitEmbeddings(
      [[1, 2, 3]],
      controller.signal,
      postOne,
      (embedding) => started.push(embedding),
      (embedding, result) => results.push({ embedding, result }),
    );

    // Let the loop actually start the post (its promise executor runs
    // synchronously, but this keeps the ordering explicit) before
    // simulating the person clicking "Cancel enrollment" mid-flight.
    await Promise.resolve();
    controller.abort();
    await run;

    expect(started).toEqual([[1, 2, 3]]);
    expect(results).toEqual([]);
    expect(sawAborted).toBe(true);
  });

  test("a successful post is recorded once", async () => {
    const controller = new AbortController();
    const results: SubmitResult[] = [];
    await submitEmbeddings(
      [[1]],
      controller.signal,
      async () => {},
      () => {},
      (_embedding, result) => results.push(result),
    );
    expect(results).toEqual([{ status: "success" }]);
  });

  test("a real failure (not a cancel) is recorded as an error with its message", async () => {
    const controller = new AbortController();
    const results: SubmitResult[] = [];
    await submitEmbeddings(
      [[1]],
      controller.signal,
      async () => {
        throw new Error("network down");
      },
      () => {},
      (_embedding, result) => results.push(result),
    );
    expect(results).toEqual([{ status: "error", message: "network down" }]);
  });

  test("an already-cancelled signal skips every embedding, starting none of them", async () => {
    const controller = new AbortController();
    controller.abort();
    const started: number[][] = [];
    await submitEmbeddings(
      [[1], [2]],
      controller.signal,
      async () => {},
      (embedding) => started.push(embedding),
      () => {},
    );
    expect(started).toEqual([]);
  });

  test("posts sequentially, one at a time, not in parallel", async () => {
    const controller = new AbortController();
    let concurrent = 0;
    let maxConcurrent = 0;
    await submitEmbeddings(
      [[1], [2], [3]],
      controller.signal,
      async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Promise.resolve();
        concurrent -= 1;
      },
      () => {},
      () => {},
    );
    expect(maxConcurrent).toBe(1);
  });
});
