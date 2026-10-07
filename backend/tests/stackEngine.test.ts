import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests, getStackClient, isStackRoleEnabled, getHomeOwnedRoles, recordStackChatIdentity, getActiveChatEngineIdentity, type StackRole } from "@/lib/stackEngine";

const roles: StackRole[] = ["chat", "embeddings", "stt", "tts"];

beforeEach(() => { resetDb(); __setStackClientForTests(null); });
afterEach(() => __resetStackEngineForTests());

describe("Stack role routing", () => {
  test("a configured Stack serves every role regardless of stored switches", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    for (const role of roles) expect(isStackRoleEnabled(role)).toBe(true);
    setHouseholdSettingValue("engines.stack.url", "");
    expect(isStackRoleEnabled("chat")).toBe(false);
  });

  test("a test client enables every role regardless of stored switches", () => {
    __setStackClientForTests({} as never);
    for (const role of roles) expect(isStackRoleEnabled(role)).toBe(true);
  });

  test("Stack chat identity is active whenever the Stack is configured", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    const identity = { host: "local" as const, build: "test", model: "chat-model", healthy: true };
    recordStackChatIdentity(identity);
    expect(getActiveChatEngineIdentity()).toEqual(identity);
    expect(getActiveChatEngineIdentity()).toEqual(identity);
  });

  test("a cleared test client cannot resolve the household Stack URL into a network client", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    expect(() => getStackClient()).toThrow("backend tests must inject a Stack fixture");
  });

});

describe("computer memory role ownership", () => {
  test("reports no Home-owned roles", () => {
    expect(getHomeOwnedRoles()).toEqual([]);
  });
});
