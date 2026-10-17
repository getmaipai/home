import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "maipai-wt-test-"));
const repoRoot = join(import.meta.dir, "..");
// The logic is the shared getmaipai/.github script; this repo's scripts/wt.sh is a thin wrapper, so the
// lifecycle is exercised against the shared file in the sibling .github checkout.
const common = resolve(repoRoot, spawnSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).stdout.trim());
const script = process.env.MAIPAI_WT_SHARED || join(common, "..", "..", ".github", "standards", "bin", "wt.sh");
process.env.WT_T2_GLOBS ??= "backend/src/auth/* docs/design/RULES.md scripts/check.sh";
const fixture = join(scratch, "home");
const bare = join(scratch, "origin.git");
const data = join(scratch, "session-data");
const socket = `wt-test-${process.pid}-${Date.now()}`;
const run = (args: string[], env: Record<string, string> = {}) => spawnSync("bash", [script, ...args], {
  cwd: fixture,
  encoding: "utf8",
  env: { ...process.env, MAIPAI_WT_DATA: data, MAIPAI_WT_TMUX_SOCKET: socket, ...env },
});

beforeAll(() => {
  mkdirSync(fixture, { recursive: true });
  spawnSync("git", ["init", "--bare", bare], { stdio: "inherit" });
  spawnSync("git", ["init", "-b", "main", fixture], { stdio: "inherit" });
  spawnSync("git", ["-C", fixture, "config", "user.name", "Test User"]);
  spawnSync("git", ["-C", fixture, "config", "user.email", "test@example.invalid"]);
  writeFileSync(join(fixture, "README.md"), "fixture\n");
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  writeFileSync(join(fixture, "scripts", "check.sh"), "#!/usr/bin/env bash\necho '== scope: fixture'\n");
  spawnSync("git", ["-C", fixture, "add", "."]);
  spawnSync("git", ["-C", fixture, "commit", "-m", "initial"]);
  spawnSync("git", ["-C", fixture, "remote", "add", "origin", bare]);
  spawnSync("git", ["-C", fixture, "push", "-u", "origin", "main"]);
});

afterAll(() => {
  spawnSync("tmux", ["-L", socket, "kill-server"], { stdio: "ignore" });
  rmSync(scratch, { recursive: true, force: true });
});

describe("wt.sh worktree lifecycle", () => {
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
    const checked = spawnSync("bash", [script, "check"], { cwd: path, encoding: "utf8", env: { ...process.env, MAIPAI_WT_DATA: data, MAIPAI_WT_SESSION: name } });
    expect(checked.status).toBe(0);
    const stamp = JSON.parse(readFileSync(join(data, "gate-stamps", `${name}.json`), "utf8"));
    expect(stamp.tier).toBe("T0");
    expect(stamp.head).toBe(spawnSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim());
    expect(run(["done"], { MAIPAI_WT_SESSION: name }).status).toBe(0);
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

  test("tmux creates only a session on its private socket and done kills it", () => {
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

  test("reap archives dirty dead work on wip and removes clean merged work", () => {
    const dirtyStart = run(["start", "recover"]);
    expect(dirtyStart.status).toBe(0);
    const dirtyPath = dirtyStart.stdout.trim();
    const dirtyName = dirtyPath.split("/").at(-1)!.replace(/^home-/, "");
    writeFileSync(join(dirtyPath, "lost-work.txt"), "keep this\n");
    const dirtyFile = join(data, "sessions", `${dirtyName}.json`);
    const dirtyRecord = JSON.parse(readFileSync(dirtyFile, "utf8"));
    dirtyRecord.pid = 999999999;
    writeFileSync(dirtyFile, JSON.stringify(dirtyRecord));

    const cleanStart = run(["start", "clean"]);
    expect(cleanStart.status).toBe(0);
    const cleanPath = cleanStart.stdout.trim();
    const cleanName = cleanPath.split("/").at(-1)!.replace(/^home-/, "");
    const cleanFile = join(data, "sessions", `${cleanName}.json`);
    const cleanRecord = JSON.parse(readFileSync(cleanFile, "utf8"));
    cleanRecord.pid = 999999999;
    writeFileSync(cleanFile, JSON.stringify(cleanRecord));

    expect(run(["reap"], { MAIPAI_WT_REAP_AGE: "0" }).status).toBe(0);
    expect(spawnSync("git", ["-C", fixture, "show-ref", "--verify", `refs/heads/wip/${dirtyName}`]).status).toBe(0);
    expect(readFileSync(join(dirtyPath, "lost-work.txt"), "utf8")).toBe("keep this\n");
    expect(readFileSync(join(data, "reaped.md"), "utf8")).toContain(dirtyName);
    expect(spawnSync("git", ["-C", fixture, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout).toContain(`worktree ${dirtyPath}`);
    expect(spawnSync("git", ["-C", fixture, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout).not.toContain(`worktree ${cleanPath}`);
    spawnSync("git", ["-C", fixture, "worktree", "remove", "--force", dirtyPath]);
    spawnSync("git", ["-C", fixture, "branch", "-D", `wt/${dirtyName}`, `wip/${dirtyName}`]);
    rmSync(dirtyFile, { force: true });
    rmSync(join(data, "sessions", `${cleanName}.json`), { force: true });
  });
});

describe("wt.sh land gate stamp", () => {
  const originMain = () => spawnSync("git", ["--git-dir", bare, "rev-parse", "main"], { encoding: "utf8" }).stdout.trim();
  // A worktree with one committed file; `file` decides the tier (docs T0, other code T1).
  const session = (slug: string, file: string) => {
    const started = run(["start", slug]);
    if (started.status !== 0 || !started.stdout.trim()) throw new Error(`wt.sh start failed: ${started.stderr}`);
    const path = started.stdout.trim();
    const name = path.split("/").at(-1)!.replace(/^home-/, "");
    mkdirSync(join(path, file, ".."), { recursive: true });
    writeFileSync(join(path, file), `${slug}\n`);
    spawnSync("git", ["-C", path, "add", file]);
    spawnSync("git", ["-C", path, "commit", "-m", slug], { env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
    const sh = (args: string[]) => spawnSync("bash", [script, ...args], { cwd: path, encoding: "utf8", env: { ...process.env, MAIPAI_WT_DATA: data, MAIPAI_WT_SESSION: name } });
    const stampPath = join(data, "gate-stamps", `${name}.json`);
    const edit = (fn: (s: any) => void) => { const s = JSON.parse(readFileSync(stampPath, "utf8")); fn(s); writeFileSync(stampPath, JSON.stringify(s)); };
    return { path, name, sh, stampPath, edit };
  };
  const refused = (r: { status: number | null; stderr: string }, text: string, next: string) => {
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain(next);
  };

  test("refuses with the exact next command when no stamp exists", () => {
    const before = originMain();
    const s = session("nostamp", "docs/nostamp.md");
    refused(s.sh(["land"]), "no gate stamp", `MAIPAI_WT_SESSION=${s.name} bash scripts/wt.sh check`);
    expect(originMain()).toBe(before);
    s.sh(["done"]);
  });

  test("refuses a failed, too-weak, stale, or drifted stamp, then lands after a fresh green check", () => {
    const before = originMain();
    const s = session("stamped", "tools/stamped.ts");
    expect(s.sh(["check"]).status).toBe(0);
    const good = readFileSync(s.stampPath, "utf8");
    const next = `MAIPAI_WT_SESSION=${s.name} bash scripts/wt.sh check`;

    s.edit((j) => { j.exitCode = 1; });
    refused(s.sh(["land"]), "check for session", next);

    writeFileSync(s.stampPath, good);
    s.edit((j) => { j.tier = "T0"; });
    refused(s.sh(["land"]), "need tier T1", `${next} T1`);

    writeFileSync(s.stampPath, good);
    s.edit((j) => { j.created = new Date(Date.now() - 241 * 60 * 1000).toISOString(); });
    refused(s.sh(["land"]), "only 4 hours counts", next);

    writeFileSync(s.stampPath, good);
    writeFileSync(join(s.path, "tools/stamped.ts"), "changed after the check\n");
    spawnSync("git", ["-C", s.path, "commit", "-am", "drift"], { env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
    refused(s.sh(["land"]), "changed since the gate stamp", next);
    expect(originMain()).toBe(before);

    expect(s.sh(["check"]).status).toBe(0);
    const landed = s.sh(["land"]);
    expect(landed.status).toBe(0);
    expect(originMain()).not.toBe(before);
  }, 30000);

  test("a stronger stamp than needed lands", () => {
    const s = session("stronger", "docs/stronger.md");
    expect(s.sh(["check", "T1"]).status).toBe(0);
    expect(JSON.parse(readFileSync(s.stampPath, "utf8")).tier).toBe("T1");
    expect(s.sh(["land"]).status).toBe(0);
  }, 30000);
});

