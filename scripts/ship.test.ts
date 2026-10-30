import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const scratch = mkdtempSync(join(tmpdir(), "maipai-ship-"));
const origin = join(scratch, "origin.git"), main = join(scratch, "main"), live = join(scratch, "live");
const data = join(scratch, "ship-data"), watch = join(scratch, "watch"), shipScript = join(import.meta.dir, "ship.sh");
function git(dir: string, ...args: string[]) { const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }); if (out.status !== 0) throw new Error("git " + args.join(" ") + " failed: " + out.stderr); return out.stdout.trim(); }
let sha = ""; const baseEnv: Record<string, string> = {};
function run(args: string[] = [], env: Record<string, string> = {}) { return spawnSync("bash", [join(main, "scripts", "ship.sh"), ...args], { cwd: main, encoding: "utf8", timeout: 60_000, env: { ...process.env, ...baseEnv, ...env } }); }
beforeAll(() => {
  spawnSync("git", ["init", "--bare", "--initial-branch=main", origin]); spawnSync("git", ["clone", origin, main]);
  git(main, "config", "user.name", "Ship Test"); git(main, "config", "user.email", "ship@example.test");
  mkdirSync(join(main, "scripts"), { recursive: true }); copyFileSync(shipScript, join(main, "scripts", "ship.sh"));
  writeFileSync(join(main, "file.txt"), "fixture\n"); git(main, "add", "."); git(main, "commit", "-m", "fixture main"); git(main, "push", "-u", "origin", "main"); sha = git(main, "rev-parse", "HEAD");
  git(main, "tag", "-a", "v0.0.1", "-m", "v0.0.1", sha); git(main, "push", "origin", "v0.0.1");
  mkdirSync(live, { recursive: true }); writeFileSync(join(live, ".installed-tag"), "v0.0.1\n"); mkdirSync(watch, { recursive: true });
  const promote = join(scratch, "fake-promote");
  writeFileSync(promote, "#!/usr/bin/env bash\nset -e\necho \"$*\" >> '" + join(scratch, "promote.calls") + "'\nif [[ \"$1\" == --check ]]; then echo ok; exit 0; fi\nif [[ -f '" + join(scratch, "promote.fail") + "' ]]; then exit 1; fi\nif [[ \"$1\" == --rollback ]]; then echo v0.0.1 > '" + join(live, ".installed-tag") + "'; rm -f '" + join(scratch, "health.fail") + "'; else echo \"sha-\${1:0:7}\" > '" + join(live, ".installed-tag") + "'; fi\n");
  chmodSync(promote, 0o755);
  writeFileSync(join(scratch, "health-check"), "#!/usr/bin/env bash\n[[ ! -f '" + join(scratch, "health.fail") + "' ]]\n"); chmodSync(join(scratch, "health-check"), 0o755);
  writeFileSync(join(scratch, "publish"), "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" >> '" + join(scratch, "publish.calls") + "'\nwhile (($#)); do if [[ \"$1\" == --notes-file ]]; then echo \"$2\" > '" + join(scratch, "publish.notes.path") + "'; cat \"$2\" > '" + join(scratch, "publish.notes") + "'; shift 2; else shift; fi; done\n"); chmodSync(join(scratch, "publish"), 0o755);
  Object.assign(baseEnv, { MAIPAI_SHIP_GUI_CHECK: "true", MAIPAI_SHIP_DATA: data, MAIPAI_WATCH_DATA: watch, MAIPAI_SHIP_LIVE: live, MAIPAI_PROMOTE_BIN: promote, MAIPAI_SHIP_SUDO: "", MAIPAI_SHIP_STOP_DEV_CMD: "true", MAIPAI_SHIP_HEALTH_CMD: join(scratch, "health-check"), MAIPAI_SHIP_HEALTH_TIMEOUT: "1", MAIPAI_SHIP_MIGRATIONS_CMD: "echo 3", MAIPAI_PUBLISH_CMD: join(scratch, "publish") + " TAG NOTES", MAIPAI_LAND_GIT_ENV: "", MAIPAI_HUB_LOCK_PATH: join(scratch, "not-running.lock"), MAIPAI_SHIP_WEB_PORT: "45991" });
});
describe("ship pipeline", () => {
  // Each test starts from a hub on the previous release, so a test that promotes does not make the next one a no-op "already live".
  beforeEach(() => { writeFileSync(join(live, ".installed-tag"), "v0.0.1\n"); });
  test("status says no deploy is running and reports the live tag and hub", () => {
    const out = run(["status"], { MAIPAI_SHIP_HEALTH_CMD: "true", MAIPAI_SHIP_LOCK: join(scratch, "no-such-lock") });
    expect(out.status).toBe(0); expect(out.stdout).toContain("deploy: none running"); expect(out.stdout).toContain("live tag v0.0.1"); expect(out.stdout).toContain("hub answering: yes");
  }, 60_000);
  test("status reports a ship in progress and a hub that is not answering", () => {
    const sleeper = spawnSync("bash", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).stdout.trim();
    const lock = join(scratch, "status-lock.d"); mkdirSync(lock, { recursive: true }); writeFileSync(join(lock, "pid"), sleeper); writeFileSync(join(lock, "what"), "sha-abc1234 from test pid 1");
    try {
      const out = run(["status"], { MAIPAI_SHIP_HEALTH_CMD: "false", MAIPAI_SHIP_LOCK: lock });
      expect(out.status).toBe(0); expect(out.stdout).toContain("deploy: IN PROGRESS"); expect(out.stdout).toContain("sha-abc1234"); expect(out.stdout).toContain("hub answering: no"); expect(out.stdout).toContain("wait for it");
    } finally { spawnSync("kill", [sleeper]); rmSync(lock, { recursive: true, force: true }); }
  }, 60_000);
  test("refuses on a Mac without the live-hub marker", () => {
    const out = run([sha, "--before-green"], { MAIPAI_SHIP_LIVE: "", MAIPAI_SHIP_MARKER: join(scratch, "no-such-marker") });
    expect(out.status).toBe(1); expect(out.stderr).toContain("not marked as the live hub"); expect(out.stderr).toContain("sudo touch");
  }, 60_000);
  test("uses the durable marker beside the replaceable install directory", () => {
    const marker = `${live}.live-hub`;
    writeFileSync(marker, "");
    try {
      const out = run([sha, "--before-green", "--dry-run"], { MAIPAI_SHIP_MARKER: "" });
      expect(out.status).toBe(0); expect(out.stdout).toContain(`live=${live}`);
    } finally { rmSync(marker, { force: true }); }
  }, 60_000);
  test("rejects side branch commits before calling helper", () => {
    git(main, "checkout", "-b", "side"); writeFileSync(join(main, "side.txt"), "side\n"); git(main, "add", "."); git(main, "commit", "-m", "side"); const side = git(main, "rev-parse", "HEAD"); git(main, "checkout", "main");
    const out = run([side, "--before-green"]); expect(out.status).toBe(1); expect(out.stderr).toContain("not on origin/main"); expect(existsSync(join(scratch, "promote.calls"))).toBe(false);
  }, 60_000);
  test("requires a green marker or records the before-green override", () => {
    const missing = run([sha]); expect(missing.status).toBe(1); expect(missing.stderr).toContain("--before-green");
    mkdirSync(join(watch, "green"), { recursive: true }); writeFileSync(join(watch, "green", sha), "green\n"); const green = run([sha]); if (green.status !== 0) throw new Error(green.stderr + green.stdout); expect(green.status).toBe(0); expect(green.stdout).toContain("shipped:");
    rmSync(join(watch, "green", sha)); const override = run([sha, "--before-green", "--reinstall"]); expect(override.status).toBe(0); expect(readFileSync(join(data, "shipped.jsonl"), "utf8")).toContain('"before_green":true');
  }, 60_000);
  test("success promotes full SHA and records shipped", () => {
    writeFileSync(join(watch, "green", sha), "green\n"); const out = run([sha]); expect(out.status).toBe(0); expect(readFileSync(join(scratch, "promote.calls"), "utf8")).toContain(sha); expect(readFileSync(join(data, "shipped.jsonl"), "utf8")).toContain('"result":"shipped"'); expect(out.stdout).toContain("shipped:");
  }, 60_000);
  test("health failure rolls back", () => {
    writeFileSync(join(watch, "green", sha), "green\n"); writeFileSync(join(scratch, "health.fail"), "bad"); const out = run([sha]); expect(out.status).toBe(1);
    expect(readFileSync(join(scratch, "promote.calls"), "utf8")).toContain(sha + "\n--rollback"); expect(readFileSync(join(data, "shipped.jsonl"), "utf8")).toContain('"result":"rolled_back"'); expect(out.stdout).toContain("rolled back to v0.0.1");
  }, 60_000);
  test("a commit that is already live and answering is not promoted again, unless asked", () => {
    const calls = () => (existsSync(join(scratch, "promote.calls")) ? readFileSync(join(scratch, "promote.calls"), "utf8") : "");
    rmSync(join(scratch, "health.fail"), { force: true });
    writeFileSync(join(live, ".installed-tag"), `sha-${sha.slice(0, 7)}\n`);
    const before = calls();
    const same = run([sha, "--before-green"]);
    expect(same.status).toBe(0); expect(same.stdout).toContain("already live"); expect(calls()).toBe(before);
    const forced = run([sha, "--before-green", "--reinstall"]);
    expect(forced.status).toBe(0); expect(calls().length).toBeGreaterThan(before.length);
  }, 60_000);
  test("the same commit with a hub that is not answering is still installed, as a repair", () => {
    const calls = () => (existsSync(join(scratch, "promote.calls")) ? readFileSync(join(scratch, "promote.calls"), "utf8") : "");
    writeFileSync(join(live, ".installed-tag"), `sha-${sha.slice(0, 7)}\n`); writeFileSync(join(scratch, "health.fail"), "bad");
    const before = calls();
    run([sha, "--before-green"]);
    expect(calls().length).toBeGreaterThan(before.length);
    rmSync(join(scratch, "health.fail"), { force: true });
  }, 60_000);
  test("refuses a stale local next tag and reports how to remove it", () => {
    git(main, "tag", "-a", "v0.0.2", "-m", "v0.0.2", sha);
    const out = run([sha, "--tag"]);
    expect(out.status).toBe(1); expect(out.stderr).toContain("local tag v0.0.2 points at " + sha.slice(0, 7)); expect(out.stderr).toContain('"fixture main"'); expect(out.stderr).toContain("git tag -d v0.0.2"); expect(git(origin, "tag", "--list", "v0.0.2")).toBe("");
    git(main, "tag", "-d", "v0.0.2");
  }, 60_000);
  test("tag publishes next patch and refuses an existing next tag", () => {
    writeFileSync(join(watch, "green", sha), "green\n"); const out = run([sha, "--tag"]); expect(out.status).toBe(0); expect(git(origin, "rev-parse", "refs/tags/v0.0.2^{}")).toBe(sha); expect(readFileSync(join(scratch, "publish.calls"), "utf8")).toContain("v0.0.2"); expect(out.stdout).toContain("tagged v0.0.2");
    const next = run([sha, "--tag"]); expect(next.status).toBe(0); expect(git(origin, "rev-parse", "refs/tags/v0.0.3^{}")).toBe(sha);
  }, 60_000);
  test("tag writes notes from landed commits when CHANGELOG has no release section", () => {
    git(main, "checkout", "main");
    writeFileSync(join(main, "first.txt"), "first\n"); git(main, "add", "first.txt"); git(main, "commit", "-m", "first landed change");
    writeFileSync(join(main, "second.txt"), "second\n"); git(main, "add", "second.txt"); git(main, "commit", "-m", "second landed change");
    const target = git(main, "rev-parse", "HEAD"); git(main, "push", "origin", "main");
    writeFileSync(join(watch, "green", target), "green\n");
    const out = run([target, "--tag"]);
    expect(out.status).toBe(0); expect(out.stdout).toContain("notes: 2 landed commits");
    const args = readFileSync(join(scratch, "publish.calls"), "utf8"); expect(args).toContain("--notes-file"); expect(args).toContain("v0.0.4");
    const notes = readFileSync(join(scratch, "publish.notes"), "utf8").trim().split("\n");
    expect(notes[0]).toContain("Release v0.0.4, cut from commit " + target.slice(0, 7) + " live on the hub on ");
    expect(notes.slice(1)).toEqual(["- first landed change", "- second landed change"]);
  }, 60_000);
  test("dry run prints plan and never promotes", () => {
    const calls = join(scratch, "promote.calls"); rmSync(calls, { force: true }); const out = run([sha, "--before-green", "--dry-run"]); expect(out.status).toBe(0); expect(out.stdout).toContain("sha=" + sha); expect(out.stdout).toContain("before-green=yes"); expect(existsSync(calls)).toBe(false);
  }, 60_000);
  test("refuses other live data, allows explicit adoption, reports the finding in dry run, and keeps the clean case", () => {
    const otherData = join(scratch, "other-data"); mkdirSync(otherData, { recursive: true });
    writeFileSync(join(otherData, "hub.db"), "fixture");
    const lockPath = join(scratch, "hub.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 99999999, port: 3000, dataDir: otherData }));
    const injected = { MAIPAI_HUB_LOCK_PATH: lockPath, MAIPAI_SHIP_TEST_PID_ALIVE: "1", MAIPAI_SHIP_TEST_WEB_LISTENER: "1" };
    const refused = run([sha, "--before-green"], injected);
    expect(refused.status).toBe(1); expect(refused.stderr).toContain("empty Home"); expect(refused.stderr).toContain(otherData); expect(refused.stderr).toContain("Migrate the data");
    const dry = run([sha, "--before-green", "--dry-run"], injected);
    expect(dry.status).toBe(1); expect(dry.stderr).toContain("empty Home");
    const adopted = run([sha, "--before-green", "--adopt-empty-live"], injected);
    expect(adopted.status).toBe(0);
    const clean = run([sha, "--before-green", "--reinstall"], { MAIPAI_HUB_LOCK_PATH: join(scratch, "missing.lock") });
    expect(clean.status).toBe(0); expect(clean.stdout).toContain("shipped:");
  }, 60_000);
  test("preflight names one-time setup when helper is missing", () => {
    const out = run([sha, "--before-green"], { MAIPAI_PROMOTE_BIN: join(scratch, "missing-helper") }); expect(out.status).toBe(2); expect(out.stderr).toContain("install-promote.sh");
  }, 60_000);
  test("refuses before stopping anything when the session has no desktop login", () => {
    const out = run([sha, "--before-green"], { MAIPAI_SHIP_GUI_CHECK: "false" });
    expect(out.status).toBe(1); expect(out.stderr).toContain("no desktop login"); expect(out.stderr).toContain("Nothing was stopped");
  }, 60_000);
  describe("one ship at a time", () => {
    const lockDir = () => join(data, "ship.lock.d");
    const calls = () => (existsSync(join(scratch, "promote.calls")) ? readFileSync(join(scratch, "promote.calls"), "utf8") : "");
    beforeEach(() => { rmSync(lockDir(), { recursive: true, force: true }); rmSync(join(scratch, "health.fail"), { force: true }); });
    test("a ship started while another holds the lock refuses after the wait, and installs nothing", () => {
      mkdirSync(lockDir(), { recursive: true }); writeFileSync(join(lockDir(), "pid"), String(process.pid)); writeFileSync(join(lockDir(), "what"), "sha-other from test");
      const before = calls(), out = run([sha, "--before-green", "--reinstall"], { MAIPAI_SHIP_LOCK_WAIT: "2" });
      expect(out.status).toBe(1); expect(out.stderr).toContain("another ship (sha-other from test) is still running"); expect(calls()).toBe(before); expect(existsSync(lockDir())).toBe(true);
    }, 60_000);
    test("a lock whose ship is gone is cleared and the ship goes ahead, then the lock is released", () => {
      mkdirSync(lockDir(), { recursive: true }); writeFileSync(join(lockDir(), "pid"), "99999999");
      const out = run([sha, "--before-green", "--reinstall"]);
      expect(out.status).toBe(0); expect(out.stderr).toContain("clearing its lock"); expect(out.stdout).toContain("shipped:"); expect(existsSync(lockDir())).toBe(false);
    }, 60_000);
    test("a live that already includes this commit needs no install", () => {
      writeFileSync(join(main, "later.txt"), "later\n"); git(main, "add", "."); git(main, "commit", "-m", "later commit"); git(main, "push", "origin", "main"); const later = git(main, "rev-parse", "HEAD");
      writeFileSync(join(live, ".installed-tag"), `sha-${later.slice(0, 7)}\n`);
      const before = calls(), out = run([sha, "--before-green"]);
      expect(out.status).toBe(0); expect(out.stdout).toContain("already runs"); expect(out.stdout).toContain("includes"); expect(calls()).toBe(before); expect(existsSync(lockDir())).toBe(false);
    }, 60_000);
    test("running engine jobs are waited for, then the install goes ahead and says what it interrupted", () => {
      const busy = join(scratch, "busy-cmd"); writeFileSync(busy, "#!/usr/bin/env bash\necho 2\n"); chmodSync(busy, 0o755);
      const out = run([sha, "--before-green", "--reinstall"], { MAIPAI_SHIP_BUSY_CMD: busy, MAIPAI_SHIP_QUIET_WAIT: "5" });
      expect(out.status).toBe(0); expect(out.stderr).toContain("waiting for 2 running engine job(s)"); expect(out.stderr).toContain("installing anyway"); expect(out.stdout).toContain("shipped:");
    }, 60_000);
  });
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
