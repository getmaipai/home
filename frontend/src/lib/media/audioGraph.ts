// MEDIA-VIZ-01: a live AnalyserNode for the media host's element, so the visualizers react to the real sound. Ported from the pre-rebuild
// hub's mediaAudioGraph, cut down to the one thing Home uses (the analyser; no EQ chain).
// createMediaElementSource works once per element, ever, so the tap is built at most once (WeakMap) and never torn down. The graph is
// additive: if it cannot attach, playback is untouched and the visualizers settle. Three cases skip it on purpose: iOS (routing an element
// through Web Audio ends background and lock-screen playback), a stream from another origin (a tapped cross-origin element goes silent), and
// an audio context that is not running yet (a tapped element plays silently through a suspended one). The context is made, and resumed,
// on the person's first tap, click or key press; until then the tap is skipped and playback is untouched.
const taps = new WeakMap<HTMLMediaElement, AnalyserNode>();
let context: AudioContext | null = null;

function audioContextClass(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;
function wakeContext() {
  const Ctor = audioContextClass();
  if (Ctor && !context) {
    try { context = new Ctor(); } catch { context = null; }
  }
  void context?.resume?.();
  if (context?.state === "running") GESTURES.forEach((name) => window.removeEventListener(name, wakeContext, true));
}
if (typeof window !== "undefined") GESTURES.forEach((name) => window.addEventListener(name, wakeContext, true));

function sameOrigin(el: HTMLMediaElement): boolean {
  try {
    return new URL(el.currentSrc || el.src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** The element's analyser, building the tap on first use. Call it from the element's own `play` event (a gesture-adjacent moment, so the
 * shared context is not born suspended). Null when the tap is unavailable. */
export function analyserFor(el: HTMLMediaElement): AnalyserNode | null {
  const existing = taps.get(el);
  if (existing) {
    void context?.resume?.();
    return existing;
  }
  if (isIos() || !sameOrigin(el) || !context || context.state !== "running") return null;
  try {
    const source = context.createMediaElementSource(el);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -12;
    source.connect(analyser);
    analyser.connect(context.destination);
    taps.set(el, analyser);
    return analyser;
  } catch {
    return null;
  }
}
