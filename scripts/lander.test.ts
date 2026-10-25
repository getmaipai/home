import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "maipai-lander-"));
const origin = join(scratch, "origin.git");
const main = join(scratch, "main");
const data = join(scratch, "land-data");
const watchData = join(scratch, "watch-data");
const pipelineBin = join(scratch, "pipeline-bin");
const warm = join(scratch, "warm-checkout");
const scriptNames = ["land.sh", "lander.sh", "pipeline.sh"];
const env = {
  ...process.env,
  MAIPAI_LAND_DATA: data,
  MAIPAI_WATCH_DATA: watchData,
  MAIPAI_PIPELINE_BIN: pipelineBin,
  MAIPAI_LAND_CHECKOUT: warm,
  MAIPAI_LAND_SKIP_INSTALL: "1",
  MAIPAI_LAND_GIT_ENV: "",
  MAIPAI_LAND_CHECK_CMD: "bash scripts/check.sh --pre",
  MAIPAI_LAND_GENERATE_CMD: "bash scripts/generate.sh",
};

function git(dir: string, ...args: string[]) {
  const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  return out.stdout.trim();
}
function run(script: string, args: string[], cwd = main) {
  return spawnSync("bash", [join(main, "scripts", script), ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
}
function makeWorktree(name: string) {
  const path = join(scratch, name);
  git(main, "worktree", "add", "-b", `wt/${name}`, path, "origin/main");
  return path;
}
function commit(worktree: string, message: string) {
  git(worktree, "add", "-A");
  git(worktree, "commit", "-m", message);
  return git(worktree, "rev-parse", "HEAD");
}
function pushScriptChange(name: string, marker: string) {
  git(main, "fetch", "origin");
  const slug = marker.replace(/[^a-z0-9-]/gi, "-");
  const worktree = join(scratch, `snapshot-${slug}`);
  git(main, "worktree", "add", "-b", `wt/snapshot-${slug}`, worktree, "origin/main");
  const path = join(worktree, "scripts", name);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n# ${marker}\n`);
  git(worktree, "add", `scripts/${name}`);
  git(worktree, "commit", "-m", marker);
  git(worktree, "push", "origin", "HEAD:main");
}
function note(name: string): { branch: string; sha: string; status: string; reason: string; main_sha: string; check_tail: string; note?: string } {
  return JSON.parse(readFileSync(join(data, "notes", `wt-${name}.json`), "utf8"));
}
function queueFiles() { return readdirSync(join(data, "queue")).filter((f) => f.endsWith(".json")); }

beforeAll(() => {
  mkdirSync(scratch, { recursive: true });
  spawnSync("git", ["init", "--bare", "--initial-branch=main", origin], { encoding: "utf8" });
  spawnSync("git", ["clone", origin, main], { encoding: "utf8" });
  git(main, "config", "user.name", "Lander Test");
  git(main, "config", "user.email", "lander@example.test");
  mkdirSync(join(main, "scripts"), { recursive: true });
  for (const name of scriptNames) copyFileSync(join(import.meta.dir, name), join(main, "scripts", name));
  writeFileSync(join(main, "scripts", "check.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then echo 'fake check: RED found'; exit 1; fi\necho 'fake check: clean'\n");
  writeFileSync(join(main, "scripts", "generate.sh"), "#!/usr/bin/env bash\nif [[ -f GEN ]]; then mkdir -p docs/api; git rev-parse HEAD > docs/api/openapi.json; fi\n");
  mkdirSync(join(main, "docs"), { recursive: true });
  writeFileSync(join(main, "docs", "BACKLOG.md"), "- [ ] **ALPHA-01: first** (S).\n- [ ] **BETA-02: second** (S).\n");
  mkdirSync(join(main, "data-scratch"), { recursive: true });
  writeFileSync(join(main, "file.txt"), "line one\nline two\nline three\n");
  git(main, "add", "-A");
  git(main, "commit", "-m", "fixture base");
  git(main, "push", "-u", "origin", "main");
}, 60_000);

describe("lander pipeline", () => {
  test("refresh snapshots atomically and pipeline status compares against origin/main", () => {
    const first = run("lander.sh", ["refresh"]);
    expect(first.status).toBe(0);
    expect(first.stdout.trim()).toBe("changed");
    const original = readFileSync(join(pipelineBin, "lander.sh"), "utf8");
    expect(run("lander.sh", ["refresh"]).stdout.trim()).toBe("unchanged");

    pushScriptChange("lander.sh", "snapshot lander update");
    const updated = run("lander.sh", ["refresh"]);
    expect(updated.stdout.trim()).toBe("changed");
    expect(readFileSync(join(pipelineBin, "lander.sh"), "utf8")).toBe(`${git(main, "show", "origin/main:scripts/lander.sh")}\n`);
    expect(readFileSync(join(pipelineBin, "lander.sh"), "utf8")).not.toBe(original);
    expect(run("pipeline.sh", ["status"]).stdout).toContain("lander code: current");

    pushScriptChange("lander.sh", "snapshot lander newer");
    expect(run("pipeline.sh", ["status"]).stdout).toContain("lander code: older than origin/main");
  }, 60_000);

  test("green landing fast-forwards main, writes a note and removes the remote branch", () => {
    const wt = makeWorktree("alpha");
    writeFileSync(join(wt, "file.txt"), "line one\nline two\nalpha third line\n");
    const sha = commit(wt, "alpha change");
    const queued = run("land.sh", ["--detach"], wt);
    expect(queued.status).toBe(0);
    expect(queued.stdout).toContain("queued: wt/alpha at");
    expect(readFileSync(join(data, "queue", awaitQueueName()), "utf8")).toContain(sha);
    expect(git(origin, "rev-parse", "refs/heads/wt/alpha")).toBe(sha);
    const processed = run("lander.sh", ["run-once"]);
    if (processed.status !== 0) console.error(`lander exited ${processed.status}\nstdout:\n${processed.stdout}\nstderr:\n${processed.stderr}`);
    expect(processed.status).toBe(0);
    if (!existsSync(join(data, "notes", "wt-alpha.json"))) console.error(`landing note missing\nstdout:\n${processed.stdout}\nstderr:\n${processed.stderr}`);
    expect(existsSync(join(data, "notes", "wt-alpha.json"))).toBe(true);
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("alpha change");
    expect(note("alpha").status).toBe("landed");
    expect(note("alpha").main_sha).toBe(git(origin, "rev-parse", "main"));
    expect(readFileSync(join(data, "landings.jsonl"), "utf8").match(/"status": "landed"/g)).toHaveLength(1);
    expect(queueFiles()).toHaveLength(0);
    expect(spawnSync("git", ["--git-dir", origin, "show-ref", "--verify", "refs/heads/wt/alpha"], { encoding: "utf8" }).status).not.toBe(0);
  }, 60_000);

  test("red static check bounces without moving main", () => {
    const wt = makeWorktree("beta");
    writeFileSync(join(wt, "RED"), "red\n");
    commit(wt, "beta red");
    const oldMain = git(origin, "rev-parse", "main");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(origin, "rev-parse", "main")).toBe(oldMain);
    expect(note("beta").status).toBe("bounced");
    expect(note("beta").reason).toBe("static check failed");
    expect(note("beta").check_tail).toContain("fake check: RED found");
    expect(queueFiles()).toHaveLength(0);
  }, 60_000);

  test("rebase conflict note names the conflicting file", () => {
    const delta = makeWorktree("delta");
    const gamma = makeWorktree("gamma");
    writeFileSync(join(gamma, "file.txt"), "gamma first line\nline two\nline three\n");
    commit(gamma, "gamma first-line change");
    expect(run("land.sh", ["--detach"], gamma).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    writeFileSync(join(delta, "file.txt"), "delta first line\nline two\nline three\n");
    commit(delta, "delta first-line change");
    const gammaMain = git(origin, "rev-parse", "main");
    expect(run("land.sh", ["--detach"], delta).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("delta").status).toBe("bounced");
    expect(note("delta").reason).toContain("rebase conflict");
    expect(note("delta").reason).toContain("file.txt");
    expect(git(origin, "rev-parse", "main")).toBe(gammaMain);
  }, 60_000);

  test("land.sh refuses tracked dirt and a branch with no commit ahead", () => {
    const dirty = makeWorktree("dirty");
    writeFileSync(join(dirty, "file.txt"), "dirty\n");
    const dirtyOut = run("land.sh", ["--detach"], dirty);
    expect(dirtyOut.status).toBe(1);
    expect(dirtyOut.stderr).toContain("commit by file name");
    const clean = makeWorktree("clean");
    const cleanOut = run("land.sh", ["--detach"], clean);
    expect(cleanOut.status).toBe(1);
    expect(cleanOut.stderr).toContain("no commit over origin/main");
  }, 60_000);

  test("land.sh reports the recorded main state and warns on a red directory overlap", () => {
    const wt = makeWorktree("watch_status");
    writeFileSync(join(wt, "scripts", "branch-change.ts"), "branch change\n");
    commit(wt, "branch while main red");
    mkdirSync(watchData, { recursive: true });
    const sha = git(main, "rev-parse", "origin/main");
    const culprit = "1234567890abcdef1234567890abcdef12345678";
    const runLand = () => run("land.sh", ["--detach"], wt);
    const record = (result: string, failing: string[] = [], badSha = "") => {
      writeFileSync(join(watchData, "last-run"), `${sha}\n`);
      writeFileSync(join(watchData, "runs.jsonl"), `${JSON.stringify({ sha, result, failing, culprit: badSha })}\n`);
      const out = runLand();
      expect(out.status).toBe(0);
      expect(queueFiles().length).toBeGreaterThan(0);
      for (const file of queueFiles()) rmSync(join(data, "queue", file), { force: true });
      return out.stdout;
    };

    expect(record("green")).toContain(`main: green at ${sha.slice(0, 7)}`);
    const red = record("red", ["scripts/checks.test.ts"], culprit);
    expect(red).toContain(`main: red at ${sha.slice(0, 7)}: scripts/checks.test.ts (culprit ${culprit.slice(0, 7)})`);
    expect(red).toContain("warning: main is red in scripts/checks.test.ts; your branch changes scripts/branch-change.ts");
    expect(record("flaky", ["backend/tests/flaky.test.ts"])).toContain(`main: flaky at ${sha.slice(0, 7)}: backend/tests/flaky.test.ts`);

    rmSync(join(watchData, "last-run"), { force: true });
    writeFileSync(join(watchData, "runs.jsonl"), "");
    const empty = runLand();
    expect(empty.status).toBe(0);
    expect(empty.stdout).not.toContain("main:");
    expect(empty.stdout).toContain("queued: wt/watch_status at");
    for (const file of queueFiles()) rmSync(join(data, "queue", file), { force: true });
  }, 60_000);

  test("waiting form returns the landing note after run-once", async () => {
    const wt = makeWorktree("epsilon");
    writeFileSync(join(wt, "file.txt"), "line one\nline two\nepsilon third line\n");
    commit(wt, "epsilon change");
    const child = Bun.spawn(["bash", join(main, "scripts", "land.sh")], { cwd: wt, env, stdout: "pipe", stderr: "pipe" });
    const queueDeadline = Date.now() + 10_000;
    while (queueFiles().length === 0 && Date.now() < queueDeadline) await Bun.sleep(50);
    expect(queueFiles()).toHaveLength(1);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    const stdout = await new Response(child.stdout).text();
    await child.exited;
    expect(child.exitCode).toBe(0);
    expect(stdout).toContain("landed");
  }, 60_000);

  test("serve finishes the in-flight landing after TERM", async () => {
    const wt = makeWorktree("zeta");
    writeFileSync(join(wt, "file.txt"), "line one\nline two\nzeta third line\n");
    const sha = commit(wt, "zeta change");
    const serveEnv = { ...env, MAIPAI_LAND_POLL_SECONDS: "1", MAIPAI_LAND_CHECK_CMD: "sleep 3 && bash scripts/check.sh --pre" };
    const server = Bun.spawn(["bash", join(main, "scripts", "lander.sh"), "serve"], { cwd: main, env: serveEnv, stdout: "pipe", stderr: "pipe" });
    const pidfile = join(data, "lander.pid");
    const startupDeadline = Date.now() + 10_000;
    while (!existsSync(pidfile) && Date.now() < startupDeadline) await Bun.sleep(25);
    expect(existsSync(pidfile)).toBe(true);
    const queued = run("land.sh", ["--detach"], wt);
    if (queued.status !== 0) console.error(`land.sh exited ${queued.status}\nstdout:\n${queued.stdout}\nstderr:\n${queued.stderr}`);
    expect(queued.status).toBe(0);
    const requestDeadline = Date.now() + 10_000;
    while ((queueFiles().length === 0 || Date.now() < requestDeadline - 9_000) && Date.now() < requestDeadline) await Bun.sleep(25);
    await Bun.sleep(1_050);
    expect(queueFiles()).toHaveLength(1);
    process.kill(Number(readFileSync(pidfile, "utf8").trim()), "SIGTERM");
    const exitCode = await server.exited;
    const stdout = await new Response(server.stdout).text();
    const stderr = await new Response(server.stderr).text();
    if (exitCode !== 0) console.error(`serve exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    expect(exitCode).toBe(0);
    expect(note("zeta").status).toBe("landed");
    expect(note("zeta").sha).toBe(sha);
    expect(git(origin, "rev-parse", "main")).toBe(note("zeta").main_sha);
    expect(git(origin, "rev-parse", "refs/heads/main")).toBe(note("zeta").main_sha);
    expect(existsSync(pidfile)).toBe(false);
    expect(queueFiles()).toHaveLength(0);
  }, 60_000);

  test("pipeline status reports stopped, empty queue and both outcomes", () => {
    const out = run("pipeline.sh", ["status"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("lander: stopped");
    expect(out.stdout).toContain("queue: 0");
    expect(out.stdout).toContain("landed");
    expect(out.stdout).toContain("bounced");
  }, 60_000);

  test("--done marks the named backlog item, records the note and commits as lander", () => {
    const wt = makeWorktree("done");
    writeFileSync(join(wt, "file.txt"), "done\n");
    commit(wt, "done change");
    const queued = run("land.sh", ["--detach", "--done", "ALPHA-01", "--note", "first item"], wt);
    expect(queued.status).toBe(0);
    expect(queued.stdout).toContain("done: ALPHA-01");
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    const backlog = git(origin, "show", "main:docs/BACKLOG.md");
    expect(backlog).toMatch(/^- \[x\] \*\*ALPHA-01:.* Landed \d{4}-\d{2}-\d{2} \([0-9a-f]{7}\)\.$/m);
    expect(backlog).toContain("- [ ] **BETA-02: second** (S).");
    const landedCommits = git(main, "log", "origin/main", "--format=%s|%an|%ae");
    expect(landedCommits).toContain("Backlog: ALPHA-01 done (landed by the lander)|MaiPai lander|lander@users.noreply.github.com");
    expect(note("done").note).toBe("first item");
    expect(readFileSync(join(data, "notes", "wt-done.md"), "utf8")).toContain("- Note: first item");
  }, 60_000);

  test("unknown --done item bounces without moving main", () => {
    const wt = makeWorktree("unknown_done");
    writeFileSync(join(wt, "file.txt"), "unknown\n");
    commit(wt, "unknown done change");
    const oldMain = git(origin, "rev-parse", "main");
    expect(run("land.sh", ["--detach", "--done", "NOPE-99"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("unknown_done").status).toBe("bounced");
    expect(note("unknown_done").reason).toContain("NOPE-99");
    expect(git(origin, "rev-parse", "main")).toBe(oldMain);
  }, 60_000);

  test("generator changes are committed, unchanged outputs add no commit", () => {
    const generated = makeWorktree("generated");
    writeFileSync(join(generated, "GEN"), "yes\n");
    const sourceSha = commit(generated, "generate output");
    expect(run("land.sh", ["--detach"], generated).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(origin, "log", "main", "--format=%s")).toContain("Generated: docs/api/openapi.json (lander, for wt/generated)");
    expect(git(origin, "show", "main:docs/api/openapi.json")).toBe(sourceSha);

    const generatedCommitCount = git(origin, "log", "main", "--format=%s").split("\n").filter((message) => message.startsWith("Generated:")).length;
    const unchanged = makeWorktree("no_generated");
    unlinkSync(join(unchanged, "GEN"));
    writeFileSync(join(unchanged, "file.txt"), "no generated\n");
    commit(unchanged, "no generated output");
    expect(run("land.sh", ["--detach"], unchanged).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(git(origin, "log", "main", "--format=%s").split("\n").filter((message) => message.startsWith("Generated:")).length).toBe(generatedCommitCount);
  }, 60_000);

  test("serve replaces its code between requests without changing pid and continues landing", async () => {
    expect(run("lander.sh", ["refresh"]).status).toBe(0);
    const serveEnv = { ...env, MAIPAI_LAND_POLL_SECONDS: "1", MAIPAI_PIPELINE_REFRESH_SECONDS: "1" };
    const server = Bun.spawn(["bash", join(main, "scripts", "lander.sh"), "serve"], {
      cwd: main,
      env: serveEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const pidfile = join(data, "lander.pid");
    try {
      const startupDeadline = Date.now() + 10_000;
      while (!existsSync(pidfile) && Date.now() < startupDeadline) await Bun.sleep(25);
      expect(existsSync(pidfile)).toBe(true);
      const pid = readFileSync(pidfile, "utf8").trim();

      pushScriptChange("lander.sh", "live lander replacement");
      const refreshDeadline = Date.now() + 10_000;
      while ((!existsSync(join(data, "lander.log")) || !readFileSync(join(data, "lander.log"), "utf8").includes("code refreshed from origin/main; restarting lander")) && Date.now() < refreshDeadline) await Bun.sleep(50);
      expect(readFileSync(pidfile, "utf8").trim()).toBe(pid);
      expect(readFileSync(join(data, "lander.log"), "utf8")).toContain("code refreshed from origin/main; restarting lander");

      const wt = makeWorktree("after_snapshot_swap");
      writeFileSync(join(wt, "file.txt"), "after swap\n");
      const sha = commit(wt, "landing after snapshot swap");
      expect(run("land.sh", ["--detach"], wt).status).toBe(0);
      const landingDeadline = Date.now() + 15_000;
      while (!existsSync(join(data, "notes", "wt-after_snapshot_swap.json")) && Date.now() < landingDeadline) await Bun.sleep(50);
      expect(note("after_snapshot_swap").status).toBe("landed");
      expect(note("after_snapshot_swap").sha).toBe(sha);

      process.kill(Number(pid), "SIGTERM");
      expect(await server.exited).toBe(0);
      expect(existsSync(pidfile)).toBe(false);
    } finally {
      if (existsSync(pidfile)) process.kill(Number(readFileSync(pidfile, "utf8").trim()), "SIGTERM");
    }
  }, 60_000);
});

function awaitQueueName() {
  return readdirSync(join(data, "queue")).find((f) => f.endsWith(".json")) ?? "missing.json";
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
