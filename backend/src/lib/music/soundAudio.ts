// SOUNDS-FOLLOW-01: audio work for the Sounds maker. The maths is pure TypeScript on 44.1 kHz stereo 16-bit PCM WAV bytes
// (tested without any tool); decoding and encoding the m4a files go through afconvert or ffmpeg, as the stem mix does.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasRunnerForTests, musicAudioTools, parseWav, run, SAMPLE_RATE } from "./mixParts";

const CHANNELS = 2;
/** The tail fades into the head over this long (capped at a third of the sound). */
export const LOOP_FADE_SECONDS = 0.5;
const PEAK_CEILING = 0.98;

function pcmOf(wav: Uint8Array): Int16Array {
  const parsed = parseWav(wav);
  const out = new Int16Array(parsed.dataLength / 2);
  const view = new DataView(parsed.bytes.buffer, parsed.bytes.byteOffset, parsed.bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(parsed.dataOffset + i * 2, true);
  return out;
}
export function wavOfPcm(pcm: Int16Array): Uint8Array {
  const dataLength = pcm.length * 2;
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) output[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * CHANNELS * 2, true); view.setUint16(32, CHANNELS * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, dataLength, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i]!, true);
  return output;
}
const clip16 = (value: number): number => Math.max(-32768, Math.min(32767, Math.round(value)));

/**
 * Make a sound repeat without a seam. The last `fade` seconds are blended into the first `fade` seconds with an equal-power
 * crossfade and then dropped from the end, so the sample after the last one is the sample that followed the original tail.
 * The result is `fade` seconds shorter. A sound too short to fade (under 0.3 s) is returned unchanged.
 */
export function crossfadeLoopWav(wav: Uint8Array, fadeSeconds = LOOP_FADE_SECONDS): Uint8Array {
  const pcm = pcmOf(wav);
  const frames = pcm.length / CHANNELS;
  const fade = Math.min(Math.round(fadeSeconds * SAMPLE_RATE), Math.floor(frames / 3));
  if (fade < Math.round(0.1 * SAMPLE_RATE)) return wav;
  const keep = frames - fade;
  const out = new Int16Array(keep * CHANNELS);
  out.set(pcm.subarray(0, keep * CHANNELS));
  for (let i = 0; i < fade; i++) {
    const angle = (i / fade) * (Math.PI / 2);
    const tailGain = Math.cos(angle), headGain = Math.sin(angle);
    for (let c = 0; c < CHANNELS; c++) out[i * CHANNELS + c] = clip16(pcm[(keep + i) * CHANNELS + c]! * tailGain + pcm[i * CHANNELS + c]! * headGain);
  }
  return wavOfPcm(out);
}

/** Lay `sound` over `song` starting `startSeconds` in. The song keeps its length (the sound is cut where the song ends); the whole mix is only turned down if it would clip. */
export function mixSoundAtWav(song: Uint8Array, sound: Uint8Array, startSeconds: number): Uint8Array {
  const base = pcmOf(song), over = pcmOf(sound);
  const startFrame = Math.max(0, Math.round(startSeconds * SAMPLE_RATE));
  if (startFrame * CHANNELS >= base.length) throw new Error("start_after_end");
  const sums = new Float64Array(base.length);
  for (let i = 0; i < base.length; i++) sums[i] = base[i]!;
  for (let i = 0; i < over.length; i++) { const at = startFrame * CHANNELS + i; if (at >= sums.length) break; sums[at]! += over[i]!; }
  let peak = 0;
  for (const value of sums) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 32767 * PEAK_CEILING ? (32767 * PEAK_CEILING) / peak : 1;
  const out = new Int16Array(sums.length);
  for (let i = 0; i < sums.length; i++) out[i] = clip16(sums[i]! * gain);
  return wavOfPcm(out);
}

async function convert(bytes: Uint8Array, direction: "decode" | "encode"): Promise<Uint8Array> {
  const tools = musicAudioTools();
  if (!hasRunnerForTests() && !tools.afconvert && !tools.ffmpeg) throw new Error("mix_unavailable");
  const dir = mkdtempSync(join(tmpdir(), "maipai-sound-"));
  try {
    const input = join(dir, direction === "decode" ? "in.m4a" : "in.wav"), output = join(dir, direction === "decode" ? "out.wav" : "out.m4a");
    writeFileSync(input, bytes);
    const useAf = tools.afconvert || (hasRunnerForTests() && !tools.ffmpeg);
    const command = direction === "decode"
      ? (useAf ? [tools.afconvert ?? "/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "2", input, output] : [tools.ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", output])
      : (useAf ? [tools.afconvert ?? "/usr/bin/afconvert", "-f", "m4af", "-d", "aac", "-b", "192000", input, output] : [tools.ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
    if (!(await run(command, dir)) || !existsSync(output)) throw new Error("mix_failed");
    return new Uint8Array(readFileSync(output));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
export const m4aToWav = (bytes: Uint8Array) => convert(bytes, "decode");
export const wavToM4a = (bytes: Uint8Array) => convert(bytes, "encode");

/** The first `seconds` of a sound, with the last 30 ms faded out so the cut makes no click. A sound already that short is returned unchanged. */
export function trimWav(wav: Uint8Array, seconds: number): Uint8Array {
  const pcm = pcmOf(wav);
  const keep = Math.min(pcm.length / CHANNELS, Math.max(1, Math.round(seconds * SAMPLE_RATE)));
  if (keep * CHANNELS >= pcm.length) return wav;
  const out = pcm.slice(0, keep * CHANNELS);
  const fade = Math.min(keep, Math.round(0.03 * SAMPLE_RATE));
  for (let i = 0; i < fade; i++) for (let c = 0; c < CHANNELS; c++) { const at = (keep - fade + i) * CHANNELS + c; out[at] = clip16(out[at]! * (1 - (i + 1) / fade)); }
  return wavOfPcm(out);
}

/**
 * Shape a finished sound: cut it to the length that was asked (the music model cannot make less than its minimum) and/or make it loop seamlessly.
 * Never throws: a host without an audio tool, or a file that does not decode, returns null and the plain sound is kept.
 */
export async function shapeSoundM4a(bytes: Uint8Array, shape: { trimTo?: number; loop?: boolean }): Promise<Uint8Array | null> {
  try {
    let wav = await m4aToWav(bytes);
    if (shape.trimTo) wav = trimWav(wav, shape.trimTo);
    if (shape.loop) wav = crossfadeLoopWav(wav);
    const out = await wavToM4a(wav);
    return out.length >= 12 ? out : null;
  } catch { return null; }
}
/** The song with the sound laid in from `startSeconds`. Throws "start_after_end", "mix_unavailable" or "mix_failed". */
export async function addSoundToSongM4a(song: Uint8Array, sound: Uint8Array, startSeconds: number): Promise<Uint8Array> {
  const mixed = mixSoundAtWav(await m4aToWav(song), await m4aToWav(sound), startSeconds);
  return wavToM4a(mixed);
}
