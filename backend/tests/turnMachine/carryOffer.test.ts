// THIN-3G (rule 4's last sentence; the coordinator's ruling of 2026-10-06,
// option b): only on written chat, and only when the stable prefix, the
// summary and the current message cannot fit together, the reply offers a
// new chat that carries the summary forward. The new chat answers that same
// message with the summary held out of its first prompt (no second offer,
// no loop) and carries the summary from its second message. A spoken turn
// never hears the offer. A message that cannot fit even alone gets a plain
// written line, never the offer. Scripted engine that enforces its context.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { useDefaultScriptedStack } from "../stackFixture";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setChatWindowContextForTests } from "@/lib/roleHealth";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { createConversation, logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { contextNode } from "@/lib/turnMachine/nodes/context";
import { contextToMessages } from "@/lib/turnMachine/messages";
import { promptLimitLine } from "@/lib/failureCopy";
import { countTokens } from "@/lib/tokenCount";
import { resolveTurnBudget } from "@/lib/turnMachine/budget";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import type { TurnValue } from "@/wire";
import type { TurnState } from "@/lib/turnMachine/contract";
import { startContextEngine, sizeOf, type ContextEngine } from "./contextEngineFixture";
import { startStackFixture, IDENTITY_HEADERS } from "../stackFixture";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { withTurnDefaults } from "./turnStateDefaults";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const CONTEXT = 3500;
const REPLY = 1536; // the catalog chat record's reply ceiling (thinking off)

let people: BenchPeople;
let engine: ContextEngine | null = null;

beforeEach(async () => {
  await __drainBackgroundWorkForTests();
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  engine = startContextEngine(CONTEXT);
});

afterEach(async () => {
  await __drainBackgroundWorkForTests();
  await engine?.stop();
  engine = null;
  __setChatWindowContextForTests();
  __resetStackEngineForTests();
  useDefaultScriptedStack();
});

/** The core prompt (stable prefix, profile, roster, the message) for a
 * written adult turn, by the engine's count: the size the fixture is
 * built around. */
async function coreSize(utterance: string): Promise<number> {
  const conv = resolveOrCreateConversation(people.owner, "chat");
  if (!conv.ok) throw new Error(conv.error);
  const state = withTurnDefaults({ actor: people.owner, surface: "chat", conversationId: "", budget: { ...resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult"), context_tokens: 1_000_000, context_window_tokens: 1_000_000 } } as TurnState);
  const { output } = await contextNode(state, { utterance }, new AbortController().signal);
  const core = output.items.filter((i) => i.source === "utterance" || i.source === "profile" || i.source === "roster");
  db.delete(conversations).where(eq(conversations.id, conv.value.id)).run();
  return (await countTokens(contextToMessages(core, utterance, state.persona, state.plan, state.signal, "written")))!;
}

/** A message sized so the core fits the engine alone but not beside a
 * summary of `summaryWords` words. */
async function fixtureMessage(summaryWords: number): Promise<{ message: string; summary: string }> {
  const summary = `People and facts:\n${"Riff grows tomatoes ".repeat(summaryWords / 3)}`;
  const base = await coreSize("x");
  // The room left for the message beside the core, less a margin the
  // summary (well over it) cannot fit into.
  const room = CONTEXT - REPLY - base - 200;
  const message = `Please look at this list: ${"carrot ".repeat(Math.floor(room / 2))}`;
  return { message, summary };
}

function seedLongChat(summary: string): string {
  const conv = resolveOrCreateConversation(people.owner, "chat");
  if (!conv.ok) throw new Error(conv.error);
  for (let i = 0; i < 3; i++) logTurn(people.owner, "chat", `turn ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-long-${i}` });
  db.update(conversations).set({ summary, summaryThroughTurn: "turn-long-0" }).where(eq(conversations.id, conv.value.id)).run();
  return conv.value.id;
}

describe("THIN-3G: a written chat that cannot fit offers a new chat carrying the summary", () => {
  test("the offer appears once on written chat, the seeded chat answers the same message without a second offer, and its second turn carries the summary", async () => {
    const { message, summary } = await fixtureMessage(600);
    const conversationId = seedLongChat(summary);
    const offered = await runTurnNext(people.owner, "chat", message, { conversationId });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(offered.value.reply.text).toBe(promptLimitLine("carry_offer", false));
    expect(offered.value.carry_offer).toBe(true);
    expect(offered.value.reply.text).not.toMatch(/shorter|shorten/i);
    // No generation was asked for, so nothing was refused for size.
    expect(engine!.refused).toEqual([]);
    expect(engine!.chatBodies).toHaveLength(0);

    const seeded = createConversation(people.owner, { carryFrom: conversationId });
    if (!seeded.ok) throw new Error(seeded.error);
    expect(seeded.value.summary).toBe(summary);
    const first = await runTurnNext(people.owner, "chat", message, { conversationId: seeded.value.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.carry_offer).toBeUndefined();
    expect(first.value.reply.text).toBe("A reply of a few words.");
    expect(JSON.stringify(engine!.chatBodies.at(-1)!.messages)).not.toContain("Notes about this conversation so far");
    expect(engine!.refused).toEqual([]);

    const second = await runTurnNext(people.owner, "chat", "and what about the basil?", { conversationId: seeded.value.id });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.carry_offer).toBeUndefined();
    expect(JSON.stringify(engine!.chatBodies.at(-1)!.messages)).toContain("Notes about this conversation so far");
    expect(JSON.stringify(engine!.chatBodies.at(-1)!.messages)).toContain("Riff grows tomatoes");
  }, 30_000);

  test("the same fixture on a spoken turn answers without a word about length", async () => {
    const { message, summary } = await fixtureMessage(600);
    const conversationId = seedLongChat(summary);
    const spoken = await runTurnNext(people.owner, "chat", message, { conversationId, spoken: true });
    expect(spoken.ok).toBe(true);
    if (!spoken.ok) return;
    expect(spoken.value.carry_offer).toBeUndefined();
    expect(spoken.value.reply.text).not.toBe(promptLimitLine("carry_offer", false));
    expect(spoken.value.reply.text).not.toMatch(/too long|new chat/i);
  }, 30_000);

  test("a message that cannot fit even alone gets the plain written line, never the offer", async () => {
    const conversationId = seedLongChat("People and facts:\nnone");
    const huge = `Read this: ${"wordy ".repeat(1300)}`; // under the 8,000-character turn cap, over the context
    const result = await runTurnNext(people.owner, "chat", huge, { conversationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reply.text).toBe(promptLimitLine("too_big", false));
    expect(result.value.carry_offer).toBeUndefined();
    expect(result.value.reply.text).not.toMatch(/shorter|shorten/i);
  }, 30_000);

  test("a count that fails during the check is unmeasured, never an offer", async () => {
    const { message, summary } = await fixtureMessage(600);
    const conversationId = seedLongChat(summary);
    // Counting works for the first call of the turn, then fails.
    let counts = 0;
    const flaky = startStackFixture({
      "POST /v1/tokenize": async (req) => {
        counts++;
        if (counts > 1) return Response.json({ error: "This chat engine does not report token counts.", role: "chat" }, { status: 501, headers: IDENTITY_HEADERS });
        return Response.json({ count: sizeOf(await req.json() as Parameters<typeof sizeOf>[0]) }, { headers: IDENTITY_HEADERS });
      },
      "POST /v1/chat/completions": async (req) => fetch(`${engine!.fixture.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() }),
      "POST /v1/embeddings": async (req) => fetch(`${engine!.fixture.url}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() }),
      "GET /stack/v1/roles": async () => Response.json({ roles: ["chat", "embed", "judge"].map((id) => ({ id, state: { state: "ready", since: "scripted-test" }, reason: null })) }),
      "GET /stack/v1/health": async () => Response.json({ health: [] }),
    });
    __setStackClientForTests(flaky.client);
    setHouseholdSettingValue("engines.stack.url", flaky.url);
    try {
      const result = await runTurnNext(people.owner, "chat", message, { conversationId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.carry_offer).toBeUndefined();
      expect(result.value.reply.text).not.toBe(promptLimitLine("carry_offer", false));
    } finally {
      flaky.stop();
    }
  }, 30_000);

  test("carry_from takes only the person's own chat, and a temporary chat's summary only into another temporary chat", async () => {
    const conversationId = seedLongChat("People and facts:\nRiff grows tomatoes.");
    const other = createConversation(people.child, { carryFrom: conversationId });
    expect(other.ok).toBe(false);
    const temporary = createConversation(people.owner, { mode: "temporary" });
    if (!temporary.ok) throw new Error(temporary.error);
    const intoStored = createConversation(people.owner, { carryFrom: temporary.value.id });
    expect(intoStored).toMatchObject({ ok: false, status: 400 });
    const intoTemporary = createConversation(people.owner, { mode: "temporary", carryFrom: conversationId });
    expect(intoTemporary.ok).toBe(true);
    if (!intoTemporary.ok) return;
    expect(intoTemporary.value.summary).toBe("People and facts:\nRiff grows tomatoes.");
    expect(db.select().from(conversations).where(eq(conversations.id, intoTemporary.value.id)).get()).toBeUndefined();
  });
});
