// CODE-GIT-02: hub code that reads a Code session's workspace never follows a link out of it. The workspace is written by the agent, so any
// path in it may be a symbolic link to a file the hub can read and the person should not (a key, the database). Every read resolves the real
// path, checks it stays inside the real workspace root, and opens the final component without following a link.
import { constants, promises as fs } from "node:fs";
import path from "node:path";

export class WorkspacePathError extends Error {}

const OUTSIDE = "That path leaves the session's workspace, so Home did not read it. Use a path inside the workspace.";

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The real path of `relative` inside `root`, or a WorkspacePathError. The final component must not be a link (a link to a file inside the workspace is refused too: the agent chose it). */
export async function resolveInsideWorkspace(root: string, relative: string): Promise<string> {
  if (typeof relative !== "string" || relative.includes("\0") || path.isAbsolute(relative)) throw new WorkspacePathError(OUTSIDE);
  const realRoot = await fs.realpath(root).catch(() => { throw new WorkspacePathError("The session's workspace is not available. Reopen the session and try again."); });
  const lexical = path.resolve(realRoot, relative);
  if (!inside(realRoot, lexical)) throw new WorkspacePathError(OUTSIDE);
  const info = await fs.lstat(lexical).catch(() => null);
  if (!info) throw new WorkspacePathError("That file is not in the workspace. Check the path and try again.");
  if (info.isSymbolicLink()) throw new WorkspacePathError("That path is a link, and Home does not follow links in a workspace. Open the real file instead.");
  const real = await fs.realpath(lexical).catch(() => { throw new WorkspacePathError(OUTSIDE); });
  if (!inside(realRoot, real)) throw new WorkspacePathError(OUTSIDE);
  return real;
}

/** Reads a regular file inside the workspace, at most `maxBytes`. O_NOFOLLOW closes the gap between the check and the open. */
export async function readWorkspaceFile(root: string, relative: string, maxBytes = 1_048_576): Promise<Buffer> {
  const real = await resolveInsideWorkspace(root, relative);
  const handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new WorkspacePathError("That path is a link, and Home does not follow links in a workspace. Open the real file instead."); });
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new WorkspacePathError("That path is not a file. Choose a file inside the workspace.");
    if (info.size > maxBytes) throw new WorkspacePathError("That file is too large to open here. Choose a smaller file.");
    return await handle.readFile();
  } finally { await handle.close(); }
}

/** Lists a directory inside the workspace (names only); entries that are links are marked and never followed. */
export async function listWorkspaceDir(root: string, relative = "."): Promise<{ name: string; kind: "file" | "dir" | "link" | "other" }[]> {
  const realRoot = await fs.realpath(root).catch(() => { throw new WorkspacePathError("The session's workspace is not available. Reopen the session and try again."); });
  const dir = relative === "." || relative === "" ? realRoot : await resolveInsideWorkspace(root, relative);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, kind: e.isSymbolicLink() ? "link" as const : e.isDirectory() ? "dir" as const : e.isFile() ? "file" as const : "other" as const }));
}
