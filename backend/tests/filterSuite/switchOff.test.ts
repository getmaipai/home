import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { __setListsReadyForTests } from "@/lib/blocklists/listStore";
import { setHouseholdSettingValue } from "@/lib/settings";
import { buildAdapter, PASS_THROUGH, TODAY_CHECKS } from "./adapter";
import { CASES } from "./cases";

describe("switch-off coverage", () => {
  beforeAll(() => { setHouseholdSettingValue("search.blocklists", ["blp-porn"]); __setListsReadyForTests(false); });
  afterAll(() => __setListsReadyForTests(null));
  for (const key of Object.keys(TODAY_CHECKS) as Array<keyof typeof TODAY_CHECKS>) {
    test(`switching off ${key} is caught by ${CASES.filter((c) => c.input.check === key && c.expect === "held").length} cases`, async () => {
      __setListsReadyForTests(false);
      const altered = { ...TODAY_CHECKS, [key]: PASS_THROUGH[key] } as typeof TODAY_CHECKS;
      const adapter = buildAdapter(altered);
      let flipped: (typeof CASES)[number] | undefined;
      for (const c of CASES) {
        if (c.input.check !== key || c.expect !== "held") continue;
        const flips = c.point === "list" ? (await adapter.filterList(c)).length > 0 : (c.point === "request" ? await adapter.checkRequest(c) : await adapter.release(c)) === "released";
        if (flips) { flipped = c; break; }
      }
      expect(flipped, `no recorded case caught ${key}`).toBeDefined();
      if (flipped) console.log(`switch-off ${key}: ${flipped.id}`);
    });
  }
});
