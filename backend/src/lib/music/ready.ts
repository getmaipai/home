// MUSIC-GEN-03: whether the Stack has a music engine that can make a song right now. The music tool is offered only
// then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a failure after the
// offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for it at most once every
// 20 seconds.
import { isStackConfigured } from "@/lib/stackEngine";
import { musicStatus, type StackMusicStatus } from "./stack";

let cached: { at: number; status: StackMusicStatus | null } | null = null;
// The last status that named a ready engine. A read that fails (the Stack is busy loading a model, a 5 s timeout) must not
// take the song tool away from the next chat turns: the live hub once answered a song request with lyrics only.
let lastReady: { at: number; status: StackMusicStatus } | null = null;
const KEEP_READY_MS = 5 * 60_000;
/** The status to use now: a failed read (null) keeps the last ready one for up to five minutes. */
export function settleMusicStatus(read: StackMusicStatus | null, previous: { at: number; status: StackMusicStatus } | null, now: number): StackMusicStatus | null {
  return read === null && previous && now - previous.at < KEEP_READY_MS ? previous.status : read;
}
let forTests: StackMusicStatus | null | undefined;
const TTL_MS = 20_000;

/** Test seam: the Stack's music status (null: no engine), or undefined to read for real. */
export function __setMusicStatusForTests(status: StackMusicStatus | null | undefined): void { forTests = status; cached = null; }

export async function musicEngineStatus(): Promise<StackMusicStatus | null> {
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  const read = await musicStatus();
  const status = settleMusicStatus(read, lastReady, Date.now());
  if (read && musicStatusReady(read)) lastReady = { at: Date.now(), status: read };
  else if (read) lastReady = null;
  cached = { at: Date.now(), status };
  return status;
}

export function dropMusicStatusCache(): void { cached = null; lastReady = null; }

/** The engine is installed and able to take a job (setting up, idle or running all count: the job queues). */
export function musicStatusReady(status: StackMusicStatus | null): boolean {
  if (!status || !status.limits || !Number.isFinite(status.limits.max_seconds) || !Number.isFinite(status.limits.min_seconds)) return false;
  if (status.state === "unsupported" || status.state === "off" || status.state === "not-installed") return false;
  return status.available === true;
}

export async function musicEngineReady(): Promise<boolean> {
  return musicStatusReady(await musicEngineStatus());
}

/** A ready status for tests. */
export function readyMusicStatusForTests(overrides: Partial<StackMusicStatus> = {}): StackMusicStatus {
  return { state: "idle", available: true, limits: { min_seconds: 10, max_seconds: 600 }, quality: ["quick", "detailed"], ...overrides };
}
