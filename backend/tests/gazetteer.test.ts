import { describe, expect, test } from "bun:test";
import { nearestLocalPlace, searchLocalPlaces } from "@/lib/gazetteer";

describe("local gazetteer for the household home", () => {
  test("a typed city resolves offline with 2-decimal coordinates", () => {
    const hits = searchLocalPlaces("Seattle");
    expect(hits[0]?.name).toBe("Seattle");
    expect(Number.isInteger(Math.round((hits[0]!.lat) * 100))).toBe(true);
    expect(String(hits[0]!.lat).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
  test("an unknown or empty name gives nothing", () => {
    expect(searchLocalPlaces("Zzyzxville Nowhere")).toEqual([]);
    expect(searchLocalPlaces("  ")).toEqual([]);
  });
  test("a point in downtown Chicago names Chicago", () => {
    expect(nearestLocalPlace(41.8781, -87.6298)?.name).toBe("Chicago");
  });
  test("a point mid-ocean or off Earth names nothing", () => {
    expect(nearestLocalPlace(0, -140)).toBeNull();
    expect(nearestLocalPlace(95, 0)).toBeNull();
  });
});
