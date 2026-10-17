// Where the ddgs sidecar is, and whether it is set up. Its own module with no imports on purpose: the settings
// registry needs `ddgsConfigured` to decide whether to show a control, and anything that imports settings,
// sourceMode or the search code from here would close an import cycle (settingsRegistry -> ddgsSource ->
// sourceMode -> settings -> settingsRegistry). Every other file asks this one.
//
// STACK-DDGS-01: the Stack builds, starts and restarts the sidecar and reports its loopback address on
// GET /stack/v1/search. `ddgsStackSync.ts` copies that report here; the address is the Stack's while it is
// healthy. `MAIPAI_DDGS_URL` stays as an override for a household that runs its own sidecar.
export const DDGS_URL_ENV = "MAIPAI_DDGS_URL";

/** The Stack's last report about its search service: the shape of GET /stack/v1/search `ddgs`. */
export interface DdgsStackReport {
  state: "unsupported" | "disabled" | "building" | "starting" | "ready" | "failed";
  url: string | null;
  reason: string | null;
}
let stackReport: DdgsStackReport | null = null;
/** Set by ddgsStackSync.ts (and tests); null when the Stack has not answered, or is not on this computer. */
export function setDdgsStackReport(report: DdgsStackReport | null): void {
  stackReport = report;
}
export function ddgsStackReport(): DdgsStackReport | null {
  return stackReport;
}

function loopbackUrl(raw: string | null | undefined): URL | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    return (url.protocol === "http:" || url.protocol === "https:") && loopback ? url : null;
  } catch {
    return null;
  }
}

/** The sidecar's address, or null when none is ready: the household's own override first, else the Stack's
 * sidecar while it reports itself healthy. Loopback only: the sidecar runs beside Home. */
export function ddgsBaseUrl(): URL | null {
  const own = process.env[DDGS_URL_ENV]?.trim();
  if (own) return loopbackUrl(own);
  return stackReport?.state === "ready" ? loopbackUrl(stackReport.url) : null;
}
export const ddgsConfigured = (): boolean => ddgsBaseUrl() !== null;

/** True while the Stack is still building or starting the sidecar (so "not set up" would be untrue). */
export const ddgsStarting = (): boolean => !process.env[DDGS_URL_ENV]?.trim() && (stackReport?.state === "building" || stackReport?.state === "starting");

/** Plain words for why DuckDuckGo search cannot answer yet, or null when it can (or the Stack says nothing). */
export function ddgsSetupNote(): string | null {
  if (ddgsConfigured()) return null;
  if (ddgsStarting()) return "Web search is still being set up on this computer. Try again in a minute or two.";
  if (stackReport?.state === "failed") return `The Stack could not start the DuckDuckGo search service. ${stackReport.reason ?? ""} Open Repairs for the fix.`.trim();
  return null;
}
