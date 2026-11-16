import { describe, expect, test } from "bun:test";
import { pianoRollModel } from "@/apps/chat/pianoRollModel";
describe("pianoRollModel", () => {
  test("maps time left to right and higher pitches upward", () => {
    const model = pianoRollModel([{ start: 0, end: 1, pitch: 60, velocity: 90 }, { start: 1, end: 2, pitch: 72, velocity: 90 }]);
    expect(model[0]!.x).toBeLessThan(model[1]!.x); expect(model[0]!.y).toBeGreaterThan(model[1]!.y);
  });
  test("draws no more than 2000 notes", () => { expect(pianoRollModel(Array.from({ length: 2001 }, (_, i) => ({ start: i, end: i + 1, pitch: 60, velocity: 90 }))).length).toBe(2000); });
});
