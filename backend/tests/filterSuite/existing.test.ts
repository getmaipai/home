import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("existing safety test list is sorted, unique, and present", () => {
  const list = JSON.parse(readFileSync(new URL("./existing-tests.json", import.meta.url), "utf8")) as string[];
  expect(list).toEqual([...new Set(list)].sort());
  for (const path of list) expect(existsSync(resolve(import.meta.dir, "../..", path)), path).toBe(true);
});
