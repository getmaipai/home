// Rule 6: an empty first reply on a plain written turn (seen live on Glimmer) is regenerated once before any fixed line.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { withStub } from "./turnMachine/toolHarness";
import type { TurnValue } from "@/wire";

let people: BenchPeople;
beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
});
afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

test("an empty first reply is retried once and the second reply is shown", async () => {
  let n = 0;
  await withStub({ calls: () => undefined, reply: () => (++n === 1 ? "" : "Paris is the capital of France.") }, async () => {
    const result = await runTurnNext(people.owner, "chat", "what is the capital of France");
    if (!result.ok) throw new Error("refused");
    expect((result.value as TurnValue).reply.text).toBe("Paris is the capital of France.");
    expect(n).toBe(2);
  });
});
