// WHISPER-01: a household voice's whisper sample.
//
// The live voice (Chatterbox Turbo) has no whisper tag, and no filter on its output sounded right (measured and listened to, 2026-11-13).
// What does work is giving it a real whisper as its voice sample. So each household voice gets a short whisper in its own voice, made once
// by the recorded engine (Fish Audio Drama 3, which has a real [whispers] cue) from the voice's own clip and transcript. A reply the model
// marks as whispered is then spoken from that sample. The file is derived data (no record), so deleting the voice removes it and a lost
// file is made again.
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { readClonedVoiceClip, whisperSamplePath } from "@/lib/clonedVoices";
import { fetchRecordedSpeech, recordedSpeechStatus, submitRecordedSpeech, waitForRecordedSpeech } from "@/lib/recordedSpeech";
import { transcribeClonedVoiceOnce } from "@/lib/clonedVoiceTranscript";
import { appendLogLine } from "@/lib/log";

/** About ten seconds of calm speech: the engine needs a sample of 6 to 30 seconds. */
export const WHISPER_SAMPLE_TEXT = "[whispers] Come closer. Don't wake the kids. I have something to tell you, and it is a secret, so keep your voice down.";
const RETRY_AFTER_MS = 10 * 60_000;

const inFlight = new Map<string, Promise<boolean>>();
const failedAt = new Map<string, number>();

export function hasWhisperSample(id: string): boolean {
  return existsSync(whisperSamplePath(id));
}

/** Makes the whisper sample for a household voice when it has none. True when one exists afterwards.
 * `onlyIfReady` makes it a no-op unless the recorded engine is already loaded, so saving a voice never starts a big model. */
export function ensureWhisperSample(id: string, opts: { onlyIfReady?: boolean } = {}): Promise<boolean> {
  if (hasWhisperSample(id)) return Promise.resolve(true);
  const running = inFlight.get(id);
  if (running) return running;
  const failed = failedAt.get(id);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.resolve(false);
  const job = make(id, opts).catch(() => false).then((ok) => {
    if (!ok) failedAt.set(id, Date.now()); else failedAt.delete(id);
    inFlight.delete(id);
    return ok;
  });
  inFlight.set(id, job);
  return job;
}

async function make(id: string, opts: { onlyIfReady?: boolean }): Promise<boolean> {
  const clip = readClonedVoiceClip(id);
  if (!clip) return false;
  const transcript = clip.transcript?.trim() || (await transcribeClonedVoiceOnce(id, clip.bytes, clip.mimeType))?.trim();
  if (!transcript) return false;
  // Saving a voice looks once and never waits for, or starts, the big model; a whisper reply that needs the sample waits for it as a render does.
  const status = opts.onlyIfReady ? await recordedSpeechStatus() : await waitForRecordedSpeech();
  if (!status?.available || !status.installed) return false;
  if (opts.onlyIfReady && !status.ready) return false;
  const submitted = await submitRecordedSpeech(WHISPER_SAMPLE_TEXT, clip.bytes, clip.mimeType, transcript);
  const audio = await fetchRecordedSpeech(submitted.job, submitted.done ? submitted.data : null);
  // A real WAV with some length to it (the engine wrote about ten seconds): an empty or cut-off reply is not a usable sample.
  if (!audio || audio.bytes.length < 100_000 || String.fromCharCode(...audio.bytes.slice(0, 4)) !== "RIFF") return false;
  const path = whisperSamplePath(id);
  writeFileSync(`${path}.tmp`, audio.bytes, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  appendLogLine("voice.whisper_sample made=yes");
  return true;
}

export function __resetWhisperSamplesForTests(): void {
  inFlight.clear();
  failedAt.clear();
}
