import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { listIssues } from "@/lib/issues";
import { STACK_REQUIREMENT_ISSUE, syncStackRequirementIssue } from "@/lib/stackRequirement";

beforeEach(() => resetDb());
afterEach(() => __resetStackEngineForTests());

describe("Stack requirement Repairs entry", () => {
  test("raises stack.not-configured when no Stack is configured", async () => {
    setHouseholdSettingValue("engines.stack.url", "");
    await syncStackRequirementIssue();
    expect(listIssues().find((issue) => issue.source === STACK_REQUIREMENT_ISSUE.source && issue.key === STACK_REQUIREMENT_ISSUE.key)).toMatchObject({
      severity: "error",
      title: "Home needs the MaiPai Stack",
      detail: "Home runs every model through the MaiPai Stack and none is set up on this computer. Install or start the Stack, then restart Home.",
    });
  });

  test("does not raise when a Stack URL is configured", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    await syncStackRequirementIssue();
    expect(listIssues().some((issue) => issue.key === STACK_REQUIREMENT_ISSUE.key)).toBe(false);
  });

  test("does not raise when a test client is installed", async () => {
    __setStackClientForTests({} as never);
    await syncStackRequirementIssue();
    expect(listIssues().some((issue) => issue.key === STACK_REQUIREMENT_ISSUE.key)).toBe(false);
  });
});
