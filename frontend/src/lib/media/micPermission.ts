// VOICE-LIVE-02b: the microphone gate for the live voice session. One
// place decides, from a tap, whether the browser will let the page hear
// the mic: it reads the Permissions API state first (a "denied" site
// never shows a prompt, getUserMedia just rejects, which used to flash
// the call overlay open and shut), then asks the browser exactly once.
// Pure functions here; the React hook is useMicGate (micGate.tsx).
import { recordMicFailure } from "@/lib/voice/micDiagnostics";
import { acquireMicStream, type MicLease } from "@/lib/media/micStream";
import { micStreamKey, openMicStream, primeMicAudio, releasePrimedAudio } from "@/lib/voice/mic-capture";

export type MicPermission = "prompt" | "granted" | "denied" | "unknown";
export type MicProblem = "safari_ask" | "denied" | "not_found" | "in_use" | "insecure" | "error";
export type MicProbeResult = { ok: true } | { ok: false; problem: MicProblem };
export type BrowserFamily = "chrome" | "safari" | "firefox" | "other";

export interface MicProbeDeps {
  isSecureContext?: boolean;
  /** Permissions API; absent or throwing on Safari/Firefox for "microphone". */
  query?: () => Promise<MicPermission>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Audio inputs present? Defaults to enumerateDevices(). */
  hasInput?: () => Promise<boolean | null>;
  /** Test-only: the user agent the Safari tip checks (default navigator.userAgent). */
  userAgent?: string;
  /** Test-only: grace before the shared stream stops (default 10 s). */
  graceMs?: number;
  /** Test seams for the audio context started inside the tap. */
  prime?: () => void;
  release?: () => void;
}

export async function queryMicPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted" || status.state === "denied" || status.state === "prompt" ? status.state : "unknown";
  } catch {
    return "unknown";
  }
}

/** true/false when the browser lists audio inputs, null when it cannot say. */
export async function hasAudioInput(): Promise<boolean | null> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "audioinput");
  } catch {
    return null;
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
  // Safari only honours a microphone request or an audio start that begins
  // inside the tap itself: nothing above this line may await. The request
  // and the audio context start now; the Permissions API query runs beside
  // them and only decides which message a failure gets.
  (deps.prime ?? primeMicAudio)();
  let media: Promise<MicLease>;
  try {
    // The shared stream (micStream.ts): the capture that follows reuses it,
    // so the browser is asked once. It stops after the grace period.
    media = acquireMicStream(micStreamKey(), () => (deps.getUserMedia ? getUserMedia({ audio: true }) : openMicStream()), { graceMs: deps.graceMs });
  } catch (err) {
    (deps.release ?? releasePrimedAudio)();
    recordMicFailure("microphone request", classifyMicError(err), err);
    return { ok: false, problem: classifyMicError(err) };
  }
  media.catch(() => {});
  const inputs = (deps.hasInput ?? hasAudioInput)();
  const state = await (deps.query ?? queryMicPermission)();
  try {
    (await media).release();
    if (state === "denied") {
      (deps.release ?? releasePrimedAudio)();
      return { ok: false, problem: "denied" };
    }
    return { ok: true };
  } catch (err) {
    (deps.release ?? releasePrimedAudio)();
    recordMicFailure("microphone request", classifyMicError(err), err);
    const problem = state === "denied" ? "denied" : classifyMicError(err);
    // A list with no audio input at all means no microphone, whatever error the browser chose.
    if (problem !== "denied" && (await inputs) === false) {
      recordMicFailure("microphone request", "not_found", err);
      return { ok: false, problem: "not_found" };
    }
    return { ok: false, problem };
  }
}

export function detectBrowser(ua: string): BrowserFamily {
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

/** The one-line tip for Safari's default "Ask" setting, and the two routes to Allow. */
export const SAFARI_ASK_TIP = "Safari asks every time unless you choose Allow. In Safari, open Settings > Websites > Microphone, find this site, and choose Allow.";
export const SAFARI_ASK_STEPS = [
  "Safari > Settings > Websites > Microphone: set this site (for example localhost) to Allow.",
  "Or Safari > Settings for this site > Microphone: Allow.",
];

const TIP_KEY = "maipai:safari-mic-tip";

/** True for a Safari that is still on "Ask". `once` shows it a single time per
 * page session (sessionStorage; if storage is blocked it shows each time). */
export function safariTipDue(state: MicPermission, ua: string, once: boolean): boolean {
  if (state !== "prompt" || detectBrowser(ua) !== "safari") return false;
  if (!once) return true;
  try {
    if (sessionStorage.getItem(TIP_KEY)) return false;
    sessionStorage.setItem(TIP_KEY, "1");
  } catch { /* storage blocked: show it */ }
  return true;
}
