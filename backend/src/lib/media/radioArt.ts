import { tryConsume } from "@/lib/rateLimiter";
import { assertNotPrivateHost, guardedFetch, type DnsLookup } from "@maipai/core/src/ssrfGuard";

const BUCKET = "net:radio-directory-art";
const PACE = { capacity: 40, refillPerSecond: 5 } as const;
const MAX_BYTES = 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const cache = new Map<string, { expiresAt: number; bytes: Uint8Array; type: string }>();

export interface RadioArtDeps { fetch?: typeof fetch; dnsLookup?: DnsLookup; nowMs?: () => number }
let testDeps: RadioArtDeps = {};
export function __setRadioArtDepsForTests(deps: RadioArtDeps): void { testDeps = deps; }
export function __resetRadioArtForTests(): void { cache.clear(); }
export function radioArtAddressOk(address: string): boolean {
  try { const url = new URL(address); return url.protocol === "https:" && url.username === "" && url.password === ""; } catch { return false; }
}

export async function fetchRadioArt(address: string, deps: RadioArtDeps = testDeps): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!radioArtAddressOk(address)) return null;
  const url = new URL(address);
  const now = deps.nowMs?.() ?? Date.now();
  const cached = cache.get(url.href);
  if (cached && cached.expiresAt > now) return { bytes: cached.bytes, type: cached.type };
  if (!tryConsume(BUCKET, PACE, now)) return null;
  try {
    await assertNotPrivateHost(url.hostname, deps.dnsLookup);
    const fetcher = deps.fetch ?? globalThis.fetch;
    const response = deps.fetch === undefined
      ? await guardedFetch(url.href, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "image/*" }, redirect: "error", signal: AbortSignal.timeout(8000), maxRedirects: 0 }, deps.dnsLookup)
      : await fetcher(url.href, { method: "GET", headers: { "User-Agent": "MaiPai-Home", Accept: "image/*" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: AbortSignal.timeout(8000) });
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (response.status !== 200 || !TYPES.has(type)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    cache.set(url.href, { expiresAt: now + 24 * 60 * 60 * 1000, bytes, type });
    return { bytes, type };
  } catch { return null; }
}
