// Fix E (docs/dev.md's "Chat reliability" - native tool calling, one
// round trip): Tier 2's own consequential confirmation gate and
// ask/confirm continuation, plus the model's native tool_calls decision
// itself. resolveToolCalls() (Session C step 2's attemptTier2Tools(),
// rewritten) takes the model's ALREADY-DECIDED ToolCall[] directly now -
// no scripted stub needed to exercise it at all, since it no longer
// makes its own completion call (that round trip is gone; the SAME
// completion that would have answered in plain text now carries the
// tool decision, read back by runTurn()/runTurnStream() before this
// function ever runs). resolvePendingAsk()/pendingAskFromPluginResult()
// are exported for the identical reason matchPattern()/route() are: a
// `consequential` fixture manifest needs no file on disk (the
// confirmation path never reaches runPlugin() at all), and no bundled
// recipe can produce `confirm`/`ask` yet (spec/interpreters/**'s `Step`
// union has no op for it - Session D's file), so that half is tested
// against a hand-built PluginResult.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { TestClient } from "./client";
import {
  resolveToolCalls,
  resolvePendingAsk,
  pendingAskFromPluginResult,
  runTurn,
  runTurnStream,
  type RankedCandidate,
  type PluginResultWithConfirmAsk,
} from "@/lib/turnEngine";
import type { ToolCall } from "@/lib/llm";
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

/** Fix E: points the chat backend at a fresh stub scripted to answer a
 * request with a REAL tool_calls reply (spec/llm/ts/stubServer.ts's own
 * scriptedToolCalls option) - only needed by the runTurn()/
 * runTurnStream() integration tests below, which exercise the whole
 * native-tool-calling round trip end to end; resolveToolCalls() itself
 * needs no model at all anymore. */
async function withScriptedToolCalls<T>(
  calls: (request: ChatCompletionRequest) => { id: string; name: string; args: string }[] | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request) => {
      if (!request.tools || request.tools.length === 0) return undefined;
      const scripted = calls(request);
      return scripted?.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } }));
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

/** Every test below offers exactly the candidates it ranks, matching
 * real production behavior when the ranked list is no longer than
 * MAX_TIER2_TOOLS_OFFERED - the one test that deliberately does NOT do
 * this (a real 4th+ candidate that's ranked but never offered) builds
 * its own narrower `offeredIds` explicitly. */
function offeredFrom(ranked: RankedCandidate[]): Set<string> {
  return new Set(ranked.map((r) => r.id));
}

describe("resolveToolCalls() (Fix E: the model's own native tool_calls decision, resolved)", () => {
  test("a real tool call runs the package with validated args", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "remember", args: { fact: "Friday is pizza night" } }];
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember");
    expect(value?.routing?.tier).toBe("tool");
  });

  test("two independent calls both run and their replies combine", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [
      { tool: "remember", args: { fact: "the wifi password is on the fridge" } },
      { tool: "recall", args: { topic: "pizza night" } },
    ];
    const ranked = [REMEMBER_CANDIDATE, RECALL_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value?.source).toBe("plugin");
    expect(value?.plugin_id).toBe("remember+recall");
  });

  test("an invalid call (fails the package's own args schema) is 'ask again' - null, never a silent drop", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "remember", args: {} }]; // missing required `fact`
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("a call naming a tool that isn't a real candidate at all is dropped, not trusted", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "not-offered", args: {} }];
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  // A code review (2026-09-07) found the first cut of this function
  // validated a call's id against the FULL `ranked` list (every Tier 1
  // candidate), not the actually-offered subset (prepareTurn()'s own
  // `tools`, capped at MAX_TIER2_TOOLS_OFFERED) - a call naming a real,
  // ranked-but-unoffered candidate (the 4th-ranked one, say) passed the
  // old check and ran anyway, including reaching the confirm gate for a
  // `consequential` package that was never actually shown to the model.
  test("a call naming a real candidate that WAS ranked but was never actually offered is dropped, not run", async () => {
    const { actor } = await owner();
    const calls: ToolCall[] = [{ tool: "recall", args: { topic: "pizza night" } }];
    // recall is a genuine candidate (present in `ranked`), but this
    // turn's own `offeredIds` (what prepareTurn() actually sent as
    // `tools`) only ever included remember - the exact "offered top few,
    // not the whole ranked list" gap the fix above closes.
    const value = await resolveToolCalls(calls, offeredFrom([REMEMBER_CANDIDATE]), [REMEMBER_CANDIDATE, RECALL_CANDIDATE], actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("an empty calls array is null (nothing to resolve)", async () => {
    const { actor } = await owner();
    const ranked = [REMEMBER_CANDIDATE];
    const value = await resolveToolCalls([], offeredFrom(ranked), ranked, actor, "conv-1", "turn-1", SAFE, undefined);
    expect(value).toBeNull();
  });

  test("a consequential package proposed by the model waits for confirmation instead of running", async () => {
    const { actor, conversationId } = await owner();
    const calls: ToolCall[] = [{ tool: "lock-front-door", args: {} }];
    const ranked = [CONSEQUENTIAL_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, conversationId, "turn-1", SAFE, undefined);
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
    const calls: ToolCall[] = [
      { tool: "lock-front-door", args: {} },
      { tool: "remember", args: { fact: "pizza night is Friday" } },
    ];
    const ranked = [CONSEQUENTIAL_CANDIDATE, REMEMBER_CANDIDATE];
    const value = await resolveToolCalls(calls, offeredFrom(ranked), ranked, actor, conversationId, "turn-1", SAFE, undefined);
    expect(value?.source).toBe("confirm");
    expect(value?.plugin_id).toBe("lock-front-door");
  });
});

describe("runTurn()/runTurnStream() with native tool calling end to end (Fix E)", () => {
  test("runTurn(): a real tool call, scripted through the stub, runs the real package - one completion call, no separate grammar round trip", async () => {
    const { actor } = await owner();
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      // Deliberately NOT starting with "remember" (see the retry test's
      // own comment below) - this utterance must reach Tier 2 (offered
      // as a tool) rather than winning Tier 0's own literal pattern
      // outright, or the scripted tool_calls reply above would never
      // actually be exercised.
      () => runTurn(actor, "chat", "Friday is pizza night, please remember"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    // The real proof this went through native tool calling, not a Tier 0
    // pattern win that happens to name the same package: only
    // resolveToolCalls() ever sets routing.tier "tool".
    expect(result.value.routing?.tier).toBe("tool");
  });

  test("runTurn(): every proposed call failing falls back to a second, plain completion - never a fabricated success", async () => {
    const { actor } = await owner();
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: "{}" }], // missing required `fact`
      // Deliberately NOT starting with "remember" - remember's own
      // `routing.patterns` ("remember *") would win Tier 0 outright on
      // any utterance that does, bypassing Tier 2 (and this test)
      // entirely. Shares enough vocabulary with the package's own
      // routing.examples ("please remember our wifi password is on the
      // fridge") for the stub's bag-of-words scorer to still offer it.
      () => runTurn(actor, "chat", "our wifi password is on the fridge, please remember"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model"); // the retry's own plain reply, not a plugin result
  });

  test("runTurnStream(): a real tool call resolves as an immediate reply - the stream never starts typing before falling back to a plugin answer", async () => {
    const { actor } = await owner();
    const result = await withScriptedToolCalls(
      () => [{ id: "call-1", name: "remember", args: '{"fact":"Friday is pizza night"}' }],
      // Not starting with "remember" - see the runTurn() version of this
      // exact test for why (remember's own "remember *" pattern would
      // win Tier 0 outright otherwise, and this test would pass for the
      // wrong reason).
      () => runTurnStream(actor, "chat", "Friday is pizza night, please remember"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("immediate");
    if (result.kind !== "immediate") return;
    expect(result.value.source).toBe("plugin");
    expect(result.value.plugin_id).toBe("remember");
    expect(result.value.routing?.tier).toBe("tool"); // the real proof, not just a same-shaped Tier 0 win
  });

  test("runTurnStream(): an ordinary reply (tools offered, model answers in plain text) streams normally, first delta included", async () => {
    const { actor } = await owner();
    // Same non-"remember"-prefixed shape as the two tests above, so this
    // utterance genuinely reaches Tier 2 (offered as a tool) rather than
    // winning Tier 0's own literal pattern outright - the scripted stub
    // has no scriptedToolCalls at all here, so it always falls through
    // to its default echo reply, exactly like a real model that looked
    // at the offered tools and answered in plain text instead.
    const result = await runTurnStream(actor, "chat", "Friday is pizza night, please remember - and tell me a bit about your day too");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("stream"); // proves this did NOT resolve as a tool call
    if (result.kind !== "stream") return;
    const deltas: string[] = [];
    for await (const delta of result.tokens) deltas.push(delta);
    expect(deltas.length).toBeGreaterThan(0);
  });

  // Jesse, live-found 2026-09-07: "what's the latest stephen king novel"
  // never got offered `websearch` at all - 0.66 against a 0.68 floor,
  // one keyword-choice away from the next miss regardless of how many
  // examples websearch's own manifest carries. `websearch` is now
  // ALWAYS offered (prepareTurn(), turnEngine.ts) regardless of its own
  // embedding score, letting the model's own native judgment decide -
  // proven here with an utterance that shares essentially no vocabulary
  // with anything (would score near zero under every candidate,
  // including websearch, under the stub's own bag-of-words scorer),
  // confirming this isn't the usual floor-clearing offer at all.
  test("runTurn(): websearch is offered even when nothing (including websearch itself) clears the ordinary Tier 2 floor", async () => {
    const { actor } = await owner();
    // Recorded independently of whether websearch's own real recipe
    // execution succeeds in this test env (no SearXNG configured) -
    // the offer itself is what's under test, not the resolution
    // outcome, so this can't pass or fail vacuously on that unrelated
    // failure the way asserting on the final TurnValue alone could.
    let sawWebsearchOffered = false;
    await withScriptedToolCalls(
      (request) => {
        if (request.tools?.some((t) => t.function.name === "websearch")) sawWebsearchOffered = true;
        return undefined; // let the stub's default echo answer either way
      },
      () => runTurn(actor, "chat", "good morning"),
    );
    expect(sawWebsearchOffered).toBe(true);
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
