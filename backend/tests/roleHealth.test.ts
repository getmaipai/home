import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { createStackClient } from "@/lib/stack/client";
import { startStubStackRolesServer } from "@maipai/spec/stack/ts/stubServer.js";
import { chatContextStatus, roleHealth, __setChatWindowContextForTests, chatWindowContext, MINIMUM_CHAT_WINDOW_TOKENS } from "@/lib/roleHealth";

beforeEach(() => resetDb());
afterEach(() => { __resetStackEngineForTests(); __setChatWindowContextForTests(undefined); });

function client(roles: Array<{ id: string; state: { state: string; reason?: string | null }; reason?: string | null }>, fail = false) {
  __setStackClientForTests({ roles: async () => { if (fail) throw new Error("offline"); return { roles }; } } as never);
}

describe("roleHealth", () => {
  test("Stack role context resolves to the per-slot chat window", () => {
    expect(chatContextStatus({ context_length: 4096, slots: 1, context_per_slot: 4096 })).toMatchObject({ contextLength: 4096, slots: 1, contextPerSlot: 4096, contextScope: "per_slot" });
    expect(chatContextStatus({ context_length: 40960, slots: 1, context_per_slot: 40960 })).toMatchObject({ contextPerSlot: 40960 });
    expect(chatContextStatus({ context_length: 40960, slots: 2, context_per_slot: 20480 })).toMatchObject({ contextPerSlot: 20480, slots: 2 });
    expect(chatContextStatus({})).toEqual({});
  });

  test("missing context uses the named minimum and status gives its reason", async () => {
    __setChatWindowContextForTests();
    expect(await chatWindowContext()).toEqual({ tokens: MINIMUM_CHAT_WINDOW_TOKENS, slots: null, reported: false });
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{ id: "chat", state: { state: "ready" } }]);
    const { collectHealth } = await import("@/lib/healthSnapshot");
    expect((await collectHealth()).engines.chat.context_message).toBe("I could not read how much the AI can hold, so I am using a safe small window");
  });

  test("Stack-owned chat uses the Stack role state", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{ id: "chat", state: { state: "offline", reason: "model crashed" }, reason: "model crashed" }]);
    expect(await roleHealth("chat")).toMatchObject({ availability: "unavailable", reason: "model crashed" });
  });

  test("Stack fetch failure makes owned roles unavailable with stack unreachable reason", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([], true);
    expect(await roleHealth("chat")).toEqual({ availability: "unavailable", reason: "stack_unreachable" });
  });

  test("Stack ready is operational for chat and embeddings", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{ id: "chat", state: { state: "ready", reason: null }, reason: null }]);
    expect(await roleHealth("chat")).toEqual({ availability: "ready", reason: null });
    expect(await roleHealth("embed")).toMatchObject({ availability: expect.any(String) });
  });

  test("live Stack chat health carries reported context and slots", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{ id: "chat", state: { state: "ready" }, context_length: 40960, slots: 2, context_per_slot: 20480 } as never]);
    expect(await roleHealth("chat")).toMatchObject({ contextLength: 40960, slots: 2, contextPerSlot: 20480, contextScope: "per_slot" });
  });

  test("flat Stack role context reaches the chat window as a per-slot figure", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    const stub = startStubStackRolesServer(0);
    __setStackClientForTests(createStackClient({ baseUrl: stub.url }));
    try {
      expect(await chatWindowContext()).toMatchObject({ tokens: 20480, slots: 2, reported: true });
    } finally {
      stub.stop();
    }
  });

  test("a total context figure never replaces a missing per-slot figure", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    client([{
      id: "chat",
      state: { state: "ready" },
      context_length: 40960,
      context_per_slot: null,
      context_total: 81920,
      slots: 2,
      context_scope: "total across slots",
    } as never]);
    expect(await chatWindowContext()).toMatchObject({ tokens: MINIMUM_CHAT_WINDOW_TOKENS, slots: 2, reported: false });
  });

  test("Stack installed and idle loaded roles are available on demand, while active loading stays degraded", async () => {
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
    setHouseholdSettingValue("engines.stack.use_tts", true);
    client([{ id: "tts", state: { state: "installed" } }]);
    expect(await roleHealth("voice")).toEqual({ availability: "ready", reason: null });

    setHouseholdSettingValue("engines.stack.use_chat", true);
    client([{ id: "chat", state: { state: "loaded", reason: "No request through the public route in the last hour." } }]);
    expect(await roleHealth("chat")).toEqual({ availability: "ready", reason: null });

    client([{ id: "chat", state: { state: "loaded" } }]);
    expect(await roleHealth("chat")).toEqual({ availability: "starting", reason: null });
  });
});
