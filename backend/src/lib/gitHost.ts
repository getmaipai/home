// CODE-GIT-01 and CODE-GIT-02: host-side git for Code sessions. The sandbox never holds a git credential and the hub never runs git inside a
// session's folder as the agent left it (its hooks, fsmonitor, filters and config are the agent's to write). So:
//   clone: the hub clones into the workspace before the agent starts;
//   push: the hub copies the committed branch into a fresh repository of its own (clean copy), scans it, and pushes from there.
// Every git child runs with hooks off, no file monitor, no filters or LFS smudge, no system or global config, a scrubbed environment and
// the token supplied by a credential helper that reads it from the CHILD'S ENVIRONMENT, never from a command line (CREDENTIALS.md).
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { markGitConnectionFailing, type GitCredential } from "@/lib/gitConnections";

export class GitHostError extends Error {}

const SAFE_PATH = "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const BRANCH_PATTERN = /^maipai\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,3}$/;
const LOCAL_MS = 60_000;
const NETWORK_MS = 300_000;
const OUTPUT_CAP = 1_048_576;

let allowFileForTests = false;
/** Tests only: lets the clone and push steps use a local bare repository (a path) instead of https. Production never calls it. */
export function __allowFileRemotesForTests(on: boolean): void { allowFileForTests = on; }

let observer: ((args: string[], env: Record<string, string>) => void) | null = null;
/** Tests only: sees every git child's arguments and environment, to prove a token never reaches a command line. */
export function __observeGitForTests(fn: ((args: string[], env: Record<string, string>) => void) | null): void { observer = fn; }

export interface GitRun { code: number; stdout: string; stderr: string }
interface RunOptions { cwd?: string; token?: string; credentialHost?: string; credentialUser?: string; timeoutMs?: number; allowFile?: boolean; extraConfig?: [string, string][]; }

/** Answers only for the connection's own host over https (git sends `protocol=` and `host=` on the helper's stdin), so a redirect or a changed remote never receives the token. */
export const CREDENTIAL_HELPER = `!f() { test "$1" = get || exit 0; req=$(cat); printf '%s\\n' "$req" | grep -Fxq "protocol=https" || exit 0; printf '%s\\n' "$req" | grep -Fxq "host=$MAIPAI_GIT_HOST" || exit 0; echo "username=$MAIPAI_GIT_USER"; echo "password=$MAIPAI_GIT_TOKEN"; }; f`;

/** The fixed protections every git child gets. Exported so a test can assert exactly what runs. */
export function gitChildConfig(options: { token?: boolean; allowFile?: boolean; extraConfig?: [string, string][] } = {}): [string, string][] {
  const config: [string, string][] = [
    ["core.hooksPath", "/dev/null"],
    ["core.fsmonitor", "false"],
    ["core.attributesFile", "/dev/null"],
    ["core.pager", "cat"],
    ["core.sshCommand", "/usr/bin/false"],
    ["protocol.allow", "never"],
    ["protocol.https.allow", "always"],
    ["protocol.file.allow", options.allowFile ? "always" : "never"],
    ["filter.lfs.smudge", ""], ["filter.lfs.process", ""], ["filter.lfs.clean", ""], ["filter.lfs.required", "false"],
    ["transfer.fsckObjects", "true"], ["transfer.unpackLimit", "1"], ["fetch.unpackLimit", "1"], // keep fetched objects as one pack: its size is the size
    ["http.followRedirects", "false"],
    ["submodule.recurse", "false"],
    ["credential.helper", ""], // resets any inherited helper
  ];
  if (options.token) config.push(["credential.helper", CREDENTIAL_HELPER]);
  return [...config, ...(options.extraConfig ?? [])];
}

/** The scrubbed child environment. Nothing of the hub's own environment is passed on; the token appears only as MAIPAI_GIT_TOKEN for the helper. */
export function gitChildEnv(home: string, config: [string, string][], secret?: { user: string; token: string; host: string }, allowFile = false): Record<string, string> {
  const env: Record<string, string> = {
    PATH: SAFE_PATH, HOME: home, XDG_CONFIG_HOME: home, LANG: "C", LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false", SSH_ASKPASS: "/usr/bin/false", GIT_LFS_SKIP_SMUDGE: "1",
    GIT_OPTIONAL_LOCKS: "0", GIT_ALLOW_PROTOCOL: allowFile ? "https:file" : "https", GIT_EXTERNAL_DIFF: "/usr/bin/false",
    GIT_CONFIG_COUNT: String(config.length),
  };
  config.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  if (secret) { env.MAIPAI_GIT_USER = secret.user; env.MAIPAI_GIT_HOST = secret.host; env.MAIPAI_GIT_TOKEN = secret.token; }
  return env;
}

function scrub(text: string, token?: string): string {
  return token ? text.split(token).join("***") : text;
}

async function runGit(args: string[], options: RunOptions = {}): Promise<GitRun> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "maipai-git-home-"));
  const config = gitChildConfig({ token: Boolean(options.token), allowFile: options.allowFile ?? false, extraConfig: options.extraConfig ?? [] });
  const env = gitChildEnv(home, config, options.token ? { user: options.credentialUser ?? "x-access-token", token: options.token, host: options.credentialHost ?? "" } : undefined, options.allowFile ?? false);
  observer?.(args, env);
  try {
    return await new Promise<GitRun>((resolve, reject) => {
      const child = spawn("git", args, { cwd: options.cwd ?? home, env, stdio: ["ignore", "pipe", "pipe"], timeout: options.timeoutMs ?? LOCAL_MS, killSignal: "SIGKILL" });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (d: Buffer) => { if (stdout.length < OUTPUT_CAP) stdout += d.toString("utf8"); });
      child.stderr.on("data", (d: Buffer) => { if (stderr.length < OUTPUT_CAP) stderr += d.toString("utf8"); });
      child.on("error", () => reject(new GitHostError("Git could not start on this computer. Check that git is installed, then try again.")));
      child.on("close", (code, signal) => resolve({ code: signal ? 124 : code ?? 1, stdout: scrub(stdout, options.token), stderr: scrub(stderr, options.token) }));
    });
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}

function validName(value: string, what: string): string {
  if (!NAME_PATTERN.test(value) || value === "." || value === ".." || value.endsWith(".lock")) throw new GitHostError(`The ${what} name is not valid. Use letters, numbers, dots, dashes and underscores, then try again.`);
  return value;
}
/** The https address of a repository on the connection's own host; the token only ever goes there. */
export function remoteUrlFor(credential: Pick<GitCredential, "host">, owner: string, repo: string): string {
  return `https://${credential.host}/${validName(owner, "owner")}/${validName(repo.replace(/\.git$/, ""), "repository")}.git`;
}
function resolveRemote(credential: GitCredential, remote: { owner: string; repo: string } | { url: string }): string {
  if ("url" in remote) {
    if (!allowFileForTests) throw new GitHostError("Home only pushes to the connected host's own https address. Choose the repository from the list and try again.");
    return remote.url;
  }
  return remoteUrlFor(credential, remote.owner, remote.repo);
}
function userFor(credential: GitCredential): string { return credential.kind === "github" ? "x-access-token" : credential.account; }

export const SUBMODULE_REFUSAL = "This repository uses submodules, which Code sessions do not support yet. Remove the submodules or use a repository without them.";
export const ATTRIBUTES_TOO_BIG = "A .gitattributes file in this repository is too large for Home to check. Shorten it to under 256 KB or use a repository without it.";
/** Largest .gitattributes Home reads whole; a bigger one is refused rather than half-read. */
export const ATTRIBUTES_LIMIT = 256 * 1024;
export const LFS_REFUSAL = "This repository uses Git LFS (large file storage), which Code sessions do not support yet. Use a repository that stores its files directly.";

/** Reads the tree of `ref` in a repository the hub owns and refuses submodules and LFS attributes. */
export async function scanTree(repoDir: string, ref: string): Promise<void> {
  const listed = await runGit(["ls-tree", "-r", "-z", "--full-tree", ref], { cwd: repoDir });
  if (listed.code !== 0) throw new GitHostError("Home could not read the committed files. Make a commit on the session's branch and try again.");
  for (const entry of listed.stdout.split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    const [mode, , sha] = entry.slice(0, tab).split(" ");
    const name = path.posix.basename(entry.slice(tab + 1));
    if (mode === "160000" || name === ".gitmodules") throw new GitHostError(SUBMODULE_REFUSAL);
    if (name === ".gitattributes" && sha) {
      const size = await runGit(["cat-file", "-s", sha], { cwd: repoDir });
      if (size.code !== 0 || !(Number(size.stdout.trim()) <= ATTRIBUTES_LIMIT)) throw new GitHostError(ATTRIBUTES_TOO_BIG);
      const blob = await runGit(["cat-file", "blob", sha], { cwd: repoDir });
      if (blob.code !== 0) throw new GitHostError(ATTRIBUTES_TOO_BIG);
      if (/(^|\s)filter\s*=\s*lfs(\s|$)/m.test(blob.stdout)) throw new GitHostError(LFS_REFUSAL);
    }
  }
}

export interface CloneInput { personId: string; credential: GitCredential; owner: string; repo: string; destination: string; sessionBranch: string; remote?: { url: string } }
/** Clones into `destination` (which must not exist) with no checkout, scans the tree, checks it out and starts the session's own branch. Returns the base branch's name. */
export async function cloneIntoWorkspace(input: CloneInput): Promise<{ baseBranch: string }> {
  if (!BRANCH_PATTERN.test(input.sessionBranch) || input.sessionBranch.includes("..") || input.sessionBranch.endsWith(".lock")) throw new GitHostError("The session's branch name is not valid. It must start with maipai/ and use letters, numbers, dots, dashes and underscores.");
  const url = resolveRemote(input.credential, input.remote ?? { owner: input.owner, repo: input.repo });
  const file = allowFileForTests;
  if (await fs.lstat(input.destination).then(() => true, () => false)) throw new GitHostError("The session's workspace folder already exists. Start a new session instead.");
  await fs.mkdir(path.dirname(input.destination), { recursive: true });
  const common = { token: input.credential.token, credentialUser: userFor(input.credential), credentialHost: input.credential.host, allowFile: file };
  const cloned = await runGit(["clone", "--no-checkout", "--no-tags", "--no-recurse-submodules", "--template=", "--", url, input.destination], { ...common, timeoutMs: NETWORK_MS });
  try {
    if (cloned.code !== 0) throw failure(input.personId, input.credential, cloned.stderr, "clone");
    await scanTree(input.destination, "HEAD");
    const head = await runGit(["symbolic-ref", "--short", "HEAD"], { cwd: input.destination });
    const baseBranch = head.stdout.trim();
    if (head.code !== 0 || !baseBranch) throw new GitHostError("That repository has no branch to start from. Make a first commit on the host and try again.");
    const checkout = await runGit(["checkout", "-q", "-b", input.sessionBranch], { cwd: input.destination });
    if (checkout.code !== 0) throw new GitHostError("Home could not open the repository's files. Try again.");
    return { baseBranch };
  } catch (e) {
    await fs.rm(input.destination, { recursive: true, force: true });
    throw e;
  }
}

function failure(personId: string, credential: GitCredential, stderr: string, what: "clone" | "push"): GitHostError {
  if (/authentication failed|invalid credentials|401|403|denied|permission|could not read username|not authorized/i.test(stderr)) {
    markGitConnectionFailing(personId, credential.id);
    return new GitHostError(`The host refused the ${what}. The token may have expired or may not cover this repository: replace the connection in Settings, Coding, then try again.`);
  }
  if (/non-fast-forward|\[rejected\]|fetch first|stale info/i.test(stderr)) return new GitHostError("The host already has newer changes on that branch, so Home did not overwrite them. Pull the branch, resolve the difference and try again.");
  if (/not found|does not exist|repository .* not found/i.test(stderr)) return new GitHostError("The host does not have that repository. Check the name and that your token covers it, then try again.");
  return new GitHostError(`The ${what} did not finish. Check your connection to the host and try again.`);
}

export const DEFAULT_MAX_REPO_BYTES = 500 * 1024 * 1024;
let maxRepoBytes = DEFAULT_MAX_REPO_BYTES;
/** The most a workspace's repository (and the hub's copy of it) may hold. Default 500 MB. */
export function setMaxRepoBytes(bytes: number): void { maxRepoBytes = bytes > 0 ? bytes : DEFAULT_MAX_REPO_BYTES; }

const MAX_ENTRIES = 300_000;
/** Walks a workspace's `.git` without following anything and refuses what the agent could use to make the hub read elsewhere or fill the disk: an alternates file,
 * any link, or more than `limit` bytes. Returns the total size. */
export async function inspectWorkspaceGit(gitDir: string, limit = maxRepoBytes): Promise<number> {
  for (const name of ["alternates", "http-alternates"]) {
    if (await fs.lstat(path.join(gitDir, "objects", "info", name)).then(() => true, () => false)) throw new GitHostError(`The workspace's repository points at objects stored elsewhere (objects/info/${name}). Home will not push from it: copy the work into a fresh clone and try again.`);
  }
  let total = 0; let entries = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (++entries > MAX_ENTRIES) throw new GitHostError("The workspace's repository holds too many files for Home to push. Start a new session from a clean clone and try again.");
      if (entry.isSymbolicLink()) throw new GitHostError(`The workspace's repository contains a link (${path.relative(gitDir, full)}), which Home will not follow. Remove the link or start a new session from a clean clone, then try again.`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { total += (await fs.lstat(full)).size; if (total > limit) throw new GitHostError("The workspace's repository is larger than Home will push. Remove large files from the branch's history or start a new session, then try again."); }
    }
  };
  await walk(gitDir);
  return total;
}
async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirBytes(full) : entry.isFile() ? (await fs.lstat(full)).size : 0;
  }
  return total;
}

export interface PushInput { personId: string; credential: GitCredential; owner: string; repo: string; workspace: string; branch: string; baseBranch: string; remote?: { url: string };
  /** CODE-AGENT-01: the secret check's hook point. Runs on the hub's clean copy of the branch after the tree scan and before the network push; it throws to stop the push. */
  beforePush?: (copyDir: string, branch: string) => Promise<void> }

/** Pushes the session's own `maipai/...` branch, from a clean copy the hub makes of the committed branch. No force, no delete, no tag, never the base branch. */
export async function pushSessionBranch(input: PushInput): Promise<void> {
  const { branch, baseBranch } = input;
  if ((input as unknown as { force?: unknown }).force) throw new GitHostError("Home never force-pushes. Push normally, or ask the host owner to change the branch.");
  if (!BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.endsWith(".lock") || branch.endsWith(".")) throw new GitHostError("Home only pushes the session's own branch, which starts with maipai/. Choose that branch and try again.");
  if (branch === baseBranch || branch.toLowerCase() === `refs/heads/${baseBranch}`.toLowerCase()) throw new GitHostError("Home never pushes to the repository's main branch. Push the session's own maipai/ branch and open a pull request.");
  const url = resolveRemote(input.credential, input.remote ?? { owner: input.owner, repo: input.repo });
  const git = path.join(input.workspace, ".git");
  const info = await fs.lstat(git).catch(() => null);
  if (!info || !info.isDirectory()) throw new GitHostError("This workspace has no repository Home can push from. Start a new session from a repository and try again.");
  const file = allowFileForTests;
  await inspectWorkspaceGit(git);
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "maipai-push-"));
  try {
    const init = await runGit(["init", "--quiet", "--template=", copy]);
    if (init.code !== 0) throw new GitHostError("Home could not prepare the push. Try again.");
    // The only step that reads the workspace's repository: objects of one branch, over the local transport, with the clean repository's own settings.
    const fetched = await runGit(["fetch", "--quiet", "--no-tags", "--no-recurse-submodules", git, `refs/heads/${branch}:refs/heads/${branch}`],
      { cwd: copy, allowFile: true, extraConfig: [["safe.directory", "*"]] });
    if (fetched.code !== 0) throw new GitHostError("The session's branch has no commits to push. Commit your changes on the session's branch and try again.");
    if (await dirBytes(copy) > maxRepoBytes) throw new GitHostError("The branch is larger than Home will push. Remove large files from the branch and try again.");
    await scanTree(copy, `refs/heads/${branch}`);
    await input.beforePush?.(copy, branch);
    const pushed = await runGit(["push", "--porcelain", "--no-verify", url, `refs/heads/${branch}:refs/heads/${branch}`],
      { cwd: copy, token: input.credential.token, credentialUser: userFor(input.credential), credentialHost: input.credential.host, allowFile: file, timeoutMs: NETWORK_MS });
    if (pushed.code !== 0) throw failure(input.personId, input.credential, `${pushed.stderr}\n${pushed.stdout}`, "push");
  } finally { await fs.rm(copy, { recursive: true, force: true }); }
}

/** CODE-APP-01: the Changes tab: what a person reviews before Push. The diff is the session's base branch against the workspace as it is now, uncommitted edits and new files
 * included, computed in a clean copy the hub makes (the base's objects fetched from the workspace's repository, the working files copied without any `.git`, links, `node_modules`
 * or oversized files; hooks, filters, monitors and the folder's own settings off; no textconv or external diff). The agent's own `.git` is never written to or run. Output is
 * capped; a binary file shows in the list without a body. */
export interface BranchDiff { files: { path: string; additions: number; deletions: number; binary: boolean }[]; diff: string; truncated: boolean }
export const DIFF_BODY_CAP = 200 * 1024;
const COPY_MAX_FILE = 1024 * 1024;
const COPY_MAX_TOTAL = 64 * 1024 * 1024;
const COPY_MAX_ENTRIES = 20_000;
const SKIP_DIRS = new Set([".git", "node_modules"]);

async function copyWorkingFiles(from: string, to: string): Promise<void> {
  let total = 0; let entries = 0;
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(from, rel), { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
      if (++entries > COPY_MAX_ENTRIES) throw new GitHostError("The workspace holds too many files for Home to compare. Remove generated files and try again.");
      const at = path.join(rel, entry.name);
      if (entry.isDirectory()) { await fs.mkdir(path.join(to, at), { recursive: true }); await walk(at); continue; }
      if (!entry.isFile()) continue;
      const info = await fs.lstat(path.join(from, at));
      if (info.size > COPY_MAX_FILE) continue;
      total += info.size;
      if (total > COPY_MAX_TOTAL) throw new GitHostError("The workspace is larger than Home will compare. Remove generated files and try again.");
      await fs.copyFile(path.join(from, at), path.join(to, at));
    }
  };
  await walk("");
}

export async function diffBranchAgainstBase(input: { workspace: string; branch: string; baseBranch: string }): Promise<BranchDiff | null> {
  const { branch, baseBranch } = input;
  if (!BRANCH_PATTERN.test(branch) || branch.includes("..") || /[\s~^:?*\[\\]/.test(baseBranch) || baseBranch.includes("..") || baseBranch.startsWith("-")) return null;
  const git = path.join(input.workspace, ".git");
  const info = await fs.lstat(git).catch(() => null);
  if (!info || !info.isDirectory()) return null;
  await inspectWorkspaceGit(git);
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "maipai-diff-"));
  try {
    if ((await runGit(["init", "--quiet", "--template=", copy])).code !== 0) throw new GitHostError("Home could not read the changes. Try again.");
    const fetched = await runGit(["fetch", "--quiet", "--no-tags", "--no-recurse-submodules", git, `refs/heads/${baseBranch}:refs/heads/base`], { cwd: copy, allowFile: true, extraConfig: [["safe.directory", "*"]] });
    if (fetched.code !== 0) return { files: [], diff: "", truncated: false };
    if ((await runGit(["read-tree", "refs/heads/base"], { cwd: copy })).code !== 0) return { files: [], diff: "", truncated: false };
    await copyWorkingFiles(input.workspace, copy);
    // Only in the copy: stage everything (new files, edits and deletions) so the index equals the workspace as it is now.
    if ((await runGit(["add", "-A", "--force", "--", "."], { cwd: copy })).code !== 0) throw new GitHostError("Home could not read the changes. Try again.");
    const flags = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--cached"];
    const stat = await runGit(["diff", ...flags, "--numstat", "refs/heads/base"], { cwd: copy });
    const files = stat.stdout.split("\n").filter(Boolean).slice(0, 2000).map((line) => {
      const [add, del, ...rest] = line.split("\t");
      return { path: rest.join("\t"), additions: Number(add) || 0, deletions: Number(del) || 0, binary: add === "-" };
    });
    const body = await runGit(["diff", ...flags, "-U3", "refs/heads/base"], { cwd: copy });
    const truncated = body.stdout.length > DIFF_BODY_CAP;
    return { files, diff: truncated ? body.stdout.slice(0, DIFF_BODY_CAP) : body.stdout, truncated };
  } finally { await fs.rm(copy, { recursive: true, force: true }); }
}
