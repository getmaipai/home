import { beforeEach, describe, expect, test } from "bun:test";
import { installRefusal, missingOptional, missingRequired, unavailableCapabilities } from "@/lib/capabilities";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("capabilities follow the allocation", () => {
  test("with every role on, nothing is unavailable", () => {
    expect(unavailableCapabilities().size).toBe(0);
    expect(missingRequired({ requires: ["image"] })).toEqual([]);
  });

  test("image off hides a package that requires image and only degrades one that lists it optional", () => {
    expect(setHouseholdSettingValue("engines.image.choice", "off").ok).toBe(true);
    expect(missingRequired({ requires: ["image"] })).toEqual(["image"]);
    expect(missingOptional({ optional: ["image"] })).toEqual(["image"]);
    expect(missingRequired({ optional: ["image"] })).toEqual([]);
  });

  test("a role that failed to install counts as off", () => {
    expect(unavailableCapabilities(["video"]).has("video")).toBe(true);
  });

  test("the install refusal names what is off and where to turn it on", () => {
    setHouseholdSettingValue("engines.image.choice", "off");
    const line = installRefusal("draw", { requires: ["image"] });
    expect(line).toContain("Pictures is off");
    expect(line).toContain("Engines and AI");
    expect(installRefusal("weather", { requires: [] })).toBeNull();
  });
});
