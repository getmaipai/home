// A publisher's host often resolves to several addresses, IPv4 and IPv6. guardedFetch pins one, so a hub whose IPv6 route is broken
// never reaches a site a browser on the same network reaches fine (browsers try the next address). This tries each resolved address
// in turn, IPv4 first, and moves on only when the connection itself fails. Every address is still checked by the SSRF guard before
// it is used, and an SSRF block is final: it never falls through to another address.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { guardedFetch, SsrfBlockedError, type DnsLookup, type GuardedFetchOptions, type PinnedRequest } from "@maipai/core/src/ssrfGuard";

export interface ResolvedAddress { address: string; family: number }
export type AllLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const systemLookupAll: AllLookup = (hostname) => lookup(hostname, { all: true });

/** How long one address gets to answer before the next is tried. The last address has only the caller's own deadline. */
export const ADDRESS_ATTEMPT_MS = 4000;

/** IPv4 first, then IPv6, each in the resolver's order, without repeats. */
export function ipv4First(addresses: readonly ResolvedAddress[]): ResolvedAddress[] {
  const seen = new Set<string>();
  const unique = addresses.filter((entry) => !seen.has(entry.address) && seen.add(entry.address));
  return [...unique.filter((entry) => entry.family === 4), ...unique.filter((entry) => entry.family !== 4)];
}

const CONNECT_FAILURES = /^(ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL|ECONNABORTED|ENETDOWN|EHOSTDOWN|ETIMEDOUT|EPIPE|ConnectionRefused|ConnectionClosed|FailedToOpenSocket)$/;

/** A failure of the connection to this one address (refused, unreachable, reset, timed out), which another address may not share. */
export function isConnectFailure(error: unknown): boolean {
  const err = error as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  return CONNECT_FAILURES.test(String(err?.code ?? err?.cause?.code ?? ""));
}

class AddressTimeout extends Error {
  constructor() { super("this address did not answer in time"); this.name = "AddressTimeout"; }
}

export interface AddressFallbackDeps {
  lookupAll?: AllLookup;
  request?: PinnedRequest;
  attemptMs?: number;
  /** Told the address family of each attempt, so a caller can count failures by family (never the address). */
  onAttempt?: (family: number) => void;
}

/** guardedFetch over each resolved address of the URL's host in turn, IPv4 first. */
export async function fetchTryingEachAddress(input: string | URL, options: GuardedFetchOptions = {}, deps: AddressFallbackDeps = {}): Promise<Response> {
  const url = new URL(input);
  const lookupAll = deps.lookupAll ?? systemLookupAll;
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return guardedFetch(url, options, undefined, deps.request);
  const firstOf = async (hostname: string): Promise<ResolvedAddress> => {
    const [first] = ipv4First(await lookupAll(hostname));
    if (!first) throw Object.assign(new Error(`no address found for ${hostname}`), { code: "ENOTFOUND" });
    return first;
  };
  const candidates = ipv4First(await lookupAll(url.hostname));
  if (candidates.length === 0) throw Object.assign(new Error(`no address found for ${url.hostname}`), { code: "ENOTFOUND" });
  for (let i = 0; ; i++) {
    const candidate = candidates[i]!;
    const last = i === candidates.length - 1;
    // This address for the URL's own host; a redirect to another host resolves that host the same way (IPv4 first).
    const pinned: DnsLookup = async (hostname) => (hostname === url.hostname ? candidate : firstOf(hostname));
    const attempt = new AbortController();
    const outer = options.signal;
    const relay = () => attempt.abort(outer?.reason);
    if (outer?.aborted) relay(); else outer?.addEventListener("abort", relay, { once: true });
    let timedOut = false;
    const timer = last ? null : setTimeout(() => { timedOut = true; attempt.abort(new AddressTimeout()); }, deps.attemptMs ?? ADDRESS_ATTEMPT_MS);
    deps.onAttempt?.(candidate.family);
    try {
      const response = await guardedFetch(url, { ...options, signal: attempt.signal }, pinned, deps.request);
      if (timer) clearTimeout(timer);
      return response;
    } catch (error) {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", relay);
      if (error instanceof SsrfBlockedError || outer?.aborted || last || !(timedOut || isConnectFailure(error))) throw error;
    }
  }
}
