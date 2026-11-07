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
/** AUDIT-PERF-01: after CALM_AFTER_PASSES passes in a row with no family chat in the last hour, the four chat-driven loops slow down.
 * The full cadence returns on boot (the state starts empty), after a Stack restart (requestFullSuite) and after any failure. */
export const CALM_AFTER_PASSES = 10;
export const CALM_INTERVAL_MS: Partial<Record<Exclude<CanaryId, "chat_search_trigger">, number>> = {
  chat_hello: 30 * MIN,
  chat_tool_weather: 2 * HOUR,
  spoken_turn: 2 * HOUR,
  stt_tts_loopback: 2 * HOUR,
};
export const CALM_CHAT_QUIET_MS = HOUR;
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
  /** Real (not skipped) results in a row that passed; any failure or a full-suite request sets it back to 0. */
  passStreak: number;
}
export const emptySchedule = (): ScheduleState => ({ lastRun: {}, searchRuns: [], searchQuietUntil: 0, nextSearchAt: 0, slowUntil: 0, passStreak: 0 });
export const schedule = hotReloadState<ScheduleState>("canarySchedule", emptySchedule);
export function __resetCanaryScheduleForTests(): void { Object.assign(schedule, emptySchedule()); }

export function searchRunsToday(st: ScheduleState, now: number): number {
  return st.searchRuns.filter((t) => now - t < 24 * HOUR).length;
}

export function searchAllowed(st: ScheduleState, now: number): boolean {
  return searchRunsToday(st, now) < SEARCH_PER_DAY && now >= st.nextSearchAt && now >= st.searchQuietUntil;
}

/** Notes a real result for the calm-cadence streak. */
export function noteStatus(st: ScheduleState, status: "pass" | "fail"): void {
  st.passStreak = status === "pass" ? st.passStreak + 1 : 0;
}

/** Whether the slowed cadence applies now. `familyChatLastHour` is true when anyone chatted in the last hour. */
export function calmCadence(st: ScheduleState, familyChatLastHour: boolean): boolean {
  return st.passStreak >= CALM_AFTER_PASSES && !familyChatLastHour;
}

/** Checks due on a scheduled tick (not the post-start or manual runs). */
export function dueChecks(now: number, st: ScheduleState, opts: { keepWarm: boolean; familyChatLastHour?: boolean }): CanaryId[] {
  const calm = calmCadence(st, opts.familyChatLastHour === true);
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
    const interval = calm ? CALM_INTERVAL_MS[id] ?? INTERVAL_MS[id] : INTERVAL_MS[id];
    if (last === undefined || now - last >= interval) due.push(id);
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
