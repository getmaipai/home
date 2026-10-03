// THIN-4H (rule 7, SEARCH-KEYED-01 of docs/plans/search-resilience-
// 2026-09-24.md): an optional hosted search provider (Brave Search API).
// Off by default: no key means keyless SearXNG, exactly as before. The
// key is a household secret (`search.brave_api_key`, write-only, stored
// encrypted by the settings layer), never logged. The query leaves the
// house, so this is used for an adult's turn only: a child's or teen's
// query never reaches it, whatever is set, and the age gate is checked
// here, first, before the key is even read.
import { getHouseholdSettingValue } from "@/lib/settings";
import type { AgeBand } from "@/lib/ageBand";
import type { SafeSearchLevel } from "@/lib/safeSearch";

export const HOSTED_SEARCH_KEY_SETTING = "search.brave_api_key";
/** What the status and privacy pages name: who gets the query. */
export const HOSTED_SEARCH_PROVIDER_NAME = "Brave Search";

const DEFAULT_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 8000;
const ROW_CAP = 8;

/** The host a hosted search reaches, for the privacy table. */
export const HOSTED_SEARCH_HOST = new URL(DEFAULT_ENDPOINT).hostname;

let endpoint = DEFAULT_ENDPOINT;
export function __setHostedSearchEndpointForTests(url: string | null): void {
  endpoint = url ?? DEFAULT_ENDPOINT;
}

export type HostedSearchRow = { title: string; url: string; snippet: string | null };
export type HostedSearchResult = { text: string; rows: HostedSearchRow[] };

/** The stored key, or null when none is set. */
export function hostedSearchKey(): string | null {
  const value = getHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Whether a turn from this band may use the hosted provider: adults only. */
export function hostedSearchAllowed(band: AgeBand): boolean {
  return band === "adult";
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/** The hosted answer for an adult's web search, or null when the hosted
 * path does not apply or did not answer (no key, not an adult, an image or
 * video search, or any provider failure). Null means "use SearXNG": a
 * failed provider never fails the answer (rule 6). */
export async function hostedSearch(query: string, band: AgeBand, safeLevel: SafeSearchLevel, category: unknown): Promise<HostedSearchResult | null> {
  if (!hostedSearchAllowed(band)) return null;
  if (category === "images" || category === "videos") return null;
  const key = hostedSearchKey();
  if (!key) return null;
  try {
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(ROW_CAP));
    url.searchParams.set("safesearch", safeLevel);
    const response = await fetch(url, {
      headers: { accept: "application/json", "x-subscription-token": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { web?: { results?: unknown } };
    const items = Array.isArray(body.web?.results) ? (body.web.results as unknown[]) : [];
    const rows: HostedSearchRow[] = [];
    for (const raw of items) {
      if (rows.length >= ROW_CAP) break;
      const item = raw as { title?: unknown; url?: unknown; description?: unknown };
      const rowUrl = cleanUrl(item.url);
      if (typeof item.title !== "string" || !rowUrl) continue;
      rows.push({ title: item.title, url: rowUrl, snippet: typeof item.description === "string" && item.description.length > 0 ? item.description : null });
    }
    if (rows.length === 0) return null;
    const text = rows.map((r, i) => `${i + 1}. ${r.title} (${r.url})${r.snippet ? ` - ${r.snippet}` : ""}`).join("\n");
    return { text, rows };
  } catch {
    // Never log the error object: a fetch error can carry request headers.
    return null;
  }
}
