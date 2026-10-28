/** The shared feed/page image acceptance rule. Absolute HTTP(S), no credentials, at most 2,000 characters. */
export function feedImageAddress(candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return undefined;
  // Feeds repeat markup entities in addresses (&amp; and numeric ones such as &#038;); decode them or the query turns into a fragment.
  const value = candidate.trim().replace(/&amp;/g, "&").replace(/&#0*(38|x26);/gi, "&");
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

/** A site icon, logo or small topic badge is not a story's picture: the card shows the publisher tile and the page is asked for the real one. */
export function isSiteArt(address: string): boolean {
  try {
    const path = new URL(address).pathname;
    return /(?:logo|favicon|sprite|placeholder|avatar|(?:^|[/_-])icon|default[-_]?(?:image|share|og|social)|site[-_]?(?:image|share))/i.test(path) || /[_-]\d{1,3}\.(?:png|gif|ico)$/i.test(path);
  } catch { return false; }
}
