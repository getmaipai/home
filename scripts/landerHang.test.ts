import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, data, main, env, run, makeWorktree, commit, note, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

// GITNET-01: a push that never answers must not hold the landing queue. A stub `git` hangs the first pushes to main (the lander tries a push twice) (the way
// the real ssh child did on 2026-11-01); the bounded lander kills only that process group, defers the entry, lands the entries
// behind it, retries the deferred one, and after the allowed tries bounces it with the cause.
const stubBin = () => join(scratch, "hang-bin");
const hangCounter = () => join(scratch, "hang-count");
const hangPids = () => join(scratch, "hang-pids");

function installHangStub(hangFirst: number) {
  const real = Bun.spawnSync(["bash", "-c", "command -v git"]).stdout.toString().trim();
  mkdirSync(stubBin(), { recursive: true });
  writeFileSync(hangCounter(), "0");
  writeFileSync(hangPids(), "");
  writeFileSync(
    join(stubBin(), "git"),
    `#!/bin/bash
if [[ " $* " == *" push "* && "$*" == *"HEAD:refs/heads/main"* ]]; then
  n=$(( $(cat ${hangCounter()}) + 1 )); echo $n > ${hangCounter()}
  if (( n <= ${hangFirst} )); then echo $$ >> ${hangPids()}; exec sleep 600; fi
fi
exec ${real} "$@"
`,
  );
  chmodSync(join(stubBin(), "git"), 0o755);
  env.PATH = `${stubBin()}:${process.env.PATH ?? ""}`;
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

beforeAll(() => {
  setup();
  env.GITNET_TIMEOUT = "2";
  env.GITNET_TRIES = "1";
  env.GITNET_BACKOFF = "0";
}, 60_000);

describe("the lander never waits on a hung push", () => {
  test("a hung push is stopped, the entry is deferred, the next entry lands, and the deferred one lands on its retry", () => {
    installHangStub(2); // the lander pushes with two tries, so the first two pushes both hang
    env.MAIPAI_LAND_DEFER_SECONDS = "300";
    env.MAIPAI_LAND_DEFER_MAX = "3";
    const first = makeWorktree("hang_first");
    writeFileSync(join(first, "first.txt"), "first\n");
    commit(first, "first entry");
    expect(run("land.sh", ["--detach"], first).status).toBe(0);
    const second = makeWorktree("hang_second");
    writeFileSync(join(second, "second.txt"), "second\n");
    commit(second, "second entry");
    expect(run("land.sh", ["--detach"], second).status).toBe(0);

    const started = Date.now();
    const one = run("lander.sh", ["run-once"]);
    expect(one.status).toBe(0);
    expect(one.stdout).toContain("deferred: wt/hang_first (try 1)");
    expect(one.stdout).toContain("timed out");
    expect((Date.now() - started) / 1000).toBeLessThan(40);
    expect(queueFiles()).toHaveLength(2);
    const stuckLog = readFileSync(join(data, "stuck.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(stuckLog.at(-1).op).toBe("push main");
    for (const pid of readFileSync(hangPids(), "utf8").split("\n").filter(Boolean).map(Number)) expect(alive(pid)).toBe(false);

    const two = run("lander.sh", ["run-once"]);
    expect(two.status).toBe(0);
    expect(two.stdout).toContain("landed: wt/hang_second");
    expect(note("hang_second").status).toBe("landed");
    expect(queueFiles()).toHaveLength(1);

    rmSync(join(data, "deferred"), { recursive: true, force: true });
    const three = run("lander.sh", ["run-once"]);
    expect(three.status).toBe(0);
    expect(three.stdout).toContain("landed: wt/hang_first");
    expect(note("hang_first").status).toBe("landed");
    expect(queueFiles()).toHaveLength(0);
    expect(existsSync(join(data, "current-entry"))).toBe(false);
  }, 120_000);

  test("an entry that keeps timing out is bounced with the cause after the allowed tries, and the one behind it lands", () => {
    installHangStub(100);
    env.MAIPAI_LAND_DEFER_SECONDS = "0";
    env.MAIPAI_LAND_DEFER_MAX = "2";
    const stuck = makeWorktree("hang_always");
    writeFileSync(join(stuck, "always.txt"), "always\n");
    commit(stuck, "entry that never pushes");
    expect(run("land.sh", ["--detach"], stuck).status).toBe(0);

    const one = run("lander.sh", ["run-once"]);
    expect(one.stdout).toContain("deferred: wt/hang_always (try 1)");
    const two = run("lander.sh", ["run-once"]);
    expect(two.stdout).toContain("bounced: wt/hang_always");
    const bounced = note("hang_always");
    expect(bounced.status).toBe("bounced");
    expect(bounced.reason).toContain("git push timed out");
    expect(bounced.reason).toContain("gave up after 2 tries");
    expect(queueFiles()).toHaveLength(0);

    installHangStub(0);
    const ok = makeWorktree("after_hang");
    writeFileSync(join(ok, "after.txt"), "after\n");
    commit(ok, "entry after the bounce");
    expect(run("land.sh", ["--detach"], ok).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/after_hang");
  }, 120_000);

  test("a long step that never ends is stopped and the entry bounces with the timeout in the reason", () => {
    installHangStub(0);
    const prior = { check: env.MAIPAI_LAND_CHECK_CMD, seconds: env.MAIPAI_LAND_CHECK_SECONDS };
    env.MAIPAI_LAND_CHECK_CMD = "sleep 600";
    env.MAIPAI_LAND_CHECK_SECONDS = "2";
    const slow = makeWorktree("check_hangs");
    writeFileSync(join(slow, "slow.txt"), "slow\n");
    commit(slow, "check never ends");
    expect(run("land.sh", ["--detach"], slow).status).toBe(0);
    const started = Date.now();
    const result = run("lander.sh", ["run-once"]);
    expect(result.status).toBe(0);
    expect((Date.now() - started) / 1000).toBeLessThan(40);
    expect(note("check_hangs").status).toBe("bounced");
    expect(note("check_hangs").reason).toContain("static check timed out after 2s");
    env.MAIPAI_LAND_CHECK_CMD = prior.check;
    env.MAIPAI_LAND_CHECK_SECONDS = prior.seconds;
  }, 120_000);

  test("pipeline.sh status says STUCK for an operation past its bound and notes a recently stopped one", () => {
    mkdirSync(join(data, "ops"), { recursive: true });
    const sleeper = Bun.spawn(["sleep", "30"]);
    writeFileSync(join(data, "ops", `${sleeper.pid}.op`), `${sleeper.pid}\t${Math.floor(Date.now() / 1000) - 600}\t90\tpush main\n`);
    const out = run("pipeline.sh", ["status"]).stdout;
    expect(out).toMatch(/STUCK: lander push main for \d+ min \(pid \d+, bound 90 s\)/);
    expect(out).toContain('note: lander hung "push main" (bound 2 s) and was stopped');
    sleeper.kill();
    rmSync(join(data, "ops", `${sleeper.pid}.op`), { force: true });
  });
});

afterAll(() => {
  delete env.GITNET_TIMEOUT;
  cleanup();
});
