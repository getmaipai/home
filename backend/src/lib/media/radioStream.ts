// RADIO-03: playing a saved station. The hub opens the station's own address (the one outbound call a listener makes), checks every hop
// against the address guard, and hands the audio to the browser from the hub's own origin, so the page's CSP (media-src 'self') and the
// shell's analyser both work. Rules: no cookies and no referrer go upstream, redirects are followed by hand (at most 4) and each hop is
// re-checked, an https station stays https on every hop, an http station (a directory row may list one) may use http hops, a page that is
// not audio is refused, the stream is piped as it arrives (back-pressure, never buffered whole), the upstream closes when the listener
// goes, one person plays one station at a time (a new one replaces the old) and a home plays at most four at once. The song title that
// the station sends in-band stays in memory while the stream is open; it is never stored or logged. No listen report is sent anywhere.
import { assertNotPrivateHost, guardedFetch, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { HOME_USER_AGENT } from "@/lib/outbound";
import { tryConsume } from "@/lib/rateLimiter";
import { RateLimited, RedirectLimitError } from "@/lib/shelf/shelfPoller";
import { IcyDemuxer, usableMetaint } from "./radioIcy";
import type { SavedStation } from "./radio";
import { resolvePublicTarget } from "@maipai/core/src/ssrfGuard";

export const MAX_REDIRECTS = 4;
export const CONNECT_TIMEOUT_MS = 10_000;
/** Resolve and validate the station before handing its address to Stack. Stack receives this public, already-resolved address,
 * preventing a DNS change or redirect from turning a previously checked station into a private-network request. */
export async function publicRecordingAddress(station: SavedStation, dnsLookup?: DnsLookup): Promise<string> {
  const url = new URL(station.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("The station must use a public HTTPS address.");
  const answer = await resolvePublicTarget(url.hostname, dnsLookup ?? (async (hostname) => {
    const dns = await import("node:dns/promises");
    const result = await dns.lookup(hostname, { verbatim: true });
    return { address: result.address, family: result.family };
  }));
  url.hostname = answer.address.includes(":") ? `[${answer.address}]` : answer.address;
  return url.toString();
}
export const MAX_STREAMS_PER_HOME = 4;
const HLS_TYPE = /mpegurl/i;
const HOST_PACE = { capacity: 6, refillPerSecond: 1 / 5 } as const;
const platformFetch = globalThis.fetch;

export interface StreamDeps {
  fetch?: typeof fetch;
  dnsLookup?: DnsLookup;
  nowMs?: () => number;
  connectTimeoutMs?: number;
}

export type StreamFailure = { ok: false; status: 415 | 422 | 429 | 502 | 504; error: string };
export type StreamOpen = { ok: true; response: Response };


/** One guarded GET with `Icy-MetaData: 1`. Every hop (the first and each redirect) passes the address guard before a byte is sent. */
async function getUpstream(station: SavedStation, deps: StreamDeps, signal: AbortSignal): Promise<Response> {
  const fetcher = deps.fetch ?? platformFetch;
  const pinned = fetcher === platformFetch;
  const now = deps.nowMs ?? Date.now;
  const httpAllowed = /^http:\/\//i.test(station.url);
  let url = new URL(station.url);
  const paced = new Set<string>();
  for (let hop = 0; ; hop++) {
    const secure = url.protocol === "https:";
    if ((!secure && !(httpAllowed && url.protocol === "http:")) || url.username || url.password) throw new SsrfBlockedError(url.host);
    await assertNotPrivateHost(url.hostname, deps.dnsLookup);
    const host = url.hostname.toLowerCase();
    if (!paced.has(host)) {
      if (!tryConsume(`net:radio-stream:${host}`, HOST_PACE, now())) throw new RateLimited();
      paced.add(host);
    }
    const headers = { "User-Agent": HOME_USER_AGENT, Accept: "audio/*, */*;q=0.5", "Icy-MetaData": "1" };
    const response = pinned
      ? await guardedFetch(url, { method: "GET", redirect: "manual", signal, maxRedirects: 0, headers }, deps.dnsLookup)
      : await fetcher(url, { method: "GET", redirect: "manual", signal, headers, credentials: "omit", referrerPolicy: "no-referrer" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      // A redirect body is tiny; with the pinned request it is left to finish (see stopUpstream below for why it is never cancelled).
      if (!pinned) await response.body?.cancel().catch(() => undefined);
      if (!location || hop >= MAX_REDIRECTS) throw new RedirectLimitError("The station sent too many redirects.");
      url = new URL(location, url);
      continue;
    }
    return response;
  }
}

/** No saved station currently has a format-level refusal; HLS is served through radioHls. */
export const unplayable = (_station: SavedStation): StreamFailure | null => null;

interface Active { personId: string; stationId: string; stop: () => void }
const active = new Set<Active>();
const titles = new Map<string, string>();

export function __resetRadioStreamsForTests(): void {
  for (const entry of [...active]) entry.stop();
  active.clear();
  titles.clear();
}

/** The latest song text the station sent, while a stream of it is open (null otherwise). Memory only. */
export function nowPlayingOf(stationId: string): string | null { return titles.get(stationId) ?? null; }

/** RADIO-06 shares the same person replacement and home-wide cap as ordinary radio. */
export function claimRadioSlot(personId: string, stationId: string, stopNew: (stop: () => void) => void): (() => void) | StreamFailure {
  const existing = [...active].find((entry) => entry.personId === personId && entry.stationId === stationId);
  if (existing) { stopNew(() => {}); return () => {}; }
  if (homeFull(personId)) return failure(429, `${MAX_STREAMS_PER_HOME} radio streams are already playing in this home. Stop one, then press Play again.`);
  for (const entry of [...active]) if (entry.personId === personId) entry.stop();
  const placeholder: Active = { personId, stationId, stop: () => {} };
  active.add(placeholder);
  let released = false;
  const release = () => { if (released) return; released = true; active.delete(placeholder); };
  placeholder.stop = release;
  stopNew(release);
  return release;
}


/** Whether this person's play would be refused for the home's cap (their own current stream does not count: it is replaced). */
function homeFull(personId: string): boolean {
  return [...active].filter((entry) => entry.personId !== personId).length >= MAX_STREAMS_PER_HOME;
}

const failure = (status: StreamFailure["status"], error: string): StreamFailure => ({ ok: false, status, error });

/** Opens the station for `personId` and returns the audio response (ICY blocks removed), or the reason it cannot play. */
export async function openStationStream(personId: string, station: SavedStation, deps: StreamDeps = {}, clientSignal?: AbortSignal): Promise<StreamOpen | StreamFailure> {
  const refused = unplayable(station);
  if (refused) return refused;
  if (homeFull(personId)) return failure(429, `${MAX_STREAMS_PER_HOME} radio streams are already playing in this home. Stop one, then press Play again.`);
  // One station per person: a new play (a second tab, or Play after Pause) replaces the old stream.
  for (const entry of [...active]) if (entry.personId === personId) entry.stop();

  const controller = new AbortController();
  const entry: Active = { personId, stationId: station.id, stop: () => controller.abort() };
  active.add(entry);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    active.delete(entry);
    if (![...active].some((other) => other.stationId === station.id)) titles.delete(station.id);
    controller.abort();
  };
  entry.stop = release;
  clientSignal?.addEventListener("abort", release, { once: true });
  if (clientSignal?.aborted) { release(); return failure(502, "The connection closed before the station answered."); }

  const timer = setTimeout(() => controller.abort(new DOMException("connect timeout", "TimeoutError")), deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
  const pinned = (deps.fetch ?? platformFetch) === platformFetch;
  const dropBody = async (response: Response) => { if (!pinned) await response.body?.cancel().catch(() => undefined); };
  let upstream: Response;
  try {
    upstream = await getUpstream(station, deps, controller.signal);
  } catch (error) {
    release();
    if (error instanceof SsrfBlockedError) return failure(422, "That station's address points somewhere the hub does not connect to (it must be a public address). Remove it and add the station again from Find stations.");
    if (error instanceof RedirectLimitError) return failure(502, "The station sent too many redirects. Try again later or pick another station.");
    if (error instanceof RateLimited) return failure(429, "The hub just connected to that station. Wait a few seconds and press Play again.");
    if (controller.signal.aborted) return failure(504, "The station did not answer in time. Try again in a moment or pick another station.");
    return failure(502, "The hub could not reach that station. Try again later or pick another station.");
  } finally {
    clearTimeout(timer);
  }
  const type = (upstream.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (upstream.status !== 200 || !upstream.body) {
    await dropBody(upstream);
    release();
    return failure(502, `The station's server answered with an error (${upstream.status}). Try again later or pick another station.`);
  }
  if (HLS_TYPE.test(type)) { await dropBody(upstream); release(); return failure(415, "This station uses an HLS playlist. Play it from its saved station row."); }
  if (!(type.startsWith("audio/") || type === "application/ogg")) {
    await dropBody(upstream);
    release();
    return failure(502, "That address is not an audio stream, so it cannot be played. Remove it and add the station again from Find stations.");
  }

  const metaint = usableMetaint(upstream.headers.get("icy-metaint"));
  const demux = metaint === null ? null : new IcyDemuxer(metaint, (title) => { if (title === null) titles.delete(station.id); else titles.set(station.id, title); });
  const reader = upstream.body.getReader();
  // The pinned request in @maipai/core closes its body stream from an `end` listener, so cancelling that stream (reader.cancel) can throw
  // "Controller is already closed" from an event handler and take the whole process down (seen 2026-10-28). For it, aborting the request
  // is the only stop: the body errors and the reader is left alone. Any other fetch (tests, a future one) needs the reader cancelled.
  const stopUpstream = () => { controller.abort(); if (!pinned) reader.cancel().catch(() => undefined); };
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  // Stopping a stream (a replacement play, or the listener leaving) closes the upstream and ends the audio the browser is reading.
  const stop = () => {
    release();
    stopUpstream();
    try { sink?.close(); } catch { /* already closed */ }
  };
  entry.stop = stop;
  clientSignal?.addEventListener("abort", stop, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(out) { sink = out; },
    async pull(out) {
      try {
        const { done, value } = await reader.read();
        if (done) { out.close(); release(); return; }
        if (demux === null) out.enqueue(value);
        else for (const piece of demux.push(value)) if (piece.byteLength > 0) out.enqueue(piece);
      } catch {
        release();
        try { out.error(new Error("The station stopped sending audio.")); } catch { /* already closed */ }
      }
    },
    cancel() { release(); stopUpstream(); sink = null; },
  });
  const headers = new Headers({ "Content-Type": type === "application/ogg" ? type : upstream.headers.get("content-type")!.split(";")[0]!.trim(), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  return { ok: true, response: new Response(body, { status: 200, headers }) };
}
