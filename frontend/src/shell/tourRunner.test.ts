import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/tour-runner-manifest.json";
import type { InstalledPackage, TourProgressRecord } from "@/lib/api";
import { replayTour, stepsWithPresentTargets, toursForPage, tourTargetPresent } from "@/shell/useTourRunner";

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

  test("lists only installed tours for the current page and audience", () => {
    const packages = [
      fixture,
      { ...fixture, id: "other", contributes: { tours: [{ ...fixture.contributes.tours[0]!, id: "fixture.home", starts_on: "page:home" }] } },
      { ...fixture, id: "child-only", contributes: { tours: [{ ...fixture.contributes.tours[0]!, audience: ["child"] }] } },
    ] as unknown as InstalledPackage[];
    expect(toursForPage(packages, "chat", "adult").map(({ packageId, tour }) => [packageId, tour.id])).toEqual([
      ["tour-fixture", "fixture.first-open"],
    ]);
  });

  test("replays the selected current-page tour through the runner start callback", () => {
    const available = toursForPage([fixture as unknown as InstalledPackage], "chat", "adult");
    const started: string[] = [];
    expect(replayTour(available, "tour-fixture", "fixture.first-open", ({ packageId, tour }) => started.push(`${packageId}:${tour.id}`))).toBe(true);
    expect(started).toEqual(["tour-fixture:fixture.first-open"]);
    expect(replayTour(available, "tour-fixture", "missing", () => started.push("wrong"))).toBe(false);
    expect(started).toEqual(["tour-fixture:fixture.first-open"]);
  });
});

describe("tour targets on screen", () => {
  test("tourTargetPresent finds only elements carrying the target attribute", () => {
    const attr = ["data", "tour"].join("-");
    document.body.innerHTML = `<nav ${attr}="rail"></nav>`;
    expect(tourTargetPresent("rail")).toBe(true);
    expect(tourTargetPresent("profile")).toBe(false);
    document.body.innerHTML = "";
  });

  test("steps whose target is missing are dropped, so Step N of M counts shown cards", () => {
    const attr = ["data", "tour"].join("-");
    document.body.innerHTML = `<nav ${attr}="rail"></nav><button ${attr}="chat"></button>`;
    const steps = [{ id: "a", target: "profile" }, { id: "b", target: "rail" }, { id: "c" }, { id: "d", target: "chat" }];
    expect(stepsWithPresentTargets(steps).map((step) => step.id)).toEqual(["b", "c", "d"]);
    expect(stepsWithPresentTargets([{ id: "x", target: "gone" }])).toEqual([]);
    document.body.innerHTML = "";
  });

  test("a phone with the rail hidden loses the rail step only", () => {
    const present = (target: string) => target !== "rail";
    const steps = [{ id: "profile", target: "profile" }, { id: "rail", target: "rail" }, { id: "chat", target: "chat" }];
    expect(stepsWithPresentTargets(steps, present).map((step) => step.id)).toEqual(["profile", "chat"]);
  });
});
