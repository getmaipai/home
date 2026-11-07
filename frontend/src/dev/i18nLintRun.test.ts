import { expect, test } from "bun:test";
import { baselineProblems, i18nFindings } from "./i18nLints";

const baseline = { "fixture.tsx": 1 };
const allow = [{ file: "fixture.tsx", text: "MaiPai", reason: "Product name." }];
test("planted strings fail; allowlisted name passes", () => {
  expect(i18nFindings("", { "fixture.tsx": `<button>Save</button><input placeholder="Search" />\ntoast.success("Saved");` }).length).toBe(3);
  expect(i18nFindings("", { "fixture.tsx": `<span>MaiPai</span>` }, allow)).toEqual([]);
  expect(baselineProblems([{ file: "fixture.tsx", line: 1, text: "Save" }, { file: "fixture.tsx", line: 1, text: "Search" }], baseline).length).toBe(1);
});
