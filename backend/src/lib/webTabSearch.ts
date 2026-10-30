// WEB-TAB-01 (docs/plans/palette-web-tab-2026-10-30.md): the search palette's Web tab. One explicit web search a person asked
// for by pressing Enter on the tab. It runs the same picked sources, minor protections and site blocks as the websearch tool
// (`searchPickedWebSources`), but fetches no page and never falls back to Wikipedia, and it stores and logs no query text.
import type { PersonRow } from "@/types";
import type { SearchResult } from "@/lib/search/providers";
import { speakerAgeBand } from "@/lib/ageBand";
import { getPersonSettingValue } from "@/lib/settings";
import { resolveSafeSearchLevel } from "@/lib/safeSearch";
import { NO_SOURCE_FOR_BAND_TEXT } from "@/lib/retrieval/webSources";
import { MINOR_QUERY_PERSONAL_NOTE, minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import { minorRowAllowed } from "@/lib/retrieval/minorRowFloor";
import { bandSwitchOff, webSideOff } from "@/lib/retrieval/sourceMode";
import { websearchGateAllows } from "@/lib/searchAssist/minorGate";
import { runAsBlockViewer } from "@/lib/blocklists/blockViewer";
import { WEB_TAB_GETTING_READY, WEB_TAB_NOT_ALLOWED, WEB_TAB_NOT_ANSWERING, WEB_TAB_OFF_ADULT, WEB_TAB_OFF_MINOR } from "@/lib/failureCopy";
import { searchPickedWebSources } from "@/lib/packageHost";
import type { Role } from "@/middleware/auth";

export const WEB_TAB_MAX_RESULTS = 10;
export const WEB_TAB_QUERY_MAX = 200;

export interface WebTabAnswer {
  results: SearchResult[];
  /** A plain-words reason there are no rows (off, no source, not allowed, not answering); absent when rows came back. */
  note?: string;
}

function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export async function webTabSearch(actor: PersonRow, rawQuery: string, signal?: AbortSignal): Promise<WebTabAnswer> {
  const query = rawQuery.trim().slice(0, WEB_TAB_QUERY_MAX);
  if (query.length === 0) return { results: [] };
  // A guest carries no age signal, so they get no web search from the palette (decision 3).
  if (actor.role === "guest") return { results: [], note: WEB_TAB_NOT_ALLOWED };
  const band = speakerAgeBand(actor, new Date());
  if (webSideOff(band)) return { results: [], note: band === "adult" ? WEB_TAB_OFF_ADULT : bandSwitchOff(band) ? WEB_TAB_OFF_MINOR : WEB_TAB_GETTING_READY };
  if (!websearchGateAllows({ personId: actor.id, role: actor.role as Role, band, anonymous: false }, { crisis: false, temporary: false })) {
    return { results: [], note: WEB_TAB_NOT_ALLOWED };
  }
  // A closed personal detail in a child's or teen's words never leaves the house.
  if (minorQueryHit(query, band)) return { results: [], note: MINOR_QUERY_PERSONAL_NOTE };
  const safeSearchLevel = resolveSafeSearchLevel(getPersonSettingValue(actor, "search.safe_search"), band);
  try {
    const found = await runAsBlockViewer(actor.id, () =>
      searchPickedWebSources({
        args: { query, read_page: false },
        band,
        role: actor.role,
        spoken: false,
        temporary: false,
        searxOpts: { safeSearchLevel, signal, speakerBand: band, ...(band === "adult" ? {} : { minorBand: band }), allowWikipediaFallback: false },
        signal,
      }),
    );
    if (found.text === NO_SOURCE_FOR_BAND_TEXT && found.rows.length === 0) return { results: [], note: NO_SOURCE_FOR_BAND_TEXT };
    const results: SearchResult[] = [];
    for (const row of found.rows) {
      if (!row.url || !row.title) continue;
      if (band !== "adult" && !minorRowAllowed(band, row)) continue;
      const host = hostOf(row.url);
      if (!host) continue;
      results.push({
        kind: "web",
        id: `${results.length}:${host}`,
        title: row.title,
        href: row.url,
        source: host,
        ...(row.snippet ? { snippet: row.snippet } : {}),
        action: "Open",
      });
      if (results.length >= WEB_TAB_MAX_RESULTS) break;
    }
    // An empty answer carries no note: the palette says "No web results found." itself. Model-facing text never reaches the wire.
    return { results };
  } catch {
    return { results: [], note: WEB_TAB_NOT_ANSWERING };
  }
}
