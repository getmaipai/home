// MEDIA-VIZ-01: a live AnalyserNode for the media host's element, so the visualizers react to the real sound. Ported from the pre-rebuild
// hub's mediaAudioGraph. MEDIA-PARITY-02: the chain also holds three tone filters (low shelf, mid peak, high shelf) that the Equalizer presets set.
// createMediaElementSource works once per element, ever, so the tap is built at most once (WeakMap) and never torn down. The graph is
// additive: if it cannot attach, playback is untouched and the visualizers settle. Three cases skip it on purpose: iOS (routing an element
// through Web Audio ends background and lock-screen playback), a stream from another origin (a tapped cross-origin element goes silent), and
// an audio context that is not running yet (a tapped element plays silently through a suspended one). The context is made, and resumed,
// on the person's first tap, click or key press; until then the tap is skipped and playback is untouched.
const taps = new WeakMap<HTMLMediaElement, AnalyserNode>();
let context: AudioContext | null = null;

/** The Equalizer presets: the gain in dB of the low shelf (160 Hz), the mid peak (1.8 kHz) and the high shelf (5 kHz). Flat is all zero, so a tapped element sounds as it did. */
export const EQ_PRESETS = {
  flat: [0, 0, 0],
  bass: [7, 0, -1],
  treble: [-1, 0, 6],
  vocal: [-3, 4, 1],
} as const satisfies Record<string, readonly [number, number, number]>;
export type EqPreset = keyof typeof EQ_PRESETS;
export const EQ_PRESET_IDS = Object.keys(EQ_PRESETS) as EqPreset[];
/** A stored value read as a preset; anything else is flat. */
export const eqPresetOf = (value: unknown): EqPreset => (typeof value === "string" && value in EQ_PRESETS ? (value as EqPreset) : "flat");

let eqPreset: EqPreset = "flat";
const chains = new Set<WeakRef<BiquadFilterNode[]>>();
const tuneChain = (chain: BiquadFilterNode[]) => chain.forEach((filter, index) => { filter.gain.value = EQ_PRESETS[eqPreset][index] ?? 0; });
export const getEqPreset = (): EqPreset => eqPreset;
/** Sets the preset on every element already tapped and on every one tapped later. */
export function setEqPresetOnGraph(preset: EqPreset): void {
  eqPreset = preset;
  for (const ref of chains) {
    const chain = ref.deref();
    if (chain) tuneChain(chain); else chains.delete(ref);
  }
}

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

export function isIos(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Whether the Equalizer can work here: not on iOS, where routing an element through Web Audio would end background and lock-screen playback. */
export const eqSupported = (): boolean => typeof navigator === "undefined" || !isIos();

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
    const low = context.createBiquadFilter(), mid = context.createBiquadFilter(), high = context.createBiquadFilter();
    low.type = "lowshelf"; low.frequency.value = 160;
    mid.type = "peaking"; mid.frequency.value = 1800; mid.Q.value = 0.9;
    high.type = "highshelf"; high.frequency.value = 5000;
    const chain = [low, mid, high];
    tuneChain(chain);
    chains.add(new WeakRef(chain));
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -12;
    source.connect(low);
    low.connect(mid);
    mid.connect(high);
    high.connect(analyser);
    analyser.connect(context.destination);
    taps.set(el, analyser);
    return analyser;
  } catch {
    return null;
  }
}
