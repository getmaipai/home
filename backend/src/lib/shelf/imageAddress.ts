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

/** BBC's picture server serves the same picture at several widths and its feed names the 240 px one, which looks blurry on a hero.
 * Ask for 976 px (a width it publishes) instead. Any other address is returned unchanged. */
export function largerFeedImage(address: string): string {
  try {
    const url = new URL(address);
    if (url.hostname === "ichef.bbci.co.uk") {
      const upgraded = url.pathname.replace(/\/ace\/standard\/(\d+)\//, (whole, width: string) => (Number(width) < 976 ? "/ace/standard/976/" : whole));
      if (upgraded !== url.pathname) { url.pathname = upgraded; return url.href; }
    }
  } catch { /* not an address: leave it */ }
  return address;
}
