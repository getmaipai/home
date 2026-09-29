// FACE-02M: sound feedback for the guided face capture, tied to the
// capture ring (captureRing() in faceCaptureFeedback.ts). Four cues a
// person can learn without reading anything, each higher and clearer
// than the last: a quiet scanning tick (no face yet), a steadier pulse
// (a face is seen but the frame is below the quality bar, the yellow
// ring), one smooth higher tone (the frame clears the bar, the green
// ring) and a single chime (a shot registered). Sound only ever adds to
// the ring, the icon and the aria-live status line; it is never the sole
// signal.
//
// Synthesized with the Web Audio API, no files, no dependency: four
// short tones are not worth a library. The AudioContext is injected so
// the module is testable with a fake one.
import type { CaptureRing } from "@/lib/vision/faceCaptureFeedback";

export type SoundCue = "scanning" | "soft" | "ready";

/** The ring's colour to the cue that goes with it: no face is scanning,
 * yellow is soft, green is ready. */
export function cueForRing(ring: CaptureRing): SoundCue {
  if (ring === "green") return "ready";
  if (ring === "yellow") return "soft";
  return "scanning";
}

// Volume is modest and one set of constants, not a control. Gains are
// fractions of full scale; the loudest thing is the chime at 0.12.
export const CUES = {
  // A soft, high, short tick, like a metal detector sweeping. Quiet on
  // purpose: it repeats for as long as no face is in the frame.
  scanning: { wave: "sine", freq: 700, gain: 0.02, durMs: 35, everyMs: 1400 },
  // Clearer (a triangle wave has more edge than a sine, a higher pitch
  // and 2.5x the loudness) and steadier (a pulse more than twice as often).
  soft: { wave: "triangle", freq: 880, gain: 0.05, durMs: 110, everyMs: 550 },
  // Continuous, smooth (a plain sine, slow fade in and out) and higher.
  ready: { wave: "sine", freq: 1175, gain: 0.05, fadeInMs: 80, fadeOutMs: 120 },
} as const;

// One clear bell: a fundamental and a fifth above it, sharp attack and
// a long decay. Higher and louder than anything else so it reads as
// "the photo was taken".
export const CHIME = {
  partials: [
    { freq: 1568, gain: 0.12 },
    { freq: 2349, gain: 0.04 },
  ],
  attackMs: 5,
  durationMs: 700,
} as const;

/** A cue does not change again until this long after the last change, so
 * a ring that flickers between states does not machine-gun cues. The
 * last requested state still wins when the dwell ends. */
export const MIN_DWELL_MS = 350;

export interface SoundParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface SoundNodeLike {
  connect(node: unknown): unknown;
  disconnect(): unknown;
}
export interface SoundOscillatorLike extends SoundNodeLike {
  type: string;
  frequency: { value: number };
  onended: (() => void) | null;
  start(when?: number): unknown;
  stop(when?: number): unknown;
}
export interface SoundGainLike extends SoundNodeLike {
  gain: SoundParam;
}
/** The slice of AudioContext this module uses. */
export interface SoundContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): SoundOscillatorLike;
  createGain(): SoundGainLike;
}

export interface FaceCaptureSounds {
  /** Create the context and try to resume it. Call it from a user gesture
   * (and once at mount: the click that opened the page counts). Safe to
   * call again; a context that stays suspended just stays silent. */
  unlock(): Promise<void>;
  /** The cue for the ring now showing. Edge-triggered with a minimum dwell. */
  setCue(cue: SoundCue): void;
  /** A shot registered. One chime at a time. */
  captured(): void;
  /** True while the tab is hidden or the capture is not running: everything
   * stops, and the current cue comes back when it is false again. */
  setMuted(hidden: boolean): void;
  /** Silence everything and close the context. Final. */
  stop(): void;
}

export interface FaceCaptureSoundsOptions {
  createContext?: () => SoundContextLike;
  now?: () => number;
  /** Runs fn after ms; returns a canceller. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

let contextFactory: (() => SoundContextLike) | null = null;
/** Test seam (like session-runtime's setSessionFactory): the page builds its
 * AudioContext through this when set; null restores the real one. */
export function setSoundContextFactory(next: (() => SoundContextLike) | null): void {
  contextFactory = next;
}

function defaultContext(): SoundContextLike {
  if (contextFactory) return contextFactory();
  const Ctor = (globalThis as unknown as { AudioContext?: new () => SoundContextLike; webkitAudioContext?: new () => SoundContextLike }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: new () => SoundContextLike }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available");
  return new Ctor();
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function createFaceCaptureSounds(options: FaceCaptureSoundsOptions = {}): FaceCaptureSounds {
  const makeContext = options.createContext ?? defaultContext;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? defaultSchedule;

  let ctx: SoundContextLike | null = null;
  let contextFailed = false;
  let stopped = false;
  let hidden = false;
  let wanted: SoundCue | null = null;
  let active: SoundCue | null = null;
  let activeSince = Number.NEGATIVE_INFINITY;
  let chimeUntil = Number.NEGATIVE_INFINITY;
  let cancelLoop: (() => void) | null = null;
  let cancelPending: (() => void) | null = null;
  let held: { osc: SoundOscillatorLike; gain: SoundGainLike } | null = null;

  const running = () => ctx !== null && ctx.state === "running";

  /** One oscillator through its own gain node; both are disconnected when it ends. */
  function voice(wave: string, freq: number): { osc: SoundOscillatorLike; gain: SoundGainLike; t: number } {
    const c = ctx!;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(c.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    return { osc, gain, t: c.currentTime };
  }

  function blip(cue: "scanning" | "soft"): void {
    const spec = CUES[cue];
    const { osc, gain, t } = voice(spec.wave, spec.freq);
    const dur = spec.durMs / 1000;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(spec.gain, t + 0.008);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function startHeld(): void {
    const spec = CUES.ready;
    const { osc, gain, t } = voice(spec.wave, spec.freq);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(spec.gain, t + spec.fadeInMs / 1000);
    osc.start(t);
    held = { osc, gain };
  }

  function endHeld(): void {
    if (!held) return;
    const { osc, gain } = held;
    held = null;
    const t = ctx?.currentTime ?? 0;
    const out = CUES.ready.fadeOutMs / 1000;
    try {
      gain.gain.setValueAtTime(CUES.ready.gain, t);
      gain.gain.linearRampToValueAtTime(0, t + out);
      osc.stop(t + out + 0.02);
    } catch {
      // a context that is already closed has ended the tone itself
    }
  }

  function loop(cue: "scanning" | "soft"): void {
    if (active !== cue) return;
    if (running()) blip(cue);
    cancelLoop = schedule(() => loop(cue), CUES[cue].everyMs);
  }

  function stopActive(): void {
    cancelLoop?.();
    cancelLoop = null;
    endHeld();
  }

  /** Make `cue` the sounding one, right now. */
  function apply(cue: SoundCue | null): void {
    stopActive();
    active = cue;
    activeSince = now();
    if (cue === null) return;
    if (cue === "ready") {
      if (running()) startHeld();
    } else {
      loop(cue);
    }
  }

  function setCue(cue: SoundCue): void {
    wanted = cue;
    if (stopped || hidden) return;
    cancelPending?.();
    cancelPending = null;
    if (cue === active) return;
    const wait = MIN_DWELL_MS - (now() - activeSince);
    if (wait <= 0) {
      apply(cue);
      return;
    }
    cancelPending = schedule(() => {
      cancelPending = null;
      if (!stopped && !hidden && wanted !== active) apply(wanted);
    }, wait);
  }

  return {
    async unlock() {
      if (stopped) return;
      if (!ctx && !contextFailed) {
        try {
          ctx = makeContext();
        } catch {
          contextFailed = true;
        }
      }
      if (!ctx) return;
      try {
        await ctx.resume();
      } catch {
        // stays suspended: silent, and the next gesture tries again
      }
      if (stopped || hidden || !running()) return;
      // A cue asked for while suspended starts now; a held tone that
      // could not start earlier starts now.
      if (active === "ready" && !held) startHeld();
      else if (active === null && wanted !== null) apply(wanted);
    },
    setCue,
    captured() {
      if (stopped || hidden || !running()) return;
      const t0 = now();
      if (t0 < chimeUntil) return;
      chimeUntil = t0 + CHIME.durationMs;
      const dur = CHIME.durationMs / 1000;
      for (const partial of CHIME.partials) {
        const { osc, gain, t } = voice("sine", partial.freq);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(partial.gain, t + CHIME.attackMs / 1000);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
    },
    setMuted(next) {
      if (stopped || next === hidden) return;
      hidden = next;
      if (hidden) {
        cancelPending?.();
        cancelPending = null;
        stopActive();
        active = null;
        activeSince = Number.NEGATIVE_INFINITY;
        return;
      }
      if (wanted !== null) apply(wanted);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelPending?.();
      cancelPending = null;
      stopActive();
      const c = ctx;
      ctx = null;
      void c?.close().catch(() => {});
    },
  };
}
