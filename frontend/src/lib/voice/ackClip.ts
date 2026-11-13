// INSTANT-FILLER-01a: grouped acknowledgement clips. WAV bytes are cached by resolved voice,
// engine and normalized text; decoded buffers remain session-local.
import { api } from "@/lib/api";
import { sharedPlaybackContext } from "@/lib/voice/playbackContext";

export const ACK_CLIP_GAIN = 0.8;
export const MAX_ACK_CLIP_MS = 700;
export const ACK_CACHE_NAME = "ack-clip/v1";
export const ACK_RENDER_ORDER = ["backchannel", "request", "question", "thinking", "good_news", "bad_news"] as const;
export type AckGroupId = typeof ACK_RENDER_ORDER[number];
export type AckClipGroups = Readonly<Partial<Record<AckGroupId, readonly string[]>>>;
export type AckClipKeyOptions = { voice?: string; engine?: string };

export interface AckClipHandle {
  readonly group: AckGroupId;
  readonly text: string;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly ended: boolean;
  readonly endedAt: number | null;
  readonly completed: boolean;
}
export interface AckClipPool {
  readonly size: number;
  readonly readyGroups: readonly AckGroupId[];
  play(now?: number): AckClipHandle | null;
  playGroup(group: AckGroupId, now?: number): AckClipHandle | null;
  stopAll(): void;
}
export interface AckRenderController {
  readonly pool: AckClipPool;
  readonly done: Promise<void>;
  setBusy(busy: boolean): void;
  stop(): void;
}

const normalizeText = (text: string) => text.normalize("NFKC").trim().replace(/\s+/g, " ");
const hashText = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(normalizeText(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
};
export async function ackClipCacheKey(text: string, options: AckClipKeyOptions = {}): Promise<string> {
  const voice = encodeURIComponent(options.voice ?? "default");
  const engine = encodeURIComponent(options.engine ?? "default");
  return `/${voice}/${engine}/${await hashText(text)}`;
}

function browserCache(): Promise<Cache | null> {
  try { return typeof caches === "undefined" ? Promise.resolve(null) : caches.open(ACK_CACHE_NAME).catch(() => null); }
  catch { return Promise.resolve(null); }
}
async function cachedBytes(text: string, options: AckClipKeyOptions): Promise<ArrayBuffer | null> {
  const cache = await browserCache(); if (!cache) return null;
  try { return await (await cache.match(await ackClipCacheKey(text, options)))?.arrayBuffer() ?? null; } catch { return null; }
}
async function saveBytes(text: string, options: AckClipKeyOptions, bytes: ArrayBuffer): Promise<void> {
  const cache = await browserCache(); if (!cache) return;
  try { await cache.put(await ackClipCacheKey(text, options), new Response(bytes.slice(0), { headers: { "Content-Type": "audio/wav" } })); } catch { /* memory pool remains usable */ }
}
async function pruneCache(groups: AckClipGroups, options: AckClipKeyOptions): Promise<void> {
  const cache = await browserCache(); if (!cache) return;
  try {
    const current = new Set<string>();
    for (const group of ACK_RENDER_ORDER) for (const text of groups[group] ?? []) current.add(await ackClipCacheKey(text, options));
    for (const request of await cache.keys()) if (!current.has(new URL(request.url).pathname)) await cache.delete(request);
  } catch { /* Cache API cleanup is best effort */ }
}

/** The voice engine pads clips with silence; retain only the audible portion plus 20 ms on each side. */
export const SILENCE_FLOOR = 0.01;
export function trimSilence(buffer: AudioBuffer, context: Pick<AudioContext, "createBuffer">): AudioBuffer {
  const data = buffer.getChannelData(0); let start = 0; while (start < data.length && Math.abs(data[start]!) < SILENCE_FLOOR) start++;
  let end = data.length - 1; while (end > start && Math.abs(data[end]!) < SILENCE_FLOOR) end--;
  if (start === 0 && end === data.length - 1) return buffer;
  const room = Math.round(buffer.sampleRate * 0.02); start = Math.max(0, start - room); end = Math.min(data.length - 1, end + room);
  const out = context.createBuffer(1, Math.max(1, end - start + 1), buffer.sampleRate); out.getChannelData(0).set(data.subarray(start, end + 1)); return out;
}

async function renderOne(text: string, voice: string | undefined, engine: string | undefined, context: AudioContext, signal: AbortSignal): Promise<AudioBuffer> {
  const keys = { voice, engine };
  let bytes = await cachedBytes(text, keys);
  if (!bytes) {
    const response = await api.streamSpeech(text, signal, voice ? { turnId: "", generation: 0, voice } : undefined);
    if (!response.ok || !response.body) throw new Error(`acknowledgement clip: speech ${response.status}`);
    const result = await response.arrayBuffer();
    const fixed = new Uint8Array(result.slice(0));
    if (fixed.length >= 44) {
      const view = new DataView(fixed.buffer);
      if (view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645) { view.setUint32(4, fixed.length - 8, true); view.setUint32(40, fixed.length - 44, true); }
    }
    bytes = fixed.buffer; await saveBytes(text, keys, bytes);
  }
  return trimSilence(await context.decodeAudioData(bytes.slice(0)), context);
}

/** Begin the serial render queue. It pauses at clip boundaries whenever busy is true. */
export function startAckClipRendering(groups: AckClipGroups, voice: string | undefined, options: { engine?: string; context?: AudioContext; signal?: AbortSignal; now?: () => number; initiallyBusy?: boolean; onTrace?: (event: "clip_play" | "clip_end", extra?: Record<string, number | boolean | string>) => void } = {}): AckRenderController {
  const context = options.context ?? sharedPlaybackContext(); const now = options.now ?? (() => performance.now());
  const abort = options.signal ?? new AbortController().signal; const buffers = new Map<AckGroupId, Array<{ text: string; buffer: AudioBuffer }>>();
  let busy = options.initiallyBusy ?? false; let stopped = false; let wake: (() => void) | null = null; let lastText: string | null = null;
  const waitIdle = () => busy && !stopped && !abort.aborted ? new Promise<void>((resolve) => { wake = resolve; }) : Promise.resolve();
  const pool: AckClipPool = {
    get size() { return [...buffers.values()].reduce((sum, rows) => sum + rows.length, 0); },
    get readyGroups() { return ACK_RENDER_ORDER.filter((id) => (buffers.get(id)?.length ?? 0) > 0); },
    play(at = now()) { return playFromGroup("backchannel", at); },
    playGroup(group, at = now()) { return playFromGroup(group, at); },
    stopAll() { for (const handle of [...playing]) closers.get(handle)?.(); closers.clear(); },
  };
  const playFromGroup = (group: AckGroupId, at: number): AckClipHandle | null => {
      const exact = buffers.get(group) ?? []; const fallback = group === "backchannel" ? [] : buffers.get("backchannel") ?? [];
      const rows = exact.length ? exact : fallback; if (!rows.length) return null;
      let index = Math.floor(Math.random() * rows.length); if (rows.length > 1 && rows[index]!.text === lastText) index = (index + 1) % rows.length;
      const row = rows[index]!; lastText = row.text;
      let source: AudioBufferSourceNode; let gain: GainNode;
      try { if (context.state === "suspended") void context.resume?.().catch(() => {}); source = context.createBufferSource(); source.buffer = row.buffer; gain = context.createGain(); gain.gain.value = ACK_CLIP_GAIN; source.connect(gain); gain.connect(context.destination); source.start(); } catch { return null; }
      const durationMs = Math.round(row.buffer.duration * 1000); const state = { ended: false, endedAt: null as number | null, completed: false };
      const handle: AckClipHandle = { group: exact.length ? group : "backchannel", text: row.text, durationMs, startedAt: at, get ended() { return state.ended; }, get endedAt() { return state.endedAt; }, get completed() { return state.completed; } };
      const release = () => { try { source.disconnect(); gain.disconnect(); } catch { /* fine */ } playing.delete(handle); };
      options.onTrace?.("clip_play", { ms: durationMs, group: handle.group });
      source.onended = () => { if (state.ended) return; state.ended = true; state.completed = true; state.endedAt = now(); release(); options.onTrace?.("clip_end", { completed: true, group: handle.group }); };
      closers.set(handle, () => { if (state.ended) return; state.ended = true; state.endedAt = now(); try { source.stop(); } catch { /* already ended */ } release(); options.onTrace?.("clip_end", { completed: false, group: handle.group }); });
      playing.add(handle); return handle;
  };
  const playing = new Set<AckClipHandle>(); const closers = new Map<AckClipHandle, () => void>();
  const done = (async () => {
    await pruneCache(groups, { voice, engine: options.engine });
    for (const group of ACK_RENDER_ORDER) {
      for (const text of groups[group] ?? []) {
        if (stopped || abort.aborted) return;
        await waitIdle(); if (stopped || abort.aborted) return;
        try { const buffer = await renderOne(text, voice, options.engine, context, abort); if (buffer.duration * 1000 <= MAX_ACK_CLIP_MS) buffers.set(group, [...(buffers.get(group) ?? []), { text, buffer }]); }
        catch { /* one unavailable clip does not stop later groups */ }
        await waitIdle();
      }
    }
  })();
  return { pool, done, setBusy(value) { busy = value; if (!busy) { const resume = wake; wake = null; resume?.(); } }, stop() { stopped = true; const resume = wake; wake = null; resume?.(); pool.stopAll(); } };
}

/** Compatibility wrapper for the original backchannel-only call site and tests. */
export async function renderAckClips(clips: readonly string[], voice: string | undefined, options: { context?: AudioContext; signal?: AbortSignal; now?: () => number; onTrace?: (event: "clip_play" | "clip_end", extra?: Record<string, number | boolean>) => void } = {}): Promise<AckClipPool> {
  const compatibleTrace = options.onTrace as ((event: "clip_play" | "clip_end", extra?: Record<string, number | boolean | string>) => void) | undefined;
  const controller = startAckClipRendering({ backchannel: clips }, voice, { ...options, onTrace: compatibleTrace, initiallyBusy: false }); await controller.done; return controller.pool;
}
