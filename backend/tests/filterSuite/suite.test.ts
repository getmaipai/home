import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { __setListsReadyForTests } from "@/lib/blocklists/listStore";
import { setHouseholdSettingValue } from "@/lib/settings";
import { buildAdapter } from "./adapter";
import { CASES } from "./cases";

const adapter = buildAdapter();
beforeAll(() => { setHouseholdSettingValue("search.blocklists", ["blp-porn"]); __setListsReadyForTests(false); });
afterAll(() => __setListsReadyForTests(null));

describe("recorded child and teen protection cases", () => {
  for (const c of CASES) test(c.id, () => {
    __setListsReadyForTests(false);
    const outcome = c.point === "list"
      ? (adapter.filterList(c).length === 0 ? "held" : "released")
      : c.point === "request" ? adapter.checkRequest(c) : adapter.release(c);
    expect(outcome).toBe(c.expect);
  });
});
