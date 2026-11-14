import { describe, expect, test } from "bun:test";
import dataset from "./datasets/song-name.json";

describe("song-name dataset", () => {
  test("every row has an id, label and text; action rows use a supported action", () => {
    for (const row of dataset.rows) {
      expect(row.id).toBeTruthy();
      expect(row.label).toBeTruthy();
      expect(row.text).toBeTruthy();
      if ("action" in row && row.action !== undefined) expect(["listen", "reject", "suggest", "confirm"]).toContain(row.action);
    }
  });
});
