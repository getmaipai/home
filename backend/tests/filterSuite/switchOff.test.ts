import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { __setListsReadyForTests } from "@/lib/blocklists/listStore";
import { setHouseholdSettingValue } from "@/lib/settings";
import { buildAdapter, PASS_THROUGH, TODAY_CHECKS } from "./adapter";
import { CASES } from "./cases";

describe("switch-off coverage", () => {
  beforeAll(() => { setHouseholdSettingValue("search.blocklists", ["blp-porn"]); __setListsReadyForTests(false); });
  afterAll(() => __setListsReadyForTests(null));
  for (const key of Object.keys(TODAY_CHECKS) as Array<keyof typeof TODAY_CHECKS>) {
    test(`switching off ${key} is caught by ${CASES.filter((c) => c.input.check === key && c.expect === "held").length} cases`, () => {
      __setListsReadyForTests(false);
      const altered = { ...TODAY_CHECKS, [key]: PASS_THROUGH[key] } as typeof TODAY_CHECKS;
      const adapter = buildAdapter(altered);
      const flipped = CASES.find((c) => c.input.check === key && c.expect === "held" && (
        c.point === "list" ? adapter.filterList(c).length > 0 :
          (c.point === "request" ? adapter.checkRequest(c) : adapter.release(c)) === "released"
      ));
      expect(flipped, `no recorded case caught ${key}`).toBeDefined();
      if (flipped) console.log(`switch-off ${key}: ${flipped.id}`);
    });
  }
});
