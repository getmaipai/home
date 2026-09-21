import { describe, expect, test } from "bun:test";
import { sectionTitle } from "../../../commons-tags/ui-ui-v0.5.19/ui/src/settings/groupSettings";
import { getRegistry } from "@/lib/settingsRegistry";

describe("settings section titles", () => {
  test("every registry lives_in has a friendly section title (SET-TITLES-01)", () => {
    for (const key of getRegistry()) {
      expect(sectionTitle(key.lives_in)).not.toBe(key.lives_in);
    }
  });
});
