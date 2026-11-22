// CODE-APP-01: the Changes and Files reads of a session's workspace: gated like every Code call, link-safe, capped, binary refused, credentials removed.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __allowFileRemotesForTests, cloneIntoWorkspace } from "@/lib/gitHost";
import { gitCredentialFor, storeConnection } from "@/lib/gitConnections";
import { createCodingSession } from "@/lib/codingSessions";
import { __setWorkspaceRootForTests, codingWorkspace } from "@/lib/codingShare";
import { setHouseholdSettingValue } from "@/lib/settings";
import { sessionChanges, sessionFile, sessionTree } from "@/lib/codingWorkspaceView";
import { input, owner, startRig } from "./codingRig";

let base = ""; let rig: ReturnType<typeof startRig>;
const env = (home: string) => ({ PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Willow", GIT_AUTHOR_EMAIL: "w@example.com", GIT_COMMITTER_NAME: "Willow", GIT_COMMITTER_EMAIL: "w@example.com" });
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: env(base), encoding: "utf8" });
beforeEach(() => { rig = startRig(); base = mkdtempSync(join(tmpdir(), "code-view-")); __allowFileRemotesForTests(true); __setWorkspaceRootForTests(join(base, "coding")); });
afterEach(() => { rig.restore(); __setWorkspaceRootForTests(null); __allowFileRemotesForTests(false); rmSync(base, { recursive: true, force: true }); });

async function ready() {
  const a = owner(); const remote = join(base, "remote.git");
  const conn = storeConnection(a.id, "github", "github.com", { account: "willow", expiresAt: null }, "gho_" + "x".repeat(22), "test");
  git(base, "init", "--bare", "-b", "main", remote);
  const seed = join(base, "seed"); git(base, "clone", remote, seed); writeFileSync(join(seed, "README.md"), "hi\n"); git(seed, "add", "-A"); git(seed, "commit", "-m", "first"); git(seed, "push", "origin", "main");
  const s = createCodingSession(a, input({ repo: { kind: "github", connection_id: conn.id, full_name: "willow/app", base_branch: "main", work_branch: "maipai/fix" } }));
  const ws = codingWorkspace(a.id, s.id); mkdirSync(join(ws, ".."), { recursive: true });
  await cloneIntoWorkspace({ personId: a.id, credential: gitCredentialFor(a.id, conn.id)!, owner: "willow", repo: "app", destination: ws, sessionBranch: "maipai/fix", remote: { url: remote } });
  mkdirSync(join(ws, "src")); writeFileSync(join(ws, "src", "a.ts"), "export const a = 1;\n"); writeFileSync(join(ws, "bin.dat"), Buffer.from([0, 1, 2, 3]));
  git(ws, "add", "-A"); git(ws, "commit", "-m", "agent change");
  return { a, s, ws };
}

describe("Changes", () => {
  test("the diff of the committed branch against its base, with a binary file listed and no body", async () => {
    const { a, s } = await ready();
    const out = await sessionChanges(a, s.id);
    expect(out.available).toBe(true);
    expect(out.files.map((f) => [f.path, f.binary])).toEqual([["bin.dat", true], ["src/a.ts", false]]);
    expect(out.diff).toContain("+export const a = 1;");
  });
  test("uncommitted edits, new files and deletions show too, and the agent's own repository is left untouched", async () => {
    const { a, s, ws } = await ready();
    writeFileSync(join(ws, "src", "a.ts"), "export const a = 2;\n");   // edit of a committed file
    writeFileSync(join(ws, "fresh.txt"), "brand new\n");              // untracked
    mkdirSync(join(ws, "node_modules")); writeFileSync(join(ws, "node_modules", "skip.js"), "x");
    const before = git(ws, "status", "--porcelain");
    const out = await sessionChanges(a, s.id);
    expect(out.files.map((f) => f.path).sort()).toEqual(["bin.dat", "fresh.txt", "src/a.ts"]);
    expect(out.diff).toContain("+brand new");
    expect(out.diff).toContain("+export const a = 2;");
    expect(out.diff).not.toContain("skip.js");
    expect(git(ws, "status", "--porcelain")).toBe(before);
  });
  test("a credential in an uncommitted file is removed from the diff", async () => {
    const { a, s, ws } = await ready();
    writeFileSync(join(ws, "env.txt"), "key " + "maipai_" + "a1B2".repeat(6) + "\n");
    expect((await sessionChanges(a, s.id)).diff).not.toContain("maipai_a1B2");
  });
  test("a git hook the agent planted does not run while the diff is read", async () => {
    const { a, s, ws } = await ready();
    const mark = join(base, "ran"); mkdirSync(join(ws, ".git", "hooks"), { recursive: true }); writeFileSync(join(ws, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch ${mark}\n`, { mode: 0o755 });
    git(ws, "config", "core.fsmonitor", `touch ${mark}`);
    await sessionChanges(a, s.id);
    expect(await Bun.file(mark).exists()).toBe(false);
  });
  test("a session with no repository has no changes to show", async () => {
    const a = owner(); const s = createCodingSession(a, input());
    expect(await sessionChanges(a, s.id)).toMatchObject({ available: false, files: [] });
  });
  test("another person's session is not found, and Coding off gives the household's copy", async () => {
    const { s } = await ready();
    await expect(sessionChanges(owner(), s.id)).rejects.toThrow("not found");
    setHouseholdSettingValue("coding.enabled", false);
    await expect(sessionChanges(owner(), s.id)).rejects.toThrow("turned off");
  });
});

describe("Files", () => {
  test("the tree leaves out .git and never follows a link", async () => {
    const { a, s, ws } = await ready();
    symlinkSync("/etc", join(ws, "etc-link"));
    const tree = await sessionTree(a, s.id);
    expect(tree.entries.map((e) => e.path)).toEqual(["src", "src/a.ts", "bin.dat", "README.md"]);
  });
  test("a text file reads, with a credential removed", async () => {
    const { a, s, ws } = await ready();
    writeFileSync(join(ws, "note.txt"), "key " + "maipai_" + "a1B2".repeat(6) + "\n");
    const out = await sessionFile(a, s.id, "note.txt");
    expect(out.content).not.toContain("maipai_a1B2");
  });
  test("a binary file, a link, a path outside and an over-size file are refused with a plain line", async () => {
    const { a, s, ws } = await ready();
    symlinkSync("/etc/hosts", join(ws, "hosts-link"));
    writeFileSync(join(ws, "big.txt"), "x".repeat(300 * 1024));
    await expect(sessionFile(a, s.id, "bin.dat")).rejects.toThrow("not text");
    await expect(sessionFile(a, s.id, "hosts-link")).rejects.toThrow("link");
    await expect(sessionFile(a, s.id, "../../x")).rejects.toThrow("leaves the session");
    await expect(sessionFile(a, s.id, "big.txt")).rejects.toThrow("too large");
  });
});

describe("terminal output", () => {
  test("a finished command carries its output into the event, and the stored part is redacted and capped", async () => {
    const { mapOpenCodeEvent } = await import("@/lib/codingOpencode");
    const mapped = mapOpenCodeEvent({ type: "tool_use", part: { tool: "bash", state: { status: "completed", input: { command: "bun test" }, output: "3 pass\n", metadata: { exit: 0 } } } });
    expect(mapped.events[0]).toMatchObject({ kind: "command", command: "bun test", output: "3 pass\n" });
    const { appendCodingMessage, listCodingMessages } = await import("@/lib/codingTranscript");
    const a = owner(); const s = createCodingSession(a, input());
    appendCodingMessage({ sessionId: s.id, personId: a.id, role: "agent", parts: [{ type: "tool", tool: "command", status: "done", summary: "env", exit_code: 0, output: "KEY=" + "maipai_" + "a1B2".repeat(6) }] });
    const part = listCodingMessages(a.id, s.id)[0]!.parts[0] as { output?: string };
    expect(part.output).not.toContain("maipai_a1B2");
  });
});
