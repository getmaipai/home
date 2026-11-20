import { describe, expect, test } from "bun:test";
import { filmPlanSchema, facelessFilmPlanSchema, holdBackReveals, MAX_LINES_PER_SHOT, type FilmPlan } from "@/lib/films/plan";
import { shotLines, shotText } from "@/lib/films/lines";

const cast = [
  { name: "Willow", kind: "character", locked: "A blue coat.", reveal_last: false },
  { name: "Marlow", kind: "character", locked: "A green scarf.", reveal_last: false },
];
const shot = (id: string, extra: Record<string, unknown> = {}) => ({ id, subject_ids: [], framing: "wide", still: "Two friends on a pier.", motion: "The tide rolls.", seconds: 5, ...extra });
const plan = (shots: unknown[], castList: unknown[] = cast) => ({ title: "Pier", summary: "Two friends.", cast: castList, shots, music: "Soft piano.", credits: [] });

describe("FILM-LINES-01 plan schema", () => {
  test("accepts lines by named characters and Narration, up to 3", () => {
    const ok = plan([shot("a", { lines: [{ speaker: "Willow", text: "Hi." }, { speaker: "Marlow", text: "Hello." }, { speaker: "Narration", text: "They met." }] }), shot("b")]);
    expect(filmPlanSchema.safeParse(ok).success).toBe(true);
    expect(MAX_LINES_PER_SHOT).toBe(3);
  });
  test("refuses four lines, both line and lines, an unknown speaker, a long line and a cast entry named Narration", () => {
    const four = Array.from({ length: 4 }, () => ({ speaker: "Willow", text: "Hi." }));
    expect(filmPlanSchema.safeParse(plan([shot("a", { lines: four }), shot("b")])).success).toBe(false);
    expect(filmPlanSchema.safeParse(plan([shot("a", { line: "Hi.", lines: [{ speaker: "Willow", text: "Hi." }] }), shot("b")])).success).toBe(false);
    expect(filmPlanSchema.safeParse(plan([shot("a", { lines: [{ speaker: "Nobody", text: "Hi." }] }), shot("b")])).success).toBe(false);
    expect(filmPlanSchema.safeParse(plan([shot("a", { lines: [{ speaker: "Willow", text: "x".repeat(161) }] }), shot("b")])).success).toBe(false);
    expect(filmPlanSchema.safeParse(plan([shot("a"), shot("b")], [...cast, { name: "Narration", kind: "character", locked: "A voice.", reveal_last: false }])).success).toBe(false);
  });
  test("a faceless film has no lines", () => {
    const faceless = { title: "T", summary: "S", shots: [shot("a", { lines: [{ speaker: "Narration", text: "Hi." }] }), shot("b")], music: "m", credits: [] };
    const parsed = facelessFilmPlanSchema.safeParse(faceless);
    expect(parsed.success && "lines" in parsed.data.shots[0]!).toBe(false);
  });
  test("a hidden reveal is stripped from lines too", () => {
    const p = filmPlanSchema.parse(plan([shot("a", { lines: [{ speaker: "Willow", text: "Look at the Lighthouse now." }] }), shot("b")], [cast[0], { name: "Lighthouse", kind: "place", locked: "A tall white tower.", reveal_last: true }])) as FilmPlan;
    const held = holdBackReveals(p, "");
    expect(JSON.stringify(held.shots[0])).not.toContain("Lighthouse");
  });
});

describe("shotLines and shotText", () => {
  const two = { cast } as never;
  const one = { cast: [cast[0]] } as never;
  test("lines win and are trimmed, blanks dropped", () => {
    expect(shotLines(two, { lines: [{ speaker: "Willow", text: " Hi. " }, { speaker: "Marlow", text: "  " }] })).toEqual([{ speaker: "Willow", text: "Hi." }]);
    expect(shotText(two, { lines: [{ speaker: "Willow", text: "Hi." }, { speaker: "Marlow", text: "Hello." }] })).toBe("Hi. Hello.");
  });
  test("a single line belongs to the film's one speaker, else Narration", () => {
    expect(shotLines(one, { line: "Hi." })).toEqual([{ speaker: "Willow", text: "Hi." }]);
    expect(shotLines(two, { line: "Hi." })).toEqual([{ speaker: "Narration", text: "Hi." }]);
    expect(shotLines(one, {})).toEqual([]);
  });
});
