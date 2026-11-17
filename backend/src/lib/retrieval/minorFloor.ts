// KS-01 (docs/design/RULES.md rules 0 and 7; DESIGN K6): the one choke
// point where tier K text is released to an asker. Every row the reader
// builds passes `releaseToBand` and nothing else numbers or returns a row.
// For a child or teen each row's text must pass the same deterministic
// floor the model's own output and fetched pages pass (the spec's
// checkSafety with isMinor, prompt-injection detector included); a row
// that trips it is dropped and counted. The same predicate runs at ingest
// (the extracted-article cache stores the result as `minorOk`), and the
// release step runs it again on read, so a cached row is never trusted on
// its own word. An adult's rows are kept (the text is data to the model).
// No learned component sits here.
import { checkSafety } from "@maipai/spec/safety/ts/classifier.js";
import type { Audience } from "@/lib/filter/ceiling";
import { release as doorRelease, type Door, type DoorVerdict } from "@/lib/filter/door";
import type { ExtractedArticle } from "@/lib/retrieval/extractArticle";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";
import type { ReferenceSource } from "@/lib/retrieval/referenceSources";

/** Everything of an article that can reach the model. */
export function articleFloorText(article: ExtractedArticle): string {
  const facts = article.infobox.map((r) => `${r.label}: ${r.value}`).join(". ");
  const options = article.options.join(". ");
  return [article.title, article.lead, facts, options].filter((s) => s.length > 0).join(". ");
}

/** True when the text trips the minor's floor. The one definition tier K
 * uses, at ingest and at release. */
export function tripsMinorFloor(text: string): boolean {
  return checkSafety(text, { isMinor: true }).flagged;
}

export interface ReleaseCandidate {
  source: ReferenceSource;
  book: string;
  path: string;
  snapshotDate: string | null;
  article: ExtractedArticle;
  /** The floor's verdict when the article was ingested into the cache. */
  minorOk: boolean;
}

export interface ReferenceRow {
  n: number;
  kind: "reference";
  sourceId: string;
  sourceLabel: string;
  licence: ReferenceSource["licence"];
  book: string;
  path: string;
  title: string;
  snapshotDate: string | null;
  lead: string;
  infobox: Array<{ label: string; value: string }>;
  disambiguation: boolean;
  options: string[];
}

/**
 * Applies the audience's filter through the door's search surface and numbers what is left from `startAt` (SEARCH-RATING-04).
 * An article's saved floor result is its given level: `minorOk` true is G, false (or never marked) is X (C1). The door decides who runs
 * nothing (the adult band at X, C2) and who runs the raters, with the floor, injection and list catches never lifted (C6).
 * The counter reason is read from the verdict: Prohibited or a withhold is `floor_dropped`, the given X's own stamp is
 * `ingest_floor_dropped`, any other hold is `level_dropped`. A door that throws holds the candidate.
 */
export async function releaseToBand(candidates: readonly ReleaseCandidate[], audience: Audience, startAt = 1, options: { door?: Pick<Door, "release"> } = {}): Promise<ReferenceRow[]> {
  const door = options.door ?? { release: doorRelease };
  const band = audience.band;
  const rows: ReferenceRow[] = [];
  for (const c of candidates) {
    let verdict: DoorVerdict;
    try {
      verdict = await door.release({
        surface: "search",
        audience,
        item: { kind: "search_row", title: "", snippet: articleFloorText(c.article), url: null, given: c.minorOk ? "G" : "X" },
      });
    } catch {
      bumpReferenceCounter("level_dropped", band);
      continue;
    }
    if (verdict.verdict === "held") {
      const rating = verdict.rating;
      if (rating?.level === "Prohibited" || verdict.withhold) bumpReferenceCounter("floor_dropped", band);
      else if (rating?.level === "X" && rating.source === "given" && !rating.reasons?.length) bumpReferenceCounter("ingest_floor_dropped", band);
      else bumpReferenceCounter("level_dropped", band);
      continue;
    }
    rows.push({
      n: startAt + rows.length,
      kind: "reference",
      sourceId: c.source.id,
      sourceLabel: c.source.label,
      licence: c.source.licence,
      book: c.book,
      path: c.path,
      title: c.article.title,
      snapshotDate: c.snapshotDate,
      lead: c.article.disambiguation ? "" : c.article.lead,
      infobox: c.article.disambiguation ? [] : c.article.infobox,
      disambiguation: c.article.disambiguation,
      options: c.article.disambiguation ? c.article.options : [],
    });
  }
  return rows;
}
