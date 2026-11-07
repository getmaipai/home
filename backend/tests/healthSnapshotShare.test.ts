// AUDIT-PERF-01 item 1: N tabs and the status sampler cost one health snapshot, and one snapshot costs one Stack role-list read.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { __resetMakingHealthForTests } from "@/lib/roleHealth";
import { collectHealth, __resetChatPauseTrackingForTests } from "@/lib/healthSnapshot";

let rolesCalls = 0;
let codingCalls = 0;
let chatState = "ready";
function stack() {
  __setStackClientForTests({
    roles: async () => { rolesCalls++; return { roles: ["chat", "judge", "embed", "tts", "stt", "image", "video"].map((id) => ({ id, state: { state: id === "chat" ? chatState : "ready" } })) }; },
    memory: async () => ({ watchdog: { generation_paused: false } }),
    getCodingMode: async () => { codingCalls++; return { mode: "normal", target: "normal", state: "stable" }; },
  } as never);
}
beforeEach(() => { resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770"); rolesCalls = 0; codingCalls = 0; chatState = "ready"; stack(); __resetMakingHealthForTests(); __resetChatPauseTrackingForTests(); });
afterEach(() => { __resetStackEngineForTests(); __resetMakingHealthForTests(); __resetChatPauseTrackingForTests(); });

describe("health snapshot sharing (AUDIT-PERF-01)", () => {
  test("three concurrent snapshots make one roles() request and one coding-mode request", async () => {
    const [a, b, c] = await Promise.all([collectHealth(), collectHealth(), collectHealth()]);
    expect(rolesCalls).toBe(1);
    expect(codingCalls).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test("a later snapshot within 2 s is the same one; a change after 2 s is seen", async () => {
    const realNow = Date.now;
    const t0 = realNow();
    try {
      Date.now = () => t0;
      expect((await collectHealth()).engines.chat.availability).toBe("ready");
      chatState = "notInstalled";
      Date.now = () => t0 + 1_000;
      expect((await collectHealth()).engines.chat.availability).toBe("ready");
      expect(rolesCalls).toBe(1);
      Date.now = () => t0 + 2_500;
      expect((await collectHealth()).engines.chat.availability).toBe("unavailable");
      expect(rolesCalls).toBe(2);
    } finally { Date.now = realNow; }
  });
});
