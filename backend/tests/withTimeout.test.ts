import { describe, expect, test } from "bun:test";
import { withTimeout } from "@/lib/withTimeout";

// COR-2 (code review, 2026-09-06): the "race a promise against a
// setTimeout rejection, clear the timer either way" shape was hand-
// copied three times (routes/host.ts, lib/modelDownload.ts,
// lib/scheduler.ts's own per-job budget) - each with its own comment
// citing a timer-leak bug found once already. This is that shared
// implementation.
describe("withTimeout", () => {
  test("resolves with the promise's own value when it settles first", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1_000, () => new Error("should not fire"));
    expect(result).toBe("done");
  });

  test("rejects with onTimeout()'s own error when the deadline passes first", async () => {
    const neverResolves = new Promise<string>(() => {});
    await expect(withTimeout(neverResolves, 20, () => new Error("custom timeout message"))).rejects.toThrow("custom timeout message");
  });

  test("a distinct error class from onTimeout() survives the race - callers can tell a timeout apart from any other failure", async () => {
    class MyTimeoutError extends Error {}
    const neverResolves = new Promise<string>(() => {});
    await expect(withTimeout(neverResolves, 20, () => new MyTimeoutError("x"))).rejects.toBeInstanceOf(MyTimeoutError);
  });

  test("propagates the promise's own rejection unchanged when it rejects before the deadline", async () => {
    await expect(withTimeout(Promise.reject(new Error("real failure")), 1_000, () => new Error("should not fire"))).rejects.toThrow(
      "real failure",
    );
  });

  test("does not leave a live timer running after a fast resolution (no unhandled rejection from a stale timeout callback)", async () => {
    await withTimeout(Promise.resolve("done"), 20, () => new Error("should never fire"));
    // If the timer weren't cleared, this would surface as an unhandled
    // rejection once it fires - waiting past the original deadline here
    // proves it doesn't.
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
});
