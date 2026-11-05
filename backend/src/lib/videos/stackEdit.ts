// VIDEO-CHAT-01 (C3, C4): Home's call to the Stack's `media.edit` job (trim, concat, mute, frame, audio_overlay, fade; the Stack's
// backend/src/media/editOps.ts and docs/integrations.md). The Stack reads its inputs from paths, so Home stages each clip or sound it needs in
// one job folder under its own data directory (declared to the Stack as a read and write media root, the way the companion clips are),
// submits the job, polls it with a deadline, reads the finished file back and deletes the folder, whatever happened. Only the local Stack
// is called; no file name, clip or line a person typed is logged or put in an error. A failure is one plain line, never a thrown error.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { dataDir } from "@/lib/paths";
import { newFileId } from "@/lib/id";
import { getStackClient, isRemoteStackSelected, isStackConfigured } from "@/lib/stackEngine";

/** The steps `media.edit` takes, as the Stack's own input schema names them (the ones Home uses). */
export type EditOp =
  | { op: "trim"; in_s: number; out_s: number }
  | { op: "concat"; with?: number[] }
  | { op: "mute" }
  | { op: "audio_overlay"; input: number; gain_db: number; clip_gain_db: number; start_s: number; duck: boolean; loudness_lufs?: number; fade_in_s?: number; fade_out_s?: number; end_s?: number }
  /** VIDEO-STUDIO-06 (Stack a23ac89): the level of the clip's own sound, in dB (-60 to 24); a clip with no sound fails with `bad_input`. */
  | { op: "gain"; db: number }
  | { op: "fade"; in_s: number; out_s: number }
  /** A picture of one moment of the clip (the Stack's `frame` op); it ends the edit and the output name ends in .png. */
  | { op: "frame"; at_s: number }
  /** On the Stack since a23ac89 (2026-11-02): join the working clip and the later files, blending each seam over `duration_s` (0.3 to 1.0, up to 6 clips). */
  | { op: "crossfade"; duration_s: number; with?: number[] }
  | { op: "transition"; kind: "fade" | "dissolve" | "wipeleft" | "wiperight" | "wipeup" | "wipedown" | "slideleft" | "slideright" | "slideup" | "slidedown" | "circleopen" | "circleclose" | "radial" | "smoothleft" | "smoothright" | "fadeblack" | "fadewhite" | "zoomin" | "pixelize"; duration_s: number; with?: number[] }
  | { op: "title_card"; text: string; subtitle?: string; duration_s: number; position: "center" | "lower_third" | "top"; background: "black" | "white" | string; text_color: "black" | "white" | string; fade_in_s?: number; fade_out_s?: number; place: "start" | "end" }
  | { op: "credits"; lines: Array<{ role?: string; name: string }>; duration_s?: number; speed?: number; background: "black" | "white" | string; text_color: "black" | "white" | string; title?: string }
  | { op: "reframe"; aspect: "9:16" | "1:1" | "16:9" | "4:5"; fill: "crop" | "blur" }
  | { op: "grade"; brightness?: number; contrast?: number; saturation?: number; warmth?: number; grain?: number; vignette?: number }
  | { op: "speed"; factor: number }
  | { op: "captions"; lines: Array<{ from_s: number; to_s: number; text: string }>; position: "bottom" | "middle" | "top" };

/** One file the Stack reads: its bytes and the extension it is staged with (the Stack looks at the content, not the name). */
export interface EditFile { bytes: Uint8Array; ext: string }
export interface StackEditRequest { inputs: EditFile[]; ops: EditOp[]; name: string; signal?: AbortSignal }
export type StackEditResult =
  | { ok: true; bytes: Uint8Array; seconds: number | null; width: number | null; height: number | null; audio: boolean; ms: number }
  | { ok: false; code: "unavailable" | "remote" | "failed" | "timeout" | "cancelled" | "unreadable"; line: string };

export const EDIT_UNAVAILABLE_LINE = "I couldn't change that video. The video editor isn't ready. Try again in a few minutes.";
export const EDIT_REMOTE_LINE = "I couldn't change that video. Editing only works when Home runs the AI on this computer. Ask an admin.";
export const EDIT_FAILED_LINE = "I couldn't change that video. The edit did not finish. Try again, or change what you asked for.";
export const EDIT_TIMEOUT_LINE = "I couldn't change that video. It took longer than expected. Try again with a shorter clip.";
export const EDIT_MISSING_LINE = "I couldn't change that video. The edited video could not be read back. Try again.";

let POLL_MS = 500;
let DEADLINE_MS = 30 * 60 * 1000;
/** Test seam: poll faster and give up sooner (null restores). */
export function __setStackEditTimingForTests(timing: { pollMs: number; deadlineMs: number } | null): void { POLL_MS = timing?.pollMs ?? 500; DEADLINE_MS = timing?.deadlineMs ?? 30 * 60 * 1000; }

const MAX_RESULT_BYTES = 1024 * 1024 * 1024;
const ACTIVE = new Set(["queued", "running", "paused", "stalled", "waiting_for_you"]);

/** The Stack's own sentence for a failed edit, when it has one that names no path; else null. */
function stackReason(reason: string | null | undefined): string | null {
  const clean = (reason ?? "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 240 || clean.includes("/") || clean.includes("\\")) return null;
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); done(); }, { once: true });
  });
}

/** Declares the folder Home stages edits in as a media root of the Stack (read and write), once per call, only when it is missing. */
async function openEditRoot(root: string): Promise<void> {
  const client = getStackClient();
  const current = await client.mediaRoots();
  if (current.read.includes(root) && current.write.includes(root)) return;
  await client.setMediaRoots({ read: [...new Set([...current.read, root])], write: [...new Set([...current.write, root])] });
}

/** A private copy of one stored clip inside the folder the Stack may read, so a Stack edit never needs the whole attachments folder opened. Call `cleanup` when the job is over. Null when the Stack is remote or the copy fails. */
export async function stageClipForStack(sourcePath: string): Promise<{ path: string; cleanup: () => void } | null> {
  if (isRemoteStackSelected()) return null;
  const root = resolve(dataDir, "video-edit");
  const dir = join(root, newFileId());
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    await openEditRoot(root);
    const path = join(dir, "source.mp4");
    copyFileSync(sourcePath, path);
    return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

/** Submits one `media.edit` job with these files and steps, waits for it and returns the finished file's bytes. */
export async function runStackEdit(request: StackEditRequest): Promise<StackEditResult> {
  if (!isStackConfigured()) return { ok: false, code: "unavailable", line: EDIT_UNAVAILABLE_LINE };
  // The Stack reads files by path on its own computer; a remote Stack cannot read Home's folder.
  if (isRemoteStackSelected()) return { ok: false, code: "remote", line: EDIT_REMOTE_LINE };
  const root = resolve(dataDir, "video-edit");
  const dir = join(root, newFileId());
  let stackJob: string | null = null;
  try {
    // Private to this account: the Stack runs as the same user and needs no group or world access.
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    await openEditRoot(root);
    const paths = request.inputs.map((file, index) => {
      const path = join(dir, `in-${index + 1}.${file.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"}`);
      writeFileSync(path, file.bytes, { mode: 0o644 });
      return path;
    });
    const client = getStackClient();
    let job = await client.submitJob({ kind: "media.edit", input: { inputs: paths, ops: request.ops, output: { dir, name: request.name } } });
    stackJob = job.id;
    const deadline = Date.now() + DEADLINE_MS;
    while (ACTIVE.has(job.state)) {
      if (request.signal?.aborted) { void client.cancelJob(job.id).catch(() => undefined); return { ok: false, code: "cancelled", line: EDIT_FAILED_LINE }; }
      if (Date.now() > deadline) { void client.cancelJob(job.id).catch(() => undefined); return { ok: false, code: "timeout", line: EDIT_TIMEOUT_LINE }; }
      await sleep(POLL_MS, request.signal);
      if (request.signal?.aborted) continue;
      job = await client.job(job.id);
    }
    if (job.state !== "done") {
      const reason = stackReason(job.reason);
      return { ok: false, code: "failed", line: reason ? `I couldn't change that video. ${reason}` : EDIT_FAILED_LINE };
    }
    const result = (job.result ?? {}) as { path?: unknown; duration_s?: unknown; width?: unknown; height?: unknown; audio_codec?: unknown; elapsed_ms?: unknown };
    const path = typeof result.path === "string" ? resolve(result.path) : "";
    // Only a file inside this job's own folder is read back.
    if (!path.startsWith(dir + sep) || !existsSync(path)) return { ok: false, code: "unreadable", line: EDIT_MISSING_LINE };
    const size = statSync(path).size;
    if (size === 0 || size > MAX_RESULT_BYTES) return { ok: false, code: "unreadable", line: EDIT_MISSING_LINE };
    const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { ok: true, bytes: new Uint8Array(readFileSync(path)), seconds: num(result.duration_s), width: num(result.width), height: num(result.height), audio: typeof result.audio_codec === "string" && result.audio_codec.length > 0, ms: num(result.elapsed_ms) ?? 0 };
  } catch {
    // A refused or unreachable Stack: the plain line, never the error text (it can hold a path).
    if (stackJob && request.signal?.aborted) void getStackClient().cancelJob(stackJob).catch(() => undefined);
    return { ok: false, code: "unavailable", line: EDIT_UNAVAILABLE_LINE };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** At startup: removes staging folders a crash or restart left behind (older than an hour). Returns how many went. */
export function sweepStaleEditFolders(maxAgeMs = 60 * 60 * 1000, now = Date.now()): number {
  const root = resolve(dataDir, "video-edit");
  let removed = 0;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      try { if (now - statSync(path).mtimeMs > maxAgeMs) { rmSync(path, { recursive: true, force: true }); removed += 1; } } catch { /* the next start tries again */ }
    }
  } catch { /* no folder yet */ }
  return removed;
}
