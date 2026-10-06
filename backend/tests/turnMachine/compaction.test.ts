// THIN-3C and THIN-3F (rule 4): a conversation never fails because it is
// long. The window is every turn after the summary's anchor, sized by the
// engine's own count against the history budget; turns leave it only at a
// checkpoint, in one block, once the fold that covers them is stored; the
// prompt prefix holds between checkpoints. Proved on the scripted Stack
// fixture with an engine that enforces its context length the way
// llama-server does (a 400 naming n_prompt_tokens and n_ctx).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { startStackFixture, IDENTITY_HEADERS, useDefaultScriptedStack, type StackFixture } from "../stackFixture";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setChatWindowContextForTests } from "@/lib/roleHealth";
import { __setSummaryRefreshDelayForTests } from "@/lib/summaryRefresh";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { buildConversationWindow, getConversation, logTurn, maybeRefreshConversationSummary, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { contextNode } from "@/lib/turnMachine/nodes/context";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { stubRenderTemplate, stubTokenize, startStubLlmServer, type StubLlmServerHandle } from "@maipai/spec/llm/ts/stubServer.js";
import { db } from "@/db";
import { conversationTurns, conversations } from "@/db/schema";
import type { TurnValue } from "@/wire";
import type { TurnState } from "@/lib/turnMachine/contract";
import { withTurnDefaults } from "./turnStateDefaults";
import { __drainBackgroundWorkForTests } from "@/lib/backgroundWork";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

let people: BenchPeople;
let fixture: StackFixture | null = null;
let engine: StubLlmServerHandle | null = null;
const refused: number[] = [];
const summaryPrompts: string[] = [];

/** A Stack whose chat engine holds `contextTokens` (per slot) and refuses a
 * prompt that does not fit beside its max_tokens, as llama-server does;
 * the count route uses the same stub template and tokenizer; a fold
 * request (model "judge") is answered with a short summary. */
function engineWithContext(contextTokens: number): void {
  engine = startStubLlmServer(0, { scriptedChatReply: () => "A reply of a few words." });
  const sizeOf = (body: { messages?: Array<{ role?: unknown; content?: unknown }>; tools?: unknown[] }) => stubTokenize(stubRenderTemplate(body.messages ?? [], body.tools)).length;
  fixture = startStackFixture({
    "POST /v1/tokenize": async (req) => Response.json({ count: sizeOf(await req.json() as Parameters<typeof sizeOf>[0]) }, { headers: IDENTITY_HEADERS }),
    "POST /v1/chat/completions": async (req) => {
      const body = await req.json() as Parameters<typeof sizeOf>[0] & { model?: string; max_tokens?: number; stream?: boolean };
      if (body.model === "judge") {
        summaryPrompts.push(JSON.stringify(body.messages));
        return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: `Summary ${summaryPrompts.length}: they talked about the garden.` }, finish_reason: "stop" }] }, { headers: IDENTITY_HEADERS });
      }
      const prompt = sizeOf(body);
      if (prompt + (body.max_tokens ?? 0) > contextTokens) {
        refused.push(prompt);
        return Response.json({ error: { code: 400, type: "exceed_context_size_error", message: `the request (${prompt} tokens) exceeds the available context size (${contextTokens} tokens), try increasing it`, n_prompt_tokens: prompt, n_ctx: contextTokens } }, { status: 400, headers: IDENTITY_HEADERS });
      }
      const upstream = await fetch(`${engine!.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(IDENTITY_HEADERS)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    },
    "POST /v1/embeddings": async (req) => fetch(`${engine!.url}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() }),
    "GET /stack/v1/roles": async () => Response.json({ roles: ["chat", "embed", "judge"].map((id) => ({ id, state: { state: "ready", since: "scripted-test" }, reason: null })) }),
    "GET /stack/v1/health": async () => Response.json({ health: [] }),
  });
  __setStackClientForTests(fixture.client);
  setHouseholdSettingValue("engines.stack.url", fixture.url);
  __setChatWindowContextForTests(contextTokens);
}

beforeEach(async () => {
  // Background work a previous file left running (a title, a judge pass)
  // finishes first, so it cannot swap the Stack client under this file.
  await __drainBackgroundWorkForTests();
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  refused.length = 0;
  summaryPrompts.length = 0;
});

afterEach(async () => {
  __setSummaryRefreshDelayForTests(null);
  __setChatWindowContextForTests();
  fixture?.stop();
  fixture = null;
  await engine?.stop();
  engine = null;
  __resetStackEngineForTests();
  useDefaultScriptedStack();
});

function anchorOf(conversationId: string): string | null {
  const row = getConversation(people.owner, conversationId);
  if (!row.ok) throw new Error(row.error);
  return row.value.summary_through_turn;
}

describe("the compaction ladder's checkpoint (THIN-3C, THIN-3F)", () => {
  test("over 60 turns no turn is ever in neither the window nor the summary, folds move in blocks, and the prefix holds between checkpoints", async () => {
    engineWithContext(32768);
    const conv = resolveOrCreateConversation(people.owner, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const BUDGET = 900;
    const ids: string[] = [];
    let previous: string[] | null = null;
    let previousAnchor: string | null = null;
    let folds = 0;
    let prefixBreaks = 0;
    for (let i = 0; i < 60; i++) {
      const id = `turn-walk-${i}`;
      ids.push(id);
      logTurn(people.owner, "chat", `message ${i} about the vegetable garden and the tomatoes`, { reply: { text: `reply ${i}: water them in the morning and check the soil` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: id });
      const record = getConversation(people.owner, conv.value.id);
      if (!record.ok) throw new Error(record.error);
      const window = await buildConversationWindow(record.value, { historyBudgetTokens: BUDGET });
      // (b): every turn is in the window or before the anchor.
      const anchor = record.value.summary_through_turn;
      const covered = anchor ? ids.slice(0, ids.indexOf(anchor) + 1) : [];
      for (const turnId of ids) expect(window.turnIds.includes(turnId) || covered.includes(turnId)).toBe(true);
      expect(window.historyTokens!).toBeLessThanOrEqual(BUDGET);
      // (h): between checkpoints the earlier window is a prefix of this one.
      const rendered = window.messages.map((m) => JSON.stringify(m));
      if (previous && anchor === previousAnchor) {
        expect(rendered.slice(0, previous.length)).toEqual(previous);
      } else if (previous) {
        prefixBreaks++;
      }
      previous = rendered;
      previousAnchor = anchor;
      // The idle fold after the turn.
      await maybeRefreshConversationSummary(conv.value.id);
      const after = anchorOf(conv.value.id);
      if (after !== anchor) {
        folds++;
        // A block, never one turn at a time.
        const moved = ids.indexOf(after!) - (anchor ? ids.indexOf(anchor) : -1);
        expect(moved).toBeGreaterThan(1);
        const folded = getConversation(people.owner, conv.value.id);
        if (!folded.ok) throw new Error(folded.error);
        const lowered = await buildConversationWindow(folded.value, { historyBudgetTokens: BUDGET });
        expect(lowered.historyTokens!).toBeLessThanOrEqual(0.4 * BUDGET);
      }
    }
    expect(folds).toBeGreaterThan(2);
    // The prefix changes only at a checkpoint: once per fold.
    expect(prefixBreaks).toBe(folds);
  });

  test("a block longer than one fold's input is folded in passes until the low-water mark, not stopped part way", async () => {
    // A small context makes the fold's input cap (a quarter of it) smaller
    // than the block, so the checkpoint takes several passes.
    engineWithContext(1200);
    const conv = resolveOrCreateConversation(people.owner, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 30; i++) logTurn(people.owner, "chat", `message ${i} about the garden beds and the compost heap`, { reply: { text: `reply ${i} about watering` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-pass-${i}` });
    const BUDGET = 600;
    await buildConversationWindow(conv.value, { historyBudgetTokens: BUDGET });
    await maybeRefreshConversationSummary(conv.value.id);
    expect(summaryPrompts.length).toBeGreaterThan(1);
    const folded = getConversation(people.owner, conv.value.id);
    if (!folded.ok) throw new Error(folded.error);
    const window = await buildConversationWindow(folded.value, { historyBudgetTokens: BUDGET });
    expect(window.historyTokens!).toBeLessThanOrEqual(0.4 * BUDGET);
  });

  test("an anchor more than the fetch limit behind the newest turn still folds from the anchor, losing no turn", async () => {
    engineWithContext(32768);
    const conv = resolveOrCreateConversation(people.owner, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const base = Date.parse("2026-10-06T00:00:00.000Z");
    for (let i = 0; i < 230; i++) {
      logTurn(people.owner, "chat", `short ${i}`, { reply: { text: `ok ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-far-${String(i).padStart(3, "0")}` });
      db.update(conversationTurns).set({ createdAt: new Date(base + i * 1000).toISOString() }).where(eq(conversationTurns.id, `turn-far-${String(i).padStart(3, "0")}`)).run();
    }
    db.update(conversations).set({ summary: "Earlier notes.", summaryThroughTurn: "turn-far-000" }).where(eq(conversations.id, conv.value.id)).run();
    const record = getConversation(people.owner, conv.value.id);
    if (!record.ok) throw new Error(record.error);
    const window = await buildConversationWindow(record.value, { historyBudgetTokens: 1_000_000 });
    expect(window.summaryLine).toContain("Earlier notes.");
    await buildConversationWindow(record.value, { historyBudgetTokens: 300 });
    await maybeRefreshConversationSummary(conv.value.id);
    // The first fold starts right after the old anchor, never at the
    // oldest of the newest 200 rows.
    expect(summaryPrompts[0]).toContain("User: short 1\\n");
    expect(summaryPrompts[0]).not.toContain("User: short 0\\n");
    // 230 turns queue their episode embeddings; let them land here.
    await __drainBackgroundWorkForTests();
  }, 30_000);

  test("a fold that fails leaves the block verbatim and the anchor where it was", async () => {
    engineWithContext(32768);
    const conv = resolveOrCreateConversation(people.owner, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 20; i++) logTurn(people.owner, "chat", `message ${i} about the garden`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-fail-${i}` });
    await buildConversationWindow(conv.value, { historyBudgetTokens: 200 });
    fixture!.stop();
    fixture = startStackFixture({ "POST /v1/tokenize": async (req) => Response.json({ count: stubTokenize(stubRenderTemplate((await req.json() as { messages: [] }).messages)).length }, { headers: IDENTITY_HEADERS }) });
    __setStackClientForTests(fixture.client);
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    await maybeRefreshConversationSummary(conv.value.id);
    expect(anchorOf(conv.value.id)).toBeNull();
    const record = getConversation(people.owner, conv.value.id);
    if (!record.ok) throw new Error(record.error);
    const window = await buildConversationWindow(record.value, { historyBudgetTokens: 1_000_000 });
    expect(window.turnIds).toHaveLength(20);
  });

  test("the context node sizes the window from the engine's per-slot context less the reply ceiling and the counted rest of the prompt", async () => {
    const conv = resolveOrCreateConversation(people.owner, "chat");
    if (!conv.ok) throw new Error(conv.error);
    for (let i = 0; i < 12; i++) logTurn(people.owner, "chat", `message ${i} ${"about the garden ".repeat(20)}`, { reply: { text: `reply ${i} ${"water early ".repeat(20)}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-size-${i}` });
    const run = async (context: number) => {
      fixture?.stop();
      await engine?.stop();
      engineWithContext(context);
      const state = withTurnDefaults({ actor: people.owner, surface: "chat", conversationId: conv.value.id, budget: { ...(await import("@/lib/turnMachine/budget")).resolveTurnBudget(undefined, "adult"), context_tokens: context, context_window_tokens: context } } as TurnState);
      const { output } = await contextNode(state, { utterance: "what should I plant next?" }, new AbortController().signal);
      return output.items.filter((item) => item.source === "window" && item.id.startsWith("window-user-")).length;
    };
    expect(await run(32768)).toBe(12);
    const tight = await run(5200);
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThan(12);
  }, 20_000);

  test("a 40-turn conversation on a 4,096-token engine never fails, written or spoken, and folds as it goes", async () => {
    engineWithContext(4096);
    __setSummaryRefreshDelayForTests(5);
    let conversationId: string | undefined;
    for (let i = 0; i < 40; i++) {
      const spoken = i % 3 === 2;
      const result = await runTurnNext(people.owner, "chat", `turn ${i}: tell me more about growing ${["tomatoes", "basil", "peppers", "beans"][i % 4]} in a small garden, with some detail`, { ...(conversationId ? { conversationId } : {}), ...(spoken ? { spoken: true } : {}) });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      conversationId = result.value.conversation_id;
      expect(result.value.reply.text).not.toMatch(/too long|shorter|start a new chat/i);
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(refused).toEqual([]);
    expect(anchorOf(conversationId!)).not.toBeNull();
    expect(summaryPrompts.length).toBeGreaterThan(0);
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conversationId!)).all();
    expect(rows.filter((r) => r.status === "done")).toHaveLength(40);
  }, 60_000);
});
