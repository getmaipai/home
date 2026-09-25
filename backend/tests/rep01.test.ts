// Objection handling: a bare assertion of understanding is cut
// (self_assertion), and the retry note carries the objection.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurn } from "@/lib/turnEngine";
import { guardReply, OBJECTION_RETRY_NOTE, objectionRetryNote, isObjectionTurn, type GuardContext } from "@/lib/guards";
import { db } from "@/db";
import { people } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}

const ctx = (overrides: Partial<GuardContext> = {}): GuardContext => ({ utterance: "when is the dentist", personId: "person-test", act: "question", ...overrides });

describe("the objection shape", () => {
  test("self_assertion: on an objection a bare assertion of understanding is cut; one that carries the subject stands; off an objection it is the model's", () => {
    const objection = ctx({ utterance: "you're not following me", target: "hub", repair: "correction", act: "inform" });
    expect(isObjectionTurn(objection)).toBe(true);
    expect(isObjectionTurn(ctx({ utterance: "that's the second time; I asked what day of the week" }))).toBe(true);
    expect(isObjectionTurn(ctx({ utterance: "what day of the week is it out" }))).toBe(false);
    expect(guardReply("I do get it.", objection).reason).toBe("self_assertion");
    expect(guardReply("I'm not repeating myself.", objection).reason).toBe("self_assertion");
    expect(guardReply("I do get it, the dentist is Friday now.", ctx({ utterance: "you're not following me, the dentist moved to Friday", target: "hub", repair: "correction", act: "inform" })).reason).toBeNull();
    // The answer itself is content, grounded or not ("it's a Friday", "it's at 4"; a review).
    expect(guardReply("I hear you, it's a Friday.", ctx({ utterance: "you're not following me, what day of the week", target: "hub", repair: "correction" })).reason).toBeNull();
    expect(guardReply("I do get it, it's at 4.", ctx({ utterance: "you're not listening, I asked what time", target: "hub", repair: "correction" })).reason).toBeNull();
    expect(guardReply("I do get it.", ctx({ utterance: "the dentist moved to Friday", act: "inform" })).reason).toBeNull();
    // A retraction aimed at the hub objects to nothing (the design says correction).
    expect(isObjectionTurn(ctx({ utterance: "never mind, forget it", target: "hub", repair: "retraction" }))).toBe(false);
    expect(objectionRetryNote(objection)).toContain("They said: \"you're not following me\"");
    expect(objectionRetryNote(ctx())).toBe(OBJECTION_RETRY_NOTE);
  });
});

async function withReplies<T>(reply: (request: ChatCompletionRequest, noted: string | null) => string, fn: (seen: { notes: (string | null)[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { notes: [] as (string | null)[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      const note = [...request.messages].reverse().find((m) => m.role === "system" && typeof m.content === "string" && (m.content.startsWith(OBJECTION_RETRY_NOTE) || m.content.startsWith("Nothing was asked")));
      const noted = note && typeof note.content === "string" ? note.content : null;
      seen.notes.push(noted);
      return reply(request, noted);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn(seen);
  } finally {
    await stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

describe("the objection retry", () => {
  test("the objection: 'I do get it' is cut, the retry carries the objection, and its answer stands", async () => {
    const { actor } = await owner();
    await withReplies((_r, noted) => (noted ? "You're right, I skipped the plot: a lighthouse keeper on a rock through one winter." : "I do get it."), async (seen) => {
      const first = await runTurn(actor, "chat", "what's the new Marsh Lantern film about");
      if (!first.ok) throw new Error(first.error);
      const second = await runTurn(actor, "chat", "you're not following me", { conversationId: first.value.conversation_id });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.reply.text).not.toMatch(/i do get it/i);
      expect(second.value.reply.text).toContain("lighthouse keeper");
      expect(seen.notes.at(-1)).toContain("They said: \"you're not following me\"");
    });
  });

});
