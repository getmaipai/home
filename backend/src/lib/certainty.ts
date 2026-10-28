// NAT-03 (docs/design/natural-speech-register-2026-10-27.md, section 3.4):
// the certainty band shown beside every secondhand fact the model reads,
// so the model matches its hedge to it ("probably", "I think",
// "apparently") instead of guessing how sure to sound.
//
// Learned-components reading (design section 4): this file maps TYPED data
// (an outcome's package id, source kinds and hosts, a number) through fixed
// thresholds. It never reads the person's words or the model's reply, so it
// is a table, not a classifier (chat rules 1 to 3). The band words in the
// policy paragraph (persona.ts) are guidance for the model, never code.
//
// "Two or more agreeing web sources" is settled as a typed count (the
// architect's open point): at least WEB_AGREEMENT_MIN_HOSTS (2) DISTINCT
// hosts among the outcome's sources of kind `web` (outcome.source,
// outcome.sources, and for a web search the rows of its own data). Hosts are
// compared lowercase with a leading "www." removed. No text comparison of
// what the sources say is made: independent hosts returning the same query
// are the "agreeing" signal, one host repeated is still a single source.

import type { ToolExecutionOutcome } from "@/lib/turnContext";
import { sourcesFromRows } from "@/lib/turnContext";

export type CertaintyBand = "sure" | "likely" | "maybe" | "unlikely" | "recalled" | "reported";

/** The two typed turn facts the listener gate reads (design 3.4). */
export interface CertaintyGate {
  ageBand: "child" | "teen" | "adult";
  safetyFlagged: boolean;
}

/** Distinct `web` hosts that turn a single-source "maybe" into "likely". */
export const WEB_AGREEMENT_MIN_HOSTS = 2;
/** Forecast probability (percent) at or above which the band is "likely". */
export const PRECIP_LIKELY_MIN = 60;
/** Forecast probability (percent) at or above which the band is "maybe"; below it, "unlikely". */
export const PRECIP_MAYBE_MIN = 30;
/** A stored memory under this fact_confidence (0 to 1) is "recalled". */
export const MEMORY_LOW_CONFIDENCE = 0.6;
/** A stored memory older than this many days is "recalled". */
export const MEMORY_OLD_DAYS = 180;

const DAY_MS = 86_400_000;

function hostOf(site: string | undefined, url: string | undefined): string | null {
  const raw = site?.trim();
  if (raw) return raw.toLowerCase().replace(/^www\./, "");
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The distinct hosts of an outcome's `web` sources. */
export function webHostCount(outcome: ToolExecutionOutcome): number {
  const hosts = new Set<string>();
  const add = (kind: string | undefined, site: string | undefined, url: string | undefined) => {
    if (kind !== "web") return;
    const host = hostOf(site, url);
    if (host) hosts.add(host);
  };
  if (outcome.source) add(outcome.source.kind, outcome.source.site, outcome.source.url);
  for (const s of outcome.sources ?? []) add(s.kind, s.site, s.url);
  const rows = (outcome.result?.data as { rows?: unknown } | undefined)?.rows;
  for (const s of sourcesFromRows(rows)) add(s.kind, s.site, s.url);
  return hosts.size;
}

function percentOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Forecast probability (percent) to a band, or null when there is no number. */
export function precipitationBand(percent: unknown): CertaintyBand | null {
  const p = percentOf(percent);
  if (p === null) return null;
  if (p >= PRECIP_LIKELY_MIN) return "likely";
  if (p >= PRECIP_MAYBE_MIN) return "maybe";
  return "unlikely";
}

/** The band of a weather outcome's rain chance (data.precipitation_chance), or null. */
export function weatherPrecipitationBand(outcome: ToolExecutionOutcome): CertaintyBand | null {
  if (outcome.packageId !== "weather" || outcome.status !== "succeeded") return null;
  return precipitationBand((outcome.result?.data as { precipitation_chance?: unknown } | undefined)?.precipitation_chance);
}

/** A stored memory: "recalled" when its fact_confidence is low or it is old, else "sure". */
export function memoryBand(factConfidence: number | null | undefined, createdAt: string | null | undefined, now: Date): CertaintyBand {
  if (typeof factConfidence === "number" && factConfidence < MEMORY_LOW_CONFIDENCE) return "recalled";
  const created = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isFinite(created) && now.getTime() - created > MEMORY_OLD_DAYS * DAY_MS) return "recalled";
  return "sure";
}

/** The band for one tool outcome (design section 3.4), or null when the
 * outcome did not succeed (a failure carries no fact to hedge).
 *
 * - reference source (the offline library): likely
 * - web search: two or more distinct hosts: likely; otherwise maybe
 * - a news item or archived page (source kind shelf or archive): reported
 * - memory recall: the stored memory's own band is rendered on the memory
 *   line (memoryBand); a recall tool outcome carries only prose, so sure
 * - weather: the live reading is sure; the rain chance gets its own
 *   precipitation band (weatherPrecipitationBand)
 * - the household's own record and live readings (every other package): sure */
export function certaintyOf(outcome: ToolExecutionOutcome): CertaintyBand | null {
  if (outcome.status !== "succeeded") return null;
  const kinds = new Set<string>();
  if (outcome.source?.kind) kinds.add(outcome.source.kind);
  for (const s of outcome.sources ?? []) kinds.add(s.kind);
  for (const s of sourcesFromRows((outcome.result?.data as { rows?: unknown } | undefined)?.rows)) kinds.add(s.kind);
  if (kinds.has("reference")) return "likely";
  if (kinds.has("shelf") || kinds.has("archive")) return "reported";
  if (kinds.has("web")) return webHostCount(outcome) >= WEB_AGREEMENT_MIN_HOSTS ? "likely" : "maybe";
  return "sure";
}

/** The listener gate (design 3.4, "Age/surface gate"): a child or teen
 * listener sees only the sure and likely bands, and only while the turn's
 * safety result is flagged; any weaker band is dropped (null). Typed inputs
 * only: the turn's age band and `state.safety.flagged`. */
export function gateBand(band: CertaintyBand | null, ageBand: "child" | "teen" | "adult", safetyFlagged: boolean): CertaintyBand | null {
  if (!band) return null;
  if (ageBand === "adult" || !safetyFlagged) return band;
  return band === "sure" || band === "likely" ? band : null;
}

/** The fields an evidence block adds beside a fact, already gated. */
export function certaintyFields(outcome: ToolExecutionOutcome, ageBand: "child" | "teen" | "adult", safetyFlagged: boolean): Record<string, CertaintyBand> {
  const out: Record<string, CertaintyBand> = {};
  const band = gateBand(certaintyOf(outcome), ageBand, safetyFlagged);
  if (band) out.certainty = band;
  const rain = gateBand(weatherPrecipitationBand(outcome), ageBand, safetyFlagged);
  if (rain) out.precipitation_certainty = rain;
  return out;
}
