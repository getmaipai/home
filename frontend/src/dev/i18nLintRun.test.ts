import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { baselineProblems, formatCallFindings, i18nFindings, type Baseline } from "./i18nLints";

const baseline = { "fixture.tsx": 1 };
const allow = [{ file: "fixture.tsx", text: "MaiPai", reason: "Product name." }];
test("planted strings fail; allowlisted name passes", () => {
  expect(i18nFindings("", { "fixture.tsx": `<button>Save</button><input placeholder="Search" />\ntoast.success("Saved");` }).length).toBe(3);
  expect(i18nFindings("", { "fixture.tsx": `<span>MaiPai</span>` }, allow)).toEqual([]);
  expect(baselineProblems([{ file: "fixture.tsx", line: 1, text: "Save" }, { file: "fixture.tsx", line: 1, text: "Search" }], baseline).length).toBe(1);
});

const SRC = fileURLToPath(new URL("..", import.meta.url));
const formatBaseline = JSON.parse(readFileSync(new URL("./i18n-format-baseline.json", import.meta.url), "utf8")) as Baseline;

test("a planted toLocaleDateString, toLocaleString or Intl call fails the format lint; lib/format.ts and types are exempt", () => {
  expect(formatCallFindings("", { "x.ts": `const a = new Date().toLocaleDateString();` }).length).toBe(1);
  expect(formatCallFindings("", { "x.tsx": `const a = (5).toLocaleString("es"); const b = new Intl.NumberFormat("es"); const c = Intl.DateTimeFormat();` }).length).toBe(3);
  expect(formatCallFindings("", { "lib/format.ts": `new Intl.DateTimeFormat("es")` })).toEqual([]);
  expect(formatCallFindings("", { "x.ts": `export const o: Intl.DateTimeFormatOptions = {}; const t = "a".toLocaleLowerCase();` })).toEqual([]);
});

test("the shipped source has no formatting call outside lib/format.ts beyond the shrink-only baseline", () => {
  expect(baselineProblems(formatCallFindings(SRC), formatBaseline)).toEqual([]);
});
