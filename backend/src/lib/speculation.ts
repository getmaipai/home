// STT-SMARTTURN-01 (speculative start; docs/design/speculative-start-2026-11-11.md, RULES.md rule 9's "held resume session"):
// a spoken turn begun privately on the edge partial transcript. It is held (nothing released, spoken, stored or run) until the
// final transcript confirms it with an exact trimmed match, else discarded. This module holds the pieces that are not the
// route's: the refusal rule, the hold, the tool node's wait and the counts-only counters (rule 6a: no text, no ids).
import type { PersonRow } from "@/lib/memoryIngestion";
import { speakerAgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";

export const SPECULATIVE_START_KEY = "voice.speculative_start";
/** A held run that is neither confirmed nor discarded by then is dropped unstored (the voice session went away). */
export const SPECULATION_HOLD_MS = 20_000;
/** LiveKit's guard: a long utterance is likelier mid-thought, and its discarded prefill is the costliest. */
export const SPECULATION_MAX_WORDS = 40;

export interface SpeculationHold {
  readonly promise: Promise<boolean>;
  resolve(ok: boolean): void;
  settled: boolean;
}

export function newSpeculationHold(): SpeculationHold {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => { resolve = r; });
  const hold: SpeculationHold = { promise, settled: false, resolve(ok) { if (hold.settled) return; hold.settled = true; resolve(ok); } };
  return hold;
}

/** Counts only, never text (rule 6a): read by the voice latency report and the logs. */
export const speculationCounters = { started: 0, confirmed: 0, discarded: 0, aborted: 0, refused: 0 };

/** `reason` is one of the fixed refusal lines above or a fixed shape label, never the person's words (rule 6a). */
export function noteSpeculation(kind: keyof typeof speculationCounters, reason?: string): void {
  speculationCounters[kind] += 1;
  console.log(`[speculation] ${kind}${reason ? ` (${reason})` : ""} started=${speculationCounters.started} confirmed=${speculationCounters.confirmed} discarded=${speculationCounters.discarded} aborted=${speculationCounters.aborted} refused=${speculationCounters.refused}`);
}

export function __resetSpeculationForTests(): void { for (const key of Object.keys(speculationCounters) as Array<keyof typeof speculationCounters>) speculationCounters[key] = 0; }

/** The server-side refusal, decided before any work (rule 0: the age and surface gates outrank the feature). Null means allowed.
 * Confirmed identity is the signed-in person on their own chat or phone surface; a robot speaker, whose identity is evidence,
 * never speculates. */
export function speculationRefusal(input: { actor: PersonRow; surface: string; spoken: boolean; wordCount: number; pendingAsk: boolean; activeTurns: number; enabled?: boolean; now?: Date }): string | null {
  const enabled = input.enabled ?? getHouseholdSettingValue(SPECULATIVE_START_KEY) === true;
  if (!enabled) return "Speculative start is off.";
  if (!input.spoken) return "Speculative start is for spoken turns.";
  if (input.surface !== "chat" && input.surface !== "phone") return "Speculative start is not available on this surface.";
  if (speakerAgeBand(input.actor, input.now ?? new Date()) !== "adult") return "Speculative start is for adults.";
  if (input.pendingAsk) return "A confirmation is waiting; the full message is needed.";
  if (input.activeTurns > 0) return "A turn is already running.";
  if (input.wordCount > SPECULATION_MAX_WORDS) return "The message is long; the full message is needed.";
  return null;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/** The tool node's wait: true once the run is confirmed, false on discard or abort. Never throws. */
export async function speculationConfirmed(confirmed: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  return await Promise.race([confirmed, new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true }))]);
}
