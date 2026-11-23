import { describe, expect, test } from "bun:test";
import { swapToCodingMode } from "../src/lib/codingModeSwap";

type Mode = { mode: "normal" | "coding"; target: "normal" | "coding"; state: "stable" | "waiting" | "switching" | "failed"; reason: string | null };
function rig(reads: Mode[], opts: { postThrows?: Error } = {}) {
  const posted: string[] = [];
  let i = 0;
  let clock = 0;
  const client = {
    setCodingMode: async (mode: "normal" | "coding") => { posted.push(mode); if (opts.postThrows) throw opts.postThrows; },
    getCodingMode: async () => reads[Math.min(i++, reads.length - 1)]!,
  };
  return { client, posted, deps: { now: () => clock, wait: async (ms: number) => { clock += ms; }, pollMs: 1000, timeoutMs: 10_000 } };
}
const sw: Mode = { mode: "normal", target: "coding", state: "switching", reason: null };
const done: Mode = { mode: "coding", target: "coding", state: "stable", reason: null };

describe("swapToCodingMode waits until the Stack is really in coding mode", () => {
  test("posts once, then returns only when the mode is coding and stable", async () => {
    const { client, posted, deps } = rig([sw, sw, done]);
    await swapToCodingMode(client, deps);
    expect(posted).toEqual(["coding"]);
  });
  test("a failed switch throws the Stack's own reason", async () => {
    const { client, deps } = rig([sw, { mode: "normal", target: "normal", state: "failed", reason: "The coding model needs about 68.9 GB" }]);
    await expect(swapToCodingMode(client, deps)).rejects.toThrow("68.9 GB");
  });
  test("a switch that never ends times out", async () => {
    const { client, deps } = rig([sw]);
    await expect(swapToCodingMode(client, deps)).rejects.toThrow();
  });
  test("a switch already running (the post is refused) is waited for, not failed", async () => {
    const { client, deps } = rig([sw, done], { postThrows: new Error("409 A Home mode change is already running.") });
    await swapToCodingMode(client, deps);
  });
  test("already in coding mode returns at once", async () => {
    const { client, deps } = rig([done], { postThrows: new Error("409 Home is already in coding mode.") });
    await swapToCodingMode(client, deps);
  });
});
