import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  writeFileSync(join(scratch, "publish"), "#!/usr/bin/env bash\necho \"$1\" >> '" + join(scratch, "publish.calls") + "'\n"); chmodSync(join(scratch, "publish"), 0o755);
  Object.assign(baseEnv, { MAIPAI_SHIP_DATA: data, MAIPAI_WATCH_DATA: watch, MAIPAI_SHIP_LIVE: live, MAIPAI_PROMOTE_BIN: promote, MAIPAI_SHIP_SUDO: "", MAIPAI_SHIP_STOP_DEV_CMD: "true", MAIPAI_SHIP_HEALTH_CMD: join(scratch, "health-check"), MAIPAI_SHIP_HEALTH_TIMEOUT: "1", MAIPAI_SHIP_MIGRATIONS_CMD: "echo 3", MAIPAI_PUBLISH_CMD: join(scratch, "publish") + " TAG", MAIPAI_LAND_GIT_ENV: "" });
});
describe("ship pipeline", () => {
  test("rejects side branch commits before calling helper", () => {
    git(main, "checkout", "-b", "side"); writeFileSync(join(main, "side.txt"), "side\n"); git(main, "add", "."); git(main, "commit", "-m", "side"); const side = git(main, "rev-parse", "HEAD"); git(main, "checkout", "main");
    const out = run([side, "--before-green"]); expect(out.status).toBe(1); expect(out.stderr).toContain("not on origin/main"); expect(existsSync(join(scratch, "promote.calls"))).toBe(false);
  }, 60_000);
  test("requires a green marker or records the before-green override", () => {
    const missing = run([sha]); expect(missing.status).toBe(1); expect(missing.stderr).toContain("--before-green");
    mkdirSync(join(watch, "green"), { recursive: true }); writeFileSync(join(watch, "green", sha), "green\n"); const green = run([sha]); expect(green.status).toBe(0); expect(green.stdout).toContain("shipped:");
    rmSync(join(watch, "green", sha)); const override = run([sha, "--before-green"]); expect(override.status).toBe(0); expect(readFileSync(join(data, "shipped.jsonl"), "utf8")).toContain('"before_green":true');
  }, 60_000);
  test("success promotes full SHA and records shipped", () => {
    writeFileSync(join(watch, "green", sha), "green\n"); const out = run([sha]); expect(out.status).toBe(0); expect(readFileSync(join(scratch, "promote.calls"), "utf8")).toContain(sha); expect(readFileSync(join(data, "shipped.jsonl"), "utf8")).toContain('"result":"shipped"'); expect(out.stdout).toContain("shipped:");
  }, 60_000);
  test("health failure rolls back", () => {
    writeFileSync(join(watch, "green", sha), "green\n"); writeFileSync(join(scratch, "health.fail"), "bad"); const out = run([sha]); expect(out.status).toBe(1);
    expect(readFileSync(join(scratch, "promote.calls"), "utf8")).toContain(sha + "\n--rollback"); expect(readFileSync(join(data, "shipped.jsonl"), "utf8")).toContain('"result":"rolled_back"'); expect(out.stdout).toContain("rolled back to v0.0.1");
  }, 60_000);
  test("tag publishes next patch and refuses an existing next tag", () => {
    writeFileSync(join(watch, "green", sha), "green\n"); const out = run([sha, "--tag"]); expect(out.status).toBe(0); expect(git(origin, "rev-parse", "refs/tags/v0.0.2^{}")).toBe(sha); expect(readFileSync(join(scratch, "publish.calls"), "utf8")).toContain("v0.0.2"); expect(out.stdout).toContain("tagged v0.0.2");
    const next = run([sha, "--tag"]); expect(next.status).toBe(0); expect(git(origin, "rev-parse", "refs/tags/v0.0.3^{}")).toBe(sha);
  }, 60_000);
  test("dry run prints plan and never promotes", () => {
    const calls = join(scratch, "promote.calls"); rmSync(calls, { force: true }); const out = run([sha, "--before-green", "--dry-run"]); expect(out.status).toBe(0); expect(out.stdout).toContain("sha=" + sha); expect(out.stdout).toContain("before-green=yes"); expect(existsSync(calls)).toBe(false);
  }, 60_000);
  test("preflight names one-time setup when helper is missing", () => {
    const out = run([sha, "--before-green"], { MAIPAI_PROMOTE_BIN: join(scratch, "missing-helper") }); expect(out.status).toBe(2); expect(out.stderr).toContain("install-promote.sh");
  }, 60_000);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
