import { expect, test } from "bun:test";
import { lockVerdict, acquireLock, releaseLock, readLock, pidAlive } from "../src/runLock";
import { tmpdir } from "node:os"; import { join } from "node:path"; import { writeFileSync, rmSync } from "node:fs";
const lock = (pid: number) => ({ pid, startedAt: "2026-11-20T18:00:00Z", step: "ready --quick" });
test("a second rig refuses while a live run holds the lock; the holder and its children are allowed", () => {
  expect(lockVerdict(lock(100), 200, [150, 1000], () => true)).toContain("pid 100");
  expect(lockVerdict(lock(100), 100, [], () => true)).toBeNull();
  expect(lockVerdict(lock(100), 300, [250, 100], () => true)).toBeNull();     // 100 is an ancestor: a rig the run started
});
test("a stale lock (dead pid) is ignored and replaced", () => {
  expect(lockVerdict(lock(100), 200, [], () => false)).toBeNull();
  const f = join(tmpdir(), `runlock-${process.pid}.json`); writeFileSync(f, JSON.stringify(lock(999999)));
  expect(pidAlive(999999)).toBe(false);
  expect(acquireLock("test", f).ok).toBe(true); expect(readLock(f)?.pid).toBe(process.pid); releaseLock(f); expect(readLock(f)).toBeNull(); rmSync(f, { force: true });
});
test("acquiring over a live other holder fails with a plain message", () => {
  const f = join(tmpdir(), `runlock2-${process.pid}.json`); writeFileSync(f, JSON.stringify(lock(process.ppid)));  // our parent is alive and is an ancestor: allowed, so use pid 1-less trick below
  const other = Bun.spawn(["sleep", "5"]); writeFileSync(f, JSON.stringify(lock(other.pid)));
  const r = acquireLock("test", f); expect(r.ok).toBe(false); expect(r.message).toContain(String(other.pid)); other.kill(); rmSync(f, { force: true });
});
