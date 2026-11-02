import { describe, expect, test } from "bun:test";
import { cleanStationName, STATION_NAME_MAX } from "./radioName";

describe("cleanStationName", () => {
  test("trims and collapses whitespace", () => expect(cleanStationName("  Cabin   FM \n")).toBe("Cabin FM"));
  test("leaves a short name with a separator alone", () => expect(cleanStationName("Radio Paradise - Main Mix")).toBe("Radio Paradise - Main Mix"));
  test("removes web addresses", () => {
    expect(cleanStationName("Jazz FM https://jazzfm.example.com/live")).toBe("Jazz FM");
    expect(cleanStationName("www.example.com Smooth Radio")).toBe("Smooth Radio");
  });
  test("drops a long tagline after a separator when the front is a sane name", () => {
    expect(cleanStationName("Sunrise FM | The best hits of the eighties, nineties and today, all day long")).toBe("Sunrise FM");
    expect(cleanStationName("Sunrise FM - The best hits of the eighties, nineties and today, all day long")).toBe("Sunrise FM");
  });
  test("caps a long name with no separator, at a word, with an ellipsis", () => {
    const out = cleanStationName("The very best radio station in the whole wide world and beyond forever");
    expect(out.length).toBeLessThanOrEqual(STATION_NAME_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toBe("The very best radio station in the…");
  });
  test("hard caps one huge word", () => {
    const out = cleanStationName("x".repeat(200));
    expect(out.length).toBe(STATION_NAME_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
  test("keeps a usable name when the whole name was an address", () => {
    expect(cleanStationName("https://stream.example.com/live.mp3")).not.toBe("");
  });
  test("is stable when run twice", () => {
    const once = cleanStationName("Sunrise FM | The best hits of the eighties, nineties and today, all day long");
    expect(cleanStationName(once)).toBe(once);
  });
});
