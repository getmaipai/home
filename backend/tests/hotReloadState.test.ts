import { afterEach, describe, expect, test } from "bun:test";
import { hotReloadState } from "@/lib/hotReloadState";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["__maipai_task213_a"];
  delete (globalThis as Record<string, unknown>)["__maipai_task213_b"];
});

describe("hotReloadState", () => {
  test("runs init once and returns the same object on later calls", () => {
    let calls = 0;
    const first = hotReloadState("task213_a", () => {
      calls++;
      return { n: 1 };
    });
    const second = hotReloadState("task213_a", () => {
      calls++;
      return { n: 2 };
    });
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  test("keeps different keys apart", () => {
    const a = hotReloadState("task213_a", () => ({ v: "a" }));
    const b = hotReloadState("task213_b", () => ({ v: "b" }));
    expect(a.v).toBe("a");
    expect(b.v).toBe("b");
  });

  test("stores the value on globalThis under the __maipai_ prefix", () => {
    const v = hotReloadState("task213_a", () => ({ ok: true }));
    expect((globalThis as Record<string, unknown>)["__maipai_task213_a"]).toBe(v);
  });
});