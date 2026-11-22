import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __allowFileRemotesForTests, __observeGitForTests, cloneIntoWorkspace, gitChildConfig, LFS_REFUSAL, pushSessionBranch, remoteUrlFor, SUBMODULE_REFUSAL, GitHostError } from "@/lib/gitHost";
import type { GitCredential } from "@/lib/gitConnections";

const TOKEN = "gho_SUPERSECRETTOKEN123456";
const cred: GitCredential = { id: "gitc-abcdef1234", kind: "github", host: "github.com", account: "willow", token: TOKEN };
let base = ""; let remote = ""; let ws = ""; const BRANCH = "maipai/fix-login";

const cleanEnv = (home: string) => ({ PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Willow", GIT_AUTHOR_EMAIL: "willow@example.com", GIT_COMMITTER_NAME: "Willow", GIT_COMMITTER_EMAIL: "willow@example.com" });
function git(cwd: string, ...args: string[]): string { return execFileSync("git", args, { cwd, env: cleanEnv(base), encoding: "utf8" }); }
/** A bare "host" repository with one commit on main, seeded through a throwaway clone. */
function makeRemote(files: Record<string, string> = { "README.md": "hello\n" }) {
  git(base, "init", "--bare", "-b", "main", remote);
  const seed = join(base, "seed");
  git(base, "clone", remote, seed);
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(seed, name, ".."), { recursive: true }); writeFileSync(join(seed, name), text); }
  git(seed, "add", "-A"); git(seed, "commit", "-m", "first"); git(seed, "push", "origin", "HEAD:main");
}
async function open() { return cloneIntoWorkspace({ personId: "person-willow01", credential: cred, owner: "o", repo: "r", destination: ws, sessionBranch: BRANCH, remote: { url: remote } }); }
function commit(file = "change.txt") { writeFileSync(join(ws, file), "agent work\n"); git(ws, "add", file); git(ws, "commit", "-m", "agent change"); }
const push = (over: Record<string, unknown> = {}) => pushSessionBranch({ personId: "person-willow01", credential: cred, owner: "o", repo: "r", workspace: ws, branch: BRANCH, baseBranch: "main", remote: { url: remote }, ...over } as never);
const remoteBranches = () => git(base, "--git-dir", remote, "for-each-ref", "--format=%(refname)").trim().split("\n").filter(Boolean);

beforeEach(() => { base = mkdtempSync(join(tmpdir(), "git-host-")); remote = join(base, "remote.git"); ws = join(base, "work", "session"); __allowFileRemotesForTests(true); });
afterEach(() => { __allowFileRemotesForTests(false); __observeGitForTests(null); rmSync(base, { recursive: true, force: true }); });

test("clone then push lands the session branch on the host", async () => {
  makeRemote(); expect((await open()).baseBranch).toBe("main"); commit(); await push();
  expect(remoteBranches()).toContain(`refs/heads/${BRANCH}`);
  expect(git(base, "--git-dir", remote, "show", `${BRANCH}:change.txt`)).toBe("agent work\n");
});

test("a planted post-commit hook, pre-push hook, hooksPath and core.fsmonitor do not run during the hub's push", async () => {
  makeRemote(); await open(); commit();
  const marks = join(base, "marks"); mkdirSync(marks);
  const script = (name: string) => { const p = join(base, `${name}.sh`); writeFileSync(p, `#!/bin/sh\ntouch "${marks}/${name}"\nexit 0\n`); chmodSync(p, 0o755); return p; };
  mkdirSync(join(ws, ".git", "hooks"), { recursive: true });
  for (const hook of ["pre-push", "post-commit", "reference-transaction", "pre-auto-gc"]) { const p = join(ws, ".git", "hooks", hook); writeFileSync(p, `#!/bin/sh\ntouch "${marks}/${hook}"\nexit 0\n`); chmodSync(p, 0o755); }
  git(ws, "config", "core.fsmonitor", script("fsmonitor"));
  git(ws, "config", "core.hooksPath", join(ws, ".git", "hooks"));
  git(ws, "config", "filter.evil.clean", script("filter")); writeFileSync(join(ws, ".gitattributes"), "*.txt filter=evil\n");
  // Control: the planted pieces are live when git runs in the workspace as it stands (this is what the hub must never do).
  git(ws, "status"); git(ws, "commit", "--allow-empty", "-m", "control");
  expect(existsSync(join(marks, "fsmonitor"))).toBe(true); expect(existsSync(join(marks, "post-commit"))).toBe(true);
  rmSync(marks, { recursive: true, force: true }); mkdirSync(marks);
  await push();
  expect(existsSync(join(marks, "pre-push"))).toBe(false); expect(existsSync(join(marks, "post-commit"))).toBe(false);
  expect(existsSync(join(marks, "fsmonitor"))).toBe(false); expect(existsSync(join(marks, "reference-transaction"))).toBe(false);
  expect(existsSync(join(marks, "filter"))).toBe(false);
  expect(remoteBranches()).toContain(`refs/heads/${BRANCH}`);
});

test("pushing the base branch, a non-session branch, a tag, a delete or a force is refused and the host is untouched", async () => {
  makeRemote(); await open(); commit(); const before = git(base, "--git-dir", remote, "rev-parse", "main");
  for (const branch of ["main", "refs/heads/main", "feature/x", "refs/tags/v1", "v1.0", ":maipai/fix-login", "+maipai/fix-login", "maipai/../main", "maipai/x.lock"]) {
    expect(await push({ branch }).catch((e) => e)).toBeInstanceOf(GitHostError);
  }
  expect(await push({ baseBranch: BRANCH }).catch((e) => e)).toBeInstanceOf(GitHostError); // the session branch IS the base: refused
  expect(await push({ force: true }).catch((e) => e)).toBeInstanceOf(GitHostError);
  expect(git(base, "--git-dir", remote, "rev-parse", "main")).toBe(before);
  expect(remoteBranches().filter((r) => r !== "refs/heads/main")).toEqual([]);
});

test("a push the host would only take by force is rejected, not forced", async () => {
  makeRemote(); await open(); commit(); await push();
  const other = join(base, "other"); git(base, "clone", remote, other); git(other, "checkout", BRANCH); writeFileSync(join(other, "theirs.txt"), "x"); git(other, "add", "-A"); git(other, "commit", "-m", "theirs"); git(other, "push", "origin", BRANCH);
  const theirs = git(base, "--git-dir", remote, "rev-parse", BRANCH);
  git(ws, "reset", "--hard", "HEAD~1"); commit("mine.txt"); // diverged
  const err = await push().catch((e) => e);
  expect(err).toBeInstanceOf(GitHostError); expect(String(err.message)).toContain("newer changes");
  expect(git(base, "--git-dir", remote, "rev-parse", BRANCH)).toBe(theirs);
});

test("submodules and LFS attributes are refused with a plain message, at push and at clone", async () => {
  makeRemote(); await open();
  writeFileSync(join(ws, ".gitmodules"), '[submodule "x"]\n\tpath = x\n\turl = https://example.com/x.git\n'); git(ws, "add", "-A"); git(ws, "commit", "-m", "mod");
  expect((await push().catch((e) => e)).message).toBe(SUBMODULE_REFUSAL);
  git(ws, "rm", "-q", ".gitmodules"); writeFileSync(join(ws, ".gitattributes"), "*.bin filter=lfs diff=lfs merge=lfs -text\n"); git(ws, "add", "-A"); git(ws, "commit", "-m", "lfs");
  expect((await push().catch((e) => e)).message).toBe(LFS_REFUSAL);
  expect(remoteBranches()).toEqual(["refs/heads/main"]);
  rmSync(remote, { recursive: true, force: true }); rmSync(join(base, "seed"), { recursive: true, force: true }); rmSync(ws, { recursive: true, force: true });
  makeRemote({ "README.md": "x", ".gitmodules": "[submodule \"x\"]\n\tpath = x\n\turl = https://example.com/x.git\n" });
  expect((await open().catch((e) => e)).message).toBe(SUBMODULE_REFUSAL);
  expect(existsSync(ws)).toBe(false);
});

test("outside the test seam only the connected host's https address is used", async () => {
  __allowFileRemotesForTests(false);
  expect(await push().catch((e) => e)).toBeInstanceOf(GitHostError);
  expect(remoteUrlFor(cred, "willow", "app.git")).toBe("https://github.com/willow/app.git");
  expect(() => remoteUrlFor(cred, "a/b", "x")).toThrow(); expect(() => remoteUrlFor(cred, "..", "x")).toThrow(); expect(() => remoteUrlFor(cred, "a", "x?y=1")).toThrow();
});

test("the token reaches git only through the child's environment: never argv, never a config value, never a log or an error", async () => {
  makeRemote(); const seen: { args: string[]; env: Record<string, string> }[] = [];
  const logs = [spyOn(console, "log"), spyOn(console, "error"), spyOn(console, "warn")];
  __observeGitForTests((args, env) => seen.push({ args, env }));
  await open(); commit(); await push();
  const failed = await pushSessionBranch({ personId: "person-willow01", credential: cred, owner: "o", repo: "r", workspace: ws, branch: BRANCH, baseBranch: "main", remote: { url: join(base, "nope.git") } }).catch((e) => e);
  expect(seen.length).toBeGreaterThan(5);
  for (const { args, env } of seen) {
    expect(args.join(" ")).not.toContain(TOKEN);
    for (const [key, value] of Object.entries(env)) if (key !== "MAIPAI_GIT_TOKEN") expect(value).not.toContain(TOKEN);
    expect(env.HOME).not.toBe(process.env.HOME); expect(env.GIT_CONFIG_NOSYSTEM).toBe("1"); expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(Object.keys(env).some((k) => /^(SSH_AUTH_SOCK|GITHUB_TOKEN|GH_TOKEN|MAIPAI_SECRETS_KEY)$/.test(k))).toBe(false);
  }
  expect(seen.some((s) => s.env.MAIPAI_GIT_TOKEN === TOKEN)).toBe(true); // the helper really is handed it, in the environment
  expect(String((failed as Error).message)).not.toContain(TOKEN);
  for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  const config = gitChildConfig({ token: true });
  expect(JSON.stringify(config)).not.toContain(TOKEN);
  expect(Object.fromEntries(config)["core.hooksPath"]).toBe("/dev/null"); expect(Object.fromEntries(config)["core.fsmonitor"]).toBe("false");
  expect(Object.fromEntries(config)["protocol.file.allow"]).toBe("never");
  logs.forEach((s) => s.mockRestore());
});
