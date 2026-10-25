import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
let snapshotCount = 0;
const sourceScripts = ["watcher.sh", "pipeline.sh"];

function git(dir: string, ...args: string[]) {
  const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  return out.stdout.trim();
}

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-watcher-"));
  roots.push(scratch);
  const origin = join(scratch, "origin.git");
  const main = join(scratch, "main");
  const data = join(scratch, "watch-data");
  const pipelineBin = join(scratch, "pipeline-bin");
  const warm = join(scratch, "home-watcher");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MAIPAI_WATCH_DATA: data,
    MAIPAI_PIPELINE_BIN: pipelineBin,
    MAIPAI_WATCH_CHECKOUT: warm,
    MAIPAI_WATCH_SKIP_INSTALL: "1",
    MAIPAI_WATCH_QUIET_MAX_SECONDS: "0",
    MAIPAI_LAND_DATA: join(scratch, "land-data"),
    MAIPAI_WATCH_LEGS: "backend frontend",
    MAIPAI_LAND_GIT_ENV: "",
    MAIPAI_WATCH_SUITE_CMD: "bash scripts/suite.sh",
    MAIPAI_WATCH_RERUN_CMD: "bash scripts/rerun.sh",
    MAIPAI_WATCH_ISSUE_CMD: `bash ${join(scratch, "issue.sh")}`,
    MAIPAI_WATCH_NO_LOCK: "1",
  };
  spawnSync("git", ["init", "--bare", "--initial-branch=main", origin], { encoding: "utf8" });
  spawnSync("git", ["clone", origin, main], { encoding: "utf8" });
  git(main, "config", "user.name", "Watcher Test");
  git(main, "config", "user.email", "watcher@example.test");
  mkdirSync(join(main, "scripts"), { recursive: true });
  for (const name of sourceScripts) copyFileSync(join(import.meta.dir, name), join(main, "scripts", name));
  writeFileSync(join(main, "scripts", "suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then echo '(fail) breaks [1ms]'; echo 'shard: failing files: backend/tests/broken.test.ts'; exit 1; fi\necho 'all green'\n");
  writeFileSync(join(main, "scripts", "rerun.sh"), "#!/usr/bin/env bash\nif [[ -f RED && ! -f FLAKY ]]; then exit 1; fi\nexit 0\n");
  writeFileSync(join(scratch, "issue.sh"), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> '${join(scratch, "issue.calls")}'\n`);
  writeFileSync(join(main, "base.txt"), "base\n");
  git(main, "add", "-A");
  git(main, "commit", "-m", "fixture base");
  git(main, "push", "-u", "origin", "main");
  return { scratch, origin, main, data, warm, pipelineBin, env };
}

function pushScriptChange(f: ReturnType<typeof fixture>, marker: string) {
  git(f.main, "fetch", "origin");
  const id = ++snapshotCount;
  const worktree = join(f.scratch, `snapshot-${id}`);
  git(f.main, "worktree", "add", "-b", `wt/snapshot-${id}`, worktree, "origin/main");
  const path = join(worktree, "scripts/watcher.sh");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n# ${marker}\n`);
  git(worktree, "add", "scripts/watcher.sh");
  git(worktree, "commit", "-m", marker);
  git(worktree, "push", "origin", "HEAD:main");
}

function commit(f: ReturnType<typeof fixture>, message: string, files: Record<string, string>) {
  for (const [name, value] of Object.entries(files)) writeFileSync(join(f.main, name), value);
  git(f.main, "add", "-A");
  git(f.main, "commit", "-m", message);
  const sha = git(f.main, "rev-parse", "HEAD");
  git(f.main, "push", "origin", "main");
  return sha;
}

function run(f: ReturnType<typeof fixture>, script: string, args: string[] = [], env: NodeJS.ProcessEnv = f.env) {
  return spawnSync("bash", [join(f.main, "scripts", script), ...args], {
    cwd: f.main,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function records(f: ReturnType<typeof fixture>) {
  return readFileSync(join(f.data, "runs.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("main watcher", () => {
  test("refresh copies watcher code from origin/main and status reports its age", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["refresh"]).stdout.trim()).toBe("changed");
    const original = readFileSync(join(f.pipelineBin, "watcher.sh"), "utf8");
    expect(run(f, "watcher.sh", ["refresh"]).stdout.trim()).toBe("unchanged");
    expect(run(f, "pipeline.sh", ["status"]).stdout).toContain("watcher code: current");

    pushScriptChange(f, "snapshot watcher update");
    expect(run(f, "watcher.sh", ["refresh"]).stdout.trim()).toBe("changed");
    expect(readFileSync(join(f.pipelineBin, "watcher.sh"), "utf8")).toBe(`${git(f.main, "show", "origin/main:scripts/watcher.sh")}\n`);
    expect(readFileSync(join(f.pipelineBin, "watcher.sh"), "utf8")).not.toBe(original);
    pushScriptChange(f, "snapshot watcher newer");
    expect(run(f, "pipeline.sh", ["status"]).stdout).toContain("watcher code: older than origin/main");
  }, 60_000);

  test("waits for a queued landing, then runs and records the suite after the cap", () => {
    const f = fixture();
    mkdirSync(join(f.env.MAIPAI_LAND_DATA!, "queue"), { recursive: true });
    writeFileSync(join(f.env.MAIPAI_LAND_DATA!, "queue", "pending.json"), "{}\n");
    const started = Date.now();
    const out = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_QUIET_MAX_SECONDS: "2",
      MAIPAI_WATCH_QUIET_POLL_SECONDS: "1",
    });
    expect(out.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1300);
    expect(records(f)[0].result).toBe("green");
    expect(readFileSync(join(f.data, "watcher.log"), "utf8")).toContain("waiting: lander busy");
    expect(readFileSync(join(f.data, "watcher.log"), "utf8")).toContain("waited 2s; waiting: lander busy; running anyway");
  }, 60_000);

  test("takes and releases the machine gate lock around the suite, and continues when acquire fails", () => {
    const f = fixture();
    const lock = join(f.scratch, "gate-lock.sh");
    const calls = join(f.scratch, "lock.calls");
    writeFileSync(lock, `#!/usr/bin/env bash\nprintf '%s %s\\n' "$1" "${"$"}{2:-}" >> '${calls}'\n`);
    commit(f, "lock suite marker", {
      "scripts/suite.sh": `#!/usr/bin/env bash\necho suite >> '${calls}'\necho 'all green'\n`,
    });
    const env = { ...f.env, MAIPAI_WATCH_NO_LOCK: "", MAIPAI_GATE_LOCK: lock };
    expect(run(f, "watcher.sh", ["run-once"], env).status).toBe(0);
    const lockCalls = readFileSync(calls, "utf8").trim().split(/\r?\n/);
    expect(lockCalls[0]).toMatch(/^acquire watcher-[0-9]+$/);
    expect(lockCalls[1]).toBe("suite");
    expect(lockCalls[2]).toMatch(/^release watcher-[0-9]+$/);
    expect(lockCalls[0]!.slice("acquire ".length)).toBe(lockCalls[2]!.slice("release ".length));

    const failed = fixture();
    const badLock = join(failed.scratch, "bad-lock.sh");
    writeFileSync(badLock, "#!/usr/bin/env bash\n[[ \"$1\" != acquire ]]\n");
    const bad = run(failed, "watcher.sh", ["run-once"], { ...failed.env, MAIPAI_WATCH_NO_LOCK: "", MAIPAI_GATE_LOCK: badLock });
    expect(bad.status).toBe(0);
    expect(records(failed)[0].result).toBe("green");
    expect(readFileSync(join(failed.data, "watcher.log"), "utf8")).toContain("gate lock acquire failed; running watcher suite without it");
  }, 60_000);

  test("waits for high load until the cap and skips waiting for low load", () => {
    const high = fixture();
    const started = Date.now();
    const highOut = run(high, "watcher.sh", ["run-once"], {
      ...high.env,
      MAIPAI_WATCH_QUIET_MAX_SECONDS: "2",
      MAIPAI_WATCH_QUIET_POLL_SECONDS: "1",
      MAIPAI_WATCH_MAX_LOAD: "1",
      MAIPAI_WATCH_LOAD_CMD: "echo 99",
    });
    expect(highOut.status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1800);
    expect(records(high)[0].result).toBe("green");
    expect(readFileSync(join(high.data, "watcher.log"), "utf8")).toContain("waiting: load 99 above 1");

    const low = fixture();
    const lowOut = run(low, "watcher.sh", ["run-once"], {
      ...low.env,
      MAIPAI_WATCH_MAX_LOAD: "1",
      MAIPAI_WATCH_LOAD_CMD: "echo 0.1",
    });
    expect(lowOut.status).toBe(0);
    expect(records(low)[0].result).toBe("green");
    expect(existsSync(join(low.data, "watcher.log"))).toBe(false);
  }, 60_000);

  test("records green, skips an unchanged main, and reports green status", () => {
    const f = fixture();
    const sha = git(f.main, "rev-parse", "HEAD");
    const first = run(f, "watcher.sh", ["run-once"]);
    expect(first.status).toBe(0);
    expect(existsSync(join(f.data, "green", sha))).toBe(true);
    expect(readFileSync(join(f.data, "last-green"), "utf8").trim()).toBe(sha);
    expect(records(f)[0].result).toBe("green");
    expect(run(f, "watcher.sh", ["run-once"]).stdout).toContain("up to date");
  }, 60_000);

  test("records red, identifies the landing, writes a note and files one issue", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "break tests", { RED: "red\n" });
    const out = run(f, "watcher.sh", ["run-once"]);
    expect(out.status).toBe(0);
    const last = records(f).at(-1);
    expect(last.result).toBe("red");
    expect(last.culprit).toBe(sha);
    expect(readFileSync(join(f.data, "reds", `${sha}.md`), "utf8")).toContain("backend/tests/broken.test.ts");
    expect(existsSync(join(f.scratch, "issue.calls"))).toBe(true);
    expect(readFileSync(join(f.scratch, "issue.calls"), "utf8")).toContain("backend/tests/broken.test.ts");
    expect(existsSync(join(f.data, "green", sha))).toBe(false);
  }, 60_000);

  test("records failing files from multiple leg sections", () => {
    const f = fixture();
    writeFileSync(join(f.main, "scripts/suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then\n  echo '== leg: backend (exit 1, 12 s)'\n  echo 'shard: failing files: backend/tests/a.test.ts'\n  echo '== leg: frontend (exit 1, 8 s)'\n  echo 'shard: failing files: frontend/src/b.test.ts'\n  exit 1\nfi\necho 'all green'\n");
    writeFileSync(join(f.main, "scripts/rerun.sh"), "#!/usr/bin/env bash\nexit 1\n");
    git(f.main, "add", "-A");
    git(f.main, "commit", "-m", "fixture multi-leg suite");
    git(f.main, "push", "origin", "main");
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "break backend and frontend tests", { RED: "red\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const last = records(f).at(-1);
    expect(last.result).toBe("red");
    expect(last.failing).toEqual(["backend/tests/a.test.ts", "frontend/src/b.test.ts"]);
    const note = readFileSync(join(f.data, "reds", `${sha}.md`), "utf8");
    expect(note).toContain("backend/tests/a.test.ts");
    expect(note).toContain("frontend/src/b.test.ts");
    expect(note).toContain("== leg: backend (exit 1, 12 s)");
    expect(note).toContain("== leg: frontend (exit 1, 8 s)");
  }, 60_000);

  test("bisects multiple landings to the commit that introduced RED", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    commit(f, "harmless one", { "one.txt": "one\n" });
    const culprit = commit(f, "introduce RED", { RED: "red\n" });
    commit(f, "harmless two", { "two.txt": "two\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).at(-1).culprit).toBe(culprit);
  }, 60_000);

  test("retries each isolated failure and only marks red when every rerun fails", () => {
    const flaky = fixture();
    expect(run(flaky, "watcher.sh", ["run-once"]).status).toBe(0);
    commit(flaky, "flaky reruns", { RED: "red\n" });
    const counter = join(flaky.scratch, "rerun.counter");
    const counterScript = join(flaky.scratch, "rerun-counter.sh");
    writeFileSync(counterScript, `#!/usr/bin/env bash\nn=0; [[ -f '${counter}' ]] && n=$(cat '${counter}'); n=$((n+1)); echo "$n" > '${counter}'; (( n >= 3 ))\n`);
    expect(run(flaky, "watcher.sh", ["run-once"], {
      ...flaky.env,
      MAIPAI_WATCH_RERUN_CMD: `bash ${counterScript}`,
      MAIPAI_WATCH_RERUNS: "3",
    }).status).toBe(0);
    expect(records(flaky).at(-1).result).toBe("flaky");

    const red = fixture();
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    commit(red, "always red alone", { RED: "red\n" });
    writeFileSync(join(red.main, "scripts/rerun.sh"), "#!/usr/bin/env bash\nexit 1\n");
    expect(run(red, "watcher.sh", ["run-once"], { ...red.env, MAIPAI_WATCH_RERUNS: "3" }).status).toBe(0);
    expect(records(red).at(-1).result).toBe("red");
  }, 60_000);

  test("bisect ignores a candidate that fails only one isolated rerun", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const innocent = commit(f, "innocent intermittent", { "one.txt": "one\n" });
    const culprit = commit(f, "true culprit", { RED: "red\n" });
    commit(f, "after culprit", { "two.txt": "two\n" });
    const counters = join(f.scratch, "candidate-counters");
    mkdirSync(counters);
    const rerunScript = join(f.scratch, "candidate-rerun.sh");
    writeFileSync(rerunScript, `#!/usr/bin/env bash\nsha=$(git rev-parse HEAD); n=0; [[ -f '${counters}/'"$sha" ]] && n=$(cat '${counters}/'"$sha"); n=$((n+1)); echo "$n" > '${counters}/'"$sha"; if [[ -f RED ]]; then exit 1; fi; [[ "$sha" != '${innocent}' || "$n" -gt 1 ]]\n`);
    const out = run(f, "watcher.sh", ["run-once"], {
      ...f.env,
      MAIPAI_WATCH_RERUN_CMD: `bash ${rerunScript}`,
      MAIPAI_WATCH_RERUNS: "3",
    });
    expect(out.status).toBe(0);
    expect(records(f).at(-1).culprit).toBe(culprit);
  }, 60_000);

  test("files one issue on the third flaky run and remembers the file", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    for (let i = 1; i <= 4; i++) {
      commit(f, `flaky run ${i}`, { RED: "red\n", FLAKY: "yes\n", [`run-${i}.txt`]: `${i}\n` });
      expect(run(f, "watcher.sh", ["run-once"], { ...f.env, MAIPAI_WATCH_RERUN_CMD: "true" }).status).toBe(0);
      if (i < 3) expect(existsSync(join(f.scratch, "issue.calls"))).toBe(false);
    }
    const calls = readFileSync(join(f.scratch, "issue.calls"), "utf8").trim().split(/\r?\n/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith("Flaky: backend/tests/broken.test.ts failed with the suite and passed alone 3 times in 7 days");
    expect(readFileSync(join(f.data, "flake-issues.json"), "utf8")).toContain("backend/tests/broken.test.ts");
  }, 60_000);

  test("marks a failure flaky when the isolated rerun passes", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "flaky tests", { RED: "red\n", FLAKY: "yes\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).at(-1).result).toBe("flaky");
    expect(existsSync(join(f.data, "green", sha))).toBe(true);
    expect(existsSync(join(f.scratch, "issue.calls"))).toBe(false);
  }, 60_000);

  test("pipeline status reports watcher and latest green or red main result", () => {
    const green = fixture();
    expect(run(green, "watcher.sh", ["run-once"]).status).toBe(0);
    const greenStatus = run(green, "pipeline.sh", ["status"]).stdout;
    expect(greenStatus).toContain("watcher: stopped");
    expect(greenStatus).toContain("main: green at");

    const red = fixture();
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(red, "break tests", { RED: "red\n" });
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    const redStatus = run(red, "pipeline.sh", ["status"]).stdout;
    expect(redStatus).toContain("watcher: stopped");
    expect(redStatus).toContain(`main: red at ${sha.slice(0, 7)}`);
    expect(redStatus).toContain(sha.slice(0, 7));
  }, 60_000);

  test("pipeline stop succeeds when neither service has a pid file", () => {
    const f = fixture();
    const out = run(f, "pipeline.sh", ["stop"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("lander already stopped");
    expect(out.stdout).toContain("watcher already stopped");
  });
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
