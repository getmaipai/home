// MEDIA-LIB-01: stream metadata (duration, codecs, size in pixels, chapters) comes from the Stack's `media.probe` job when the
// Stack is reachable. The scan codes against this small interface; when no prober answers, items are made from names and tags
// with `playable: "unknown"` and probed on a later pass. A scan never fails because a probe did.
import { getStackClient, isRemoteStackSelected } from "@/lib/stackEngine";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";

export interface ProbeChapter {
  start_s: number;
  title: string;
}

export interface ProbeResult {
  durationS: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  chapters: ProbeChapter[];
}

export interface Prober {
  /** Facts about the file at an absolute path on this computer. `null` means the file itself could not be probed (do not retry until
   * it changes); `"unavailable"` means nothing answered (try again on a later pass). */
  probe(absPath: string): Promise<ProbeResult | "unavailable" | null>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reads a `media.probe` job result. The Stack's result names the fields in snake_case; camelCase is accepted too. */
export function probeResultFrom(result: unknown): ProbeResult | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const videoCodec = str(r["video_codec"] ?? r["videoCodec"]);
  const audioCodec = str(r["audio_codec"] ?? r["audioCodec"]);
  const width = num(r["width"]);
  const height = num(r["height"]);
  const chaptersRaw = Array.isArray(r["chapters"]) ? r["chapters"] : [];
  const chapters: ProbeChapter[] = [];
  for (const raw of chaptersRaw) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const start = num(c["start_s"] ?? c["start"]);
    if (start === null || start < 0) continue;
    chapters.push({ start_s: start, title: str(c["title"]) ?? `Chapter ${chapters.length + 1}` });
  }
  const hasVideo = typeof r["has_video"] === "boolean" ? r["has_video"] : videoCodec !== null || (width !== null && height !== null);
  const hasAudio = typeof r["has_audio"] === "boolean" ? r["has_audio"] : audioCodec !== null;
  const durationS = num(r["duration_s"] ?? r["durationS"] ?? r["duration"]);
  if (durationS === null && !hasVideo && !hasAudio) return null;
  return { durationS, width, height, videoCodec, audioCodec, container: str(r["container"] ?? r["format"]), hasVideo, hasAudio, chapters: chapters.sort((a, b) => a.start_s - b.start_s) };
}

const POLL_MS = 250;
const TIMEOUT_MS = 20_000;

/** The Stack's `media.probe` job (docs/integrations.md, Jobs): `POST /stack/v1/jobs { kind: "media.probe", input: { path } }`, then
 * `GET /stack/v1/jobs/{id}` until it is done. Only a Stack on this computer can read the file by path, so a Stack on another
 * computer yields no prober. */
export function createStackProber(deps: { timeoutMs?: number; pollMs?: number } = {}): Prober {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const pollMs = deps.pollMs ?? POLL_MS;
  return {
    async probe(absPath) {
      try {
        if (isRemoteStackSelected()) return "unavailable";
        const client = getStackClient();
        let job: StackJob = await client.submitJob({ kind: "media.probe", input: { path: absPath } });
        const deadline = Date.now() + timeoutMs;
        while (job.state === "queued" || job.state === "running" || job.state === "paused" || job.state === "stalled") {
          if (Date.now() > deadline) return "unavailable";
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          job = await client.job(job.id);
        }
        if (job.state === "done") return probeResultFrom(job.result);
        return job.state === "failed" ? null : "unavailable";
      } catch {
        return "unavailable";
      }
    },
  };
}
