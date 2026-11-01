// CHAT-NOTICE-SHORT-01 (owner, 2026-11-01): the one-line notices under the chat input carry a real time, and the time is measured on this
// computer. Each chat transition (Reduced in and out, Max load, Max self-test, a coding-mode change) records how long it took; the median of
// the last few runs is the estimate. With no history the measured default (Studio, 2026-11-01) stands. The line rides the existing health
// snapshot and composer notice (RULES S6): this file is words and numbers, never a status surface of its own.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import type { ComposerNotice } from "@/lib/failureCopy";

export type TransitionKind = "enter_reduced" | "leave_reduced" | "max_load" | "self_test" | "mode_change";

/** Seconds, measured on the Studio 2026-11-01 (Reduced in 16, out 9, self-test 35); a Max load and a mode change are "about a minute" until this computer has its own. */
export const DEFAULT_TRANSITION_SECONDS: Record<TransitionKind, number> = { enter_reduced: 16, leave_reduced: 9, max_load: 60, self_test: 35, mode_change: 60 };
const KEEP = 7;
/** Past this share of the estimate the line stops promising a time. */
export const RUNNING_LONG_FACTOR = 1.5;
export const RUNNING_LONG_LINE = "Taking longer than usual. Still working.";

let history: Partial<Record<TransitionKind, number[]>> | null = null;
let fileOverride: string | null = null;
const file = () => fileOverride ?? join(dataDir, "local-app", "chat-transition-times.json");
export function __resetTransitionsForTests(path: string | null = null): void { history = null; fileOverride = path; active = null; modeSince = null; }

function load(): Partial<Record<TransitionKind, number[]>> {
  if (history) return history;
  try { history = JSON.parse(readFileSync(file(), "utf-8")) as Partial<Record<TransitionKind, number[]>>; } catch { history = {}; }
  return history;
}

/** Remember how long one transition took (milliseconds). Nonsense values are dropped; a failed write only loses persistence. */
export function recordTransition(kind: TransitionKind, ms: number): void {
  if (!Number.isFinite(ms) || ms < 500 || ms > 30 * 60_000) return;
  const all = load();
  all[kind] = [...(all[kind] ?? []), Math.round(ms)].slice(-KEEP);
  try {
    if (!existsSync(join(file(), ".."))) mkdirSync(join(file(), ".."), { recursive: true });
    writeFileSync(file(), JSON.stringify(all));
  } catch { /* the estimate still works from memory */ }
}

/** Median of the recent runs, in seconds; the default when there is no history. */
export function estimateSeconds(kind: TransitionKind): number {
  const runs = [...(load()[kind] ?? [])].sort((a, b) => a - b);
  if (runs.length === 0) return DEFAULT_TRANSITION_SECONDS[kind];
  const mid = Math.floor(runs.length / 2);
  const ms = runs.length % 2 ? runs[mid]! : (runs[mid - 1]! + runs[mid]!) / 2;
  return ms / 1000;
}

/** "15 seconds" (rounded to 5, at least 5) or "a minute" once the estimate passes 50 seconds. */
export function waitPhrase(seconds: number): string {
  if (seconds > 50) return "a minute";
  return `${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
}

export const isRunningLong = (kind: TransitionKind, elapsedMs: number): boolean => elapsedMs > RUNNING_LONG_FACTOR * estimateSeconds(kind) * 1000;

/** The in-flight transition Home itself started or watched begin (one at a time; chat only changes one way at once). */
let active: { kind: TransitionKind; startedAt: number } | null = null;
export function beginTransition(kind: TransitionKind, now = Date.now()): () => void {
  const mine = { kind, startedAt: now };
  active = mine;
  return () => { if (active === mine) active = null; };
}
export function activeTransition(): { kind: TransitionKind; startedAt: number } | null { return active; }

const band = (adult: string, child: string, more?: string): ComposerNotice => ({ adult, teen: adult, child, repairs_link: null, ...(more ? { more } : {}) });

/** The one line while chat switches models or a coding-mode change runs. */
export function transitionNotice(kind: TransitionKind, elapsedMs: number): ComposerNotice {
  if (isRunningLong(kind, elapsedMs)) return band(RUNNING_LONG_LINE, RUNNING_LONG_LINE);
  const phrase = waitPhrase(estimateSeconds(kind));
  if (kind === "mode_change") return band(`Getting ready. Back in about ${phrase}.`, `Getting ready. Back in about ${phrase}.`, "Home is getting ready for a big job. Chat is paused until it finishes, and your message stays here.");
  return band(`Switching chat. Back in about ${phrase}.`, `Switching chat. Back in about ${phrase}.`, "Chat is changing to a different model so a big job has room. It comes back by itself.");
}

/** A coding-mode change is the Stack's own transaction, so Home learns its length by watching the health poll: first sighting of "switching" starts the clock, the first "stable" stops it and records. Returns the elapsed milliseconds while it runs, else null. */
let modeSince: number | null = null;
export function observeModeChange(switching: boolean, now = Date.now()): number | null {
  if (switching) { modeSince ??= now; return now - modeSince; }
  if (modeSince !== null) { recordTransition("mode_change", now - modeSince); modeSince = null; }
  return null;
}

/** The Max self-test: the route starts the clock, the readiness read that finds the test done stops it. */
let selfTestSince: number | null = null;
export const selfTestStarted = (now = Date.now()): void => { selfTestSince = now; };
export const selfTestAborted = (): void => { selfTestSince = null; };
export function selfTestFinished(now = Date.now()): void { if (selfTestSince !== null) { recordTransition("self_test", now - selfTestSince); selfTestSince = null; } }

/** The estimates the composer needs for the Max flow, in whole seconds. */
export const maxEstimates = () => ({ max_load_s: Math.round(estimateSeconds("max_load")), self_test_s: Math.round(estimateSeconds("self_test")) });
