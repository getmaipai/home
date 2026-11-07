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
import { SPATIAL_FAILURE_COPY, isSpatialFailureCode } from "@/lib/failureCopy";

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
  | { op: "transition"; kind: "fade" | "dissolve" | "speckle" | "wipeleft" | "wiperight" | "wipeup" | "wipedown" | "slideleft" | "slideright" | "slideup" | "slidedown" | "circleopen" | "circleclose" | "radial" | "smoothleft" | "smoothright" | "fadeblack" | "fadewhite" | "zoomin" | "pixelize"; duration_s: number; with?: number[] }
  | { op: "title_card"; text: string; subtitle?: string; duration_s: number; position: "center" | "lower_third" | "top"; background: "black" | "white" | string; text_color: "black" | "white" | string; fade_in_s?: number; fade_out_s?: number; place: "start" | "end" }
  | { op: "credits"; lines: Array<{ role?: string; name: string }>; duration_s?: number; speed?: number; background: "black" | "white" | string; text_color: "black" | "white" | string; title?: string }
  | { op: "reframe"; aspect: "9:16" | "1:1" | "16:9" | "4:5"; fill: "crop" | "blur" }
  | { op: "grade"; brightness?: number; contrast?: number; saturation?: number; warmth?: number; grain?: number; vignette?: number }
  | { op: "film_look"; preset: "70s_color" | "noir" | "teal_orange" | "bleach_bypass" | "technicolor" | "faded_vintage" | "cool_thriller" | "night"; strength?: number }
  | { op: "letterbox"; ratio: "2.39:1" | "2:1" | "1.85:1" | "1.33:1" }
  | { op: "speed"; factor: number }
  | { op: "speed_ramp"; from_factor: number; to_factor: number; at_s: number; over_s: number }
  | { op: "reverse" }
  | { op: "freeze"; at_s: number; hold_s: number }
  | { op: "loop"; times: number }
  | { op: "kenburns"; zoom_from: number; zoom_to: number; pan: "none" | "left" | "right" | "up" | "down"; duration_s?: number }
  | { op: "fps_boost"; fps: 30 | 48 | 60 }
  | { op: "flip"; direction: "horizontal" | "vertical" }
  | { op: "rotate"; degrees: 90 | 180 | 270 }
  /** `sharpen` amounts above 1 up to 1.5 are Sharpen+. */
  | { op: "sharpen"; amount: number }
  | { op: "denoise"; amount: number; deblock?: boolean }
  | { op: "ripple"; amount: number }
  | { op: "pip"; input: number; corner: "top_left" | "top_right" | "bottom_left" | "bottom_right"; size: number; margin: number }
  | { op: "upscale"; factor: 2 }
  | { op: "cutout"; background: "black" | "white" | "green" | "blur" | "transparent" | `#${string}`; feather_px?: number; subject?: { frame?: number; box?: [number, number, number, number]; point?: { x: number; y: number } } }
  /** SPATIAL-04 (Stack 67481c2): move the clip's own dialog toward the side of the screen where the speaker stands; `surround: true` also writes a 5.1 E-AC-3 file, and must be the last step. */
  | { op: "spatial_sound"; surround?: boolean; side?: "left" | "right" }
  | { op: "captions"; lines: Array<{ from_s: number; to_s: number; text: string }>; position: "bottom" | "middle" | "top" };

/** One file the Stack reads: its bytes and the extension it is staged with (the Stack looks at the content, not the name). */
export interface EditFile { bytes: Uint8Array; ext: string }
export interface StackEditRequest { inputs: EditFile[]; ops: EditOp[]; name: string; signal?: AbortSignal; onProgress?: (progress: number) => void }
export type StackEditResult =
  | { ok: true; bytes: Uint8Array; seconds: number | null; width: number | null; height: number | null; audio: boolean; ms: number;
      /** SPATIAL-04: the 5.1 file a `spatial_sound` step with `surround` wrote beside the stereo clip (the stereo clip is `bytes`). */
      surround?: Uint8Array;
      /** SPATIAL-04: what a `spatial_sound` step reported: whether it moved the sound, why not, and the Stack's own plain lines (cleaned). */
      spatial?: { applied: boolean; reason: string | null; notes: string[] } }
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
export function plainStackLine(text: unknown): string | null {
  const clean = (typeof text === "string" ? text : "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 240 || clean.includes("/") || clean.includes("\\")) return null;
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function stackReason(reason: string | null | undefined): string | null { return plainStackLine(reason); }

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
  // The Stack refuses a root list that names a folder which no longer exists (a removed worktree or an unplugged drive), and then no edit can start.
  // Folders that are gone are dropped; the ones still there are kept as they were.
  const present = (list: string[]) => list.filter((path) => existsSync(path));
  const stale = current.read.length !== present(current.read).length || current.write.length !== present(current.write).length;
  if (!stale && current.read.includes(root) && current.write.includes(root)) return;
  await client.setMediaRoots({ read: [...new Set([...present(current.read), root])], write: [...new Set([...present(current.write), root])] });
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
      request.onProgress?.(job.percent);
    }
    if (job.state !== "done") {
      // SPATIAL-04: a failed `spatial_sound` step carries a code (`failure.code`); each code has one plain line of its own (failureCopy.ts).
      const code = (job as unknown as { failure?: { code?: unknown } }).failure?.code;
      if (request.ops.some((op) => op.op === "spatial_sound") && isSpatialFailureCode(code)) return { ok: false, code: "failed", line: `I couldn't change that video. ${SPATIAL_FAILURE_COPY[code]}` };
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
    // SPATIAL-04: the 5.1 sibling of a `spatial_sound` step (`files[]`, role surround_5_1), read from this job's own folder only, and the Stack's plain lines.
    const spatialStep = request.ops.some((op) => op.op === "spatial_sound");
    let surround: Uint8Array | undefined;
    let spatialReport: { applied: boolean; reason: string | null; notes: string[] } | undefined;
    if (spatialStep) {
      const listed = Array.isArray((result as { files?: unknown }).files) ? (result as { files: unknown[] }).files : [];
      const sibling = listed.find((entry): entry is { path: string } => !!entry && typeof entry === "object" && (entry as { role?: unknown }).role === "surround_5_1" && typeof (entry as { path?: unknown }).path === "string");
      if (sibling) {
        const siblingPath = resolve(sibling.path);
        const siblingSize = siblingPath.startsWith(dir + sep) && existsSync(siblingPath) ? statSync(siblingPath).size : 0;
        // A 5.1 file the Stack named but that cannot be read back is a failed edit, not a stereo clip passed off as the whole answer.
        if (siblingSize === 0 || siblingSize > MAX_RESULT_BYTES) return { ok: false, code: "unreadable", line: EDIT_MISSING_LINE };
        surround = new Uint8Array(readFileSync(siblingPath));
      }
      const spatial = (result as { spatial?: { applied?: unknown; reason?: unknown; note?: unknown; notes?: unknown } }).spatial;
      // `notes` is the list of lines; `note` is the same lines as one (shown only when the list is empty).
      const listedNotes = Array.isArray(spatial?.notes) ? spatial.notes : [];
      const lines = (listedNotes.length > 0 ? listedNotes : spatial?.note !== undefined ? [spatial.note] : []).map(plainStackLine).filter((line): line is string => line !== null);
      spatialReport = { applied: spatial?.applied !== false, reason: typeof spatial?.reason === "string" ? spatial.reason : null, notes: [...new Set(lines)] };
    }
    return { ok: true, ...(surround ? { surround } : {}), ...(spatialReport ? { spatial: spatialReport } : {}), bytes: new Uint8Array(readFileSync(path)), seconds: num(result.duration_s), width: num(result.width), height: num(result.height), audio: typeof result.audio_codec === "string" && result.audio_codec.length > 0, ms: num(result.elapsed_ms) ?? 0 };
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
