// CODE-AGENT-01 (slice two): the two ways a session's work leaves the house, Push and pull request, and the secret check in front of both
// (design local-coding section 8: gitleaks over the diff, blocks with path and line). Only the person starts either: the route that calls this is their
// click, and the brake never lets the agent act on these effects. The scanner is a hook point: the real gitleaks run is wired later through
// `setSecretScanner`. Until one is wired both fail closed, so nothing leaves unchecked. Findings carry a path and a line, never the value.
import path from "node:path";
import { dataDir } from "@/lib/paths";
import { gitCredentialFor } from "@/lib/gitConnections";
import { pushSessionBranch, GitHostError } from "@/lib/gitHost";
import { recordCodingEvent } from "@/lib/codingEvents";
import { CodingSessionError, codingSessionRefusal, getSessionRow } from "@/lib/codingSessions";
import { appendLogLine } from "@/lib/log";
import type { PersonRow } from "@/types";

export interface SecretFinding { path: string; line: number }
/** Scans the tree of `ref` in `dir` and returns what it found. The gitleaks adapter is one implementation; tests use fakes. */
export type SecretScanner = (input: { dir: string; ref: string }) => Promise<SecretFinding[]>;
let scanner: SecretScanner | null = null;
export function setSecretScanner(next: SecretScanner | null): void { scanner = next; }

/** The hub-side workspace of a session (design 3.4): the only folder the agent sees. */
let workspaceRoot: string = path.join(dataDir, "coding");
export function __setWorkspaceRootForTests(root: string | null): void { workspaceRoot = root ?? path.join(dataDir, "coding"); }
export const codingWorkspace = (personId: string, sessionId: string): string => path.join(workspaceRoot, personId, sessionId, "work");

let remoteForTests: { url: string } | null = null;
export function __setShareRemoteForTests(remote: { url: string } | null): void { remoteForTests = remote; }

/** The one check in front of Push and pull request. Throws with a plain line and records `secret_found` lines (path, line) in the person's trail. */
export async function checkSecretsBeforeShare(input: { personId: string; sessionId: string; dir: string; ref: string; action: "push" | "pull_request" }): Promise<void> {
  if (!scanner) throw new CodingSessionError("not_allowed", "The secret check is not installed yet, so Home will not push or open a pull request. Ask an admin to finish the Coding setup in Settings.");
  const found = await scanner({ dir: input.dir, ref: input.ref });
  for (const f of found) recordCodingEvent({ sessionId: input.sessionId, personId: input.personId, kind: "secret_found", detail: { path: f.path, line: f.line } });
  if (found.length > 0) {
    appendLogLine(`coding secret_blocked session=${input.sessionId} action=${input.action} findings=${found.length}`);
    const first = found[0]!;
    throw new CodingSessionError("bad_input", `The secret check found ${found.length === 1 ? "a secret" : `${found.length} secrets`} in your changes, first at ${first.path} line ${first.line}. Remove ${found.length === 1 ? "it" : "them"}, commit, and push again.`);
  }
}

/** The person's click on Push: the session's own branch to the connected host, after the secret check. Never the base branch, never forced (lib/gitHost.ts). */
export async function pushCodingSession(person: PersonRow, sessionId: string, confirm: boolean): Promise<void> {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  const row = getSessionRow(person.id, sessionId);
  if (!row) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  if (!confirm) throw new CodingSessionError("bad_input", "Push needs your confirmation. Check the changes, then confirm the push.");
  const repo = row.repo as { kind?: string; connection_id?: string; full_name?: string; base_branch?: string; work_branch?: string };
  if ((repo.kind !== "github" && repo.kind !== "gitea") || !repo.connection_id || !repo.full_name || !repo.base_branch || !repo.work_branch) {
    throw new CodingSessionError("bad_input", "This session has no git repository to push to. Start a session from a GitHub or Gitea repository.");
  }
  const credential = gitCredentialFor(person.id, repo.connection_id);
  if (!credential) throw new CodingSessionError("bad_input", "The git connection for this session is not available. Reconnect it in Settings, Coding, then push again.");
  const [owner, name] = repo.full_name.split("/");
  if (!owner || !name) throw new CodingSessionError("bad_input", "This session's repository name is not valid. Start a new session from the repository.");
  try {
    await pushSessionBranch({
      personId: person.id, credential, owner, repo: name, workspace: codingWorkspace(person.id, sessionId), branch: repo.work_branch, baseBranch: repo.base_branch,
      ...(remoteForTests ? { remote: remoteForTests } : {}),
      beforePush: (dir, branch) => checkSecretsBeforeShare({ personId: person.id, sessionId, dir, ref: `refs/heads/${branch}`, action: "push" }),
    });
  } catch (e) {
    if (e instanceof GitHostError) throw new CodingSessionError("bad_input", e.message);
    throw e;
  }
  recordCodingEvent({ sessionId, personId: person.id, kind: "push", detail: { branch: repo.work_branch } });
  appendLogLine(`coding pushed session=${sessionId} person=${person.id}`);
}
