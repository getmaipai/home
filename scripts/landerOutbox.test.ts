import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, data, main, pipelineBin, env, git, run, makeWorktree, commit, note, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

// OUTBOX-01: GitHub is behind the landing. A landing is complete on the pipeline's own main (refs/pipeline/main); the outbox pushes it
// to GitHub afterwards, in order, fast-forward only. These tests take GitHub away (unreachable remote, failing or hanging pushes,
// a remote that moved on its own) and prove that landing, the status line, wait, where, ship and recovery behave.
const originMain = () => git(origin, "rev-parse", "refs/heads/main");
const pipelineMain = () => git(main, "rev-parse", "refs/pipeline/main");
const status = () => run("pipeline.sh", ["status"]).stdout;
const pushLog = () => join(scratch, "push-log");
const realGit = () => Bun.spawnSync(["bash", "-c", "command -v git"]).stdout.toString().trim();
const stubBin = () => join(scratch, "outbox-bin");
let pathBefore = "";

// A stub git that logs every push of a commit to refs/heads/main and fails it while `mode` says so.
function stubGit(mode: "fail" | "pass") {
  mkdirSync(stubBin(), { recursive: true });
  writeFileSync(
    join(stubBin(), "git"),
    `#!/bin/bash
if [[ " $* " == *" push "* && "$*" == *":refs/heads/main"* ]]; then
  echo "$*" >> ${pushLog()}
  if [[ ${JSON.stringify(mode)} == fail ]]; then echo "fatal: unable to access 'https://github.com/example/home.git/': Connection reset by peer" >&2; exit 128; fi
fi
exec ${realGit()} "$@"
`,
  );
  chmodSync(join(stubBin(), "git"), 0o755);
  env.PATH = `${stubBin()}:${pathBefore}`;
}
function landOne(name: string, line: string) {
  const w = makeWorktree(name);
  writeFileSync(join(w, `${name}.txt`), `${line}\n`);
  const sha = commit(w, line);
  expect(run("land.sh", ["--detach"], w).status).toBe(0);
  return sha;
}

beforeAll(() => {
  setup();
  pathBefore = env.PATH ?? process.env.PATH ?? "";
  env.GITNET_TIMEOUT = "5";
  env.GITNET_TRIES = "1";
  env.GITNET_BACKOFF = "0";
  writeFileSync(pushLog(), "");
}, 60_000);
afterAll(() => cleanup());

describe("the outbox", () => {
  test("a failing push does not stop a landing; the status says how far ahead main is and backs off; a later flush pushes everything in order without force", () => {
    env.MAIPAI_LAND_OUTBOX_BASE_SECONDS = "40";
    stubGit("fail");
    const githubBefore = originMain();
    landOne("out_a", "entry out_a");
    landOne("out_b", "entry out_b");
    let pushesAfterFirst = 0;
    for (const name of ["out_a", "out_b"]) {
      const result = run("lander.sh", ["run-once"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`landed: wt/${name}`);
      expect(note(name).status).toBe("landed");
      if (name === "out_a") pushesAfterFirst = readFileSync(pushLog(), "utf8").trim().split("\n").length;
    }
    expect(queueFiles()).toHaveLength(0);
    expect(originMain()).toBe(githubBefore);
    const behind = status();
    expect(behind).toMatch(/GitHub main: main is ahead of GitHub by 2 commits \(oldest \d+ min\), push retrying \(try 1, next in \d+s, last error: .*Connection reset/);
    // The second landing did not try the push again: the pause the first failure set still applied.
    expect(pushesAfterFirst).toBe(2); // the first flush tried the push twice
    expect(readFileSync(pushLog(), "utf8").trim().split("\n")).toHaveLength(pushesAfterFirst);
    expect(Number(readFileSync(join(data, "outbox", "next-try"), "utf8"))).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // A forced flush while GitHub is still down grows the pause (40 s, then 80 s).
    expect(run("lander.sh", ["outbox", "flush"]).status).toBe(0);
    expect(readFileSync(join(data, "outbox", "tries"), "utf8").trim()).toBe("2");
    const second = Number(readFileSync(join(data, "outbox", "next-try"), "utf8")) - Math.floor(Date.now() / 1000);
    expect(second).toBeGreaterThan(60);
    expect(second).toBeLessThanOrEqual(80);

    stubGit("pass");
    expect(run("lander.sh", ["outbox", "flush"]).status).toBe(0);
    expect(originMain()).toBe(pipelineMain());
    expect(git(origin, "log", "--format=%s", "-3", "refs/heads/main").split("\n").slice(0, 2)).toEqual(["entry out_b", "entry out_a"]);
    expect(status()).toContain("GitHub main: in sync");
    expect(existsSync(join(data, "outbox", "pending-since"))).toBe(false);
    // Fast-forward only: no push of the outbox ever carried a force flag or a plus refspec.
    for (const line of readFileSync(pushLog(), "utf8").trim().split("\n")) {
      expect(line).not.toMatch(/--force|\s-f\s|\+[0-9a-f]{7,}:/);
      expect(line).toMatch(/push origin [0-9a-f]{40}:refs\/heads\/main/);
    }
  }, 120_000);

  test("GitHub unreachable for fetch and push alike: landing, where.sh and wait still work from the repository, and the flush catches up once it is back", () => {
    stubGit("pass");
    const url = git(main, "remote", "get-url", "origin");
    git(main, "remote", "set-url", "origin", join(scratch, "no-such-remote.git"));
    try {
      const sha = landOne("out_down", "entry out_down");
      const result = run("lander.sh", ["run-once"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("landed: wt/out_down");
      expect(note("out_down").status).toBe("landed");
      expect(originMain()).not.toBe(pipelineMain());
      expect(status()).toContain("main is ahead of GitHub by 1 commits");
      const where = Bun.spawnSync(["bash", join(import.meta.dir, "where.sh"), sha], { cwd: main, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
      expect(where.stdout.toString()).toContain("GitHub main: NOT YET");
      const waited = run("pipeline.sh", ["wait", sha, "--timeout", "5"]);
      expect(waited.status).toBe(0);
      expect(waited.stdout).toContain("landed");
    } finally {
      git(main, "remote", "set-url", "origin", url);
    }
    expect(run("lander.sh", ["outbox", "flush"]).status).toBe(0);
    expect(originMain()).toBe(pipelineMain());
    expect(status()).toContain("GitHub main: in sync");
  }, 120_000);

  test("a new worktree and the next landing start from the landed main while GitHub lags", () => {
    stubGit("fail");
    env.MAIPAI_LAND_OUTBOX_BASE_SECONDS = "600";
    landOne("out_lag1", "entry out_lag1");
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/out_lag1");
    const landed = pipelineMain();
    expect(originMain()).not.toBe(landed);
    // The next entry is built on the first one even though origin/main does not have it.
    landOne("out_lag2", "entry out_lag2");
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/out_lag2");
    expect(git(main, "merge-base", "--is-ancestor", landed, pipelineMain())).toBeDefined();
    expect(git(main, "rev-list", "--count", `${landed}..${pipelineMain()}`)).toBe("1");
    stubGit("pass");
    expect(run("lander.sh", ["outbox", "flush"]).status).toBe(0);
    expect(originMain()).toBe(pipelineMain());
  }, 120_000);

  test("a GitHub main that moved on its own (diverged) holds the queue loudly, never forces, and reset-to-github parks the landed commits and recovers", () => {
    stubGit("fail");
    env.MAIPAI_LAND_HOLD_SECONDS = "0";
    landOne("out_div_a", "entry out_div_a");
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/out_div_a");
    const landedTip = pipelineMain();
    // Someone pushes to GitHub's main directly (not through the lander), so the two mains no longer descend from each other.
    const other = makeWorktree("out_div_other");
    writeFileSync(join(other, "other.txt"), "pushed straight to GitHub\n");
    commit(other, "direct push to GitHub main");
    git(other, "push", origin, "HEAD:refs/heads/main");
    stubGit("pass");
    landOne("out_div_b", "entry out_div_b");
    const held = run("lander.sh", ["run-once"]);
    expect(held.status).toBe(0);
    expect(held.stdout).toContain("held: wt/out_div_b");
    expect(held.stdout).toContain("reset-to-github");
    expect(queueFiles()).toHaveLength(1);
    expect(pipelineMain()).toBe(landedTip);
    expect(status()).toContain("STUCK: GitHub main and the landed main diverged");
    // The outbox itself also refuses to push over GitHub's main.
    expect(run("lander.sh", ["outbox", "flush"]).status).toBe(0);
    expect(git(origin, "log", "--format=%s", "-1", "refs/heads/main")).toBe("direct push to GitHub main");

    const reset = run("lander.sh", ["outbox", "reset-to-github"]);
    expect(reset.status).toBe(0);
    expect(reset.stdout).toMatch(/parked the landed commits on wt\/outbox-parked-/);
    const parked = git(main, "branch", "--list", "wt/outbox-parked-*", "--format=%(refname:short)").split("\n")[0]!;
    expect(parked).toMatch(/^wt\/outbox-parked-/);
    expect(git(main, "rev-parse", parked)).toBe(landedTip);
    expect(pipelineMain()).toBe(originMain());

    const after = run("lander.sh", ["run-once"]);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain("landed: wt/out_div_b");
    expect(originMain()).toBe(pipelineMain());
    expect(git(origin, "log", "--format=%s", "-2", "refs/heads/main").split("\n")).toEqual(["entry out_div_b", "direct push to GitHub main"]);
    expect(status()).toContain("GitHub main: in sync");
  }, 120_000);

  test("a landing that happens while a flush is pushing is never rewound by that flush, and stays pending for the next one", () => {
    stubGit("pass");
    // The stub does the real push, then moves the ref to a child of the pushed commit, the way a landing during the push would.
    writeFileSync(
      join(stubBin(), "git"),
      `#!/bin/bash
if [[ " $* " == *" push "* && "$*" == *":refs/heads/main"* ]]; then
  pushed=$(printf '%s' "$*" | grep -oE '[0-9a-f]{40}:refs/heads/main' | head -n 1 | cut -d: -f1)
  ${realGit()} "$@"; rc=$?
  newer=$(GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test ${realGit()} -C ${main} commit-tree "$pushed^{tree}" -p "$pushed" -m "landed while pushing")
  echo "$pushed $newer" > ${join(scratch, "race-shas")}
  ${realGit()} -C ${main} update-ref refs/pipeline/main "$newer" "$pushed"
  exit $rc
fi
exec ${realGit()} "$@"
`,
    );
    chmodSync(join(stubBin(), "git"), 0o755);
    landOne("out_race", "entry out_race");
    expect(run("lander.sh", ["run-once"]).stdout).toContain("landed: wt/out_race");
    const [pushed, newer] = readFileSync(join(scratch, "race-shas"), "utf8").trim().split(" ");
    expect(originMain()).toBe(pushed!);
    // The flush finished its push of `pushed`; it did not set the ref back to it, and what GitHub lacks is still pending.
    expect(pipelineMain()).toBe(newer!);
    expect(existsSync(join(data, "outbox", "pending-since"))).toBe(true);
    expect(status()).toContain("main is ahead of GitHub by 1 commits");
    stubGit("pass");
    expect(run("lander.sh", ["outbox", "flush"]).status).toBe(0);
    expect(originMain()).toBe(newer!);
    expect(status()).toContain("GitHub main: in sync");
  }, 120_000);

  test("wt.sh start moves a fresh worktree to the landed main when GitHub lags, says so, and starts from origin/main otherwise", () => {
    stubGit("pass");
    env.MAIPAI_WT_SHARED = join(scratch, "fake-shared-wt.sh");
    // Stands in for the shared getmaipai/.github wt.sh: start creates a worktree on a new branch from origin/main and prints its path.
    writeFileSync(env.MAIPAI_WT_SHARED, `#!/usr/bin/env bash
[[ "$1" == start ]] || exit 0
path="${join(scratch, "wtstart-")}$2"
git worktree add -q -b "wt/wtstart-$2" "$path" origin/main >&2
echo "$path"
`);
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
    const head = (dir: string) => git(dir, "rev-parse", "HEAD");
    const plain = run("wt.sh", ["start", "plain"]);
    expect(plain.status).toBe(0);
    const plainPath = plain.stdout.trim().split("\n").at(-1)!;
    expect(head(plainPath)).toBe(git(main, "rev-parse", "origin/main"));
    expect(plain.stderr).not.toContain("landed main");

    const originTip = git(main, "rev-parse", "origin/main");
    const landed = Bun.spawnSync(["git", "-C", main, "commit-tree", `${originTip}^{tree}`, "-p", originTip, "-m", "landed, push pending"], { env: gitEnv as Record<string, string> }).stdout.toString().trim();
    git(main, "update-ref", "refs/pipeline/main", landed);
    try {
      const lag = run("wt.sh", ["start", "lag"]);
      expect(lag.status).toBe(0);
      const lagPath = lag.stdout.trim().split("\n").at(-1)!;
      expect(head(lagPath)).toBe(landed);
      expect(lag.stderr).toContain("starts from the landed main");
      expect(lag.stderr).toContain(landed.slice(0, 7));
    } finally {
      git(main, "update-ref", "-d", "refs/pipeline/main");
      delete env.MAIPAI_WT_SHARED;
    }
  }, 60_000);

  test("a lander that finds an older helper snapshot takes the current one from origin/main before it runs, and never touches a tracked file", () => {
    mkdirSync(pipelineBin, { recursive: true });
    const snapshot = join(pipelineBin, "gitnet.sh");
    writeFileSync(snapshot, "# older helper without the outbox functions\ngitnet_env() { :; }\nbounded_run() { shift 2; \"$@\"; }\ngitnet() { git \"$@\"; }\n");
    const tracked = readFileSync(join(main, "scripts", "lib", "gitnet.sh"), "utf8");
    const result = run("lander.sh", ["run-once"]);
    expect(result.status).toBe(0);
    expect(readFileSync(snapshot, "utf8")).toContain("pipeline_main_sha()");
    expect(readFileSync(join(main, "scripts", "lib", "gitnet.sh"), "utf8")).toBe(tracked);
    rmSync(snapshot, { force: true });
  }, 60_000);
});
