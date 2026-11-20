import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { metricNames } from "../src/metrics";

test("every metric the session writes is on the whitelist, so no number is silently dropped from the turn record", () => {
  const src = readFileSync(new URL("../src/session.ts", import.meta.url), "utf8");
  const names = new Set<string>();
  for (const m of src.matchAll(/this\.metrics\.([a-z_0-9]+)\s*(?:\?\?=|=(?!=))/g)) names.add(m[1]!);
  for (const m of src.matchAll(/\bm\.([a-z_0-9]+)\s*(?:\?\?=|=(?!=))/g)) names.add(m[1]!);
  for (const m of src.matchAll(/\[\["underruns", "page_underruns"\][^\]]*\]\]/g)) for (const n of m[0].matchAll(/"(page_[a-z_]+)"/g)) names.add(n[1]!);
  const missing = [...names].filter((n) => !metricNames.has(n));
  expect(missing).toEqual([]);
});
