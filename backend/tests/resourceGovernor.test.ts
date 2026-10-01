import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { getChatClient, restartChatBackend, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import {
  startResourceGovernor,
  __setGovernorTuningForTestsOnly,
  __resetGovernorTuningForTests,
  __stopAllGovernorsForTests,
} from "@/lib/resourceGovernor";
import { listIssues, __resetFixHandlersForTests } from "@/lib/issues";
import { resetDb } from "./reset-db";

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetLlmSupervisorForTests();
  // Fast enough to reach a sustained breach in well under a second, and a
  // much smaller absolute overage floor than production's 500MB - a real
  // test fixture holding half a gigabyte of ballast just to cross that
  // floor would make these tests slow and heavy for no added confidence
  // over a smaller real allocation crossing a smaller real floor.
  __setGovernorTuningForTestsOnly({
    pollMs: 100,
    systemSustainedPolls: 2,
    processSustainedPolls: 2,
    processMinOverageBytes: 10_000_000, // 10MB
  });
});

afterEach(async () => {
  __stopAllGovernorsForTests();
  await __resetLlmSupervisorForTests();
  __resetGovernorTuningForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_BIN;
  delete process.env.MAIPAI_CHAT_MODEL_PATH;
  delete process.env.FAKE_LLAMA_INFLATE_MB;
});

describe("resourceGovernor: tier-2 override wiring", () => {
  test("chat cannot start a Home-owned process even when developer overrides are present", async () => {
    process.env.MAIPAI_LLAMA_SERVER_BIN = "/does/not/matter";
    process.env.MAIPAI_CHAT_MODEL_PATH = "/does/not/matter.gguf";
    await expect(getChatClient()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
    await expect(restartChatBackend()).rejects.toThrow("Home runs chat through the MaiPai Stack.");
  });
});
