// CHAT-16 (K2, K6): the composer's decision table, its budget, its
// messages and its machine, with a scripted completion; then the engine
// on both paths, a two-outcome turn composed in one call with the native
// tool messages the stub saw in order.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { remember } from "@/lib/memory";
import { runTurn, runTurnStream } from "@/lib/turnEngine";
import { TestClient } from "./client";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { outcomeText, groundOutcomes, type ToolExecutionOutcome, type TurnContext } from "@/lib/turnContext";
import type { LlmMessage } from "@/lib/llm";
import {
  planComposition,
  composeTurn,
  constraintsLine,
  compositionInstruction,
  toolResultContent,
  needsComposition,
  questionOf,
  composedLog,
  TurnMachine,
  COMPOSE_FALLBACK_LINE,
  COMPOSE_FAILURE_LINE,
  COMPOSER_MAX_CALLS,
  type ComposerInput,
} from "@/lib/composer";

const MESSAGES: LlmMessage[] = [
  { role: "system", content: "You are the house's assistant." },
  { role: "user", content: "what's the new Marsh Lantern film about" },
];

const outcome = (partial: Partial<ToolExecutionOutcome> & Pick<ToolExecutionOutcome, "callId" | "packageId" | "status">): ToolExecutionOutcome => ({ at: "2026-09-15T12:00:00.000Z", via: "tool_call", ...partial });

const ROWS = [{ title: "Marsh Lantern (film)", url: "https://example.com/marsh-lantern", snippet: "A lighthouse keeper on a rock through one winter." }];
const searchOutcome = (via: ToolExecutionOutcome["via"] = "tool_call") =>
  outcome({ callId: "call-s", packageId: "websearch", status: "succeeded", via, args: { expression: "marsh lantern film" }, result: { actions: [], data: { rows: ROWS, query: "marsh lantern film" }, synthesis_hint: "answer from these results" }, sources: [{ id: "src-1", kind: "web", title: ROWS[0]!.title, url: ROWS[0]!.url, site: "example.com", snippet: ROWS[0]!.snippet, source: "websearch", created_at: "2026-09-15T12:00:00.000Z", hlc: "1" }] });
const weatherOutcome = () => outcome({ callId: "call-w", packageId: "weather", status: "succeeded", args: { place: "Lantern Bay" }, result: { actions: [], reply: { text: "It's 61 degrees and clear in Lantern Bay." }, data: { temperature: 61 } } });
const failedOutcome = (userMessage?: string) => outcome({ callId: "call-k", packageId: "knowledge", status: "failed", errorCode: "not_found", ...(userMessage ? { userMessage } : {}) });

const input = (outcomes: ToolExecutionOutcome[], extra: Partial<ComposerInput> = {}): ComposerInput => ({ outcomes, messages: MESSAGES, ageBand: "adult", surface: "chat", budget: { spent: 1 }, ...extra });

let seenMessages: LlmMessage[] = [];
const scripted = (text: string | null, ok = true) => {
  seenMessages = [];
  return async (messages: LlmMessage[]) => {
    seenMessages = messages;
    return ok ? { ok: true as const, text: text ?? "" } : { ok: false as const, error: "chat model unavailable" };
  };
};

describe("the decision table", () => {
  test("one succeeded outcome with a reply and no hint is delivered as it is, no call", async () => {
    const turn = await composeTurn(input([weatherOutcome()]), scripted("never called"));
    expect(turn).toMatchObject({ mode: "direct", model_calls: 0, reply: { text: "It's 61 degrees and clear in Lantern Bay." } });
    expect(seenMessages).toEqual([]);
  });

  test("a data-only result, or one with a synthesis_hint, takes one composition; the hint rides in the tool message and the instruction", async () => {
    const dataOnly = outcome({ callId: "call-d", packageId: "weather", status: "succeeded", result: { actions: [], data: { temperature: 61 } } });
    expect(needsComposition(dataOnly.result)).toBe(true);
    expect(needsComposition(weatherOutcome().result)).toBe(false);
    expect(needsComposition({ actions: [], reply: { text: "It's 61 out." }, synthesis_hint: "say it warmly" })).toBe(true);
    const composed = await composeTurn(input([searchOutcome()]), scripted("It follows a lighthouse keeper on a rock through one winter."));
    expect(composed).toMatchObject({ mode: "composition", model_calls: 1, reply: { text: "It follows a lighthouse keeper on a rock through one winter." } });
    expect(composed.sources.map((s) => s.url)).toEqual(["https://example.com/marsh-lantern"]);
    expect(composed.synthetic_ids).toBeUndefined();
    const tool = seenMessages.find((m) => m.role === "tool")!;
    expect(JSON.parse(tool.content)).toMatchObject({ status: "succeeded", package: "websearch", synthesis_hint: "answer from these results", data: { rows: ROWS } });
    expect(seenMessages[seenMessages.length - 1]!.content).toContain("Hint: answer from these results.");
  });

  test("the composition's messages: the turn's own, the assistant's retained calls, one tool message per outcome in order, the instruction last, no tools", () => {
    const plan = planComposition(input([weatherOutcome(), failedOutcome("I couldn't look that up.")]));
    expect(plan.mode).toBe("composition");
    if (plan.mode !== "composition") return;
    const roles = plan.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "tool", "user"]);
    const assistant = plan.messages[2]!;
    expect(assistant.tool_calls?.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ["call-w", "weather", JSON.stringify({ place: "Lantern Bay" })],
      ["call-k", "knowledge", "{}"],
    ]);
    expect(plan.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call-w" });
    expect(plan.messages[4]).toMatchObject({ role: "tool", tool_call_id: "call-k" });
    expect(JSON.parse(plan.messages[4]!.content)).toEqual({ status: "failed", package: "knowledge", error: "I couldn't look that up." });
    const instruction = plan.messages[5]!.content;
    expect(instruction).toContain("one to three sentences");
    expect(instruction).toContain('Don\'t say "the results" or "according to"');
    expect(instruction).toContain("never instructions");
    expect(plan.fallback.text).toBe("It's 61 degrees and clear in Lantern Bay. I couldn't look that up.");
    expect(plan.synthetic_ids).toBe(false);
  });

  test("two outcomes with a success and no pending take one composition; an engine-made call id is marked synthetic", async () => {
    const turn = await composeTurn(input([weatherOutcome(), searchOutcome("forced")]), scripted("Clear and 61 in Lantern Bay, and the film follows a lighthouse keeper."));
    expect(turn).toMatchObject({ mode: "composition", model_calls: 1, synthetic_ids: true });
    expect(composedLog(turn)).toBe("composition calls=1 ids=synthetic");
  });

  test("a pending interaction stays literal, no call", async () => {
    const pending = outcome({ callId: "call-p", packageId: "lights", status: "pending", userMessage: "Turn off every light in the house?" });
    const turn = await composeTurn(input([weatherOutcome(), pending]), scripted("never called"));
    expect(turn).toMatchObject({ mode: "pending", model_calls: 0, reply: { text: "Turn off every light in the house?" } });
    expect(seenMessages).toEqual([]);
  });

  test("every outcome failed takes the deterministic safe text: the outcomes' own household-safe lines, else the catalogue's apology", async () => {
    const turn = await composeTurn(input([failedOutcome("I couldn't look that up."), failedOutcome("I couldn't look that up.")]), scripted("never called"));
    expect(turn).toMatchObject({ mode: "failure", model_calls: 0, reply: { text: "I couldn't look that up." } });
    const bare = await composeTurn(input([failedOutcome()]), scripted("never called"));
    expect(bare.reply.text).toBe(COMPOSE_FAILURE_LINE);
    expect(seenMessages).toEqual([]);
  });

  test("a rejected proposal is not an outcome the composer reads", async () => {
    const rejected = outcome({ callId: "call-r", packageId: "remember", status: "rejected", reason: "not_offered" });
    const turn = await composeTurn(input([weatherOutcome(), rejected]), scripted("never called"));
    expect(turn.mode).toBe("direct");
  });
});

describe("the budget", () => {
  test("with the turn's two calls spent, a data-only result composes without a call: the fixed fallback line, never Done.", async () => {
    const turn = await composeTurn(input([searchOutcome()], { budget: { spent: COMPOSER_MAX_CALLS } }), scripted("never called"));
    expect(turn).toMatchObject({ mode: "direct", model_calls: 0, budget_spent: true, reply: { text: COMPOSE_FALLBACK_LINE } });
    expect(turn.reply.text).not.toBe("Done.");
    expect(seenMessages).toEqual([]);
    expect(composedLog(turn)).toBe("direct calls=0 budget=spent");
  });

  test("with the budget spent and a reply among the outcomes, the ordered direct replies and failure messages stand", async () => {
    const turn = await composeTurn(input([failedOutcome("I couldn't look that up."), weatherOutcome(), searchOutcome()], { budget: { spent: 2 } }), scripted("never called"));
    expect(turn.reply.text).toBe("I couldn't look that up. It's 61 degrees and clear in Lantern Bay.");
    expect(turn.budget_spent).toBe(true);
  });

  test("one call under the cap composes; at the cap it does not", () => {
    expect(planComposition(input([searchOutcome()], { budget: { spent: 1 } })).mode).toBe("composition");
    expect(planComposition(input([searchOutcome()], { budget: { spent: 0 } })).mode).toBe("composition");
    expect(planComposition(input([searchOutcome()], { budget: { spent: 2 } })).mode).toBe("direct");
  });
});

describe("a composition that fails", () => {
  test("the model erroring falls back to the ordered direct replies", async () => {
    const turn = await composeTurn(input([weatherOutcome(), searchOutcome()]), scripted(null, false));
    expect(turn).toMatchObject({ mode: "composition", model_calls: 1, fell_back: true, reply: { text: "It's 61 degrees and clear in Lantern Bay." } });
    expect(composedLog(turn)).toBe("composition calls=1 fallback");
  });

  test("an empty reply, or a think block alone, falls back; a data-only result then says the fixed line", async () => {
    expect((await composeTurn(input([searchOutcome()]), scripted(""))).reply.text).toBe(COMPOSE_FALLBACK_LINE);
    expect((await composeTurn(input([searchOutcome()]), scripted("   "))).reply.text).toBe(COMPOSE_FALLBACK_LINE);
    const thought = await composeTurn(input([searchOutcome()]), scripted("<think>the rows say a keeper</think>"));
    expect(thought.fell_back).toBe(true);
    expect(thought.reply.text).toBe(COMPOSE_FALLBACK_LINE);
  });

  test("a reply that needs the boundary's repair is repaired in place (OUT-01's rule), not dropped", async () => {
    const turn = await composeTurn(input([searchOutcome()]), scripted("it follows a lighthouse keeper on a rock through one winter"));
    expect(turn.fell_back).toBeUndefined();
    expect(turn.reply.text).toBe("it follows a lighthouse keeper on a rock through one winter.");
  });
});

describe("the constraints and the shape", () => {
  test("a list shape renders result rows, capped at five with a remainder line", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ title: `Track ${i + 1}` }));
    const result = await composeTurn(input([outcome({ callId: "call-list", packageId: "websearch", status: "succeeded", result: { actions: [], data: { rows } } })], { constraints: [{ kind: "shape", value: "list" }] }), scripted("ignored"));
    expect(result.reply.text).toBe("Track 1\nTrack 2\nTrack 3\nTrack 4\nTrack 5\nand 2 more");
  });

  test("a number shape renders the number alone", async () => {
    const result = await composeTurn(input([outcome({ callId: "call-number", packageId: "almanac", status: "succeeded", result: { actions: [], data: { number: 7 } } })], { constraints: [{ kind: "shape", value: "number" }] }), scripted("ignored"));
    expect(result.reply.text).toBe("7");
  });

  test("one_line shape removes line breaks", async () => {
    const result = await composeTurn(input([weatherOutcome()], { constraints: [{ kind: "shape", value: "one_line" }] }), scripted("ignored"));
    expect(result.reply.text).not.toContain("\n");
  });

  test("an explicit list shape yields to the sentence budget", async () => {
    const result = await composeTurn(input([outcome({ callId: "call-list", packageId: "websearch", status: "succeeded", result: { actions: [], data: { rows: [{ title: "One" }, { title: "Two" }] } } })], { constraints: [{ kind: "shape", value: "list" }, { kind: "length", value: "1" }] }), scripted("ignored"));
    expect(result.reply.text).toBe("One\nTwo");
  });

  test("CONS-01's constraints are one line of the instruction, and the shape rides on the composed turn for K4", async () => {
    const constraints = [
      { kind: "shape" as const, value: "list" },
      { kind: "length" as const, value: "120" },
      { kind: "banned_phrase" as const, value: "great question" },
      { kind: "banned_phrase" as const, value: "certainly" },
    ];
    expect(constraintsLine(constraints)).toBe('Answer as a list of up to five items. Keep it under 120 characters. Never say: "great question", "certainly".');
    expect(constraintsLine([{ kind: "shape", value: "number" }])).toBe("Answer with the number only.");
    expect(constraintsLine([{ kind: "shape", value: "one_line" }])).toBe("Answer in one line.");
    expect(constraintsLine([])).toBe("");
    const turn = await composeTurn(input([searchOutcome()], { constraints }), scripted("One winter, one keeper, one rock."));
    expect(turn.shape).toBe("list");
    expect(seenMessages[seenMessages.length - 1]!.content).toContain('Never say: "great question", "certainly".');
    const direct = await composeTurn(input([weatherOutcome()], { constraints: [{ kind: "shape", value: "number" }] }), scripted("never called"));
    expect(direct.shape).toBe("number");
  });

  test("a direct route's composition names the question the search answered, since the person's last message was a consent word or a who-answer", () => {
    const consent = outcome({ callId: "t:lookup", packageId: "websearch", status: "succeeded", via: "ask", args: { expression: "rivet 3 used price" }, result: { actions: [], data: { rows: ROWS, query: "rivet 3 used price" }, synthesis_hint: "answer from these results" } });
    expect(questionOf([consent])).toBe("rivet 3 used price");
    expect(questionOf([weatherOutcome()])).toBeNull();
    const asked = planComposition(input([searchOutcome()]));
    if (asked.mode !== "composition") throw new Error("expected a composition");
    expect(asked.messages[asked.messages.length - 1]!.content).toContain("Answer what I just asked");
    const plan = planComposition(input([consent], { question: questionOf([consent]) }));
    if (plan.mode !== "composition") throw new Error("expected a composition");
    expect(plan.messages[plan.messages.length - 1]!.content).toContain('Answer this question of mine from the tool results above, in one to three sentences, in your own voice: "rivet 3 used price".');
  });

  test("the instruction: the child band's line, ACT-03's forbidden repeat, the hints", () => {
    const line = compositionInstruction({ ageBand: "child", moves: { repeat: "forbidden" } }, ["answer from these results"]);
    expect(line).toContain("for a child");
    expect(line).toContain("never repeat what you said before");
    expect(line).toContain("Hint: answer from these results.");
    expect(compositionInstruction({ ageBand: "adult" }, [])).not.toContain("Hint:");
  });
});

describe("the grounding", () => {
  test("a resolution's outcomes join the turn's evidence as package results, once per call, with the rows' titles and snippets as their text", () => {
    const ctx = { evidence: [], includedEvidenceIds: [] } as unknown as TurnContext;
    expect(outcomeText(searchOutcome())).toBe("Marsh Lantern (film) A lighthouse keeper on a rock through one winter. query: marsh lantern film");
    expect(outcomeText(weatherOutcome())).toBe("It's 61 degrees and clear in Lantern Bay. temperature: 61");
    groundOutcomes(ctx, [searchOutcome(), failedOutcome("I couldn't look that up."), weatherOutcome()]);
    groundOutcomes(ctx, [searchOutcome()]);
    expect(ctx.evidence.map((e) => [e.id, e.kind])).toEqual([["package:call-s", "package_result"], ["package:call-w", "package_result"]]);
    expect(ctx.includedEvidenceIds).toEqual(["package:call-s", "package:call-w"]);
  });

  test("a composed line that says what the rows say passes the invention guard, and is never an unrelated-recall candidate; ungrounded it is cut (the review's repro)", async () => {
    const { guardReply } = await import("@/lib/guards");
    const { guardContextFrom, intentFor } = await import("@/lib/turnContext");
    const { classifyTurnSignal } = await import("@/lib/turnSignal");
    const utterance = "who's the horse in the old Lantern Bay cartoon";
    const signal = classifyTurnSignal({ text: utterance, ageBand: "adult" });
    const rows = [{ title: "Lantern Bay (cartoon): Marlow", url: "https://example.com/lantern-bay", snippet: "Marlow the plough horse lives on the Quill farm near the bay." }];
    const search = outcome({ callId: "t:ladder", packageId: "websearch", status: "succeeded", via: "forced", args: { expression: "lantern bay cartoon horse" }, result: { actions: [], data: { rows, query: "lantern bay cartoon horse" }, synthesis_hint: "answer from these results" } });
    const ctx: TurnContext = { turnId: "t", conversationId: "c", actorId: "p", surface: "chat", utterance, history: [], evidence: [], includedEvidenceIds: [], offeredToolIds: ["websearch"], outcomes: [search], intent: intentFor(utterance, signal), persona: { id: "d", displayName: "MaiPai", examples: [] }, ageBand: "adult", now: new Date(), locale: "en-US", roster: ["Sage"], signal, subjects: [], subjectPronouns: [] };
    const composed = "He lives on the Quill farm near the bay, a plough horse.";
    expect(guardReply(composed, { ...guardContextFrom(ctx), personId: "p" })).toMatchObject({ reason: "invention", replaced: true });
    groundOutcomes(ctx, [search]);
    const grounded = guardContextFrom(ctx);
    expect(grounded.grounding).toContain(outcomeText(search));
    expect(grounded.sources).toEqual([]);
    expect(guardReply(composed, { ...grounded, personId: "p" })).toMatchObject({ reason: null, reply: composed });
    // A restatement of a row that shares no word with the question is
    // still the search's answer, never a memory line copied to the
    // wrong question.
    expect(guardReply("Marlow the plough horse lives on the Quill farm near the bay.", { ...grounded, personId: "p", utterance: "and the other one?" })).toMatchObject({ reason: null });
    // The standing rule holds for a composition too: a third-party trait
    // is grounded word by word, so a paraphrase whose verb the rows never
    // said ("works as") is cut as on a model turn.
    expect(guardReply("He lives on the Quill farm near the bay and works as a plough horse.", { ...grounded, personId: "p" })).toMatchObject({ reason: "invention" });
  });
});

describe("the tool message", () => {
  test("bounds a wide result: rows capped at eight, long strings cut, the content itself capped", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ title: `Row ${i}`, url: `https://example.com/${i}`, snippet: "x".repeat(2000) }));
    const content = toolResultContent(outcome({ callId: "c", packageId: "websearch", status: "succeeded", result: { actions: [], data: { rows } } }));
    const parsed = JSON.parse(content.replace(/…"}$/, "")) as { data: { rows: { snippet: string }[] } };
    expect(parsed.data.rows.length).toBe(8);
    expect(parsed.data.rows[0]!.snippet.length).toBeLessThanOrEqual(601);
    expect(content.length).toBeLessThanOrEqual(6003);
  });

  test("a failed outcome says its household-safe line, never a diagnostic; a pending one says what it asked", () => {
    expect(JSON.parse(toolResultContent(failedOutcome()))).toEqual({ status: "failed", package: "knowledge", error: "not_found" });
    expect(JSON.parse(toolResultContent(outcome({ callId: "p", packageId: "lights", status: "pending", userMessage: "All of them?" })))).toEqual({ status: "pending", package: "lights", asked: "All of them?" });
  });
});

describe("K6: the machine", () => {
  test("the phases run deciding, executing, composing, finished; a terminal phase stays", () => {
    const machine = new TurnMachine();
    expect(machine.phase).toBe("deciding");
    machine.enter("executing");
    machine.enter("composing");
    machine.enter("finished");
    expect(machine.trail).toEqual(["deciding", "executing", "composing", "finished"]);
    machine.enter("composing");
    expect(machine.phase).toBe("finished");
    expect(machine.done).toBe(true);
  });

  test("the abort cancels from any phase, and a finished turn is not cancelled after the fact", () => {
    const controller = new AbortController();
    const machine = new TurnMachine(controller.signal);
    machine.enter("composing");
    controller.abort();
    expect(machine.phase).toBe("cancelled");
    expect(machine.done).toBe(true);
    const finished = new TurnMachine(new AbortController().signal);
    finished.enter("finished");
    finished.cancel();
    expect(finished.phase).toBe("finished");
    const already = new AbortController();
    already.abort();
    expect(new TurnMachine(already.signal).phase).toBe("cancelled");
  });
});

// The engine: a two-outcome turn composed in one call on both paths,
// the native tool messages seen by the stub in order.
describe("the engine composes a two-outcome turn in one call", () => {
  beforeEach(() => {
    resetDb();
    __resetThrottleForTests();
    __resetLlmSupervisorForTests();
  });
  afterEach(() => {
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  });

  async function owner() {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    return { client, actor };
  }

  const COMPOSED = "Saved that, and Friday is pizza night.";

  async function withTwoCalls<T>(fn: (stub: { requests: () => ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => {
        if (!request.tools || request.tools.length === 0 || request.messages.some((m) => m.role === "tool")) return undefined;
        return [
          { id: "call-1", type: "function", function: { name: "remember", arguments: JSON.stringify({ fact: "the wifi password is on the fridge" }) } },
          { id: "call-2", type: "function", function: { name: "recall", arguments: JSON.stringify({ topic: "pizza night" }) } },
        ];
      },
      scriptedChatReply: (request) => (request.messages.some((m) => m.role === "tool") ? COMPOSED : "Sure."),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    try {
      return await fn(stub);
    } finally {
      stub.stop();
    }
  }

  const composition = (requests: ChatCompletionRequest[]) => requests.filter((r) => r.messages.some((m) => m.role === "tool"));

  function expectNativeToolMessages(request: ChatCompletionRequest) {
    const messages = request.messages;
    const assistantAt = messages.findIndex((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0);
    expect(assistantAt).toBeGreaterThan(0);
    expect(messages[assistantAt]!.tool_calls?.map((c) => [c.id, c.function.name])).toEqual([["call-1", "remember"], ["call-2", "recall"]]);
    expect(messages.slice(assistantAt + 1, assistantAt + 3).map((m) => [m.role, m.tool_call_id])).toEqual([["tool", "call-1"], ["tool", "call-2"]]);
    expect(messages[messages.length - 1]!.role).toBe("user");
    expect(messages[messages.length - 1]!.content).toContain("one to three sentences");
    expect(request.tools).toBeUndefined();
    const recalled = JSON.parse(messages[assistantAt + 2]!.content) as { reply?: string };
    expect(recalled.reply).toContain("pizza night");
  }

  const turnLine = (lines: string[]) => lines.filter((l) => l.startsWith("[turn] {")).map((l) => JSON.parse(l.slice(7)) as { composed?: string; phase?: string; outcomes?: { package: string }[] }).at(-1)!;

  function captureLog(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
      original(...args);
    };
    return { lines, restore: () => (console.log = original) };
  }

  test("runTurn(): remember and recall run, one composition phrases both, the stub saw the retained ids and the tool messages in order, the turn line says so", async () => {
    const { actor } = await owner();
    expect(remember(actor, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.8 }).ok).toBe(true);
    const log = captureLog();
    try {
      await withTwoCalls(async (stub) => {
        const result = await runTurn(actor, "chat", "our wifi password is on the fridge, please remember this, and what night is pizza night");
        if (!result.ok) throw new Error(result.error);
        expect(result.value.source).toBe("plugin");
        expect(result.value.plugin_id).toBe("remember+recall");
        expect(result.value.reply.text).toBe(COMPOSED);
        expect(stub.requests().length).toBe(2);
        expect(composition(stub.requests()).length).toBe(1);
        expectNativeToolMessages(composition(stub.requests())[0]!);
        const row = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
        expect((JSON.parse(row!.outcomes!) as { packageId: string; status: string }[]).map((o) => [o.packageId, o.status])).toEqual([["remember", "succeeded"], ["recall", "succeeded"]]);
      });
    } finally {
      log.restore();
    }
    expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1", phase: "finished" });
  });

  test("runTurnStream(): the same turn streams the composition's deltas after a composing status, the done value is the package's, one composition call", async () => {
    const { actor } = await owner();
    expect(remember(actor, { text: "Friday is pizza night", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.8 }).ok).toBe(true);
    const log = captureLog();
    try {
      await withTwoCalls(async (stub) => {
        const result = await runTurnStream(actor, "chat", "our wifi password is on the fridge, please remember this, and what night is pizza night");
        if (!result.ok) throw new Error(result.error);
        expect(result.kind).toBe("stream");
        if (result.kind !== "stream") return;
        const statuses: string[] = [];
        const drainStatus = async () => { const s = await result.status.next(); if (s) statuses.push(s.stage); };
        const iterator = result.tokens[Symbol.asyncIterator]();
        const deltas: string[] = [];
        let step = await iterator.next();
        while (!step.done) {
          deltas.push(step.value);
          step = await iterator.next();
        }
        await drainStatus();
        await drainStatus();
        const value = result.finalize(deltas.join("").trim(), step.value);
        expect(statuses).toEqual(["tool", "composing"]);
        expect(deltas.join("").trim()).toBe(COMPOSED);
        expect(value.source).toBe("plugin");
        expect(value.plugin_id).toBe("remember+recall");
        expect(value.reply.text).toBe(COMPOSED);
        expect(composition(stub.requests()).length).toBe(1);
        expectNativeToolMessages(composition(stub.requests())[0]!);
      });
    } finally {
      log.restore();
    }
    expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1", phase: "finished" });
  });

  test("a composed search answer is grounded by its rows: a person-trait line the invention guard would cut on a model turn reaches the person, on both paths, on the direct route", async () => {
    const { actor } = await owner();
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    const COMPOSED_TRAIT = "He lives on the Quill farm near the bay, a plough horse.";
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedChatReply: (request) => (request.messages.some((m) => m.role === "tool") ? COMPOSED_TRAIT : "Sure."),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const searxng = Bun.serve({ port: 0, fetch: () => Response.json({ results: [{ title: "Lantern Bay (cartoon): Marlow", url: "https://example.com/lantern-bay", content: "Marlow the plough horse lives on the Quill farm near the bay." }] }) });
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
    const log = captureLog();
    try {
      const result = await runTurn(actor, "chat", "search the web for the horse in the old Lantern Bay cartoon");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.source).toBe("plugin");
      expect(result.value.plugin_id).toBe("websearch");
      expect(result.value.reply.text).toBe(COMPOSED_TRAIT);
      expect(result.value.sources?.length).toBe(1);
      expect(stub.requests().length).toBe(1);
      // The direct route's instruction names the question the search
      // answered: the pattern's own capture, never "what I just asked".
      expect(stub.requests()[0]!.messages[stub.requests()[0]!.messages.length - 1]!.content).toContain('Answer this question of mine from the tool results above, in one to three sentences, in your own voice: "the horse in the old Lantern Bay cartoon".');
      expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1 ids=synthetic", phase: "finished" });
      const streamed = await runTurnStream(actor, "chat", "search the web for the horse in the old Lantern Bay cartoon");
      if (!streamed.ok || streamed.kind !== "stream") throw new Error("expected a stream");
      const iterator = streamed.tokens[Symbol.asyncIterator]();
      let step = await iterator.next();
      const deltas: string[] = [];
      while (!step.done) { deltas.push(step.value); step = await iterator.next(); }
      const value = streamed.finalize(deltas.join("").trim(), step.value);
      expect(value.reply.text).toBe(COMPOSED_TRAIT);
      expect(value.plugin_id).toBe("websearch");
      expect(value.sources?.length).toBe(1);
      expect(turnLine(log.lines)).toMatchObject({ composed: "composition calls=1 ids=synthetic" });
    } finally {
      log.restore();
      stub.stop();
      searxng.stop(true);
    }
  });

  test("a single succeeded call with its own reply is delivered direct, no composition call, on both paths", async () => {
    const { actor } = await owner();
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    const stub = startStubLlmServer(0, {
      scriptedToolCalls: (request) => (request.tools && request.tools.length > 0 && !request.messages.some((m) => m.role === "tool") ? [{ id: "call-1", type: "function", function: { name: "remember", arguments: JSON.stringify({ fact: "Friday is pizza night" }) } }] : undefined),
    });
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    const log = captureLog();
    try {
      const result = await runTurn(actor, "chat", "Friday is pizza night, can you remember that for me");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.plugin_id).toBe("remember");
      expect(stub.requests().length).toBe(1);
      expect(turnLine(log.lines)).toMatchObject({ composed: "direct calls=0" });
      const streamed = await runTurnStream(actor, "chat", "Friday is pizza night, can you remember that for me");
      if (!streamed.ok || streamed.kind !== "stream") throw new Error("expected a stream");
      const iterator = streamed.tokens[Symbol.asyncIterator]();
      let step = await iterator.next();
      const deltas: string[] = [];
      while (!step.done) { deltas.push(step.value); step = await iterator.next(); }
      expect(deltas).toEqual([]);
      expect(step.value && "resolved" in step.value).toBe(true);
      streamed.finalize("", step.value);
      expect(stub.requests().length).toBe(2);
      expect(turnLine(log.lines)).toMatchObject({ composed: "direct calls=0" });
    } finally {
      log.restore();
      stub.stop();
    }
  });
});
