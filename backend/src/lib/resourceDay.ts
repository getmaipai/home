import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import type { StackDailyResources } from "@/lib/stack/types";

const CAUSE_WORDS: Record<string, string> = {
  "governor-runaway": "memory growth",
  "memory-watchdog": "low memory on this computer",
  "video-window-shrink": "making room for a video",
  "video-window-restore": "making room for a video",
  "canary-request": "a health check",
  "model-load": "a model change",
};

function times(count: number): string { return `${count} ${count === 1 ? "time" : "times"}`; }
function causeName(slug: string): string { return CAUSE_WORDS[slug] ?? slug.replaceAll("-", " "); }
function countCauses(causes: Record<string, number>): number { return Object.values(causes).reduce((sum, value) => sum + value, 0); }
function mostCommon(causes: Record<string, number>): string | undefined {
  return Object.entries(causes).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
}
function size(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  return mb < 1000 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

export function describeResourceDay(days: StackDailyResources[]): { date: string; text: string } | undefined {
  const day = days[1];
  if (!day) return undefined;
  const restarts = countCauses(day.chat_restarts_by_cause);
  const pauses = day.pauses;
  const cutShort = day.forced_resumes;
  const videos = day.shrinks;
  const survivors = day.survivors_stopped;
  const freed = day.sweeps.freed_bytes;
  const allCounts = [restarts, countCauses(day.engine_stops_by_cause), pauses, day.resumes, cutShort, day.paused_seconds,
    countCauses(day.memory_actions), day.shrinks, day.restores, survivors, day.sweeps.runs, freed, day.canary_restarts];
  if (!allCounts.some((count) => count > 0)) {
    return { date: day.date, text: "Yesterday: no chat restarts, pauses or clean-ups." };
  }
  const parts = ["Yesterday:"];
  if (restarts > 0) {
    const cause = mostCommon(day.chat_restarts_by_cause);
    parts.push(`chat restarted ${times(restarts)}${cause ? ` (most often because of ${causeName(cause)})` : ""}`);
  }
  if (pauses > 0) parts.push(`big jobs were paused ${times(pauses)} for chat${cutShort > 0 ? ` (${cutShort} cut short)` : ""}`);
  if (videos > 0) parts.push(`chat made room for a video ${times(videos)}`);
  if (survivors > 0) parts.push(`${survivors} helper ${survivors === 1 ? "program was" : "programs were"} stopped`);
  if (freed > 0) parts.push(`clean-ups freed ${size(freed)}`);
  return { date: day.date, text: `Yesterday: ${parts.slice(1).join("; ")}.` };
}

export async function readResourceDay(): Promise<{ date: string; text: string } | undefined> {
  if (!isStackConfigured()) return undefined;
  try {
    const client = getStackClient();
    if (!client.memoryDaily) return undefined;
    const result = await client.memoryDaily(2);
    return describeResourceDay(result.days);
  } catch {
    return undefined;
  }
}
