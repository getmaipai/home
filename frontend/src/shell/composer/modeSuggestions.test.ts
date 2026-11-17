import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suggestionsFor } from "./modeSuggestions";

describe("Home composer suggestions follow the chosen mode", () => {
  test("each type has three chips of its own, and the lists differ", () => {
    const lists = ["ask", "picture", "video", "from-picture", "animate", "talking-avatar", "voiceover", "film", "song", "sound"].map((id) => suggestionsFor(id).map((s) => s.prompt));
    for (const list of lists) expect(list).toHaveLength(3);
    expect(new Set(lists.flat()).size).toBe(30);
  });
  test("a mode with no list shows no chips", () => {
    expect(suggestionsFor("not-a-mode")).toEqual([]);
  });
  test("every mode a package lists has chips, so no type shows an empty row under the box", () => {
    const ids = ["image", "video", "audio"].flatMap((pkg) => (JSON.parse(readFileSync(join(import.meta.dir, `../../../../backend/packages/${pkg}/composer.json`), "utf-8")) as { modes: Array<{ id: string }> }).modes.map((m) => m.id));
    expect(ids.length).toBeGreaterThan(8);
    for (const id of ids) expect([id, suggestionsFor(id).length]).toEqual([id, 3]);
  });
});
