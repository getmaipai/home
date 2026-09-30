import { describe, expect, test } from "bun:test";
import { submitEnrollment, type SubmitResult } from "@/apps/people/submitEmbeddings";

describe("submitEnrollment", () => {
  test("sends the whole set in one call and records one success", async () => {
    const controller = new AbortController();
    const calls: number[][][] = [];
    const started: number[][][] = [];
    const results: SubmitResult[] = [];
    await submitEnrollment(
      [[1], [2], [3]],
      controller.signal,
      async (embeddings) => {
        calls.push([...embeddings]);
      },
      (embeddings) => started.push([...embeddings]),
      (result) => results.push(result),
    );
    expect(calls).toEqual([[[1], [2], [3]]]);
    expect(started).toEqual([[[1], [2], [3]]]);
    expect(results).toEqual([{ status: "success" }]);
  });

  test("cancelling while the post is in flight aborts it and records no result", async () => {
    const controller = new AbortController();
    const results: SubmitResult[] = [];
    let sawAborted = false;
    // Never resolves on its own, only rejects once the real AbortSignal
    // fires: the shape a real fetch(..., { signal }) takes when aborted.
    const postAll = (_embeddings: readonly number[][], signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          sawAborted = signal.aborted;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const run = submitEnrollment([[1, 2, 3]], controller.signal, postAll, () => {}, (result) => results.push(result));
    await Promise.resolve();
    controller.abort();
    await run;
    expect(results).toEqual([]);
    expect(sawAborted).toBe(true);
  });

  test("a real failure is one error for the whole set: nothing was saved", async () => {
    const controller = new AbortController();
    const results: SubmitResult[] = [];
    await submitEnrollment(
      [[1], [2]],
      controller.signal,
      async () => {
        throw new Error("network down");
      },
      () => {},
      (result) => results.push(result),
    );
    expect(results).toEqual([{ status: "error", message: "network down" }]);
  });

  test("an already-cancelled signal sends nothing and starts nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    let sent = 0;
    let started = 0;
    await submitEnrollment(
      [[1]],
      controller.signal,
      async () => {
        sent += 1;
      },
      () => {
        started += 1;
      },
      () => {},
    );
    expect(sent).toBe(0);
    expect(started).toBe(0);
  });

  test("an empty set sends nothing", async () => {
    const controller = new AbortController();
    let sent = 0;
    await submitEnrollment(
      [],
      controller.signal,
      async () => {
        sent += 1;
      },
      () => {},
      () => {},
    );
    expect(sent).toBe(0);
  });
});
