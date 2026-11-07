// PROJECT-TOOL-REFUSAL-01 (RULES rule 6, a failed tool never fails the answer): start_project is not offered
// when no project type is registered, and a call naming an unregistered type is dropped so the model writes
// the answer itself instead of the person getting the generic refusal line.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __resetSettingsCacheForTests, setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setToolOfferOverridesForTests, resolveTurnBudgetBase } from "@/lib/turnMachine/budget";
import { __resetToolGateLatchForTests, budgetWithTurnToolGates } from "@/lib/turnMachine/toolGates";
import { __resetProjectTypesForTests, registerProjectType } from "@/lib/projects/projectTypes";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import { withStub } from "./toolHarness";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";

const REFUSAL = "I don't actually have that in this conversation, so I won't guess.";
const STORY = "Once upon a time a lantern fox found a path of silver leaves.";
let benchPeople: BenchPeople;

function registerFixture(): void {
  registerProjectType({
    id: "bedtime-story",
    title: "a bedtime story",
    description: "Write a short bedtime story.",
    minRole: "child",
    consequential: false,
    paramsSchema: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 } }, additionalProperties: false },
    buildPlan: () => ({ steps: [] }),
  } as unknown as Parameters<typeof registerProjectType>[0]);
}

beforeEach(() => {
  resetDb();
  __resetProjectTypesForTests();
  __resetSettingsCacheForTests();
  __resetToolGateLatchForTests();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  benchPeople = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __setToolOfferOverridesForTests(null);
  __resetProjectTypesForTests();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function makePerson(role: string): PersonRow {
  const now = new Date().toISOString();
  const id = `person-${role}`;
  db.insert(people).values({ id, displayName: role, role, avatarSeed: role, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get() as PersonRow;
}

async function offered(actor: PersonRow, role: "adult" | "teen" | "child"): Promise<string[]> {
  const input = {
    budget: resolveTurnBudgetBase(undefined, role), actor, band: role, surface: "chat" as const, surfaceClass: "written" as const,
    spoken: false, temporary: false, bare: false, ephemeral: false, text: "hello", musicEditAvailable: () => false,
  };
  return (await budgetWithTurnToolGates(input)).budget.tools_offered;
}

const call = (name: string, args: object) => [{ id: "call-1", name, args: JSON.stringify(args) }];
const isFirst = (request: { tool_choice?: unknown; messages: { role: string }[] }) => request.tool_choice !== "none" && !request.messages.some((m) => m.role === "tool");

describe("PROJECT-TOOL-REFUSAL-01: offer", () => {
  test("start_project is absent with no project type registered and present once one is", async () => {
    const owner = makePerson("owner");
    expect(await offered(owner, "adult")).not.toContain("start_project");
    registerFixture();
    expect(await offered(owner, "adult")).toContain("start_project");
  });

  test("the child and teen tool sets differ from the registered-type sets by start_project at most", async () => {
    for (const role of ["teen", "child"] as const) {
      const person = makePerson(role);
      const empty = await offered(person, role);
      registerFixture();
      const withType = await offered(person, role);
      __resetProjectTypesForTests();
      expect(withType.filter((id) => id !== "start_project")).toEqual(empty);
      expect(empty).not.toContain("start_project");
    }
  });
});

describe("PROJECT-TOOL-REFUSAL-01: an unregistered type never fails the answer", () => {
  test("a start_project call with type story on an empty registry gets a text round and the model's prose", async () => {
    __setToolOfferOverridesForTests(["start_project"]);
    const requests: ChatCompletionRequest[] = [];
    const result = await withStub(
      { reply: (request) => { requests.push(request); return STORY; }, calls: (request) => (isFirst(request) ? call("start_project", { type: "story", params: { topic: "a fox" } }) : undefined) },
      () => runTurnNext(benchPeople.owner, "chat", "write me a short story about a fox"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(STORY);
    expect(result.value.reply.text).not.toBe(REFUSAL);
    expect(requests.at(-1)?.tools?.length ?? 0).toBe(0);
    const stats = JSON.parse(db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get()!.stats as unknown as string) as { nodes?: { node: string; outcome?: { code?: string } }[] };
    expect((stats.nodes ?? []).find((n) => n.node === "policy")?.outcome?.code).toBe("unknown_project_type");
  });

  test("another unregistered type name (short_story) is dropped the same way", async () => {
    __setToolOfferOverridesForTests(["start_project"]);
    const result = await withStub(
      { reply: () => STORY, calls: (request) => (isFirst(request) ? call("start_project", { type: "short_story", params: {} }) : undefined) },
      () => runTurnNext(benchPeople.owner, "chat", "write me a short story about a fox"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(STORY);
  });

  test("a round that also holds another refused call is still dropped, not turned into the refusal line", async () => {
    __setToolOfferOverridesForTests(["start_project"]);
    const result = await withStub(
      { reply: () => STORY, calls: (request) => (isFirst(request) ? [...call("start_project", { type: "story", params: {} }), { id: "call-2", name: "no_such_tool", args: "{}" }] : undefined) },
      () => runTurnNext(benchPeople.owner, "chat", "write me a short story about a fox"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.reply.text).toBe(STORY);
  });
});
