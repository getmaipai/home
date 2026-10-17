// CANARY-01: last result and the last 50 per check, in process (the post-start suite refills it after a restart).
import { hotReloadState } from "@/lib/hotReloadState";
import type { CanaryId, CheckResult } from "./types";

export const HISTORY_LIMIT = 50;
/** Failures in a row before a Repairs item is raised (flapping guard). */
export const RAISE_AFTER = 2;

interface CheckState { history: CheckResult[]; failuresInARow: number; raised: boolean; restartAsked: boolean }
const state = hotReloadState<Map<CanaryId, CheckState>>("canaryResults", () => new Map());

function entry(id: CanaryId): CheckState {
  let s = state.get(id);
  if (!s) { s = { history: [], failuresInARow: 0, raised: false, restartAsked: false }; state.set(id, s); }
  return s;
}

/** Records a result and says what Repairs should do about it. */
export function record(result: CheckResult): { raise: boolean; resolve: boolean; firstFailure: boolean } {
  const s = entry(result.id);
  s.history.push(result);
  if (s.history.length > HISTORY_LIMIT) s.history.shift();
  if (result.status === "skipped") return { raise: false, resolve: false, firstFailure: false };
  if (result.status === "fail") {
    s.failuresInARow += 1;
    const raise = s.failuresInARow >= RAISE_AFTER;
    if (raise) s.raised = true;
    return { raise, resolve: false, firstFailure: s.failuresInARow === 1 };
  }
  const resolve = s.raised;
  s.failuresInARow = 0;
  s.raised = false;
  s.restartAsked = false;
  return { raise: false, resolve, firstFailure: false };
}

export function last(id: CanaryId): CheckResult | null { return entry(id).history.at(-1) ?? null; }
export function history(id: CanaryId): CheckResult[] { return [...entry(id).history]; }
export function failuresInARow(id: CanaryId): number { return entry(id).failuresInARow; }
export function restartAlreadyAsked(id: CanaryId): boolean { return entry(id).restartAsked; }
export function markRestartAsked(id: CanaryId): void { entry(id).restartAsked = true; }
/** The most recent real (not skipped) result. */
export function lastReal(id: CanaryId): CheckResult | null { return [...entry(id).history].reverse().find((r) => r.status !== "skipped") ?? null; }
export function __resetCanaryResultsForTests(): void { state.clear(); }
