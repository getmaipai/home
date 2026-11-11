// CONVO-PREWARM-02: the cache warm sent after a spoken reply must carry the exact window the next turn replays, or the engine
// (Splash resumes only from a published state at the end of a matching prefix) reads the whole window again. Three of eight
// live warms re-read 2,300 to 2,600 tokens (2026-11-11): the warm built its window with the default history budget and without
// the summary line, while the turn builds it with the budget it was sized against and the summary folded into the first system
// message. Both now go through one builder.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { conversations, people } from "@/db/schema";
import { buildConversationWindow, logTurn, nextTurnReplayMessages, resolveOrCreateConversation, windowReplayMessages, type ConversationWindow } from "@/lib/conversationHistory";
import { windowContextItems } from "@/lib/turnMachine/nodes/context";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { TurnValue } from "@/wire";
import type { LlmMessage } from "@/lib/llm";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };
const PLAN = { moves: {}, playfulness: "allowed", max_sentences: 2, max_words: 30, age_band: "adult", vocabulary_level: "standard", explanation_style: "concrete", trusted_adult_move: "none", content_disclosure: "full", react_move: null } as never;

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

/** The window part of a real turn's prompt: what contextToMessages() renders between the stable system message and the final user message. */
function turnWindowPart(window: ConversationWindow): LlmMessage[] {
  let seq = 0;
  const messages = contextToMessages(windowContextItems(window, () => ++seq), "and then?", { id: "t", name: "T" } as never, PLAN, { clauses: [] } as never, "spoken");
  return messages.slice(1, -1);
}

describe("CONVO-PREWARM-02: the warm's window equals the next turn's replayed window", () => {
  beforeEach(() => { resetDb(); });

  test("a synthetic window with a summary line and a tool pair renders the same through the context node and the warm", () => {
    const window: ConversationWindow = {
      summaryLine: "Earlier: they planned a trip.",
      messages: [
        { role: "user", content: "what is the weather" },
        { role: "assistant", content: "", tool_calls: [{ id: "call-1", tool: "weather", args: { place: "home" } }] as never },
        { role: "tool", content: "[results cleared]", tool_call_id: "call-1" },
        { role: "assistant", content: "Sunny." },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "Any time." },
      ],
      turnIds: ["t1", "t2"], droppedOlder: true, historyTokens: 40, historyBudgetTokens: 100,
    };
    const warm = windowReplayMessages(window);
    expect(warm[0]).toEqual({ role: "system", content: "Earlier: they planned a trip." });
    expect(turnWindowPart(window)).toEqual(warm);
  });

  test("over a logged conversation with a tool turn and a summary, the warm takes the budget the last turn was sized against", async () => {
    const actor = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const long = "y".repeat(600);
    for (let i = 0; i < 6; i++) {
      logTurn(actor, "chat", `${long} turn ${i}`, { reply: { text: `reply ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-${i}` });
    }
    // A package answered this one: the window replays it as the person's words plus a note, never as the assistant's.
    logTurn(actor, "chat", "convert 3 miles to km", { reply: { text: "4.8 km" }, source: "plugin", plugin_id: "units", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-tool" } as never);
    logTurn(actor, "chat", "and in feet?", { reply: { text: "15840 feet" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-7" });
    db.update(conversations).set({ summary: "Earlier they compared distances.", summaryThroughTurn: "turn-1" }).where(eq(conversations.id, conv.value.id)).run();
    const fresh = db.select().from(conversations).where(eq(conversations.id, conv.value.id)).get()!;
    const conversation = { ...conv.value, summary: fresh.summary, summary_through_turn: fresh.summaryThroughTurn };

    // The last real turn sized its window against a small budget (the context node records it on the way through).
    const sized = await buildConversationWindow(conversation, { historyBudgetTokens: 120, foldWhenOver: false });
    expect(sized.summaryLine).toBeDefined();

    const warm = await nextTurnReplayMessages(conversation);
    expect(warm).toEqual(turnWindowPart(sized));
    expect(warm[0]).toEqual({ role: "system", content: sized.summaryLine ?? "" });
    expect(warm.some((m) => m.role === "user" && m.content.includes("convert 3 miles to km"))).toBe(true);

    // The default budget builds a different window when the sizes differ; the warm never takes it once a turn recorded one.
    const byDefault = await buildConversationWindow(conversation, { foldWhenOver: false });
    if (byDefault.messages.length !== sized.messages.length) expect(warm).not.toEqual(windowReplayMessages(byDefault));
  });
});
