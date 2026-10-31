// RADIO-06: same-origin HLS playlist and segment proxy. The browser receives only proxy URLs; every upstream hop is checked.
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { tryConsume } from "@/lib/rateLimiter";
import { RedirectLimitError, RateLimited } from "@/lib/shelf/shelfPoller";
import type { SavedStation } from "./radio";
import { MAX_REDIRECTS, CONNECT_TIMEOUT_MS, claimRadioSlot } from "./radioStream";

const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const HLS_TYPE = /mpegurl/i;
const platformFetch = globalThis.fetch;
const pace = { capacity: 6, refillPerSecond: 1 / 5 } as const;
export interface HlsDeps { fetch?: typeof fetch; dnsLookup?: DnsLookup; nowMs?: () => number; connectTimeoutMs?: number }
export type HlsFailure = { ok: false; status: 404 | 415 | 422 | 429 | 502 | 504; error: string };
export type HlsOpen = { ok: true; response: Response };
const failure = (status: HlsFailure["status"], error: string): HlsFailure => ({ ok: false, status, error });

async function get(address: string, deps: HlsDeps, signal: AbortSignal): Promise<Response> {
  const fetcher = deps.fetch ?? platformFetch;
  const pinned = fetcher === platformFetch;
  const now = deps.nowMs ?? Date.now;
  let url = new URL(address);
  const initialProtocol = url.protocol;
  const paced = new Set<string>();
  for (let hop = 0; ; hop++) {
    if (!(url.protocol === "https:" || (initialProtocol === "http:" && url.protocol === "http:")) || url.username || url.password) throw new SsrfBlockedError(url.host);
    await assertNotPrivateHost(url.hostname, deps.dnsLookup);
    const host = url.hostname.toLowerCase();
    if (!paced.has(host)) {
      if (!tryConsume(`net:radio-hls:${host}`, pace, now())) throw new RateLimited();
      paced.add(host);
    }
    const headers = { "User-Agent": HOME_USER_AGENT, Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, */*;q=0.5" };
    const response = pinned
      ? await guardedFetch(url, { method: "GET", redirect: "manual", signal, maxRedirects: 0, headers }, deps.dnsLookup)
      : await fetcher(url, { method: "GET", redirect: "manual", signal, headers, credentials: "omit", referrerPolicy: "no-referrer" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!pinned) await response.body?.cancel().catch(() => undefined);
      if (!location || hop >= MAX_REDIRECTS) throw new RedirectLimitError("Too many redirects");
      url = new URL(location, url);
      continue;
    }
    return response;
  }
}

function proxyUrl(stationId: string, resource: URL, basePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(resource.href))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${basePath}/${encodeURIComponent(stationId)}/resource/${encoded}`;
}

/** Rewrites media/variant playlist references and serves binary segments through guarded requests. */
export async function openHlsResource(personId: string, station: SavedStation, resourceUrl: string, deps: HlsDeps = {}, clientSignal?: AbortSignal, basePath = "/api/plugins/music/radio/hls"): Promise<HlsOpen | HlsFailure> {
  let parsed: URL;
  try { parsed = new URL(resourceUrl); } catch { return failure(404, "That playlist resource is not available."); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return failure(422, "That station address is not available.");
  const controller = new AbortController();
  let releaseSlot: () => void = () => {};
  const item = { stop: () => { releaseSlot(); controller.abort(); } };
  const slot = claimRadioSlot(personId, station.id, (release) => { releaseSlot = release; });
  if (typeof slot !== "function") return slot;
  const onAbort = () => item.stop();
  clientSignal?.addEventListener("abort", onAbort, { once: true });
  if (clientSignal?.aborted) { item.stop(); return failure(502, "The connection closed before the station answered."); }
  const timer = setTimeout(() => controller.abort(new DOMException("connect timeout", "TimeoutError")), deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
  try {
    const response = await get(parsed.href, deps, controller.signal);
    if (response.status !== 200 || !response.body) { if ((deps.fetch ?? platformFetch) !== platformFetch) await response.body?.cancel().catch(() => undefined); item.stop(); return failure(502, `The station's server answered with an error (${response.status}).`); }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (HLS_TYPE.test(contentType)) {
      const resolvedBase = response.url ? new URL(response.url) : parsed;
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_PLAYLIST_BYTES || !text.startsWith("#EXTM3U")) { item.stop(); return failure(502, "The station sent an invalid playlist."); }
      const rewritten = text.split(/\r?\n/).map((line) => {
        const value = line.trim();
        if (!value || value.startsWith("#")) return line.replace(/URI=(['"])(.*?)\1/g, (_match, quote: string, uri: string) => `URI=${quote}${proxyUrl(station.id, new URL(uri, resolvedBase), basePath)}${quote}`);
        return proxyUrl(station.id, new URL(value, resolvedBase), basePath);
      }).join("\n");
      return { ok: true, response: new Response(rewritten, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }) };
    }
    const body = new ReadableStream<Uint8Array>({
      async start(out) {
        const reader = response.body!.getReader();
        const close = () => { item.stop(); if ((deps.fetch ?? platformFetch) !== platformFetch) reader.cancel().catch(() => undefined); };
        clientSignal?.addEventListener("abort", close, { once: true });
        try { while (true) { const part = await reader.read(); if (part.done) break; out.enqueue(part.value); } out.close(); }
        catch { try { out.error(new Error("The station stopped sending a segment.")); } catch { /* closed */ } }
        finally { close(); }
      },
      cancel() { item.stop(); },
    });
    return { ok: true, response: new Response(body, { headers: { "Content-Type": contentType || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }) };
  } catch (error) {
    item.stop();
    if (error instanceof SsrfBlockedError) return failure(422, "That station's address points somewhere the hub does not connect to (it must be a public address).");
    if (error instanceof RedirectLimitError) return failure(502, "The station sent too many redirects.");
    if (error instanceof RateLimited) return failure(429, "The hub just connected to that station. Wait a few seconds and try again.");
    if (controller.signal.aborted) return failure(504, "The station did not answer in time.");
    return failure(502, "The hub could not reach that station.");
  } finally { clearTimeout(timer); }
}

export const decodeHlsResource = (token: string): string | null => {
  try { const normalized = token.replace(/-/g, "+").replace(/_/g, "/"); return decodeURIComponent(escape(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)))); }
  catch { return null; }
};
