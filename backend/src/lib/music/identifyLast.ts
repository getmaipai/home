import type { IdentifyOutcome } from "./identify";

export type IdentifyLastOutcome = {
  at: number;
  deviceId: string | null;
  status: IdentifyOutcome["status"] | "bad_input";
  reason: string | null;
  seconds: number | null;
  source: "robot" | "person";
  matchSource?: "library" | "shazam" | "acoustid" | "home";
};

let last: IdentifyLastOutcome | null = null;

export function recordIdentifyOutcome(outcome: IdentifyLastOutcome): void {
  // Rule 6a: a status record holds the outcome, the source and the time, never a title or artist a person's clip produced.
  const { title: _t, artist: _a, ...safe } = outcome as IdentifyLastOutcome & { title?: string; artist?: string };
  last = { ...safe };
}

export function lastIdentifyOutcome(): IdentifyLastOutcome | null { return last ? { ...last } : null; }
export function resetIdentifyLast(): void { last = null; }
