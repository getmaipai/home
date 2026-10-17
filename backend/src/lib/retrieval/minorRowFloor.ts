// The ONE per-row floor a child's or teen's web search results pass, whichever source produced them
// (MINOR-SEARCH-01e-5, THIN-4C, SEARCH-DDGS-TEEN-01): the title and snippet pass the spec's safety check with
// isMinor (which includes the prompt-injection detector), and the address must not be on a blocked-site list
// for the band. packageHost.ts `floorSearchResult` (every blended and SearXNG result) and ddgsSource.ts (the
// choke point that talks to the sidecar) both ask this function; nothing copies it.
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import type { AgeBand } from "@/lib/ageBand";
import { urlAllowedFor } from "@/lib/blocklists/hostLists";

export function minorRowTrips(row: { title: string; snippet?: string | null }): boolean {
  return checkSafety(`${row.title}. ${row.snippet ?? ""}`, { isMinor: true }).flagged;
}

export function minorRowAllowed(band: AgeBand, row: { title: string; snippet?: string | null; url?: string | null }): boolean {
  return !minorRowTrips(row) && urlAllowedFor(band, row.url);
}
