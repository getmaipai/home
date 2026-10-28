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

const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch);

/** The picture for a station with no working logo: a gradient from the name and its first letters over a broadcast mark. Generated here, so nothing leaves the home. */
export function radioArtCard(name: string): { bytes: Uint8Array; type: string } {
  const label = name.trim().slice(0, 40) || "Radio";
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const hue = hash % 360;
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 62% 46%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 58% 28%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="6" stroke-linecap="round"><path d="M62 62a54 54 0 0 0 0 76"/><path d="M138 62a54 54 0 0 1 0 76"/><path d="M80 80a28 28 0 0 0 0 40"/><path d="M120 80a28 28 0 0 1 0 40"/></g><circle cx="100" cy="100" r="9" fill="#fff" fill-opacity=".8"/><text x="100" y="172" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#fff" fill-opacity=".92">${escapeXml(initials)}</text></svg>`;
  return { bytes: new TextEncoder().encode(svg), type: "image/svg+xml" };
}
