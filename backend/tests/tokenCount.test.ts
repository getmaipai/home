// THIN-3B (rules 2 and 4): every window size is the chat engine's own count
// on the rendered messages, taken after credential redaction and guard-note
// substitution; a count that fails leaves the named minimum window, logged;
// no estimate remains.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { startStackFixture, useDefaultScriptedStack, IDENTITY_HEADERS, type StackFixture } from "./stackFixture";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { setHouseholdSettingValue } from "@/lib/settings";
import { countTokens, __clearTokenCountCacheForTests } from "@/lib/tokenCount";
import { buildConversationWindow, logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { stubRenderTemplate, stubTokenize } from "@maipai/spec/llm/ts/stubServer.js";
import { db } from "@/db";
import { conversationTurns, people } from "@/db/schema";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

let fixture: StackFixture | null = null;
const counted: Array<{ model?: string; messages?: Array<{ role: string; content: string }>; tools?: unknown[] }> = [];

/** A Stack whose /v1/tokenize answers with the spec stub's own template and
 * tokenizer and records every body it was asked to count. */
function countingStack(status = 200): void {
  fixture = startStackFixture({
    "POST /v1/tokenize": async (req) => {
      const body = await req.json() as (typeof counted)[number];
      counted.push(body);
      if (status !== 200) return Response.json({ error: "This chat engine does not report token counts.", role: "chat" }, { status, headers: IDENTITY_HEADERS });
      return Response.json({ count: stubTokenize(stubRenderTemplate(body.messages ?? [], body.tools)).length }, { headers: IDENTITY_HEADERS });
    },
  });
  __setStackClientForTests(fixture.client);
  setHouseholdSettingValue("engines.stack.url", fixture.url);
}

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __clearTokenCountCacheForTests();
  counted.length = 0;
});

afterEach(() => {
  fixture?.stop();
  fixture = null;
  __resetStackEngineForTests();
});

describe("countTokens() (THIN-3B)", () => {
  test("asks the Stack's chat role for the engine's count, with the tools block, and reads a repeat from its cache", async () => {
    countingStack();
    const messages = [{ role: "user" as const, content: "what is the weather in Lisbon" }];
    const tools = [{ id: "websearch", description: "Search the web", args: { type: "object" } }];
    const first = await countTokens(messages, { tools });
    expect(first).toBe(stubTokenize(stubRenderTemplate(messages, [{ type: "function", function: { name: "websearch", description: "Search the web", parameters: { type: "object" } } }])).length);
    expect(counted).toHaveLength(1);
    expect(counted[0]!.model).toBe("chat");
    expect(counted[0]!.tools).toEqual([{ type: "function", function: { name: "websearch", description: "Search the web", parameters: { type: "object" } } }]);
    expect(await countTokens(messages, { tools })).toBe(first);
    expect(counted).toHaveLength(1);
  });

  test("a count from a different model clears the cached counts", async () => {
    let model = "model-a";
    fixture = startStackFixture({
      "POST /v1/tokenize": async (req) => {
        const body = await req.json() as (typeof counted)[number];
        counted.push(body);
        return Response.json({ count: model === "model-a" ? 10 : 20 }, { headers: { ...IDENTITY_HEADERS, "x-maipai-model": model } });
      },
    });
    __setStackClientForTests(fixture.client);
    setHouseholdSettingValue("engines.stack.url", fixture.url);
    const first = [{ role: "user" as const, content: "first" }];
    expect(await countTokens(first)).toBe(10);
    model = "model-b";
    expect(await countTokens([{ role: "user", content: "second" }])).toBe(20);
    expect(await countTokens(first)).toBe(20);
    expect(counted).toHaveLength(3);
  });

  test("an engine that cannot count gives null, logged once, never an estimate", async () => {
    countingStack(501);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await countTokens([{ role: "user", content: "hello" }])).toBeNull();
      expect(await countTokens([{ role: "user", content: "hello again" }])).toBeNull();
      expect(warn.mock.calls.filter((call) => String(call[0]).includes("[tokenCount]"))).toHaveLength(1);
      // The back-off: after a failure the counter stops asking for a while,
      // so a broken engine costs one call, not one per turn.
      expect(counted).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the window's counts (THIN-3B)", () => {
  test("a credential and a guard-replaced turn are counted in their redacted, substituted form", async () => {
    const actor = await owner();
    countingStack();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    const value = `Wil${"l".repeat(2)}ow${44}91`;
    logTurn(actor, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-cred" });
    db.update(conversationTurns).set({ userText: `the wifi password is ${value}` }).where(eq(conversationTurns.id, "turn-cred")).run();
    logTurn(actor, "chat", "have you seen it", { reply: { text: "I don't actually have that - nobody's told me." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-guard" }, { guardReasons: ["invention"] });
    const window = await buildConversationWindow(conv.value);
    expect(window.turnIds).toEqual(["turn-cred", "turn-guard"]);
    const sent = JSON.stringify(counted);
    expect(sent).not.toContain(value);
    expect(sent).toContain("[credential redacted]");
    // The guard's own line never reaches the count; its note does.
    expect(sent).not.toContain("nobody's told me");
    expect(counted.some((body) => body.messages?.some((m) => m.role === "system" && m.content.startsWith("[")))).toBe(true);
  });

  test("a count that fails leaves the named minimum window (the newest four turns), logged", async () => {
    const actor = await owner();
    countingStack(501);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const conv = resolveOrCreateConversation(actor, "chat");
      if (!conv.ok) throw new Error(conv.error);
      for (let i = 0; i < 7; i++) logTurn(actor, "chat", `short ${i}`, { reply: { text: `ok ${i}` }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: `turn-min-${i}` });
      const window = await buildConversationWindow(conv.value);
      expect(window.turnIds).toEqual(["turn-min-3", "turn-min-4", "turn-min-5", "turn-min-6"]);
      expect(window.droppedOlder).toBe(true);
      expect(warn.mock.calls.some((call) => String(call[0]).includes("falls back to its named minimum"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test("no characters-per-token estimate remains in the window builder", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "lib", "conversationHistory.ts"), "utf8");
    expect(source).not.toMatch(/CHARS_PER_TOKEN|estimateTokens|length \/ 4/);
  });
});
