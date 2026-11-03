// MUSIC-GEN-20b: word timing for made songs, pure post-processing of the Stack's `align` output (design note 18.5a). No I/O.
// Ported from the pre-migration hub (stems/align.py and stems/reconcileLyrics.ts): three rules that fixed real bugs.
//   1. keep the longest run of line anchors that never goes backwards in time and drop the rest (a misfired anchor made a line flash and vanish);
//   2. space unanchored lines evenly between the surrounding good anchors, never on equal stamps (equal stamps hid lines);
//   3. trust measured onsets: no score threshold.
// The engine's own `lrc` only repairs outlier lines (reconcile) and is never adopted wholesale.

export interface AlignedWord { t: number; end: number; text: string }
/** A line's `t` is its first word's start; null until it is anchored or spaced. */
export interface AlignedLine { t: number | null; text: string; words: AlignedWord[] }
export interface TimedAlignedLine extends AlignedLine { t: number }
export interface LrcLine { t: number; text: string }
export interface ReconcileResult {
  lines: TimedAlignedLine[]; source: "forced" | "lrc";
  /** Constant shift applied to repaired outlier lines (lrc time to audio time). */ offsetS: number;
  /** Fraction of non-blank aligned lines the lrc could confirm. */ matchedFrac: number;
  /** Median absolute deviation of the matched lines' deltas, in seconds. */ spread: number;
}

const MIN_MATCHED_FRAC = 0.6;   // need to confirm most of the song to call the lrc "the same recording"
const MAX_SPREAD_S = 0.4;       // MAD of deltas above this: the lrc is not reliably the same recording
const OUTLIER_DELTA_S = 0.6;    // a line whose own delta is this far from the median is a likely misfire
const RESYNC_WINDOW = 3;        // lines to look ahead when a skipped or inserted line breaks 1:1 order
const MIN_LINE_GAP_S = 0.3;     // a repair may never squeeze a line this close to its neighbours
const MIN_UNANCHORED_STEP_S = 0.01;
const TAIL_STEP_S = 3;          // lines after the last anchor are spread evenly toward this many seconds each

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * One line per source line, in source order. `lineStarts[i]` is the index in `words` of line i's first placed word, or -1 when it has none
 * (blank, or no readable word); a line's words run up to the next line that has a start.
 */
export function buildLines(words: AlignedWord[], lineStarts: number[], sourceLines: string[]): AlignedLine[] {
  const lines: AlignedLine[] = [];
  for (let i = 0; i < sourceLines.length; i++) {
    const start = lineStarts[i] ?? -1;
    if (start < 0 || start >= words.length) { lines.push({ t: null, text: sourceLines[i]!, words: [] }); continue; }
    let end = words.length;
    for (let j = i + 1; j < sourceLines.length; j++) { const next = lineStarts[j] ?? -1; if (next >= 0) { end = Math.min(words.length, Math.max(start, next)); break; } }
    const own = words.slice(start, end).map((w) => ({ t: round3(w.t), end: round3(w.end), text: w.text }));
    lines.push({ t: own[0]?.t ?? null, text: sourceLines[i]!, words: own });
  }
  return lines;
}

/** Rule 1: keep the longest non-decreasing run of anchors; every other anchored line loses its time and words. Returns new lines. */
export function keepOrdered(lines: AlignedLine[]): AlignedLine[] {
  const anchored = lines.map((line, index) => (line.t === null ? -1 : index)).filter((index) => index >= 0);
  const keep = new Set<number>(anchored);
  if (anchored.length > 1) {
    const best = anchored.map(() => 1); const prev = anchored.map(() => -1);
    for (let b = 1; b < anchored.length; b++) for (let a = 0; a < b; a++) {
      if (lines[anchored[a]!]!.t! <= lines[anchored[b]!]!.t! && best[a]! + 1 > best[b]!) { best[b] = best[a]! + 1; prev[b] = a; }
    }
    let end = 0; for (let k = 1; k < anchored.length; k++) if (best[k]! > best[end]!) end = k;
    keep.clear();
    while (end !== -1) { keep.add(anchored[end]!); end = prev[end]!; }
  }
  return lines.map((line, index) => (line.t !== null && !keep.has(index) ? { t: null, text: line.text, words: [] } : { ...line, words: [...line.words] }));
}

/** Rule 2: time every unanchored line evenly between the surrounding anchors, in text order. */
export function spaceUnanchored(lines: AlignedLine[]): TimedAlignedLine[] {
  const out: AlignedLine[] = lines.map((line) => ({ ...line, words: [...line.words] }));
  const n = out.length; let i = 0;
  while (i < n) {
    if (out[i]!.t !== null) { i++; continue; }
    let j = i; while (j < n && out[j]!.t === null) j++;
    const prev = i > 0 ? out[i - 1]!.t! : 0;
    const next = j < n ? out[j]!.t! : prev + TAIL_STEP_S * (j - i);
    const span = Math.max(MIN_UNANCHORED_STEP_S * (j - i + 1), next - prev);
    for (let k = i; k < j; k++) out[k]!.t = round3(prev + (span * (k - i + 1)) / (j - i + 1));
    i = j;
  }
  return out as TimedAlignedLine[];
}

function normalizeLine(text: string): string { return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }
function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function pairLines(aligned: TimedAlignedLine[], lrc: LrcLine[]): Map<TimedAlignedLine, LrcLine> {
  const pairs = new Map<TimedAlignedLine, LrcLine>(); let at = 0;
  for (const line of aligned) {
    const want = normalizeLine(line.text); if (!want) continue;
    for (let w = 0; w <= RESYNC_WINDOW && at + w < lrc.length; w++) {
      if (normalizeLine(lrc[at + w]!.text) === want) { pairs.set(line, lrc[at + w]!); at = at + w + 1; break; }
    }
  }
  return pairs;
}

/**
 * Cross-check against the engine's own `lrc` lines. When they agree on a constant offset for most lines the lrc times the same file, and only the
 * lines whose own delta is an outlier are moved (with their words); when they do not agree, the aligned timing is returned untouched.
 */
export function reconcile(aligned: TimedAlignedLine[], lrc: LrcLine[] | null): ReconcileResult {
  const untouched = (matchedFrac: number, spread: number): ReconcileResult => ({ lines: aligned, source: "forced", offsetS: 0, matchedFrac, spread });
  const nonBlank = aligned.filter((line) => normalizeLine(line.text));
  if (!lrc?.length || !nonBlank.length) return untouched(0, 0);
  const pairs = pairLines(aligned, lrc);
  const matchedFrac = pairs.size / nonBlank.length;
  if (pairs.size < 2 || matchedFrac < MIN_MATCHED_FRAC) return untouched(matchedFrac, 0);
  const deltas = [...pairs].map(([line, other]) => other.t - line.t);
  const mid = median(deltas); const spread = median(deltas.map((d) => Math.abs(d - mid)));
  if (spread > MAX_SPREAD_S) return untouched(matchedFrac, spread);
  const repaired: TimedAlignedLine[] = [];
  for (let i = 0; i < aligned.length; i++) {
    const line = aligned[i]!; const other = pairs.get(line);
    if (!other || Math.abs(other.t - line.t - mid) <= OUTLIER_DELTA_S) { repaired.push(line); continue; }
    const candidate = round3(other.t - mid);
    const before = repaired.at(-1)?.t ?? -Infinity; const after = aligned[i + 1]?.t ?? Infinity;
    // A repair that would reorder the display, or sit on a neighbour, is dropped: a slightly-off line beats one that flashes past.
    if (candidate < before + MIN_LINE_GAP_S || candidate > after - MIN_LINE_GAP_S) { repaired.push(line); continue; }
    const shift = candidate - line.t;
    repaired.push({ t: candidate, text: line.text, words: line.words.map((w) => ({ t: round3(w.t + shift), end: round3(w.end + shift), text: w.text })) });
  }
  return { lines: repaired, source: "lrc", offsetS: -mid, matchedFrac, spread };
}
