import { expect, test } from "bun:test";
import { getRegistry } from "@/lib/settingsRegistry";

test("retired Talk before I finish keys are absent from Home's settings registry", () => {
  const keys = getRegistry().map((entry) => entry.key);
  expect(keys).not.toContain("voice.talk_over");
  expect(keys).not.toContain("voice.talk_over_window_ms");
});
