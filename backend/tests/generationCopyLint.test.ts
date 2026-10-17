import { describe, expect, test } from "bun:test";
import { getRegistry } from "@/lib/settingsRegistry";
import { lintSettingCopy } from "@maipai/spec/interpreters/ts/describeSetting.js";

// The kid lane, video quality and keep-warm settings pass COPY-LINT-01 so the spec can carry them.
describe("generation and health settings copy", () => {
  const keys = getRegistry().filter((key) => key.key.startsWith("generation.kid") || key.key === "generation.video_quality" || key.key === "health.keep_warm");

  test("every key is present and its copy passes the lint with no baseline", () => {
    expect(keys.map((k) => k.key).sort()).toEqual(["generation.kid_enabled", "generation.kids", "generation.kids_daily_pictures", "generation.kids_daily_videos", "generation.video_quality", "health.keep_warm"]);
    expect(lintSettingCopy(keys, [])).toEqual([]);
  });
});
