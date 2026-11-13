// ECHO-GATE-01 (2026-11-12, Jesse uses laptop speakers, not a headset): while Home plays a reply, the microphone hears that reply
// through the room. The gate measures how loud that echo is (calibrated from Home's own first reply of the session, re-tightened
// on every reply) and, while she speaks, feeds the hub only microphone frames clearly louder than it: a person cutting in on top of
// her. Frames at the echo's level are dropped before they reach the hub, so the recognizer never hears her, never marks an edge on
// her words, and never reports her as "speaking". While she is silent every frame passes. Numbers only; no audio is kept.

/** A frame must be this much louder than the calibrated echo to count as the person (about +8 dB). */
export const BARGE_IN_RATIO = 2.5;
/** Calibration takes the loudest tenth of the frames in the first window of a reply; later replies only raise the reference quickly and lower it slowly. */
export const CALIBRATION_MS = 1500;
/** Below this the microphone is effectively silent; the ratio is reported against it. */
const NOISE_FLOOR = 1e-4;
/** A frame passes only once this many consecutive frames exceeded the gate (about 60 ms at 20 ms frames): a click does not open it. */
export const OPEN_AFTER_FRAMES = 3;
/** Once open, the gate stays open this long after the last loud frame so a sentence's quieter syllables get through. */
export const HOLD_OPEN_MS = 400;

export interface EchoGateReport {
  /** Calibrated echo level (RMS) while Home played, or null before the first reply. */
  echo_rms: number | null;
  /** Room noise level (RMS) while nobody spoke, or null before it was measured. */
  silence_rms: number | null;
  /** Echo over silence, in dB; the number to read in the trace. */
  ratio_db: number | null;
  /** Frames dropped and passed while she spoke, since the last report. */
  blocked: number;
  passed: number;
}

export interface EchoGate {
  /** Decide one 16 kHz frame. `playing` is whether Home's audio is playing right now; `now` in ms. */
  pass(frame: Float32Array, playing: boolean, now?: number): boolean;
  /** Snapshot for the trace; resets the frame counts. */
  report(): EchoGateReport;
  /** The person's call ended or a new reply begins: a new reply re-calibrates (its first window) without forgetting the last level. */
  replyStarted(now?: number): void;
}

export function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

export function createEchoGate(options: { now?: () => number } = {}): EchoGate {
  const clock = options.now ?? (() => performance.now());
  let echoRms: number | null = null;
  let silenceRms: number | null = null;
  let calibrating: number[] = [];
  let calibrationEndsAt = 0;
  let loudRun = 0;
  let openUntil = 0;
  let blocked = 0;
  let passed = 0;
  const finishCalibration = () => {
    if (calibrating.length === 0) return;
    const sorted = [...calibrating].sort((a, b) => a - b);
    const loudest = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)]!;
    // Raise at once (a louder room or a louder reply), lower slowly (one quiet reply does not open the gate to the next loud one).
    echoRms = echoRms === null ? loudest : loudest > echoRms ? loudest : echoRms * 0.7 + loudest * 0.3;
    calibrating = [];
  };
  return {
    replyStarted(now = clock()) {
      finishCalibration();
      calibrating = [];
      calibrationEndsAt = now + CALIBRATION_MS;
      loudRun = 0;
      openUntil = 0;
    },
    pass(frame, playing, now = clock()) {
      const rms = frameRms(frame);
      if (!playing) {
        // Room noise: the quietest tenth of what the microphone hears while nobody speaks, kept as a slow average.
        if (rms < (silenceRms ?? Infinity) * 1.5 || silenceRms === null) silenceRms = silenceRms === null ? Math.max(NOISE_FLOOR, rms) : silenceRms * 0.95 + Math.max(NOISE_FLOOR, rms) * 0.05;
        if (calibrating.length > 0) finishCalibration();
        loudRun = 0;
        return true;
      }
      // Home is playing. During the first window of a reply the frames calibrate the echo; nothing passes until a level is known.
      if (now < calibrationEndsAt) { calibrating.push(rms); blocked += 1; return false; }
      if (calibrating.length > 0) finishCalibration();
      const reference = echoRms ?? Infinity;
      const loud = rms > reference * BARGE_IN_RATIO;
      if (loud) { loudRun += 1; if (loudRun >= OPEN_AFTER_FRAMES) openUntil = now + HOLD_OPEN_MS; }
      else loudRun = 0;
      if (now < openUntil || (loud && loudRun >= OPEN_AFTER_FRAMES)) { passed += 1; return true; }
      blocked += 1;
      return false;
    },
    report() {
      const ratio = echoRms !== null && silenceRms !== null && silenceRms > 0 ? Math.round(20 * Math.log10(echoRms / silenceRms) * 10) / 10 : null;
      const out = { echo_rms: echoRms === null ? null : Math.round(echoRms * 1e5) / 1e5, silence_rms: silenceRms === null ? null : Math.round(silenceRms * 1e5) / 1e5, ratio_db: ratio, blocked, passed };
      blocked = 0; passed = 0;
      return out;
    },
  };
}

/** The browser family, as one short token for the trace (never the full user agent). */
export function browserFamily(userAgent: string): "chrome" | "safari" | "firefox" | "edge" | "other" {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("chrome/") || ua.includes("crios/")) return "chrome";
  if (ua.includes("safari/")) return "safari";
  return "other";
}
