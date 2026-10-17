// SETUP-SEARCH-02: which address a person may type for their own SearXNG during setup.
// The hub then calls that address, so it must stay on the home network: an http or https URL with no
// sign-in inside it and a host that is this computer, a private network address or a `.local` name.
// Public hosts, link-local and cloud metadata addresses (169.254.x) are refused.

export const SEARCH_ADDRESS_NOT_LOCAL = "Use a search service on your home network.";
export const SEARCH_ADDRESS_NOT_AN_ADDRESS = "That doesn't look like a web address. Type it like http://searx.local:8888 and press Test.";

function privateV4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The parsed address, or the one-line reason it was refused (what is wrong, then what to do). */
export function parseSearchAddress(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, error: SEARCH_ADDRESS_NOT_AN_ADDRESS }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: SEARCH_ADDRESS_NOT_AN_ADDRESS };
  if (url.username || url.password) return { ok: false, error: "Remove the name and password from the address. Home can't send those." };
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "[::1]" || host.endsWith(".local") || privateV4(host);
  return local ? { ok: true, url } : { ok: false, error: SEARCH_ADDRESS_NOT_LOCAL };
}
