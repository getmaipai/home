export type ClientErrorKind = "error" | "unhandledrejection" | "boundary" | "player";
export interface ClientErrorReport { kind: ClientErrorKind; name?: string; message?: string; stack?: string; route?: string; songId?: string; mediaType?: string; build?: string }
interface ReporterDeps { now?: () => number; send?: (body: string) => void; route?: () => string }

/** Builds a best-effort, short-lived de-duplicating sender. Network and browser API errors are ignored. */
export function createClientErrorReporter({ now = Date.now, send = sendReport, route = () => location.pathname }: ReporterDeps = {}) {
  const sent = new Map<string, number>();
  return (report: ClientErrorReport): void => {
    try {
      const normalized = {
        kind: report.kind,
        name: String(report.name ?? "Error").slice(0, 200),
        message: String(report.message ?? "Browser error").slice(0, 200),
        stack: String(report.stack ?? "").slice(0, 1500),
        route: String(report.route ?? route()).split("?", 1)[0]!.slice(0, 160),
        ...(report.kind === "player" ? { song_id: report.songId?.slice(0, 100), media_type: report.mediaType?.slice(0, 100) } : {}),
        ...(report.build ? { build: report.build.slice(0, 100) } : {}),
      };
      const signature = `${normalized.name}\n${normalized.message}\n${normalized.stack}`;
      const time = now();
      const previous = sent.get(signature);
      if (previous !== undefined && time - previous < 5000) return;
      sent.set(signature, time);
      for (const [key, at] of sent) if (time - at >= 5000) sent.delete(key);
      send(JSON.stringify(normalized));
    } catch { /* Reporting must never affect the app. */ }
  };
}

function sendReport(body: string): void {
  let endpoint = "";
  try {
    if (typeof location === "undefined" || !location.origin || location.origin === "null") return;
    endpoint = new URL("/api/client-errors", location.origin).toString();
  } catch { /* Reporting is best effort. */ }
  if (!endpoint) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) return;
  } catch { /* Try fetch if sendBeacon is unavailable. */ }
  try { if (typeof fetch === "function") void fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {}); } catch { /* Reporting is best effort. */ }
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return String(value.message);
  if (value && typeof value === "object" && "message" in value) return String((value as { message?: unknown }).message ?? fallback);
  return fallback;
}

let installed = false;
let report: ReturnType<typeof createClientErrorReporter> = createClientErrorReporter();
/** Install once from the app entry point, before React renders. */
export function installClientErrors(target: Window = window): void {
  if (installed) return;
  installed = true;
  report = createClientErrorReporter();
  target.addEventListener("error", (event) => {
    const error = event instanceof ErrorEvent ? event.error : null;
    report({ kind: "error", name: error?.name ?? "Error", message: error?.message ?? event.message, stack: error?.stack });
  });
  target.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report({ kind: "unhandledrejection", name: reason instanceof Error ? reason.name : "UnhandledRejection", message: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined });
  });
}

export function reportPlayerError({ songId, mediaType, error }: { songId?: string; mediaType?: string; error: unknown }): void {
  try {
    const mediaError = error as MediaError | null;
    const code = typeof mediaError?.code === "number" ? `MediaError ${mediaError.code}` : "PlayerError";
    report({ kind: "player", name: error instanceof Error ? error.name : code, message: errorMessage(error, mediaError?.message || code), stack: error instanceof Error ? error.stack : undefined, songId, mediaType });
  } catch { /* Reporting must never affect playback. */ }
}
