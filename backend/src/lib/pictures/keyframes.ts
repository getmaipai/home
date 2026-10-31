// AGECHECK: three keyframes (first, middle, last) of a finished clip, for the finished-video safety check
// (ageCheck.ts). On this Mac the frames come from Apple's decoder through a tiny Swift helper (`keyframes.swift`,
// compiled once per source version with `swiftc` when the command line tools are there, the same pattern as the Stack's
// foreground helper); `ffmpeg` on the PATH is the second choice. When neither exists the caller checks the
// Stack's poster (frame 0) alone and says so. Everything is local: the clip goes to a temporary folder on this
// computer, three JPEGs come back, the folder is removed.
import { atBackgroundPriority } from "@/lib/backgroundPriority";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELPER_SOURCE = join(import.meta.dir, "keyframes.swift");
const FRAME_SIDE = 768;
const HELPER_DEADLINE_MS = 20_000;
const COMPILE_DEADLINE_MS = 120_000;

function workRoot(): string {
  const dir = join(tmpdir(), "maipai-agecheck");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

let helperPromise: Promise<string | null> | null = null;
let helperFailedAt = 0;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
/**
 * Compiles the helper once per process and returns its path. Null when the Mac has no `swiftc` or the compile failed; a null
 * is retried after five minutes, so installing the command line tools later takes effect without a restart.
 */
export function ensureKeyframeHelper(): Promise<string | null> {
  if (forTests || process.platform !== "darwin") return Promise.resolve(null);
  if (helperPromise && helperFailedAt > 0 && Date.now() - helperFailedAt > RETRY_AFTER_FAILURE_MS) helperPromise = null;
  if (!helperPromise) {
    helperFailedAt = 0;
    helperPromise = compileHelper().catch(() => null).then((path) => { if (!path) helperFailedAt = Date.now(); return path; });
  }
  return helperPromise;
}

async function compileHelper(): Promise<string | null> {
  if (!existsSync(HELPER_SOURCE)) return null;
  // The file name carries a hash of the source, so an edited helper is never run from an older build, and the compile goes
  // to a private name first and is renamed into place, so a second process never runs a half-written binary.
  const hash = new Bun.CryptoHasher("sha256").update(readFileSync(HELPER_SOURCE)).digest("hex").slice(0, 12);
  const target = join(workRoot(), `keyframes-${hash}`);
  if (existsSync(target)) return target;
  const swiftc = Bun.which("swiftc");
  if (!swiftc) return null;
  const cache = join(workRoot(), "swift-cache");
  mkdirSync(cache, { recursive: true });
  const building = `${target}.${process.pid}.${Date.now()}.tmp`;
  const child = Bun.spawn([swiftc, "-O", HELPER_SOURCE, "-o", building], { stdout: "ignore", stderr: "ignore", env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache } });
  const timer = setTimeout(() => child.kill(), COMPILE_DEADLINE_MS);
  const code = await child.exited;
  clearTimeout(timer);
  if (code !== 0) { rmSync(building, { force: true }); return null; }
  chmodSync(building, 0o755);
  renameSync(building, target);
  return target;
}

/** Test seam: replaces the whole extraction. */
let forTests: ((mp4: Uint8Array, seconds: number | null) => Promise<Uint8Array[] | null>) | null = null;
export function __setKeyframesForTests(fn: typeof forTests): void { forTests = fn; }
export function __resetKeyframeHelperForTests(): void { helperPromise = null; helperFailedAt = 0; }

async function run(cmd: string[], deadlineMs: number): Promise<number> {
  const child = Bun.spawn(atBackgroundPriority(cmd), { stdout: "ignore", stderr: "ignore" });
  const timer = setTimeout(() => child.kill(), deadlineMs);
  const code = await child.exited;
  clearTimeout(timer);
  return code;
}

/** How many frames a clip of this length gets: first, middle and last for a short one, five (a frame about every 2.5 seconds of a 10 second clip) past 6 seconds (VIDEO-LTX-01). */
export const keyframeCount = (seconds: number | null): number => (seconds !== null && seconds > 6 ? 5 : 3);

/** First, middle and last frames (five for a clip over 6 seconds) as JPEG bytes (at most 768 px a side), or null when this Mac cannot decode a clip. */
export async function extractKeyframes(mp4: Uint8Array, seconds: number | null): Promise<Uint8Array[] | null> {
  if (forTests) return forTests(mp4, seconds);
  const dir = mkdtempSync(join(workRoot(), "clip-"));
  try {
    const clip = join(dir, "clip.mp4");
    writeFileSync(clip, mp4, { mode: 0o600 });
    const helper = await ensureKeyframeHelper();
    if (helper) {
      if (await run([helper, clip, dir, String(FRAME_SIDE), String(keyframeCount(seconds))], HELPER_DEADLINE_MS) === 0) return readFrames(dir, keyframeCount(seconds));
      return null;
    }
    const ffmpeg = Bun.which("ffmpeg");
    if (!ffmpeg || !seconds || seconds <= 0) return null;
    const count = keyframeCount(seconds);
    const stamps = Array.from({ length: count }, (_, i) => (i === 0 ? 0 : i === count - 1 ? Math.max(0, seconds - 0.15) : (seconds * i) / (count - 1)));
    for (let i = 0; i < stamps.length; i += 1) {
      const code = await run([ffmpeg, "-loglevel", "error", "-y", "-ss", String(stamps[i]), "-i", clip, "-frames:v", "1", "-vf", `scale='min(${FRAME_SIDE},iw)':-2`, "-map_metadata", "-1", join(dir, `${i}.jpg`)], HELPER_DEADLINE_MS);
      if (code !== 0) return null;
    }
    return readFrames(dir, count);
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readFrames(dir: string, count: number): Uint8Array[] | null {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    const file = join(dir, `${i}.jpg`);
    if (!existsSync(file)) return null;
    frames.push(new Uint8Array(readFileSync(file)));
  }
  return frames;
}
