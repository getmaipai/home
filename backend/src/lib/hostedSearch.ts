// THIN-4H (rule 7, SEARCH-KEYED-01 of docs/plans/search-resilience-
// 2026-09-24.md): an optional hosted search provider (Brave Search API).
// Off by default: no key means keyless SearXNG, exactly as before. The
// key is a household secret (`search.brave_api_key`, write-only, stored
// encrypted by the settings layer), never logged. The query leaves the
// house, so this is used for an adult's turn only: a child's or teen's
// query never reaches it, whatever is set, and the age gate is checked
// here, first, before the key is even read.
import { getHouseholdSettingValue } from "@/lib/settings";
import { assertGated, decide } from "@/lib/gate/decide";
import type { AgeBand } from "@/lib/ageBand";
import { applySafeSearchLimits, type SafeSearchLevel } from "@/lib/safeSearch";
import type { Role } from "@/middleware/auth";

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
  try {
    const value = getHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING);
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    // A stored key that no longer decrypts reads as "no key".
    return null;
  }
}

/** Whether a turn from this band may use the hosted provider: adults only. */
export function hostedSearchAllowed(band: AgeBand): boolean {
  return band === "adult";
}

/** Brave marks matches with <strong> and escapes entities; the model and the UI want plain text. */
function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
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
export async function hostedSearch(query: string, band: AgeBand, safeLevel: SafeSearchLevel, category: unknown, role?: string, parentSignal?: AbortSignal): Promise<HostedSearchResult | null> {
  const gateRole: Role = role === "owner" || role === "admin" || role === "adult" || role === "teen" || role === "child" || role === "guest" ? role : band;
  const decision = decide({
    who: { personId: "hosted-search", role: gateRole, band },
    what: { capabilities: ["search.hosted"] },
    context: { provenance: "person" },
  });
  if (decision.kind !== "allow" && decision.kind !== "allow_with_limits") return null;
  assertGated(decision);
  // Keep the pre-gate check as a defense until the broader GATE-08 cleanup.
  if (!hostedSearchAllowed(band)) return null;
  const effectiveSafeLevel = applySafeSearchLimits(safeLevel, band, decision.kind === "allow_with_limits" ? decision.limits : []);
  // A guest carries no age or identity signal (the band reads "adult" for
  // lack of a minor signal), so a guest's query stays on the household's SearXNG.
  if (role === "guest") return null;
  if (category === "images" || category === "videos") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  try {
    // Inside the try: a stored key that no longer decrypts must fall back to
    // SearXNG, never fail the search.
    const key = hostedSearchKey();
    if (!key) return null;
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(ROW_CAP));
    // The gate keeps the explicit person's setting while enforcing the
    // spec-declared band floor.
    url.searchParams.set("safesearch", effectiveSafeLevel);
    const response = await fetch(url, {
      headers: { accept: "application/json", "x-subscription-token": key },
      signal: controller.signal,
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
      const snippet = typeof item.description === "string" ? plainText(item.description) : "";
      rows.push({ title: plainText(item.title), url: rowUrl, snippet: snippet.length > 0 ? snippet : null });
    }
    if (rows.length === 0) return null;
    const text = rows.map((r, i) => `${i + 1}. ${r.title} (${r.url})${r.snippet ? ` - ${r.snippet}` : ""}`).join("\n");
    return { text, rows };
  } catch {
    // Never log the error object: a fetch error can carry request headers.
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}
