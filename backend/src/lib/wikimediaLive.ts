// KS-02: `wikimedia-live`, the one definition of Home's live Wikimedia
// connection (DESIGN section 5). The base URL, the per-host rate budget and
// the privacy row id are declared here and nowhere else; the fallback in
// packageHost.ts reads them. It is the last resort: lookup() reaches it only
// when the household's offline library had no title match for an adult's
// search that the live web also failed to answer. The old household
// setting `search.wikipedia_fallback` is retired with this: the privacy row
// "wikimedia-live" on the websearch package is the disclosure.
//
// MAIPAI_WIKIPEDIA_BASE_URL lets a test point this at a local fixture; no
// deployment sets it.
export const WIKIMEDIA_LIVE_ID = "wikimedia-live";
export const WIKIMEDIA_LIVE_RATE_LIMIT_KEY = "wikipedia";
// A page every few seconds, the same shape the SearXNG page budget has.
export const WIKIMEDIA_LIVE_RATE_LIMIT = { capacity: 3, refillPerSecond: 0.5 };

export function wikimediaLiveBaseUrl(): string {
  return process.env.MAIPAI_WIKIPEDIA_BASE_URL ?? "https://en.wikipedia.org";
}
