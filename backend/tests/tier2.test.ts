// Session C step 2: Tier 2 native tool calling, the consequential
// confirmation gate, and ask/confirm continuation. Exercises
// lib/turnEngine.ts's attemptTier2Tools()/resolvePendingAsk()/
// pendingAskFromPluginResult() directly (all exported for exactly this,
// matchPattern()/route()'s own precedent) rather than through a full
// runTurn(): a `consequential` fixture manifest needs no file on disk
// (the confirmation path never reaches runPlugin() at all), and no
// bundled recipe can produce `confirm`/`ask` yet (spec/interpreters/**'s
// `Step` union has no op for it - Session D's file), so that half is
// tested against a hand-built PluginResult.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { TestClient } from "./client";
import {
  attemptTier2Tools,
  resolvePendingAsk,
  pendingAskFromPluginResult,
  type RankedCandidate,
  type PluginResultWithConfirmAsk,
} from "@/lib/turnEngine";
import { resolveOrCreateConversation, getPendingAsk, setPendingAsk } from "@/lib/conversationHistory";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";
import type { SafetyResult } from "@maipai/spec/gen/ts/safety-result.js";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()! as PersonRow;
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("setup failed");
  return { actor, conversationId: conv.value.id };
}

const SAFE: SafetyResult = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-01-01T00:00:00.000Z" };

async function withScriptedToolCall<T>(reply: (request: ChatCompletionRequest) => string, fn: () => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      if (request.response_format?.type !== "json_schema" || request.response_format.json_schema.name !== "tool_calls") return undefined;
      return reply(request);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

// Real bundled packages (backend/packages/remember, recall), used so the
// "a proposed call actually runs" tests exercise a real recipe through
// runPlugin() - deliberately network-free ones (org standard: "a unit
// test does not call a live model, a network service, or real
// hardware"), unlike weather/joke/trivia's own real HTTP fetches.
const REMEMBER_CANDIDATE: RankedCandidate = {
  id: "remember",
  score: 0.7,
  manifest: { id: "remember", version: "0.1.0", kind: "plugin", category: "utility", display: "Remember", description: "remember a fact", args: { type: "object", required: ["fact"], properties: { fact: { type: "string", minLength: 1 } } } } as never,
};
const RECALL_CANDIDATE: RankedCandidate = {
  id: "recall",
  score: 0.68,
  manifest: { id: "recall", version: "0.1.0", kind: "plugin", category: "utility", display: "Recall", description: "recall what's known about a topic", args: { type: "object", required: ["topic"], properties: { topic: { type: "string", minLength: 1 } } } } as never,
};
// No file on disk needed: the confirmation path returns before ever
// calling runPlugin(), so a fixture manifest object is the whole story.
const CONSEQUENTIAL_CANDIDATE: RankedCandidate = {
  id: "lock-front-door",
  score: 0.9,
  manifest: { id: "lock-front-door", version: "0.1.0", kind: "plugin", category: "home", display: "Lock the front door", description: "lock the front door", consequential: true, args: {} } as never,
};

describe("attemptTier2Tools()", () => {
  test("a scripted valid tool-call reply runs the real package with validated args", async () => {
    const { actor } = await owner();
    const value = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "remember", args: { fact: "Friday is pizza night" } }]),
      () => attemptTier2Tools("remember Friday is pizza night", actor, [REMEMBER_CANDIDATE], [{ role: "user", content: "remember Friday is pizza night" }], "turn-1", "conv-1", SAFE, undefined),
    );
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(value?.routing?.tier).toBe("embedding");
  });

  test("two independent candidates both offered can both run and their replies combine", async () => {
    const { actor } = await owner();
    const value = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "remember", args: { fact: "the wifi password is on the fridge" } }, { tool: "recall", args: { topic: "pizza night" } }]),
      () =>
        attemptTier2Tools(
          "remember the wifi password and what do you know about pizza night",
          actor,
          [REMEMBER_CANDIDATE, RECALL_CANDIDATE],
          [{ role: "user", content: "remember the wifi password and what do you know about pizza night" }],
          "turn-1",
          "conv-1",
          SAFE,
          undefined,
        ),
    );
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember+recall");
  });

  test("an invalid call (fails the package's own args schema) is 'ask again' - null, never a silent drop", async () => {
    const { actor } = await owner();
    const value = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "remember", args: {} }]), // missing required `fact`
      () => attemptTier2Tools("remember this", actor, [REMEMBER_CANDIDATE], [{ role: "user", content: "remember this" }], "turn-1", "conv-1", SAFE, undefined),
    );
    expect(value).toBeNull();
  });

  test("a parse-failure reply (not the requested shape) is also null, not a crash", async () => {
    const { actor } = await owner();
    const value = await withScriptedToolCall(
      () => "I'm thinking about it.",
      () => attemptTier2Tools("hi", actor, [REMEMBER_CANDIDATE], [{ role: "user", content: "hi" }], "turn-1", "conv-1", SAFE, undefined),
    );
    expect(value).toBeNull();
  });

  test("an empty array (the model found nothing worth calling) is null", async () => {
    const { actor } = await owner();
    const value = await withScriptedToolCall(
      () => "[]",
      () => attemptTier2Tools("hi there", actor, [REMEMBER_CANDIDATE], [{ role: "user", content: "hi there" }], "turn-1", "conv-1", SAFE, undefined),
    );
    expect(value).toBeNull();
  });

  test("no ranked candidates at all skips Tier 2 entirely - null, no model call made", async () => {
    const { actor } = await owner();
    const value = await attemptTier2Tools("hi", actor, [], [{ role: "user", content: "hi" }], "turn-1", "conv-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("a consequential package proposed by the model waits for confirmation instead of running", async () => {
    const { actor, conversationId } = await owner();
    const value = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "lock-front-door", args: {} }]),
      () =>
        attemptTier2Tools(
          "lock the front door",
          actor,
          [CONSEQUENTIAL_CANDIDATE],
          [{ role: "user", content: "lock the front door" }],
          "turn-1",
          conversationId,
          SAFE,
          undefined,
        ),
    );
    expect(value?.source).toBe("confirm");
    expect(value?.plugin_id).toBe("lock-front-door");
    expect(value?.reply.text).toContain("lock the front door");
    // A real, pending confirmation actually got stored - the whole point
    // of not just answering "sure" and forgetting about it.
    const pending = getPendingAsk(conversationId);
    expect(pending).toEqual({ kind: "confirm", prompt: value!.reply.text, packageId: "lock-front-door", args: {} });
  });

  test("a consequential proposal alongside a non-consequential one in the same batch: the consequential one wins the turn, the other is dropped (documented simplification)", async () => {
    const { actor, conversationId } = await owner();
    const value = await withScriptedToolCall(
      () => JSON.stringify([{ tool: "lock-front-door", args: {} }, { tool: "remember", args: { fact: "pizza night is Friday" } }]),
      () =>
        attemptTier2Tools(
          "lock the door and remember pizza night is Friday",
          actor,
          [CONSEQUENTIAL_CANDIDATE, REMEMBER_CANDIDATE],
          [{ role: "user", content: "lock the door and remember pizza night is Friday" }],
          "turn-1",
          conversationId,
          SAFE,
          undefined,
        ),
    );
    expect(value?.source).toBe("confirm");
    expect(value?.plugin_id).toBe("lock-front-door");
  });
});

describe("resolvePendingAsk()", () => {
  test("no pendingAsk set: null, proceed with normal routing", async () => {
    const { actor, conversationId } = await owner();
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("hello", actor, conv.value, [], "turn-1", SAFE, undefined);
    expect(value).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("kind: confirm, an affirmative reply runs the pending package and clears it", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("yes", actor, conv.value, [], "turn-2", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(getPendingAsk(conversationId)).toBeNull(); // single-shot
  });

  test("kind: confirm, a negative reply declines without running anything and clears it", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("no thanks", actor, conv.value, [], "turn-2", SAFE, undefined);
    expect(value?.source).toBe("confirm");
    expect(value?.reply.text).toContain("won't");
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("kind: confirm, an ambiguous reply is cleared (single-shot) and falls through to normal routing", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "confirm", prompt: "Remember that?", packageId: "remember", args: { fact: "pizza night is Friday" } });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("what's on my list", actor, conv.value, [], "turn-2", SAFE, undefined);
    expect(value).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("kind: ask, the next utterance binds to the package's own required arg and runs it", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "ask", prompt: "Remember what?", packageId: "remember", args: {} });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const loaded = [{ id: "remember", manifest: REMEMBER_CANDIDATE.manifest }];
    const value = await resolvePendingAsk("pizza night is Friday", actor, conv.value, loaded, "turn-2", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(getPendingAsk(conversationId)).toBeNull();
  });

  test("kind: ask, a package that can't bind a raw-text continuation (no manifest found) falls through to null rather than guessing", async () => {
    const { actor, conversationId } = await owner();
    setPendingAsk(conversationId, { kind: "ask", prompt: "Remember what?", packageId: "remember", args: {} });
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error("setup failed");
    const value = await resolvePendingAsk("pizza night is Friday", actor, conv.value, [], "turn-2", SAFE, undefined); // loaded=[] - manifest not found
    expect(value).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });
});

describe("pendingAskFromPluginResult()", () => {
  test("a result carrying confirm stores a PendingAsk and returns its prompt", async () => {
    const { conversationId } = await owner();
    const result: PluginResultWithConfirmAsk = { actions: [], confirm: { prompt: "Really delete it?" } };
    const pending = pendingAskFromPluginResult("some-package", { id: "1" }, result, conversationId);
    expect(pending).toEqual({ prompt: "Really delete it?" });
    expect(getPendingAsk(conversationId)).toEqual({ kind: "confirm", prompt: "Really delete it?", packageId: "some-package", args: { id: "1" } });
  });

  test("a result carrying ask stores a PendingAsk with expects", async () => {
    const { conversationId } = await owner();
    const result: PluginResultWithConfirmAsk = { actions: [], ask: { prompt: "Which one?", expects: "a list item name" } };
    const pending = pendingAskFromPluginResult("some-package", {}, result, conversationId);
    expect(pending).toEqual({ prompt: "Which one?" });
    expect(getPendingAsk(conversationId)).toEqual({ kind: "ask", prompt: "Which one?", packageId: "some-package", args: {}, expects: "a list item name" });
  });

  test("an ordinary result (neither field) returns null and stores nothing", async () => {
    const { conversationId } = await owner();
    const result: PluginResultWithConfirmAsk = { actions: [], reply: { text: "Done." } };
    const pending = pendingAskFromPluginResult("some-package", {}, result, conversationId);
    expect(pending).toBeNull();
    expect(getPendingAsk(conversationId)).toBeNull();
  });
});
