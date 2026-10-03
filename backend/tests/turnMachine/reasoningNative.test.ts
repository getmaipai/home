// THIN-5A (docs/design/RULES.md rule 2): the engine's reasoning_content
// travels as its own field from the engine client to the gate. Nothing
// wraps it into <think> tags and nothing splits it out again by regex on
// the default path; a minor's request sets thinking off and any reasoning
// the engine returns anyway is dropped at the engine client.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { complete, startCompleteStreamPieces, type LlmStreamPiece } from "@/lib/llm";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function withEngine<T>(
  script: { reasoning: string | undefined; reply: string },
  fn: (seen: ChatCompletionRequest[]) => Promise<T>,
): Promise<T> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen: ChatCompletionRequest[] = [];
  const stub = startStubLlmServer(0, {
    scriptedReasoning: (request) => { seen.push(request); return script.reasoning; },
    scriptedChatReply: () => script.reply,
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  __resetLlmSupervisorForTests();
  try {
    return await fn(seen);
  } finally {
    await stub.stop();
  }
}

async function drain(pieces: AsyncGenerator<LlmStreamPiece, unknown, void>): Promise<LlmStreamPiece[]> {
  const out: LlmStreamPiece[] = [];
  for (;;) {
    const step = await pieces.next();
    if (step.done) return out;
    out.push(step.value);
  }
}

describe("THIN-5A: the engine client carries reasoning as its own field", () => {
  test("a streamed reasoning_content arrives as reasoning pieces, with no think tag anywhere", async () => {
    const pieces = await withEngine({ reasoning: "carry the two", reply: "17 times 24 is 408." }, async () => {
      const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "what's 17 times 24" }], { thinking: true });
      if (!started.ok) throw new Error(started.error);
      return drain(started.pieces);
    });
    expect(pieces.filter((p) => p.channel === "reasoning").map((p) => p.text).join("")).toBe("carry the two");
    expect(pieces.filter((p) => p.channel === "text").map((p) => p.text).join("")).toBe("17 times 24 is 408.");
    expect(pieces.some((p) => /<\/?think>/i.test(p.text))).toBe(false);
  });

  test("a literal think tag inside reasoning_content stays reasoning text, never a boundary", async () => {
    const pieces = await withEngine({ reasoning: "the syntax </think> ends a block", reply: "Done." }, async () => {
      const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "hi" }], { thinking: true });
      if (!started.ok) throw new Error(started.error);
      return drain(started.pieces);
    });
    expect(pieces.filter((p) => p.channel === "reasoning").map((p) => p.text).join("")).toBe("the syntax </think> ends a block");
    expect(pieces.filter((p) => p.channel === "text").map((p) => p.text).join("")).toBe("Done.");
  });

  test("dropReasoning sets thinking off on the request and drops any reasoning the engine returns anyway", async () => {
    const { pieces, seen } = await withEngine({ reasoning: "secret scratch work", reply: "Hi there." }, async (seen) => {
      const started = await startCompleteStreamPieces("chat", [{ role: "user", content: "hi" }], { thinking: true, dropReasoning: true });
      if (!started.ok) throw new Error(started.error);
      return { pieces: await drain(started.pieces), seen };
    });
    expect(seen[0]?.chat_template_kwargs?.enable_thinking).toBe(false);
    expect(pieces.every((p) => p.channel === "text")).toBe(true);
    expect(pieces.map((p) => p.text).join("")).toBe("Hi there.");
    expect(JSON.stringify(seen[0])).not.toContain("dropReasoning");
  });

  test("complete() returns reasoning beside plain text, and dropReasoning removes it", async () => {
    const kept = await withEngine({ reasoning: "carry the two", reply: "408." }, () => complete("chat", [{ role: "user", content: "17 times 24" }], { thinking: true, returnReasoning: true }));
    expect(kept.ok && kept.value.text).toBe("408.");
    expect(kept.ok && kept.value.reasoning).toBe("carry the two");
    const dropped = await withEngine({ reasoning: "carry the two", reply: "408." }, () => complete("chat", [{ role: "user", content: "17 times 24" }], { returnReasoning: true, dropReasoning: true }));
    expect(dropped.ok && dropped.value.text).toBe("408.");
    expect(dropped.ok && dropped.value.reasoning).toBeUndefined();
    // A caller that did not ask for reasoning never gets it, so a route
    // that returns the value as-is cannot carry unchecked reasoning.
    const unasked = await withEngine({ reasoning: "carry the two", reply: "408." }, () => complete("chat", [{ role: "user", content: "17 times 24" }], { thinking: true }));
    expect(unasked.ok && unasked.value.reasoning).toBeUndefined();
  });
});

describe("THIN-5A: the default turn path keeps reasoning out of the reply and out of a minor's turn", () => {
  test("an adult's reasoning_content becomes TurnValue.reasoning and the reply holds only the answer", async () => {
    const result = await withEngine({ reasoning: "weigh the options", reply: "Go with the second one." }, () => runTurnNext(people.owner, "chat", "which one?", { thinking: true }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe("Go with the second one.");
    expect(result.value.reasoning).toBe("weigh the options");
  });

  test("a child's turn asks for no thinking, drops the engine's reasoning, and stores none", async () => {
    const { result, seen } = await withEngine({ reasoning: "weigh the options", reply: "Go with the second one." }, async (seen) => ({
      result: await runTurnNext(people.child, "chat", "which one?", { thinking: true }),
      seen,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) expect(request.chat_template_kwargs?.enable_thinking).toBe(false);
    expect(result.value.reasoning).toBeUndefined();
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    expect(JSON.stringify(row)).not.toContain("weigh the options");
  });
});
