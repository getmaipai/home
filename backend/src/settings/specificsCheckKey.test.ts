import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../../tests/reset-db";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";

beforeEach(resetDb);

describe("chat.specifics_check setting", () => {
  test("is a household advanced select with its own default and plain help", () => {
    const found = getRegistry().filter((entry) => entry.key === "chat.specifics_check");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ scope: "household", selector: "select", default: "shadow", level: "advanced", lives_in: "household.ai_advanced", honoured_by: ["home"] });
    expect(found[0]!.range).toEqual({ options: ["off", "shadow"] });
    expect(found[0]!.label).not.toBe(getRegistry().find((entry) => entry.key === "chat.search_assist")!.label);
    expect(found[0]!.help).toContain("never changes the reply");
    expect(getHouseholdSettingValue("chat.specifics_check")).toBe("shadow");
  });
});
