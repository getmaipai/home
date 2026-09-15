// REP-01 (docs/dev.md section 16 part 3; docs/dev/session-a.md
// "REP-01"): the cross-turn repetition guard and the objection. A
// sentence said in either of the previous two replies is skipped
// (repeat_sentence); a reply that says the same again in other words
// is the chat-loop case (repeat_reply); a reply the read emptied takes
// REG-01's retry with REPEAT_RETRY_NOTE, then the chat-loop line; on an
// objection a bare assertion of understanding is cut (self_assertion)
// and the retry note carries the objection. The exemptions are by
// construction: the guards read the model's text only (a fixed line
// the engine repeats, a package's deterministic answer and a re-asked
// confirmation never pass through them), and a reply of two words or
// fewer is never a repeat.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurn, runTurnStream } from "@/lib/turnEngine";
import { guardReply, guardSentence, isRepeatReply, normalizeForRepeat, REPEAT_RETRY_NOTE, repeatRetryNote, isObjectionTurn, repeatRequested, type GuardContext } from "@/lib/guards";
import { createConversation } from "@/lib/conversationHistory";
import { db } from "@/db";
import { people, conversationTurns } from "@/db/schema";
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

describe("the shapes", () => {
  test("normalizeForRepeat(): case, punctuation and whitespace collapse; a closer and a two-word sentence are nothing", () => {
    expect(normalizeForRepeat("The dentist is Tuesday at four!")).toBe("the dentist is tuesday at four");
    expect(normalizeForRepeat("  the DENTIST is  Tuesday, at four.")).toBe("the dentist is tuesday at four");
    expect(normalizeForRepeat("Let me know if you need anything else.")).toBeNull();
    expect(normalizeForRepeat("Sounds good.")).toBeNull();
    // The engine's own fixed lines are never a repeat (the emptied line
    // said twice to the same question asked twice; the honesty bank).
    expect(normalizeForRepeat("I'm not sure about that one.")).toBeNull();
    expect(normalizeForRepeat("That lookup didn't work, sorry.")).toBeNull();
    expect(guardReply("I don't know that one, sorry.", ctx({ previousReplies: ["I don't know that one, sorry."] })).reason).toBeNull();
  });
  test("repeat_sentence: a sentence in either of the previous two replies is skipped and the rest stands", () => {
    const g = guardReply("The dentist is Tuesday at four. Want me to set a reminder?", ctx({ previousReplies: ["The dentist is Tuesday at four."] }));
    expect([g.reason, g.replaced, g.reply]).toEqual(["repeat_sentence", false, "Want me to set a reminder?"]);
    const two = guardReply("Rover's vet is Wednesday morning. The dentist is Tuesday at four.", ctx({ previousReplies: ["Okay.", "The dentist is Tuesday at four."] }));
    expect([two.reason, two.reply]).toEqual(["repeat_sentence", "Rover's vet is Wednesday morning."]);
    // Three replies back is out of the read.
    expect(guardReply("The dentist is Tuesday at four.", ctx({ previousReplies: ["Okay.", "Sure thing, noted for Tuesday."] })).reason).toBeNull();
  });
  test("a reply the repeat read emptied is the whole-reply case: the chat-loop line, marked emptied for the retry", () => {
    const g = guardReply("The dentist is Tuesday at four.", ctx({ previousReplies: ["The dentist is Tuesday at four."] }));
    expect([g.reason, g.replaced, g.emptied]).toEqual(["repeat_reply", true, true]);
    expect(g.reply).toMatch(/same answer|circles|stuck on that/i);
  });
  test("repeat_reply: the same reply in other words; a new number or a new proper noun is new information; a narrowed follow-up is not the same reply; two words are never a repeat", () => {
    const previous = ["The film comes out in October with Serena Vale as the keeper."];
    const u = { utterance: "ok" };
    expect(isRepeatReply("The film comes out in October, with Serena Vale as the keeper.", { ...u, previousReplies: previous })).toBe(true);
    expect(isRepeatReply("The film comes out in October with Serena Vale as the keeper and runs 94 minutes.", { ...u, previousReplies: previous })).toBe(false);
    expect(isRepeatReply("The film comes out in October with Serena Vale and Vincent Marlow.", { ...u, previousReplies: previous })).toBe(false);
    expect(isRepeatReply("The film's cast and its October date are what I have; the runtime I don't.", { ...u, previousReplies: previous })).toBe(false);
    // A narrowed follow-up (one of three things asked) is not the same reply (a review).
    expect(isRepeatReply("Serena Vale is the keeper, and it comes out October 17.", { ...u, previousReplies: ["The cast is Serena Vale, Vincent Marlow and Nadia Quill; it runs 94 minutes and comes out October 17."] })).toBe(false);
    // A sentence split in two is still the same reply ("It" is no proper noun; a review).
    expect(isRepeatReply("The film is out October 17. It stars Serena Vale.", { ...u, previousReplies: ["The film is out October 17 and stars Serena Vale."] })).toBe(true);
    expect(isRepeatReply("Sounds good.", { ...u, previousReplies: ["Sounds good."] })).toBe(false);
    expect(guardReply("Sounds good.", ctx({ previousReplies: ["Sounds good."], act: "inform" })).reason).toBeNull();
    const g = guardReply("The film comes out in October, with Serena Vale as the keeper.", ctx({ previousReplies: previous, utterance: "right, and so" }));
    expect([g.reason, g.emptied]).toEqual(["repeat_reply", true]);
  });
  test("the review's cases: an opener ahead of a repeated fact is the whole-reply case, whatever the opener; a clause span of a long previous sentence is the repeat; a number is content twice over", () => {
    const previous = ["The dentist is Tuesday at four."];
    const opener = guardReply("Sure thing! The dentist is Tuesday at four.", ctx({ previousReplies: previous }));
    expect([opener.reason, opener.emptied]).toEqual(["repeat_reply", true]);
    const register = guardReply("Happy to help. The dentist is Tuesday at four.", ctx({ previousReplies: previous }));
    expect([register.reason, register.emptied]).toEqual(["repeat_reply", true]);
    // A longer sentence the chunker hands over as clause spans.
    const long = ["The new Marsh Lantern film comes out on October 17 and stars Serena Vale, Vincent Marlow and Nadia Quill as the lighthouse crew."];
    expect(guardSentence("The new Marsh Lantern film comes out on October 17 and stars Serena Vale,", ctx({ previousReplies: long }), true)).toBe("repeat_sentence");
    expect(guardSentence("Vincent Marlow and Nadia Quill as the lighthouse crew.", ctx({ previousReplies: long }), false)).toBe("repeat_sentence");
    expect(guardSentence("Serena Vale plays the keeper.", ctx({ previousReplies: long }), true)).toBeNull();
    // A global regex's lastIndex never decides the next sentence.
    const objection = ctx({ utterance: "you're not listening, I asked what time", target: "hub", repair: "correction" });
    expect(guardReply("I get it, 4.", objection).reason).toBeNull();
    expect(guardReply("I get it, 5.", objection).reason).toBeNull();
  });

  test("a repeat the person asked for is the one time the same reply is right: neither shape reads it (the say-that-again row)", () => {
    for (const ask of ["say that again", "sorry, what?", "what?", "come again", "one more time", "could you repeat that", "I didn't catch that"]) expect(repeatRequested(ask)).toBe(true);
    expect(repeatRequested("what day of the week")).toBe(false);
    const previous = ["The capital of Portugal is Lisbon."];
    expect(guardReply("The capital of Portugal is Lisbon.", ctx({ previousReplies: previous, utterance: "say that again", act: "directive" })).reason).toBeNull();
    expect(guardReply("The capital of Portugal is Lisbon.", ctx({ previousReplies: previous, utterance: "sorry, what?" })).reason).toBeNull();
  });
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
    expect(repeatRetryNote(objection)).toContain("They said: \"you're not following me\"");
    expect(repeatRetryNote(ctx())).toBe(REPEAT_RETRY_NOTE);
  });
});

async function withReplies<T>(reply: (request: ChatCompletionRequest, noted: string | null) => string, fn: (seen: { notes: (string | null)[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { notes: [] as (string | null)[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      const note = [...request.messages].reverse().find((m) => m.role === "system" && typeof m.content === "string" && (m.content.startsWith(REPEAT_RETRY_NOTE) || m.content.startsWith("Nothing was asked")));
      const noted = note && typeof note.content === "string" ? note.content : null;
      seen.notes.push(noted);
      return reply(request, noted);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  try {
    return await fn(seen);
  } finally {
    stub.stop();
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

describe("the engine, both paths", () => {
  test("blocking path: the same sentence again is emptied, the retry carries REPEAT_RETRY_NOTE and its reply stands; a retry that repeats too leaves the chat-loop line", async () => {
    const { actor } = await owner();
    await withReplies((_r, noted) => (noted ? "A lighthouse keeper on a rock; the 17th is a Friday." : "The film follows a lighthouse keeper, out October 17."), async (seen) => {
      const first = await runTurn(actor, "chat", "what's the new Marsh Lantern film about");
      if (!first.ok) throw new Error(first.error);
      expect(first.value.reply.text).toBe("The film follows a lighthouse keeper, out October 17.");
      const second = await runTurn(actor, "chat", "that's the second time; I asked what day of the week", { conversationId: first.value.conversation_id });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.reply.text).toBe("A lighthouse keeper on a rock; the 17th is a Friday.");
      expect(seen.notes.at(-1)).toContain(REPEAT_RETRY_NOTE);
      expect(seen.notes.at(-1)).toContain("They said:");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, second.value.turn_id)).get()!;
      expect(row.guardReason).toBeNull(); // the retry's good reply stands, nothing replaced
    });
    await withReplies(() => "The film follows a lighthouse keeper, out October 17.", async (seen) => {
      const fresh = createConversation(actor, { surface: "chat" });
      if (!fresh.ok || !fresh.value) throw new Error("no conversation");
      const first = await runTurn(actor, "chat", "what is it about again", { conversationId: fresh.value.id });
      if (!first.ok) throw new Error(first.error);
      const second = await runTurn(actor, "chat", "right, and so", { conversationId: first.value.conversation_id });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.reply.text).toMatch(/same answer|circles|stuck on that/i);
      expect(seen.notes.filter((n) => n?.startsWith(REPEAT_RETRY_NOTE))).toHaveLength(1);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, second.value.turn_id)).get()!;
      expect(row.guardReason).toBe("repeat_reply");
    });
  });

  test("streaming path: a repeated opening never reaches the wire, the retry runs with the note, the row carries repeat_reply when the retry repeats too", async () => {
    const { actor } = await owner();
    await withReplies((_r, noted) => (noted ? "A keeper on a rock, and the 17th is a Friday." : "The film follows a lighthouse keeper, out October 17."), async (seen) => {
      const first = await runTurn(actor, "chat", "what's the new Marsh Lantern film about");
      if (!first.ok) throw new Error(first.error);
      const result = await runTurnStream(actor, "chat", "that's the second time; I asked what day of the week", { conversationId: first.value.conversation_id });
      if (!result.ok || result.kind !== "stream") throw new Error("no stream");
      const deltas: string[] = [];
      for await (const delta of result.tokens) deltas.push(delta);
      expect(deltas.join("").trim()).toBe("A keeper on a rock, and the 17th is a Friday.");
      expect(seen.notes.at(-1)).toContain(REPEAT_RETRY_NOTE);
      result.finalize(deltas.join(""));
    });
    await withReplies(() => "The film follows a lighthouse keeper, out October 17.", async () => {
      const fresh = createConversation(actor, { surface: "chat" });
      if (!fresh.ok || !fresh.value) throw new Error("no conversation");
      const first = await runTurn(actor, "chat", "what is it about again", { conversationId: fresh.value.id });
      if (!first.ok) throw new Error(first.error);
      const result = await runTurnStream(actor, "chat", "right, and so", { conversationId: first.value.conversation_id });
      if (!result.ok || result.kind !== "stream") throw new Error("no stream");
      const deltas: string[] = [];
      for await (const delta of result.tokens) deltas.push(delta);
      expect(deltas.join("").trim()).toMatch(/same answer|circles|stuck on that/i);
      const value = result.finalize(deltas.join(""));
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()!;
      expect(row.guardReason).toBe("repeat_reply");
    });
  });

  test("streaming path: the same reply in other words streams (no sentence repeats) and the end-of-stream read records repeat_reply on the row's guard array", async () => {
    const { actor } = await owner();
    await withReplies((r) => (r.messages.filter((m) => m.role === "assistant").length === 0 ? "The film is out October 17 and stars Serena Vale." : "The film stars Serena Vale and is out October 17."), async () => {
      const first = await runTurn(actor, "chat", "what's the new Marsh Lantern film about");
      if (!first.ok) throw new Error(first.error);
      const lines: string[] = [];
      const original = console.log;
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
        original(...args);
      };
      try {
        const result = await runTurnStream(actor, "chat", "right, and so", { conversationId: first.value.conversation_id });
        if (!result.ok || result.kind !== "stream") throw new Error("no stream");
        const deltas: string[] = [];
        for await (const delta of result.tokens) deltas.push(delta);
        expect(deltas.join("").trim()).toBe("The film stars Serena Vale and is out October 17.");
        const value = result.finalize(deltas.join(""));
        const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()!;
        expect(row.guardReason).toBeNull();
        const turn = lines.filter((l) => l.startsWith("[turn] {")).map((l) => JSON.parse(l.slice(7)) as { guard: string[] }).at(-1)!;
        expect(turn.guard).toContain("repeat_reply");
      } finally {
        console.log = original;
      }
    });
  });

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

  test("the exemptions by construction: a two-word acknowledgment twice stands, and a new number is new information", async () => {
    const { actor } = await owner();
    await withReplies(() => "Sounds good.", async (seen) => {
      const first = await runTurn(actor, "chat", "we're doing pizza tonight");
      if (!first.ok) throw new Error(first.error);
      const second = await runTurn(actor, "chat", "and a film after", { conversationId: first.value.conversation_id });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.reply.text).toBe("Sounds good.");
      expect(seen.notes.every((n) => n === null)).toBe(true);
    });
    await withReplies((r) => (String([...r.messages].reverse().find((m) => m.role === "user")?.content ?? "").includes("time") ? "The dentist is Tuesday at 4." : "The dentist is Tuesday."), async () => {
      const fresh = createConversation(actor, { surface: "chat" });
      if (!fresh.ok || !fresh.value) throw new Error("no conversation");
      const first = await runTurn(actor, "chat", "when is the dentist", { conversationId: fresh.value.id });
      if (!first.ok) throw new Error(first.error);
      const second = await runTurn(actor, "chat", "and the time", { conversationId: first.value.conversation_id });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.reply.text).toBe("The dentist is Tuesday at 4.");
    });
  });
});
