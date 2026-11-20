import { expect, test } from "bun:test";
import { labOwn, stopOwn } from "../src/ownProcs";
const R = (pid: number, ppid: number, cmd = "x") => ({ pid, ppid, rss: 1, pcpu: 0, cmd });
test("stopOwn kills only lab pids and refuses everything else (Sunshine, hub engines, other sessions)", () => {
  const rows = [R(10, 1, "bun rig/when-free.ts"), R(11, 10, "bun rig/ready.ts"), R(93742, 1, "llama-server"), R(643, 1, "Sunshine"), R(24725, 1, "hub splash-chat")];
  const own = labOwn(rows, new Map([[93742, 9921]]), 10);
  expect([...own].sort()).toEqual([11, 93742]);
  const killed: number[] = []; const r = stopOwn([11, 93742, 643, 24725], own, (p) => killed.push(p));
  expect(r.stopped).toEqual([11, 93742]); expect(r.refused).toEqual([643, 24725]); expect(killed).toEqual([11, 93742]);
});
