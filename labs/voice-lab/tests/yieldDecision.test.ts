import { expect, test } from "bun:test";
import { decideYield, YIELD } from "../src/yieldDecision";

const d = (overlapMs: number, words: string) => decideYield({ overlapMs, words, heardAnything: words.length > 0 });
test("no human overlap on the cleaned microphone means her own echo or noise: never yield, whatever the recognizer wrote", () => {
  expect(d(0, "stop")).toBe("continue"); expect(d(100, "Thursday")).toBe("continue"); expect(d(YIELD.minOverlapMs - 1, "wait stop")).toBe("continue");
});
test("the exact repeated word is the point: she says Thursday, he says Thursday?, she yields", () => {
  expect(d(400, "Thursday?")).toBe("yield");
});
test("short overlaps: quiet mm-hm and yeah keep her going, yeah-actually and stop make her yield", () => {
  expect(d(350, "mm-hm")).toBe("continue"); expect(d(300, "yeah")).toBe("continue");
  expect(d(450, "yeah, actually")).toBe("yield"); expect(d(400, "stop")).toBe("yield"); expect(d(400, "wait")).toBe("yield");
});
test("a long overlap is a person talking over her whatever the words (even empty or a mm-hm said at length)", () => {
  expect(d(YIELD.certainMs, "")).toBe("yield"); expect(d(900, "mm-hm")).toBe("yield");
});
