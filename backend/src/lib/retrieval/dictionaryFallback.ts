// DEFINE-FALLBACK-01: the live Wiktionary word lookup. When the offline
// library has no dictionary entry for a single word, an adult's household may
// let Home ask Wiktionary (Wikimedia's own REST API) for the definitions. It
// is off by default (`search.dictionary_fallback`), adults only, and the gate
// lives in sourceMode.ts (`dictionaryFallbackAllowed`); this file only does the
// fetch. It reuses the one Wikimedia fetch choke point (`wikimediaFetchJson`:
// Home's User-Agent, no cookies, a per-host pace, a short timeout).
//
// Back-off: a 429 or any 5xx stops all further word lookups for a while. A
// failure of any kind returns null, so the caller answers from what it had
// (rule 6: a failed tool never fails the answer). Counters carry a fixed name
// and the age band only; the word is never logged, counted or kept anywhere
// but the in-memory cache below (rule 6a).
import type { AgeBand } from "@/lib/ageBand";
import { wikimediaFetchJson } from "@/lib/answerImages/wikimedia";
import { bumpReferenceCounter } from "@/lib/retrieval/referenceCounters";

export const WIKTIONARY_ORIGIN = "https://en.wiktionary.org";
export const WIKTIONARY_LABEL = "Wiktionary (live)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const BACKOFF_MS = 15 * 60 * 1000;
const MAX_SENSES = 8;

export interface DictionaryEntry {
  title: string;
  url: string;
  text: string;
}

export interface DictionaryDeps {
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => number;
}

const cache = new Map<string, { at: number; entry: DictionaryEntry | null }>();
let backoffUntil = 0;

export function __resetDictionaryFallbackForTests(): void {
  cache.clear();
  backoffUntil = 0;
}

/** The one headword the query names, or null when it is a phrase or anything but a single word. */
export function headwordOf(query: string): string | null {
  const word = query.trim();
  return /^\p{L}[\p{L}'-]{0,39}$/u.test(word) ? word : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDefinitions(word: string, body: unknown): DictionaryEntry | null {
  const english = (body as { en?: unknown } | null)?.en;
  if (!Array.isArray(english)) return null;
  const lines: string[] = [];
  for (const part of english) {
    const speech = String((part as { partOfSpeech?: unknown }).partOfSpeech ?? "").toLowerCase();
    const defs = (part as { definitions?: unknown }).definitions;
    if (!Array.isArray(defs)) continue;
    const senses = defs
      .map((d) => stripHtml(String((d as { definition?: unknown }).definition ?? "")))
      .filter((s) => s.length > 0);
    for (const sense of senses) {
      if (lines.length >= MAX_SENSES) break;
      lines.push(speech ? `${speech}: ${sense}` : sense);
    }
  }
  if (lines.length === 0) return null;
  return { title: word, url: `${WIKTIONARY_ORIGIN}/wiki/${encodeURIComponent(word)}`, text: lines.join("\n") };
}

function remember(key: string, at: number, entry: DictionaryEntry | null): void {
  cache.delete(key); // a refreshed word moves to the back of the eviction order
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at, entry });
}

/** Looks one word up. Null on a miss, a back-off or any failure. Never throws. */
export async function dictionaryLookup(word: string, band: AgeBand, deps: DictionaryDeps = {}): Promise<DictionaryEntry | null> {
  const now = (deps.now ?? Date.now)();
  const key = word.toLowerCase();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    bumpReferenceCounter("dictionary_live_cache_hit", band);
    return hit.entry;
  }
  if (now < backoffUntil) {
    bumpReferenceCounter("dictionary_live_backoff", band);
    return null;
  }
  bumpReferenceCounter("dictionary_live_call", band);
  try {
    const body = await (deps.fetchJson ?? wikimediaFetchJson)(`${WIKTIONARY_ORIGIN}/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    const entry = parseDefinitions(word, body);
    remember(key, now, entry);
    if (entry) bumpReferenceCounter("dictionary_live_hit", band);
    return entry;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/HTTP (429|5\d\d)\b/.test(message)) {
      backoffUntil = now + BACKOFF_MS;
      bumpReferenceCounter("dictionary_live_backoff", band);
    } else if (/HTTP 404\b/.test(message)) {
      remember(key, now, null);
    } else {
      bumpReferenceCounter("dictionary_live_failed", band);
    }
    return null;
  }
}
