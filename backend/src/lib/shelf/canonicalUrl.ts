// KS-05: the one definition of "the same article" on the shelf. Syntactic
// only: the poller never fetches an article page to chase a redirect (a
// request per item would break the request budget), so two feeds that link
// the same story with different tracking parameters collapse to one row,
// and two genuinely different addresses stay two.
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "yclid", "_hsenc", "_hsmi",
  "ref", "ref_src", "cmpid", "ncid", "rss", "ito", "at_medium", "at_campaign",
]);

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/** The canonical form of an article link, or null when it is not a usable
 * public web link (wrong scheme, embedded credentials, unparsable). */
export function canonicalUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  const kept = [...url.searchParams.entries()].filter(([name]) => !isTracking(name));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [name, value] of kept) url.searchParams.append(name, value);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}
