// MUSIC-GEN-20b: the pure post-processing of the Stack's word timings (design note 18.5a). Fixtures only, no model, no network.
import { describe, expect, test } from "bun:test";
import { buildLines, keepOrdered, reconcile, spaceUnanchored, type AlignedWord } from "@/lib/music/lyricsAlign";

/** Words as the Stack returns them: `starts[i]` is line i's first word time, or null for a line with no placed words; three words a line, 0.5 s each. */
function stackReply(texts: string[], starts: Array<number | null>) {
  const words: AlignedWord[] = []; const lineStarts: number[] = [];
  texts.forEach((text, i) => {
    const at = starts[i];
    if (at === null || at === undefined) { lineStarts.push(-1); return; }
    lineStarts.push(words.length);
    text.split(/\s+/).forEach((word, k) => words.push({ t: at + k * 0.5, end: at + k * 0.5 + 0.4, text: word }));
  });
  return { words, lineStarts };
}
const SONG = ["Morning light is here", "Warm and bright", "Pancakes rise up", "Under sunny skies", "Coffee flows on", "Sing it once more"];
const process = (texts: string[], starts: Array<number | null>) => {
  const { words, lineStarts } = stackReply(texts, starts);
  return spaceUnanchored(keepOrdered(buildLines(words, lineStarts, texts)));
};

describe("buildLines", () => {
  test("a line's t is its first word's start and its words are its own", () => {
    const { words, lineStarts } = stackReply(SONG, [1, 5, 10, 15, 20, 25]);
    const lines = buildLines(words, lineStarts, SONG);
    expect(lines.map((l) => l.t)).toEqual([1, 5, 10, 15, 20, 25]);
    expect(lines[1]!.words.map((w) => w.text)).toEqual(["Warm", "and", "bright"]);
    expect(lines[1]!.words[2]).toEqual({ t: 6, end: 6.4, text: "bright" });
  });
  test("a blank line and a line with no placed words have no time and no words, and do not steal their neighbours' words", () => {
    const texts = ["One two three", "", "Four five six", "♪ ♪", "Seven eight nine"];
    const { words, lineStarts } = stackReply(texts, [1, null, 5, null, 9]);
    const lines = buildLines(words, lineStarts, texts);
    expect(lines.map((l) => l.t)).toEqual([1, null, 5, null, 9]);
    expect(lines.map((l) => l.words.length)).toEqual([3, 0, 3, 0, 3]);
  });
});

describe("keepOrdered", () => {
  test("one misfired anchor (a line placed far too early) is dropped, wherever it lands", () => {
    const lines = keepOrdered(buildLines(...Object.values(stackReply(SONG, [1, 5, 2, 15, 20, 25])) as [AlignedWord[], number[]], SONG));
    expect(lines.map((l) => l.t)).toEqual([1, 5, null, 15, 20, 25]);
    expect(lines[2]!.words).toEqual([]);
  });
  test("a misfired first anchor is the one dropped", () => {
    const lines = keepOrdered(buildLines(...Object.values(stackReply(SONG, [90, 5, 10, 15, 20, 25])) as [AlignedWord[], number[]], SONG));
    expect(lines.map((l) => l.t)).toEqual([null, 5, 10, 15, 20, 25]);
  });
  test("a clean song is unchanged", () => {
    const { words, lineStarts } = stackReply(SONG, [1, 5, 10, 15, 20, 25]);
    const built = buildLines(words, lineStarts, SONG);
    expect(keepOrdered(built)).toEqual(built);
  });
});

describe("spaceUnanchored", () => {
  test("the misfired line, a blank line and a line with no words are spaced evenly between good anchors, never on equal stamps", () => {
    const texts = ["One two three", "", "Four five six", "♪", "Seven eight nine", "Ten eleven twelve"];
    const lines = process(texts, [1, null, 5, null, 9, 4]);
    expect(lines.map((l) => l.t)).toEqual([1, 3, 5, 7, 9, 10.5]);
    expect(new Set(lines.map((l) => l.t)).size).toBe(lines.length);
    expect(lines[5]!.words).toEqual([]);
  });
  test("leading lines are spaced from zero and a run past the last anchor is spaced evenly toward three seconds a line", () => {
    const lines = process(["a b c", "d e f", "g h i", "j k l"], [null, 6, null, null]);
    expect(lines.map((l) => l.t)).toEqual([3, 6, 8, 10]);
  });
});

describe("reconcile against the engine's own lrc", () => {
  const starts = [1, 5, 10, 15, 20, 25];
  const clean = () => process(SONG, starts);
  const lrcOf = (offset: number, override: Record<number, number> = {}) => SONG.map((text, i) => ({ t: (override[i] ?? starts[i]!) + offset, text }));

  test("a clean song with no lrc is returned untouched", () => {
    expect(reconcile(clean(), null).lines).toEqual(clean());
    expect(reconcile(clean(), []).source).toBe("forced");
  });
  test("an lrc that agrees changes nothing", () => {
    const result = reconcile(clean(), lrcOf(0));
    expect(result.lines).toEqual(clean());
  });
  test("an lrc offset by 2 s still agrees: no line moves, and the offset is reported", () => {
    const result = reconcile(clean(), lrcOf(2));
    expect(result.lines).toEqual(clean());
    expect(result.offsetS).toBeCloseTo(-2, 5);
    expect(result.matchedFrac).toBe(1);
  });
  test("one aligned line that misfired inside the song is repaired to the lrc's time (shifted by the offset), words and all", () => {
    const misfired = process(SONG, [1, 5, 10, 17.5, 20, 25]); // line 3 sits 2.5 s late, still in order
    const result = reconcile(misfired, lrcOf(2));
    expect(result.source).toBe("lrc");
    expect(result.lines[3]!.t).toBeCloseTo(15, 3);
    expect(result.lines[3]!.words[0]!.t).toBeCloseTo(15, 3);
    expect(result.lines[3]!.words[2]!.t).toBeCloseTo(16, 3);
    expect(result.lines.map((l) => l.t).filter((_, i) => i !== 3)).toEqual([1, 5, 10, 20, 25].map((t) => t));
  });
  test("an lrc of a different song keeps the aligned timing untouched", () => {
    const other = ["Totally other words", "Not this song", "Nothing matches", "At all here", "Really none", "Done now"].map((text, i) => ({ t: starts[i]! + 7, text }));
    const result = reconcile(clean(), other);
    expect(result.lines).toEqual(clean());
    expect(result.source).toBe("forced");
  });
  test("the same words on a different recording (timing drifts line by line) are not adopted", () => {
    const drift = SONG.map((text, i) => ({ t: starts[i]! * 1.4 + i * 1.5, text }));
    const result = reconcile(clean(), drift);
    expect(result.lines).toEqual(clean());
  });
  test("a repair that would land on a neighbour is dropped", () => {
    const misfired = process(SONG, [1, 5, 10, 15, 20, 25]);
    const result = reconcile(misfired, lrcOf(0, { 3: 10.1 }));
    expect(result.lines[3]!.t).toBe(15);
  });
});
