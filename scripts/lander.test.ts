import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "maipai-lander-"));
const origin = join(scratch, "origin.git");
const main = join(scratch, "main");
const data = join(scratch, "land-data");
const warm = join(scratch, "warm-checkout");
const scriptNames = ["land.sh", "lander.sh", "pipeline.sh"];
const env = {
  ...process.env,
  MAIPAI_LAND_DATA: data,
  MAIPAI_LAND_CHECKOUT: warm,
  MAIPAI_LAND_SKIP_INSTALL: "1",
  MAIPAI_LAND_GIT_ENV: "",
  MAIPAI_LAND_CHECK_CMD: "bash scripts/check.sh --pre",
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
function note(name: string): { branch: string; sha: string; status: string; reason: string; main_sha: string; check_tail: string } {
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
  mkdirSync(join(main, "data-scratch"), { recursive: true });
  writeFileSync(join(main, "file.txt"), "line one\nline two\nline three\n");
  git(main, "add", "-A");
  git(main, "commit", "-m", "fixture base");
  git(main, "push", "-u", "origin", "main");
});

describe("lander pipeline", () => {
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
    expect(processed.status).toBe(0, `${processed.stdout}\n${processed.stderr}`);
    expect(existsSync(join(data, "notes", "wt-alpha.json"))).toBe(true, `${processed.stdout}\n${processed.stderr}`);
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
    expect(queued.status).toBe(0, `${queued.stdout}\n${queued.stderr}`);
    const requestDeadline = Date.now() + 10_000;
    while ((queueFiles().length === 0 || Date.now() < requestDeadline - 9_000) && Date.now() < requestDeadline) await Bun.sleep(25);
    await Bun.sleep(1_050);
    expect(queueFiles()).toHaveLength(1);
    process.kill(Number(readFileSync(pidfile, "utf8").trim()), "SIGTERM");
    const exitCode = await server.exited;
    const stdout = await new Response(server.stdout).text();
    const stderr = await new Response(server.stderr).text();
    if (exitCode !== 0) console.error(`serve exited ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    expect(exitCode).toBe(0, `${stdout}\n${stderr}`);
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
});

function awaitQueueName() {
  return readdirSync(join(data, "queue")).find((f) => f.endsWith(".json")) ?? "missing.json";
}

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
