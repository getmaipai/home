// CODE-APP-01: what the Code app's Changes and Files tabs read from a session's workspace. Both need Coding access and the session to be the person's own.
// Changes come from a clean copy of the committed branch (lib/gitHost.ts, hooks and filters off); Files go through the link-safe reader (lib/workspaceFs.ts),
// so a link in the workspace never leads outside it. Content is size-capped, a binary file is refused, and credentials are removed from what is shown.
import { codingWorkspace } from "@/lib/codingShare";
import { CodingSessionError, codingSessionRefusal, getSessionRow } from "@/lib/codingSessions";
import { diffBranchAgainstBase, GitHostError, type BranchDiff } from "@/lib/gitHost";
import { listWorkspaceDir, readWorkspaceFile, WorkspacePathError } from "@/lib/workspaceFs";
import { redactCredentials } from "@/lib/codingRedact";
import type { PersonRow } from "@/types";

export const FILE_VIEW_CAP = 256 * 1024;
const TREE_ENTRY_CAP = 1500;
const TREE_DEPTH_CAP = 8;

export interface TreeEntry { path: string; name: string; depth: number; kind: "folder" | "file" }

function owned(person: PersonRow, sessionId: string) {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  const row = getSessionRow(person.id, sessionId);
  if (!row) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  return row;
}

const plain = (e: unknown): never => {
  if (e instanceof WorkspacePathError || e instanceof GitHostError) throw new CodingSessionError("bad_input", e.message);
  throw e;
};

export async function sessionChanges(person: PersonRow, sessionId: string): Promise<BranchDiff & { available: boolean }> {
  const row = owned(person, sessionId);
  const repo = row.repo as { base_branch?: string; work_branch?: string };
  if (!repo.base_branch || !repo.work_branch) return { available: false, files: [], diff: "", truncated: false };
  try {
    const result = await diffBranchAgainstBase({ workspace: codingWorkspace(person.id, sessionId), branch: repo.work_branch, baseBranch: repo.base_branch });
    return result ? { available: true, ...result, diff: redactCredentials(result.diff).text } : { available: false, files: [], diff: "", truncated: false };
  } catch (e) { return plain(e); }
}

export async function sessionTree(person: PersonRow, sessionId: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  owned(person, sessionId);
  const root = codingWorkspace(person.id, sessionId);
  const entries: TreeEntry[] = []; let truncated = false;
  const walk = async (rel: string, depth: number): Promise<void> => {
    const list = (await listWorkspaceDir(root, rel === "" ? "." : rel)).filter((e) => e.name !== ".git" && (e.kind === "file" || e.kind === "dir"))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    for (const e of list) {
      if (entries.length >= TREE_ENTRY_CAP) { truncated = true; return; }
      const at = rel === "" ? e.name : `${rel}/${e.name}`;
      entries.push({ path: at, name: e.name, depth, kind: e.kind === "dir" ? "folder" : "file" });
      if (e.kind === "dir") { if (depth + 1 >= TREE_DEPTH_CAP) truncated = true; else await walk(at, depth + 1); }
    }
  };
  try { await walk("", 0); } catch (e) {
    if (e instanceof WorkspacePathError) return { entries: [], truncated: false };
    return plain(e);
  }
  return { entries, truncated };
}

export async function sessionFile(person: PersonRow, sessionId: string, relative: string): Promise<{ path: string; content: string }> {
  owned(person, sessionId);
  try {
    const buffer = await readWorkspaceFile(codingWorkspace(person.id, sessionId), relative, FILE_VIEW_CAP);
    if (buffer.subarray(0, 8000).includes(0)) throw new CodingSessionError("bad_input", "That file is not text, so Home does not show it here.");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new CodingSessionError("bad_input", "That file is not text, so Home does not show it here."); }
    return { path: relative, content: redactCredentials(text).text };
  } catch (e) { return plain(e); }
}
