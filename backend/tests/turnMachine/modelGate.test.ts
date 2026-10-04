// THIN-6B (docs/design/RULES.md rule 8): nothing is gated on one catalog
// model id. A model with no measured record gets tools and thinking for an
// adult; a child's or teen's turn keeps the no-tools fail-safe, and a minor
// never gets thinking. A missing record, a failed lookup and an unknown age
// all land on the safe side.
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, startRecordingProxy, type BenchPeople } from "../../scripts/bench/conversationRunner";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import { setHouseholdSettingValue } from "@/lib/settings";
import * as settings from "@/lib/settings";
import { CATALOG } from "@/lib/modelCatalog";
import { FIRST_TOKEN_DEADLINE_MS, NO_RECORD_BUDGET, STALL_DEADLINE_MS, resolveTurnBudget } from "@/lib/turnMachine/budget";
import { runTurnNext } from "@/lib/turnMachine/turnNext";

const UNKNOWN_MODEL = "some-other-chat-model-q4";
const RECORDED_MODEL = "qwen3-8b-instruct-q4-k-m";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", UNKNOWN_MODEL);
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function seen(person: BenchPeople["owner"], text: string, opts: { thinking?: boolean } = {}): Promise<{ toolCount: number; thinking: unknown }> {
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  let toolCount = -1;
  let thinking: unknown;
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request: ChatCompletionRequest) => {
      toolCount = request.tools?.length ?? 0;
      thinking = request.chat_template_kwargs?.enable_thinking;
      return "Hello there.";
    },
  });
  const proxy = startRecordingProxy(stub.url);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  __resetLlmSupervisorForTests();
  try {
    const result = await runTurnNext(person, "chat", text, opts);
    expect(result.ok).toBe(true);
    return { toolCount, thinking };
  } finally {
    proxy.stop();
    await stub.stop();
  }
}

describe("resolveTurnBudget: a model with no measured record", () => {
  test("an adult gets tools and a thinking budget", () => {
    const budget = resolveTurnBudget(UNKNOWN_MODEL, "adult");
    expect(budget.model_transitions).toBe(true);
    expect(budget.rounds).toBeGreaterThan(0);
    expect(budget.tools_offered.length).toBeGreaterThan(0);
    expect(budget.thinking_budget_tokens_toggled).toBeGreaterThan(0);
    expect(budget.measured.on).toBe("no measured record");
  });

  test("a child or a teen keeps the no-tools fail-safe", () => {
    expect(resolveTurnBudget(UNKNOWN_MODEL, "child")).toBe(NO_RECORD_BUDGET);
    expect(resolveTurnBudget(UNKNOWN_MODEL, "teen")).toBe(NO_RECORD_BUDGET);
  });

  test("a failed read of the selected model never loosens a minor's turn", () => {
    const spy = spyOn(settings, "getHouseholdSettingValue").mockImplementation(() => {
      throw new Error("settings unreadable");
    });
    try {
      expect(resolveTurnBudget(undefined, "child")).toBe(NO_RECORD_BUDGET);
      expect(resolveTurnBudget(undefined, "teen")).toBe(NO_RECORD_BUDGET);
    } finally {
      spy.mockRestore();
    }
  });

  test("a minor never gets thinking, with or without a record", () => {
    for (const id of [UNKNOWN_MODEL, RECORDED_MODEL]) {
      for (const band of ["child", "teen"] as const) {
        expect(resolveTurnBudget(id, band).thinking_for_minors).toBe(false);
      }
    }
  });

  test("a model with a record keeps its record for every band", () => {
    const record = CATALOG.find((m) => m.id === RECORDED_MODEL)?.turn_budget;
    for (const band of ["child", "teen", "adult"] as const) expect(resolveTurnBudget(RECORDED_MODEL, band)).toEqual({ ...record!, deadlines_ms: { ...record!.deadlines_ms, first_token_ms: FIRST_TOKEN_DEADLINE_MS, stall_ms: STALL_DEADLINE_MS } });
  });
});

describe("runTurnNext: the model gate on the wire", () => {
  test("an adult's turn on an unrecorded model offers the tools", async () => {
    const { toolCount } = await seen(people.owner, "hi");
    expect(toolCount).toBeGreaterThan(0);
  });

  test("an adult's thinking toggle reaches an unrecorded model", async () => {
    const { thinking } = await seen(people.owner, "how do I make a paper airplane", { thinking: true });
    expect(thinking).toBe(true);
  });

  test("a child's turn on an unrecorded model offers no tools and no thinking", async () => {
    const { toolCount, thinking } = await seen(people.child, "hi", { thinking: true });
    expect(toolCount).toBe(0);
    expect(thinking).toBe(false);
  });
});
