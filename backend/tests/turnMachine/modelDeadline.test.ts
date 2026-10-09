// DEADLINE-02 / THIN-DL-02 (docs/BACKLOG.md "Thin chat path", THIN-DL-01 and
// THIN-DL-02). Live defect: a long adult answer died with "Sorry, I couldn't
// do that." because the model node had one 20 s wall-clock deadline for the
// whole reply. RULES.md rule 5: a time limit on the whole reply is a cap. An
// adult's written reply is bounded by a first-token deadline and a stall
// deadline instead; a child's, a teen's and every spoken turn keep the
// wall-clock limits. A transient failure before anything reached the person
// is retried quietly, and the failure line follows the failure kind.
//
// The scale is shrunk (milliseconds for seconds) by writing small values onto
// the household model's own budget record; the stream is scripted at the LLM
// client boundary, the same seam turnNext.test.ts's STREAM-PARTIAL-01 uses.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { useDefaultScriptedStack } from "../stackFixture";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { turnTotalWaitMs } from "@/lib/turnMachine/deadline";
import { FIRST_TOKEN_DEADLINE_MS, STALL_DEADLINE_MS } from "@/lib/turnMachine/budget";
import { FAILURE_COPY, classifyGenerationFailure, partialReplyNote } from "@/lib/generationFailure";
import { stackFailureResult } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import * as llm from "@/lib/llm";
import { streamTurnEvents } from "@/routes/turn";
import type { TurnStreamEvent } from "@/wire";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import type { TurnState } from "@/lib/turnMachine/contract";

const MODEL_ID = "qwen3-8b-instruct-q4-k-m";
const HUB_LOG_ERROR = "chat model unavailable: request to the Stack failed: node deadline exceeded";
const MEMORY_503_REASON = "The current memory budget cannot admit the request. The chat engine waited 15 s for memory and gave up.";

let people: BenchPeople;
let saved: { model: number; tool: number; total: number; first_token_ms?: number; stall_ms?: number };

function deadlines() {
  return CATALOG.find((m) => m.id === MODEL_ID)!.turn_budget!.deadlines_ms as typeof saved;
}

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetLlmSupervisorForTests();
  __resetStackEngineForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", MODEL_ID);
  saved = { ...deadlines() };
});

afterEach(() => {
  Object.assign(deadlines(), saved);
  if (saved.first_token_ms === undefined) delete deadlines().first_token_ms;
  if (saved.stall_ms === undefined) delete deadlines().stall_ms;
  __resetStackEngineForTests();
});

function setDeadlines(d: { model: number; total: number; first_token_ms: number; stall_ms: number }): void {
  Object.assign(deadlines(), d);
}

/** Resolves after `ms`, or throws the way llm.ts wraps an aborted stream. */
function sleepOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`chat model unavailable: ${(signal?.reason as Error | undefined)?.message ?? "aborted"}`));
    if (signal?.aborted) return fail();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", fail);
      resolve();
    }, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); fail(); }, { once: true });
  });
}

type Script = (signal: AbortSignal | undefined) => AsyncGenerator<llm.LlmStreamPiece, undefined, void>;

function mockStream(script: Script) {
  return spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (_role, _messages, _opts, signal) => ({
    ok: true,
    pieces: script(signal),
    stats: { usage: null, timings: null, stopReason: null },
  }));
}

function mockStartFailure(error: string) {
  return spyOn(llm, "startCompleteStreamPieces").mockImplementation(async () => ({ ok: false, status: 503, code: "unavailable", error }));
}

/** `count` sentences, one every `everyMs`. */
function steady(count: number, everyMs: number): Script {
  return async function* (signal) {
    for (let i = 1; i <= count; i++) {
      await sleepOrAbort(everyMs, signal);
      yield { channel: "text", text: `Sentence number ${i} is here. ` };
    }
    return undefined;
  };
}

function storedStats(turnId: string): { generations?: { error?: string | null }[] } {
  const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  return JSON.parse(row!.stats as unknown as string);
}

async function adultTurn(text = "explain how a heat pump works in detail", opts: { spoken?: boolean } = {}) {
  const result = await runTurnNext(people.owner, "chat", text, opts);
  if (!result.ok || result.kind !== "immediate") throw new Error(`expected an immediate result, got ${JSON.stringify(result).slice(0, 200)}`);
  return result.value;
}

describe("DEADLINE-02: an adult's written reply has no wall-clock cap", () => {
  test("(a) a reply that keeps producing text for far longer than the old model deadline completes", async () => {
    // Scaled: model 150 ms and total 300 ms in place of 20 s and 45 s; the
    // reply streams for about 700 ms, a delta every 50 ms (the real case is a
    // delta every 5 s for 60 s).
    setDeadlines({ model: 150, total: 300, first_token_ms: 2000, stall_ms: 400 });
    const spy = mockStream(steady(14, 50));
    try {
      const started = Date.now();
      const value = await adultTurn();
      expect(Date.now() - started).toBeGreaterThan(300);
      expect(value.reply.text).toContain("Sentence number 14 is here.");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("(b) silence between deltas past the stall deadline ends a streamed reply, keeping the text and adding a closing note", async () => {
    setDeadlines({ model: 20000, total: 45000, first_token_ms: 2000, stall_ms: 120 });
    const spy = mockStream(async function* (signal) {
      yield { channel: "text", text: "A heat pump moves heat instead of making it. " };
      await sleepOrAbort(2000, signal);
      yield { channel: "text", text: "never reached" };
      return undefined;
    });
    try {
      const result = await runTurnNextStream(people.owner, "chat", "explain how a heat pump works in detail");
      if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
      const events: TurnStreamEvent[] = [];
      for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event);
      const delivered = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
      expect(delivered).toContain("A heat pump moves heat instead of making it.");
      expect(delivered).toContain(partialReplyNote("slow", false));
      expect(delivered).not.toContain("never reached");
      expect(storedStats(result.turnId).generations?.[0]?.error).toContain("stream stalled");
      // Text had already been released, so it is never retried.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("(b) the same silence on a turn answered whole ends with the took-too-long line", async () => {
    setDeadlines({ model: 20000, total: 45000, first_token_ms: 2000, stall_ms: 120 });
    const spy = mockStream(async function* (signal) {
      yield { channel: "text", text: "A heat pump moves heat instead of making it. " };
      await sleepOrAbort(2000, signal);
      return undefined;
    });
    try {
      const value = await adultTurn();
      expect(value.reply.text).toBe(FAILURE_COPY.slow.adult);
      expect(storedStats(value.turn_id).generations?.[0]?.error).toContain("stream stalled");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("(c) no first token within first_token_ms ends the generation with the took-too-long line", async () => {
    setDeadlines({ model: 20000, total: 45000, first_token_ms: 100, stall_ms: 400 });
    const spy = mockStream(async function* (signal) {
      await sleepOrAbort(5000, signal);
      yield { channel: "text", text: "never reached" };
      return undefined;
    });
    try {
      const value = await adultTurn();
      expect(value.reply.text).toBe(FAILURE_COPY.slow.adult);
      expect(storedStats(value.turn_id).generations?.[0]?.error).toContain("first token deadline exceeded");
      // A retry would not fit inside the first-token window.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("a hung engine is told as took-too-long even when the client words the abort its own way", async () => {
    setDeadlines({ model: 20000, total: 45000, first_token_ms: 100, stall_ms: 400 });
    const spy = mockStream(async function* (signal) {
      await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("chat model unavailable: the request was aborted")), { once: true }));
      return undefined;
    });
    try {
      const value = await adultTurn();
      expect(value.reply.text).toBe(FAILURE_COPY.slow.adult);
    } finally {
      spy.mockRestore();
    }
  });

  test("a reasoning delta counts as the first token", async () => {
    setDeadlines({ model: 20000, total: 45000, first_token_ms: 150, stall_ms: 400 });
    const spy = mockStream(async function* (signal) {
      await sleepOrAbort(60, signal);
      yield { channel: "reasoning", text: "thinking about it" };
      await sleepOrAbort(60, signal);
      yield { channel: "text", text: "Here is the answer. " };
      await sleepOrAbort(60, signal);
      yield { channel: "text", text: "And the rest of it. " };
      return undefined;
    });
    try {
      const value = await adultTurn();
      expect(value.reply.text).toContain("And the rest of it.");
    } finally {
      spy.mockRestore();
    }
  });

  test("the turn total is not applied to an adult's written reply, and is to a child's and a spoken turn", () => {
    const base = { budget: { deadlines_ms: { model: 20000, total: 45000, tool: 10000, first_token_ms: 90000, stall_ms: 20000 } } };
    const adult = { ...base, plan: { age_band: "adult" }, planBasis: { surfaceClass: "written" } } as unknown as TurnState;
    const child = { ...base, plan: { age_band: "child" }, planBasis: { surfaceClass: "written" } } as unknown as TurnState;
    const spoken = { ...base, plan: { age_band: "adult" }, planBasis: { surfaceClass: "spoken" } } as unknown as TurnState;
    expect(turnTotalWaitMs(adult)).toBe(Infinity);
    expect(turnTotalWaitMs(child)).toBe(50000);
    expect(turnTotalWaitMs(spoken)).toBe(50000);
  });

  test("a model record that names none of the new fields gets the defaults and keeps its measured keys", () => {
    expect(FIRST_TOKEN_DEADLINE_MS).toBe(90000);
    expect(STALL_DEADLINE_MS).toBe(20000);
    expect(saved.model).toBe(20000);
    expect(saved.tool).toBe(10000);
    expect(saved.total).toBe(45000);
  });
});

describe("DEADLINE-02: a child's turn and a spoken turn keep their wall-clock limits", () => {
  test("(d) a spoken turn is cut at the model deadline even while text keeps arriving", async () => {
    setDeadlines({ model: 150, total: 300, first_token_ms: 2000, stall_ms: 400 });
    const spy = mockStream(steady(14, 50));
    try {
      const value = await adultTurn("explain how a heat pump works", { spoken: true });
      expect(storedStats(value.turn_id).generations?.some((g) => g.error?.includes("node deadline exceeded"))).toBe(true);
      expect(value.reply.text).not.toContain("Sentence number 14 is here.");
    } finally {
      spy.mockRestore();
    }
  });

  test("(d) a child's turn is cut at the model deadline even while text keeps arriving", async () => {
    setDeadlines({ model: 150, total: 300, first_token_ms: 2000, stall_ms: 400 });
    const spy = mockStream(steady(14, 50));
    try {
      const result = await runTurnNext(people.child, "chat", "how does a heat pump work");
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(storedStats(result.value.turn_id).generations?.some((g) => g.error?.includes("node deadline exceeded"))).toBe(true);
      expect(result.value.reply.text).not.toContain("Sentence number 14 is here.");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("THIN-DL-02: a transient failure before any text is retried quietly", () => {
  test("a pre-stream failure that clears on the second try answers normally, with no failure line", async () => {
    let calls = 0;
    const spy = spyOn(llm, "startCompleteStreamPieces").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, code: "unavailable", error: HUB_LOG_ERROR };
      return {
        ok: true,
        pieces: (async function* () {
          yield { channel: "text" as const, text: "Heat pumps move heat. " };
          return undefined;
        })(),
        stats: { usage: null, timings: null, stopReason: null },
      };
    });
    try {
      const value = await adultTurn();
      expect(calls).toBe(2);
      expect(value.reply.text).toContain("Heat pumps move heat.");
    } finally {
      spy.mockRestore();
    }
  });

  test("an adult's turn tries three times in all, then tells the kind", async () => {
    const spy = mockStartFailure(HUB_LOG_ERROR);
    try {
      const value = await adultTurn();
      expect(spy).toHaveBeenCalledTimes(3);
      expect(value.reply.text).toBe(FAILURE_COPY.slow.adult);
    } finally {
      spy.mockRestore();
    }
  }, 15000);

  test("a child's turn tries twice in all, and the line is short and kind", async () => {
    const spy = mockStartFailure(HUB_LOG_ERROR);
    try {
      const result = await runTurnNext(people.child, "chat", "how does a heat pump work");
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.value.reply.text).toBe(FAILURE_COPY.slow.minor);
    } finally {
      spy.mockRestore();
    }
  }, 15000);

  test("a cause nobody can name is not retried", async () => {
    const spy = mockStartFailure("chat model unavailable: the engine returned an invalid request shape");
    try {
      const value = await adultTurn();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(value.reply.text).toBe(FAILURE_COPY.other.adult);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("THIN-DL-02: the failure line follows the kind", () => {
  test("the exact hub-log error is the took-too-long kind", () => {
    expect(classifyGenerationFailure(HUB_LOG_ERROR)).toEqual({ kind: "slow", transient: true });
    expect(classifyGenerationFailure("chat model unavailable: first token deadline exceeded").kind).toBe("slow");
    expect(classifyGenerationFailure("chat model unavailable: stream stalled").kind).toBe("slow");
  });

  test("the Stack's 503 with a memory offline_reason is the low-memory kind, in the table's wording", async () => {
    const failure = stackFailureResult(new StackError("offline", "chat is offline", { status: 503, offline_reason: MEMORY_503_REASON }), "chat");
    expect(classifyGenerationFailure(failure.error)).toEqual({ kind: "memory", transient: true });
    const spy = mockStartFailure(failure.error);
    try {
      // The Stack refusing the role is also an engine-unavailable turn
      // (THIN-1C); its household line is the same table entry.
      const result = await runTurnNext(people.owner, "chat", "explain how a heat pump works in detail");
      expect(result).toMatchObject({ ok: false, code: "engine_unavailable", error: FAILURE_COPY.memory.adult });
      expect(JSON.stringify(result)).not.toContain("I can't think right now");
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  }, 15000);

  test("a 503 with no stated reason is the starting-up kind, and a dead socket is the unreachable kind", () => {
    stackFailureResult(new StackError("offline", "chat is offline", { status: 503 }), "chat");
    expect(classifyGenerationFailure("I can't think right now.")).toEqual({ kind: "busy", transient: true });
    // A remembered refusal never turns a dead socket into "still starting".
    expect(classifyGenerationFailure("chat model unavailable: could not reach the engine")).toEqual({ kind: "unreachable", transient: false });
    __resetStackEngineForTests();
    expect(classifyGenerationFailure("chat model unavailable: could not reach the engine")).toEqual({ kind: "unreachable", transient: false });
    expect(classifyGenerationFailure("chat model unavailable: connection reset by peer")).toEqual({ kind: "unreachable", transient: true });
    expect(classifyGenerationFailure("chat model unavailable: HTTP 500")).toEqual({ kind: "other", transient: false });
  });

  test("no line, for any kind or age, is the generic apology, carries a code, or runs past two sentences for a minor", () => {
    const allCopy = Object.values(FAILURE_COPY).flatMap(({ adult, minor }) => [adult, minor]);
    expect(allCopy.every((text) => !text.toLowerCase().includes("shorter"))).toBe(true);
    for (const kind of Object.keys(FAILURE_COPY) as (keyof typeof FAILURE_COPY)[]) {
      for (const text of [FAILURE_COPY[kind].adult, FAILURE_COPY[kind].minor]) {
        expect(text).not.toContain("couldn't do that");
        expect(text).not.toMatch(/\b(503|504|HTTP|Stack|offline_reason|exception)\b/);
      }
      expect(FAILURE_COPY[kind].minor.split(/[.?!]/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2);
    }
  });
});
