import { expect, test } from "bun:test";
import { wallClockMinutes, wallClockParts } from "./wallClock";

test("wall clock uses the person's zone and falls back for an invalid stored zone", () => {
  const now = new Date("2026-11-06T05:30:00.000Z");
  expect(wallClockMinutes(now, "America/Chicago")).toBe(23 * 60 + 30);
  expect(wallClockParts(now, "not/a-zone").hour).toBe(wallClockParts(now).hour);
});

import { validateSelectorValue } from "@/lib/settings";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

test("time.time_zone is validated where it is set", () => {
  const zoneSetting = { key: "time.time_zone", selector: "text" } as unknown as SettingsKey;
  expect(validateSelectorValue(zoneSetting, "America/Chicago").ok).toBe(true);
  const bad = validateSelectorValue(zoneSetting, "Mars/Olympus");
  expect(bad.ok).toBe(false);
});
