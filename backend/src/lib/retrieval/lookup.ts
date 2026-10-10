// KS-02: lookup(), the federated search of DESIGN section 3. The model picks a
// `scope` on the existing `websearch` tool ("reference", "web", or neither);
// this module is the one place that turns that choice into work. No query
// classifier, no keyword rule, no fixed ladder (rule 1): the scope is the
// model's argument and nothing else decides it.
//
//   reference  tier K only (the household's offline library). Nothing leaves
//              the machine, so the web callback is never called.
//   web        the live web, plus tier K as a lead when it title-matches,
//              limited to the last month when the words name no year.
//   (omitted)  both, labelled.
//
// Every library row carries its kind, so it is never passed off as a web
// row. A minor's floor and the closed per-band source list live in the tier K
// reader (referenceReader.ts, minorFloor.ts); this module never reads a book
// itself, so there is no second path past them.
import type { AgeBand } from "@/lib/ageBand";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";
import { lookupReference, type ReferenceLookup, type ReferenceReaderDeps } from "@/lib/retrieval/referenceReader";
import type { ReferenceRow } from "@/lib/retrieval/minorFloor";

export type SearchScope = "reference" | "web" | "both";

export function parseScope(raw: unknown): SearchScope {
  return raw === "reference" || raw === "web" ? raw : "both";
}

/** The proxy route a cited local page is served from (routes/reference.ts). */
export function referenceUrl(book: string, path: string): string {
  // The path is one URL segment (a slash inside it stays encoded), so the route has two plain params.
  return `/api/reference/${encodeURIComponent(book)}/${encodeURIComponent(path)}`;
}

export interface LookupRow {
  title: string;
  url: string | null;
  snippet: string | null;
  kind?: "reference";
  source_label?: string;
  licence?: string;
  snapshot_date?: string | null;
}

export interface LookupPage {
  url: string;
  title: string;
  text: string;
}

export interface LookupResultShape {
  text: string;
  rows: LookupRow[];
  pages?: LookupPage[];
}

const SNIPPET_MAX = 300;

export function referenceToLookupRow(row: ReferenceRow): LookupRow {
  const snippet = row.disambiguation ? `Several articles share this name: ${row.options.join("; ")}. None was chosen.` : row.lead.length > SNIPPET_MAX ? `${row.lead.slice(0, SNIPPET_MAX - 1).trimEnd()}...` : row.lead;
  return { title: row.title, url: referenceUrl(row.book, row.path), snippet, kind: "reference", source_label: row.sourceLabel, licence: row.licence, snapshot_date: row.snapshotDate };
}

function referenceToPage(row: ReferenceRow): LookupPage | null {
  if (row.disambiguation) return null;
  const facts = row.infobox.length > 0 ? `\n\n${row.infobox.map((r) => `${r.label}: ${r.value}`).join("\n")}` : "";
  return { url: referenceUrl(row.book, row.path), title: row.title, text: `${row.lead}${facts}` };
}

/** The "month" freshness window applies to a web search that names no year. */
export function webTimeRange(query: string, scope: SearchScope): "month" | undefined {
  if (scope !== "web") return undefined;
  return /\b(19|20)\d{2}\b/.test(query) ? undefined : "month";
}

export interface FederatedInput<R extends LookupResultShape> {
  query: string;
  band: AgeBand;
  scope: SearchScope;
  /** Runs the live web side. `kMatched` tells it the library already answered,
   *  so the live Wikimedia fallback must stay quiet. */
  web: (ctx: { kMatched: boolean; timeRange: "month" | undefined }) => Promise<R>;
}

export interface FederatedDeps {
  reference?: ReferenceReaderDeps;
  lookupReference?: typeof lookupReference;
}

export async function federatedLookup<R extends LookupResultShape>(input: FederatedInput<R>, deps: FederatedDeps = {}): Promise<LookupResultShape> {
  bumpReferenceCounter(input.scope === "reference" ? "scope_reference" : input.scope === "web" ? "scope_web" : "scope_both", input.band);
  const reader = deps.lookupReference ?? lookupReference;
  const ref: ReferenceLookup = await reader({ query: input.query, band: input.band }, deps.reference);
  const kRows = ref.rows.map(referenceToLookupRow);
  const kPages = ref.rows.map(referenceToPage).filter((p): p is LookupPage => p !== null);
  const kOnly = { text: ref.text, rows: kRows, ...(kPages.length > 0 ? { pages: kPages } : {}) };
  if (input.scope === "reference") return kOnly;

  const kMatched = ref.rows.length > 0;
  if (kMatched) {
    bumpReferenceCounter("k_lead", input.band);
  }
  let web: R;
  try {
    web = await input.web({ kMatched, timeRange: webTimeRange(input.query, input.scope) });
  } catch (err) {
    // The library already answered: a web failure does not fail the answer.
    if (!kMatched) throw err;
    // For a web-scoped ask the model must learn the live side did not answer.
    return input.scope === "web" ? { ...kOnly, text: `${ref.text}\n\nThe live web search did not answer; the library copy above may be out of date.` } : kOnly;
  }
  if (!kMatched) return web;
  const { text: webText, rows: webRows, pages: webPages, ...rest } = web;
  const text = webRows.length > 0 || webText.trim().length > 0 ? `${ref.text}\n\nWeb results:\n${webText}` : ref.text;
  const pages = [...kPages, ...(webPages ?? [])];
  return { ...rest, text, rows: [...kRows, ...webRows], ...(pages.length > 0 ? { pages } : {}) };
}
