// CODE-AGENT-01 slice two: Push goes through the secret check's hook point and the existing git connection push path (lib/gitHost.ts); only the person's
// confirmed click pushes, the check fails closed, findings carry a path and a line, and the token never reaches the trail.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __allowFileRemotesForTests, cloneIntoWorkspace } from "@/lib/gitHost";
import { gitCredentialFor, storeConnection } from "@/lib/gitConnections";
import { createCodingSession, CodingSessionError } from "@/lib/codingSessions";
import { __setShareRemoteForTests, __setWorkspaceRootForTests, checkSecretsBeforeShare, codingWorkspace, pushCodingSession, setSecretScanner } from "@/lib/codingShare";
import { listCodingEvents } from "@/lib/codingEvents";
import { input, owner, startRig } from "./codingRig";

const TOKEN = "gho_SUPERSECRETTOKEN123456";
let base = ""; let remote = ""; let rig: ReturnType<typeof startRig>;
const env = (home: string) => ({ PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Willow", GIT_AUTHOR_EMAIL: "willow@example.com", GIT_COMMITTER_NAME: "Willow", GIT_COMMITTER_EMAIL: "willow@example.com" });
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: env(base), encoding: "utf8" });
const branches = () => git(base, "--git-dir", remote, "for-each-ref", "--format=%(refname)").trim().split("\n").filter(Boolean);

beforeEach(() => { rig = startRig(); base = mkdtempSync(join(tmpdir(), "code-share-")); remote = join(base, "remote.git"); __allowFileRemotesForTests(true); __setWorkspaceRootForTests(join(base, "coding")); __setShareRemoteForTests({ url: remote }); });
afterEach(() => { rig.restore(); setSecretScanner(null); __setShareRemoteForTests(null); __setWorkspaceRootForTests(null); __allowFileRemotesForTests(false); rmSync(base, { recursive: true, force: true }); });

/** A session on a github connection, its workspace cloned from a local "host" and one commit on the session branch. */
async function readySession() {
  const a = owner();
  const conn = storeConnection(a.id, "github", "github.com", { account: "willow", expiresAt: null }, TOKEN, "test");
  git(base, "init", "--bare", "-b", "main", remote);
  const seed = join(base, "seed"); git(base, "clone", remote, seed); writeFileSync(join(seed, "README.md"), "hi\n"); git(seed, "add", "-A"); git(seed, "commit", "-m", "first"); git(seed, "push", "origin", "HEAD:main");
  const s = createCodingSession(a, input({ repo: { kind: "github", connection_id: conn.id, full_name: "willow/app", base_branch: "main", work_branch: "maipai/fix" } }));
  const ws = codingWorkspace(a.id, s.id); mkdirSync(join(ws, ".."), { recursive: true });
  await cloneIntoWorkspace({ personId: a.id, credential: gitCredentialFor(a.id, conn.id)!, owner: "willow", repo: "app", destination: ws, sessionBranch: "maipai/fix", remote: { url: remote } });
  writeFileSync(join(ws, "change.txt"), "agent work\n"); git(ws, "add", "change.txt"); git(ws, "commit", "-m", "agent change");
  return { a, s };
}

describe("Push and the secret check", () => {
  test("it fails closed with no scanner wired, and nothing is pushed", async () => {
    const { a, s } = await readySession();
    await expect(pushCodingSession(a, s.id, true)).rejects.toThrow(/secret check is not installed/);
    expect(branches()).not.toContain("refs/heads/maipai/fix");
  });
  test("a confirmed push with a clean scan lands the session branch and records it", async () => {
    const { a, s } = await readySession(); const seen: string[] = [];
    setSecretScanner(async ({ ref }) => { seen.push(ref); return []; });
    await pushCodingSession(a, s.id, true);
    expect(seen).toEqual(["refs/heads/maipai/fix"]); expect(branches()).toContain("refs/heads/maipai/fix");
    expect(listCodingEvents(a.id, s.id).at(-1)).toMatchObject({ kind: "push", detail: { branch: "maipai/fix" } });
  });
  test("without the person's confirmation nothing runs", async () => {
    const { a, s } = await readySession(); let scanned = false; setSecretScanner(async () => { scanned = true; return []; });
    await expect(pushCodingSession(a, s.id, false)).rejects.toBeInstanceOf(CodingSessionError);
    expect(scanned).toBe(false); expect(branches()).not.toContain("refs/heads/maipai/fix");
  });
  test("a finding blocks the push with its path and line, writes secret_found, and never carries the value", async () => {
    const { a, s } = await readySession();
    setSecretScanner(async () => [{ path: "config/app.env", line: 7 }]);
    const err = (await pushCodingSession(a, s.id, true).then(() => null, (e) => e)) as Error;
    expect(err.message).toContain("config/app.env line 7"); expect(err.message).not.toContain(TOKEN);
    expect(branches()).not.toContain("refs/heads/maipai/fix");
    expect(listCodingEvents(a.id, s.id).at(-1)).toMatchObject({ kind: "secret_found", detail: { path: "config/app.env", line: 7 } });
    expect(JSON.stringify(listCodingEvents(a.id, s.id))).not.toContain(TOKEN);
  });
  test("the same check stands in front of a pull request", async () => {
    const { a, s } = await readySession(); setSecretScanner(async () => [{ path: "x.txt", line: 1 }, { path: "y.txt", line: 2 }]);
    await expect(checkSecretsBeforeShare({ personId: a.id, sessionId: s.id, dir: base, ref: "refs/heads/maipai/fix", action: "pull_request" })).rejects.toThrow(/2 secrets/);
  });
  test("a session with no git repository cannot push", async () => {
    const a = owner(); const s = createCodingSession(a, input()); setSecretScanner(async () => []);
    await expect(pushCodingSession(a, s.id, true)).rejects.toThrow(/no git repository/);
  });
});
