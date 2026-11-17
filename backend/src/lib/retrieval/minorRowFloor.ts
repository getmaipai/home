// The ONE per-row floor a child's or teen's web search results pass, whichever source produced them
// (MINOR-SEARCH-01e-5, THIN-4C, SEARCH-DDGS-TEEN-01), now through the filter door (SEARCH-RATING-02): a row is rated as it is built
// (`search-row`, filter/raters.ts) and compared with the viewer's web ceiling, so the locked adult-site list, the standing floor and the
// content policy on the title and snippet, and the engine mode's declared level all decide here and nowhere else. packageHost.ts
// `floorSearchResult` (every blended and SearXNG result), webTabSearch.ts and ddgsSource.ts (the choke point that talks to the sidecar) all
// ask this module; nothing copies it.
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import { eq } from "drizzle-orm";
import type { AgeBand } from "@/lib/ageBand";
import { isMinorBand } from "@/lib/audience";
import { db } from "@/db";
import { people } from "@/db/schema";
import { currentBlockViewer } from "@/lib/blocklists/blockViewer";
import { ceilingOf, type Audience } from "@/lib/filter/ceiling";
import { releaseSync } from "@/lib/filter/door";
import { surfaceActor } from "@/lib/filter/textGate";
import type { SearchMode } from "@/lib/filter/raters";
import { safeSearchDefaultFor } from "@/lib/safeSearch";
import type { PersonRow } from "@/types";

export function minorRowTrips(row: { title: string; snippet?: string | null }): boolean {
  return checkSafety(`${row.title}. ${row.snippet ?? ""}`, { isMinor: true }).flagged;
}

export type RowFloorOptions = {
  /** The engine mode the search ran with. When a caller does not say: strict for a child, moderate for a teen (today's `safeSearchDefaultFor`), off for an adult. */
  mode?: SearchMode;
  /** The person asking, when the caller knows. Otherwise the block viewer (`runAsBlockViewer`) is looked up, and with nobody known the band's own role defaults decide. */
  actor?: PersonRow | null;
  /** A prepared audience (one lookup per list instead of one per row). */
  audience?: Audience;
};

function personFor(id: string | undefined): PersonRow | null {
  if (!id) return null;
  try {
    return db.select().from(people).where(eq(people.id, id)).get() ?? null;
  } catch {
    return null;
  }
}

/** The audience a search is for: the real person wherever one is known (the caller's, else the block viewer's), otherwise the band's own defaults (D). */
export function searchAudienceFor(band: AgeBand, actor?: PersonRow | null): Audience {
  const person = actor ?? personFor(currentBlockViewer());
  return person ? { actor: person, band } : { actor: surfaceActor(band), band };
}

/** Whether the filter runs for this viewer's search (E): every viewer whose band is not adult, and an adult whose own web ceiling is below X. */
export function searchFilterApplies(band: AgeBand, actor?: PersonRow | null): boolean {
  if (isMinorBand(band)) return true;
  const person = actor ?? personFor(currentBlockViewer());
  return person ? ceilingOf({ actor: person, band }, "search") < 4 : false;
}

export function searchModeFor(band: AgeBand, mode?: SearchMode): SearchMode {
  return mode ?? safeSearchDefaultFor(band);
}

/** True when the row may be shown to this viewer: the door rated it and its level is within the viewer's web ceiling (or Unrated and the admin allowed it). */
export function minorRowAllowed(band: AgeBand, row: { title: string; snippet?: string | null; url?: string | null }, options: RowFloorOptions = {}): boolean {
  const audience = options.audience ?? searchAudienceFor(band, options.actor);
  const viewerId = options.actor?.id ?? (audience.actor.id.startsWith("surface:") ? null : audience.actor.id);
  return releaseSync({
    surface: "search",
    audience,
    item: { kind: "search_row", title: row.title, snippet: row.snippet ?? null, url: row.url ?? null, mode: searchModeFor(band, options.mode), viewerId },
  }).verdict === "released";
}
