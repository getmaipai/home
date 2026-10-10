// KS-MODE-01: the search source mode. This file is the ONE place the three
// values (`live | offline | mix`) are interpreted; lookup.ts, hostedSearch.ts
// and the packageHost.ts gates ask it and never read the settings themselves.
// The tier table of docs/plans/ks-mode-01-2026-10-10.md lives here and nowhere
// else.
//
// The mode governs only reads that send a query or title out of the house.
// Tier K (the offline library) never leaves it, so every mode uses it.
//
//   source      offline (narrow)   mix (default)                      live
//   wikimedia   never              only if K and the web found none   when the web found none, even if K matched
//   web/hosted  as today           omitted scope: only if K has none  both, labelled (today)
//               (scope web ok)     scope web: yes
//
// "offline" is the owner's NARROW reading: it turns off only the live
// Wikipedia-style lookup. Web search, page reads and the hosted provider stay
// on unless `search.source_mode.web` is itself `offline`.
//
// Minors: `wikimedia` and `hosted` are CLOSED in every mode (rule 0, rule 7).
// The web side for a minor takes the same resolved value an adult gets, so
// a mode can only restrict a minor (their SearXNG safe search, floor and
// page checks are unchanged), never widen what they reach.
//
// Counters carry a fixed name and at most an age band (rule 6a).
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";

export const SOURCE_MODES = ["live", "offline", "mix"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];
export type ModeSource = "wikimedia" | "web" | "hosted";
/** `closed`: the source is never reachable for this band, whatever the setting. */
export type EffectiveMode = SourceMode | "closed";

export const SOURCE_MODE_KEY = "search.source_mode";
export const SOURCE_MODE_OVERRIDE_KEYS = {
  wikimedia: "search.source_mode.wikimedia",
  web: "search.source_mode.web",
} as const;
export const DEFAULT_SOURCE_MODE: SourceMode = "mix";

/** What the person is told when web search is switched off by the household. Problem, then the fix. */
export const WEB_OFF_NOTE =
  "Web search is turned off in this household's search settings, so only the offline library was searched. An adult can change this in Settings under Search sources.";

function asMode(value: unknown): SourceMode | null {
  return value === "live" || value === "offline" || value === "mix" ? value : null;
}

function householdMode(): SourceMode {
  try {
    return asMode(getHouseholdSettingValue(SOURCE_MODE_KEY)) ?? DEFAULT_SOURCE_MODE;
  } catch {
    return DEFAULT_SOURCE_MODE;
  }
}

function overrideMode(source: "wikimedia" | "web"): SourceMode | null {
  try {
    return asMode(getHouseholdSettingValue(SOURCE_MODE_OVERRIDE_KEYS[source]));
  } catch {
    return null;
  }
}

/** The mode in force for one source and one age band. */
export function effectiveMode(source: ModeSource, band: AgeBand): EffectiveMode {
  if (source !== "web" && band !== "adult") return "closed";
  if (source === "wikimedia") return overrideMode("wikimedia") ?? householdMode();
  // Web, page reads and the hosted provider share the web override. A household
  // value of `offline` is the narrow reading: those stay on, as today (`live`).
  const override = overrideMode("web");
  if (override) return override;
  const household = householdMode();
  return household === "offline" ? "live" : household;
}

/** True when the web side (search, page reads, hosted) is switched off for this band. */
export function webSideOff(band: AgeBand): boolean {
  const mode = effectiveMode("web", band);
  return mode === "offline" || mode === "closed";
}

/** Counts and returns the policy refusal text for a web call the household turned off. */
export function refuseWeb(band: AgeBand): string {
  bumpReferenceCounter("mode_blocked_offline", band);
  return WEB_OFF_NOTE;
}

export type WikimediaGate = "run" | "closed" | "offline";

/** Whether the live Wikimedia lookup may run for this band at all (counts the outcome).
 * The "only when K had no result" half of mix is the caller's `kMatched`, see
 * `wikimediaAllowedAfterK`. */
export function wikimediaGate(band: AgeBand): WikimediaGate {
  const mode = effectiveMode("wikimedia", band);
  if (mode === "closed") return "closed";
  if (mode === "offline") {
    bumpReferenceCounter("mode_blocked_offline", band);
    return "offline";
  }
  if (mode === "mix") bumpReferenceCounter("mode_mix_live_fallthrough", band);
  return "run";
}

/** Whether the live Wikimedia lookup may run when the library already matched:
 * only in `live`. In `mix` and `offline` a library match keeps it quiet. */
export function wikimediaAllowedAfterK(band: AgeBand): boolean {
  return effectiveMode("wikimedia", band) === "live";
}
