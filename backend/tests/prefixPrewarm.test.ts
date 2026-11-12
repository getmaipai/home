import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { __resetPrefixPrewarmForTests, abortConversationPrewarm, notePrefix, prewarmConversation, prewarmPrefix, prewarmPrefixHit, rewarmConversation, warmSpokenPrefixAtBoot } from "@/lib/prefixPrewarm";
import * as llm from "@/lib/llm";

beforeEach(() => { __resetPrefixPrewarmForTests(); });

describe("prefix prewarm", () => {
  test("a person with no recorded prefix sends nothing", async () => {
    expect(await prewarmPrefix("person-a", "spoken", 100_000)).toBe(false);
  });

  test("only a leading system message is recorded", async () => {
    notePrefix("person-a", "spoken", [{ role: "user", content: "hi" }], [], undefined, 100_000);
    expect(await prewarmPrefix("person-a", "spoken", 200_000)).toBe(false);
  });

  test("a second request inside the gap sends nothing", async () => {
    notePrefix("person-a", "spoken", [{ role: "system", content: "You are a helper." }], [], undefined, 100_000);
    await prewarmPrefix("person-a", "spoken", 200_000);
    expect(await prewarmPrefix("person-a", "spoken", 205_000)).toBe(false);
  });

  test("prefixes are kept per person and per surface class", async () => {
    notePrefix("person-a", "written", [{ role: "system", content: "x" }], [], undefined, 100_000);
    expect(await prewarmPrefix("person-a", "spoken", 200_000)).toBe(false);
    expect(await prewarmPrefix("person-b", "written", 200_000)).toBe(false);
  });

  test("the boot warm-up builds the default spoken prompt and keeps trying while the engine is not up", async () => {
    let built = 0;
    warmSpokenPrefixAtBoot(async () => { built++; return { system: "You are a helper.", tools: [] }; }, 2, 5, 5);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(built).toBeGreaterThanOrEqual(1);
  });

  test("conversation warm sends recorded system then the shared raw conversation window", async () => {
    const complete = spyOn(llm, "complete").mockResolvedValue({ ok: true, value: { text: "", model: "model-a" } });
    const tools = [{ type: "function", function: { name: "tool", description: "", parameters: { type: "object", properties: {} } } }] as never;
    notePrefix("person-a", "spoken", [{ role: "system", content: "recorded system" }], tools, "model-a");
    await prewarmConversation("person-a", "spoken", [
      { role: "user", content: "what is raw user text" },
      { role: "assistant", content: "Here is the spoken reply." },
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![1]).toEqual([
      { role: "system", content: "recorded system" },
      { role: "user", content: "what is raw user text" },
      { role: "assistant", content: "Here is the spoken reply." },
    ]);
    expect(JSON.stringify(complete.mock.calls[0]![1])).not.toContain("Context for this turn");
    expect(complete.mock.calls[0]![2]).toMatchObject({ model: "model-a", max_tokens: 1, exactCeiling: true, thinking: false, dropReasoning: true });
    complete.mockRestore();
  });

  test("a new turn aborts a conversation warm, and a second warm for that actor is skipped", async () => {
    let observed: AbortSignal | undefined;
    let release!: (value: Awaited<ReturnType<typeof llm.complete>>) => void;
    const complete = spyOn(llm, "complete").mockImplementation((_role, _messages, opts) => {
      observed = opts?.signal;
      return new Promise((resolve) => { release = resolve; });
    });
    notePrefix("person-a", "spoken", [{ role: "system", content: "system" }], []);
    const running = prewarmConversation("person-a", "spoken", [{ role: "user", content: "raw" }, { role: "assistant", content: "reply" }]);
    await Promise.resolve();
    expect(observed?.aborted).toBe(false);
    expect(await prewarmConversation("person-a", "spoken", [{ role: "user", content: "other" }])).toBe(false);
    abortConversationPrewarm("person-a");
    expect(observed?.aborted).toBe(true);
    release({ ok: false, status: 503, code: "unavailable", error: "cancelled" });
    await running;
    complete.mockRestore();
  });

  // CONVO-PREWARM-03: the engine resumes only from a whole earlier request, so the next turn must extend the warm byte for byte.
  test("the next turn's first request extends the conversation warm, and a changed window names the part that differs", async () => {
    const complete = spyOn(llm, "complete").mockResolvedValue({ ok: true, value: { text: "", model: "model-a" } });
    const system = { role: "system" as const, content: "recorded system" };
    notePrefix("person-a", "spoken", [system], [], "model-a");
    const window = [{ role: "user" as const, content: "what is raw user text" }, { role: "assistant" as const, content: "Here is the spoken reply." }];
    expect(prewarmPrefixHit("conv-1", [system, ...window, { role: "user", content: "next words" }], [])).toEqual({ warmed: false, hit: false, first_diff: null });
    await prewarmConversation("person-a", "spoken", async () => window, "conv-1");
    expect(prewarmPrefixHit("conv-1", [system, ...window, { role: "user", content: "Context for this turn: next words" }], [])).toEqual({ warmed: true, hit: true, first_diff: null });
    // A fold rewrote the summary into the system message and dropped the oldest turn: the engine would read the whole window again.
    expect(prewarmPrefixHit("conv-1", [{ role: "system", content: "recorded system\n\nSummary: cats" }, window[1]!, { role: "user", content: "next words" }], [])).toEqual({ warmed: true, hit: false, first_diff: "message 0 (system)" });
    expect(prewarmPrefixHit("conv-1", [system, window[0]!, { role: "assistant", content: "A different reply." }, { role: "user", content: "next words" }], [])).toEqual({ warmed: true, hit: false, first_diff: "message 2 (assistant)" });
    complete.mockRestore();
  });

  test("a fold warms the conversation again from its kept builder, and only when the window changed", async () => {
    const complete = spyOn(llm, "complete").mockResolvedValue({ ok: true, value: { text: "", model: "model-a" } });
    const system = { role: "system" as const, content: "recorded system" };
    notePrefix("person-a", "spoken", [system], [], "model-a");
    let window: Array<{ role: "system" | "user" | "assistant"; content: string }> = [{ role: "user", content: "first words" }, { role: "assistant", content: "First reply." }];
    await prewarmConversation("person-a", "spoken", async () => window, "conv-2");
    expect(complete).toHaveBeenCalledTimes(1);
    // Nothing changed: no second request.
    expect(await rewarmConversation("conv-2", () => false)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    // The fold stored a summary line ahead of the newest turns.
    window = [{ role: "system", content: "Summary so far: greetings." }, { role: "assistant", content: "First reply." }];
    expect(await rewarmConversation("conv-2", () => false)).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![1]).toEqual([system, ...window]);
    expect(prewarmPrefixHit("conv-2", [system, ...window, { role: "user", content: "next words" }], [])).toMatchObject({ hit: true });
    // A turn in flight is never raced by a warm.
    window = [{ role: "assistant", content: "Changed again." }];
    expect(await rewarmConversation("conv-2", () => true)).toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
    complete.mockRestore();
  });

  test("written turns never send a conversation warm", async () => {
    const complete = spyOn(llm, "complete");
    notePrefix("person-a", "written", [{ role: "system", content: "system" }], []);
    expect(await prewarmConversation("person-a", "written", [{ role: "user", content: "written words" }])).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    complete.mockRestore();
  });
});
