import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, statSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// WARM-INSTALL-01: `wt.sh start` gives a new worktree an APFS clone of a warm node_modules kept per lockfile hash.
// The shim sits in front of `bun`; only `install --frozen-lockfile` is routed through the warm store, and every problem falls back to the real install.
const shim = join(import.meta.dir, "lib", "wt-bun-shim", "bun");
const scratch = mkdtempSync(join(tmpdir(), "maipai-warm-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const bin = join(scratch, "bin");
const calls = join(scratch, "bun.calls");
const warm = join(scratch, "warm");
const repo = join(scratch, "repo");
const sh = (cwd: string, cmd: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MAIPAI_WARM_DIR: warm, MAIPAI_WARM_INSTALL: "", MAIPAI_WARM_NO_CLONE: "", ...env } });
// A fake real bun: logs the call and "installs" a node_modules tree (with a relative symlink like bun's isolated layout) unless one is already there.
beforeAll(() => {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "bun"), `#!/bin/bash\necho "$PWD :: $*" >> ${JSON.stringify(calls)}\nif [[ "$1" == --version ]]; then echo 9.9.9; exit 0; fi\nif [[ "$1 $2" == "install --frozen-lockfile" ]]; then\n  [[ -n "$FAKE_BUN_FAIL" ]] && exit 1\n  R=$(git rev-parse --show-toplevel)\n  if [[ ! -d $R/node_modules ]]; then mkdir -p $R/node_modules/.bun/pkg@1/node_modules/pkg && echo hi > $R/node_modules/.bun/pkg@1/node_modules/pkg/i.js && ln -s .bun/pkg@1/node_modules/pkg $R/node_modules/pkg; fi\n  mkdir -p node_modules\n  exit 0\nfi\nexit 0\n`);
  chmodSync(bin, 0o755); chmodSync(join(bin, "bun"), 0o755);
  mkdirSync(join(repo, "backend"), { recursive: true }); mkdirSync(join(repo, "frontend"), { recursive: true });
  for (const [f, v] of Object.entries({ "bun.lock": "lock1", "package.json": "{}", "backend/package.json": "{}", "frontend/package.json": "{}" })) writeFileSync(join(repo, f), v);
  spawnSync("git", ["init", "-q", repo]);
});
const installCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter((l) => l.includes("install --frozen-lockfile")) : []);
const reset = () => { rmSync(calls, { force: true }); rmSync(join(repo, "node_modules"), { recursive: true, force: true }); rmSync(join(repo, "backend", "node_modules"), { recursive: true, force: true }); };

describe("wt-bun-shim", () => {
  test("a miss runs the real install and saves a warm copy; the next start clones it and still verifies with the real install", () => {
    reset(); rmSync(warm, { recursive: true, force: true });
    const a = sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"]);
    expect(a.status).toBe(0);
    const hashes = readdirSync(warm);
    expect(hashes.length).toBe(1);
    expect(existsSync(join(warm, hashes[0]!, "root", "node_modules", "pkg", "i.js"))).toBe(true);
    expect(existsSync(join(warm, hashes[0]!, "backend", "node_modules"))).toBe(true);
    reset(); // a new worktree: no node_modules
    const b = sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"]);
    expect(b.status).toBe(0);
    expect(b.stderr).toContain("cloned root node_modules");
    expect(existsSync(join(repo, "node_modules", "pkg", "i.js"))).toBe(true); // relative symlink resolves in the clone
    expect(lstatSync(join(repo, "node_modules", "pkg")).isSymbolicLink()).toBe(true);
    expect(installCalls().length).toBe(1); // the verifying install ran once after the clone
  });
  test("a changed lockfile is a different hash: no clone, normal install, a second warm entry", () => {
    reset(); writeFileSync(join(repo, "bun.lock"), "lock2");
    const r = sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"]);
    expect(r.stderr).not.toContain("cloned");
    expect(readdirSync(warm).length).toBe(2);
    writeFileSync(join(repo, "bun.lock"), "lock1");
  });
  test("when the clone fails (no clone possible) the normal install runs and nothing partial is left", () => {
    reset();
    const r = sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"], { MAIPAI_WARM_NO_CLONE: "1" });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("cloned");
    expect(existsSync(join(repo, "node_modules", "pkg", "i.js"))).toBe(true);
    expect(installCalls().length).toBe(1);
  });
  test("a failing real install fails the start and saves nothing new", () => {
    reset(); rmSync(warm, { recursive: true, force: true });
    const r = sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"], { FAKE_BUN_FAIL: "1" });
    expect(r.status).toBe(1);
    expect(existsSync(warm) ? readdirSync(warm) : []).toEqual([]);
  });
  test("MAIPAI_WARM_INSTALL=0 and every other bun command go straight to the real bun", () => {
    reset(); rmSync(warm, { recursive: true, force: true });
    sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"], { MAIPAI_WARM_INSTALL: "0" });
    sh(join(repo, "backend"), "bash", [shim, "install", "--force"]);
    sh(join(repo, "backend"), "bash", [shim, "test"]);
    expect(existsSync(warm)).toBe(false);
    expect(readFileSync(calls, "utf8")).toContain(":: install --force");
  });
  test("only the keep limit of hashes stays", () => {
    reset(); rmSync(warm, { recursive: true, force: true });
    for (const v of ["a", "b", "c", "d", "e"]) { reset(); writeFileSync(join(repo, "bun.lock"), v); sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"], { MAIPAI_WARM_KEEP: "3" }); }
    expect(readdirSync(warm).length).toBe(3);
    writeFileSync(join(repo, "bun.lock"), "lock1");
  });
  test("a hit touches its hash so pruning keeps the one in use", () => {
    reset(); rmSync(warm, { recursive: true, force: true });
    sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"]);
    const dir = join(warm, readdirSync(warm)[0]!);
    spawnSync("touch", ["-t", "200001010000", dir]);
    reset(); sh(join(repo, "backend"), "bash", [shim, "install", "--frozen-lockfile"]);
    expect(statSync(dir).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
  });
});
