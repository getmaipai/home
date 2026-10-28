// BENCH-01 (docs/plans/baseline-fixes-2026-09-13.md item 5): the live
// conversation bench pins llama-server's per-request sampler seed so
// two runs on the same commit answer the same way and a row that flips
// is a real change, not dice. A process-level pin, because the bench
// drives real turns through runTurnStream() and nothing threads a
// per-call option from there down to llm.ts; the app never sets it
// (production chat stays at its model record's sampling, 0.7 for the shipped models, with no seed), and the
// (the judge) on every request.
import { CATALOG } from "@/lib/modelCatalog";
import { chatSamplingOf } from "@/lib/llmSampling";
import type { PluginResult } from "@maipai/spec/interpreters/ts/recipe-interpreter.js";

/** Bench-only: the sampling the first shipped chat record sends, for arms
 * that state production's set explicitly. The app reads each model's own
 * record (llm.ts); a bench arm names its model if it needs another's. */
export function benchChatSampling(): Record<string, number> {
  return chatSamplingOf(CATALOG.find((model) => model.role === "chat"));
}

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

// NAT-01 bench seam: the typed outcome a package returns, seeded by package
// id. runPlugin() (the one runner every tool call goes through) answers a
// package with its seeded result instead of running it, so the tool message
// the model composes from is the typed outcome the row names. Process-level
// and null by default, like the clock and seed above: the app never sets it,
// so a real turn runs the package exactly as before.
let seededOutcomes: Readonly<Record<string, PluginResult>> | null = null;

/** The seeded result for a package id, or null (always null outside a bench). */
export function seededOutcomeFor(packageId: string): PluginResult | null {
  return seededOutcomes?.[packageId] ?? null;
}

/** Bench-only: seed (or with `null` clear) package results by package id. */
export function __setSeededOutcomesForBench(outcomes: Readonly<Record<string, PluginResult>> | null): void {
  seededOutcomes = outcomes;
}
