import type { IdentifyOutcome } from "./identify";

export type IdentifyLastOutcome = {
  at: number;
  deviceId: string | null;
  status: IdentifyOutcome["status"] | "bad_input";
  reason: string | null;
  seconds: number | null;
  source: "robot" | "person";
  title?: string;
  artist?: string;
  matchSource?: "library" | "shazam" | "acoustid" | "home";
};

let last: IdentifyLastOutcome | null = null;

export function recordIdentifyOutcome(outcome: IdentifyLastOutcome): void {
  last = { ...outcome, title: outcome.title?.slice(0, 80), artist: outcome.artist?.slice(0, 80) };
}

export function lastIdentifyOutcome(): IdentifyLastOutcome | null { return last ? { ...last } : null; }
export function resetIdentifyLast(): void { last = null; }
