// KS-01: the tier K reader (DESIGN sections 3.1, 4 and 5). Given a name or
// topic and the asker's age band, it reads the household's offline
// reference library through the Home sidecar (`kiwixBaseUrl()`): the
// installed books the band's closed list names (referenceSources.ts), a
// `/suggest` title match per book, a `/search` full-text fallback only
// when no title matched, `/content` for at most three articles, then
// `extractArticle`. Rows pass the one release point (minorFloor.ts) and
// come back numbered, with a snapshot-date line. Nothing here leaves the
// machine (loopback), nothing here is a tool, and the `scope` argument is
// not read: KS-02 and KS-04 wire this into lookup().
//
// A disambiguation page is returned as options, never guessed at. A book
// that fails is skipped; a library that cannot be reached at all is
// reported as `unavailable` with a typed reason (refused, timed out, bad
// reply), never an invented answer.
import type { AgeBand } from "@/lib/ageBand";
import { kiwixBaseUrl } from "@/lib/kiwixSidecar";
import { extractArticle } from "@/lib/retrieval/extractArticle";
import { sharedKnowledgeDb, type KnowledgeDb } from "@/lib/retrieval/knowledgeDb";
import { articleFloorText, releaseToBand, tripsMinorFloor, type ReferenceRow, type ReleaseCandidate } from "@/lib/retrieval/minorFloor";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";
import { readableBooks, type ReadableBook } from "@/lib/retrieval/referenceSources";

export const REFERENCE_MAX_ROWS = 3;
const REQUEST_TIMEOUT_MS = 2500;
const TOTAL_DEADLINE_MS = 6000;
const LISTING_TTL_MS = 10 * 60_000;
const BOOKS_TTL_MS = 60_000;
const LISTING_MAX_ENTRIES = 300;
const SUGGEST_COUNT = 5;
const SEARCH_COUNT = 3;

export type ReferenceUnavailableReason = "not_running" | "timeout" | "http_error" | "bad_response";

export type ReferenceOutcome = "found" | "disambiguation" | "no_match" | "no_library" | "unavailable";

export interface ReferenceLookup {
  outcome: ReferenceOutcome;
  rows: ReferenceRow[];
  /** The model-facing block: numbered sources as data, then the snapshot line. */
  text: string;
  unavailableReason?: ReferenceUnavailableReason;
}

export interface ReferenceLookupInput {
  /** A name or topic, not a question. */
  query: string;
  band: AgeBand;
  /** First source number (KS-02 numbers tier K rows after web rows). */
  startAt?: number;
  maxRows?: number;
}

export interface ReferenceReaderDeps {
  /** Default: the Home sidecar's base URL. */
  baseUrl?: string | null;
  fetch?: typeof fetch;
  /** Default: the shared knowledge.db. Pass null for no cache. */
  db?: KnowledgeDb | null;
  now?: () => number;
}

class Unavailable extends Error {
  constructor(readonly reason: ReferenceUnavailableReason) {
    super(reason);
  }
}

const listingCache = new Map<string, { at: number; value: unknown }>();
let booksCache: { at: number; baseUrl: string; value: string[] } | null = null;
const snapshotCache = new Map<string, { at: number; value: string | null }>();

export function __resetReferenceReaderCachesForTests(): void {
  listingCache.clear();
  snapshotCache.clear();
  booksCache = null;
}

interface Ctx {
  baseUrl: string;
  fetchImpl: typeof fetch;
  now: () => number;
  signal: AbortSignal;
}

async function getText(ctx: Ctx, path: string): Promise<{ status: number; text: string }> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await ctx.fetchImpl(`${ctx.baseUrl}${path}`, { signal, headers: { accept: "*/*" } });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new Unavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "not_running");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new Unavailable("bad_response");
  }
  return { status: res.status, text };
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

function encodePath(path: string): string {
  return path.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function installedBooks(ctx: Ctx): Promise<string[]> {
  if (booksCache && booksCache.baseUrl === ctx.baseUrl && ctx.now() - booksCache.at < BOOKS_TTL_MS) return booksCache.value;
  const { status, text } = await getText(ctx, "/catalog/v2/entries?count=200");
  if (status !== 200) throw new Unavailable("http_error");
  const books = new Set<string>();
  for (const m of text.matchAll(/href="\/content\/([^"/?#]+)"/g)) books.add(safeDecode(m[1]!));
  const value = [...books];
  booksCache = { at: ctx.now(), baseUrl: ctx.baseUrl, value };
  return value;
}

async function snapshotDate(ctx: Ctx, book: string): Promise<string | null> {
  const hit = snapshotCache.get(book);
  if (hit && ctx.now() - hit.at < LISTING_TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    const { status, text } = await getText(ctx, `/raw/${encodeURIComponent(book)}/meta/Date`);
    const trimmed = text.trim();
    if (status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) value = trimmed;
  } catch (err) {
    if (!(err instanceof Unavailable)) throw err;
    // A failed read is not remembered: the next lookup asks again.
    return null;
  }
  snapshotCache.set(book, { at: ctx.now(), value });
  return value;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

interface Hit {
  title: string;
  path: string;
  exact: boolean;
}

async function listingCached<T>(ctx: Ctx, key: string, load: () => Promise<T>): Promise<T> {
  const hit = listingCache.get(key);
  if (hit && ctx.now() - hit.at < LISTING_TTL_MS) return hit.value as T;
  const value = await load();
  if (listingCache.size >= LISTING_MAX_ENTRIES) {
    const oldest = listingCache.keys().next().value;
    if (oldest !== undefined) listingCache.delete(oldest);
  }
  listingCache.set(key, { at: ctx.now(), value });
  return value;
}

async function suggest(ctx: Ctx, book: string, term: string): Promise<Hit | null> {
  const entries = await listingCached(ctx, `s|${book}|${term}`, async () => {
    bumpReferenceCounter("suggest");
    const { status, text } = await getText(ctx, `/suggest?content=${encodeURIComponent(book)}&term=${encodeURIComponent(term)}&count=${SUGGEST_COUNT}`);
    if (status === 404 || status === 400) return [] as unknown[];
    if (status !== 200) throw new Unavailable("http_error");
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Unavailable("bad_response");
    }
  });
  const want = norm(term);
  let first: Hit | null = null;
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const entry = e as { value?: unknown; label?: unknown; kind?: unknown; path?: unknown };
    if (entry.kind === "pattern") continue;
    const label = typeof entry.label === "string" ? entry.label : typeof entry.value === "string" ? entry.value : "";
    const path = typeof entry.path === "string" && entry.path.length > 0 ? entry.path : label.length > 0 ? `A/${label.replace(/ /g, "_")}` : "";
    if (label.length === 0 || path.length === 0) continue;
    const hit: Hit = { title: label, path, exact: norm(label) === want };
    if (hit.exact) return hit;
    first ??= hit;
  }
  return first;
}

async function fullText(ctx: Ctx, book: string, pattern: string): Promise<Hit | null> {
  const items = await listingCached(ctx, `f|${book}|${pattern}`, async () => {
    bumpReferenceCounter("search");
    const { status, text } = await getText(ctx, `/search?content=${encodeURIComponent(book)}&pattern=${encodeURIComponent(pattern)}&format=xml&pageLength=${SEARCH_COUNT}`);
    if (status === 400 || status === 404) return [] as Hit[];
    if (status !== 200) throw new Unavailable("http_error");
    const found: Hit[] = [];
    for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const body = m[1]!;
      const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1];
      const link = /<link>([\s\S]*?)<\/link>/.exec(body)?.[1];
      if (!title || !link) continue;
      const marker = `/content/${encodeURIComponent(book)}/`;
      const at = link.indexOf(marker);
      const rest = at >= 0 ? link.slice(at + marker.length) : link.replace(/^.*\/content\/[^/]+\//, "");
      if (rest.length === 0) continue;
      found.push({ title: decodeEntities(title).trim(), path: safeDecode(decodeEntities(rest)), exact: false });
    }
    return found;
  });
  return items[0] ?? null;
}

async function readArticle(ctx: Ctx, db: KnowledgeDb | null, rb: ReadableBook, hit: Hit): Promise<ReleaseCandidate | null> {
  const snapshot = await snapshotDate(ctx, rb.book);
  const stamp = snapshot ?? "unknown";
  let cached: ReturnType<KnowledgeDb["getArticle"]> = null;
  try {
    cached = db?.getArticle(rb.book, hit.path, stamp) ?? null;
  } catch {
    cached = null; // a cache that cannot be read is a miss
  }
  if (cached) {
    bumpReferenceCounter("cache_hit");
    return { source: rb.source, book: rb.book, path: hit.path, snapshotDate: snapshot, article: cached.article, minorOk: cached.minorOk };
  }
  bumpReferenceCounter("cache_miss");
  bumpReferenceCounter("content");
  const { status, text } = await getText(ctx, `/content/${encodeURIComponent(rb.book)}/${encodePath(hit.path)}`);
  if (status === 404) return null;
  if (status !== 200) throw new Unavailable("http_error");
  const article = extractArticle(text);
  if (article.title.length === 0) article.title = hit.title;
  if (!article.disambiguation && article.lead.length === 0) {
    bumpReferenceCounter("extract_empty");
    return null;
  }
  // Ingest floor: the verdict is stored with the extract, for every band,
  // so a minor's release step can refuse it without trusting the asker.
  const minorOk = !tripsMinorFloor(articleFloorText(article));
  try {
    db?.putArticle(rb.book, hit.path, stamp, article, minorOk);
  } catch {
    // The cache is optional: the article is still released this once.
  }
  return { source: rb.source, book: rb.book, path: hit.path, snapshotDate: snapshot, article, minorOk };
}

/** Article text is data: a line that starts like a source marker must not
 * read as one. */
function neutraliseMarkers(text: string): string {
  return text.replace(/^(\s*)\[(\d+)\]/gm, "$1($2)");
}

function renderRow(row: ReferenceRow): string {
  const licence = row.licence === "public-domain" ? "public domain" : "CC BY-SA 4.0";
  const when = row.snapshotDate ? `offline copy, ${row.snapshotDate}` : "offline copy";
  const head = `[${row.n}] ${row.sourceLabel} (${when}), ${licence}: ${row.title}`;
  if (row.disambiguation) {
    return `${head}\nSeveral articles share this name: ${row.options.join("; ") || "(none listed)"}. None was chosen.`;
  }
  const facts = row.infobox.length > 0 ? `\nFacts: ${row.infobox.map((r) => `${r.label}: ${r.value}`).join("; ")}` : "";
  return `${head}\n${neutraliseMarkers(row.lead)}${facts}`;
}

export function renderReferenceText(rows: readonly ReferenceRow[]): string {
  if (rows.length === 0) return "No article in the library matched.";
  const dates = [...new Set(rows.map((r) => r.snapshotDate).filter((d): d is string => d !== null))].sort();
  const snapshot = dates.length > 0 ? `\n\nThis library copy is from ${dates[dates.length - 1]}; for anything after that, search with scope web.` : "";
  return `${rows.map(renderRow).join("\n\n")}${snapshot}`;
}

const NOT_FOUND = (outcome: ReferenceOutcome, extra: Partial<ReferenceLookup> = {}): ReferenceLookup => ({
  outcome,
  rows: [],
  text: outcome === "no_library" ? "The home library has no reference set installed for this person." : outcome === "unavailable" ? "The home library could not be reached." : "No article in the library matched.",
  ...extra,
});

export async function lookupReference(input: ReferenceLookupInput, deps: ReferenceReaderDeps = {}): Promise<ReferenceLookup> {
  const query = input.query.trim();
  const baseUrl = deps.baseUrl === undefined ? kiwixBaseUrl() : deps.baseUrl;
  if (!baseUrl) {
    bumpReferenceCounter("unavailable", input.band);
    return NOT_FOUND("unavailable", { unavailableReason: "not_running" });
  }
  if (query.length === 0) return NOT_FOUND("no_match");
  const ctx: Ctx = {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    fetchImpl: deps.fetch ?? fetch,
    now: deps.now ?? Date.now,
    signal: AbortSignal.timeout(TOTAL_DEADLINE_MS),
  };
  const db = deps.db === undefined ? sharedKnowledgeDb() : deps.db;
  const maxRows = Math.max(1, Math.min(input.maxRows ?? REFERENCE_MAX_ROWS, REFERENCE_MAX_ROWS));
  try {
    const installed = await installedBooks(ctx);
    const { books, excluded } = readableBooks(installed, input.band);
    if (excluded > 0) bumpReferenceCounter("source_excluded", input.band, excluded);
    if (books.length === 0) return NOT_FOUND("no_library");

    // One source, one row: the first readable book of each source that
    // title-matches, in the band's reading order.
    const picks: Array<{ rb: ReadableBook; hit: Hit }> = [];
    const seenSources = new Set<string>();
    let suggestFailure: ReferenceUnavailableReason | null = null;
    for (const rb of books) {
      if (picks.length >= maxRows) break;
      if (seenSources.has(rb.source.id)) continue;
      let hit: Hit | null;
      try {
        hit = await suggest(ctx, rb.book, query);
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        suggestFailure = err.reason; // one unreadable book does not fail the others
        continue;
      }
      if (!hit) continue;
      seenSources.add(rb.source.id);
      picks.push({ rb, hit });
      bumpReferenceCounter("title_match", input.band);
    }
    if (picks.length === 0) {
      for (const rb of books.slice(0, 2)) {
        const hit = await fullText(ctx, rb.book, query);
        if (hit) {
          picks.push({ rb, hit });
          break;
        }
      }
    }
    if (picks.length === 0 && suggestFailure) throw new Unavailable(suggestFailure);
    if (picks.length === 0) {
      bumpReferenceCounter("no_match", input.band);
      return NOT_FOUND("no_match");
    }

    const candidates: ReleaseCandidate[] = [];
    let failure: ReferenceUnavailableReason | null = null;
    for (const { rb, hit } of picks) {
      try {
        const c = await readArticle(ctx, db, rb, hit);
        if (c) candidates.push(c);
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        // One unreadable article does not fail the others.
        failure = err.reason;
        bumpReferenceCounter("unavailable", input.band);
      }
    }
    if (candidates.length === 0 && failure) return NOT_FOUND("unavailable", { unavailableReason: failure });
    const rows = releaseToBand(candidates, input.band, input.startAt ?? 1);
    if (rows.length === 0) {
      bumpReferenceCounter("no_match", input.band);
      return NOT_FOUND("no_match");
    }
    const disambiguation = rows.some((r) => r.disambiguation);
    if (disambiguation) bumpReferenceCounter("disambiguation", input.band);
    return { outcome: disambiguation && rows.every((r) => r.disambiguation) ? "disambiguation" : "found", rows, text: renderReferenceText(rows) };
  } catch (err) {
    if (err instanceof Unavailable) {
      bumpReferenceCounter("unavailable", input.band);
      return NOT_FOUND("unavailable", { unavailableReason: err.reason });
    }
    throw err;
  }
}

/** KS-02: one cited article by book and path, for the proxy route a source
 * card links to. It goes through the same closed per-band list, the same
 * extract and cache, and the same release point as a lookup, so a link
 * cannot reach what a search could not. `null` for anything that is not
 * readable by this band, not installed, or dropped by the floor. */
export async function readReferencePage(input: { book: string; path: string; band: AgeBand }, deps: ReferenceReaderDeps = {}): Promise<ReferenceRow | null> {
  const baseUrl = deps.baseUrl === undefined ? kiwixBaseUrl() : deps.baseUrl;
  if (!baseUrl || input.path.length === 0 || input.path.split("/").includes("..")) return null;
  const ctx: Ctx = { baseUrl: baseUrl.replace(/\/+$/, ""), fetchImpl: deps.fetch ?? fetch, now: deps.now ?? Date.now, signal: AbortSignal.timeout(TOTAL_DEADLINE_MS) };
  const db = deps.db === undefined ? sharedKnowledgeDb() : deps.db;
  try {
    const installed = await installedBooks(ctx);
    if (!installed.includes(input.book)) return null;
    const rb = readableBooks([input.book], input.band).books[0];
    if (!rb) {
      bumpReferenceCounter("source_excluded", input.band);
      return null;
    }
    const candidate = await readArticle(ctx, db, rb, { title: input.path, path: input.path, exact: true });
    if (!candidate) return null;
    return releaseToBand([candidate], input.band, 1)[0] ?? null;
  } catch (err) {
    if (err instanceof Unavailable) return null;
    throw err;
  }
}
