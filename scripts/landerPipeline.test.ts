import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, main, data, watchData, pipelineBin, warm, env, git, run, makeWorktree, commit, pushScriptChange, note, queueFiles, setup, cleanup, awaitQueueName } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);

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

  test("newest duplicate request supersedes older request", () => {
    const wt = makeWorktree("dupe");
    writeFileSync(join(wt, "file.txt"), "newest request\n");
    const sha = commit(wt, "duplicate newest");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    const newestFile = join(data, "queue", "9999999999-wt-dupe.json");
    const priorFile = join(data, "queue", "0000000001-wt-dupe.json");
    const request = JSON.parse(readFileSync(join(data, "queue", awaitQueueName()), "utf8"));
    writeFileSync(priorFile, JSON.stringify({ ...request, sha: "0".repeat(40) }));
    writeFileSync(newestFile, JSON.stringify(request));
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("dupe").sha).toBe(sha);
    expect(note("dupe").status).toBe("landed");
    expect(queueFiles()).toHaveLength(0);
    expect(readFileSync(join(data, "lander.log"), "utf8")).toContain("superseded request 0000000001-wt-dupe.json by 9999999999-wt-dupe.json");
  }, 60_000);

  test("already-main request lands instead of bouncing", () => {
    const wt = makeWorktree("already_main");
    writeFileSync(join(wt, "file.txt"), "already main\n");
    const sha = commit(wt, "already-main change");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    git(origin, "push", origin, `${sha}:refs/heads/main`);
    git(main, "fetch", "origin");
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("already_main").status).toBe("landed");
    expect(note("already_main").reason).toBe("already on origin/main");
    expect(queueFiles()).toHaveLength(0);
  }, 60_000);

  test("static check bounce names the failed stage", () => {
    const wt = makeWorktree("stage_failure");
    writeFileSync(join(wt, "file.txt"), "stage failure\n");
    commit(wt, "stage failure change");
    env.MAIPAI_LAND_CHECK_CMD = "echo '== pre: frontend typecheck'; exit 1";
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    expect(run("lander.sh", ["run-once"]).status).toBe(0);
    expect(note("stage_failure").reason).toBe("static check failed at pre: frontend typecheck");
    env.MAIPAI_LAND_CHECK_CMD = "bash scripts/check.sh --pre";
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
    const child = Bun.spawn(["bash", join(main, "scripts", "land.sh"), "--queue-anyway"], { cwd: wt, env, stdout: "pipe", stderr: "pipe" });
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

  test("pipeline status prints queue fields and stalled main run", () => {
    const wt = makeWorktree("status_queue");
    writeFileSync(join(wt, "file.txt"), "queued\n");
    const sha = commit(wt, "status queue");
    expect(run("land.sh", ["--detach"], wt).status).toBe(0);
    const requested = queueFiles()[0];
    const requestPath = join(data, "queue", requested!);
    const request = JSON.parse(readFileSync(requestPath, "utf8"));
    request.requested_at = new Date().toISOString();
    writeFileSync(requestPath, JSON.stringify(request));
    const lastRun = git(main, "rev-parse", "origin/main");
    mkdirSync(watchData, { recursive: true });
    writeFileSync(join(watchData, "last-run"), `${lastRun}\n`);
    writeFileSync(join(watchData, "runs.jsonl"), `${JSON.stringify({ sha: lastRun, result: "stalled", failing: [] })}\n`);
    const out = run("pipeline.sh", ["status"]);
    expect(out.stdout).toContain(`  wt/status_queue ${sha.slice(0, 7)} `);
    expect(out.stdout).toContain(`main: stalled at ${lastRun.slice(0, 7)}: a test leg timed out`);
    for (const file of queueFiles()) rmSync(join(data, "queue", file), { force: true });
  }, 60_000);
});

afterAll(cleanup);
