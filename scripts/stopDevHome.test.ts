import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

// A development Home from the main checkout blocked the live Home installer three times on 2026-10-23. scripts/stop-dev-home.sh stops exactly
// that process (the lock file's pid or the 8787 listener, running src/index.ts from the main checkout) and nothing else.
const script = join(import.meta.dir, "stop-dev-home.sh");
const scratch = mkdtempSync(join(tmpdir(), "maipai-stopdev-"));
const started: ChildProcess[] = [];
// A main checkout has a .git directory, a worktree a .git file; the stand-in hubs run from the backend folder of one or the other.
const mainCheckout = join(scratch, "home");
const worktree = join(scratch, "wt");
mkdirSync(join(mainCheckout, ".git"), { recursive: true });
mkdirSync(join(mainCheckout, "backend"), { recursive: true });
mkdirSync(join(worktree, "backend"), { recursive: true });
writeFileSync(join(worktree, ".git"), "gitdir: elsewhere\n");
afterEach(() => { for (const child of started.splice(0)) { try { child.kill("SIGKILL"); } catch { /* gone */ } } });

// A stand-in process: a shell loop whose arguments spell the command line of a dev hub, started in a hub folder. It is started by a shell
// that exits at once, so init adopts it: a child of this test would stay a zombie while spawnSync blocks, and a zombie still answers kill -0.
function fakeHub(dir: string, ignoreTerm = false): { pid: number } {
  const loop = ignoreTerm ? "trap '' TERM; while true; do sleep 1; done" : "while true; do sleep 1; done";
  const out = spawnSync("bash", ["-c", `cd '${join(dir, "backend")}' && (bash -c "$1" bash home/backend/src/index.ts >/dev/null 2>&1 </dev/null & echo $!)`, "x", loop], { encoding: "utf8" });
  const pid = Number(out.stdout.trim());
  started.push({ kill: () => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } } as ChildProcess);
  return { pid };
}
const lockFor = (pid: number): string => { const path = join(scratch, `hub-${pid}.lock`); writeFileSync(path, JSON.stringify({ pid, startedAt: Date.now(), port: 8787, dataDir: "x", cwd: scratch })); return path; };
const run = (lock: string, extra: string[] = []) => spawnSync("bash", [script, "--lock-file", lock, "--port", "1", "--wait", "3", ...extra], { encoding: "utf8" });
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("stop-dev-home.sh", () => {
  test("stops a dev Home from the main checkout named by the lock file, and says how to restart it", async () => {
    const hub = fakeHub(mainCheckout);
    await sleep(300);
    const out = run(lockFor(hub.pid));
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("Stopped the development Home");
    expect(out.stdout).toContain("bun start");
    await sleep(200);
    expect(alive(hub.pid)).toBe(false);
  });

  test("leaves alone a hub running from a worktree, a process whose command is not the hub, and one running from the installed hub", async () => {
    const worktreeHub = fakeHub(worktree);
    const otherPid = Number(spawnSync("bash", ["-c", `cd '${join(mainCheckout, "backend")}' && (sleep 300 >/dev/null 2>&1 </dev/null & echo $!)`], { encoding: "utf8" }).stdout.trim());
    const other = { pid: otherPid };
    started.push({ kill: () => { try { process.kill(otherPid, "SIGKILL"); } catch { /* gone */ } } } as ChildProcess);
    const installed = fakeHub(mainCheckout);
    await sleep(300);
    expect(run(lockFor(worktreeHub.pid)).stdout).toBe("");
    expect(run(lockFor(other.pid)).stdout).toBe("");
    const out = run(lockFor(installed.pid), ["--live", mainCheckout]);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
    for (const child of [worktreeHub, other, installed]) expect(alive(child.pid)).toBe(true);
  });

  test("a lock file with a dead pid, or no lock file, is nothing to do", () => {
    expect(run(lockFor(2_147_000_000)).status).toBe(0);
    expect(run(join(scratch, "missing.lock")).status).toBe(0);
  });

  test("a hub that ignores TERM is not killed harder: it exits 1 and names the folder", async () => {
    const hub = fakeHub(mainCheckout, true);
    await sleep(300);
    const out = run(lockFor(hub.pid), ["--wait", "1"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("did not stop");
    expect(out.stderr).toContain("bun stop");
    expect(alive(hub.pid)).toBe(true);
  });
});

process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// A dev Home outliving its worktree kept 37 connections to the shared Stack for hours and stalled live chat (2026-10-27): the watcher `dev.sh start` launches stops it.
describe("dev.sh watch", () => {
  test("stops the dev Home once its worktree no longer exists", async () => {
    const root = join(scratch, "gone-wt");
    mkdirSync(join(root, "data", "dev"), { recursive: true });
    const spawned = spawnSync("bash", ["-c", `(bash -c 'while true; do sleep 1; done' bun src/index.ts >/dev/null 2>&1 </dev/null & echo $!)`], { encoding: "utf8" });
    const pid = Number(spawned.stdout.trim());
    started.push({ kill: () => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } } as ChildProcess);
    writeFileSync(join(root, "data", "dev", "backend.pid"), `${pid}\n`);
    await sleep(300);
    expect(alive(pid)).toBe(true);
    // The watcher starts while the worktree exists, then the worktree is removed under it.
    writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
    const watcher = spawn("bash", [join(import.meta.dir, "dev.sh"), "watch"], { stdio: "ignore", env: { ...process.env, MAIPAI_DEV_ROOT: root, MAIPAI_DEV_WATCH_SECONDS: "1" } });
    started.push(watcher);
    await sleep(2500);
    expect(alive(pid)).toBe(true);
    rmSync(join(root, ".git"));
    for (let i = 0; i < 40 && alive(pid); i++) await sleep(250);
    expect(alive(pid)).toBe(false);
    expect(readFileSync(join(root, "data", "dev", "watch.log"), "utf8")).toContain("its worktree was removed");
  }, 30000);
});
