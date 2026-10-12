// KS-05: the plain-text boxes `news.feeds.<band>` hold feed addresses an
// admin typed. Pure and import-free of settings, so the settings writer can
// check a save without a cycle. This is the quick check at save time
// (shape, https, no obvious private name); the poller runs the full SSRF
// guard (DNS) on every fetch and every article link regardless.
import { isPrivateOrLoopbackIpv4 } from "@maipai/core/src/ssrfGuard";

export const MAX_FEED_ADDRESSES_PER_BOX = 50;

export function splitFeedAddresses(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

export type FeedAddressCheck = { ok: true; url: string; host: string } | { ok: false; error: string };

export function checkFeedAddress(raw: string): FeedAddressCheck {
  const shown = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
  let url: URL;
  try { url = new URL(raw); } catch {
    return { ok: false, error: `"${shown}" is not a web address. Paste the full feed address, starting with https://, one per line.` };
  }
  if (url.protocol !== "https:") return { ok: false, error: `"${shown}" does not start with https://. Use the https version of the feed address.` };
  if (url.username || url.password) return { ok: false, error: `"${shown}" has a name or password in it. Use a feed address that needs no login.` };
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const privateName = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || !host.includes(".");
  if (host.startsWith("[") || privateName || (ipv4 && isPrivateOrLoopbackIpv4(host))) {
    return { ok: false, error: `"${shown}" points at a device inside your home network, which the shelf never reads. Use the public address of a news site's feed.` };
  }
  url.hash = "";
  return { ok: true, url: url.toString(), host: host.replace(/^www\./, "") };
}

/** The whole box: every address valid and not too many. */
export function checkFeedAddressBox(raw: unknown): { ok: true; urls: string[] } | { ok: false; error: string } {
  const parts = splitFeedAddresses(raw);
  if (parts.length > MAX_FEED_ADDRESSES_PER_BOX) {
    return { ok: false, error: `That is ${parts.length} feed addresses and the limit is ${MAX_FEED_ADDRESSES_PER_BOX} per box. Remove some, then save again.` };
  }
  const urls: string[] = [];
  for (const part of parts) {
    const checked = checkFeedAddress(part);
    if (!checked.ok) return checked;
    urls.push(checked.url);
  }
  return { ok: true, urls };
}
