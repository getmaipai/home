import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// START-FAST-01: `wt.sh start` no longer runs the reaper before it starts (measured 301 s of a 280 to 330 s start); the reaper runs once afterwards, detached.
const scratch = mkdtempSync(join(tmpdir(), "maipai-startfast-"));
const main = join(scratch, "main");
const log = join(scratch, "calls.log");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const fakeShared = (withReapLine: boolean) => {
  const f = join(scratch, `shared-${withReapLine ? "a" : "b"}.sh`);
  writeFileSync(f, `#!/usr/bin/env bash
cmd_reap() { echo "REAP" >> ${JSON.stringify(log)}; }
cmd_start() {
${withReapLine ? "  cmd_reap\n" : "  true\n"}  echo "START" >> ${JSON.stringify(log)}
  echo /nowhere
}
case "$1" in start) cmd_start;; reap) cmd_reap;; esac
`);
  return f;
};
const wt = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [join(main, "scripts", "wt.sh"), ...args], { cwd: main, encoding: "utf8", env: { ...process.env, MAIPAI_WT_START_REAP: "", ...env } });
const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
async function reapDone() { for (let i = 0; i < 100 && existsSync(join(main, "data-scratch", "wt-reap.lock")); i++) await Bun.sleep(100); }

beforeAll(() => {
  mkdirSync(join(main, "scripts", "lib"), { recursive: true });
  spawnSync("git", ["init", "-q", "--initial-branch=main", main]);
  for (const f of ["wt.sh", "lib/gitnet.sh"]) copyFileSync(join(import.meta.dir, f), join(main, "scripts", f));
});

describe("wt.sh start without the reaper in front", () => {
  test("start runs first, then the reaper runs once in the background and the lock is released", async () => {
    rmSync(log, { force: true });
    const r = wt(["start", "x"], { MAIPAI_WT_SHARED: fakeShared(true) });
    expect(r.status).toBe(0);
    await reapDone();
    for (let i = 0; i < 50 && calls().length < 2; i++) await Bun.sleep(100);
    expect(calls()).toEqual(["START", "REAP"]);
    expect(existsSync(join(main, "data-scratch", "wt-reap.lock"))).toBe(false);
  });
  test("a live reap lock means no second reaper starts", async () => {
    rmSync(log, { force: true }); mkdirSync(join(main, "data-scratch", "wt-reap.lock"), { recursive: true });
    wt(["start", "x"], { MAIPAI_WT_SHARED: fakeShared(true) });
    await Bun.sleep(600);
    expect(calls()).toEqual(["START"]);
    rmSync(join(main, "data-scratch", "wt-reap.lock"), { recursive: true, force: true });
  });
  test("a lock whose reaper is dead (pid file) is cleared and a new reaper runs; a lock with a live pid is respected", async () => {
    const lock = join(main, "data-scratch", "wt-reap.lock");
    rmSync(log, { force: true }); mkdirSync(lock, { recursive: true }); writeFileSync(join(lock, "pid"), "999999\n");
    wt(["start", "x"], { MAIPAI_WT_SHARED: fakeShared(true) });
    await reapDone();
    for (let i = 0; i < 50 && calls().length < 2; i++) await Bun.sleep(100);
    expect(calls()).toEqual(["START", "REAP"]);
    rmSync(log, { force: true }); mkdirSync(lock, { recursive: true }); writeFileSync(join(lock, "pid"), `${process.pid}\n`);
    wt(["start", "x"], { MAIPAI_WT_SHARED: fakeShared(true) });
    await Bun.sleep(600);
    expect(calls()).toEqual(["START"]);
    rmSync(lock, { recursive: true, force: true });
  });
  test("MAIPAI_WT_START_REAP=1 keeps the old order: reaper first, nothing in the background", async () => {
    rmSync(log, { force: true });
    wt(["start", "x"], { MAIPAI_WT_SHARED: fakeShared(true), MAIPAI_WT_START_REAP: "1" });
    await Bun.sleep(600);
    expect(calls()).toEqual(["REAP", "START"]);
  });
  test("a shared script the edit does not fit runs unchanged, with a note, and starts no background reaper", async () => {
    rmSync(log, { force: true });
    const r = wt(["start", "x"], { MAIPAI_WT_SHARED: fakeShared(false) });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("could not skip the reaper in start");
    await Bun.sleep(600);
    expect(calls()).toEqual(["START"]);
  });
  test("other commands never go through the edit", () => {
    rmSync(log, { force: true });
    wt(["reap"], { MAIPAI_WT_SHARED: fakeShared(true) });
    expect(calls()).toEqual(["REAP"]);
  });
});
