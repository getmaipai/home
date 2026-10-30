// MUSIC-GEN-03: Stack section 12. Words and source bytes travel only in bodies, never in logs or errors.
import type { MusicRequest } from "./types";
import { getStackUrl } from "@/lib/stackEngine";
export type MusicState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface StackSong { url?: string; duration_s: number; seed: number; lrc?: string; bpm?: number; key?: string; model?: string }
export interface StackStem { url: string; name: "vocals" | "drums" | "bass" | "other"; duration_s: number }
export interface StackStemsStatus { available: boolean; state: string; install?: unknown }
export interface StackMusicStatus {
  available: boolean; state: string; limits: { min_seconds: number; max_seconds: number };
  quality: string[]; default_quality?: "quick" | "detailed"; install?: unknown;
}
export interface MusicBody {
  task: "text2music" | "cover" | "repaint" | "extend" | "edit";
  caption: string; lyrics?: string; instrumental?: boolean; duration_s: number;
  bpm?: number; key?: string; language?: string; seed?: number; quality?: "quick" | "detailed";
  source?: string; source_sha256?: string; from_s?: number; to_s?: number; add_s?: number; at?: "start" | "end";
  strength?: number; edit?: { op: "trim" | "fade" | "loudness"; from_s?: number; to_s?: number; seconds?: number; where?: "in" | "out" | "both"; lufs?: number };
  timeout_ms: number;
}
export function musicBody(request: MusicRequest, task: MusicBody["task"]): Omit<MusicBody, "timeout_ms"> {
  return { task, caption: request.description, lyrics: request.lyrics, instrumental: request.instrumental, duration_s: request.seconds,
    bpm: request.bpm, key: request.key, language: request.language, quality: request.quality ?? "quick", seed: request.seed,
    from_s: request.from_s, to_s: request.to_s, add_s: request.add_s, at: request.at, strength: request.strength, edit: request.edit };
}

export interface StackMusicJob {
  state: MusicState; stage?: string | null; stage_label?: string | null; progress_fraction?: number | null;
  eta_seconds?: number | null; position?: number | null; code?: string | null; data?: StackSong[];
}
export class StackMusicError extends Error {
  constructor(readonly status: number, readonly code: string) { super("The music engine could not complete the request. Try again."); this.name = "StackMusicError"; }
}
let fetchForTests: typeof fetch | null = null;
export function __setMusicFetchForTests(fn: typeof fetch | null): void { fetchForTests = fn; }
export const __setStemsFetchForTests = __setMusicFetchForTests;
async function request(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const base = fetchForTests ? "http://127.0.0.1:1" : getStackUrl();
  if (!base) throw new StackMusicError(503, "no_stack");
  try { return await (fetchForTests ?? globalThis.fetch)(base.replace(/\/$/, "") + path, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new StackMusicError(503, "unreachable"); }
}
async function checked(res: Response): Promise<Response> {
  if (res.ok) return res;
  let code = `http_${res.status}`;
  try { const body = await res.json() as { code?: unknown }; if (typeof body.code === "string") code = body.code; } catch { /* no raw error text */ }
  throw new StackMusicError(res.status, code);
}
export async function submitMusic(body: MusicBody): Promise<{ job: string; done: StackSong[] | null }> {
  const res = await checked(await request("/v1/audio/music", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 60_000));
  const parsed = await res.json() as { job?: string; data?: StackSong[] };
  if (!parsed.job) throw new StackMusicError(502, "bad_reply");
  return { job: parsed.job, done: res.status === 200 && parsed.data?.length ? parsed.data : null };
}
export async function getMusicJob(job: string): Promise<StackMusicJob> {
  return await (await checked(await request(`/v1/audio/music/${encodeURIComponent(job)}`))).json() as StackMusicJob;
}
export async function fetchSong(job: string): Promise<Uint8Array> {
  return new Uint8Array(await (await checked(await request(`/v1/audio/music/${encodeURIComponent(job)}/file`, {}, 120_000))).arrayBuffer());
}
export async function cancelOrDeleteMusic(job: string): Promise<void> {
  try { await (await request(`/v1/audio/music/${encodeURIComponent(job)}`, { method: "DELETE" })).arrayBuffer(); } catch { /* Stack expires its own copy */ }
}
export async function musicStatus(): Promise<StackMusicStatus | null> {
  // The Stack answers `{ music: {...} }`, the same envelope as `GET /stack/v1/video` (Stack routes/music.ts); a flat body is
  // accepted too. MUSIC-GEN-06: reading it flat left every real Stack looking "not ready", so the tool was never offered.
  try {
    const body = await (await checked(await request("/stack/v1/music", {}, 5_000))).json() as { music?: StackMusicStatus } & Partial<StackMusicStatus>;
    return body.music ?? (typeof body.available === "boolean" ? body as StackMusicStatus : null);
  } catch { return null; }
}
export async function stemsStatus(): Promise<StackStemsStatus | null> {
  try {
    const body = await (await checked(await request("/stack/v1/stems", {}, 5_000))).json() as { stems?: StackStemsStatus } & Partial<StackStemsStatus>;
    return body.stems ?? (typeof body.available === "boolean" ? body as StackStemsStatus : null);
  } catch { return null; }
}
export function stemsStatusReady(status: StackStemsStatus | null): boolean { return !!status && status.available && !["unsupported", "off", "not-installed"].includes(status.state); }
export async function submitStems(source: string, source_sha256: string): Promise<string> {
  const res = await checked(await request("/v1/audio/stems", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, source_sha256, model: "htdemucs" }) }, 60_000));
  const parsed = await res.json() as { job?: string };
  if (!parsed.job) throw new StackMusicError(502, "bad_reply");
  return parsed.job;
}
export async function getStemsJob(job: string): Promise<StackMusicJob> {
  return await (await checked(await request(`/v1/audio/stems/${encodeURIComponent(job)}`))).json() as StackMusicJob;
}
export async function fetchStem(url: string): Promise<Uint8Array> {
  const base = fetchForTests ? "http://127.0.0.1:1" : getStackUrl();
  if (!base) throw new StackMusicError(503, "no_stack");
  let parsed: URL;
  try { parsed = new URL(url, base); } catch { throw new StackMusicError(502, "bad_reply"); }
  if (parsed.origin !== new URL(base).origin) throw new StackMusicError(502, "bad_reply");
  const path = `${parsed.pathname}${parsed.search}`;
  return new Uint8Array(await (await checked(await request(path, {}, 120_000))).arrayBuffer());
}
