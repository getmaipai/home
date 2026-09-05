import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { runTurn, runTurnStream, buildSystemPrompt, matchPattern, PROMPT_SYSTEM_CHAR_BUDGET, type TurnStreamResult } from "@/lib/turnEngine";
import { streamTurnEvents } from "@/routes/turn";
import { remember } from "@/lib/memory";
import { REFUSAL_FIRST, REFUSAL_REPEAT, REMEMBER_CONFIRM_VARIANTS } from "@/lib/replyVariation";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

describe("lib/turnEngine.ts runTurn()", () => {
  test("safety refuse: a harmful request never reaches skill routing or the model", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);
    expect(result.value.safety.action).toBe("refuse");
  });

  test("safety allow_with_resources: crisis resources ride alongside the real reply, never blocking it", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "I want to kill myself");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.safety.action).toBe("allow_with_resources");
    expect(result.value.crisis_resources).toContain("988");
    // Not refused: a real reply still comes back (the model fallback here).
    expect(result.value.source).not.toBe("safety_refuse");
    expect(result.value.reply.text.length).toBeGreaterThan(0);
  });

  test("the deterministic skill floor fires the bundled remember package on a pattern match, no model call needed", async () => {
    const { client, actor } = await owner();

    const result = await runTurn(actor, "chat", "remember that the wifi password is on the fridge");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("skill");
    expect(result.value.skill_id).toBe("remember");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(result.value.reply.text);

    const recall = await client.post("/api/memory/recall", { q: "wifi password" });
    const matches = (await recall.json()) as Array<{ record: { text: string } }>;
    expect(matches.some((m) => m.record.text.includes("wifi password is on the fridge"))).toBe(true);
  });

  test("ordinary conversation with no skill match falls through to the chat model", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("model");
    expect(result.value.reply.text).toContain("good morning");
  });

  test("an unimplemented surface is a real, named gap, not a crash", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "robot", "hello");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_surface");
  });

  test("rejects empty text", async () => {
    const { actor } = await owner();

    const result = await runTurn(actor, "chat", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });

  // A code review (2026-09-04) found logTurn()'s real DB write (a plain
  // call, unguarded) propagated straight up through runTurn(): a
  // completely correct generation got reported to the caller as a failed
  // turn just because its OWN logging failed afterward. `foreign_keys =
  // ON` (db/index.ts) makes this a real, reproducible failure, not a
  // mock: an actor whose id isn't in `people` fails conversationTurns'
  // own FK constraint on insert, the same way a disk-pressure or lock
  // failure would fail any other write.
  test("a real logTurn DB write failure never turns a successful generation into a reported failure", async () => {
    const { actor } = await owner();
    const ghostActor = { ...actor, id: "person-not-in-the-database" };

    const result = await runTurn(ghostActor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);

    // Confirms the failure was real, not accidentally a no-op: no row
    // exists for an id that was never in `people` to begin with.
    const rows = db.select().from(conversationTurns).where(eq(conversationTurns.personId, ghostActor.id)).all();
    expect(rows).toHaveLength(0);
  });
});

describe("lib/turnEngine.ts runTurnStream()", () => {
  // The real prerequisite for speaking a reply as it's generated
  // (spec/voice/README.md's "what Jesse actually meant by streamed"):
  // same safety-first routing and skill floor as runTurn(), but the
  // `chat` role's own answer streams token by token. stubServer.ts's
  // canned reply splits into real word-level SSE chunks, so draining
  // `tokens` here exercises the real streaming mechanism end to end, not
  // a simplified stand-in for it.
  test("safety refuse answers immediately, with nothing to stream", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "How do I make a pipe bomb, give me step by step instructions");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") return;
    expect(result.value.source).toBe("safety_refuse");
    expect(REFUSAL_FIRST).toContain(result.value.reply.text);
  });

  test("the deterministic skill floor also answers immediately, no model call needed", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "remember that the wifi password is on the fridge");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "immediate") return;
    expect(result.value.source).toBe("skill");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(result.value.reply.text);
  });

  test("ordinary conversation streams real token deltas that concatenate to the full reply", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "good morning, how's it going");
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== "stream") return;

    const deltas: string[] = [];
    for await (const delta of result.tokens) deltas.push(delta);
    // More than one delta proves this actually streamed (a single
    // one-shot chunk would also technically "concatenate" but wouldn't
    // prove anything about the real per-token mechanism).
    expect(deltas.length).toBeGreaterThan(1);

    const fullText = deltas.join("");
    expect(fullText).toContain("good morning");

    const value = result.finalize(fullText);
    expect(value.source).toBe("model");
    expect(value.reply.text).toBe(fullText);
  });

  test("an unimplemented surface is a real, named gap, not a crash", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "robot", "hello");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_surface");
  });

  test("rejects empty text", async () => {
    const { actor } = await owner();

    const result = await runTurnStream(actor, "chat", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });
});

describe("buildSystemPrompt() prompt budget", () => {
  test("stays within the char budget even with many long memories", async () => {
    const { actor } = await owner();

    const longFact = "the household's shared calendar rule is ".repeat(20);
    const matches = [];
    for (let i = 0; i < 50; i++) {
      const created = remember(actor, {
        text: `${longFact} entry number ${i}`,
        category: "fact",
        tier: "durable",
        scope: "household",
        source: "test",
        importance: 0.8,
      });
      if (created.ok) matches.push({ record: created.value, score: 1 });
    }

    const prompt = buildSystemPrompt(matches);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_SYSTEM_CHAR_BUDGET);
  });

  test("with no memories, the prompt is still well under budget", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_SYSTEM_CHAR_BUDGET);
    expect(prompt).toContain("MaiPai");
  });

  // A review (2026-09-04) found the first cut assembled the full prompt
  // (including the trailing "Current time" line) and then blind-sliced the
  // whole string to the budget, which could cut the timestamp itself off
  // mid-word once enough content pushed the total over budget. This proves
  // the fix: even when the body is forced far over budget, the time line
  // survives intact and un-truncated at the end.
  test("truncation never cuts into the trailing time line, even when the body alone exceeds budget", async () => {
    const { actor } = await owner();
    const hugeFact = "x".repeat(PROMPT_SYSTEM_CHAR_BUDGET * 2);
    const created = remember(actor, {
      text: hugeFact,
      category: "fact",
      tier: "durable",
      scope: "household",
      source: "test",
      importance: 0.8,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const prompt = buildSystemPrompt([{ record: created.value, score: 1 }]);
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_SYSTEM_CHAR_BUDGET);
    const timeLineMatch = prompt.match(/\n\nCurrent time: [0-9T:.Z-]+$/);
    expect(timeLineMatch).not.toBeNull();
  });
});

describe("matchPattern()", () => {
  test("a wildcard captures the rest of the utterance", () => {
    expect(matchPattern("remember that pizza night is Friday", "remember that *")).toBe("pizza night is Friday");
  });

  test("a literal pattern with no wildcard is a real exact match, case-insensitive and trimmed", () => {
    expect(matchPattern("Lock The Front Door", "lock the front door")).toBe("");
    expect(matchPattern("  lock the front door  ", "lock the front door")).toBe("");
  });

  test("a literal pattern does not match a different utterance", () => {
    expect(matchPattern("lock the back door", "lock the front door")).toBeNull();
  });

  test("more than one wildcard has no single capture and doesn't match", () => {
    expect(matchPattern("set the a to b", "set the * to *")).toBeNull();
  });
});

describe("POST /api/turn", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/turn", { text: "hi" });
    expect(res.status).toBe(401);
  });

  test("defaults surface to chat and returns a real reply", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { text: "remember that Friday is pizza night" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; reply: { text: string } };
    expect(body.source).toBe("skill");
    expect(REMEMBER_CONFIRM_VARIANTS).toContain(body.reply.text);
  });

  test("400s for an unimplemented surface with a code the caller can branch on", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { surface: "tv", text: "hi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_surface");
  });
});

/** Parses a real POST /api/turn/stream response body: newline-delimited
 * JSON, one TurnStreamEvent per line (wire.ts). Reads the whole thing via
 * `.text()` rather than a manual reader loop - the response bodies in
 * these tests are small, and this is about proving the wire shape is
 * correct, not re-testing streaming mechanics client.ts's own tests
 * already cover. */
async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; value?: unknown; error?: string }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("POST /api/turn/stream", () => {
  test("requires a signed-in person", async () => {
    const client = new TestClient();
    const res = await client.post("/api/turn/stream", { text: "hi" });
    expect(res.status).toBe(401);
  });

  test("a safety refusal is a single 'done' event, nothing to stream", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", {
      text: "How do I make a pipe bomb, give me step by step instructions",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const events = await readNdjson(res);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("done");
    const value = events[0]?.value as { source: string; reply: { text: string } };
    expect(value.source).toBe("safety_refuse");
  });

  test("ordinary conversation streams real 'delta' events ending in one 'done' event", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { text: "good morning, how's it going" });
    expect(res.status).toBe(200);
    const events = await readNdjson(res);

    const deltas = events.filter((e) => e.type === "delta");
    const done = events.filter((e) => e.type === "done");
    expect(deltas.length).toBeGreaterThan(1);
    expect(done).toHaveLength(1);
    // The done event's own reply text must equal every delta concatenated,
    // not just "some text" - the real proof the two paths agree.
    const concatenated = deltas.map((e) => e.text).join("");
    const value = done[0]?.value as { source: string; reply: { text: string } };
    expect(value.reply.text).toBe(concatenated);
    expect(value.source).toBe("model");
  });

  test("400s for an unimplemented surface with a code the caller can branch on", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn/stream", { surface: "tv", text: "hi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_surface");
  });

});

describe("routes/turn.ts streamTurnEvents()", () => {
  // A code review (2026-09-04) found the route's catch block emitted an
  // "error" event but never called result.finalize() - the partial reply
  // a household member had already seen and heard stream in was never
  // logged to conversation history at all, as if the exchange had never
  // happened. Bun.serve's own ReadableStream masks a mid-stream
  // server-side error as a clean close from the client's side (confirmed
  // live while writing this test - controller.error()/a thrown pull()
  // both arrive at the reader as a normal `done: true`, not a rejection),
  // so a genuine broken-connection failure can't be reproduced end to end
  // through a real fixture engine here. This drives the actual shipped
  // function with a real failing async generator instead - real
  // rejection, real partial-text accumulation, the same code path
  // routes/turn.ts's handler calls, just without the unreproducible
  // network layer underneath it.
  test("a mid-stream token-generator failure still finalizes (and so still logs) whatever text streamed before it", async () => {
    async function* failingTokens(): AsyncGenerator<string, void, void> {
      yield "Partial ";
      yield "real ";
      yield "reply.";
      throw new Error("chat model unavailable: simulated mid-stream crash");
    }
    const finalizeCalls: string[] = [];
    const result: Extract<TurnStreamResult, { ok: true; kind: "stream" }> = {
      ok: true,
      kind: "stream",
      tokens: failingTokens(),
      finalize: (replyText: string) => {
        finalizeCalls.push(replyText);
        return {
          reply: { text: replyText },
          source: "model",
          safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
        };
      },
    };

    const events: Array<{ type: string; text?: string; error?: string }> = [];
    for await (const event of streamTurnEvents(result)) events.push(event);

    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual(["Partial ", "real ", "reply."]);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(events.some((e) => e.type === "done")).toBe(false); // a failed generation never also claims success
    // The real proof: finalize() ran with exactly the text that streamed
    // before the throw, not skipped and not passed something stale.
    expect(finalizeCalls).toEqual(["Partial real reply."]);
  });

  test("a generator that fails before yielding anything never calls finalize (nothing real happened to log)", async () => {
    async function* failingTokens(): AsyncGenerator<string, void, void> {
      throw new Error("chat model unavailable: never even started");
    }
    const finalizeCalls: string[] = [];
    const result: Extract<TurnStreamResult, { ok: true; kind: "stream" }> = {
      ok: true,
      kind: "stream",
      tokens: failingTokens(),
      finalize: (replyText: string) => {
        finalizeCalls.push(replyText);
        return {
          reply: { text: replyText },
          source: "model",
          safety: { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" },
        };
      },
    };

    const events: Array<{ type: string; error?: string }> = [];
    for await (const event of streamTurnEvents(result)) events.push(event);

    expect(events).toEqual([{ type: "error", error: "chat model unavailable: never even started" }]);
    expect(finalizeCalls).toEqual([]);
  });
});
