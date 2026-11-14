import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { data, main, scratch, env, run, makeWorktree, commit, queueFiles, setup, cleanup } = fixtures.createLanderFixtures();

beforeAll(setup, 60_000);

describe("land queue", () => {
  test("replaces an earlier request for the same branch", () => {
    const wt = makeWorktree("replace");
    writeFileSync(join(wt, "file.txt"), "first request\n");
    commit(wt, "first request");
    const first = run("land.sh", ["--detach"], wt);
    expect(first.status).toBe(0);
    const second = run("land.sh", ["--detach"], wt);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("replaced earlier request for wt/replace");
    expect(queueFiles()).toHaveLength(1);
    for (const file of queueFiles()) rmSync(join(data, "queue", file), { force: true });
  });

  test("wait accepts an origin/main ancestor even with a stale bounced note", () => {
    const wt = makeWorktree("wait_fallback");
    writeFileSync(join(wt, "file.txt"), "wait fallback\n");
    const sha = commit(wt, "wait fallback commit");
    const pushed = Bun.spawnSync(["git", "-C", main, "push", "origin", `${sha}:refs/heads/main`]);
    expect(pushed.exitCode).toBe(0);
    const notePath = join(data, "notes", "wt-wait_fallback.json");
    writeFileSync(notePath, JSON.stringify({ branch: "wt/wait_fallback", sha, status: "bounced", reason: "stale" }));
    const result = run("land.sh", ["wait", "--timeout", "1"], wt);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`landed: ${sha.slice(0, 7)} is on main`);
  });

  test("refuses stale frontend installs before queueing", () => {
    const wt = makeWorktree("stale_install");
    mkdirSync(join(wt, "frontend", "node_modules"), { recursive: true });
    writeFileSync(join(wt, "frontend", "package.json"), "{}\n");
    writeFileSync(join(wt, "frontend", "bun.lock"), "lock\n");
    commit(wt, "stale frontend install");
    const depsPath = join(main, "scripts", "lib", "deps.sh");
    const depsSource = readFileSync(depsPath, "utf8");
    writeFileSync(depsPath, "deps_current() { return 1; }\n");
    const result = run("land.sh", ["--detach"], wt);
    writeFileSync(depsPath, depsSource);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toContain("run bun install --force in");
    expect(queueFiles()).toHaveLength(0);
  });

  test("runs i18n checks for frontend changes and refuses a stale fixture", () => {
    const wt = makeWorktree("stale_i18n");
    mkdirSync(join(wt, "frontend"), { recursive: true });
    mkdirSync(join(wt, "frontend", "node_modules"), { recursive: true });
    writeFileSync(join(wt, "frontend", "package.json"), "{}\n");
    writeFileSync(join(wt, "frontend", "node_modules", ".maipai-install-stamp"), "not-current\n");
    writeFileSync(join(wt, "frontend", "src.ts"), "change\n");
    const localBin = join(scratch, "i18n-bin");
    mkdirSync(localBin, { recursive: true });
    writeFileSync(join(localBin, "bun"), "#!/bin/sh\necho stale i18n baseline >&2\nexit 1\n");
    chmodSync(join(localBin, "bun"), 0o755);
    commit(wt, "frontend change");
    const localEnv = { ...env, MAIPAI_LAND_SKIP_DEPS: "1", PATH: `${localBin}:${env.PATH}` };
    const result = Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", "--detach"], { cwd: wt, env: localEnv, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toContain("stale i18n baseline");
    expect(queueFiles()).toHaveLength(0);
  });

  test("names lockfile conflicts against origin/main", () => {
    const wt = makeWorktree("lock_conflict");
    writeFileSync(join(wt, "bun.lock"), "branch lock\n");
    commit(wt, "branch lock");
    const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-C", cwd, ...args], { encoding: "utf8" });
    git(main, "fetch", "origin", "main:refs/remotes/origin/main");
    git(main, "reset", "--hard", "origin/main");
    writeFileSync(join(main, "bun.lock"), "main lock\n");
    git(main, "add", "bun.lock"); git(main, "commit", "-m", "main lock"); git(main, "push", "origin", "HEAD:main"); git(wt, "fetch", "origin", "main:refs/remotes/origin/main");
    const localEnv = { ...env, MAIPAI_LAND_SKIP_DEPS: "1" };
    const result = Bun.spawnSync(["bash", join(main, "scripts", "land.sh"), "--queue-anyway", "--detach"], { cwd: wt, env: localEnv, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/CONFLICT .* (bun\.lock|package\.json)/);
    expect(result.stderr.toString()).toContain("merge conflict with origin/main in bun.lock");
    expect(queueFiles()).toHaveLength(0);
  });
});

afterAll(cleanup);
