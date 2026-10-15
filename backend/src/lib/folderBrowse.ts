// WIZ-STORAGE-02: the folder listing behind the setup wizard's folder picker.
// Lists SUBFOLDERS only (never a file name) of a directory on the machine Home
// runs on. Every path is resolved through realpath before it is answered, so a
// symlink can never carry a person into a folder this file would refuse.
import { accessSync, constants, mkdirSync, readdirSync, realpathSync, statfsSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { repoRoot } from "./paths";

export type FolderRow = { name: string; path: string; writable: boolean };
export type FolderListing = {
  path: string;
  parent: string | null;
  freeBytes: number | null;
  writable: boolean;
  folders: FolderRow[];
};
export type FolderResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const POSIX_SYSTEM_ROOTS = ["/System", "/proc", "/sys", "/dev", "/etc", "/bin", "/sbin", "/usr", "/boot", "/lib", "/lib64", "/private/etc"];
const WINDOWS_SYSTEM_ROOTS = ["Windows", "Program Files", "Program Files (x86)", "ProgramData", "$Recycle.Bin", "System Volume Information"];

function samePathOrInside(path: string, root: string): boolean {
  const a = process.platform === "win32" ? path.toLowerCase() : path;
  const b = process.platform === "win32" ? root.toLowerCase() : root;
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

function realpathOrSelf(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

/** Why a (real, absolute) path may not be offered, or null when it may. */
export function refusedReason(realPath: string): string | null {
  if (process.platform === "win32") {
    const m = /^([A-Za-z]:)[\\/]([^\\/]+)/.exec(realPath);
    if (m && WINDOWS_SYSTEM_ROOTS.some((name) => name.toLowerCase() === m[2]!.toLowerCase())) {
      return "That is a system folder. Pick a folder of your own, such as one in your user folder or on another drive.";
    }
  } else if (POSIX_SYSTEM_ROOTS.some((root) => samePathOrInside(realPath, root))) {
    return "That is a system folder. Pick a folder of your own, such as one in your home folder or on another drive.";
  }
  if (samePathOrInside(realPath, realpathOrSelf(repoRoot))) {
    return "That folder holds MaiPai Home's own program files. Pick a different folder, such as one in your home folder or on another drive.";
  }
  return null;
}

function isWritable(path: string): boolean {
  try { accessSync(path, constants.W_OK | constants.X_OK); return true; } catch { return false; }
}

function freeBytesOf(path: string): number | null {
  try { const s = statfsSync(path); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

const NOT_FOUND = "That folder is not there any more. Go up a level and pick another folder.";

/** Validate and resolve a requested path to a real, allowed directory. */
export function resolveFolder(requested: string | undefined): FolderResult<string> {
  const raw = requested === undefined || requested === "" ? homedir() : requested;
  if (raw.includes("\0")) return { ok: false, status: 400, error: "That folder path is not valid. Pick a folder from the list instead." };
  if (!isAbsolute(raw)) return { ok: false, status: 400, error: "The folder path must start from the top of a drive, such as /Users/you. Pick a folder from the list instead." };
  if (raw.split(/[\\/]+/).includes("..")) return { ok: false, status: 400, error: "A folder path cannot contain \"..\". Use the Up button to go to the folder above." };
  let real: string;
  try { real = realpathSync(resolve(raw)); } catch { return { ok: false, status: 404, error: NOT_FOUND }; }
  try { if (!statSync(real).isDirectory()) return { ok: false, status: 400, error: "That is a file, not a folder. Pick a folder from the list." }; }
  catch { return { ok: false, status: 404, error: NOT_FOUND }; }
  const refusal = refusedReason(real);
  if (refusal) return { ok: false, status: 403, error: refusal };
  return { ok: true, value: real };
}

export function listFolder(requested: string | undefined): FolderResult<FolderListing> {
  const resolved = resolveFolder(requested);
  if (!resolved.ok) return resolved;
  const path = resolved.value;
  let entries: Dirent[];
  try { entries = readdirSync(path, { withFileTypes: true }); }
  catch { return { ok: false, status: 403, error: "MaiPai cannot open that folder. Pick another folder, or fix its permissions and try again." }; }
  const folders: FolderRow[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    let real: string;
    try {
      real = realpathSync(join(path, entry.name));
      if (!statSync(real).isDirectory()) continue;
    } catch { continue; }
    if (refusedReason(real)) continue;
    folders.push({ name: entry.name, path: real, writable: isWritable(real) });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  const up = dirname(path);
  const parent = up === path || refusedReason(realpathOrSelf(up)) ? null : realpathOrSelf(up);
  return { ok: true, value: { path, parent, freeBytes: freeBytesOf(path), writable: isWritable(path), folders } };
}

const NAME_HELP = "Use a name of up to 100 letters or numbers, without slashes, and try again.";

export function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return `A new folder needs a name. ${NAME_HELP}`;
  if (trimmed.length > 100) return `That folder name is too long. ${NAME_HELP}`;
  if (/[\\/:\0]/.test(trimmed) || trimmed.includes("..")) return `That folder name has characters a folder name cannot have. ${NAME_HELP}`;
  if (trimmed.startsWith(".")) return `A folder name cannot start with a dot, because the folder would be hidden. ${NAME_HELP}`;
  return null;
}

export function createFolder(parent: string, name: string): FolderResult<FolderRow> {
  const nameProblem = validateFolderName(name);
  if (nameProblem) return { ok: false, status: 400, error: nameProblem };
  const resolved = resolveFolder(parent);
  if (!resolved.ok) return resolved;
  if (!isWritable(resolved.value)) return { ok: false, status: 403, error: "That folder is read-only. Pick another folder, or fix its permissions and try again." };
  const target = join(resolved.value, name.trim());
  try { mkdirSync(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, status: 409, error: "A folder with that name already exists here. Pick a different name, or open the existing folder." };
    return { ok: false, status: 403, error: "MaiPai could not create that folder. Pick another location, or fix the folder's permissions and try again." };
  }
  return { ok: true, value: { name: name.trim(), path: realpathOrSelf(target), writable: true } };
}

/** A proposed class folder for the placement check: absolute, no "..". */
export function validateProposedPath(path: string): string | null {
  if (!path || path.includes("\0") || !isAbsolute(path) || path.split(/[\\/]+/).includes("..")) {
    return "Folder paths must be full paths without \"..\". Pick the folder again from the list.";
  }
  return null;
}
