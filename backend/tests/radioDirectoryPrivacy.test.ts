import { afterEach, beforeEach, expect, test } from "bun:test";
import { privacyConnections } from "@/lib/privacy";
import { setHouseholdSettingValue } from "@/lib/settings";
import { resetDb } from "./reset-db";

beforeEach(async () => { await resetDb(); });
// The switch defaults to on (spec 0.1.267); each test starts from off and turns it on itself.
beforeEach(() => setHouseholdSettingValue("radio.directory.enabled", false));
afterEach(() => setHouseholdSettingValue("radio.directory.enabled", false));

test("RADIO-02: the privacy table lists the radio directory only while the switch is on", () => {
  expect(privacyConnections().some((row) => row.id === "platform:radio-directory")).toBe(false);
  setHouseholdSettingValue("radio.directory.enabled", true);
  const row = privacyConnections().find((item) => item.id === "platform:radio-directory");
  expect(row?.destination).toContain("radio-browser.info");
});
