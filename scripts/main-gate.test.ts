import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve(import.meta.dir, "main-gate.sh");
let fixtureScript: string;
let sandbox: string;
let repo: string;
let origin: string;
let wt: string;
let base: string;

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function git(args: string[], cwd = repo) {
  const result = run("git", args, cwd);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function commit(name: string) {
  writeFileSync(join(repo, "payload.txt"), name + "\n");
  git(["add", "payload.txt"]);
  git(["-c", "user.name=Test Author", "-c", "user.email=test@example.com", "commit", "-m", name]);
  git(["push", "origin", "main"]);
  return git(["rev-parse", "HEAD"]);
}

function invoke(gate: string, mode = "once", env: Record<string, string> = {}) {
  return run("bash", [fixtureScript, mode], repo, {
    ...env,
    MAIPAI_MAIN_GATE_CMD: gate,
    MAIPAI_MAIN_GATE_ROOT: repo,
    MAIPAI_MAIN_GATE_WT: wt,
    MAIPAI_WT_SESSION: "gentle-tiger-maingate",
    MAIPAI_MAIN_GATE_SKIP_INSTALL: "1",
    MAIPAI_STANDARDS_DIR: join(sandbox, "standards"),
    MAIPAI_COMMONS_DIR: join(sandbox, "commons"),
  });
}

function readNote(path: string, result: ReturnType<typeof invoke>) {
  try { return readFileSync(path, "utf8"); }
  catch (error) { throw new Error(`${String(error)}\nls: ${require("node:fs").readdirSync(require("node:path").dirname(path)).join(",")}\nexists: ${existsSync(path)}\nrunner stdout:\n${result.stdout}\nrunner stderr:\n${result.stderr}`); }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "main-gate-test-"));
  repo = join(sandbox, "home");
  fixtureScript = join(repo, "scripts", "main-gate.sh");
  origin = join(sandbox, "origin.git");
  wt = join(sandbox, "home-main-gate");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, "scripts"), { recursive: true });
  copyFileSync(script, fixtureScript);
  run("git", ["init", "--bare", "--initial-branch=main", origin], sandbox);
  run("git", ["init", "--initial-branch=main"], repo);
  git(["config", "user.name", "Test Author"]);
  git(["config", "user.email", "test@example.com"]);
  writeFileSync(join(repo, "payload.txt"), "base\n");
  writeFileSync(fixtureScript, readFileSync(script));
  git(["add", "payload.txt", "scripts/main-gate.sh"]);
  git(["commit", "-m", "base"]);
  git(["remote", "add", "origin", origin]);
  git(["push", "-u", "origin", "main"]);
  base = git(["rev-parse", "HEAD"]);
  mkdirSync(join(repo, "data-scratch", "main-gate"), { recursive: true });
  mkdirSync(join(repo, "data-scratch", "gate-stats"), { recursive: true });
  writeFileSync(join(repo, "data-scratch", "main-gate", "last-green"), `${base}\n`);
  mkdirSync(join(sandbox, "standards", "standards", "bin"), { recursive: true });
  writeFileSync(join(sandbox, "standards", "standards", "bin", "gate-lock.sh"), "#!/usr/bin/env bash\n");
  mkdirSync(join(sandbox, "commons"), { recursive: true });
});

afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

describe("main-gate", () => {
  test("green updates last-green and appends stats", () => {
    const sha = commit("green landing");
    const result = invoke("exit 0");
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(readFileSync(join(repo, "data-scratch", "main-gate", "last-green"), "utf8").trim()).toBe(sha);
    const rows = readFileSync(join(repo, "data-scratch", "gate-stats", "main-gate.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(rows.at(-1)!)).toMatchObject({ sha, result: "green" });
  });

  // GATE-FAST-01 (2026-10-16): a red never reverts, even a single commit; the note names it and a person decides.
  test("red with one commit writes the note and leaves origin/main alone", () => {
    const sha = commit("bad landing");
    const result = invoke("echo '== backend: bun test'; echo 'failure details'; exit 1");
    expect(result.status, result.stderr + result.stdout).toBe(1);
    expect(result.stderr + result.stdout).toContain("wrote failure note");
    expect(result.stderr + result.stdout).toContain("no automatic revert");
    expect(git(["rev-parse", "origin/main"], wt)).toBe(sha);
    expect(git(["show", "-s", "--format=%s", "origin/main"], wt)).not.toContain("Revert");
    const note = readNote(join(repo, "data-scratch", "main-gate", `${sha}.md`), result);
    expect(note).toContain("Failing stage: backend: bun test");
    expect(note).toContain("bad landing");
  });

  test("red with two commits does not revert and writes note", () => {
    const first = commit("first bad landing");
    const sha = commit("second bad landing");
    expect(first).not.toBe(sha);
    const result = invoke("echo '== scripts: bun test'; echo 'failure details'; exit 1");
    expect(result.status, result.stderr + result.stdout).toBe(1);
    expect(git(["rev-parse", "origin/main"], wt)).toBe(sha);
    const note = readNote(join(repo, "data-scratch", "main-gate", `${sha}.md`), result);
    expect(note).toContain("first bad landing");
    expect(note).toContain("second bad landing");
  });

  test("a missing-tool crash is named as the probable cause in the note", () => {
    const first = commit("first landing");
    const sha = commit("second landing");
    expect(first).not.toBe(sha);
    const result = invoke("echo '== scripts: bun test'; echo 'error: Executable not found in $PATH: \"sysctl\"'; echo '== frontend: ui rules'; exit 1");
    expect(result.status, result.stderr + result.stdout).toBe(1);
    const note = readNote(join(repo, "data-scratch", "main-gate", `${sha}.md`), result);
    expect(note).toContain('Probable cause: error: Executable not found in $PATH: "sysctl"');
  });

  test("a note without a known crash line has no probable cause", () => {
    commit("first landing");
    const sha = commit("second landing");
    const result = invoke("echo '== backend: bun test'; echo 'failure details'; exit 1");
    const note = readNote(join(repo, "data-scratch", "main-gate", `${sha}.md`), result);
    expect(note).not.toContain("Probable cause");
  });

  test("frontend a11y retry runs the root package script", () => {
    commit("a11y landing");
    const command = `mkdir -p frontend; printf '%s\\n' '{"scripts":{"a11y":"echo root-a11y-ran"}}' > package.json; printf '%s\\n' '{"scripts":{}}' > frontend/package.json; echo '== frontend: a11y'; echo 'a11y failure'; exit 1`;
    const result = invoke(command);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stderr + result.stdout).toContain("root-a11y-ran");
  });

  // RELEASE-GATE-01: the idle run after a landing never makes a session wait for the gate lock.
  function fakeLock(script: string) {
    writeFileSync(join(sandbox, "standards", "standards", "bin", "gate-lock.sh"), `#!/usr/bin/env bash\n${script}\n`);
  }

  test("idle runs the gate when the lock is free", () => {
    fakeLock('[ "$1" = status ] && echo free');
    const sha = commit("idle landing");
    const result = invoke("exit 0", "idle", { MAIPAI_MAIN_GATE_POLL_SECONDS: "1" });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(readFileSync(join(repo, "data-scratch", "main-gate", "last-green"), "utf8").trim()).toBe(sha);
  });

  test("idle appends the gate's own stats record when the run finishes", () => {
    fakeLock('[ "$1" = status ] && echo free');
    commit("idle landing");
    const result = invoke('echo "{\\"exit\\":0}" >> "$MAIPAI_GATE_STATS_OUTPUT"; exit 0', "idle", { MAIPAI_MAIN_GATE_POLL_SECONDS: "1" });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(readFileSync(join(repo, "data-scratch", "gate-stats", "runs.jsonl"), "utf8").trim()).toBe('{"exit":0}');
  });

  test("a second idle call while one runs asks it to go again instead of starting another", () => {
    fakeLock('[ "$1" = status ] && echo free');
    mkdirSync(join(repo, "data-scratch", "main-gate", "idle.run"), { recursive: true });
    writeFileSync(join(repo, "data-scratch", "main-gate", "idle.run", "pid"), `${process.pid}\n`);
    commit("idle landing");
    const result = invoke("echo should-not-run; exit 1", "idle");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already going");
    expect(existsSync(join(repo, "data-scratch", "main-gate", "idle.again"))).toBe(true);
  });

  test("idle skips when another gate holds the lock", () => {
    fakeLock('[ "$1" = status ] && echo "held: home-1\t\t1\tnow"');
    commit("idle landing");
    const result = invoke("echo should-not-run; exit 1", "idle");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gate lock is busy");
    expect(readFileSync(join(repo, "data-scratch", "main-gate", "last-green"), "utf8").trim()).toBe(base);
  });

  test("idle yields when a session queues for the lock mid-run", () => {
    const calls = join(sandbox, "lock-calls");
    // The queue line comes first and a long tail follows, so a reader that stops at the match would make the writer hit SIGPIPE.
    fakeLock(`[ "$1" = status ] || exit 0; echo x >> ${calls}; echo free; [ "$(wc -l < ${calls})" -gt 1 ] && { echo queue:; for i in $(seq 1 20000); do echo "  home-$i"; done; }; exit 0`);
    commit("idle landing");
    const started = Date.now();
    const result = invoke("sleep 20; exit 0", "idle", { MAIPAI_MAIN_GATE_POLL_SECONDS: "1" });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("yielded");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(readFileSync(join(repo, "data-scratch", "main-gate", "last-green"), "utf8").trim()).toBe(base);
    expect(existsSync(join(repo, "data-scratch", "main-gate", "idle.run"))).toBe(false);
    expect(existsSync(join(repo, "data-scratch", "gate-stats", "runs.jsonl"))).toBe(false);
  });

  test("unchanged tip is a no-op", () => {
    const result = invoke("echo should-not-run >&2; exit 1");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("unchanged since last green");
    expect(readFileSync(join(repo, "data-scratch", "main-gate", "last-green"), "utf8").trim()).toBe(base);
  });
});
