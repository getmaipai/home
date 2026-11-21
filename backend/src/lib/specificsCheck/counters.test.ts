import { describe, expect, test } from "bun:test";
import { __resetSpecificsCheckCountersForTests, bumpSpecificsCheckCounter, specificsCheckCounters } from "./counters";

describe("specifics-check counters", () => {
  test("uses a closed list and returns counts only", () => {
    __resetSpecificsCheckCountersForTests();
    bumpSpecificsCheckCounter("checked");
    bumpSpecificsCheckCounter("flagged");
    bumpSpecificsCheckCounter("invented" as never);
    expect(specificsCheckCounters()).toEqual({ "specifics_check.checked": 1, "specifics_check.flagged": 1 });
  });
});
