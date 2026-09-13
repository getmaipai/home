// BENCH-01 (docs/plans/baseline-fixes-2026-09-13.md item 5): the live
// conversation bench pins llama-server's per-request sampler seed so
// two runs on the same commit answer the same way and a row that flips
// is a real change, not dice. A process-level pin, because the bench
// drives real turns through runTurnStream() and nothing threads a
// per-call option from there down to llm.ts; the app never sets it
// (production chat stays at CHAT_SAMPLING's 0.7 with no seed), and the
// name says who may. Read by llm.ts (chat) and backgroundSupervisor.ts
// (the judge) on every request.
let pinnedSeed: number | null = null;
// The prompt's own clock ("Local time: ..." at the end of the context
// message) moves every minute, so two runs seeded alike still sent
// different tokens; the bench pins it too.
let pinnedNow: (() => Date) | null = null;

/** The seed to send, or nothing: spread into a request as
 * `...seedFields()`. */
export function seedFields(): { seed?: number } {
  return pinnedSeed === null ? {} : { seed: pinnedSeed };
}

/** Bench-only: pin (or with `null` unpin) the sampler seed for every
 * chat and judge request of this process. */
export function __setSamplingSeedForBench(seed: number | null): void {
  pinnedSeed = seed;
}

/** The prompt's clock: the bench's pinned instant, or now. */
export function promptNow(): Date {
  return pinnedNow ? pinnedNow() : new Date();
}

/** Bench-only: pin (or with `null` unpin) the instant the prompt's
 * local-time line reads. */
export function __setPromptClockForBench(now: (() => Date) | null): void {
  pinnedNow = now;
}
