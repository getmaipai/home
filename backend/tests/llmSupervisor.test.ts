import { describe, expect, test, beforeEach } from "bun:test";
import { getChatClient, restartChatBackend, stopChatBackend } from "@/lib/llmSupervisor";
import { __setStackClientForTests, __resetStackEngineForTests, isStackConfigured } from "@/lib/stackEngine";
import { useDefaultScriptedStack } from "./stackFixture";

beforeEach(() => useDefaultScriptedStack());

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
});
