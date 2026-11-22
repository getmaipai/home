// CODE-POLISH: adding a file to a session from the composer (the + button or a drop). The file lands in the workspace's `uploads` folder, never anywhere else:
// the name is reduced to a plain file name, the folder is checked as a real folder inside the real workspace (a link is refused), the write opens a new file and
// never replaces one (a taken name gets a number), size and file type are capped, and a text file is scanned for credentials and refused if it holds one.
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { codingWorkspace } from "@/lib/codingShare";
import { CodingSessionError, codingSessionRefusal, getSessionRow } from "@/lib/codingSessions";
import { redactCredentials } from "@/lib/codingRedact";
import { recordCodingEvent } from "@/lib/codingEvents";
import type { PersonRow } from "@/types";

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 50;
const TEXT_TYPES = new Set(["txt", "md", "json", "csv", "tsv", "log", "yml", "yaml", "toml", "ini", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "sh", "sql", "lua", "r", "env.example"]);
const BINARY_TYPES = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf"]);

const plainName = (raw: string): string => {
  const base = path.basename(raw.replace(/\\/g, "/")).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").trim().slice(0, 100);
  return base || "file";
};

export async function uploadToWorkspace(person: PersonRow, sessionId: string, rawName: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }> {
  const refusal = codingSessionRefusal(person);
  if (refusal) throw new CodingSessionError("not_allowed", refusal);
  const row = getSessionRow(person.id, sessionId);
  if (!row) throw new CodingSessionError("not_found", "That session was not found. It may have been deleted.");
  if (bytes.byteLength === 0) throw new CodingSessionError("bad_input", "That file is empty. Choose a file with something in it.");
  if (bytes.byteLength > UPLOAD_MAX_BYTES) throw new CodingSessionError("bad_input", `That file is larger than ${UPLOAD_MAX_BYTES / 1024 / 1024} MB. Choose a smaller file.`);
  const name = plainName(rawName);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const isText = TEXT_TYPES.has(ext) || TEXT_TYPES.has(name.toLowerCase());
  if (!isText && !BINARY_TYPES.has(ext)) throw new CodingSessionError("bad_input", "Home adds text, code, picture and PDF files only. Choose a file of one of those kinds.");
  if (isText) {
    const text = Buffer.from(bytes).toString("utf8");
    if (redactCredentials(text).found > 0) throw new CodingSessionError("bad_input", "That file seems to hold a password or key, so Home did not add it. Remove the secret and try again.");
  }
  const root = codingWorkspace(person.id, sessionId);
  const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo) {
    if ((row.repo as { kind?: string }).kind !== "none") throw new CodingSessionError("bad_input", "The workspace is not ready yet. Send your first message, then add the file.");
    await fs.mkdir(root, { recursive: true });
  } else if (!rootInfo.isDirectory()) throw new CodingSessionError("bad_input", "The session's workspace is not available. Reopen the session and try again.");
  const realRoot = await fs.realpath(root);
  const dir = path.join(realRoot, "uploads");
  const dirInfo = await fs.lstat(dir).catch(() => null);
  if (!dirInfo) await fs.mkdir(dir);
  else if (!dirInfo.isDirectory()) throw new CodingSessionError("bad_input", "The uploads folder in this workspace is a link, so Home did not use it. Remove the link and try again.");
  const realDir = await fs.realpath(dir);
  if (path.dirname(realDir) !== realRoot) throw new CodingSessionError("bad_input", "The uploads folder leaves the workspace, so Home did not use it.");
  if ((await fs.readdir(realDir)).length >= UPLOAD_MAX_FILES) throw new CodingSessionError("bad_input", `This session already has ${UPLOAD_MAX_FILES} uploaded files. Delete some or start a new session.`);
  const dot = name.lastIndexOf(".");
  for (let n = 0; n < 100; n++) {
    const candidate = n === 0 ? name : dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
    try {
      const handle = await fs.open(path.join(realDir, candidate), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      recordCodingEvent({ sessionId, personId: person.id, kind: "file_write", detail: { path: `uploads/${candidate}` } });
      return { path: `uploads/${candidate}`, bytes: bytes.byteLength };
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  throw new CodingSessionError("bad_input", "Home could not find a free name for that file. Rename it and try again.");
}
