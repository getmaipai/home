import { afterEach, describe, expect, test } from "bun:test";
import { describeResourceDay, readResourceDay } from "@/lib/resourceDay";
import { restoreDefaultScriptedStack, startStackFixture } from "./stackFixture";
import type { StackDailyResources } from "@/lib/stack/types";

const blank = (date: string): StackDailyResources => ({
  date, chat_restarts_by_cause: {}, engine_stops_by_cause: {}, pauses: 0, resumes: 0,
  forced_resumes: 0, paused_seconds: 0, memory_actions: {}, shrinks: 0, restores: 0,
  survivors_stopped: 0, sweeps: { runs: 0, freed_bytes: 0 }, canary_restarts: 0,
});

afterEach(() => restoreDefaultScriptedStack());

describe("resource day summary", () => {
  test("describes yesterday's counts in plain words", () => {
    const yesterday = { ...blank("2026-10-30"), chat_restarts_by_cause: { "governor-runaway": 2, "model-load": 1 }, pauses: 2, forced_resumes: 1, shrinks: 1, survivors_stopped: 2, sweeps: { runs: 1, freed_bytes: 12 * 1024 ** 2 } };
    expect(describeResourceDay([blank("2026-10-31"), yesterday])).toEqual({ date: "2026-10-30", text: "Yesterday: chat restarted 3 times (most often because of memory growth); big jobs were paused 2 times for chat (1 cut short); chat made room for a video 1 time; 2 helper programs were stopped; clean-ups freed 12.0 MB." });
  });

  test("uses a quiet sentence when all counts are zero", () => {
    expect(describeResourceDay([blank("today"), blank("yesterday")])?.text).toBe("Yesterday: no chat restarts, pauses or clean-ups.");
  });

  test("uses singular wording and returns no summary without yesterday", () => {
    const yesterday = { ...blank("yesterday"), chat_restarts_by_cause: { "memory-watchdog": 1 }, pauses: 1, forced_resumes: 1, shrinks: 1, survivors_stopped: 1, sweeps: { runs: 1, freed_bytes: 1024 ** 3 } };
    expect(describeResourceDay([blank("today"), yesterday])?.text).toBe("Yesterday: chat restarted 1 time (most often because of low memory on this computer); big jobs were paused 1 time for chat (1 cut short); chat made room for a video 1 time; 1 helper program was stopped; clean-ups freed 1.0 GB.");
    expect(describeResourceDay([blank("today")])).toBeUndefined();
  });

  test("reads through the default Stack client", async () => {
    const day = { ...blank("yesterday"), pauses: 1 };
    const fixture = startStackFixture({
      "GET /stack/v1/memory/daily": () => Response.json({ days: [blank("today"), day] }),
    });
    // Only this test's client is swapped. Replacing the shared default fixture here (and stopping it below) left every later test file
    // with a dead default Stack, which broke llm, stackEngine, dashboard and the turn-failure tests in a full run.
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    __setStackClientForTests(fixture.client);
    expect(await readResourceDay()).toEqual({ date: "yesterday", text: "Yesterday: big jobs were paused 1 time for chat." });
    fixture.stop();
  });

  test("omits older clients and failures", async () => {
    const { __setStackClientForTests } = await import("@/lib/stackEngine");
    __setStackClientForTests({ memoryDaily: undefined } as never);
    expect(await readResourceDay()).toBeUndefined();
    __setStackClientForTests({ memoryDaily: async () => { throw new Error("offline"); } } as never);
    expect(await readResourceDay()).toBeUndefined();
    __setStackClientForTests(null);
  });
});
