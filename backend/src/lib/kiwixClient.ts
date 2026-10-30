export const KIWIX_REQUEST_TIMEOUT_MS = 2500;

export async function libraryRequest(base: string, path: string, init: { redirect?: "follow" | "manual" } = {}): Promise<Response> {
  return fetch(`${base.replace(/\/+$/, "")}${path}`, { ...init, signal: AbortSignal.timeout(KIWIX_REQUEST_TIMEOUT_MS) });
}

export async function installed(base: string): Promise<string[]> {
  const res = await libraryRequest(base, "/catalog/v2/entries?count=200");
  if (!res.ok) return [];
  const xml = await res.text();
  return [...new Set([...xml.matchAll(/href="\/content\/([^"/?#]+)"/g)].map((m) => decodeURIComponent(m[1]!)))];
}
