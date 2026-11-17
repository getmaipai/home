import { describe, expect, test } from "bun:test";
import { suggestionsFor } from "./modeSuggestions";

describe("Home composer suggestions follow the chosen mode", () => {
  test("each type has three chips of its own, and the lists differ", () => {
    const lists = ["ask", "picture", "video", "song", "sound"].map((id) => suggestionsFor(id).map((s) => s.prompt));
    for (const list of lists) expect(list).toHaveLength(3);
    expect(new Set(lists.flat()).size).toBe(15);
  });
  test("a mode with no list shows no chips", () => {
    expect(suggestionsFor("film")).toEqual([]);
  });
});
