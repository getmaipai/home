// MEDIA-VIZ-01: a live AnalyserNode for the media host's element, so the visualizers react to the real sound. Ported from the pre-rebuild
// hub's mediaAudioGraph. MEDIA-PARITY-02: the chain also holds three tone filters (low shelf, mid peak, high shelf) that the Equalizer presets set.
// createMediaElementSource works once per element, ever, so the tap is built at most once (WeakMap) and never torn down. The graph is
// additive: if it cannot attach, playback is untouched and the visualizers settle. Three cases skip it on purpose: iOS (routing an element
// through Web Audio ends background and lock-screen playback), a stream from another origin (a tapped cross-origin element goes silent), and
// an audio context that is not running yet (a tapped element plays silently through a suspended one). The context is made, and resumed,
// on the person's first tap, click or key press; until then the tap is skipped and playback is untouched.
interface PlayerGraph { analyser: AnalyserNode; preamp: GainNode; bands: BiquadFilterNode[]; limiter: DynamicsCompressorNode; transport: GainNode; volume: GainNode }
const taps = new WeakMap<HTMLMediaElement, PlayerGraph>();
let context: AudioContext | null = null;

/** The Equalizer presets: the gain in dB of the low shelf (160 Hz), the mid peak (1.8 kHz) and the high shelf (5 kHz). Flat is all zero, so a tapped element sounds as it did. */
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, -1, -1], treble: [-1, -1, 0, 0, 0, 0, 1, 3, 5, 6],
  vocal: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1], loud: [3, 2, 1, 0, -1, -1, 0, 1, 2, 3],
  acoustic: [2, 1, 0, 1, 2, 2, 1, 2, 2, 1], dance: [5, 4, 2, 0, -1, 1, 2, 2, 3, 3],
  jazz: [3, 2, 1, 1, -1, -1, 0, 1, 2, 3], rock: [4, 3, 1, 0, -1, 1, 2, 3, 3, 2],
} as const satisfies Record<string, readonly number[]>;
export type EqPreset = keyof typeof EQ_PRESETS;
export const EQ_PRESET_IDS = Object.keys(EQ_PRESETS) as EqPreset[];
/** A stored value read as a preset; anything else is flat. */
export const eqPresetOf = (value: unknown): EqPreset => (typeof value === "string" && value in EQ_PRESETS ? (value as EqPreset) : "flat");
export function octaveQ(frequency: number, sampleRate = 48000, octaveWidth = 1): number {
  const w0 = 2 * Math.PI * frequency / sampleRate;
  const ratio = w0 / Math.sin(w0);
  return 1 / (2 * Math.sinh(Math.LN2 / 2 * octaveWidth * ratio));
}

let eqPreset: EqPreset = "flat";
const chains = new Set<WeakRef<PlayerGraph>>();
const tuneChain = (graph: PlayerGraph) => graph.bands.forEach((filter, index) => { filter.gain.value = EQ_PRESETS[eqPreset][index] ?? 0; });
export const getEqPreset = (): EqPreset => eqPreset;
/** Sets the preset on every element already tapped and on every one tapped later. */
export function setEqPresetOnGraph(preset: EqPreset): void {
  eqPreset = preset;
  for (const ref of chains) {
    const graph = ref.deref();
    if (graph) tuneChain(graph); else chains.delete(ref);
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
    return existing.analyser;
  }
  if (isIos() || !sameOrigin(el) || !context || context.state !== "running") return null;
  try {
    const source = context.createMediaElementSource(el);
    const preamp = context.createGain(); preamp.gain.value = 1;
    const transport = context.createGain(); transport.gain.value = 1;
    const volume = context.createGain(); volume.gain.value = 1;
    const bands = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequency) => {
      const filter = context!.createBiquadFilter(); filter.type = "peaking"; filter.frequency.value = frequency; filter.Q.value = octaveQ(frequency, context!.sampleRate); return filter;
    });
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.0015; limiter.release.value = 0.1;
    const analyser = context.createAnalyser();
    const graph: PlayerGraph = { analyser, preamp, bands, limiter, transport, volume };
    tuneChain(graph);
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -12;
    source.connect(preamp);
    let previous: AudioNode = preamp;
    for (const band of bands) { previous.connect(band); previous = band; }
    previous.connect(transport); transport.connect(volume); volume.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(context.destination);
    chains.add(new WeakRef(graph));
    taps.set(el, graph);
    return analyser;
  } catch {
    return null;
  }
}

export function scheduleAudioRamp(param: AudioParam, value: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, seconds / 3);
}
export function setPlayerEq(gains: readonly number[], preampDb = 0): void {
  for (const ref of chains) {
    const graph = ref.deref(); if (!graph) { chains.delete(ref); continue; }
    graph.bands.forEach((band, index) => { band.gain.value = Math.min(12, Math.max(-12, gains[index] ?? 0)); });
    graph.preamp.gain.value = 10 ** (Math.min(12, Math.max(-12, preampDb)) / 20);
  }
}
export function setPlayerTransport(el: HTMLMediaElement, target: number): void {
  const graph = taps.get(el); if (graph && context) scheduleAudioRamp(graph.transport.gain, target, context.currentTime, 0.05);
}
export function setPlayerVolume(el: HTMLMediaElement, target: number): void {
  const graph = taps.get(el); if (graph && context) scheduleAudioRamp(graph.volume.gain, target, context.currentTime, 0.03);
}
export const hasPlayerAudioGraph = (el: HTMLMediaElement): boolean => taps.has(el);
export const playerAudioAvailable = (): boolean => typeof window !== "undefined" && !!audioContextClass() && !isIos();
