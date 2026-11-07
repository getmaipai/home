// AUDIO-PARITY-01 V5 (Inspired voice): a new voice based on an uploaded clip, not a copy. The bench
// (data-scratch/reports/v5-inspired-voice-bench.md, 2026-11-06) found the cheapest way: move the reference clip's
// pitch and formants together by about 2 semitones ("Different", similarity 0.67) or 4 ("Very different", 0.53),
// keep its speed, and store that as the reference of a normal recorded-speech voice. One speech call, no extra model.
// Pitch and formants move together when a clip is resampled, which also changes its speed; a time stretch (WSOLA)
// then puts the speed back. Pure TypeScript for WAV; MP3 and FLAC are first turned into WAV with afconvert or ffmpeg.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const INSPIRED_LEVELS = ["much_lower", "lower", "different", "very_different"] as const;
export type InspiredLevel = (typeof INSPIRED_LEVELS)[number];

/** The single definition of how far each level moves the reference (semitones; negative is lower). */
export const INSPIRED_SEMITONES: Record<InspiredLevel, number> = { much_lower: -4, lower: -2, different: 2, very_different: 4 };

/** How much of a clip a preview plays. */
export const PREVIEW_SECONDS = 4;

export function isInspiredLevel(value: unknown): value is InspiredLevel {
  return typeof value === "string" && (INSPIRED_LEVELS as readonly string[]).includes(value);
}

export interface PcmClip { samples: Float32Array; sampleRate: number }

/** Reads a PCM (8, 16, 24, 32 bit) or float WAV; channels are averaged. Null for anything else. */
export function decodeWavClip(bytes: Uint8Array): PcmClip | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format = 0, channels = 1, sampleRate = 0, bits = 16;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    let size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
      const per = bits / 8;
      const frames = Math.floor(size / (per * channels));
      if (!sampleRate || frames <= 0 || channels < 1) return null;
      const read = (at: number): number | null => {
        if (format === 3 && bits === 32) return view.getFloat32(at, true);
        if (format !== 1) return null;
        if (bits === 16) return view.getInt16(at, true) / 32768;
        if (bits === 8) return (bytes[at]! - 128) / 128;
        if (bits === 24) return (((bytes[at + 2]! << 24) | (bytes[at + 1]! << 16) | (bytes[at]! << 8)) >> 8) / 8388608;
        if (bits === 32) return view.getInt32(at, true) / 2147483648;
        return null;
      };
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const value = read(body + (i * channels + c) * per);
          if (value === null) return null;
          sum += value;
        }
        samples[i] = sum / channels;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** Mono 16-bit WAV. */
export function encodeWavClip(clip: PcmClip): Uint8Array {
  const n = clip.samples.length;
  const out = new Uint8Array(44 + n * 2);
  const view = new DataView(out.buffer);
  const put = (o: number, text: string) => { for (let i = 0; i < text.length; i++) out[o + i] = text.charCodeAt(i); };
  put(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); put(8, "WAVE"); put(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, clip.sampleRate, true); view.setUint32(28, clip.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, "data"); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, clip.samples[i]!)) * 32767), true);
  return out;
}

/** Catmull-Rom resample: the clip played `ratio` times faster, so pitch and formants rise by `ratio` and it gets shorter. */
function resample(samples: Float32Array, ratio: number): Float32Array {
  const length = Math.max(1, Math.floor((samples.length - 1) / ratio));
  const out = new Float32Array(length);
  const at = (i: number) => samples[Math.min(samples.length - 1, Math.max(0, i))]!;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const base = Math.floor(position);
    const t = position - base;
    const p0 = at(base - 1), p1 = at(base), p2 = at(base + 1), p3 = at(base + 2);
    out[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

/** Waveform-similarity overlap-add: the same pitch, `targetLength` samples long. */
function stretchTo(samples: Float32Array, targetLength: number, sampleRate: number): Float32Array {
  const frame = Math.max(64, Math.round(sampleRate * 0.04) & ~1);
  const hop = frame / 2;
  const tolerance = Math.round(frame / 4);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const out = new Float32Array(targetLength + frame);
  const weight = new Float32Array(targetLength + frame);
  const scale = (samples.length - frame) / Math.max(1, targetLength - frame);
  let previous = -1; // start of the last chosen input segment
  for (let outStart = 0; outStart < targetLength; outStart += hop) {
    const ideal = Math.round(outStart * scale);
    let chosen = Math.min(Math.max(0, ideal), Math.max(0, samples.length - frame));
    if (previous >= 0) {
      const wanted = previous + hop; // where the last segment would naturally continue
      let best = -Infinity;
      for (let candidate = Math.max(0, ideal - tolerance); candidate <= Math.min(samples.length - frame, ideal + tolerance); candidate += 2) {
        let score = 0;
        for (let i = 0; i < hop; i += 2) score += (samples[candidate + i] ?? 0) * (samples[wanted + i] ?? 0);
        if (score > best) { best = score; chosen = candidate; }
      }
    }
    previous = chosen;
    for (let i = 0; i < frame; i++) {
      const target = outStart + i;
      if (target >= out.length) break;
      out[target] = (out[target] ?? 0) + (samples[chosen + i] ?? 0) * window[i]!;
      weight[target] = (weight[target] ?? 0) + window[i]!;
    }
  }
  const result = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) result[i] = weight[i]! > 1e-3 ? out[i]! / weight[i]! : 0;
  return result;
}

/** Moves pitch and formants together by `semitones` and keeps the clip's length. */
export function shiftPitchAndFormants(clip: PcmClip, semitones: number): PcmClip {
  if (!semitones) return clip;
  const resampled = resample(clip.samples, 2 ** (semitones / 12));
  return { samples: stretchTo(resampled, clip.samples.length, clip.sampleRate), sampleRate: clip.sampleRate };
}

export const __converterForTests: { run: ((input: string, output: string) => Promise<boolean>) | null } = { run: null };

/** WAV bytes for an uploaded WAV, MP3 or FLAC clip; null when it cannot be read (no converter on this computer, or a damaged file). */
export async function clipToWav(bytes: Uint8Array, extension: string): Promise<Uint8Array | null> {
  if (decodeWavClip(bytes)) return bytes;
  const afconvert = existsSync("/usr/bin/afconvert") ? "/usr/bin/afconvert" : null;
  const ffmpeg = Bun.which("ffmpeg");
  if (!__converterForTests.run && !afconvert && !ffmpeg) return null;
  const dir = mkdtempSync(join(tmpdir(), "maipai-inspired-"));
  try {
    const input = join(dir, `in.${extension}`);
    const output = join(dir, "out.wav");
    writeFileSync(input, bytes, { mode: 0o600 });
    const command = afconvert ? [afconvert, "-f", "WAVE", "-d", "LEI16", input, output] : [ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-ac", "1", output];
    const ok = __converterForTests.run ? await __converterForTests.run(input, output) : (await Bun.spawn(command, { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited) === 0;
    return ok && existsSync(output) ? new Uint8Array(readFileSync(output)) : null;
  } catch { return null; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Linear resample to another sample rate (same speed and pitch). */
function resampleRate(clip: PcmClip, rate: number): Float32Array {
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

/** Blends two clips with equal weight. The result has the first clip's rate and length; the second is resampled to that rate
 * and repeated if it is shorter. */
export function mixClips(first: PcmClip, second: PcmClip): PcmClip {
  const other = resampleRate(second, first.sampleRate);
  const samples = new Float32Array(first.samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] = (first.samples[i]! + other[i % other.length]!) / 2;
  return { samples, sampleRate: first.sampleRate };
}

/** The shifted reference for an Inspired voice, as WAV bytes; null when the clip cannot be read. With `base`, the shifted clip is
 * blended with that voice's reference clip; null too when the base cannot be read. */
export async function makeInspiredReference(bytes: Uint8Array, extension: string, level: InspiredLevel, base?: { bytes: Uint8Array; extension: string } | null, maxSeconds?: number): Promise<Uint8Array | null> {
  const wav = await clipToWav(bytes, extension);
  let clip = wav ? decodeWavClip(wav) : null;
  if (!clip) return null;
  if (maxSeconds) clip = { samples: clip.samples.slice(0, Math.round(clip.sampleRate * maxSeconds)), sampleRate: clip.sampleRate };
  let result = shiftPitchAndFormants(clip, INSPIRED_SEMITONES[level]);
  if (base) {
    const baseWav = await clipToWav(base.bytes, base.extension);
    const baseClip = baseWav ? decodeWavClip(baseWav) : null;
    if (!baseClip) return null;
    result = mixClips(result, baseClip);
  }
  return encodeWavClip(result);
}
