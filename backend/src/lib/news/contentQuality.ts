// NEWS-02b: decides whether extracted text is an article or a stub, which of two extractions to keep, and remembers a failed fetch
// for 30 minutes. Ported from Loki Doki's rules (400 characters, keep the better copy, 30-minute failure memory); pure, with an
// injectable clock. A page with the cookie wall or the paywall in place of the story never counts as the article.
import { canonicalUrl } from "@/lib/shelf/canonicalUrl";

export const MIN_ARTICLE_CHARS = 400;
export const FAILURE_TTL_MS = 30 * 60_000;
/** A stub is usually short. A long text that merely mentions cookies or subscribing is an article about them. */
const STUB_MAX_CHARS = 1500;

const STUB_PHRASES: readonly RegExp[] = [
  /subscribe (?:now )?to (?:continue|keep) reading/i,
  /(?:this|the) (?:article|content|story) is (?:for|available to|only available to) (?:paid )?(?:subscribers|members)/i,
  /(?:sign|log) in (?:or (?:sign|register|subscribe)[^.]{0,20} )?to (?:continue reading|read (?:this|the full))/i,
  /already a (?:subscriber|member)\?/i,
  /to continue reading,? (?:please )?(?:subscribe|sign|log)/i,
  /create (?:a free )?account to (?:continue|keep) reading/i,
  /you(?:'ve| have) (?:reached|used) your (?:free )?(?:article )?limit/i,
  /we use cookies/i,
  /accept (?:all )?cookies/i,
  /cookie (?:settings|preferences|policy|consent)/i,
  /(?:please )?enable javascript/i,
  /verify you are (?:a )?human/i,
  /checking your browser/i,
  /access denied/i,
];

function normalize(text: string): string { return text.replace(/\s+/g, " ").trim(); }

/** True when the text is a paywall, cookie wall, bot challenge or script-required stub rather than a story. */
export function looksLikeStub(text: string): boolean {
  const t = normalize(text);
  if (t.length === 0) return true;
  const hits = STUB_PHRASES.filter((p) => p.test(t)).length;
  if (hits === 0) return false;
  if (hits >= 3) return true;
  if (t.length < STUB_MAX_CHARS) return true;
  // Long text: a stub phrase in the first 200 characters is a wall in front of the page, not a mention inside the story.
  return STUB_PHRASES.some((p) => { const m = p.exec(t); return m !== null && m.index < 200; });
}

/** True when the text is long enough and not a stub: the one test the story reader applies to an extraction. */
export function acceptArticleText(text: string): boolean {
  const t = normalize(text ?? "");
  return t.length >= MIN_ARTICLE_CHARS && !looksLikeStub(t);
}

/** Keeps the better of two extractions: an accepted one beats a rejected one; between two of the same standing, the longer one;
 * a tie keeps `a`. An empty or missing side never wins over text. */
export function betterCopy(a: string | null | undefined, b: string | null | undefined): string {
  const x = a ?? "", y = b ?? "";
  const ax = acceptArticleText(x), by = acceptArticleText(y);
  if (ax !== by) return ax ? x : y;
  return normalize(y).length > normalize(x).length ? y : x;
}

export interface FailureMemory {
  /** Remember that fetching this address failed now. Returns false for an address that is not a usable link. */
  record(url: string): boolean;
  /** True while a failure recorded within the TTL is still remembered. */
  has(url: string): boolean;
  /** Forget one address ("Try again" bypasses the memory). */
  forget(url: string): void;
  /** Drop expired entries; returns how many. */
  sweep(): number;
  readonly size: number;
}

export function createFailureMemory(opts: { ttlMs?: number; now?: () => number } = {}): FailureMemory {
  const ttl = opts.ttlMs ?? FAILURE_TTL_MS;
  const now = opts.now ?? Date.now;
  const failedAt = new Map<string, number>();
  const live = (key: string): boolean => {
    const at = failedAt.get(key);
    if (at === undefined) return false;
    if (now() - at >= ttl) { failedAt.delete(key); return false; }
    return true;
  };
  return {
    record(url) { const key = canonicalUrl(url); if (!key) return false; failedAt.set(key, now()); return true; },
    has(url) { const key = canonicalUrl(url); return key !== null && live(key); },
    forget(url) { const key = canonicalUrl(url); if (key) failedAt.delete(key); },
    sweep() { let n = 0; for (const key of [...failedAt.keys()]) if (!live(key)) n++; return n; },
    get size() { return failedAt.size; },
  };
}
