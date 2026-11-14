// VOICE-SAMPLES-01 (2026-11-14): a voice can be made from up to three recordings. Each is cleaned (silence trimmed from both ends,
// volume matched) and they are joined, with a short pause between, into the one reference clip the speech engine takes.
// The engine accepts a reference of 6 to 30 seconds, so the joined clip is kept under MAX_SECONDS.
import { clipToWav, decodeWavClip, encodeWavClip, type PcmClip } from "@/lib/voiceShift";

export const MAX_SAMPLES = 3;
export const MAX_SECONDS = 28;
const RATE = 24000;
const GAP_SECONDS = 0.3;
const SILENCE_LEVEL = 0.015;
const PEAK_TARGET = 0.9;
const PAD_SECONDS = 0.3;
const FADE_SECONDS = 0.02;

function fade(samples: Float32Array): void {
  const n = Math.min(Math.floor(FADE_SECONDS * RATE), Math.floor(samples.length / 2));
  for (let i = 0; i < n; i++) { const g = i / n; samples[i]! *= g; samples[samples.length - 1 - i]! *= g; }
}

function resampleTo(clip: PcmClip, rate: number): Float32Array {
  if (clip.sampleRate === rate) return clip.samples;
  const length = Math.max(1, Math.floor((clip.samples.length * rate) / clip.sampleRate));
  const out = new Float32Array(length);
  const step = clip.sampleRate / rate;
  for (let i = 0; i < length; i++) {
    const position = i * step;
    const base = Math.floor(position);
    const t = position - base;
    const a = clip.samples[Math.min(base, clip.samples.length - 1)]!;
    const b = clip.samples[Math.min(base + 1, clip.samples.length - 1)]!;
    out[i] = a + (b - a) * t;
  }
  return out;
}

/** Drops quiet audio from the start and end (a 50 ms window counts as quiet when its loudest sample is under the level). */
export function trimSilence(samples: Float32Array, rate: number): Float32Array {
  const window = Math.max(1, Math.floor(rate * 0.05));
  const loud = (from: number) => { for (let i = from; i < Math.min(samples.length, from + window); i++) if (Math.abs(samples[i]!) >= SILENCE_LEVEL) return true; return false; };
  let start = 0;
  while (start < samples.length && !loud(start)) start += window;
  let end = samples.length;
  while (end > start && !loud(Math.max(start, end - window))) end -= window;
  return samples.slice(Math.max(0, start - window), Math.min(samples.length, end + window));
}

/** Scales the clip so its loudest sample reaches the target, so a quiet recording and a loud one sit at the same level. */
export function normalizePeak(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak < 1e-4) return samples;
  const gain = PEAK_TARGET / peak;
  return samples.map((value) => value * gain);
}

/** Cleans each recording and joins them into one WAV, or says why it could not. Each recording gets an equal share of the 29 seconds. */
export async function joinReferenceClips(clips: { bytes: Uint8Array; extension: string }[]): Promise<{ ok: true; wav: Uint8Array; seconds: number } | { ok: false; error: string }> {
  if (clips.length === 0) return { ok: false, error: "Add at least one recording." };
  if (clips.length > MAX_SAMPLES) return { ok: false, error: `Use up to ${MAX_SAMPLES} recordings.` };
  const share = Math.floor((MAX_SECONDS - GAP_SECONDS * (clips.length - 1)) / clips.length * RATE);
  const parts: Float32Array[] = [];
  for (const clip of clips) {
    const wav = await clipToWav(clip.bytes, clip.extension);
    const pcm = wav ? decodeWavClip(wav) : null;
    if (!pcm) return { ok: false, error: `A recording could not be read. Save it as a WAV, MP3 or FLAC file and choose it again.` };
    const cleaned = normalizePeak(trimSilence(resampleTo(pcm, RATE), RATE));
    if (cleaned.length < RATE) return { ok: false, error: "A recording is almost silent or under one second. Record a clearer, longer clip." };
    parts.push(cleaned.length > share ? cleaned.slice(0, share) : cleaned);
  }
  const gap = Math.floor(GAP_SECONDS * RATE);
  const total = parts.reduce((sum, part) => sum + part.length, 0) + gap * (parts.length - 1);
  // A short pause before and after, and a soft fade where a clip was cut, so the engine never starts or ends on a hard edge
  // (the first word of a reply came out clipped, "lo" for "hello", on 2026-11-14).
  const pad = Math.floor(PAD_SECONDS * RATE);
  const joined = new Float32Array(total + pad * 2);
  let offset = pad;
  for (const part of parts) { fade(part); joined.set(part, offset); offset += part.length + gap; }
  return { ok: true, wav: encodeWavClip({ samples: joined, sampleRate: RATE }), seconds: joined.length / RATE };
}

export type StyleName = "whisper" | "anger";

/** A whisper or angry recording: cleaned the same way, and it must be 6 to 30 seconds because the engine uses it as a voice sample. */
export async function prepareStyleClip(bytes: Uint8Array, extension: string, style: StyleName): Promise<{ ok: true; wav: Uint8Array } | { ok: false; error: string }> {
  const joined = await joinReferenceClips([{ bytes, extension }]);
  if (!joined.ok) return { ok: false, error: `The ${style === "whisper" ? "whisper" : "angry"} recording: ${joined.error}` };
  if (joined.seconds < 6.5) return { ok: false, error: `The ${style === "whisper" ? "whisper" : "angry"} recording is too short. Record 10 to 25 seconds of it.` };
  return { ok: true, wav: joined.wav };
}
