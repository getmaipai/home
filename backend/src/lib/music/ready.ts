// MUSIC-GEN-03: whether the Stack has a music engine that can make a song right now. The music tool is offered only
// then, so the model never sees a tool that would fail for want of a model (rule 6 still covers a failure after the
// offer). A read failure is "not ready"; the answer is cached briefly so a chat turn pays for it at most once every
// 20 seconds.
import { isStackConfigured } from "@/lib/stackEngine";
import { slotIsOff, type Tier } from "@/lib/tiers";
import { musicStatus, type StackMusicStatus } from "./stack";
import type { MusicRequest } from "./types";

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
let latestTranscribeAvailable: { value: boolean; at: number } | null = null;
const TTL_MS = 20_000;

/** Test seam: the Stack's music status (null: no engine), or undefined to read for real. */
export function __setMusicStatusForTests(status: StackMusicStatus | null | undefined): void { forTests = status; latestTranscribeAvailable = status === undefined ? null : { value: status?.transcribe?.available === true, at: Date.now() }; cached = null; }

export async function musicEngineStatus(): Promise<StackMusicStatus | null> {
  if (forTests !== undefined) return forTests;
  if (!isStackConfigured()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.status;
  let read: StackMusicStatus | null;
  try { read = await musicStatus(); }
  catch { latestTranscribeAvailable = null; cached = { at: Date.now(), status: settleMusicStatus(null, lastReady, Date.now()) }; return cached.status; }
  latestTranscribeAvailable = read === null ? null : { value: read.transcribe?.available === true, at: Date.now() };
  const status = settleMusicStatus(read, lastReady, Date.now());
  if (read && musicStatusReady(read)) lastReady = { at: Date.now(), status: read };
  else if (read) lastReady = null;
  cached = { at: Date.now(), status };
  return status;
}

export function dropMusicStatusCache(): void { cached = null; lastReady = null; latestTranscribeAvailable = null; }

/** The engine is installed and able to take a job (setting up, idle or running all count: the job queues). */
export function musicStatusReady(status: StackMusicStatus | null): boolean {
  if (!status || !status.limits || !Number.isFinite(status.limits.max_seconds) || !Number.isFinite(status.limits.min_seconds)) return false;
  if (status.state === "unsupported" || status.state === "off" || status.state === "not-installed") return false;
  return status.available === true;
}
/** Minors stay closed until the Stack confirms it can return an as-sung transcript. */
export function musicTranscriptionAvailable(): boolean { return forTests !== undefined ? forTests?.transcribe?.available === true : latestTranscribeAvailable?.value === true && Date.now() - latestTranscribeAvailable.at <= 60_000; }

export async function musicEngineReady(): Promise<boolean> {
  return musicStatusReady(await musicEngineStatus());
}

/**
 * MUSIC-MAX-01: whether a Max choice is offered at all. The Stack lists `max` in `quality` and an admin has not switched the Max music level off.
 * The slot's model `recommended` counts: the engine has one maker per level, so Max's recommended model is the Stack's XL SFT maker (`maxAvailable`
 * in lib/tiers.ts is for categories whose Max needs a model of its own).
 */
export function musicMaxOffered(status: StackMusicStatus | null): boolean {
  return !!status && Array.isArray(status.quality) && status.quality.includes("max") && !slotIsOff("music", "max");
}
/** Whether the Max models are installed. The Stack runs a Max song as Boost when they are not, so Home never assumes it from the offer alone. */
export function musicMaxInstalled(status: StackMusicStatus | null): boolean { return status?.max_model?.installed === true; }
export const MUSIC_MAX_NOT_INSTALLED_LINE = "The Max music model is not installed on this computer yet, so this one is made at Boost.";
/** The maker a granted level really runs at on this engine: Max only when offered and installed, else Boost (Detailed) when the engine has it, else Quick. */
export function musicQualityFor(status: StackMusicStatus | null, tier: Tier): NonNullable<MusicRequest["quality"]> {
  if (tier === "standard") return "quick";
  if (tier === "max" && musicMaxOffered(status) && musicMaxInstalled(status)) return "max";
  return status?.quality.includes("detailed") ? "detailed" : "quick";
}
/** The level a maker belongs to, for the household queue and the card (Quick is Standard, Detailed is Boost). */
export const musicTierOf = (quality: MusicRequest["quality"]): "standard" | "boost" | "max" => quality === "max" ? "max" : quality === "detailed" ? "boost" : "standard";

/** A ready status for tests. */
export function readyMusicStatusForTests(overrides: Partial<StackMusicStatus> = {}): StackMusicStatus {
  return { state: "idle", available: true, limits: { min_seconds: 10, max_seconds: 600 }, quality: ["quick", "detailed"], transcribe: { available: true }, ...overrides };
}
