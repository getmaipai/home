// CODE-AGENT-01 slice four: pull requests through the person's git connection and the host's API, against a fake host. It always asks (the person's confirmed
// click), runs the push and the secret check first, fails closed, and never lets the token into an error, a log or a record.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __allowFileRemotesForTests, cloneIntoWorkspace } from "@/lib/gitHost";
import { gitCredentialFor, listGitConnections, storeConnection } from "@/lib/gitConnections";
import { createCodingSession, getCodingSession } from "@/lib/codingSessions";
import { __setShareRemoteForTests, __setWorkspaceRootForTests, codingWorkspace, setSecretScanner } from "@/lib/codingShare";
import { __setPullRequestDepsForTests, createCodingPullRequest } from "@/lib/codingPullRequest";
import { listCodingEvents } from "@/lib/codingEvents";
import { TestClient } from "./client";
import { input, owner, person, startRig } from "./codingRig";

const TOKEN = ["gho", "RUNTIMEBUILTFAKETOKEN123456"].join("_"); // built at run time so the scan stays clean
let base = ""; let remote = ""; let rig: ReturnType<typeof startRig>;
const env = (home: string) => ({ PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Willow", GIT_AUTHOR_EMAIL: "willow@example.com", GIT_COMMITTER_NAME: "Willow", GIT_COMMITTER_EMAIL: "willow@example.com" });
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: env(base), encoding: "utf8" });
const branches = () => git(base, "--git-dir", remote, "for-each-ref", "--format=%(refname)").trim().split("\n").filter(Boolean);
const calls: Array<{ url: string; method: string; auth: string | null; body: Record<string, unknown> }> = [];
let hostReply: () => Response = () => new Response(JSON.stringify({ html_url: "https://github.com/willow/app/pull/12", number: 12, draft: true }), { status: 201 });
const fakeFetch = (async (url: URL | string, init?: RequestInit) => { calls.push({ url: String(url), method: String(init?.method), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) }); return hostReply(); }) as unknown as typeof fetch;
const publicDns = async () => ({ address: "203.0.113.7", family: 4 });

beforeEach(() => {
  rig = startRig(); base = mkdtempSync(join(tmpdir(), "code-pr-")); remote = join(base, "remote.git"); calls.length = 0;
  hostReply = () => new Response(JSON.stringify({ html_url: "https://github.com/willow/app/pull/12", number: 12, draft: true }), { status: 201 });
  __allowFileRemotesForTests(true); __setWorkspaceRootForTests(join(base, "coding")); __setShareRemoteForTests({ url: remote }); setSecretScanner(async () => []);
  __setPullRequestDepsForTests({ fetch: fakeFetch, dnsLookup: publicDns });
});
afterEach(() => { rig.restore(); setSecretScanner(null); __setPullRequestDepsForTests(null); __setShareRemoteForTests(null); __setWorkspaceRootForTests(null); __allowFileRemotesForTests(false); rmSync(base, { recursive: true, force: true }); });

async function ready(kind: "github" | "gitea" = "github") {
  const a = owner();
  const conn = storeConnection(a.id, kind, kind === "github" ? "github.com" : "git.example.com", { account: "willow", expiresAt: null }, TOKEN, "test");
  git(base, "init", "--bare", "-b", "main", remote);
  const seed = join(base, "seed"); git(base, "clone", remote, seed); writeFileSync(join(seed, "README.md"), "hi\n"); git(seed, "add", "-A"); git(seed, "commit", "-m", "first"); git(seed, "push", "origin", "HEAD:main");
  const s = createCodingSession(a, input({ repo: { kind, connection_id: conn.id, full_name: "willow/app", base_branch: "main", work_branch: "maipai/fix" } }));
  const ws = codingWorkspace(a.id, s.id); mkdirSync(join(ws, ".."), { recursive: true });
  await cloneIntoWorkspace({ personId: a.id, credential: gitCredentialFor(a.id, conn.id)!, owner: "willow", repo: "app", destination: ws, sessionBranch: "maipai/fix", remote: { url: remote } });
  writeFileSync(join(ws, "change.txt"), "agent work\n"); git(ws, "add", "change.txt"); git(ws, "commit", "-m", "agent change");
  return { a, s, conn };
}

describe("opening a pull request", () => {
  test("a confirmed request scans, pushes, then opens a draft on GitHub with the token only in the header, and records it", async () => {
    const { a, s } = await ready(); const scanned: string[] = []; setSecretScanner(async ({ ref }) => { scanned.push(ref); return []; });
    const logs = [spyOn(console, "log"), spyOn(console, "error"), spyOn(console, "warn")];
    const pr = await createCodingPullRequest(a, s.id, { confirm: true, title: "Fix the login" });
    expect(pr).toEqual({ url: "https://github.com/willow/app/pull/12", number: 12, draft: true });
    expect(scanned).toEqual(["refs/heads/maipai/fix"]); expect(branches()).toContain("refs/heads/maipai/fix");
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.github.com/repos/willow/app/pulls", auth: `Bearer ${TOKEN}` });
    expect(calls[0]!.body).toMatchObject({ title: "Fix the login", head: "maipai/fix", base: "main", draft: true });
    expect(JSON.stringify(calls[0]!.body)).not.toContain(TOKEN);
    expect(getCodingSession(a, s.id)!.pull_request).toEqual(pr);
    expect(listCodingEvents(a.id, s.id).map((e) => e.kind)).toEqual(["push", "pull_request"]);
    expect(JSON.stringify([listCodingEvents(a.id, s.id), logs.map((l) => l.mock.calls)])).not.toContain(TOKEN);
    expect((await createCodingPullRequest(a, s.id, { confirm: true })).number).toBe(12); expect(calls).toHaveLength(1); // opening again shows the same one
  });
  test("Gitea uses its own address and header, and marks a draft with WIP", async () => {
    const { a, s } = await ready("gitea"); hostReply = () => new Response(JSON.stringify({ html_url: "https://git.example.com/willow/app/pulls/3", number: 3 }), { status: 201 });
    const pr = await createCodingPullRequest(a, s.id, { confirm: true, title: "Tidy" });
    expect(calls[0]).toMatchObject({ url: "https://git.example.com/api/v1/repos/willow/app/pulls", auth: `token ${TOKEN}` }); expect(calls[0]!.body.title).toBe("WIP: Tidy");
    expect(pr).toEqual({ url: "https://git.example.com/willow/app/pulls/3", number: 3, draft: true });
  });
  test("without the click, with a finding, or with no scanner, no host call is made and nothing is pushed", async () => {
    const { a, s } = await ready();
    await expect(createCodingPullRequest(a, s.id, { confirm: false })).rejects.toThrow(/confirmation/);
    setSecretScanner(async () => [{ path: "x.env", line: 2 }]);
    await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/x\.env line 2/);
    const { createGitleaksScanner } = await import("@/lib/codingGitleaks"); setSecretScanner(createGitleaksScanner(async () => "missing"));
    await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/gitleaks\) is not installed/);
    expect(calls).toEqual([]); expect(branches()).not.toContain("refs/heads/maipai/fix");
  });
  test("a person without Coding access, another person's session, and a session with no repository are refused", async () => {
    const { s } = await ready(); const other = person("adult");
    await expect(createCodingPullRequest(other, s.id, { confirm: true })).rejects.toThrow(/not found/);
    const plain = createCodingSession(owner(), input({ title: "Plain" }));
    await expect(createCodingPullRequest(person("guest" as never), plain.id, { confirm: true })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test("host refusals say what to do; a 401 marks the connection failing; the answer's link must be on the connection's host", async () => {
    const { a, s, conn } = await ready();
    hostReply = () => new Response("{}", { status: 422 }); await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/may already exist/);
    hostReply = () => new Response("{}", { status: 404 }); await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/does not have that repository/);
    hostReply = () => new Response(JSON.stringify({ html_url: "https://evil.example.net/x/1", number: 1 }), { status: 201 });
    await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/not with a pull request Home can show/);
    expect(getCodingSession(a, s.id)!.pull_request).toBeUndefined();
    hostReply = () => new Response("{}", { status: 401 });
    const err = (await createCodingPullRequest(a, s.id, { confirm: true }).then(() => null, (e) => e)) as Error;
    expect(err.message).toContain("replace the connection"); expect(err.message).not.toContain(TOKEN);
    expect(listGitConnections(a).find((c) => c.id === conn.id)!.status).toBe("failing");
  });
  test("a private host address and an unreachable host fail closed", async () => {
    const { a, s } = await ready();
    __setPullRequestDepsForTests({ fetch: fakeFetch, dnsLookup: async () => ({ address: "192.168.1.5", family: 4 }) });
    await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/public https host/);
    __setPullRequestDepsForTests({ fetch: (async () => { throw new Error("down"); }) as unknown as typeof fetch, dnsLookup: publicDns });
    await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/could not reach the git host/);
  });
  test("an existing pull request is shown only to someone who may still use Code", async () => {
    const { a, s } = await ready(); await createCodingPullRequest(a, s.id, { confirm: true });
    const { setHouseholdSettingValue } = await import("@/lib/settings"); setHouseholdSettingValue("coding.enabled", false);
    await expect(createCodingPullRequest(a, s.id, { confirm: true })).rejects.toThrow(/turned off for this household/);
  });
  test("the route needs a signed-in person", async () => {
    expect((await new TestClient().post("/api/code/sessions/csess-abcdef0001/pull-request", { confirm: true })).status).toBe(401);
  });
});
