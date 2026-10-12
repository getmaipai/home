// CHAT-LATE-SYSTEM-01: the engine's Qwen3.5 chat template raises "System
// message must be at the beginning" for any system message after index 0.
// Home's history window renders notes about earlier turns in the system
// role, so every request is normalized at the one client boundary: at most
// one system message, first, every note's text kept.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { startStackFixture, useDefaultScriptedStack, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { countTokens, __clearTokenCountCacheForTests } from "@/lib/tokenCount";
import { buildConversationWindow, logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { complete, type LlmMessage } from "@/lib/llm";
import { foldLateSystemMessages, FOLDED_NOTE_LABEL } from "@/lib/systemFold";
import { db } from "@/db";
import { people } from "@/db/schema";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

/** What the Qwen3.5 template enforces, as a predicate. */
function templateAccepts(messages: ReadonlyArray<{ role: string }>): boolean {
  return messages.every((m, i) => m.role !== "system" || i === 0) && messages.some((m) => m.role === "user");
}

describe("foldLateSystemMessages()", () => {
  test("the exact failing shape: a system note after a user message and before the assistant's reply", () => {
    const input: LlmMessage[] = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "what is new in Lisbon" },
      { role: "system", content: '[Searched the web for "Lisbon": 3 sources.]' },
      { role: "assistant", content: "A new museum opened." },
      { role: "user", content: "and the weather" },
    ];
    expect(templateAccepts(input)).toBe(false);
    const out = foldLateSystemMessages(input);
    expect(templateAccepts(out)).toBe(true);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(out[1]!.content).toBe(`what is new in Lisbon\n\n${FOLDED_NOTE_LABEL}\n[Searched the web for "Lisbon": 3 sources.]`);
    expect(input).toHaveLength(5);
  });

  test("a note after an assistant message goes to the next user message, ahead of the person's words", () => {
    const out = foldLateSystemMessages([
      { role: "system", content: "base" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "system", content: "[attached] picture could not be read" },
      { role: "user", content: "u2" },
    ]);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(out[3]!.content).toBe(`${FOLDED_NOTE_LABEL}\n[attached] picture could not be read\n\nu2`);
  });

  test("leading system messages merge into one; a trailing note with no user to take it joins the leading one", () => {
    const out = foldLateSystemMessages([
      { role: "system", content: "one" },
      { role: "system", content: "two" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
      { role: "system", content: "late" },
    ]);
    expect(out).toEqual([{ role: "system", content: "one\n\ntwo\n\nlate" }, { role: "user", content: "u" }, { role: "assistant", content: "a" }]);
  });

  test("a list already in shape is returned untouched; images and tool fields survive", () => {
    const ok: LlmMessage[] = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
    expect(foldLateSystemMessages(ok)).toBe(ok);
    const image = { id: "i", name: "n.jpg", url: "data:image/jpeg;base64,AA", reservedTokens: 1 } as never;
    const out = foldLateSystemMessages([{ role: "user", content: "u", images: [image] }, { role: "system", content: "note" }, { role: "assistant", content: "a" }]);
    expect(out[0]!.images).toEqual([image]);
    expect(out[0]!.content).toContain("note");
  });

  test("every note's text survives the fold, over every placement", () => {
    const roles = ["user", "assistant", "system"] as const;
    for (const a of roles) for (const b of roles) for (const c of roles) {
      const input: LlmMessage[] = [{ role: "system", content: "S" }, { role: "user", content: "U0" }, ...[a, b, c].map((role, i) => ({ role, content: `m${i}${role}` })), { role: "user", content: "last" }];
      const out = foldLateSystemMessages(input);
      expect(templateAccepts(out)).toBe(true);
      const joined = out.map((m) => m.content).join("\n");
      for (const m of input) expect(joined).toContain(m.content);
    }
  });
});

describe("real assembled windows", () => {
  beforeEach(() => { resetDb(); useDefaultScriptedStack(); });
  afterEach(() => { __resetStackEngineForTests(); });

  test("a window holding a searched turn, a guarded turn and a package turn folds to a template-valid list with every note kept", async () => {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const search = { callId: "s1", packageId: "websearch", status: "succeeded" as const, via: "tool_call" as const, args: { expression: "film details" }, sources: [{ id: "src", kind: "web" as const, title: "Film", url: "https://example.test/film", site: "example.test", snippet: "x", source: "websearch", created_at: "2026-10-05T00:00:00.000Z", hlc: "1" }] };
    logTurn(actor, "chat", "look up the film", { reply: { text: "It is a cartoon." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "t1" }, { outcomes: [search] });
    logTurn(actor, "chat", "add milk to the list", { reply: { text: "I haven't added anything to your list." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "t2" }, { guardReasons: ["unsupported_action"] });
    logTurn(actor, "chat", "and again", { reply: { text: "It is a cartoon." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "t3" }, { outcomes: [{ ...search, callId: "s2" }] });
    logTurn(actor, "chat", "one more", { reply: { text: "Fine." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "t4" });
    logTurn(actor, "chat", "again", { reply: { text: "Fine." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "t5" });
    const window = await buildConversationWindow(conv.value);
    const raw: LlmMessage[] = [{ role: "system", content: "stable prefix" }, ...window.messages, { role: "user", content: "next question" }];
    expect(templateAccepts(raw)).toBe(true);
    const out = foldLateSystemMessages(raw);
    expect(templateAccepts(out)).toBe(true);
    const joined = out.map((m) => m.content).join("\n");
    for (const note of window.messages.filter((m) => m.role === "system")) expect(joined).toContain(note.content);
    expect(joined).toContain("[Nothing was added to the list.]");
    expect(joined).toContain("results_cleared");
    // Producers attach notes at the source: no system message in any window.
    expect(window.messages.some((m) => m.role === "system")).toBe(false);
  });
});

describe("the client boundary", () => {
  let fixture: StackFixture | null = null;
  const sent: Array<Array<{ role: string; content: unknown }>> = [];
  const counted: Array<Array<{ role: string; content: string }>> = [];
  beforeEach(() => {
    resetDb(); sent.length = 0; counted.length = 0; __clearTokenCountCacheForTests();
    fixture = startStackFixture({
      "POST /v1/chat/completions": async (req) => {
        const body = await req.json() as { messages: Array<{ role: string; content: unknown }> };
        sent.push(body.messages);
        if (!templateAccepts(body.messages)) return Response.json({ error: "Jinja Exception: System message must be at the beginning." }, { status: 500, headers: IDENTITY_HEADERS });
        return Response.json({ id: "x", object: "chat.completion", created: 1, model: "chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, { headers: IDENTITY_HEADERS });
      },
      "POST /v1/tokenize": async (req) => {
        const body = await req.json() as { messages: Array<{ role: string; content: string }> };
        counted.push(body.messages);
        if (!templateAccepts(body.messages)) return Response.json({ error: "Jinja Exception: No user query found in messages." }, { status: 500, headers: IDENTITY_HEADERS });
        return Response.json({ count: body.messages.reduce((n, m) => n + 3 + m.content.length, 0) }, { headers: IDENTITY_HEADERS });
      },
    });
    __setStackClientForTests(fixture.client);
    setHouseholdSettingValue("engines.stack.url", fixture.url);
  });
  afterEach(() => { fixture?.stop(); fixture = null; __resetStackEngineForTests(); });

  test("complete() never sends a system message after index 0, and the note text arrives", async () => {
    const result = await complete("chat", [
      { role: "system", content: "base" },
      { role: "user", content: "u1" },
      { role: "system", content: "[Searched the web: 2 sources.]" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.every((m, i) => m.role !== "system" || i === 0)).toBe(true);
    expect(JSON.stringify(sent[0])).toContain("[Searched the web: 2 sources.]");
  });

  test("countTokens() counts the same folded list, and a system-only list gets a count-only user message", async () => {
    expect(await countTokens([{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "system", content: "n" }, { role: "assistant", content: "a" }])).toBeGreaterThan(0);
    // A lone system message is counted net of the empty user message added to make it countable.
    expect(await countTokens([{ role: "system", content: "only a system message" }])).toBe(3 + "only a system message".length);
    expect(counted.every((list) => templateAccepts(list))).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
