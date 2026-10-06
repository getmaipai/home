import { assertNotPrivateHost, SsrfBlockedError, type DnsLookup } from "@maipai/core/src/ssrfGuard";
import { tryConsume, __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { filterAnswerImages, type ValidatedAnswerImage } from "./quality";

export const ANSWER_IMAGE_USER_AGENT = "MaiPai-Home/1.0 (+https://github.com/getmaipai/home)";
const MAX_BYTES = 8 * 1024 * 1024;
const SET_DEADLINE_MS = 2_500;
const MAX_REDIRECTS = 3;
// A person's pace (THIRD-PARTY-SERVICES.md): one answer's pictures often share
// a host (upload.wikimedia.org serves every Commons picture), and a person
// opening that article loads a dozen at once; past the burst, one a second.
const HOST_RATE = { capacity: 12, refillPerSecond: 1 };
const QUIET_MS = 60 * 60 * 1000;
const quietHosts = new Map<string, number>();
let testDnsLookup: DnsLookup | null = null;

export function __setAnswerImageDnsLookupForTests(fn: DnsLookup | null): void { testDnsLookup = fn; }
export function __resetAnswerImageFetchForTests(): void { quietHosts.clear(); __resetRateLimiterForTests(); }

function quiet(host: string, until: number, now: number): void {
  for (const [name, expiry] of quietHosts) if (expiry <= now) quietHosts.delete(name);
  if (!quietHosts.has(host) && quietHosts.size >= 1_000) quietHosts.delete(quietHosts.keys().next().value!);
  quietHosts.set(host, until);
}

export type AnswerImageSource = { id: string; url: string; leadImage?: boolean };
export type AnswerImageFetchResult = { images: ValidatedAnswerImage[]; originals: Record<string, string>; dropped_by_fetch: Record<string, number>; dropped_by_quality: Record<string, number> };
type Options = { fetch?: typeof fetch; dnsLookup?: DnsLookup; now?: () => number };

async function validateUrl(url: URL, dns?: DnsLookup): Promise<void> {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("unsupported image URL");
  await assertNotPrivateHost(url.hostname, dns ?? testDnsLookup ?? undefined);
}

async function readLimited(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    if (signal.aborted) { await reader.cancel(); return null; }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchOne(source: AnswerImageSource, options: Options, deadline: number, dropped: Record<string, number>): Promise<{ id: string; bytes: Uint8Array; contentType: string; host: string } | null> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let original: URL;
  try { original = new URL(source.url); await validateUrl(original, options.dnsLookup); }
  catch (error) { const key = error instanceof SsrfBlockedError ? "ssrf" : "invalid_url"; dropped[key] = (dropped[key] ?? 0) + 1; return null; }
  const host = original.hostname.toLowerCase();
  if ((quietHosts.get(host) ?? 0) > now()) return null;
  const pacedHosts = new Set<string>();
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const remaining = Math.max(1, deadline - now());
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(1_200, remaining));
    try {
      let url = original;
      let response: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await validateUrl(url, options.dnsLookup);
        const hopHost = url.hostname.toLowerCase();
        if ((quietHosts.get(hopHost) ?? 0) > now()) return null;
        if (!pacedHosts.has(hopHost)) {
          if (!tryConsume(`net:${hopHost}`, HOST_RATE, now())) return null;
          pacedHosts.add(hopHost);
        }
        response = await fetcher(url, {
          method: "GET", redirect: "manual", signal: controller.signal,
          headers: { "User-Agent": ANSWER_IMAGE_USER_AGENT, Accept: "image/avif,image/webp,image/jpeg,image/png" },
          credentials: "omit", referrerPolicy: "no-referrer",
        });
        if ([403, 429].includes(response.status)) { quiet(url.hostname.toLowerCase(), now() + QUIET_MS, now()); return null; }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || hop === MAX_REDIRECTS) return null;
          url = new URL(location, url);
          continue;
        }
        break;
      }
      if (!response || response.status !== 200) return null;
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (contentType === "text/html" || contentType === "application/xhtml+xml") {
        quiet(url.hostname.toLowerCase(), now() + QUIET_MS, now());
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(contentType)) return null;
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) { dropped.size_limit = (dropped.size_limit ?? 0) + 1; return null; }
      const bytes = await readLimited(response, MAX_BYTES, controller.signal);
      if (!bytes) {
        if (timedOut && attempt === 0 && now() < deadline) continue;
        if (!timedOut) dropped.size_limit = (dropped.size_limit ?? 0) + 1;
        return null;
      }
      if (now() > deadline) return null;
      return { id: source.id, bytes, contentType, host: new URL(source.url).hostname };
    } catch (error) {
      if (error instanceof SsrfBlockedError) { dropped.ssrf = (dropped.ssrf ?? 0) + 1; return null; }
      if (controller.signal.aborted) {
        if (timedOut && attempt === 0 && now() < deadline) continue;
        return null;
      }
      if (attempt === 1 || now() >= deadline) return null;
    } finally { clearTimeout(timer); }
  }
  return null;
}

export async function fetchAnswerImages(sources: AnswerImageSource[], options: Options = {}): Promise<AnswerImageFetchResult> {
  const dropped_by_fetch: Record<string, number> = {};
  const countDrop = (why: string) => { dropped_by_fetch[why] = (dropped_by_fetch[why] ?? 0) + 1; };
  const deadline = (options.now ?? Date.now)() + SET_DEADLINE_MS;
  const input = sources.slice(0, 12);
  if (sources.length > 12) countDrop("candidate_cap");
  const results: Awaited<ReturnType<typeof fetchOne>>[] = [];
  for (let i = 0; i < input.length; i += 4) {
    if ((options.now ?? Date.now)() >= deadline) { countDrop("deadline"); break; }
    const group = await Promise.all(input.slice(i, i + 4).map(source => fetchOne(source, options, deadline, dropped_by_fetch)));
    results.push(...group);
  }
  const good = results.filter((r): r is NonNullable<typeof r> => r !== null);
  const checked = await filterAnswerImages(good.map(item => ({ id: item.id, bytes: item.bytes, contentType: item.contentType, leadImage: input.find(s => s.id === item.id)?.leadImage, sourceHost: item.host })));
  if ((options.now ?? Date.now)() >= deadline) {
    countDrop("deadline");
    return { images: [], originals: {}, dropped_by_fetch, dropped_by_quality: checked.dropped_by_quality };
  }
  const originals: Record<string, string> = {};
  for (const image of checked.images) {
    const source = input.find(item => item.id === image.id);
    if (source) originals[image.id] = source.url;
  }
  return { images: checked.images, originals, dropped_by_fetch, dropped_by_quality: checked.dropped_by_quality };
}
