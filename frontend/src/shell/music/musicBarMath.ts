// SF-08d: the pure math behind the Music bar: the spectrum bar levels and the lyric follow. No audio element and no DOM in here, so each
// piece is tested alone (musicBarMath.test.ts).
import type { TimedLyricLine } from "@maipai/ui/src/elements/lyrics-list";

/** Bars the bar's spectrum draws. */
export const SPECTRUM_BARS = 64;
/** Where the active lyric line sits in the viewport, from the top (Spotifast's SUNG_LINE_AT). */
export const LYRIC_FOLLOW_AT = 0.2;

/** The visualizer frame-rate ladder of spec 3 section 1.6: 30, 60, the screen's own rate when it reports one, then uncapped (0). */
export function fpsStops(screenHz?: number): number[] {
  const stops = new Set<number>([30, 60]);
  if (typeof screenHz === "number" && screenHz >= 10) stops.add(Math.round(screenHz));
  return [...[...stops].sort((a, b) => a - b), 0];
}
/** The milliseconds between two spectrum reads for a frame-rate stop (0 is uncapped). */
export const frameGapMs = (fps: number): number => (fps > 0 ? 1000 / fps : 0);

/**
 * Folds an analyser's byte spectrum (0..255 per bin, as `getByteFrequencyData` fills it) into `bars` levels 0..1. Bars are spaced
 * on a log scale so the low end is not squeezed into one bar. Each bar rises at once and falls by `fall` of its last height per call,
 * so a quiet moment settles smoothly (values under 0.01 snap to 0).
 */
export function levelsFromBytes(bytes: ArrayLike<number>, bars: number = SPECTRUM_BARS, previous: ArrayLike<number> | null = null, fall = 0.82): number[] {
  const out = new Array<number>(bars).fill(0);
  const bins = bytes.length;
  if (bins === 0 || bars <= 0) return out;
  // Skip bin 0 (DC); edges grow by a constant ratio from bin 1 to the last bin.
  const usable = Math.max(1, bins - 1);
  for (let bar = 0; bar < bars; bar++) {
    const lo = Math.floor(1 + (Math.pow(usable, bar / bars) - 1));
    const hi = Math.max(lo + 1, Math.floor(1 + (Math.pow(usable, (bar + 1) / bars) - 1)));
    let peak = 0;
    for (let bin = lo; bin < Math.min(hi, bins); bin++) peak = Math.max(peak, bytes[bin] ?? 0);
    const level = Math.min(1, Math.max(0, peak / 255));
    const last = previous?.[bar] ?? 0;
    const next = level >= last ? level : last * fall;
    out[bar] = next < 0.01 ? 0 : next;
  }
  return out;
}

/** The index of the last timed line whose start is at or before `time`, or -1 before the first (binary search; lines are sorted by `t`). */
export function activeLineIndex(lines: readonly Pick<TimedLyricLine, "t">[], time: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** The scrollTop that puts the middle of a line at `LYRIC_FOLLOW_AT` of the viewport height (never above the top). */
export function followScrollTop(lineTop: number, lineHeight: number, viewportHeight: number): number {
  return Math.max(0, lineTop + lineHeight / 2 - viewportHeight * LYRIC_FOLLOW_AT);
}

/** Follow state: a person's own scroll pauses it; a click on a line (which seeks) or the Follow button turns it back on. */
export function nextFollow(following: boolean, event: "user-scroll" | "line-click" | "resume"): boolean {
  return event === "user-scroll" ? false : event === "line-click" || event === "resume" ? true : following;
}
