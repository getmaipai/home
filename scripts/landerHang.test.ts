import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, data, main, env, git, run, makeWorktree, commit, note, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

// GITNET-01: a push that never answers must not hold the landing queue. A stub `git` hangs the first pushes to main (the lander tries a push twice) (the way
// the real ssh child did on 2026-11-01); the bounded lander kills only that process group, defers the entry, lands the entries
// behind it, retries the deferred one, and after the allowed tries bounces it with the cause.
const stubBin = () => join(scratch, "hang-bin");
const hangCounter = () => join(scratch, "hang-count");
const hangPids = () => join(scratch, "hang-pids");

// OUTBOX-01: the push to GitHub is the outbox's job, not the landing's. The stub hangs the first pushes of a commit to refs/heads/main
// (the way the real ssh child did on 2026-11-01); the bounded lander kills only that process group, and the landing is already done.
function installHangStub(hangFirst: number) {
  const real = Bun.spawnSync(["bash", "-c", "command -v git"]).stdout.toString().trim();
  mkdirSync(stubBin(), { recursive: true });
  writeFileSync(hangCounter(), "0");
  writeFileSync(hangPids(), "");
  writeFileSync(
    join(stubBin(), "git"),
    `#!/bin/bash
if [[ " $* " == *" push "* && "$*" == *":refs/heads/main"* ]]; then
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
const originMain = () => git(origin, "rev-parse", "refs/heads/main");
const pipelineMain = () => git(main, "rev-parse", "refs/pipeline/main");

beforeAll(() => {
  setup();
  env.GITNET_TIMEOUT = "2";
  env.GITNET_TRIES = "1";
  env.GITNET_BACKOFF = "0";
  env.MAIPAI_LAND_OUTBOX_BASE_SECONDS = "0";
}, 60_000);

describe("the lander never waits on a hung push", () => {
  test("a hung push is stopped and the landing is already done: the next entry lands, the outbox pushes both in order on its next try", () => {
    installHangStub(2); // the outbox pushes with two tries, so the first two pushes both hang
    const first = makeWorktree("hang_first");
    writeFileSync(join(first, "first.txt"), "first\n");
    const firstSha = commit(first, "first entry");
    expect(run("land.sh", ["--detach"], first).status).toBe(0);
    const second = makeWorktree("hang_second");
    writeFileSync(join(second, "second.txt"), "second\n");
    commit(second, "second entry");
    expect(run("land.sh", ["--detach"], second).status).toBe(0);
    const githubBefore = originMain();

    const started = Date.now();
    const one = run("lander.sh", ["run-once"]);
    expect(one.status).toBe(0);
    expect(one.stdout).toContain("landed: wt/hang_first");
    expect(note("hang_first").status).toBe("landed");
    expect((Date.now() - started) / 1000).toBeLessThan(40);
    // The change is on the pipeline's main, GitHub does not have it, and nothing is deferred or bounced.
    expect(git(main, "merge-base", "--is-ancestor", firstSha, "refs/pipeline/main")).toBeDefined();
    expect(originMain()).toBe(githubBefore);
    expect(queueFiles()).toHaveLength(1);
    expect(existsSync(join(data, "outbox", "pending-since"))).toBe(true);
    expect(readFileSync(join(data, "outbox", "last-error"), "utf8")).toBeDefined();
    const stuckLog = readFileSync(join(data, "stuck.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(stuckLog.at(-1).op).toBe("push main (outbox)");
    for (const pid of readFileSync(hangPids(), "utf8").split("\n").filter(Boolean).map(Number)) expect(alive(pid)).toBe(false);
    const status = run("pipeline.sh", ["status"]).stdout;
    expect(status).toContain("main is ahead of GitHub by 1 commits");
    expect(status).toContain("push retrying");

    // The next entry lands on top of the first one, and the outbox pushes the tip, which carries both commits in order.
    const two = run("lander.sh", ["run-once"]);
    expect(two.status).toBe(0);
    expect(two.stdout).toContain("landed: wt/hang_second");
    expect(note("hang_second").status).toBe("landed");
    expect(queueFiles()).toHaveLength(0);
    expect(originMain()).toBe(pipelineMain());
    expect(git(origin, "log", "--format=%s", "-3", "refs/heads/main").split("\n").slice(0, 2)).toEqual(["second entry", "first entry"]);
    expect(existsSync(join(data, "outbox", "pending-since"))).toBe(false);
    expect(run("pipeline.sh", ["status"]).stdout).toContain("GitHub main: in sync");
    expect(existsSync(join(data, "current-entry"))).toBe(false);
  }, 120_000);

  test("GitHub down for good: entries keep landing, the status says how far ahead main is, and one flush later catches GitHub up in order", () => {
    installHangStub(100);
    const names = ["down_a", "down_b"];
    for (const name of names) {
      const w = makeWorktree(name);
      writeFileSync(join(w, `${name}.txt`), `${name}\n`);
      commit(w, `entry ${name}`);
      expect(run("land.sh", ["--detach"], w).status).toBe(0);
    }
    const githubBefore = originMain();
    for (const name of names) {
      const result = run("lander.sh", ["run-once"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`landed: wt/${name}`);
      expect(note(name).status).toBe("landed");
    }
    expect(originMain()).toBe(githubBefore);
    expect(queueFiles()).toHaveLength(0);
    const status = run("pipeline.sh", ["status"]).stdout;
    expect(status).toContain("main is ahead of GitHub by 2 commits");
    expect(status).not.toContain("STUCK: GitHub");

    installHangStub(0);
    const flush = run("lander.sh", ["outbox", "flush"]);
    expect(flush.status).toBe(0);
    expect(originMain()).toBe(pipelineMain());
    expect(git(origin, "log", "--format=%s", "-3", "refs/heads/main").split("\n").slice(0, 2)).toEqual(["entry down_b", "entry down_a"]);
    expect(run("pipeline.sh", ["status"]).stdout).toContain("GitHub main: in sync");
  }, 120_000);

  test("a long step that never ends is stopped and the entry is unfinished (never landed) with the timeout in the reason", () => {
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
    expect(note("check_hangs").status).toBe("unfinished");
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
    expect(out).toContain('note: lander hung "push main (outbox)" (bound 2 s) and was stopped');
    sleeper.kill();
    rmSync(join(data, "ops", `${sleeper.pid}.op`), { force: true });
  });
});

afterAll(() => {
  delete env.GITNET_TIMEOUT;
  cleanup();
});
