import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue, getHouseholdSettingValue, getHouseholdSettingSource } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests, backfillStackRoleSettings, isStackRoleEnabled, recordStackChatIdentity, getActiveChatEngineIdentity, type StackRole } from "@/lib/stackEngine";

const roles: StackRole[] = ["chat", "embeddings", "stt", "tts"];

beforeEach(() => resetDb());
afterEach(() => __resetStackEngineForTests());

describe("Stack role switches", () => {
  test("require an address and an explicitly true role setting", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    for (const role of roles) expect(isStackRoleEnabled(role)).toBe(false);
    for (const role of roles) {
      setHouseholdSettingValue(`engines.stack.use_${role}`, true);
      expect(isStackRoleEnabled(role)).toBe(true);
    }
    setHouseholdSettingValue("engines.stack.url", "");
    expect(isStackRoleEnabled("chat")).toBe(false);
  });

  test("a test client enables every role regardless of stored switches", () => {
    __setStackClientForTests({} as never);
    for (const role of roles) expect(isStackRoleEnabled(role)).toBe(true);
  });

  test("Stack chat identity is active only while chat is routed through the Stack", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    const identity = { host: "local" as const, build: "test", model: "chat-model", healthy: true };
    recordStackChatIdentity(identity);
    expect(getActiveChatEngineIdentity()).not.toEqual(identity);
    setHouseholdSettingValue("engines.stack.use_chat", true);
    expect(getActiveChatEngineIdentity()).toEqual(identity);
  });
});

describe("existing Stack role switch backfill", () => {
  test("a configured URL with no stored role settings turns every role on once", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    backfillStackRoleSettings();
    for (const role of roles) {
      expect(getHouseholdSettingValue(`engines.stack.use_${role}`)).toBe(true);
      expect(getHouseholdSettingSource(`engines.stack.use_${role}`)).toBe("user");
    }
    backfillStackRoleSettings();
    for (const role of roles) expect(getHouseholdSettingValue(`engines.stack.use_${role}`)).toBe(true);
  });

  test("any explicitly stored role value, including false, leaves all four untouched", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    setHouseholdSettingValue("engines.stack.use_chat", false);
    backfillStackRoleSettings();
    expect(getHouseholdSettingValue("engines.stack.use_chat")).toBe(false);
    for (const role of roles.slice(1)) expect(getHouseholdSettingSource(`engines.stack.use_${role}`)).toBeUndefined();
  });

  test("an empty URL changes nothing", () => {
    setHouseholdSettingValue("engines.stack.url", "");
    backfillStackRoleSettings();
    for (const role of roles) expect(getHouseholdSettingSource(`engines.stack.use_${role}`)).toBeUndefined();
  });
});
