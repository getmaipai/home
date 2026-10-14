import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/tour-runner-manifest.json";
import type { TourProgressRecord } from "@/lib/api";

function shouldStart(tour: { id: string; version: number }, packageId: string, records: TourProgressRecord[]) {
  return !records.some((record) => record.package_id === packageId && record.tour_id === tour.id && record.version === tour.version);
}

describe("manifest tour first-open selection", () => {
  test("starts once for a person, and a completed version does not start again", () => {
    const manifest = fixture as { id: string; contributes: { tours: Array<{ id: string; version: number; starts_on: string }> } };
    const tour = manifest.contributes.tours[0]!;
    expect(tour.starts_on).toBe("page:chat");
    expect(shouldStart(tour, manifest.id, [])).toBe(true);
    const record = { package_id: manifest.id, tour_id: tour.id, version: tour.version } as TourProgressRecord;
    expect(shouldStart(tour, manifest.id, [record])).toBe(false);
  });
});
