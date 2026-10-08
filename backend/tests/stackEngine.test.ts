import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests, getStackClient, isStackRoleEnabled, getHomeOwnedRoles, recordStackChatIdentity, getActiveChatEngineIdentity, type StackRole } from "@/lib/stackEngine";
import { __setEngineLinkForTests, EngineLink } from "@/lib/stack/link";
import { StackError } from "@/lib/stack/errors";
import { getDefaultScriptedStack } from "./stackFixture";

const roles: StackRole[] = ["chat", "embeddings", "stt", "tts"];

beforeEach(() => { resetDb(); __setStackClientForTests(null); });
afterEach(() => { __resetStackEngineForTests(); __setEngineLinkForTests(null); });

describe("Stack role routing", () => {
  test("a remote link that is down fails synchronously before any network call", () => {
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    let calls = 0;
    __setEngineLinkForTests(new EngineLink({ host: "engine.lan", privateKeyPath: "/key", knownHostsPath: "/known" }, { fetch: async () => { calls++; return new Response(); } }));
    const started = performance.now();
    let thrown: unknown;
    try { getStackClient(); } catch (error) { thrown = error; }
    expect(performance.now() - started).toBeLessThan(100);
    expect(thrown).toBeInstanceOf(StackError);
    expect(thrown).toMatchObject({ kind: "unreachable" });
    expect(calls).toBe(0);
  });

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

  test("a cleared test client resolves the scripted fixture instead of a network client", () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    expect(getStackClient()).toBe(getDefaultScriptedStack().client);
  });

});

describe("computer memory role ownership", () => {
  test("reports no Home-owned roles", () => {
    expect(getHomeOwnedRoles()).toEqual([]);
  });
});
