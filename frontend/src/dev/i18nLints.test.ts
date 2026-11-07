import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { baselineProblems, i18nFindings, type Baseline } from "./i18nLints";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const baseline = JSON.parse(readFileSync(new URL("./i18n-baseline.json", import.meta.url), "utf8")) as Baseline;
const allowlist = JSON.parse(readFileSync(new URL("./i18n-allowlist.json", import.meta.url), "utf8")) as { file: string; text: string; reason: string }[];

describe("i18n lint", () => {
  test("catches JSX, props, and toast strings", () => {
    const findings = i18nFindings(SRC, { "fixture.tsx": `<button>Save</button><input placeholder="Search" />\ntoast.success("Saved");` });
    expect(findings.map((finding) => finding.text)).toEqual(["Save", "Search", "Saved"]);
  });
  test("allows Trans text and reasoned allowlist entries", () => {
    expect(i18nFindings(SRC, { "fixture.tsx": `<Trans id="Save" message="Save" /><span>MaiPai</span>` }, [{ file: "fixture.tsx", text: "MaiPai", reason: "Product name." }])).toEqual([]);
  });
  test("an allowlist entry without a reason does not excuse the string", () => {
    expect(i18nFindings(SRC, { "fixture.tsx": `<span>MaiPai</span>` }, [{ file: "fixture.tsx", text: "MaiPai", reason: " " }]).length).toBe(1);
  });
  test("setError text is caught; attributes that are not copy, numbers and glyphs are not", () => {
    expect(i18nFindings(SRC, { "fixture.tsx": `setError("Could not save");` }).map((f) => f.text)).toEqual(["Could not save"]);
    expect(i18nFindings(SRC, { "fixture.tsx": `<div className="flex items-center" id="main-panel" data-testid="x">12</div>` })).toEqual([]);
  });
  test("every allowlist entry carries a reason", () => {
    for (const entry of allowlist) expect(entry.reason.trim().length).toBeGreaterThan(0);
  });
  test("baseline only shrinks by removing the fixed file's entry", () => {
    expect(baselineProblems([{ file: "a.tsx", line: 1, text: "Hello" }], { "a.tsx": 2 })).toEqual(["a.tsx shrank from 2 to 1; shrink its baseline"]);
    expect(baselineProblems([{ file: "new.tsx", line: 1, text: "Hello" }], {})).toEqual(["new.tsx has 1 hardcoded strings and is not in the baseline"]);
  });
  test("current frontend does not exceed its per-file baseline", () => {
    expect(baselineProblems(i18nFindings(SRC, undefined, allowlist), baseline)).toEqual([]);
  });
});
