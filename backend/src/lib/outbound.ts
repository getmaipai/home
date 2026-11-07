export const HOME_USER_AGENT = "MaiPai-Home/1.0 (+https://github.com/getmaipai/home)";

// AUDIT-DUP-NET-01: the one outbound path for a GET to a stranger's server. Every hop (the first address and each redirect) is checked
// before a byte is sent: scheme and credentials by the caller's scheme rule, then the address guard; the host is paced by the caller's
// bucket; no cookies and no referrer go upstream; redirects are followed by hand up to the caller's cap. Podcasts and feeds, radio
// streams and playlists, answer pictures and news pictures all use it; each passes its own rule as options. (`packageHost.ts` and
// `lanFetch.ts` have their own redirect loops: a plugin's fetch and a LAN-only fetch are different jobs, left alone.)
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { tryConsume } from "@/lib/rateLimiter";

/** The host's pacing bucket was empty: the caller says "try again in a few seconds". */
export class RateLimited extends Error {}
/** More redirects than the caller allows, or a redirect with no next address. */
export class RedirectLimitError extends Error {}
/** A caller's own `beforeHop` or `afterResponse` rule stopped the fetch (a quiet host, a refused address); not a failure of the fetch itself. */
export class GuardedStop extends Error {}

/** Which schemes a hop may use: `https` only; `http-after-http` (https always, http only when the first address was http: a station
 * a directory lists over http); `web` (http or https on any hop, for a picture an article names). */
export type SchemePolicy = "https" | "http-after-http" | "web";

export interface GuardedGetOptions {
  schemePolicy: SchemePolicy;
  /** The per-host pacing bucket, keyed `net:<prefix>:<host>` (`net:<host>` with no prefix) once per host per call; null when the caller paces the host itself. */
  bucket: { prefix?: string; capacity: number; refillPerSecond: number } | null;
  /** Hosts already paced by this caller, shared across calls (a retry does not pay twice). Default: a fresh set per call. */
  pacedHosts?: Set<string>;
  /** The most redirects followed; one more throws `RedirectLimitError`. */
  redirectCap: number;
  signal: AbortSignal;
  accept?: string;
  /** Extra request headers (for example `Icy-MetaData`). */
  headers?: Record<string, string>;
  /** Sent on the first host only; dropped when a redirect leaves it. */
  conditional?: { etag?: string | null; lastModified?: string | null };
  /** The sentence of the `RedirectLimitError`. */
  redirectMessage?: string;
  /** Only the platform fetch captured at load is pinned (it resolves and connects itself); any other fetcher, injected or swapped in, is validated per hop. */
  fetch?: typeof fetch;
  dnsLookup?: DnsLookup;
  now?: () => number;
  /** The pinned transport, when the caller has its own (news pictures try each address). Replaces the platform fetch path; the checks above still run. */
  send?: (url: URL, init: { method: "GET"; redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  /** Called before each hop is sent; false throws `GuardedStop`. */
  beforeHop?: (url: URL, hop: number) => boolean;
  /** Called with each answer (redirects included); may throw (`GuardedStop`) to stop. */
  afterResponse?: (response: Response, url: URL) => void;
  /** Leave a redirect's body to finish when the request was pinned (an open stream's upstream must not be cancelled early). Default false: cancel it. */
  keepPinnedRedirectBody?: boolean;
}

const platformFetch = globalThis.fetch;

function allowedHop(url: URL, policy: SchemePolicy, firstProtocol: string): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  return policy === "web" || (policy === "http-after-http" && firstProtocol === "http:");
}

/** One guarded GET. Throws `SsrfBlockedError` (scheme, credentials or a private address on any hop), `RateLimited`, `RedirectLimitError`
 * or `GuardedStop`; otherwise returns the first answer that is not a redirect (a 304 is returned as it is). */
export async function guardedGet(address: string | URL, options: GuardedGetOptions): Promise<Response> {
  const fetcher = options.fetch ?? globalThis.fetch; // read live: a swapped-in global fetch is validated per hop, never pinned
  const pinned = fetcher === platformFetch;
  const now = options.now ?? Date.now;
  const headers: Record<string, string> = { "User-Agent": HOME_USER_AGENT, Accept: options.accept ?? "*/*", ...options.headers };
  if (options.conditional?.etag) headers["If-None-Match"] = options.conditional.etag;
  if (options.conditional?.lastModified) headers["If-Modified-Since"] = options.conditional.lastModified;
  let url = new URL(address);
  const firstProtocol = url.protocol;
  const firstHost = url.host;
  const paced = options.pacedHosts ?? new Set<string>();
  for (let hop = 0; ; hop++) {
    if (!allowedHop(url, options.schemePolicy, firstProtocol)) throw new SsrfBlockedError(url.host);
    await assertNotPrivateHost(url.hostname, options.dnsLookup);
    if (options.beforeHop && !options.beforeHop(url, hop)) throw new GuardedStop();
    const host = url.hostname.toLowerCase();
    if (options.bucket && !paced.has(host)) {
      if (!tryConsume(options.bucket.prefix ? `net:${options.bucket.prefix}:${host}` : `net:${host}`, options.bucket, now())) throw new RateLimited();
      paced.add(host);
    }
    if (hop > 0 && url.host !== firstHost) { delete headers["If-None-Match"]; delete headers["If-Modified-Since"]; }
    const init = { method: "GET", redirect: "manual", signal: options.signal, headers } as const;
    const response = options.send
      ? await options.send(url, init)
      : pinned
        ? await guardedFetch(url, { ...init, maxRedirects: 0 }, options.dnsLookup)
        : await fetcher(url, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });
    options.afterResponse?.(response, url);
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location");
      if (!(pinned && options.keepPinnedRedirectBody)) await response.body?.cancel().catch(() => undefined);
      if (!location || hop >= options.redirectCap) throw new RedirectLimitError(options.redirectMessage ?? "The server sent too many redirects or left out the next address.");
      url = new URL(location, url);
      continue;
    }
    return response;
  }
}
