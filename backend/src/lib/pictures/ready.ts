// IMGGEN-HOME-01: whether the Stack has a picture engine that can make a picture right now. The picture tool is
// offered only then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a
// failure after the offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for
// it at most once every 20 seconds.
import { plainEngineLine } from "@/lib/pictures/plainLine";
import { isStackConfigured } from "@/lib/stackEngine";
import { imageStatus, type StackImageStatus } from "./stack";
import { PICTURE_MODEL } from "./quality";

let cached: { at: number; status: StackImageStatus | null } | null = null;
let forTests: StackImageStatus | null | undefined;
const TTL_MS = 20_000;

/** Test seam: the Stack's picture status (null: no engine), or undefined to read for real. */
export function __setPictureStatusForTests(status: StackImageStatus | null | undefined): void { forTests = status; cached = null; }
export function __setPictureStatusReaderForTests(reader: (() => Promise<StackImageStatus | null>) | null): void { statusReaderForTests = reader; cached = null; }
let statusReaderForTests: (() => Promise<StackImageStatus | null>) | null = null;

let refreshing: Promise<StackImageStatus | null> | null = null;
function refresh(): Promise<StackImageStatus | null> {
  refreshing ??= imageStatus().then((status) => { cached = { at: Date.now(), status }; return status; }).finally(() => { refreshing = null; });
  return refreshing;
}

/** Stale-while-revalidate: a chat turn never waits on the Stack for this. A fresh answer is used as is; a stale one is
 * used at once while a refresh runs; the very first read waits, at most 1.5 seconds, and reads as "no engine" past that. */
export async function pictureEngineStatus(): Promise<StackImageStatus | null> {
  if (statusReaderForTests) return statusReaderForTests();
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const pending = refresh();
  if (cached) return cached.status;
  return Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500))]);
}

/** The last picture status read, without waiting or fetching. */
export function peekPictureEngineStatus(): StackImageStatus | null {
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  return cached?.status ?? null;
}

export function dropPictureStatusCache(): void { cached = null; }

/** The most pictures one call carries whatever the engine says: the shipped picture model takes up to 6 in one edit (the edited picture counts). */
export const MAX_REFERENCE_PICTURES = 6;

/** Extra pictures the engine takes beside the one it changes. Not capped here (pictureReferenceLimit caps it). */
export function pictureEngineReferences(status: StackImageStatus | null | undefined): number {
  if (!status) return 0;
  // Order: the Stack's own per-request cap (Home never sends more pictures than the engine says it takes), then the count it reports for
  // edits, then the count of the model that would make the picture (a summary that still says 0 while a model that edits is installed).
  const cap = status.limits?.max_references;
  if (typeof cap === "number") return cap;
  const own = status.edit?.references ?? 0;
  if (own > 0) return own;
  const wanted = status.default_model;
  const model = status.models?.find((m) => m.installed && m.id === wanted && m.edit !== false) ?? status.models?.find((m) => m.installed && m.edit);
  return model?.max_references ?? 0;
}

/** Whether the engine can change a picture from words: the Stack says so, or an installed model that edits is there. */
export function pictureEngineEdits(status: StackImageStatus | null | undefined): boolean {
  if (!status || status.available === false) return false;
  return Boolean(status.edit?.generative) || (status.edit?.models?.length ?? 0) > 0 || Boolean(status.models?.some((m) => m.installed && m.edit));
}

/** How many reference pictures a call keeps: the engine's own count, at least 1 and at most MAX_REFERENCE_PICTURES. */
export function pictureReferenceLimit(status: StackImageStatus | null | undefined): number {
  const own = pictureEngineReferences(status);
  return Math.min(MAX_REFERENCE_PICTURES, Math.max(1, own || 1));
}

/** The engine is installed and able to take a job (building or running counts: the job queues). */
export async function pictureEngineReady(): Promise<boolean> {
  const status = await pictureEngineStatus();
  if (!status) return false;
  if (status.state === "unsupported" || status.state === "off" || status.state === "not-installed") return false;
  return status.available !== false;
}

/** A test status that is ready. */
export function readyStatusForTests(overrides: Partial<StackImageStatus> = {}): StackImageStatus {
  return {
    state: "idle", phase: null, available: true, reason: null, default_model: PICTURE_MODEL,
    models: [{ id: PICTURE_MODEL, family: "minimax-h3-image", installed: true, licence: "MiniMax-H3-Image Community License", loras: false, edit: true, steps_default: 6, peak_gb: 22 }],
    loras_supported: true, edit: { generative: true, masked: true, references: 2 },
    limits: { min_side: 256, max_side: 2048, size_step: 16, max_n: 4, max_prompt_chars: 2000, max_loras: 3, queue_max: 8 }, idle_unload_s: 600,
    memory: { fits: true, reason: null, peak_gb: 13.5 },
    ...overrides,
  };
}

const NO_PICTURE_MODEL = "No picture model is installed on this computer yet. An admin can add one in Settings, Pictures and videos.";
const PICTURE_ENGINE_UNREACHABLE = "Pictures are not ready yet. Try again in a few minutes.";

/** Why a picture cannot be made now, in the person's terms: the engine's own reason, else "cannot reach it" when the Stack
 * did not answer at all, else "no model". A Stack that is down is not a missing model (found by the generation QA). */
export function pictureNotReadyReason(engine: StackImageStatus | null): string {
  return (engine?.reason ? plainEngineLine(engine.reason) : null) ?? (engine === null ? PICTURE_ENGINE_UNREACHABLE : NO_PICTURE_MODEL);
}
