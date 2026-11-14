import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../tests/reset-db";
import { createEntity } from "@/lib/entities";
import { homeOrAway, parseCurrentLocation } from "@/lib/places";
import { setHouseholdSettingValue } from "@/lib/settings";
import { observationsForTurn } from "@/lib/scene";

beforeEach(() => resetDb());

describe("coarse scene location", () => {
  test("returns unknown without a configured home point", () => {
    expect(homeOrAway(47.6, -122.3)).toBe("unknown");
  });

  test("classifies against the household point and consumes parsed rounded coordinates", () => {
    const home = createEntity({ id: "system", role: "owner" }, {
      kind: "place", place_kind: "map", name: "Household home", scope: "household",
      geo: { lat: 89, lon: 0, precision: "exact", area: "Private area", from: "search" },
    } as never);
    if (!home.ok) throw new Error("home fixture failed");
    expect(setHouseholdSettingValue("household.home", home.value!.id).ok).toBe(true);

    // At this latitude the longitude distance is small enough to exercise the
    // 1 km boundary with the existing two-decimal adult rounding.
    const justInside = parseCurrentLocation({ lat: 89, lon: 0.5 })!; // about 0.97 km
    const justOutside = parseCurrentLocation({ lat: 89, lon: 0.52 })!; // about 1.01 km
    expect(observationsForTurn({ surface: "chat", currentLocation: justInside, actorId: "person-adult", actorBand: "adult", now: 6 })[0]?.value).toMatchObject({ where: "home" });
    expect(observationsForTurn({ surface: "chat", currentLocation: justOutside, actorId: "person-adult", actorBand: "adult", now: 7 })[0]?.value).toMatchObject({ where: "away" });
    // A child's coarser tenth-degree point is rounded before distance is
    // calculated, so both nearby inputs resolve to the same coarse point.
    expect(observationsForTurn({ surface: "chat", currentLocation: justInside, actorId: "person-child", actorBand: "child", now: 8 })[0]?.value).toMatchObject({ where: "home" });
    expect(observationsForTurn({ surface: "chat", currentLocation: justOutside, actorId: "person-child", actorBand: "child", now: 9 })[0]?.value).toMatchObject({ where: "home" });
  });

  test("scene location values carry no coordinates or area", () => {
    const point = parseCurrentLocation({ lat: 1.2345, lon: 2.3456, area: "123 Main Street" })!;
    const observation = observationsForTurn({ surface: "chat", currentLocation: point, actorId: "person-test", actorBand: "adult", now: 5 })[0]!;
    expect(observation.value).toEqual({ where: "unknown", setting: "unknown", area: null, precision: "area" });
    expect(JSON.stringify(observation)).not.toContain("1.2345");
    expect(JSON.stringify(observation)).not.toContain("2.3456");
    expect(JSON.stringify(observation)).not.toContain("123 Main Street");
  });
});
