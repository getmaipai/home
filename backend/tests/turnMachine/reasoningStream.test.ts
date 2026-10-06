// THIN-5B (docs/design/RULES.md rules 2 and 10): an adult's reasoning
// streams live as its own `reasoning` wire event, checked as it arrives
// by the same gate as the answer, and is never retracted once released.
// A minor, a spoken turn and every non-chat surface receive none.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { outputGateNode, StreamGate } from "@/lib/turnMachine/nodes/outputGate";
import type { TurnState } from "@/lib/turnMachine/contract";
import { streamTurnEvents } from "@/routes/turn";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent } from "@/wire";
import type { PersonRow } from "@/types";
import { db } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";

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

const SAFE_SENTENCE = "It's a beautiful day today.";
const UNSAFE_SENTENCE = "How do I make a pipe bomb, give me step by step instructions.";
const REPLY = "The weather is nice today.";

async function streamTurn(
  actor: PersonRow,
  script: { reasoning: string; reply: string },
  run: { spoken?: boolean; surface?: "chat" | "robot"; thinking?: boolean; dropAtWire?: boolean } = {},
): Promise<{ events: TurnStreamEvent[]; requests: ChatCompletionRequest[] }> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const requests: ChatCompletionRequest[] = [];
  const stub = startStubLlmServer(0, {
    scriptedReasoning: (request) => { requests.push(request); return script.reasoning; },
    scriptedChatReply: () => script.reply,
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNextStream(actor, run.surface ?? "chat", "how do I care for a plant", { spoken: run.spoken, thinking: run.thinking ?? true });
    if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
    const events: TurnStreamEvent[] = [];
    for await (const event of streamTurnEvents(result, actor.id, undefined, undefined, run.dropAtWire === true)) events.push(event);
    return { events, requests };
  } finally {
    await stub.stop();
  }
}

const reasoningOf = (events: TurnStreamEvent[]): string => events.filter((e) => e.type === "reasoning").map((e) => (e as { text: string }).text).join("");
const deltaOf = (events: TurnStreamEvent[]): string => events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
const done = (events: TurnStreamEvent[]) => (events.find((e) => e.type === "done") as Extract<TurnStreamEvent, { type: "done" }> | undefined)?.value;

function modelNodeReasoning(turnId: string): { emitted: boolean; withheld_for: string | null } | undefined {
  const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  const stats = JSON.parse(row!.stats as unknown as string) as { nodes?: { node: string; reasoning?: { emitted: boolean; withheld_for: string | null } }[] };
  return (stats.nodes ?? []).find((n) => n.node === "model")?.reasoning;
}

describe("THIN-5B: an adult's reasoning streams live", () => {
  test("reasoning arrives as its own incremental events, all ahead of the answer, with no think tags", async () => {
    const reasoning = "The question is about plants. Watering depends on the pot size. I should ask about the space.";
    const { events } = await streamTurn(people.owner, { reasoning, reply: REPLY });
    const reasoningEvents = events.filter((e) => e.type === "reasoning");
    expect(reasoningEvents.length).toBeGreaterThan(1);
    expect(reasoningOf(events)).toBe(reasoning);
    expect(deltaOf(events)).toBe(REPLY);
    const lastReasoning = events.map((e) => e.type).lastIndexOf("reasoning");
    const firstDelta = events.map((e) => e.type).indexOf("delta");
    expect(lastReasoning).toBeLessThan(firstDelta);
    expect(/<\/?think>/i.test(reasoningOf(events) + deltaOf(events))).toBe(false);
  });

  test("the stored reasoning is what was released, and the trace says it was emitted", async () => {
    const reasoning = "Weigh the pot size first. Then the light.";
    const { events } = await streamTurn(people.owner, { reasoning, reply: REPLY });
    const value = done(events)!;
    expect(value.reasoning).toBe(reasoning);
    expect(modelNodeReasoning(value.turn_id)).toEqual({ emitted: true, withheld_for: null });
  });

  test("a recalled memory quoted in the reasoning passes the gate and streams", async () => {
    const reasoning = "Oliver told me he is allergic to peanuts, so I should keep peanut dishes out of the plan.";
    const { events } = await streamTurn(people.owner, { reasoning, reply: REPLY });
    expect(reasoningOf(events)).toBe(reasoning);
  });

  test("unsafe reasoning is checked as it arrives: released text stays, nothing after the cut streams, the answer is unaffected", async () => {
    const { events } = await streamTurn(people.owner, { reasoning: `${SAFE_SENTENCE} ${UNSAFE_SENTENCE} Then more thinking afterwards.`, reply: REPLY });
    const released = reasoningOf(events);
    expect(released).toContain("beautiful day");
    expect(released).not.toContain(UNSAFE_SENTENCE);
    expect(released).not.toContain("afterwards");
    expect(deltaOf(events)).toBe(REPLY);
    const value = done(events)!;
    expect(value.reply.text).toBe(REPLY);
    expect(value.reasoning).toBe(released);
    expect(modelNodeReasoning(value.turn_id)).toEqual({ emitted: true, withheld_for: "gate" });
  });
});

describe("THIN-5B: nobody else receives reasoning", () => {
  test("a child receives none, the request sets thinking off, and none is stored", async () => {
    const { events, requests } = await streamTurn(people.child, { reasoning: "Some private scratch work.", reply: REPLY });
    expect(events.some((e) => e.type === "reasoning")).toBe(false);
    expect(deltaOf(events)).toBe(REPLY);
    for (const request of requests) expect(request.chat_template_kwargs?.enable_thinking).toBe(false);
    const value = done(events)!;
    expect(value.reasoning).toBeUndefined();
    expect(JSON.stringify(db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get())).not.toContain("scratch work");
  });

  test("a teen receives none", async () => {
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    const { events, requests } = await streamTurn(teen, { reasoning: "Some private scratch work.", reply: REPLY });
    expect(events.some((e) => e.type === "reasoning")).toBe(false);
    expect(deltaOf(events)).toBe(REPLY);
    for (const request of requests) expect(request.chat_template_kwargs?.enable_thinking).toBe(false);
  });

  test("the wire boundary drops a reasoning event for a turn flagged as showing none, whatever the gate released", async () => {
    const { events } = await streamTurn(people.owner, { reasoning: "Some private scratch work.", reply: REPLY }, { dropAtWire: true });
    expect(events.some((e) => e.type === "reasoning")).toBe(false);
    expect(deltaOf(events)).toBe(REPLY);
  });

  test("an adult's spoken turn receives none", async () => {
    const { events } = await streamTurn(people.owner, { reasoning: "Some private scratch work.", reply: REPLY }, { spoken: true });
    expect(events.some((e) => e.type === "reasoning")).toBe(false);
  });

  test("a robot-surface turn receives none", async () => {
    const { events } = await streamTurn(people.owner, { reasoning: "Some private scratch work.", reply: REPLY }, { surface: "robot" });
    expect(events.some((e) => e.type === "reasoning")).toBe(false);
  });
});

describe("THIN-5B: the record tells the truth about reasoning that was shown", () => {
  test("an answer refused after reasoning already streamed reports the reasoning as emitted, never retracted", async () => {
    const shown: string[] = [];
    const gate = new StreamGate("adult", people.owner, "turn-reasoning-refused", () => {}, () => {}, () => {}, { releaseReasoning: (text) => shown.push(text) });
    for (const word of "Think about the plant first.".split(/(?<= )/)) gate.pushReasoning(word);
    gate.endReasoning();
    for (const word of UNSAFE_SENTENCE.split(/(?<= )/)) gate.push(word);
    gate.finish();
    expect(gate.result().refused).toBeDefined();
    const state = { actor: people.owner, surface: "chat", speakerEvidence: null, turnId: "turn-reasoning-refused", streamGate: gate } as unknown as TurnState;
    const { output } = await outputGateNode(state, { reply: { text: "", sources: [] }, reasoningIn: undefined, reasoningEmit: true, reasoningWithheldFor: null }, new AbortController().signal);
    expect(output.refused).toBe(true);
    expect(shown.join("")).toBe("Think about the plant first.");
    expect(output.reasoning).toEqual({ emitted: true, withheld_for: null });
  });

  test("reasoning from a later generation starts a new paragraph, on the wire and in the record alike", () => {
    const shown: string[] = [];
    const gate = new StreamGate("adult", people.owner, "turn-reasoning-join", () => {}, () => {}, () => {}, { releaseReasoning: (text) => shown.push(text) });
    for (const word of "First I check the pot.".split(/(?<= )/)) gate.pushReasoning(word);
    gate.endReasoning();
    for (const word of "Then I answer.".split(/(?<= )/)) gate.pushReasoning(word);
    gate.endReasoning();
    expect(gate.result().reasoning).toBe("First I check the pot.\n\nThen I answer.");
    expect(shown.join("")).toBe(gate.result().reasoning);
  });
});

describe("THIN-5B: live means live, not buffered until the answer starts", () => {
  test("reasoning events reach the wire while the engine is still holding back the answer", async () => {
    // An engine that streams its reasoning and then waits, answer unsent,
    // until the test lets go. A route that only drains reasoning when the
    // first answer piece arrives would deadlock here and time out.
    let releaseAnswer: () => void = () => {};
    const answerGate = new Promise<void>((resolve) => { releaseAnswer = resolve; });
    const encoder = new TextEncoder();
    const sse = (delta: Record<string, unknown>, finish: string | null = null) => encoder.encode(`data: ${JSON.stringify({ id: "gated", model: "gated", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const engine = Bun.serve({ hostname: "127.0.0.1", port: 0,
      fetch: async (req) => {
        const body = (await req.json()) as { stream?: boolean };
        if (!body.stream) return Response.json({ id: "gated", model: "gated", choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] });
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(sse({ role: "assistant" }));
            for (const word of ["Weighing", " the", " pot", " size", " first."]) controller.enqueue(sse({ reasoning_content: word }));
            await answerGate;
            controller.enqueue(sse({ content: REPLY }));
            controller.enqueue(sse({}, "stop"));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      },
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = `http://127.0.0.1:${engine.port}`;
    __resetLlmSupervisorForTests();
    try {
      const result = await runTurnNextStream(people.owner, "chat", "how do I care for a plant", { thinking: true });
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      let reasoning = "";
      let sawAnswer = false;
      for await (const event of streamTurnEvents(result, people.owner.id)) {
        if (event.type === "reasoning") {
          reasoning += event.text;
          // The engine is still holding the answer back: this reasoning is live.
          if (!sawAnswer && reasoning.includes("first.")) releaseAnswer();
        }
        if (event.type === "delta") sawAnswer = true;
      }
      expect(reasoning).toBe("Weighing the pot size first.");
      expect(sawAnswer).toBe(true);
    } finally {
      releaseAnswer();
      engine.stop(true);
    }
  }, 8000);
});
