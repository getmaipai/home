// MUSIC-ID-01: the two outside programs song identification uses, each behind one small function so tests inject a fake.
// ffmpeg decodes the clip to 16000 Hz mono 16-bit PCM in memory (stdin and stdout pipes, nothing written to disk); Chromaprint's
// `fpcalc` turns PCM into a fingerprint (the same pipes). Rule 6: nothing here throws; a missing program or a failed run is a null.
import { findFfmpeg } from "@/lib/ffmpegPath";
import { findFpcalc } from "@/lib/fpcalcPath";
export { findFpcalc } from "@/lib/fpcalcPath";

export const IDENTIFY_RATE = 16000;
/** A decoded clip: raw signed 16-bit little-endian mono samples at IDENTIFY_RATE. */
export type DecodedClip = { pcm: Uint8Array; seconds: number };
/** What the caller declares about the clip bytes: any container ffmpeg reads, or raw 16-bit PCM mono at a sample rate. */
export type ClipKind = { kind: "container" } | { kind: "pcm16"; rate: number };
export type Fingerprints = { raw: Uint32Array; compressed: string | null; seconds: number };

export type Decoder = (clip: Uint8Array, kind: ClipKind) => Promise<DecodedClip | null>;
export type FingerprintRunner = (pcm: Uint8Array, want: { raw: boolean; compressed: boolean }) => Promise<{ raw: Uint32Array | null; compressed: string | null; seconds: number } | null>;

/** ffmpeg arguments: read the clip from stdin (a declared raw PCM kind, or sniffed container), write 16000 Hz mono s16le to stdout. */
export function decodeArgs(kind: ClipKind): string[] {
  const input = kind.kind === "pcm16" ? ["-f", "s16le", "-ar", String(kind.rate), "-ac", "1"] : [];
  return ["-hide_banner", "-loglevel", "error", "-nostdin", ...input, "-i", "pipe:0", "-vn", "-ac", "1", "-ar", String(IDENTIFY_RATE), "-f", "s16le", "pipe:1"];
}

/** Decode with the real ffmpeg. The clip bytes go to the child's stdin and the PCM comes back from stdout; no file is made. */
export const decodeWithFfmpeg: Decoder = async (clip, kind) => {
  try {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return null;
    const child = Bun.spawn([ffmpeg, ...decodeArgs(kind)], { stdin: clip, stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const out = new Uint8Array(await new Response(child.stdout).arrayBuffer());
      const code = await child.exited;
      if (code !== 0 || out.byteLength < 2) return null;
      return { pcm: out, seconds: out.byteLength / 2 / IDENTIFY_RATE };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
};

/** Parse fpcalc's `-json` answer: `fingerprint` is a base64 string, or (with -raw) an array of 32-bit integers. */
export function parseFpcalc(text: string): { raw: Uint32Array | null; compressed: string | null; seconds: number } | null {
  try {
    const json = JSON.parse(text) as { duration?: unknown; fingerprint?: unknown };
    const seconds = typeof json.duration === "number" && Number.isFinite(json.duration) ? json.duration : 0;
    if (Array.isArray(json.fingerprint)) {
      if (!json.fingerprint.every((x) => typeof x === "number")) return null;
      return { raw: Uint32Array.from(json.fingerprint as number[], (x) => x >>> 0), compressed: null, seconds };
    }
    if (typeof json.fingerprint === "string" && json.fingerprint.length > 0) return { raw: null, compressed: json.fingerprint, seconds };
    return null;
  } catch {
    return null;
  }
}

async function runFpcalc(bin: string, args: string[], stdin: Uint8Array | undefined): Promise<{ raw: Uint32Array | null; compressed: string | null; seconds: number } | null> {
  try {
    const child = Bun.spawn([bin, ...args], { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => child.kill(), 30_000);
    try {
      const text = await new Response(child.stdout).text();
      return (await child.exited) === 0 ? parseFpcalc(text) : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Fingerprint decoded PCM with the real fpcalc, reading stdin (no temp file). `raw` is for the local match, `compressed` for AcoustID. */
export const fingerprintWithFpcalc: FingerprintRunner = async (pcm, want) => {
  const bin = findFpcalc();
  if (!bin) return null;
  const base = ["-json", "-length", "30", "-format", "s16le", "-rate", String(IDENTIFY_RATE), "-channels", "1"];
  const [raw, compressed] = await Promise.all([
    want.raw ? runFpcalc(bin, [...base, "-raw", "-"], pcm) : Promise.resolve(null),
    want.compressed ? runFpcalc(bin, [...base, "-"], pcm) : Promise.resolve(null),
  ]);
  if (want.raw && !raw?.raw) return null;
  if (want.compressed && !compressed?.compressed) return null;
  return { raw: raw?.raw ?? null, compressed: compressed?.compressed ?? null, seconds: raw?.seconds || compressed?.seconds || pcm.byteLength / 2 / IDENTIFY_RATE };
};

/** The whole-song raw fingerprint of a library file (fpcalc reads the file itself), up to 10 minutes. Null when fpcalc is missing or fails. */
export async function fingerprintFile(path: string): Promise<Uint32Array | null> {
  const bin = findFpcalc();
  if (!bin) return null;
  const out = await runFpcalc(bin, ["-json", "-raw", "-length", "600", path], undefined);
  return out?.raw ?? null;
}

/** Raw fingerprints are stored as base64 of little-endian 32-bit words. */
export function packRaw(raw: Uint32Array): string {
  return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("base64");
}
export function unpackRaw(text: string): Uint32Array {
  const bytes = Buffer.from(text, "base64");
  const copy = new Uint8Array(bytes.byteLength - (bytes.byteLength % 4));
  copy.set(bytes.subarray(0, copy.byteLength));
  return new Uint32Array(copy.buffer);
}
