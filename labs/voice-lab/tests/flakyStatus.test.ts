import { expect, test } from "bun:test";
import { flakyVerdict } from "../src/flakyStatus";
const ok = { at_ms: 2000, runs: 10, failures: [] };
test("ready refuses without a flaky run, with a failure, with too few runs, or when a test file is newer", () => {
  expect(flakyVerdict(null, 1000).ok).toBe(false);
  expect(flakyVerdict({ ...ok, failures: [{ name: "x", count: 1 }] }, 1000).why).toContain('"x" fail 1x');
  expect(flakyVerdict({ ...ok, runs: 2 }, 1000).ok).toBe(false);
  expect(flakyVerdict(ok, 3000).why).toContain("changed after");
  expect(flakyVerdict(ok, 1000).ok).toBe(true);
});
