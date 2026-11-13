// WHISPER-01: a household voice's whisper sample.
//
// The live voice (Chatterbox Turbo) has no whisper tag, and no filter on its output sounded right (measured and listened to, 2026-11-13).
// What does work is giving it a real whisper as its voice sample. So each household voice gets a short whisper in its own voice, made once
// by the recorded engine (Fish Audio Drama 3, which has a real [whispers] cue) from the voice's own clip and transcript. A reply the model
// marks as whispered is then spoken from that sample. The file is derived data (no record), so deleting the voice removes it and a lost
// file is made again.
//
// Nobody waits for it (owner rule, 2026-11-13): a sample is made when the voice is saved, and a scheduled job (voice.whisper_samples) makes
// every missing one as soon as the recorded engine is installed, for voices that were there before it, and again for any that failed.
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { db } from "@/db";
import { clonedVoices } from "@/db/schema";
import { readClonedVoiceClip, whisperSamplePath } from "@/lib/clonedVoices";
import { fetchRecordedSpeech, recordedSpeechStatus, submitRecordedSpeech, waitForRecordedSpeech } from "@/lib/recordedSpeech";
import { transcribeClonedVoiceOnce } from "@/lib/clonedVoiceTranscript";
import { appendLogLine } from "@/lib/log";

/** About ten seconds of calm speech: the engine needs a sample of 6 to 30 seconds. */
export const WHISPER_SAMPLE_TEXT = "[whispers] Come closer. Don't wake the kids. I have something to tell you, and it is a secret, so keep your voice down.";
const RETRY_AFTER_MS = 60_000; // short on purpose: a brand-new voice has no transcript for its first minute, and that attempt must not block the next

const inFlight = new Map<string, Promise<boolean>>();
const failedAt = new Map<string, number>();

export function hasWhisperSample(id: string): boolean {
  return existsSync(whisperSamplePath(id));
}

/** Makes the whisper sample for a household voice when it has none. True when one exists afterwards. */
export function ensureWhisperSample(id: string): Promise<boolean> {
  if (hasWhisperSample(id)) return Promise.resolve(true);
  const running = inFlight.get(id);
  if (running) return running;
  const failed = failedAt.get(id);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(false);
  const job = make(id).catch(() => false).then((ok) => {
    if (!ok) failedAt.set(id, Date.now()); else failedAt.delete(id);
    inFlight.delete(id);
    return ok;
  });
  inFlight.set(id, job);
  return job;
}

async function make(id: string): Promise<boolean> {
  const clip = readClonedVoiceClip(id);
  if (!clip) return false;
  const transcript = clip.transcript?.trim() || (await transcribeClonedVoiceOnce(id, clip.bytes, clip.mimeType))?.trim();
  if (!transcript) return false;
  return render(id, clip.bytes, clip.mimeType, transcript);
}

/** Renders the whisper from a reference clip and saves it as `<id>.whisper.wav`. False when the recorded engine is not installed or gives nothing usable. */
async function render(id: string, bytes: Uint8Array, mimeType: string, transcript: string): Promise<boolean> {
  const status = await waitForRecordedSpeech();
  if (!status?.available || !status.installed) return false;
  const submitted = await submitRecordedSpeech(WHISPER_SAMPLE_TEXT, bytes, mimeType, transcript);
  const audio = await fetchRecordedSpeech(submitted.job, submitted.done ? submitted.data : null);
  // A real WAV with some length to it (the engine wrote about ten seconds): an empty or cut-off reply is not a usable sample.
  if (!audio || audio.bytes.length < 100_000 || String.fromCharCode(...audio.bytes.slice(0, 4)) !== "RIFF") return false;
  const path = whisperSamplePath(id);
  writeFileSync(`${path}.tmp`, audio.bytes, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  appendLogLine("voice.whisper_sample made=yes");
  return true;
}

/** The engine's own built-in voice has no recording of its own, so it speaks a known passage once (about 15 seconds) and that clip, with its
 * words, is the reference the whisper is made from. Every voice that is not a home voice (the default, and a library voice chosen before
 * library voices became home voices) whispers from this sample. */
export const DEFAULT_VOICE_KEY = "default";
const DEFAULT_REFERENCE_TEXT = "The kettle is on the stove, and the morning light is coming in through the kitchen window. We can start whenever you are ready. There is no hurry today, so please take your time and speak at an easy pace.";

/** The engine streams its WAV with a placeholder size in the header (it does not know the length yet). The recorded engine reads the header, so the
 * real sizes are written in before the clip is used as a reference. */
export function withRealWavSizes(wav: Uint8Array): Uint8Array {
  const out = new Uint8Array(wav);
  const view = new DataView(out.buffer);
  const text = (at: number) => String.fromCharCode(...out.slice(at, at + 4));
  if (out.length < 44 || text(0) !== "RIFF" || text(8) !== "WAVE") return out;
  let at = 12;
  while (at + 8 <= out.length) {
    const size = view.getUint32(at + 4, true);
    if (text(at) === "data") { view.setUint32(at + 4, out.length - (at + 8), true); view.setUint32(4, out.length - 8, true); return out; }
    at += 8 + size + (size % 2);
  }
  return out;
}

export function ensureDefaultWhisperSample(): Promise<boolean> {
  if (hasWhisperSample(DEFAULT_VOICE_KEY)) return Promise.resolve(true);
  const running = inFlight.get(DEFAULT_VOICE_KEY);
  if (running) return running;
  const failed = failedAt.get(DEFAULT_VOICE_KEY);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(false);
  const job = (async () => {
    const status = await recordedSpeechStatus();
    if (!status?.available || !status.installed) return false;
    const { synthesizeSpeech } = await import("@/lib/tts");
    const spoken = await synthesizeSpeech(DEFAULT_REFERENCE_TEXT, undefined, { normalize: false });
    if (!spoken.ok) return false;
    const bytes = new Uint8Array(await new Response(spoken.value.stream).arrayBuffer());
    if (bytes.length < 100_000) return false;
    return render(DEFAULT_VOICE_KEY, withRealWavSizes(bytes), spoken.value.contentType || "audio/wav", DEFAULT_REFERENCE_TEXT);
  })().catch(() => false).then((ok) => {
    if (!ok) failedAt.set(DEFAULT_VOICE_KEY, Date.now()); else failedAt.delete(DEFAULT_VOICE_KEY);
    inFlight.delete(DEFAULT_VOICE_KEY);
    return ok;
  });
  inFlight.set(DEFAULT_VOICE_KEY, job);
  return job;
}

const PER_TICK = 4;

/** The scheduled job: make the whisper sample of every household voice that has none, a few at a time, once the recorded engine is installed.
 * Returns how many voices still lack one after this tick (0 when there was nothing to do, so the job stays quiet). */
export async function makeMissingWhisperSamples(): Promise<{ made: number; missing: number }> {
  const missing = db.select({ id: clonedVoices.id }).from(clonedVoices).all().map((row) => row.id).filter((id) => !hasWhisperSample(id));
  if (!hasWhisperSample(DEFAULT_VOICE_KEY)) missing.push(DEFAULT_VOICE_KEY);
  if (missing.length === 0) return { made: 0, missing: 0 };
  const status = await recordedSpeechStatus();
  if (!status?.available || !status.installed) return { made: 0, missing: missing.length };
  let made = 0;
  for (const id of missing.slice(0, PER_TICK)) if (await (id === DEFAULT_VOICE_KEY ? ensureDefaultWhisperSample() : ensureWhisperSample(id))) made++;
  return { made, missing: missing.length - made };
}

export function __resetWhisperSamplesForTests(): void {
  inFlight.clear();
  failedAt.clear();
}
