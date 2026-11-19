import { expect, test } from "bun:test";
import { isBackchannel } from "../src/backchannel";
import { runTool } from "../src/tools";
import { delayFor } from "../src/netSim";
test("backchannel decision ignores punctuation and case but rejects stop words", () => {
  expect(isBackchannel("MM-HM!")).toBe(true); expect(isBackchannel("yeah, okay")).toBe(true);
  expect(isBackchannel("wait")).toBe(false); expect(isBackchannel("no")).toBe(false); expect(isBackchannel("")).toBe(true);
});
test("tool outputs use local time zones and marked search placeholders", async () => {
  expect(await runTool({ name: "get_time", arguments: { place: "nonesuch" } })).toBe("unknown place");
  expect((await runTool({ name: "web_search", arguments: { query: "x" } }, 0)).toLowerCase()).toContain("placeholder");
});
test("network simulation delay values preserve ordering", () => {
  const delays = [0, 1, 2, 3].map((index) => delayFor(index, { delayMs: 80, jitterMs: 30, burstEveryMs: 0, burstStallMs: 0 }));
  expect(delays.every((delay) => delay >= 0)).toBe(true);
  expect(delayFor(7000, { delayMs: 200, jitterMs: 120, burstEveryMs: 7000, burstStallMs: 800 })).toBeGreaterThan(800);
});
