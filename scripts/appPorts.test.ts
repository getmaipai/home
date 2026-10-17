import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// PORTS-01: 8787 is the main checkout's hub; a worktree leases an 88xx port;
// bun restart fast-forwards the main checkout first.
const scripts = import.meta.dir;
const scratch = mkdtempSync(join(tmpdir(), "maipai-ports-test-"));
const bare = join(scratch, "origin.git");
const main = join(scratch, "home");
const tree = join(scratch, "wt", "home-ports-x");
const data = join(scratch, "data");
const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
// scripts/wt.sh is a thin wrapper around the shared .github script; the fixture has no sibling checkout.
// Absolute on purpose: a relative common dir is relative to scripts/, so resolving it from the repo root broke this test in the main checkout.
const common = spawnSync("git", ["-C", scripts, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).stdout.trim();
const sharedWt = process.env.MAIPAI_WT_SHARED || join(common, "..", "..", ".github", "standards", "bin", "wt.sh");
const env = { ...process.env, MAIPAI_WT_SHARED: sharedWt, MAIPAI_WT_DATA: data, MAIPAI_HUB_LOCK_PATH: "", MAIPAI_MAIN_CHECKOUT: "", PORT: "" };
delete (env as Record<string, string | undefined>).PORT;
delete (env as Record<string, string | undefined>).MAIPAI_HUB_LOCK_PATH;
delete (env as Record<string, string | undefined>).MAIPAI_MAIN_CHECKOUT;
const app = (cwd: string, args: string[], extra: Record<string, string> = {}) =>
  spawnSync("bash", [join(cwd, "scripts/app.sh"), ...args], {
    cwd, encoding: "utf8", env: { ...env, MAIPAI_HUB_LOCK_PATH: join(cwd, "no-hub.lock"), ...extra },
  });

beforeAll(() => {
  spawnSync("git", ["init", "--bare", "-b", "main", bare]);
  mkdirSync(main, { recursive: true });
  git(scratch, "init", "-b", "main", main);
  git(main, "config", "user.name", "Test User");
  git(main, "config", "user.email", "test@example.invalid");
  mkdirSync(join(main, "scripts"));
  mkdirSync(join(main, "frontend"));
  mkdirSync(join(main, "backend/src"), { recursive: true });
  copyFileSync(join(scripts, "app.sh"), join(main, "scripts/app.sh"));
  copyFileSync(join(scripts, "wt.sh"), join(main, "scripts/wt.sh"));
  writeFileSync(join(main, "frontend/package.json"), JSON.stringify({ scripts: { build: "bun -e 'process.exit(0)'" } }));
  writeFileSync(join(main, "backend/src/index.ts"), `
    import { writeFileSync } from "node:fs";
    writeFileSync(import.meta.dir + "/../../seen-port", String(process.env.PORT ?? ""));
    setInterval(() => {}, 1000);
    console.log("Home URL: http://localhost:" + process.env.PORT);
    console.log("Home server ready.");
  `);
  writeFileSync(join(main, ".gitignore"), "data/\ndata-scratch/\nseen-port\nno-hub.lock\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "initial");
  git(main, "remote", "add", "origin", bare);
  git(main, "push", "-u", "origin", "main");
  mkdirSync(join(scratch, "wt"), { recursive: true });
  git(main, "worktree", "add", "-b", "wt/ports-x", tree, "origin/main");
  mkdirSync(join(tree, "frontend"), { recursive: true });
});

afterAll(() => {
  app(tree, ["stop"]);
  app(main, ["stop"]);
  rmSync(scratch, { recursive: true, force: true });
});

describe("app.sh port ownership", () => {
  test("the shared wt.sh resolves from any checkout, main or worktree", () => {
    expect(existsSync(sharedWt)).toBe(true);
  });

  test("a worktree refuses an explicit 8787 and changes nothing", () => {
    const r = app(tree, ["start"], { PORT: "8787" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Port 8787 belongs to the main checkout");
    expect(r.stderr).toContain("bun start without PORT");
    expect(existsSync(join(tree, "data/local-app/pid"))).toBe(false);
  });

  test("a worktree leases an 88xx port, the hub gets it, and stop releases it", () => {
    const started = app(tree, ["start"]);
    expect(started.status).toBe(0);
    const port = readFileSync(join(tree, "data/local-app/port"), "utf8").trim();
    expect(Number(port)).toBeGreaterThanOrEqual(8800);
    expect(Number(port)).toBeLessThanOrEqual(8899);
    expect(readFileSync(join(tree, "seen-port"), "utf8")).toBe(port);
    const pid = readFileSync(join(tree, "data/local-app/pid"), "utf8").trim();
    expect(readFileSync(join(data, "ports", `${port}.lease`), "utf8").startsWith(`${pid} `)).toBe(true);
    const stopped = app(tree, ["stop"]);
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toContain("Home stopped.");
    expect(existsSync(join(data, "ports", `${port}.lease`))).toBe(false);
    expect(existsSync(join(tree, "data/local-app/port"))).toBe(false);
  });

  test("the main checkout never leases a port and keeps PORT (default 8787)", () => {
    // A free port stands in for 8787 so a real hub on this machine cannot fail the test.
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const free = probe.port;
    probe.stop(true);
    const started = app(main, ["start"], { PORT: String(free) });
    expect(started.status).toBe(0);
    expect(readFileSync(join(main, "seen-port"), "utf8")).toBe(String(free));
    expect(existsSync(join(main, "data/local-app/port"))).toBe(false);
    expect(app(main, ["stop"]).stdout).toContain("Home stopped.");
  });
});

describe("app.sh pull (the first step of bun restart)", () => {
  test("fast-forwards the main checkout", () => {
    const other = join(scratch, "other");
    spawnSync("git", ["clone", bare, other]);
    git(other, "config", "user.name", "Test User");
    git(other, "config", "user.email", "test@example.invalid");
    writeFileSync(join(other, "NEW.md"), "new\n");
    git(other, "add", "NEW.md");
    git(other, "commit", "-m", "upstream change");
    git(other, "push", "origin", "HEAD:main");
    const r = app(main, ["pull"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(main, "NEW.md"))).toBe(true);
  });

  test("aborts with a clear message when history has diverged", () => {
    writeFileSync(join(main, "LOCAL.md"), "local\n");
    git(main, "add", "LOCAL.md");
    git(main, "commit", "-m", "local only");
    const other = join(scratch, "other");
    writeFileSync(join(other, "NEW2.md"), "new2\n");
    git(other, "add", "NEW2.md");
    git(other, "commit", "-m", "upstream again");
    git(other, "push", "origin", "HEAD:main");
    const r = app(main, ["pull"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("could not fast-forward to origin");
    expect(r.stderr).toContain("then run bun restart again");
  });

  test("a worktree skips the pull", () => {
    expect(app(tree, ["pull"]).status).toBe(0);
  });
});
