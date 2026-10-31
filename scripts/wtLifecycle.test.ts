import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import * as fixtures from "./tests/wtFixtures";
const { scratch, repoRoot, common, script, hasNode, hasTmuxBin, fixture, bare, data, socket, run, fixtureEnv, setup, cleanup } = fixtures.createWtFixtures();
beforeAll(setup);
afterAll(cleanup);

describe.skipIf(!hasNode)("wt.sh worktree lifecycle (needs node installed)", () => {
  test("start and done remove the worktree, branch, and session file", () => {
    const started = run(["start", "x"]);
    expect(started.status).toBe(0);
    const path = started.stdout.trim();
    expect(path).toContain("/wt/home-");
    expect(readFileSync(join(data, "sessions", `${path.split("/").at(-1)!.replace(/^home-/, "")}.json`), "utf8")).toContain('"branch": "wt/');

    const finished = run(["done"]);
    expect(finished.status).toBe(0);
    expect(spawnSync("git", ["-C", fixture, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout).not.toContain(`worktree ${path}`);
    const branches = spawnSync("git", ["-C", fixture, "branch", "--list", "wt/*"], { encoding: "utf8" }).stdout.trim();
    expect(branches).toBe("");
    expect(spawnSync("find", [join(data, "sessions"), "-name", "*.json"], { encoding: "utf8" }).stdout.trim()).toBe("");
  });

  test("port leases the first available port and records a session", () => {
    const result = run(["port"], { MAIPAI_WT_SESSION: "test-session" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("8800");
    expect(readFileSync(join(data, "ports", "8800.lease"), "utf8")).toContain("test-session");
  });

  test("check classifies docs, then stamps the selected tier and HEAD", () => {
    const started = run(["start", "check"]);
    expect(started.status).toBe(0);
    const path = started.stdout.trim();
    const name = path.split("/").at(-1)!.replace(/^home-/, "");
    writeFileSync(join(path, "NOTE.md"), "note\n");
    // Invoke this checkout's script with the fixture worktree as its cwd.
    const checked = spawnSync("bash", [script, "check"], { cwd: path, encoding: "utf8", env: fixtureEnv({ MAIPAI_WT_SESSION: name }) });
    expect(checked.status).toBe(0);
    const stamp = JSON.parse(readFileSync(join(data, "gate-stamps", `${name}.json`), "utf8"));
    expect(stamp.tier).toBe("T0");
    expect(stamp.head).toBe(spawnSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim());
    // NOTE.md is never committed, so done must discard it on purpose; plain done refuses uncommitted files.
    expect(run(["done", "--abandon"], { MAIPAI_WT_SESSION: name }).status).toBe(0);
  });

  test("tier classifies explicit paths and the branch diff", () => {
    expect(run(["tier", "README.md", "docs/guide.md"]).stdout.trim()).toBe("T0");
    expect(run(["tier", "backend/src/auth/session.ts"]).stdout.trim()).toBe("T2");
    expect(run(["tier", "backend/src/other.ts"]).stdout.trim()).toBe("T1");
    const started = run(["start", "tier"]);
    const path = started.stdout.trim();
    writeFileSync(join(path, "backend-change.ts"), "code\n");
    expect(spawnSync("bash", [script, "tier"], { cwd: path, encoding: "utf8", env: { ...process.env, MAIPAI_WT_DATA: data } }).stdout.trim()).toBe("T1");
    const name = path.split("/").at(-1)!.replace(/^home-/, "");
    run(["done"], { MAIPAI_WT_SESSION: name });
  });

  // Skipped, with this reason, on a machine without tmux; runs wherever tmux is installed.
  const hasTmux = spawnSync("tmux", ["-V"], { stdio: "ignore" }).status === 0;
  (hasTmux ? test : test.skip)("tmux creates only a session on its private socket and done kills it (needs tmux installed)", () => {
    const started = run(["start", "tmux"]);
    expect(started.status).toBe(0);
    const path = started.stdout.trim();
    const name = path.split("/").at(-1)!.replace(/^home-/, "");
    const created = run(["tmux", "dev"], { MAIPAI_WT_SESSION: name });
    expect(created.status).toBe(0);
    const tmuxName = created.stdout.trim();
    expect(tmuxName).toBe(`home-${name}-dev`);
    expect(spawnSync("tmux", ["-L", socket, "has-session", "-t", tmuxName]).status).toBe(0);
    expect(run(["done"], { MAIPAI_WT_SESSION: name }).status).toBe(0);
    expect(spawnSync("tmux", ["-L", socket, "has-session", "-t", tmuxName]).status).not.toBe(0);
  });

  describe("reaper is report-only unless a worktree is provably dead", () => {
    const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const shimDir = join(scratch, "git-shim");
    const calls = join(scratch, "git-calls.txt");
    const startDead = (slug: string) => {
      const started = run(["start", slug]);
      expect(started.status).toBe(0);
      const path = started.stdout.trim();
      const name = path.split("/").at(-1)!.replace(/^home-/, "");
      const file = join(data, "sessions", `${name}.json`);
      const rec = JSON.parse(readFileSync(file, "utf8"));
      rec.pid = 999999999;
      writeFileSync(file, JSON.stringify(rec));
      return { path, name, file };
    };
    const age = (w: { path: string; name: string }) => {
      const gitdir = spawnSync(realGit, ["-C", w.path, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).stdout.trim();
      for (const dir of [w.path, gitdir]) spawnSync("find", [dir, "-exec", "touch", "-t", "202001010000", "{}", "+"]);
      spawnSync("touch", ["-t", "202001010000", join(data, "sessions", `${w.name}.beat`)]);
    };
    const reap = (env: Record<string, string> = {}) => run(["reap"], { MAIPAI_WT_REAP_AGE: "0", ...env });
    const listed = () => spawnSync("git", ["-C", fixture, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout;
    const cleanup = (w: { path: string; name: string; file: string }) => {
      spawnSync("git", ["-C", fixture, "worktree", "remove", "--force", w.path]);
      spawnSync("git", ["-C", fixture, "branch", "-D", `wt/${w.name}`]);
      rmSync(w.file, { force: true });
      rmSync(join(data, "sessions", `${w.name}.beat`), { force: true });
    };

    test("a dirty dead worktree is reported, never archived, committed or removed", () => {
      const w = startDead("recover");
      writeFileSync(join(w.path, "lost-work.txt"), "keep this\n");
      age(w);
      mkdirSync(shimDir, { recursive: true });
      writeFileSync(join(shimDir, "git"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${calls}'\nexec '${realGit}' "$@"\n`, { mode: 0o755 });
      rmSync(calls, { force: true });
      expect(reap({ PATH: `${shimDir}:${process.env.PATH}` }).status).toBe(0);
      expect(readFileSync(join(w.path, "lost-work.txt"), "utf8")).toBe("keep this\n");
      expect(listed()).toContain(`worktree ${w.path}`);
      expect(readFileSync(join(data, "reaped.md"), "utf8")).toContain(w.name);
      expect(spawnSync(realGit, ["-C", fixture, "show-ref", "--verify", `refs/heads/wip/${w.name}`]).status).not.toBe(0);
      expect(spawnSync(realGit, ["-C", w.path, "log", "--author=MaiPai Reaper", "--oneline"], { encoding: "utf8" }).stdout).toBe("");
      const seen = existsSync(calls) ? readFileSync(calls, "utf8") : "";
      expect(seen).not.toMatch(/(^|\s)(add|commit|stash|reset|checkout|clean|branch -f|branch -D|update-ref)(\s|$)/m);
      expect(seen).not.toMatch(/worktree remove/);
      cleanup(w);
    });

    (hasTmuxBin ? test : test.skip)("a clean merged worktree with no activity is removed (needs tmux installed)", () => {
      const w = startDead("clean");
      age(w);
      expect(reap().status).toBe(0);
      expect(listed()).not.toContain(`worktree ${w.path}`);
      expect(existsSync(w.file)).toBe(false);
    });
  });
});
