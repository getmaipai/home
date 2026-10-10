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
import type { AgeBand } from "@/lib/ageBand";
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

/** Applies the band's floor and numbers what is left from `startAt`. */
export function releaseToBand(candidates: readonly ReleaseCandidate[], band: AgeBand, startAt = 1): ReferenceRow[] {
  const rows: ReferenceRow[] = [];
  for (const c of candidates) {
    if (band !== "adult") {
      if (!c.minorOk) {
        bumpReferenceCounter("ingest_floor_dropped", band);
        continue;
      }
      if (tripsMinorFloor(articleFloorText(c.article))) {
        bumpReferenceCounter("floor_dropped", band);
        continue;
      }
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
