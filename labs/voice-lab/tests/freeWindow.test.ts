import { expect, test } from "bun:test";
import { FreeWindow } from "../src/gpuLoad";

test("a run starts only after 60 s of continuous free GPU; a busy blip restarts the clock", () => {
  const w = new FreeWindow(60_000); let t = 0; const at = (free: boolean) => w.push((t += 5000), free);
  for (let i = 0; i < 11; i++) expect(at(true).start).toBe(false);   // 55 s free: not yet
  expect(at(false).start).toBe(false);                               // a job appears: clock resets
  for (let i = 0; i < 12; i++) expect(at(true).start).toBe(false);   // 55 s of continuous freedom so far
  expect(at(true).start).toBe(true);                                 // 60 s continuous
});
test("a job appearing during a run aborts it (not a failure) and the wait starts over", () => {
  const w = new FreeWindow(10_000); let t = 0; const at = (free: boolean) => w.push((t += 5000), free);
  at(true); at(true); expect(at(true).start).toBe(true);
  expect(at(true).abort).toBe(false);
  expect(at(false).abort).toBe(true);                                // aborted
  expect(at(true).start).toBe(false);                                // must wait the full window again
  at(true); expect(at(true).start).toBe(true);
});
import { isHotCommand } from "../src/gpuLoad";
test("desktop app helpers are never a GPU job; real engines and jobs are", () => {
  expect(isHotCommand("/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer")).toBe(false);
  expect(isHotCommand("/Users/x/video-bench/ltx25-new/src/.venv/bin/python generate.py")).toBe(true);
  expect(isHotCommand("/usr/local/maipai-home/stack/data/engines/llama-server/b10797/llama-server --port 51700")).toBe(true);
  expect(isHotCommand("bun test tests/foo.test.ts")).toBe(false);
});
import { otherJobs, ownPids, type ProcRow } from "../src/gpuLoad";
const LL = "/usr/local/maipai-home/stack/data/engines/llama-server/b10797/llama-server --port 9921";
test("the lab's own llama-server at 60% GPU is not another job; a second llama-server with a different pid is", () => {
  const rows: ProcRow[] = [{ pid: 100, ppid: 1, rss: 1e6, pcpu: 60, cmd: LL }, { pid: 101, ppid: 100, rss: 1e6, pcpu: 50, cmd: "child-of-llama --embed" }];
  const own = ownPids(new Map([[100, 9921]]), rows);
  expect(own.has(101)).toBe(true);
  expect(otherJobs(rows, own)).toEqual([]);
  const other = [...rows, { pid: 200, ppid: 1, rss: 1e6, pcpu: 60, cmd: LL.replace("9921", "51700") }];
  const j = otherJobs(other, own, new Map([[200, 51700]]));
  expect(j.length).toBe(1); expect(j[0]).toContain("pid=200"); expect(j[0]).toContain("port=51700");
});
import { gpuClass, remoteScreenLabel } from "../src/gpuLoad";
test("a run is valid when no other NAMED engine is active; the owner's remote screen never makes it shared and is only labelled", () => {
  const R = (pid: number, rss: number, pcpu: number, cmd: string): ProcRow => ({ pid, ppid: 1, rss, pcpu, cmd });
  expect(otherJobs([R(1, 14 * 1048576, 0.5, "/x/splash-chat/engine/splash-chat --port 51000")], new Set())).toEqual([]);
  expect(otherJobs([R(2, 1e6, 90, "host/.venv/bin/python scripts/feature-ledger.py")], new Set())).toEqual([]);
  expect(gpuClass({ util: 95, jobs: "" })).toBe("free");                              // remote screen at 95% GPU, no named engine
  expect(gpuClass({ util: 20, jobs: "pid=5 60% llama-server" })).toBe("shared");      // a named engine counts at any utilization
  expect(remoteScreenLabel([R(3, 1, 80, "/System/Library/CoreServices/RemoteManagement/screensharingd.bundle/Contents/MacOS/screensharingd")])).toBe("remote screen active");
  expect(remoteScreenLabel([R(4, 1, 1, "/Applications/Sunshine.app/Contents/MacOS/Sunshine")])).toBe("quiet");
});
