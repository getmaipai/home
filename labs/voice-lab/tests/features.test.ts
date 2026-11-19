import { expect, test } from "bun:test";
import { decideBackchannel, isBackchannel } from "../src/backchannel";
import { runTool } from "../src/tools";
import { delayFor } from "../src/netSim";
test("backchannel decision ignores punctuation and case but rejects stop words", () => {
  expect(isBackchannel("MM-HM!")).toBe(true); expect(isBackchannel("yeah, okay")).toBe(true);
  expect(isBackchannel("wait")).toBe(false); expect(isBackchannel("no")).toBe(false); expect(decideBackchannel("")).toBe("unknown");
});
test("tool outputs use local time zones and a search that says it is not connected", async () => {
  expect(await runTool({ name: "get_time", arguments: { place: "nonesuch" } })).toBe("unknown place");
  expect((await runTool({ name: "web_search", arguments: { query: "x" } }, 0)).toLowerCase()).toContain("not connected");
});
test("network delay uses each send time and preserves message order", () => {
  const delays = [0, 1, 2, 3].map((index) => delayFor(index, { delayMs: 80, jitterMs: 30, burstEveryMs: 0, burstStallMs: 0 }));
  expect(delays.every((delay) => delay >= 0)).toBe(true);
  expect(delays).toEqual([50, 110, 50, 110]);
});
