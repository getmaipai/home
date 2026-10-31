import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as fixtures from "./tests/landerFixtures";
const { main, data, env, git, run, makeWorktree, commit, setup, cleanup } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);
afterAll(cleanup);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function descendants(root: number): number[] {
  const out = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout;
  const kids = new Map<number, number[]>();
  for (const line of out.trim().split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const stack = [root];
  while (stack.length) for (const k of kids.get(stack.pop()!) ?? []) { found.push(k); stack.push(k); }
  return found.sort((a, b) => a - b);
}
function spawnWait(args: string[]) {
  return Bun.spawn(["bash", join(main, "scripts", "pipeline.sh"), "wait", ...args], { cwd: main, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
}
async function waitFor(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await sleep(50); }
  throw new Error("condition not reached");
}

describe("pipeline wait", () => {
  test("a waiter blocked on a SHA spawns nothing while idle and wakes within 2 s of the landing note", async () => {
    const wt = makeWorktree("waited");
    writeFileSync(join(wt, "file.txt"), "waited change\n");
    const sha = commit(wt, "waited change");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    const waiter = spawnWait([sha, "--timeout", "60"]);
    const want = join(data, "waiters", `${waiter.pid}.want`);
    await waitFor(() => existsSync(want));
    await sleep(700);
    const before = descendants(waiter.pid);
    await sleep(3000);
    const after = descendants(waiter.pid);
    expect(after).toEqual(before);
    expect(waiter.exitCode).toBeNull();
    const processed = run("lander.sh", ["run-once"]);
    expect(processed.status).toBe(0);
    const landedAt = Date.now();
    const code = await Promise.race([waiter.exited, sleep(2000).then(() => -1)]);
    expect(code).toBe(0);
    expect(Date.now() - landedAt).toBeLessThan(2000);
    expect(await new Response(waiter.stdout).text()).toContain("landed");
    expect(existsSync(want)).toBe(false);
    expect(existsSync(join(data, "waiters", `${waiter.pid}.fifo`))).toBe(false);
  }, 60_000);

  test("times out with exit 2 and removes its files", async () => {
    const waiter = spawnWait(["deadbeef01", "--timeout", "1"]);
    expect(await waiter.exited).toBe(2);
    expect(await new Response(waiter.stderr).text()).toContain("timed out");
    expect(readdirSync(join(data, "waiters")).filter((f) => f.startsWith(`${waiter.pid}.`))).toHaveLength(0);
  }, 30_000);

  test("the lander removes the files of a waiter whose process is dead", () => {
    const dead = spawnSync("bash", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    const wdir = join(data, "waiters");
    mkdirSync(wdir, { recursive: true });
    spawnSync("mkfifo", [join(wdir, `${dead}.fifo`)]);
    writeFileSync(join(wdir, `${dead}.want`), "queue-empty\t\n");
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(existsSync(join(wdir, `${dead}.want`))).toBe(false);
    expect(existsSync(join(wdir, `${dead}.fifo`))).toBe(false);
  }, 30_000);
});
