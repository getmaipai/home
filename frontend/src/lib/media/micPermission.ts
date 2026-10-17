// VOICE-LIVE-02b: the microphone gate for the live voice session. One
// place decides, from a tap, whether the browser will let the page hear
// the mic: it reads the Permissions API state first (a "denied" site
// never shows a prompt, getUserMedia just rejects, which used to flash
// the call overlay open and shut), then asks the browser exactly once.
// Pure functions here; the React hook is useMicGate (micGate.tsx).
export type MicPermission = "prompt" | "granted" | "denied" | "unknown";
export type MicProblem = "denied" | "not_found" | "in_use" | "insecure" | "error";
export type MicProbeResult = { ok: true } | { ok: false; problem: MicProblem };
export type BrowserFamily = "chrome" | "safari" | "firefox" | "other";

export interface MicProbeDeps {
  isSecureContext?: boolean;
  /** Permissions API; absent or throwing on Safari/Firefox for "microphone". */
  query?: () => Promise<MicPermission>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export async function queryMicPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted" || status.state === "denied" || status.state === "prompt" ? status.state : "unknown";
  } catch {
    return "unknown";
  }
}

export function classifyMicError(err: unknown): MicProblem {
  const name = typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "in_use";
  return "error";
}

export async function probeMic(deps: MicProbeDeps = {}): Promise<MicProbeResult> {
  const secure = deps.isSecureContext ?? (typeof window !== "undefined" ? window.isSecureContext : true);
  const getUserMedia = deps.getUserMedia ?? (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : undefined);
  if (!secure || !getUserMedia) return { ok: false, problem: "insecure" };
  const state = await (deps.query ?? queryMicPermission)();
  if (state === "denied") return { ok: false, problem: "denied" };
  try {
    const stream = await getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return { ok: true };
  } catch (err) {
    return { ok: false, problem: classifyMicError(err) };
  }
}

export function detectBrowser(ua: string): BrowserFamily {
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}
