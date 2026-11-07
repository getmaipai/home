import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getChatClient, restartChatBackend, stopChatBackend, __setBlockedPortRetryForTests, __setBlockedPortRetryIntervalForTests, startBlockedPortRetryForTests, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setStackClientForTests, __resetStackEngineForTests, isStackConfigured } from "@/lib/stackEngine";
import { useDefaultScriptedStack } from "./stackFixture";

beforeEach(() => useDefaultScriptedStack());
afterEach(() => __resetLlmSupervisorForTests());

describe("Home chat engine is sealed", () => {
  test("getChatClient refuses to spawn or download a Home chat engine", async () => {
    await expect(getChatClient()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
  });

  test("restart and stop entry points refuse Home-owned model changes", async () => {
    await expect(restartChatBackend()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
    await expect(stopChatBackend()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
  });

  test("the seal holds with and without a configured Stack", async () => {
    expect(isStackConfigured()).toBe(true);
    await expect(getChatClient()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
    __setStackClientForTests(null);
    __resetStackEngineForTests();
    __setStackClientForTests(null);
    expect(isStackConfigured()).toBe(false);
    await expect(getChatClient()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
  });

  test("blocked-port retry ticks do not overlap an in-flight retry", async () => {
    let calls = 0;
    let release!: () => void;
    __setBlockedPortRetryIntervalForTests(5);
    __setBlockedPortRetryForTests(() => { calls++; return new Promise<void>((resolve) => { release = resolve; }); });
    startBlockedPortRetryForTests();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(1);
    release();
  });
});
