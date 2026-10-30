// CANARY-01: one shared schedule. Pure decisions; the runner owns the clock and the single-flight lock.
import { hotReloadState } from "@/lib/hotReloadState";
import { SEARCH_PHRASES } from "./checks";
import type { CanaryId } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
export const INTERVAL_MS: Record<Exclude<CanaryId, "chat_search_trigger">, number> = {
  chat_hello: 10 * MIN,
  embed: 5 * MIN,
  gpu_metal: 15 * MIN,
  chat_tool_weather: 30 * MIN,
  spoken_turn: 30 * MIN,
  stt_tts_loopback: 30 * MIN,
  chat_picture_read: 2 * HOUR,
  image_tiny: 24 * HOUR,
};
export const SEARCH_PER_DAY = 3;
export const SEARCH_GAP_MS = 8 * HOUR;
export const SEARCH_QUIET_MS = 24 * HOUR;
export const SLOW_BACKOFF_MS = 15 * MIN;
/** A person's turn in the last 30 seconds means they are mid-conversation. */
export const IDLE_WINDOW_MS = 30_000;
/** Priority when several are due. */
export const ORDER: CanaryId[] = ["chat_hello", "embed", "gpu_metal", "chat_tool_weather", "spoken_turn", "stt_tts_loopback", "chat_search_trigger", "chat_picture_read", "image_tiny"];

export interface ScheduleState {
  lastRun: Partial<Record<CanaryId, number>>;
  searchRuns: number[];
  searchQuietUntil: number;
  nextSearchAt: number;
  /** Do not start scheduled checks before this time (the canary was slow, so it backs off). */
  slowUntil: number;
}
export const emptySchedule = (): ScheduleState => ({ lastRun: {}, searchRuns: [], searchQuietUntil: 0, nextSearchAt: 0, slowUntil: 0 });
export const schedule = hotReloadState<ScheduleState>("canarySchedule", emptySchedule);
export function __resetCanaryScheduleForTests(): void { Object.assign(schedule, emptySchedule()); }

export function searchRunsToday(st: ScheduleState, now: number): number {
  return st.searchRuns.filter((t) => now - t < 24 * HOUR).length;
}

export function searchAllowed(st: ScheduleState, now: number): boolean {
  return searchRunsToday(st, now) < SEARCH_PER_DAY && now >= st.nextSearchAt && now >= st.searchQuietUntil;
}

/** Checks due on a scheduled tick (not the post-start or manual runs). */
export function dueChecks(now: number, st: ScheduleState, opts: { keepWarm: boolean }): CanaryId[] {
  if (now < st.slowUntil) return [];
  const due: CanaryId[] = [];
  for (const id of ORDER) {
    if (id === "chat_search_trigger") {
      if (opts.keepWarm && searchAllowed(st, now)) due.push(id);
      continue;
    }
    // Keep the AI warm off: only the daily picture check still runs on a timer.
    if (!opts.keepWarm && id !== "image_tiny" && id !== "gpu_metal") continue;
    const last = st.lastRun[id];
    if (last === undefined || now - last >= INTERVAL_MS[id]) due.push(id);
  }
  return due;
}

/** Notes a run; a search run also spaces the next one 6 to 10 hours out (jitter from `random`). */
export function noteRun(st: ScheduleState, id: CanaryId, now: number, random: number): void {
  st.lastRun[id] = now;
  if (id === "chat_search_trigger") {
    st.searchRuns = [...st.searchRuns.filter((t) => now - t < 24 * HOUR), now];
    st.nextSearchAt = now + Math.round(SEARCH_GAP_MS * (0.75 + 0.5 * random));
  }
}

export function pickSearchPhrase(random: number): string {
  return SEARCH_PHRASES[Math.min(SEARCH_PHRASES.length - 1, Math.floor(random * SEARCH_PHRASES.length))]!;
}
