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
import { listsReadyForBand } from "@/lib/blocklists/listStore";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";

export const SOURCE_MODES = ["live", "offline", "mix"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];
/** SEARCH-SOURCES-01: `ddgs` is a web backend the household may pick (webSources.ts). It is closed for a
 * child or teen like every non-`web` source unless an admin allowed it for that band (`minorDdgsAllowed`), and
 * follows the web override for an adult. */
export type ModeSource = "wikimedia" | "web" | "hosted" | "ddgs";
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

/** Model-facing only: the model words it for the person itself; no fixed line is shown to a child or teen. */
export const LISTS_LOADING_NOTE =
  "Web search is not available for this person right now because the home's blocked-site lists have not finished loading. Only the offline library was searched. Do not tell them to change a setting; say that looking things up online is not ready yet and answer from what you know.";

export const CHILD_WEB_OFF_NOTE =
  "Web search is off for child controls in this home, so only the offline library was searched. A grown-up with an admin account can turn it on in Settings, Search.";
export const TEEN_WEB_OFF_NOTE =
  "Web search is off for teen controls in this home, so only the offline library was searched. An admin can turn it on in Settings, Search.";
export const CHILD_TEMPORARY_WEB_OFF_NOTE =
  "Web search isn't used in a temporary chat for child controls, so only the offline library was searched. Start a regular chat to look things up online.";

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

/** SEARCH-DDGS-TEEN-01 (owner's request, 2026-10-17): DuckDuckGo (ddgs) is closed for a child and teen unless an owner or
 * admin switched it on for that band. `off` (default) | `teens` | `teens_and_children`. Children are never on without
 * `teens_and_children`. A value that cannot be read, or an unknown one, is off (fail closed). This is only the band's
 * permission; webSources.ts still needs ddgs built, picked and beside SearXNG, and the band's web switch still decides first. */
export const MINOR_DDGS_KEY = "search.ddgs_for_minors";
export function minorDdgsAllowed(band: AgeBand): boolean {
  if (band === "adult") return false;
  try {
    const value = getHouseholdSettingValue(MINOR_DDGS_KEY);
    return band === "teen" ? value === "teens" || value === "teens_and_children" : value === "teens_and_children";
  } catch {
    return false;
  }
}

export const BAND_WEB_KEYS = { child: "search.web.child_mode", teen: "search.web.teen_mode" } as const;

/** MINOR-SEARCH-01c: why a minor's web side is off, if it is. A child's temporary chat has no
 * saved record a parent can open, so the web side is offline there; a teen's temporary chat may
 * search (the 2026-09-30 teen-private ruling). Otherwise the household's band switch decides. */
function bandWebOffCause(band: AgeBand, temporary: boolean): "child_temporary" | "switch_off" | null {
  if (band === "adult") return null;
  if (band === "child" && temporary) return "child_temporary";
  try {
    return getHouseholdSettingValue(BAND_WEB_KEYS[band]) === "off" ? "switch_off" : null;
  } catch {
    // A child-protection switch that cannot be read fails closed.
    return "switch_off";
  }
}

/** The household's own switch for a band's web search, ignoring the temporary-chat rule and list readiness. */
export function bandSwitchOff(band: AgeBand): boolean {
  return bandWebOffCause(band, false) === "switch_off";
}

/** MINOR-SEARCH-01e-5: a child's or teen's web side stays off until every blocked-site list enabled for the band
 * has loaded once (fail closed). A grown-up's band is never held. */
function listsLoading(band: AgeBand, source: ModeSource): boolean {
  if (band === "adult" || source === "wikimedia") return false;
  try {
    return !listsReadyForBand(band);
  } catch {
    return true;
  }
}

/** The mode in force for one source and one age band. `temporary` is true in a temporary chat. */
export function effectiveMode(source: ModeSource, band: AgeBand, temporary = false): EffectiveMode {
  if (source !== "web" && band !== "adult" && !(source === "ddgs" && minorDdgsAllowed(band))) return "closed";
  if (source === "wikimedia") return overrideMode("wikimedia") ?? householdMode();
  if (bandWebOffCause(band, temporary)) return "offline";
  if (listsLoading(band, source)) return "offline";
  // Web, page reads and the hosted provider share the web override. A household
  // value of `offline` is the narrow reading: those stay on, as today (`live`).
  const override = overrideMode("web");
  if (override) return override;
  const household = householdMode();
  return household === "offline" ? "live" : household;
}

/** True when the web side (search, page reads, hosted) is switched off for this band. */
export function webSideOff(band: AgeBand, temporary = false): boolean {
  const mode = effectiveMode("web", band, temporary);
  return mode === "offline" || mode === "closed";
}

/** Counts and returns the policy refusal text for a web call the household turned off. */
export function refuseWeb(band: AgeBand, temporary = false): string {
  bumpReferenceCounter("mode_blocked_offline", band);
  const cause = bandWebOffCause(band, temporary);
  if (cause === "child_temporary") return CHILD_TEMPORARY_WEB_OFF_NOTE;
  if (cause === "switch_off") return band === "teen" ? TEEN_WEB_OFF_NOTE : CHILD_WEB_OFF_NOTE;
  if (listsLoading(band, "web")) return LISTS_LOADING_NOTE;
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

export const DICTIONARY_FALLBACK_KEY = "search.dictionary_fallback";

/** DEFINE-FALLBACK-01: whether a single-word Wiktionary lookup may run for this band.
 * True only when the household switched `search.dictionary_fallback` on (default off),
 * the person is an adult (the age gate outranks everything, rule 0), and the live
 * Wikimedia source is not `offline` or `closed` for them. */
export function dictionaryFallbackAllowed(band: AgeBand): boolean {
  if (band !== "adult") return false;
  const mode = effectiveMode("wikimedia", band);
  if (mode === "offline" || mode === "closed") return false;
  try {
    return getHouseholdSettingValue(DICTIONARY_FALLBACK_KEY) === true;
  } catch {
    return false;
  }
}
