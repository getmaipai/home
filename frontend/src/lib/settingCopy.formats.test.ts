import { test, expect } from "bun:test";
import { activateLocale } from "../i18n";
import { SETTING_COPY } from "./settingCopy.generated";
test("every generated id formats in every locale", async () => {
  for (const loc of ["en-GB", "es", "en-US"]) {
    await activateLocale(loc);
    const bad: string[] = [];
    for (const [id, v] of Object.entries(SETTING_COPY)) { try { v.t(); } catch { bad.push(id); } }
    expect(bad).toEqual([]);
  }
});
