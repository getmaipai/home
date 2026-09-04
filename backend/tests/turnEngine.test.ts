import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { runTurn, buildSystemPrompt, matchPattern, PROMPT_SYSTEM_CHAR_BUDGET } from "@/lib/turnEngine";
import { remember } from "@/lib/memory";
import { db } from "@/db";
import { people } from "@/db/schema";
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
    expect(result.value.reply.text).toBe("I can't help with that.");
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
    expect(result.value.reply.text).toBe("Got it, I'll remember that.");

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
    expect(body.reply.text).toBe("Got it, I'll remember that.");
  });

  test("400s for an unimplemented surface with a code the caller can branch on", async () => {
    const { client } = await owner();
    const res = await client.post("/api/turn", { surface: "tv", text: "hi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_surface");
  });
});
