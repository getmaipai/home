// PHOSPHENE-PARITY-01: the one start of a one-click edit on a finished clip (Spatial sound, Reshape, Sharpen). The chat card's menu route and the Create
// page's actions call it, so the gate, the lock check and the edit are written once: the edit gate first (a child or teen gets the edit line whatever clip
// they name), then the person's own finished, open clip, then the edit the chat tool (`edit_video`) runs.
import type { PersonRow } from "@/types";
import { getVideoJobByFileFor, getVideoJobFor, storeContinueFrame, type VideoJob } from "./jobs";
import { editRefusal } from "./editGate";
import { refusalLineOf, runEditVideo, type RunEditVideoInput } from "./editTool";
import { videoJobLockState, LOCKED_START_LINE } from "./lock";
import { makeAudienceOf } from "./make";
import { clipFileOf, clipMarkOf } from "./editGate";
import { runStackEdit } from "./stackEdit";
import { frameOps, lastFrameAt, trimRange } from "./editPlan";
import sharp from "sharp";
import { screenInputImage, viewerOf } from "@/lib/pictures/ageCheck";
import { newItemMark } from "@/lib/adultLock";
import { makeVideoFor, bodyOfVideoJob } from "./make";

export type ClipEditStart =
  | { ok: true; job: VideoJob }
  | { ok: false; status: 403 | 404 | 422 | 423 | 502 | 503; error: string; code: string; locked?: true };

export async function startClipEdit(actor: PersonRow, id: string, args: Record<string, unknown>, failedLine: string, failedCode: string, onSaved?: (fileId: string) => void): Promise<ClipEditStart> {
  const gate = editRefusal(makeAudienceOf(actor), "");
  if (gate) return { ok: false, status: gate.kind === "denied" ? 403 : 422, error: gate.line, code: gate.kind === "denied" ? gate.why : "minor" };
  const source = getVideoJobFor(actor, id) ?? getVideoJobByFileFor(actor, id);
  if (!source || source.state !== "done") return { ok: false, status: 404, error: "That video isn't available any more. Ask for it again.", code: "not_found" };
  if (videoJobLockState(actor, source) !== "open") return { ok: false, status: 423, error: LOCKED_START_LINE, code: "locked", locked: true };
  const state = { actor, surface: "chat", conversationId: source.conversationId, turnId: source.turnId, temporary: source.temporary, planBasis: { surfaceClass: "written" }, context: [], utterance: "", persona: null, crisis: false } as unknown as RunEditVideoInput["state"];
  const outcome = await runEditVideo({ state, args: { clip: source.id, ...args }, callId: `route-${String(args.change)}`, spoken: false, ...(onSaved ? { onSaved } : {}) });
  const started = (outcome.result?.data as { videoJobId?: string } | undefined)?.videoJobId;
  if (!started) return { ok: false, status: 422, error: refusalLineOf(outcome) ?? failedLine, code: String((outcome.result?.data as { refused?: string } | undefined)?.refused ?? failedCode) };
  const job = getVideoJobFor(actor, started);
  return job ? { ok: true, job } : { ok: false, status: 404, error: "That video isn't available any more.", code: "not_found" };
}

/** The shapes the Create feed offers, by the word a person uses; each is the Stack's `reframe` with a soft blurred copy of the clip filling the space. */
export const RESHAPES = { vertical: "9:16", portrait: "4:5", square: "1:1", wide: "16:9" } as const;
export type Reshape = keyof typeof RESHAPES;
export const isReshape = (value: unknown): value is Reshape => typeof value === "string" && Object.prototype.hasOwnProperty.call(RESHAPES, value);

export function startReshape(actor: PersonRow, id: string, shape: Reshape): Promise<ClipEditStart> {
  return startClipEdit(actor, id, { change: "reframe", aspect: RESHAPES[shape], fill: "blur" }, "I couldn't change the shape of that video. Try again.", "reshape_failed");
}

export function startSharpen(actor: PersonRow, id: string): Promise<ClipEditStart> {
  return startClipEdit(actor, id, { change: "upscale" }, "I couldn't sharpen that video. Try again.", "sharpen_failed");
}

export const NEXT_SHOTS = {
  wide: "Continue the scene in a wide view, keeping the same place and moment.",
  three_quarter: "Continue the scene from a three-quarter view, keeping the same place and moment.",
  close: "Continue the scene in a close view, keeping the same place and moment.",
  push_in: "Continue the scene with a gentle push in toward the subject.",
  next_beat: "Continue with the next natural beat of the same scene.",
} as const;
export type NextShot = keyof typeof NEXT_SHOTS;

export const EXTEND_DEFAULT = "Continue the scene from where it stops, keeping the same place, people and light.";
export const EXTEND_MAX_CHARS = 300;

/** Colorize: the one restyle the edit tool has (`ltx-ic-colorizer`, VIDEO_RESTYLES), started like Sharpen. The refusal lines (no colorizer installed, clip too long, level) come from the tool. */
export function startColorize(actor: PersonRow, id: string): Promise<ClipEditStart> {
  return startClipEdit(actor, id, { change: "restyle", restyle: "colorize" }, "I couldn't colour that video. Try again.", "colorize_failed");
}

/** Start a Create rerun or a last-frame continuation from the owner's finished clip. */
export async function startClipCreation(actor: PersonRow, id: string, mode: "reshoot" | "next-shot" | "extend", change?: string, shot?: NextShot): Promise<ClipEditStart> {
  const gate = editRefusal(makeAudienceOf(actor), "");
  if (gate) return { ok: false, status: 403, error: gate.line, code: gate.kind === "denied" ? gate.why : "minor" };
  const source = getVideoJobFor(actor, id) ?? getVideoJobByFileFor(actor, id);
  if (!source || source.conversationId || source.state !== "done") return { ok: false, status: 404, error: "That video isn't available any more. Make a new one from the words above.", code: "gone" };
  if (source.kind === "edit") return { ok: false, status: 422, error: "This clip was made by editing others, so it has no words of its own to make again. Open the original clip and try there.", code: "edited" };
  if (videoJobLockState(actor, source) !== "open") return { ok: false, status: 423, error: LOCKED_START_LINE, code: "locked", locked: true };
  const base = { ...bodyOfVideoJob(source), ...(!source.conversationId && source.kind === "animate" && source.request.source_file_id ? { start_frame: source.request.source_file_id } : {}) };
  let body = mode === "reshoot" ? { ...base, ...(change ? { prompt: `${base.prompt}. ${change.trim()}` } : {}) } : base;
  const sourceMark = await clipMarkOf(source);
  let context: Parameters<typeof makeVideoFor>[2] = { parent: source, adultOnly: sourceMark.madeAudience === "adult-only", adultLock: sourceMark.lock };
  if (mode === "next-shot" || mode === "extend") {
    // Extend: the same last-frame continuation, with the person's one sentence (or the plain "keep going") instead of a camera choice.
    const instruction = mode === "extend" ? change?.trim() || EXTEND_DEFAULT : shot ? NEXT_SHOTS[shot] : null;
    if (!instruction) return { ok: false, status: 422, error: "Choose one of the available next shots.", code: "bad_arguments" };
    const clip = clipFileOf(actor, source);
    if (!clip) return { ok: false, status: 404, error: "That video isn't available any more. Ask for it again.", code: "not_found" };
    const frame = await runStackEdit({ inputs: [clip], ops: frameOps(lastFrameAt(source.files[0]?.seconds ?? source.request.seconds)), name: "frame.png" });
    if (!frame.ok) return { ok: false, status: 422, error: frame.line, code: frame.code };
    let jpeg: Uint8Array; let width: number; let height: number;
    try { const image = sharp(Buffer.from(frame.bytes)); const meta = await image.metadata(); width = meta.width ?? 0; height = meta.height ?? 0; jpeg = new Uint8Array(await image.jpeg({ quality: 90 }).toBuffer()); } catch { return { ok: false, status: 422, error: "I couldn't read the last frame of that video. Try again.", code: "frame_unreadable" }; }
    const audience = makeAudienceOf(actor);
    const prompt = `${base.prompt}. ${instruction}`;
    const screened = await screenInputImage(jpeg, prompt, viewerOf(actor, audience.band));
    if (!screened.ok) return { ok: false, status: 422, error: screened.line, code: screened.code };
    const mark = newItemMark([await clipMarkOf(source)], false);
    const stored = storeContinueFrame(actor, { conversationId: null, turnId: null, temporary: false, jpeg, width, height, adultOnly: mark.madeAudience === "adult-only", lock: mark.lock, sourceJobId: source.id });
    if (!stored.ok) return { ok: false, status: 422, error: stored.line, code: "frame_not_saved" };
    body = { ...base, prompt, start_frame: stored.id };
    context = { ...context, prepared: { image: Buffer.from(jpeg).toString("base64"), imageSource: "generated", sourceFileId: stored.id, width, height } };
  }
  const made = await makeVideoFor(actor, body, context);
  return made.ok ? { ok: true, job: made.job } : { ok: false, status: made.status, error: made.error, code: made.code };
}

/** The least a part of a split may be, in seconds: the Studio's own smallest piece. */
const SPLIT_MIN_PART_S = 0.5;
export const SPLIT_POINT_LINE = "Type the time to split at, in seconds from the start, for example 4.5.";
const splitOutsideLine = (seconds: number) => `That clip is ${seconds} seconds long. Pick a split time at least half a second from each end.`;

/**
 * Trim and join page, Split: one finished clip becomes two new clips, the part before `at` and the part after it. The Stack makes one clip per edit job
 * and a person may run one video job at a time, so the first part starts now and the second starts when the first has been saved (the same edit gate,
 * lock check and trim as any other: `startClipEdit`). The original is kept. If the second part cannot start, the first is still a finished clip and
 * the failure is in the second job's own line in the clips feed.
 */
export async function startSplit(actor: PersonRow, id: string, at: unknown): Promise<ClipEditStart> {
  const point = typeof at === "number" ? at : typeof at === "string" && /^\s*\d+(\.\d+)?\s*$/.test(at) ? Number(at) : NaN;
  if (!Number.isFinite(point)) return { ok: false, status: 422, error: SPLIT_POINT_LINE, code: "bad_split" };
  const gate = editRefusal(makeAudienceOf(actor), "");
  if (gate) return { ok: false, status: gate.kind === "denied" ? 403 : 422, error: gate.line, code: gate.kind === "denied" ? gate.why : "minor" };
  const source = getVideoJobFor(actor, id) ?? getVideoJobByFileFor(actor, id);
  if (!source || source.state !== "done") return { ok: false, status: 404, error: "That video isn't available any more. Ask for it again.", code: "not_found" };
  if (videoJobLockState(actor, source) !== "open") return { ok: false, status: 423, error: LOCKED_START_LINE, code: "locked", locked: true };
  const length = source.files[0]?.seconds ?? null;
  if (length === null) return { ok: false, status: 422, error: "I can't tell how long that clip is, so I can't split it. Use Trim instead.", code: "unknown_length" };
  if (point < SPLIT_MIN_PART_S || point > length - SPLIT_MIN_PART_S) return { ok: false, status: 422, error: splitOutsideLine(length), code: "bad_split" };
  const first = trimRange({ from_s: 0, to_s: point }, length);
  const second = trimRange({ from_s: point, to_s: length }, length);
  if (!first.ok || !second.ok) return { ok: false, status: 422, error: splitOutsideLine(length), code: "bad_split" };
  const sourceId = source.id;
  return startClipEdit(actor, sourceId, { change: "trim", from_s: first.from, to_s: first.to }, "I couldn't split that video. Try again.", "split_failed", () => {
    void startClipEdit(actor, sourceId, { change: "trim", from_s: second.from, to_s: second.to }, "I couldn't make the second part. Try again.", "split_failed");
  });
}
