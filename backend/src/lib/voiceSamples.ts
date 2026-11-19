// VOICE-SAMPLES-01 (2026-11-14): a voice can be made from up to three recordings. Each is cleaned (silence trimmed from both ends,
// volume matched) and they are joined, with a short pause between, into the one reference clip the speech engine takes.
// The engine accepts a reference of 6 to 30 seconds, so the joined clip is kept under MAX_SECONDS.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipToWav, decodeWavClip, encodeWavClip, type PcmClip } from "@/lib/voiceShift";
import { createHash } from "node:crypto";
import { findFfmpeg } from "@/lib/ffmpegPath";
import { appendLogLine } from "@/lib/log";
import { deleteStemsJob, enhanceSpeech, fetchStem, getStemsJob, stemsAvailable, submitStems, type StackStem } from "@/lib/music/stack";

/** VOICE-CLEAN-01: what the person chose to clean from a recording before it is used as a voice sample. */
export interface CleanOptions { noise?: boolean; echo?: boolean; isolate?: boolean }

/** The ffmpeg filter chain for the chosen options (null when nothing is chosen). Noise: rumble cut, then spectral and non-local-means denoising.
 * Echo (fallback only): a low cut plus a gate that closes between words, which shortens the room's tail but does not remove it; the real
 * removal is the Stack's speech enhancer (removeEcho), used first when it is installed. */
export const __enhanceForTests: { run: ((wav: Uint8Array) => Promise<Uint8Array | null>) | null } = { run: null };
export const ECHO_FALLBACK_NOTICE = "The echo remover is not installed, so a lighter echo fix was used. Install it in Settings, AI and models (Voice: echo and noise remover) for a drier voice.";
/** Real echo removal: the Stack's speech enhancer. Null when it is not installed or fails; the caller falls back to the ffmpeg gate and says so. */
export async function removeEcho(wav: Uint8Array): Promise<Uint8Array | null> {
  return __enhanceForTests.run ? __enhanceForTests.run(wav) : enhanceSpeech(wav);
}
export const __isolateForTests: { run: ((wav: Uint8Array) => Promise<Uint8Array | { reason: string } | null>) | null } = { run: null };
const ISOLATE_WAIT_MS = 4 * 60_000;
const ISOLATE_POLL_MS = 1_500;

/** Keeps only the voice: the Stack's stem splitter (the same one that splits a song) separates it from music and other sounds, and its vocals
 * track is the clip. Null when the splitter is not installed or ready, or gives nothing; the caller says so. */
export async function isolateVoice(wav: Uint8Array): Promise<Uint8Array | { reason: string }> {
  if (__isolateForTests.run) return (await __isolateForTests.run(wav)) ?? { reason: "the splitter gave nothing" };
  if (!await stemsAvailable("minor")) return { reason: "the splitter is not installed or not ready" };
  let job: string | null = null;
  try {
    job = await submitStems(Buffer.from(wav).toString("base64"), createHash("sha256").update(wav).digest("hex"), "owned_file");
    const deadline = Date.now() + ISOLATE_WAIT_MS;
    while (Date.now() < deadline) {
      const status = await getStemsJob(job);
      if (status.state === "failed" || status.state === "cancelled") {
        appendLogLine(`voice.isolate made=no state=${status.state} code=${status.code ?? "none"}`);
        return { reason: status.code === "no_memory" ? "there is not enough free memory right now (close other large programs, wait a minute and try again)" : `the splitter stopped (${status.code ?? status.state})` };
      }
      if (status.state === "done") {
        const vocals = ((status.data ?? []) as unknown as StackStem[]).find((entry) => entry.stem === "vocals");
        if (!vocals) return { reason: "the splitter returned no voice track" };
        return (await clipToWav(await fetchStem(vocals.url), "m4a")) ?? { reason: "the voice track could not be read back" };
      }
      await new Promise((resolve) => setTimeout(resolve, ISOLATE_POLL_MS));
    }
    appendLogLine("voice.isolate made=no reason=timeout");
    return { reason: "it took longer than 4 minutes" };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "error";
    appendLogLine(`voice.isolate made=no reason=request code=${code}`);
    return { reason: `the Stack refused or did not answer (${code})` };
  }
  finally { if (job) void deleteStemsJob(job); }
}

export function cleanFilter(options: CleanOptions): string | null {
  const chain: string[] = [];
  if (options.noise || options.echo) chain.push(`highpass=f=${options.echo ? 110 : 80}`);
  if (options.noise) chain.push("afftdn=nr=20:nf=-38:tn=1", "anlmdn=s=6");
  if (options.echo) chain.push("agate=threshold=0.03:ratio=4:attack=3:release=60:knee=2");
  return chain.length ? chain.join(",") : null;
}

export const __cleanForTests: { run: ((input: string, output: string, filter: string) => Promise<boolean>) | null } = { run: null };

/** Runs the chosen cleaning on a WAV; null when it cannot run (no ffmpeg on this computer). */
export async function cleanWav(wav: Uint8Array, options: CleanOptions): Promise<Uint8Array | null> {
  const filter = cleanFilter(options);
  if (!filter) return wav;
  const ffmpeg = findFfmpeg();
  if (!ffmpeg && !__cleanForTests.run) return null;
  const dir = mkdtempSync(join(tmpdir(), "maipai-clean-"));
  try {
    const input = join(dir, "in.wav"), output = join(dir, "out.wav");
    writeFileSync(input, wav, { mode: 0o600 });
    const ok = __cleanForTests.run ? await __cleanForTests.run(input, output, filter) : (await Bun.spawn([ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af", filter, "-ac", "1", output], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited) === 0;
    return ok && existsSync(output) ? new Uint8Array(readFileSync(output)) : null;
  } catch { return null; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

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
export async function joinReferenceClips(clips: { bytes: Uint8Array; extension: string }[], clean: CleanOptions = {}): Promise<{ ok: true; wav: Uint8Array; seconds: number; notice?: string } | { ok: false; error: string }> {
  let notice: string | undefined;
  if (clips.length === 0) return { ok: false, error: "Add at least one recording." };
  if (clips.length > MAX_SAMPLES) return { ok: false, error: `Use up to ${MAX_SAMPLES} recordings.` };
  const share = Math.floor((MAX_SECONDS - GAP_SECONDS * (clips.length - 1)) / clips.length * RATE);
  const parts: Float32Array[] = [];
  for (const clip of clips) {
    let raw = await clipToWav(clip.bytes, clip.extension);
    if (raw && clean.isolate) {
      const isolated = await isolateVoice(raw);
      if (!(isolated instanceof Uint8Array)) return { ok: false, error: `Isolating the voice did not work: ${isolated.reason}. Try again, or turn off Isolate the voice.` };
      raw = isolated;
    }
    let cleanNow = clean;
    if (raw && clean.echo) {
      const dry = await removeEcho(raw);
      if (dry) { raw = dry; cleanNow = { ...clean, echo: false }; } else notice = ECHO_FALLBACK_NOTICE;
    }
    const wav = raw && (cleanNow.noise || cleanNow.echo) ? await cleanWav(raw, cleanNow) : raw;
    if (raw && !wav) return { ok: false, error: "Cleaning the recording needs ffmpeg, which is not installed on this computer. Turn off the cleaning options and try again." };
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
  return { ok: true, wav: encodeWavClip({ samples: joined, sampleRate: RATE }), seconds: joined.length / RATE, ...(notice ? { notice } : {}) };
}

export type StyleName = "whisper" | "anger";

/** A whisper or angry recording: cleaned the same way, and it must be 6 to 30 seconds because the engine uses it as a voice sample. */
export async function prepareStyleClip(bytes: Uint8Array, extension: string, style: StyleName, clean: CleanOptions = {}): Promise<{ ok: true; wav: Uint8Array } | { ok: false; error: string }> {
  const joined = await joinReferenceClips([{ bytes, extension }], clean);
  if (!joined.ok) return { ok: false, error: `The ${style === "whisper" ? "whisper" : "angry"} recording: ${joined.error}` };
  if (joined.seconds < 6.5) return { ok: false, error: `The ${style === "whisper" ? "whisper" : "angry"} recording is too short. Record 10 to 25 seconds of it.` };
  return { ok: true, wav: joined.wav };
}
