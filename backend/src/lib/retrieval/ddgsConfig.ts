// Where the ddgs sidecar is, and whether it is set up. Its own module with no imports on purpose: the settings
// registry needs `ddgsConfigured` to decide whether to show a control, and anything that imports settings,
// sourceMode or the search code from here would close an import cycle (settingsRegistry -> ddgsSource ->
// sourceMode -> settings -> settingsRegistry). Every other file asks this one.
export const DDGS_URL_ENV = "MAIPAI_DDGS_URL";

/** The sidecar's address, or null when none is set. Loopback only: the sidecar runs beside Home. */
export function ddgsBaseUrl(): URL | null {
  const raw = process.env[DDGS_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return (url.protocol === "http:" || url.protocol === "https:") && loopback ? url : null;
  } catch {
    return null;
  }
}
export const ddgsConfigured = (): boolean => ddgsBaseUrl() !== null;
