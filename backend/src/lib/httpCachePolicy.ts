export function backoffSeconds(intervalS: number, failCount: number, retryAfterS: number | null, floorS: number, capS: number): number {
  const base = Math.min(capS, Math.max(floorS, intervalS) * 2 ** Math.max(1, failCount));
  const asked = retryAfterS !== null && Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS : 0;
  return Math.min(86_400, Math.max(base, asked));
}

export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - nowMs) / 1000));
}

export function maxAgeSeconds(cacheControl: string | null): number | null {
  const match = cacheControl ? /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl) : null;
  return match ? Number(match[1]) : null;
}

export interface CacheHintHeaders { cacheControl?: string | null; expires?: string | null; age?: string | null }
export function effectiveTtlSeconds(ttlS: number, headers: CacheHintHeaders, nowMs: number): number {
  if (/\bno-cache\b/i.test(headers.cacheControl ?? "")) return 0;
  const values = [ttlS];
  const maxAge = maxAgeSeconds(headers.cacheControl ?? null);
  const age = Number(headers.age ?? 0);
  if (maxAge !== null) values.push(Math.max(0, maxAge - (Number.isFinite(age) ? Math.max(0, age) : 0)));
  if (headers.expires) {
    const at = Date.parse(headers.expires);
    if (!Number.isNaN(at)) values.push(Math.max(0, Math.floor((at - nowMs) / 1000)));
  }
  return Math.max(0, Math.min(...values));
}
