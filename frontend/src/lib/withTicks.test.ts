import { describe, expect, test } from "bun:test";
import { withTicks } from "./withTicks";

describe("withTicks", () => {
  test("preserves events and ticks while idle", async () => {
    async function* source() { yield 1; await new Promise((r) => setTimeout(r, 25)); yield 2; }
    const output: ({ event: number } | { tick: true })[] = [];
    for await (const item of withTicks(source(), 5)) output.push(item);
    expect(output.filter((item) => "event" in item)).toEqual([{ event: 1 }, { event: 2 }]);
    expect(output.some((item) => "tick" in item)).toBe(true);
  });

  test("forwards errors and return", async () => {
    const failure = new Error("failed");
    async function* broken() { yield "first"; throw failure; }
    const seen: string[] = [];
    await expect(async () => { for await (const item of withTicks(broken(), 50)) if ("event" in item) seen.push(item.event); }).toThrow(failure);
    expect(seen).toEqual(["first"]);
    let returned = false;
    const source: AsyncIterable<number> = { [Symbol.asyncIterator]() { return { next: async () => ({ value: 1, done: false }), return: async () => { returned = true; return { value: undefined, done: true }; } }; } };
    for await (const item of withTicks(source, 50)) { void item; break; }
    expect(returned).toBe(true);
  });
});
