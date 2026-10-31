// CODE-API-01: the parts of the coding gateway's gate chain that are not the key itself (lib/apiKeys.ts): where the request came from,
// how fast and how much one key and one person may use, and the fair queue in front of the coding engine. Design: local-coding-2026-10-17
// section 3.6. Nothing here reads a prompt, a key secret, a host or a person's name, and nothing here logs one (rule 6a).
import type { Context } from "hono";
import { getClientIp as rawPeerAddress } from "@maipai/core/src/secretThrottle";
import { keyOriginOf } from "@/lib/apiKeys";
import { TRUST_PROXY } from "@/lib/trustProxy";
import { tryConsume } from "@/lib/rateLimiter";
import { getHouseholdSettingValue, getPersonSettingValue } from "@/lib/settings";
import { getStackClient } from "@/lib/stackEngine";
import type { PersonRow } from "@/types";
import { sqlite } from "@/db";

export type GateRefusal = { status: 403 | 429 | 503; message: string; code: string; retryAfter?: number };

// ---- 1. Transport (3.6: HTTPS only, home network or tailnet, never a public URL) --------------------------------------------------------

/** Headers a reverse proxy, tunnel or CDN adds. Any one of them means the request did not come straight from the person's device. */
export const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-server", "forwarded", "x-real-ip", "cf-connecting-ip", "true-client-ip", "x-original-forwarded-for"];

/** 100.64.0.0/10 and fd7a:115c:a1e0::/48, the ranges Tailscale hands out. */
export function isTailnetAddress(address: string): boolean {
  const plain = address.replace(/^::ffff:/i, "").toLowerCase();
  const v4 = plain.split(".").map(Number);
  if (v4.length === 4 && v4.every(n => Number.isInteger(n))) return v4[0] === 100 && v4[1]! >= 64 && v4[1]! <= 127;
  return plain.startsWith("fd7a:115c:a1e0:");
}

const proxyTrusted = (): boolean => trustProxyOverride ?? TRUST_PROXY;

export function isPublicHost(c: Context): boolean {
  const configured = publicHost();
  return configured !== null && c.req.header("host")?.toLowerCase() === configured;
}

function publicHost(): string | null {
  const configured = process.env.APP_ORIGIN ?? process.env.PUBLIC_ORIGIN;
  if (!configured) return null;
  try { return new URL(configured).host.toLowerCase(); } catch { return null; }
}

/** The transport rules, evaluated before the key is even read. The peer address is the socket's own: a forwarded-for header is never believed here. */
export function transportRefusal(c: Context): GateRefusal | null {
  const proxied = PROXY_HEADERS.some(name => c.req.header(name) !== undefined);
  const configured = publicHost();
  const host = c.req.header("host")?.toLowerCase();
  if (proxied || (configured !== null && host === configured)) {
    return { status: 403, code: "public_address", message: "Coding is not available through a public address or a proxy. Connect from your home network, or over Tailscale if an admin allowed it." };
  }
  const peer = rawPeerAddress(c, { trustProxy: false });
  const origin = keyOriginOf(peer);
  if (!origin) return { status: 403, code: "unknown_source", message: "Home could not tell where this request came from. Connect directly from your home network." };
  const loopback = origin.address === "::1" || origin.address.startsWith("127.");
  // Behind a configured reverse proxy (lib/trustProxy.ts) the proxy's own connection is the loopback peer, so a loopback peer says nothing about the person's device.
  if (loopback && proxyTrusted()) {
    return { status: 403, code: "behind_proxy", message: "Coding is not available through the proxy on this computer. Connect to the home address directly from your own device." };
  }
  if (new URL(c.req.url).protocol !== "https:" && !loopback) {
    return { status: 403, code: "https_only", message: "Coding needs a secure address. Use the https address from Settings, Coding, not http." };
  }
  // The tailnet ranges come first: an IPv6 tailnet address (fd7a:115c:a1e0::/48) also looks like a private household range.
  if (isTailnetAddress(origin.address)) {
    return getHouseholdSettingValue("coding.api.away") === true ? null
      : { status: 403, code: "away_off", message: "Coding works only on your home network right now. An admin can allow Tailscale in Settings, Coding." };
  }
  if (origin.place === "home_network") return null;
  return { status: 403, code: "network", message: "Coding works only on your home network, or over Tailscale if an admin allowed it." };
}

// ---- 2. Rate, streams and daily tokens ------------------------------------------------------------------------------------------------

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
const isMinor = (p: PersonRow) => p.role === "child" || p.role === "teen";

/** The key's own limit and the household's, whichever is tighter; 60 a minute when neither is set. */
export function requestsPerMinute(keyLimit: number | null): number {
  const limits = [keyLimit, positive(getHouseholdSettingValue("coding.requests_per_minute_per_key"))].filter((n): n is number => n !== null);
  return limits.length ? Math.min(...limits) : 60;
}

/** One request against the key's bucket. The key id is an opaque random id, never shown on any wire. */
export function rateRefusal(keyId: string, keyLimit: number | null): GateRefusal | null {
  const rpm = requestsPerMinute(keyLimit);
  if (tryConsume(`code:key:${keyId}`, { capacity: rpm, refillPerSecond: rpm / 60 })) return null;
  return { status: 429, code: "rate_limited", retryAfter: Math.max(1, Math.ceil(60 / rpm)), message: `This key is sending requests faster than ${rpm} a minute. Slow your tool down, or ask an admin to raise the limit in Settings, Coding.` };
}

/** Streams one person may have in flight (running or waiting). A minor gets the grant's own number, one when none is set; the household number clamps everyone. */
export function maxStreamsFor(person: PersonRow): number {
  const household = positive(getHouseholdSettingValue("coding.max_streams_per_person")) ?? 2;
  if (!isMinor(person)) return household;
  return Math.min(household, positive(getPersonSettingValue(person, "coding.person.max_sessions")) ?? 1);
}

/** Tokens one person may use in a day; 0 is no cap. The household number clamps a person's own. */
export function dailyTokenCap(person: PersonRow): number {
  const caps = [positive(getHouseholdSettingValue("coding.daily_tokens_per_person")), positive(getPersonSettingValue(person, "coding.person.daily_tokens"))].filter((n): n is number => n !== null);
  return caps.length ? Math.min(...caps) : 0;
}

/** Tokens used today per person, from the engine's own usage counts, stored durably through a hub restart. */
export function createTokenLedger(now: () => Date = () => new Date(), raw: typeof sqlite = sqlite) {
  const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    used(personId: string): number {
      return raw.query<{ tokens: number }, [string, string]>("SELECT tokens FROM coding_token_usage WHERE person_id = ? AND day = ?").get(personId, dayOf(now()))?.tokens ?? 0;
    },
    add(personId: string, tokens: number): void {
      if (!(tokens > 0)) return;
      const day = dayOf(now());
      const cutoff = dayOf(new Date(now().getFullYear(), now().getMonth(), now().getDate() - 7));
      raw.query("DELETE FROM coding_token_usage WHERE day < ?").run(cutoff);
      raw.query("INSERT INTO coding_token_usage (person_id, day, tokens, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, day) DO UPDATE SET tokens = tokens + excluded.tokens, updated_at = excluded.updated_at")
        .run(personId, day, Math.floor(tokens), now().toISOString());
    },
    secondsToMidnight(): number {
      const n = now();
      return Math.max(1, Math.ceil((new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime()) / 1000));
    },
    reset(): void { raw.query("DELETE FROM coding_token_usage").run(); },
  };
}
export const tokenLedger = createTokenLedger();

export function dailyTokenRefusal(person: PersonRow): GateRefusal | null {
  const cap = dailyTokenCap(person);
  if (cap === 0 || tokenLedger.used(person.id) < cap) return null;
  return { status: 429, code: "daily_limit", retryAfter: tokenLedger.secondsToMidnight(), message: "You have used today's coding allowance. It starts again at midnight, or an admin can raise it in Settings, Coding." };
}

// ---- 3. In-flight streams per person, and the fair queue in front of the engine -----------------------------------------------------

/** Counts one person's requests that are running or waiting. */
export function createStreamCounter() {
  const inflight = new Map<string, number>();
  return {
    begin(personId: string, cap: number): (() => void) | null {
      const n = inflight.get(personId) ?? 0;
      if (n >= cap) return null;
      inflight.set(personId, n + 1);
      let done = false;
      return () => { if (done) return; done = true; const m = (inflight.get(personId) ?? 1) - 1; if (m <= 0) inflight.delete(personId); else inflight.set(personId, m); };
    },
    reset(): void { inflight.clear(); },
  };
}
export const streamCounter = createStreamCounter();

export type Slot = { release: () => void };
export type QueueRefusal = "full" | "aborted" | "timeout";
interface Waiter { personId: string; resolve: (slot: Slot | QueueRefusal) => void; timer: ReturnType<typeof setTimeout>; cleanup: () => void }

/** The engine has a few slots. Requests beyond them wait here, and the next free slot goes to the person who has waited with the fewest turns, round
 * robin by person, so one person's burst cannot keep another's request behind it. A full queue refuses at once. */
export function createFairQueue(options: { slots: () => number; maxWaiting?: number; maxWaitMs?: number }) {
  const maxWaiting = options.maxWaiting ?? 16;
  const maxWaitMs = options.maxWaitMs ?? 180_000;
  let active = 0;
  const waiting = new Map<string, Waiter[]>();
  const ring: string[] = [];
  let cursor = 0;
  const waitingCount = () => [...waiting.values()].reduce((n, list) => n + list.length, 0);
  const slot = (): Slot => {
    active++;
    let released = false;
    return { release: () => { if (released) return; released = true; active--; dispatch(); } };
  };
  function dispatch(): void {
    while (active < Math.max(1, options.slots()) && ring.length > 0) {
      cursor %= ring.length;
      const personId = ring[cursor]!;
      const list = waiting.get(personId)!;
      const next = list.shift()!;
      if (list.length === 0) { waiting.delete(personId); ring.splice(cursor, 1); } else cursor++;
      next.cleanup();
      next.resolve(slot());
    }
  }
  return {
    acquire(personId: string, signal?: AbortSignal): Promise<Slot | QueueRefusal> {
      if (signal?.aborted) return Promise.resolve("aborted");
      if (active < Math.max(1, options.slots()) && ring.length === 0) return Promise.resolve(slot());
      if (waitingCount() >= maxWaiting) return Promise.resolve("full");
      return new Promise(resolve => {
        const waiter: Waiter = { personId, resolve, timer: setTimeout(() => leave("timeout"), maxWaitMs), cleanup: () => { clearTimeout(waiter.timer); signal?.removeEventListener("abort", onAbort); } };
        const leave = (reason: QueueRefusal) => {
          const list = waiting.get(personId);
          const i = list ? list.indexOf(waiter) : -1;
          if (i < 0) return;
          list!.splice(i, 1);
          if (list!.length === 0) { waiting.delete(personId); const r = ring.indexOf(personId); if (r >= 0) { ring.splice(r, 1); if (r < cursor) cursor--; } }
          waiter.cleanup();
          resolve(reason);
        };
        const onAbort = () => leave("aborted");
        signal?.addEventListener("abort", onAbort, { once: true });
        if (!waiting.has(personId)) { waiting.set(personId, []); ring.push(personId); }
        waiting.get(personId)!.push(waiter);
      });
    },
    stats: () => ({ active, waiting: waitingCount() }),
    reset(): void { active = 0; for (const list of waiting.values()) for (const w of list) w.cleanup(); waiting.clear(); ring.length = 0; cursor = 0; },
  };
}

let slotsCache: { at: number; slots: number } | null = null;
let slotsOverride: (() => number) | null = null;
/** The coding engine's slots from the Stack's role record (2 on a 128 GB Mac, 1 below), read at most every 30 seconds; 1 when the Stack cannot say. */
export async function refreshCodingSlots(): Promise<number> {
  if (slotsOverride) return slotsOverride();
  if (slotsCache && Date.now() - slotsCache.at < 30_000) return slotsCache.slots;
  let slots = slotsCache?.slots ?? 1;
  try {
    const coding = (await getStackClient().roles()).roles.find(r => r.id === "coding")?.coding?.slots;
    if (typeof coding === "number" && coding >= 1) slots = Math.floor(coding);
  } catch { /* keep the last known number */ }
  slotsCache = { at: Date.now(), slots };
  return slots;
}
export const codingQueue = createFairQueue({ slots: () => slotsOverride ? slotsOverride() : slotsCache?.slots ?? 1 });

let trustProxyOverride: boolean | null = null;
let streamIdleOverride: number | null = null;
export function __setTrustProxyForTests(on: boolean | null): void { trustProxyOverride = on; }
export function __setStreamIdleForTests(ms: number | null): void { streamIdleOverride = ms; }
/** How long an engine may stay silent mid-answer before the gateway lets go of it. Prompt processing of a very long context is slow, so it is generous. */
export const streamIdleMs = (): number => streamIdleOverride ?? 300_000;

/** Test-only: one place that forgets every counter, bucket and queued request, and pins the slot count. */
export function __resetCodeGateForTests(slots: number | null = null): void {
  tokenLedger.reset(); streamCounter.reset(); codingQueue.reset(); slotsCache = null; trustProxyOverride = null; streamIdleOverride = null;
  slotsOverride = slots === null ? null : () => slots;
}

// ---- 4. The one household event this door records (rule 6a) ---------------------------------------------------------------------------

/** `coding.api_request`: a status class and a duration. No person, key, address, path, model or text. */
export function recordApiRequest(status: number, startedAt: number): void {
  console.log(`[coding] api_request status_class=${Math.floor(status / 100)}xx duration_ms=${Math.max(0, Math.round(Date.now() - startedAt))}`);
}
