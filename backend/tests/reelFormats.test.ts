import { describe, expect, test } from "bun:test";
import { getReelFormat, getReelPreset, listReelFormats, listReelPresets } from "@/lib/films/reelFormats";

describe("reel planner data", () => {
  test("loads six valid formats and four valid presets with unique ids", () => {
    const formats = listReelFormats();
    const presets = listReelPresets();
    expect(formats).toHaveLength(6);
    expect(presets).toHaveLength(4);
    expect(new Set(formats.map((item) => item.id)).size).toBe(6);
    expect(new Set(presets.map((item) => item.id)).size).toBe(4);
    for (const item of formats) {
      expect(item.aspect).toBe("9:16");
      expect(item.beats[0]).toBeGreaterThanOrEqual(5);
      expect(item.beats[1]).toBeLessThanOrEqual(12);
      expect(item.arc.length).toBeGreaterThanOrEqual(5);
      expect(item.rules.length).toBeGreaterThanOrEqual(2);
      expect(getReelFormat(item.id)).toEqual(item);
    }
    for (const item of presets) expect(getReelPreset(item.id)).toEqual(item);
    expect(listReelFormats()).toBe(formats);
    expect(listReelPresets()).toBe(presets);
  });
});
