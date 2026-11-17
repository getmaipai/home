import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { __setListsReadyForTests } from "@/lib/blocklists/listStore";
import { __resetHostIndexForTests } from "@/lib/blocklists/hostLists";
import { blockListsDir } from "@/lib/paths";
import { setHouseholdSettingValue } from "@/lib/settings";
import { buildAdapter } from "./adapter";
import { CASES } from "./cases";

const adapter = buildAdapter();
// `false` means "use the real gate", so a list another test file left loaded in the shared lists folder (tests/hostLists.test.ts does) would
// make `search-url-block` and `search-host-block` read a ready list that does not name their host. Start from an empty folder.
beforeAll(() => { rmSync(blockListsDir, { recursive: true, force: true }); __resetHostIndexForTests(); setHouseholdSettingValue("search.blocklists", ["blp-porn"]); __setListsReadyForTests(false); });
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
