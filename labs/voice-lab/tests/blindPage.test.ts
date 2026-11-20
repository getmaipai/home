import { expect, test } from "bun:test";
import { buildBlindPage, shuffleOrder, tally } from "../src/blindPage";
test("the blind page never names the level behind a take", () => {
  const html = buildBlindPage([{ you: "How was your day?", takes: [{ id: "1_1", src: "a.wav" }, { id: "1_2", src: "b.wav" }] }]);
  for (const w of ["natural", "fits", "lively", "heavy", "level"]) expect(html.toLowerCase()).not.toContain(w); expect(html).toContain("a.wav");
});
test("a shuffle is a permutation, repeatable, and not always the same order", () => {
  expect([...shuffleOrder(2, 5)].sort()).toEqual([0, 1]); expect(shuffleOrder(2, 5)).toEqual(shuffleOrder(2, 5));
  const firsts = new Set(Array.from({ length: 20 }, (_, i) => shuffleOrder(2, i)[0])); expect(firsts.size).toBe(2);
});
test("the tally applies the key afterwards", () => {
  const t = tally({ "1": { pick: 2, bad: 1 }, "2": { pick: 1, bad: 0 }, "3": { pick: 0 } }, { "1": ["natural", "fits"], "2": ["fits", "natural"], "3": ["natural", "fits"] });
  expect(t.fits).toEqual({ moreHuman: 2, gotInTheWay: 0 }); expect(t.natural).toEqual({ moreHuman: 0, gotInTheWay: 1 });
});
