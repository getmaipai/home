import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// MODE-01: one switch (scripts/mode.sh, state in one file), read by land.sh, lander.sh, ship.sh, rush-ship.sh, dev.sh and pipeline.sh status.
const here = import.meta.dir;
const scratch = mkdtempSync(join(tmpdir(), "maipai-mode-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const sh = (args: string[], env: Record<string, string> = {}, cwd?: string) =>
  spawnSync("bash", args, { cwd, encoding: "utf8", env: { ...process.env, MAIPAI_MODE: "", MAIPAI_MODE_FILE: "", ...env } });
const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.test", ...a], { encoding: "utf8" });

describe("scripts/mode.sh", () => {
  const file = join(scratch, "state", "mode");
  const run = (...a: string[]) => sh([join(here, "mode.sh"), ...a], { MAIPAI_MODE_FILE: file });
  test("unset by default: says the pipeline is as before", () => {
    const r = run("status");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("mode: not set");
  });
  test("direct and gated print their one-line meaning and persist in one file", () => {
    expect(run("direct").stdout.trim()).toBe("DIRECT: run first, checked after");
    expect(readFileSync(file, "utf8").trim()).toBe("direct");
    expect(run("status").stdout.trim()).toBe("DIRECT: run first, checked after");
    expect(run("gated").stdout.trim()).toBe("GATED: checked first, then run");
    expect(run("status").stdout.trim()).toBe("GATED: checked first, then run");
  });
  test("an unknown word fails and changes nothing", () => {
    const r = run("fast");
    expect(r.status).toBe(2);
    expect(readFileSync(file, "utf8").trim()).toBe("gated");
  });
  test("a garbled state file reads as unset, not as a mode", () => {
    writeFileSync(file, "banana\n");
    expect(run("status").stdout).toContain("mode: not set");
  });
});

describe("script wiring", () => {
  test("land.sh refuses --express in gated mode before it touches git", () => {
    const r = sh([join(here, "land.sh"), "--express"], { MAIPAI_MODE: "gated" }, scratch);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GATED: checked first, then run");
  });
  test("land.sh in unset mode is unchanged (--express still accepted past the mode check)", () => {
    const r = sh([join(here, "land.sh"), "--express"], {}, scratch);
    expect(r.stderr).not.toContain("GATED");
  });
  test("rush-ship.sh refuses in gated mode and names the way out", () => {
    const r = sh([join(here, "rush-ship.sh"), "--owner-asked"], { MAIPAI_MODE: "gated" }, scratch);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("A rush ship is off in gated mode");
  });
  test("rush-ship.sh in direct mode gets past the mode check", () => {
    const r = sh([join(here, "rush-ship.sh"), "--owner-asked"], { MAIPAI_MODE: "direct" }, scratch);
    expect(r.stderr).not.toContain("gated mode");
  });
  test("lander.sh reads the mode through one helper, skips T2 tests only in direct mode", () => {
    const src = readFileSync(join(here, "lander.sh"), "utf8");
    expect(src).toContain('safety_files" && "$(lander_mode)" == direct');
    const fn = src.slice(src.indexOf("lander_mode() {"), src.indexOf("\n}\n", src.indexOf("lander_mode() {")) + 2);
    const driver = join(scratch, "lm.sh");
    const modeLib = join(here, "lib", "mode.sh");
    const mainDir = join(scratch, "lm-main");
    mkdirSync(join(mainDir, "scripts", "lib"), { recursive: true });
    mkdirSync(join(mainDir, "data-scratch"), { recursive: true });
    copyFileSync(modeLib, join(mainDir, "scripts", "lib", "mode.sh"));
    writeFileSync(driver, `main='${mainDir}'\ncheckout='${scratch}/none'\n${fn}\nlander_mode\n`);
    const mode = () => sh([driver], {}).stdout.trim();
    expect(mode()).toBe("unset");
    writeFileSync(join(mainDir, "data-scratch", "mode"), "direct\n");
    expect(mode()).toBe("direct");
    writeFileSync(join(mainDir, "data-scratch", "mode"), "gated\n");
    expect(mode()).toBe("gated");
  });
  test("dev.sh refuses the workbench in gated mode, allows it in direct", () => {
    const root = join(scratch, "devroot");
    mkdirSync(join(root, "scripts", "lib"), { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });
    copyFileSync(join(here, "dev.sh"), join(root, "scripts", "dev.sh"));
    copyFileSync(join(here, "lib", "mode.sh"), join(root, "scripts", "lib", "mode.sh"));
    const run = (mode: string) => sh([join(root, "scripts", "dev.sh"), "start", "--workbench", "--port", "3000"], { MAIPAI_MODE: mode, MAIPAI_DEV_ROOT: root });
    const gated = run("gated");
    expect(gated.status).toBe(2);
    expect(gated.stderr).toContain("workbench hub is off in gated mode");
    expect(run("direct").stderr).not.toContain("gated mode");
  });
});

describe("ship.sh by mode", () => {
  // A throwaway origin and clone with the real scripts; the sha is on origin/main; nothing reaches a live hub (dry run, stopped before install).
  const origin = join(scratch, "origin.git");
  const clone = join(scratch, "clone");
  function setup() {
    if (existsSync(clone)) return;
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    spawnSync("git", ["clone", "-q", origin, clone]);
    mkdirSync(join(clone, "scripts", "lib"), { recursive: true });
    for (const f of ["ship.sh"]) copyFileSync(join(here, f), join(clone, "scripts", f));
    for (const f of ["mode.sh", "gitnet.sh"]) copyFileSync(join(here, "lib", f), join(clone, "scripts", "lib", f));
    writeFileSync(join(clone, "scripts", "wt.sh"), 'export WT_T2_GLOBS="docs/design/RULES.md backend/src/lib/safety*.ts"\n');
    git(clone, "checkout", "-q", "-b", "main");
    git(clone, "add", "-A"); git(clone, "commit", "-qm", "base"); git(clone, "push", "-q", "origin", "main");
  }
  const ship = (env: Record<string, string>, ...args: string[]) =>
    sh([join(clone, "scripts", "ship.sh"), ...args], { MAIPAI_MEMORY_GATE: "off", MAIPAI_SKIP_BOOT_CHECK: "1", MAIPAI_LAND_GIT_ENV: "", MAIPAI_WATCH_DATA: join(scratch, "watch"), MAIPAI_SHIP_DATA: join(scratch, "ship"), ...env }, clone);
  test("gated refuses --before-green", () => {
    setup();
    const r = ship({ MAIPAI_MODE: "gated" }, "main", "--before-green", "--dry-run");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--before-green is off in gated mode");
  });
  test("gated refuses a commit with no watcher green run and no stable, and says in plain words what is missing", () => {
    setup();
    const r = ship({ MAIPAI_MODE: "gated" }, "main", "--dry-run");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("cannot ship yet: it has no watcher green run and stable does not exist yet (the nightly run has never passed on any commit)");
    expect(r.stderr).toContain("bash scripts/nightly.sh run-now");
    expect(r.stderr).toContain("the watcher is stopped");
  });
  test("gated names a stable that is older than the tip, with the distance", () => {
    setup();
    git(clone, "branch", "-f", "stable", "HEAD");
    writeFileSync(join(clone, "plain.txt"), "plain\n");
    git(clone, "add", "-A"); git(clone, "commit", "-qm", "plain change"); git(clone, "push", "-q", "origin", "main");
    const sha = git(clone, "rev-parse", "HEAD").stdout.trim();
    const stable = git(clone, "rev-parse", "stable").stdout.trim();
    const r = ship({ MAIPAI_MODE: "gated" }, sha, "--dry-run");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`stable is at ${stable.slice(0, 7)}, 1 commits behind ${sha.slice(0, 7)}`);
    git(clone, "branch", "-D", "stable");
    git(clone, "reset", "-q", "--hard", "HEAD~1"); git(clone, "push", "-q", "-f", "origin", "main");
  });
  test("gated with no stable yet: a watcher green run ships a plain change but holds a safety-surface change since the live commit", () => {
    setup();
    const base = git(clone, "rev-parse", "HEAD").stdout.trim();
    const live = join(scratch, "live-nostable"); mkdirSync(live, { recursive: true });
    writeFileSync(join(live, ".installed-tag"), `sha-${base.slice(0, 7)}\n`);
    mkdirSync(join(scratch, "watch", "green"), { recursive: true });
    writeFileSync(join(clone, "plain2.txt"), "plain\n");
    git(clone, "add", "-A"); git(clone, "commit", "-qm", "plain change"); git(clone, "push", "-q", "origin", "main");
    const plain = git(clone, "rev-parse", "HEAD").stdout.trim();
    writeFileSync(join(scratch, "watch", "green", plain), "");
    const through = ship({ MAIPAI_MODE: "gated", MAIPAI_SHIP_LIVE: live }, plain, "--dry-run");
    expect(through.stderr).not.toContain("changes a safety surface");
    expect(through.stdout).toContain("no safety-surface change since the live hub (sha-" + base.slice(0, 7) + ")");
    mkdirSync(join(clone, "backend", "src", "lib"), { recursive: true });
    writeFileSync(join(clone, "backend", "src", "lib", "safetyNoStable.ts"), "export const y = 1;\n");
    git(clone, "add", "-A"); git(clone, "commit", "-qm", "safety change"); git(clone, "push", "-q", "origin", "main");
    const safety = git(clone, "rev-parse", "HEAD").stdout.trim();
    writeFileSync(join(scratch, "watch", "green", safety), "");
    const held = ship({ MAIPAI_MODE: "gated", MAIPAI_SHIP_LIVE: live }, safety, "--dry-run");
    expect(held.status).not.toBe(0);
    expect(held.stderr).toContain("changes a safety surface (backend/src/lib/safetyNoStable.ts) since the live hub (sha-" + base.slice(0, 7) + "), and stable does not exist yet");
    // An unknown live tag cannot be judged: held, in plain words.
    writeFileSync(join(live, ".installed-tag"), "v9.9.9\n");
    const unknown = ship({ MAIPAI_MODE: "gated", MAIPAI_SHIP_LIVE: live }, plain, "--dry-run");
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain("the live install's tag (v9.9.9) is not a commit this checkout knows");
    git(clone, "reset", "-q", "--hard", base); git(clone, "push", "-q", "-f", "origin", "main");
  });
  test("gated holds a safety-surface change until stable holds it, then lets it through to the live-hub checks", () => {
    setup();
    git(clone, "branch", "-f", "stable", "HEAD");
    mkdirSync(join(clone, "backend", "src", "lib"), { recursive: true });
    writeFileSync(join(clone, "backend", "src", "lib", "safetyGate.ts"), "export const x = 1;\n");
    git(clone, "add", "-A"); git(clone, "commit", "-qm", "safety change"); git(clone, "push", "-q", "origin", "main");
    const sha = git(clone, "rev-parse", "HEAD").stdout.trim();
    mkdirSync(join(scratch, "watch", "green"), { recursive: true });
    writeFileSync(join(scratch, "watch", "green", sha), "");
    const held = ship({ MAIPAI_MODE: "gated" }, sha, "--dry-run");
    expect(held.stderr).toContain("changes a safety surface (backend/src/lib/safetyGate.ts)");
    git(clone, "branch", "-f", "stable", sha);
    const through = ship({ MAIPAI_MODE: "gated" }, sha, "--dry-run");
    expect(through.stderr).not.toContain("changes a safety surface");
    expect(through.stdout + through.stderr).toContain("GATED: checked first, then run");
  });
  test("direct allows a ship with no green run (before-green implied)", () => {
    setup();
    const r = ship({ MAIPAI_MODE: "direct" }, "main", "--dry-run");
    expect(r.stdout + r.stderr).toContain("DIRECT: run first, checked after");
    expect(r.stderr).not.toContain("no green run");
    expect(r.stderr).not.toContain("watcher has no green run");
  });
});
