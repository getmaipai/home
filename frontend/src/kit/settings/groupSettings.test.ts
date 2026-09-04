import { describe, expect, test } from "bun:test";
import { groupSettings, sectionTitle } from "@/kit/settings/groupSettings";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import type { ResolvedSetting } from "@/lib/api";

function key(overrides: Partial<SettingsKey> = {}): SettingsKey {
  return {
    key: "household.locale",
    scope: "household",
    selector: "select",
    range: { options: ["en-US", "en-GB"] },
    default: "en-US",
    label: "Language and region",
    level: "basic",
    secret: false,
    lives_in: "household.system",
    honoured_by: ["home"],
    ...overrides,
  };
}

function value(overrides: Partial<ResolvedSetting> = {}): ResolvedSetting {
  return {
    key: "household.locale",
    value: "en-US",
    source: "default",
    label: "Language and region",
    level: "basic",
    secret: false,
    ...overrides,
  };
}

describe("groupSettings", () => {
  test("groups a basic key under its lives_in section", () => {
    const groups = groupSettings([key()], [value()], "household");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("household.system");
    expect(groups[0]?.basic).toHaveLength(1);
    expect(groups[0]?.advanced).toHaveLength(0);
  });

  test("an advanced key goes to the advanced list, unfolded under three", () => {
    const groups = groupSettings(
      [key({ key: "household.retention", level: "advanced" })],
      [value({ key: "household.retention" })],
      "household",
    );
    expect(groups[0]?.advanced).toHaveLength(1);
    expect(groups[0]?.foldAdvanced).toBe(false);
  });

  test("three or more advanced keys in one section fold", () => {
    const keys = ["a", "b", "c"].map((k) => key({ key: `household.${k}`, level: "advanced" }));
    const values = ["a", "b", "c"].map((k) => value({ key: `household.${k}` }));
    const groups = groupSettings(keys, values, "household");
    expect(groups[0]?.advanced).toHaveLength(3);
    expect(groups[0]?.foldAdvanced).toBe(true);
  });

  test("expert-level keys are filtered out entirely", () => {
    const groups = groupSettings(
      [key({ key: "household.dev", level: "expert" })],
      [value({ key: "household.dev" })],
      "household",
    );
    expect(groups).toHaveLength(0);
  });

  test("a key not honoured by home is filtered out", () => {
    const groups = groupSettings(
      [key({ key: "bot.only", honoured_by: ["bot"] })],
      [value({ key: "bot.only" })],
      "household",
    );
    expect(groups).toHaveLength(0);
  });

  test("a key from a different scope kind is filtered out", () => {
    const groups = groupSettings([key({ scope: "person" })], [value()], "household");
    expect(groups).toHaveLength(0);
  });

  test("a registry key with no resolved value is skipped, not fabricated", () => {
    const groups = groupSettings([key()], [], "household");
    expect(groups).toHaveLength(0);
  });
});

describe("sectionTitle", () => {
  test("known section ids get a human title", () => {
    expect(sectionTitle("household.system")).toBe("System");
  });

  test("unknown section ids fall back to the raw id", () => {
    expect(sectionTitle("some.new.package")).toBe("some.new.package");
  });
});
