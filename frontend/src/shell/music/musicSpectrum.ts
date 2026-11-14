// SF-08d: the live spectrum behind the Music bar. `levels()` is what the kit Player's `spectrum` setting calls each frame. It reads the
// analyser the shared audio graph already made for the one player element (lib/media/audioGraph.ts: one AudioContext for the page, made
// and resumed on the person's first gesture, additive, so playback is unaffected). It does nothing while the song is paused or the page
// is hidden, and it never reads the element's clock.
import { levelsFromBytes, SPECTRUM_BARS, frameGapMs } from "./musicBarMath";

export interface SpectrumSource {
  /** The analyser, or null while it is not available (iOS, a cross-origin file, no gesture yet). */
  analyser: () => Pick<AnalyserNode, "frequencyBinCount" | "getByteFrequencyData"> | null;
  playing: () => boolean;
  hidden?: () => boolean;
  now?: () => number;
  /** Frames per second to read at; 0 reads on every call. */
  fps?: () => number;
}

export function createSpectrum(source: SpectrumSource): { levels: () => number[] } {
  const now = source.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const hidden = source.hidden ?? (() => typeof document !== "undefined" && document.hidden);
  const silent = new Array<number>(SPECTRUM_BARS).fill(0);
  let last = silent;
  let lastAt = -Infinity;
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  return {
    levels() {
      if (!source.playing() || hidden()) { last = silent; return silent; }
      const at = now();
      if (at - lastAt < frameGapMs(source.fps?.() ?? 60)) return last;
      const analyser = source.analyser();
      if (!analyser) return silent;
      lastAt = at;
      if (!bytes || bytes.length !== analyser.frequencyBinCount) bytes = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyser.getByteFrequencyData(bytes);
      last = levelsFromBytes(bytes, SPECTRUM_BARS, last);
      return last;
    },
  };
}
