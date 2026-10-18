/** The shared feed/page image acceptance rule. Absolute HTTP(S), no credentials, at most 2,000 characters. */
export function feedImageAddress(candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return undefined;
  const value = candidate.trim().replace(/&amp;/g, "&");
  if (value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.href;
  } catch { /* not an address */ }
  return undefined;
}
