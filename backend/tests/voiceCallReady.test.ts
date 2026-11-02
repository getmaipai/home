// A person who is not an admin reads the call gate from the health row (/api/health, signed-in only), not from the admin-only Engines routes.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { __resetMakingHealthForTests } from "@/lib/roleHealth";
import { collectHealth, __resetChatPauseTrackingForTests } from "@/lib/healthSnapshot";

type RoleRow = { id: string; state: { state: string } };
function stack(roles: RoleRow[], fail = false) {
  __setStackClientForTests({
    roles: async () => { if (fail) throw new Error("offline"); return { roles }; },
    memory: async () => ({ watchdog: { level: "normal", generation_paused: false } }),
    getCodingMode: async () => ({ mode: "normal", target: "normal", state: "stable" }),
  } as never);
}

beforeEach(() => { resetDb(); setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770"); __resetMakingHealthForTests(); __resetChatPauseTrackingForTests(); });
afterEach(() => { __resetStackEngineForTests(); __resetMakingHealthForTests(); });

test("voice_call_ready is true when listening and speaking are both installed, loaded or ready", async () => {
  stack([{ id: "stt", state: { state: "installed" } }, { id: "tts", state: { state: "ready" } }, { id: "chat", state: { state: "ready" } }]);
  expect((await collectHealth()).voice_call_ready).toBe(true);
});

test("voice_call_ready is false when speaking is missing, offline, or the Stack does not answer", async () => {
  stack([{ id: "stt", state: { state: "ready" } }]);
  expect((await collectHealth()).voice_call_ready).toBe(false);
  stack([{ id: "stt", state: { state: "ready" } }, { id: "tts", state: { state: "offline" } }]);
  expect((await collectHealth()).voice_call_ready).toBe(false);
  stack([], true);
  expect((await collectHealth()).voice_call_ready).toBe(false);
});
