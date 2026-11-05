// MUSIC-GEN-03: Stack section 12. Words and source bytes travel only in bodies, never in logs or errors.
import type { MusicRequest } from "./types";
import { getStackUrl } from "@/lib/stackEngine";
export type MusicState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface StackSong { url?: string; duration_s: number; seed: number; lrc?: string; bpm?: number; key?: string; model?: string }
/** What the Stack lists for a finished split: each stem by name, fetched at its url; every stem is as long as the song. */
export interface StackStem { url: string; stem: "vocals" | "drums" | "bass" | "other" }
export interface StackStemsStatus { available: boolean; state: string; install?: unknown }
export interface StackVoiceConvertStatus { available: boolean; state: string; ready?: boolean; install?: unknown }
export interface StackVoiceConvertData { url: string; content_type: "audio/mp4"; bytes: number; sha256: string }
export interface StackVoiceConvertJob { state: MusicState; stage?: string | null; stage_label?: string | null; progress_fraction?: number | null; eta_seconds?: number | null; position?: number | null; code?: string | null; data?: StackVoiceConvertData | null }
export interface StackMusicStatus {
  available: boolean; state: string; limits: { min_seconds: number; max_seconds: number };
  quality: string[]; default_quality?: "quick" | "detailed" | "max"; install?: unknown;
  /** MUSIC-MAX-01: the Max maker (XL SFT). The Stack lists `max` in `quality` as soon as it offers it; without the models installed it runs the song as Boost. */
  max_model?: { id: string; installed: boolean; models?: unknown[]; remaining_bytes?: number | null } | null;
}
export interface MusicBody {
  task: "text2music" | "cover" | "repaint" | "extend" | "edit";
  caption: string; lyrics?: string; instrumental?: boolean; duration_s: number;
  bpm?: number; key?: string; language?: string; seed?: number; quality?: "quick" | "detailed" | "max";
  /** TIER-HOME-04: the level the song runs at, from the slot (`slotBodyFor` in lib/music/jobs.ts); left out at Standard. */ tier?: "boost" | "max";
  source?: string; source_sha256?: string; from_s?: number; to_s?: number; add_s?: number; at?: "start" | "end";
  strength?: number; edit?: { op: "trim" | "fade" | "loudness"; from_s?: number; to_s?: number; seconds?: number; where?: "in" | "out" | "both"; lufs?: number };
  /** Stems only: an audio file the person owns, which the Stack may split and nothing else. */ origin?: "owned_file";
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
  constructor(readonly status: number, readonly code: string) { super("The song could not be made. Try again."); this.name = "StackMusicError"; }
}
let fetchForTests: typeof fetch | null = null;
/** Whether a Stack address is set (or a test fake stands in), so a caller can skip reading a big file for a Stack that is not there. */
export function musicStackConfigured(): boolean { return fetchForTests !== null || !!getStackUrl(); }
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
export async function submitStems(source: string, source_sha256: string, origin?: "owned_file"): Promise<string> {
  const res = await checked(await request("/v1/audio/stems", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, source_sha256, model: "htdemucs", ...(origin ? { origin } : {}) }) }, 60_000));
  const parsed = await res.json() as { job?: string };
  if (!parsed.job) throw new StackMusicError(502, "bad_reply");
  return parsed.job;
}
export async function getStemsJob(job: string): Promise<StackMusicJob> {
  return await (await checked(await request(`/v1/audio/stems/${encodeURIComponent(job)}`))).json() as StackMusicJob;
}
export async function deleteStemsJob(job: string): Promise<void> {
  try { await (await request(`/v1/audio/stems/${encodeURIComponent(job)}`, { method: "DELETE" })).arrayBuffer(); } catch { /* Stack retention is the fallback */ }
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

export async function submitVoiceConvert(source: string, reference: string): Promise<{ job: string; done: StackVoiceConvertData | null }> {
  const res = await checked(await request("/v1/audio/voice-convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, reference, pitch_shift: 0, auto_shift: false, timeout_ms: 1 }) }, 60_000));
  const parsed = await res.json() as { job?: string; data?: StackVoiceConvertData | null };
  if (!parsed.job) throw new StackMusicError(502, "bad_reply");
  return { job: parsed.job, done: res.status === 200 ? parsed.data ?? null : null };
}
export async function getVoiceConvertJob(job: string): Promise<StackVoiceConvertJob> {
  return await (await checked(await request(`/v1/audio/voice-convert/${encodeURIComponent(job)}`))).json() as StackVoiceConvertJob;
}
export async function deleteVoiceConvertJob(job: string): Promise<void> {
  try { await (await request(`/v1/audio/voice-convert/${encodeURIComponent(job)}`, { method: "DELETE" })).arrayBuffer(); } catch { /* Stack retention is the fallback */ }
}
export async function fetchConverted(url: string): Promise<Uint8Array> { return fetchStem(url); }
export async function voiceConvertStatus(): Promise<StackVoiceConvertStatus | null> {
  try { const body = await (await checked(await request("/stack/v1/voice-convert", {}, 5_000))).json() as { voice_convert?: StackVoiceConvertStatus };
    return body.voice_convert ?? null;
  } catch { return null; }
}
export function voiceConvertReady(status: StackVoiceConvertStatus | null): boolean { return !!status?.available && status.ready === true; }

/** MUSIC-GEN-20b: per-word lyric timing (`POST /v1/audio/align`). Lyrics and source bytes travel only in bodies; errors carry a code and counts, never words. */
export interface StackAlignWord { t: number; end: number; text: string }
export interface StackAlignData { words: StackAlignWord[]; aligned_words: number; total_words: number; line_starts: number[] }
export interface StackAlignJob { state: MusicState; code?: string | null; data?: StackAlignData | null }
/** MUSIC-GEN-20c: align only this stretch of the song (seconds from its start); the reply's times stay on the song's own clock. */
export interface AlignWindow { from_s: number; to_s: number }
/** The Stack's longest alignable song. */
export const ALIGN_MAX_SECONDS = 240;
function alignData(value: unknown): StackAlignData | null {
  const data = value as Partial<StackAlignData> | null | undefined;
  if (!data || !Array.isArray(data.words) || !Array.isArray(data.line_starts)) return null;
  const words = data.words.filter((w): w is StackAlignWord => !!w && Number.isFinite(w.t) && Number.isFinite(w.end) && typeof w.text === "string");
  if (words.length !== data.words.length) return null;
  return { words, aligned_words: Number(data.aligned_words) || words.length, total_words: Number(data.total_words) || words.length, line_starts: data.line_starts.map((n) => Number.isInteger(n) ? n : -1) };
}
export async function submitAlign(source: string, source_sha256: string, lyrics: string, origin: "made_here" | "owned_file" = "made_here", waitMs = 1, window?: AlignWindow): Promise<{ job: string; done: StackAlignData | null }> {
  const res = await checked(await request("/v1/audio/align", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, source_sha256, lyrics, origin, timeout_ms: waitMs, ...(window ? { from_s: window.from_s, to_s: window.to_s } : {}) }) }, 120_000));
  const parsed = await res.json() as { job?: string; data?: unknown };
  if (!parsed.job) throw new StackMusicError(502, "bad_reply");
  return { job: parsed.job, done: res.status === 200 ? alignData(parsed.data) : null };
}
export async function getAlignJob(job: string): Promise<StackAlignJob> {
  const body = await (await checked(await request(`/v1/audio/align/${encodeURIComponent(job)}`))).json() as { state?: string; code?: string | null; data?: unknown };
  return { state: (body.state ?? "failed") as MusicState, code: body.code ?? null, data: alignData(body.data) };
}
export async function deleteAlign(job: string): Promise<void> {
  try { await (await request(`/v1/audio/align/${encodeURIComponent(job)}`, { method: "DELETE" })).arrayBuffer(); } catch { /* the Stack holds the newest twelve only */ }
}
/** Submit, then poll until done: the timed words, or null when the Stack finished with none. Throws StackMusicError (code only) on a refusal or failure. */
export async function alignSong(source: string, source_sha256: string, lyrics: string, opts: { pollMs?: number; maxMs?: number; signal?: AbortSignal; origin?: "made_here" | "owned_file"; window?: AlignWindow } = {}): Promise<StackAlignData | null> {
  const { job, done } = await submitAlign(source, source_sha256, lyrics, opts.origin ?? "made_here", 1, opts.window);
  if (done) { await deleteAlign(job); return done; }
  const deadline = Date.now() + (opts.maxMs ?? 15 * 60_000);
  try {
    while (Date.now() < deadline && !opts.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 2000));
      const status = await getAlignJob(job);
      if (status.state === "done") return status.data ?? null;
      if (status.state === "failed" || status.state === "cancelled") throw new StackMusicError(500, status.code ?? "failed");
    }
    throw new StackMusicError(504, "timeout");
  } finally { await deleteAlign(job); }
}
