import { describe, expect, test } from "bun:test";
import { singleflight } from "@/lib/singleflight";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("singleflight", () => {
  test("concurrent callers before completion share the exact same in-flight promise", async () => {
    let calls = 0;
    const { promise, resolve } = deferred<string>();
    const run = singleflight(() => {
      calls++;
      return promise;
    });
    const a = run();
    const b = run();
    expect(calls).toBe(1); // the second call never invoked fn() again
    resolve("done");
    expect(await a).toBe("done");
    expect(await b).toBe("done");
  });

  test("a call after success starts a genuinely fresh attempt, not a stale one", async () => {
    let calls = 0;
    const run = singleflight(async () => {
      calls++;
      return calls;
    });
    expect(await run()).toBe(1);
    expect(await run()).toBe(2);
    expect(calls).toBe(2);
  });

  test("a call after failure retries, rather than replaying the same rejection forever", async () => {
    let attempt = 0;
    const run = singleflight(async () => {
      attempt++;
      if (attempt === 1) throw new Error("transient failure");
      return "recovered";
    });
    await expect(run()).rejects.toThrow("transient failure");
    expect(await run()).toBe("recovered");
  });

  test("__resetForTests clears an in-flight attempt so a fresh call doesn't await it", async () => {
    let calls = 0;
    const { promise } = deferred<string>();
    const run = singleflight(() => {
      calls++;
      return calls === 1 ? promise : Promise.resolve("second");
    });
    void run(); // starts the first, never-resolving attempt
    expect(calls).toBe(1);
    run.__resetForTests();
    expect(await run()).toBe("second");
    expect(calls).toBe(2);
  });
});
