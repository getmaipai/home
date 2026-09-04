// A generic, resumable, checksum-verified URL download: the mechanism
// behind platform plan 4.11's "no download-job queue exists to [fetch a
// GGUF or a llama-server binary] safely" gap (spec/llm/README.md) and the
// org's third-party-model rule (CLAUDE.md > Third-party code and assets:
// "pinned version, pinned URL, checksum verified, with a clear failure
// message when offline"). Ported from the archived legacy hub's
// lib/download.ts (hard-won logic: resume-by-Range, an idle-stall
// timeout, retry-with-backoff, a post-download integrity gate that
// deletes and re-throws rather than leaving a corrupt file believed
// good), narrowed to the one thing modelDownloadJobs.ts actually needs -
// no aria2, no HF xet-bridge special-casing, no LFS-pointer detection:
// this repo's two real sources (a GitHub release asset, a Hugging Face
// `resolve/<revision>/...` URL) both serve a plain redirect chain `fetch`
// already follows.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from "node:fs";
import { mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface DownloadProgress {
  completedBytes: number;
  totalBytes: number;
  status: string;
}

export interface DownloadOptions {
  expectedSha256: string;
  expectedBytes?: number;
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
}

// A stalled connection (socket open, server frozen mid-response) never
// errors on its own; read() is raced against this so it turns into a
// retriable rejection instead of an indefinite hang. Real llama.cpp/HF
// release assets stream continuously, so 90s of total silence is already
// generous, the same figure the legacy code calibrated.
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 6;

/** A complete download that failed its post-download integrity check
 * (wrong size or checksum) - distinct from a network error so the retry
 * loop below doesn't run it through the same multi-minute exponential
 * backoff: a bad pin or genuine corruption is worth one immediate retry
 * from scratch (the .part file is already gone by the time this throws),
 * not six attempts spread over minutes. */
class DownloadVerificationError extends Error {}

export function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function fail(partPath: string, reason: string): never {
  try {
    unlinkSync(partPath);
  } catch {
    // already gone
  }
  throw new DownloadVerificationError(`Download failed (${reason}), the partial file was removed`);
}

async function downloadOnce(
  url: string,
  destPath: string,
  opts: DownloadOptions,
): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const partPath = `${destPath}.part`;
  const startAt = existsSync(partPath) ? statSync(partPath).size : 0;

  const headers: Record<string, string> = startAt > 0 ? { Range: `bytes=${startAt}-` } : {};
  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok && res.status !== 206) {
    throw new Error(`GET ${url} returned ${res.status}`);
  }
  if (startAt > 0 && res.status !== 206) {
    // Server ignored the Range request (some CDNs do on a redirect hop):
    // restart clean rather than risk appending onto a full re-sent body.
    unlinkSync(partPath);
    return downloadOnce(url, destPath, opts);
  }
  if (!res.body) throw new Error(`GET ${url} returned no body`);

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  const totalBytes = opts.expectedBytes ?? (startAt > 0 ? startAt + contentLength : contentLength);

  const out = createWriteStream(partPath, { flags: startAt > 0 ? "a" : "w" });
  const reader = res.body.getReader();
  let completedBytes = startAt;

  try {
    while (true) {
      let step: Awaited<ReturnType<typeof reader.read>>;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        step = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            idleTimer = setTimeout(
              () => reject(new Error(`stalled: no data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`)),
              STREAM_IDLE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      if (step.done) break;
      completedBytes += step.value.byteLength;
      await new Promise<void>((resolve, reject) =>
        out.write(step.value, (err) => (err ? reject(err) : resolve())),
      );
      opts.onProgress?.({ completedBytes, totalBytes, status: "downloading" });
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }

  const finalSize = statSync(partPath).size;
  if (opts.expectedBytes && finalSize !== opts.expectedBytes) {
    fail(partPath, `size ${finalSize} != expected ${opts.expectedBytes}`);
  }
  opts.onProgress?.({ completedBytes: finalSize, totalBytes: finalSize, status: "verifying checksum" });
  const actual = await sha256OfFile(partPath);
  if (actual !== opts.expectedSha256.toLowerCase()) {
    fail(partPath, `sha256 ${actual.slice(0, 12)}… != expected ${opts.expectedSha256.slice(0, 12)}…`);
  }
  renameSync(partPath, destPath);
}

/** Download `url` to `destPath` with resume (a `.part` sibling plus a
 * Range request), verified against `expectedSha256` on completion, or
 * throws with the partial file removed so a retry starts clean rather
 * than resuming a file already known corrupt. Skips entirely if `destPath`
 * already exists (the caller is expected to have already checked, this is
 * a second, cheap guard against a redundant re-verify of a multi-GB file). */
export async function downloadUrl(url: string, destPath: string, opts: DownloadOptions): Promise<void> {
  if (existsSync(destPath)) return;
  let verificationRetried = false;
  for (let attempt = 1; ; attempt++) {
    try {
      await downloadOnce(url, destPath, opts);
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (err instanceof DownloadVerificationError) {
        // One immediate retry from scratch (no backoff, doesn't count
        // against MAX_ATTEMPTS): worth ruling out a one-off corrupted
        // transfer before concluding the pin itself is wrong.
        if (verificationRetried) throw err;
        verificationRetried = true;
        opts.onProgress?.({ completedBytes: 0, totalBytes: opts.expectedBytes ?? 0, status: `verification failed, retrying once: ${err.message}` });
        continue;
      }
      if (attempt >= MAX_ATTEMPTS) throw err;
      const message = (err as Error).message ?? String(err);
      if (/\b(404|403)\b/.test(message)) throw err; // not-found/auth: retrying can't help
      const delaySec = Math.min(5 * 2 ** (attempt - 1), 60);
      opts.onProgress?.({
        completedBytes: 0,
        totalBytes: opts.expectedBytes ?? 0,
        status: `connection interrupted, resuming in ${delaySec}s (attempt ${attempt}/${MAX_ATTEMPTS - 1}): ${message}`,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delaySec * 1000));
    }
  }
}
