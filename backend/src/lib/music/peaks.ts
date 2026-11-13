// MP-10: waveform peaks for the Studio, made on the hub so the browser never has to decode a long song (decoding is the fragile part).
// One ffmpeg run per song file turns it into mono 8000 Hz raw samples; about 600 max-abs buckets (loudest scaled to 1) are cached as
// JSON beside the data, keyed by file id and the file's sha256, so a changed file gets fresh peaks. No title, lyric or path is logged.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { musicAudioTools } from "./mixParts";

export const PEAK_COUNT = 600;
const RATE = 8000;
export const PEAKS_NO_FFMPEG_LINE = "This computer has no audio tool to draw the waveform. The browser will draw it instead.";
export const PEAKS_FAILED_LINE = "The waveform could not be made for this song. The browser will draw it instead.";
export interface SongPeaks { peaks: number[]; duration: number }

type Decoder = (bytes: Uint8Array, ffmpeg: string) => Promise<Int16Array>;
let decoderForTests: Decoder | null = null;
export function __setPeaksDecoderForTests(decoder: Decoder | null): void { decoderForTests = decoder; }

/** Decode any audio to mono 8000 Hz signed 16-bit samples. The file goes to a private temp file first: an m4a often keeps its index at the end, which ffmpeg cannot read from a pipe. The samples come back on stdout. */
async function ffmpegDecode(bytes: Uint8Array, ffmpeg: string): Promise<Int16Array> {
  const dir = mkdtempSync(join(tmpdir(), "maipai-music-peaks-"));
  try {
    const input = join(dir, "song"); writeFileSync(input, bytes);
    const proc = Bun.spawn([ffmpeg, "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).arrayBuffer();
    if (await proc.exited !== 0 || out.byteLength < 2) throw new Error("peaks_failed");
    return new Int16Array(out.slice(0, out.byteLength - (out.byteLength % 2)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Bucket max-abs values, scale the loudest to 1, round to 3 decimals. Silence stays all zeros. */
export function bucketPeaks(samples: Int16Array, count = PEAK_COUNT): number[] {
  const n = Math.max(1, Math.min(count, samples.length));
  const out = new Array<number>(n).fill(0);
  for (let b = 0; b < n; b++) {
    const from = Math.floor(b * samples.length / n), to = Math.max(from + 1, Math.floor((b + 1) * samples.length / n));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i++) { const v = Math.abs(samples[i]!); if (v > peak) peak = v; }
    out[b] = peak;
  }
  const loudest = Math.max(...out);
  return loudest > 0 ? out.map((v) => Math.round((v / loudest) * 1000) / 1000) : out;
}

export async function computePeaks(bytes: Uint8Array): Promise<SongPeaks> {
  const ffmpeg = musicAudioTools().ffmpeg;
  if (!ffmpeg) throw new Error("peaks_unavailable");
  const samples = await (decoderForTests ?? ffmpegDecode)(bytes, ffmpeg);
  return { peaks: bucketPeaks(samples), duration: Math.round((samples.length / RATE) * 1000) / 1000 };
}

const cacheDir = () => join(dataDir, "music-peaks");
const safe = (text: string) => text.replace(/[^A-Za-z0-9_-]/g, "_");
const cachePath = (fileId: string, sha256: string) => join(cacheDir(), `${safe(fileId)}-${safe(sha256).slice(0, 32)}.json`);

/** The cached peaks for this exact file content, or null. */
export function cachedPeaks(fileId: string, sha256: string): SongPeaks | null {
  const path = cachePath(fileId, sha256);
  try {
    if (!existsSync(path)) return null;
    const got = JSON.parse(readFileSync(path, "utf8")) as SongPeaks;
    return Array.isArray(got.peaks) && typeof got.duration === "number" ? got : null;
  } catch { return null; }
}
export function savePeaks(fileId: string, sha256: string, peaks: SongPeaks): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    const path = cachePath(fileId, sha256), temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(peaks)); renameSync(temp, path);
  } catch { /* a cache that cannot be written only costs one more decode next time */ }
}
