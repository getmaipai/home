// ASSIST-BENCH-01: the held-off wider remind and timer schemas. The default must leave the manifest's args and
// description byte-identical; turning tools.assist.widened on swaps in args.widened.json; turning it off swaps back.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifestOnly } from "@/lib/plugins";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { ACTIONS_BY_TOOL } from "../scripts/bench/assistActions";
import { resetDb } from "./reset-db";

const PACKAGES = join(import.meta.dir, "..", "packages");
const onDisk = (id: string) => JSON.parse(readFileSync(join(PACKAGES, id, "manifest.json"), "utf-8")) as { args: unknown; description: string };
const widened = (id: string) => JSON.parse(readFileSync(join(PACKAGES, id, "args.widened.json"), "utf-8")) as { args: { properties: Record<string, { enum?: string[] }> }; description: string };

describe("tools.assist.widened", () => {
  beforeEach(() => resetDb());

  test("the key is a household boolean that defaults to off", () => {
    expect(getRegistry().find((entry) => entry.key === "tools.assist.widened")).toMatchObject({ scope: "household", selector: "boolean", default: false });
    expect(getHouseholdSettingValue("tools.assist.widened")).toBe(false);
  });

  for (const id of ["remind", "timer"]) {
    test(`${id}: the default leaves the manifest args and description byte-identical`, () => {
      const loaded = loadManifestOnly(id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const disk = onDisk(id);
      expect(JSON.stringify(loaded.value.args)).toBe(JSON.stringify(disk.args));
      expect(loaded.value.description).toBe(disk.description);
    });

    test(`${id}: turning it on swaps the widened args in, and off swaps them back`, () => {
      expect(setHouseholdSettingValue("tools.assist.widened", true).ok).toBe(true);
      const on = loadManifestOnly(id);
      expect(on.ok && JSON.stringify(on.value.args)).toBe(JSON.stringify(widened(id).args));
      expect(on.ok && on.value.description).toBe(widened(id).description);
      expect(setHouseholdSettingValue("tools.assist.widened", false).ok).toBe(true);
      const off = loadManifestOnly(id);
      expect(off.ok && JSON.stringify(off.value.args)).toBe(JSON.stringify(onDisk(id).args));
    });

    test(`${id}: the widened action list is exactly the bench's action list`, () => {
      const listed = widened(id).args.properties.action?.enum ?? [];
      expect([...listed].sort()).toEqual([...ACTIONS_BY_TOOL[id as "remind" | "timer"]].sort());
    });
  }

  test("another package's manifest is untouched while it is on", () => {
    setHouseholdSettingValue("tools.assist.widened", true);
    const weather = loadManifestOnly("weather");
    expect(weather.ok && JSON.stringify(weather.value.args)).toBe(JSON.stringify(onDisk("weather").args));
  });

  test("the first property stays expression, which the command matcher binds a wildcard to", () => {
    for (const id of ["remind", "timer"]) expect(Object.keys(widened(id).args.properties)[0]).toBe("expression");
  });
});
