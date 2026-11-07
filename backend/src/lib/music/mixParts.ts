import { atBackgroundPriority } from "@/lib/backgroundPriority";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Part = "vocals" | "drums" | "bass" | "other" | "converted_vocals";
type Runner = (command: string[], cwd: string) => Promise<boolean>;
let runnerForTests: Runner | null = null;
let toolsForTests: { afconvert: string | null; ffmpeg: string | null } | null = null;
export function __setMusicMixRunnerForTests(runner: Runner | null): void { runnerForTests = runner; }
export function __setMusicMixToolsForTests(tools: { afconvert: string | null; ffmpeg: string | null } | null): void { toolsForTests = tools; }

export const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const PEAK_LIMIT = 0.89;
const RMS_FLOOR = 0.1; // -20 dBFS

export interface PcmWav { bytes: Uint8Array; dataOffset: number; dataLength: number; sampleRate: number; channels: number; bits: number; }

export function parseWav(bytes: Uint8Array): PcmWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE") throw new Error("mix_failed");
  let offset = 12, format = 0, subFormat = 0, channels = 0, sampleRate = 0, bits = 0, dataOffset = -1, dataLength = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error("mix_failed");
    if (id === "fmt " && length >= 16) { format = view.getUint16(start, true); channels = view.getUint16(start + 2, true); sampleRate = view.getUint32(start + 4, true); bits = view.getUint16(start + 14, true); if (format === 0xfffe && length >= 40) subFormat = view.getUint16(start + 24, true); }
    if (id === "data") { dataOffset = start; dataLength = length; break; }
    offset = start + length + (length & 1);
  }
  if ((format !== 1 && !(format === 0xfffe && subFormat === 1)) || channels !== CHANNELS || sampleRate !== SAMPLE_RATE || bits !== 16 || dataOffset < 0 || dataLength % 4 !== 0) throw new Error("mix_failed");
  return { bytes, dataOffset, dataLength, sampleRate, channels, bits };
}

/** Mix 44.1 kHz stereo signed 16-bit PCM WAVs, padding short inputs and controlling peak and quiet-mix gain. */
export function mixPcmWav(stems: readonly Uint8Array[]): Uint8Array {
  if (!stems.length) throw new Error("parts_unavailable");
  const parsed = stems.map(parseWav);
  const frameCount = Math.max(...parsed.map((wav) => wav.dataLength / 4));
  const sums = new Float64Array(frameCount * CHANNELS);
  for (const wav of parsed) {
    const view = new DataView(wav.bytes.buffer, wav.bytes.byteOffset, wav.bytes.byteLength);
    const samples = wav.dataLength / 2;
    for (let i = 0; i < samples; i++) sums[i] = (sums[i] ?? 0) + view.getInt16(wav.dataOffset + i * 2, true) / 32768;
  }
  let peak = 0, squareSum = 0;
  for (const value of sums) { const magnitude = Math.abs(value); if (magnitude > peak) peak = magnitude; squareSum += value * value; }
  const rms = Math.sqrt(squareSum / Math.max(1, sums.length));
  const peakGain = peak > 0 ? PEAK_LIMIT / peak : 1;
  const desiredGain = rms > 0 && rms < RMS_FLOOR ? Math.min(RMS_FLOOR / rms, peakGain) : 1;
  const gain = Math.min(peakGain, Math.max(1, desiredGain));
  const dataLength = sums.length * 2;
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) output[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, CHANNELS, true); view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * CHANNELS * 2, true); view.setUint16(32, CHANNELS * 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, dataLength, true);
  for (let i = 0; i < sums.length; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round((sums[i] ?? 0) * gain * 32768))), true);
  return output;
}

export async function run(command: string[], cwd: string): Promise<boolean> {
  if (runnerForTests) return runnerForTests(command, cwd);
  const prioritized = atBackgroundPriority(command);
  const child = Bun.spawn(prioritized, { cwd, stdout: "ignore", stderr: "ignore" });
  const code = await child.exited;
  if (code === 0) return true;
  // Restricted hosts can deny taskpolicy's priority adjustment; retry the utility itself.
  if (prioritized.length !== command.length || prioritized[0] !== command[0]) return await Bun.spawn(command, { cwd, stdout: "ignore", stderr: "ignore" }).exited === 0;
  return false;
}

/** The decoder and encoder this host has: afconvert on a Mac, else ffmpeg; null for each that is missing. */
export function musicAudioTools(): { afconvert: string | null; ffmpeg: string | null } {
  if (toolsForTests) return toolsForTests;
  return { afconvert: existsSync("/usr/bin/afconvert") ? "/usr/bin/afconvert" : null, ffmpeg: Bun.which("ffmpeg") };
}
export function hasRunnerForTests(): boolean { return runnerForTests !== null; }

/** Mix selected private stem bytes; work files are removed before returning. */
export async function mixMusicParts(stems: Partial<Record<Part, Uint8Array>>, keep: readonly Part[]): Promise<Uint8Array> {
  if (!keep.length || keep.some((part) => !stems[part])) throw new Error("parts_unavailable");
  const afconvert = toolsForTests ? toolsForTests.afconvert : (existsSync("/usr/bin/afconvert") ? "/usr/bin/afconvert" : null);
  const ffmpeg = toolsForTests ? toolsForTests.ffmpeg : Bun.which("ffmpeg");
  if (!runnerForTests && !afconvert && !ffmpeg) throw new Error("mix_unavailable");
  const dir = mkdtempSync(join(tmpdir(), "maipai-music-mix-"));
  try {
    const inputs = keep.map((part, index) => { const path = join(dir, `${index}.m4a`); writeFileSync(path, stems[part]!); return path; });
    const output = join(dir, "mix.m4a");
    if (afconvert || (runnerForTests && !ffmpeg)) {
      const wavs: Uint8Array[] = [];
      for (let index = 0; index < inputs.length; index++) {
        const wav = join(dir, `${index}.wav`);
        const input = inputs[index]!;
        if (!(await run([afconvert ?? "/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "2", input, wav], dir))) throw new Error("mix_failed");
        wavs.push(new Uint8Array(readFileSync(wav)));
      }
      const mixed = mixPcmWav(wavs);
      const mixWav = join(dir, "mix.wav"); writeFileSync(mixWav, mixed);
      if (!(await run([afconvert ?? "/usr/bin/afconvert", "-f", "m4af", "-d", "aac", "-b", "192000", mixWav, output], dir))) throw new Error("mix_failed");
    } else {
      const cmd = [ffmpeg!, "-hide_banner", "-loglevel", "error", "-y", ...inputs.flatMap((path) => ["-i", path]), "-filter_complex", `${inputs.map((_, i) => `[${i}:a]`).join("")}amix=inputs=${inputs.length}:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]`, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output];
      if (!(await run(cmd, dir))) throw new Error("mix_failed");
    }
    return new Uint8Array(readFileSync(output));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
