// ASK-01 (docs/dev.md "The chat design pass" section 3; docs/dev/
// session-a.md "ASK-01"): the unknown-name rule through the engine.
// The appended ask on both paths, deduped against the model's own
// question and appended under the brief persona; the answer parser
// creating the entity through step 3a's paths; a cancel; an answer the
// parser cannot read; the judge's open question asked once at the end
// of the next reply, answered before it is asked, or declined for
// good; a candidate never rendered or recalled by its guessed kind.
// The scripted chat engine is the spec's stub server, as in
// tests/turnEngine.test.ts.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurn } from "@/lib/turnEngine";
import { getPendingAsk, resolveOrCreateConversation, listOpenQuestions, queueOpenQuestion, turnSubjectsOf } from "@/lib/conversationHistory";
import { ensureSubjectEntity, subjectLabel, subjectRosterFor } from "@/lib/subjects";
import { remember } from "@/lib/memory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people, entities, relationships, conversationTurns, memoryRecords, openQuestions } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
  // U6: the flip, decided (home/docs/dev.md, 2026-09-24) - the direct
  // runTurn() calls in this file are unaffected either way (old-path
  // code, called directly by import), but its own "streaming path"
  // cases go through routes/turn.ts, which does branch on the
  // setting - pinned explicitly now that old is no longer the default.
  setHouseholdSettingValue("turn.pipeline.next", false);
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

/** A scripted chat engine: `reply` answers every chat completion; the
 * requests it saw are kept so a test can read the context message. */
async function withChat<T>(reply: string | ((request: ChatCompletionRequest) => string), fn: (seen: { requests: ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { requests: [] as ChatCompletionRequest[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      seen.requests.push(request);
      return typeof reply === "function" ? reply(request) : reply;
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

// REP-01: a stub that said the same line on the previous turn would be
// read as a repeat, so a scripted reply varies after its first use.
const varied = (base: string): ((request: ChatCompletionRequest) => string) => {
  let n = 0;
  return () => (n++ === 0 ? base : "That's a new one on me, tell me more.");
};
const contextOf = (request: ChatCompletionRequest) => request.messages.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
const entityNamed = (name: string) => db.select().from(entities).where(and(eq(entities.name, name), isNull(entities.deletedAt))).get();
const subjectsOfTurn = (turnId: string) => turnSubjectsOf(db.select({ subjects: conversationTurns.subjects }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!);

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; value?: unknown }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("the engine's ask about a name it has never heard", () => {
  test("blocking path: the unknown line is in the context ahead of the memory section, the question is appended, the pending ask is who, the row carries the unresolved ref", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async (seen) => {
      const result = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("model");
      expect(result.value.reply.text).toBe("Sounds like a fun weekend. Who's Clover?");
      expect(getPendingAsk(result.value.conversation_id)).toMatchObject({ kind: "who", name: "Clover", prompt: "Who's Clover?" });
      const context = contextOf(seen.requests[0]!);
      expect(context).toContain("Names in this message you have never heard before: Clover.");
      expect(context.indexOf("never heard before")).toBeLessThan(context.indexOf("What you already know") === -1 ? context.length : context.indexOf("What you already know"));
      expect(subjectsOfTurn(result.value.turn_id)).toEqual([{ type: "unresolved", surface_form: "Clover", candidate_kinds: [], provenance: result.value.turn_id, confidence: 0.8, carried_question: null }]);
    });
  });

  test("streaming path: the question is the last delta before done, and the done value carries it", async () => {
    const { client } = await owner();
    await withChat("Sounds like a fun weekend.", async () => {
      const res = await client.post("/api/turn/stream", { text: "Clover borrowed our tent for the weekend" });
      const events = await readNdjson(res);
      const deltas = events.filter((e) => e.type === "delta").map((e) => e.text);
      expect(deltas[deltas.length - 1]).toBe(" Who's Clover?");
      const done = events.find((e) => e.type === "done")!.value as { reply: { text: string }; conversation_id: string };
      expect(done.reply.text).toBe("Sounds like a fun weekend. Who's Clover?");
      expect(getPendingAsk(done.conversation_id)).toMatchObject({ kind: "who", name: "Clover" });
    });
  });

  test("the model's own question about the name is the ask: nothing appended, the answer still binds", async () => {
    const { actor } = await owner();
    await withChat("Sounds fun. Who is Clover?", async () => {
      const result = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.reply.text).toBe("Sounds fun. Who is Clover?");
      expect(getPendingAsk(result.value.conversation_id)).toMatchObject({ kind: "who", name: "Clover" });
    });
  });

  test("a false-familiarity claim is replaced by the ask, and no second question follows it", async () => {
    const { actor } = await owner();
    await withChat("That's right, Nadia ran her marathon last spring.", async () => {
      const result = await runTurn(actor, "chat", "Nadia just got back from her first marathon");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.reply.text).toBe("I don't know Nadia yet, who's that?");
      expect(getPendingAsk(result.value.conversation_id)).toMatchObject({ kind: "who", name: "Nadia" });
    });
  });

  test("a name with a relation noun beside it, a bare proper noun, or a roster name is never asked about", async () => {
    const { actor } = await owner();
    await withChat("Nice.", async () => {
      for (const text of ["my coworker Quill likes seltzer", "what is the runtime of Cobra", "Sage is getting a treadmill for the office"]) {
        const result = await runTurn(actor, "chat", text);
        if (!result.ok) throw new Error(result.error);
        expect([text, result.value.reply.text]).toEqual([text, "Nice."]);
        expect(getPendingAsk(result.value.conversation_id)).toBeNull();
      }
    });
  });
});

describe("the answer to the ask", () => {
  test("a relative: a local person entity, a stated relative_of, pronouns she, the piano line in the description, the ask gone; the next turn's pronoun keeps the subject and the context carries the line", async () => {
    const { actor } = await owner();
    await withChat(varied("Sounds like a fun weekend."), async (seen) => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      const conversationId = first.value.conversation_id;
      const answer = await runTurn(actor, "chat", "my cousin Clover, she teaches piano", { conversationId });
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.value.source).toBe("confirm");
      expect(answer.value.reply.text).toBe("Got it, Clover is your cousin.");
      expect(seen.requests).toHaveLength(1); // no model call for the answer
      expect(getPendingAsk(conversationId)).toBeNull();
      const clover = entityNamed("Clover")!;
      expect(clover).toMatchObject({ kind: "person", source: "local", pronouns: "she", scope: "person", person: actor.id });
      expect(clover.description).toContain("teaches piano");
      const self = db.select().from(entities).where(eq(entities.accountPersonId, actor.id)).get()!;
      const edge = db.select().from(relationships).all().find((e) => e.type === "relative_of")!;
      expect(edge).toMatchObject({ fromId: self.id, toId: clover.id, source: "stated", statedByPersonId: actor.id });
      expect(subjectsOfTurn(answer.value.turn_id)).toEqual([{ type: "household", entity_id: clover.id, carried_question: null }]);
      expect(subjectLabel(actor, clover.id)).toBe("Clover (your relative)");
      expect(subjectRosterFor(actor)).toContain("Clover");

      const third = await runTurn(actor, "chat", "what should I get her as a thank-you", { conversationId });
      if (!third.ok) throw new Error(third.error);
      expect(subjectsOfTurn(third.value.turn_id)).toEqual([{ type: "household", entity_id: clover.id, carried_question: null }]);
      const context = contextOf(seen.requests[1]!);
      expect(context).toContain("Clover (your relative), she: cousin, she teaches piano");
      expect(context).not.toContain("never heard before");
      expect(third.value.reply.text).toBe("That's a new one on me, tell me more.");
      expect(getPendingAsk(conversationId)).toBeNull();
    });
  });

  test("a pet: kind from the noun, pronouns he, source local; a later she about him is skipped", async () => {
    const { actor } = await owner();
    await withChat((request) => (request.messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes("heat")) ? "She should stay in the shade. Rabbits overheat fast." : "Oh no."), async () => {
      const first = await runTurn(actor, "chat", "Juniper chewed through our garden hose again");
      if (!first.ok) throw new Error(first.error);
      const conversationId = first.value.conversation_id;
      expect(first.value.reply.text).toBe("Oh no. Who's Juniper?");
      const answer = await runTurn(actor, "chat", "he's our rabbit", { conversationId });
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.value.reply.text).toBe("Got it, Juniper is your rabbit.");
      expect(entityNamed("Juniper")).toMatchObject({ kind: "pet", source: "local", pronouns: "he" });
      expect(db.select().from(relationships).all().map((e) => e.type).sort()).toEqual(["owned_by", "owns"]);
      const third = await runTurn(actor, "chat", "should he be outside in this heat", { conversationId });
      if (!third.ok) throw new Error(third.error);
      expect(third.value.reply.text).toBe("Rabbits overheat fast.");
    });
  });

  test("a command in place of the answer routes as itself, and a question that only mentions the name is not the ask (a review)", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async (seen) => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      const conversationId = first.value.conversation_id;
      const command = await runTurn(actor, "chat", "add batteries to the shopping list", { conversationId });
      if (!command.ok) throw new Error(command.error);
      expect(command.value.source).not.toBe("confirm");
      expect(entityNamed("Clover")).toBeUndefined();
      expect(getPendingAsk(conversationId)).toBeNull();
      expect(seen.requests.length).toBeGreaterThanOrEqual(1);
    });
    await withChat("How is Clover doing today?", async () => {
      const result = await runTurn(actor, "chat", "Clover came by with our tent");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.reply.text).toBe("How is Clover doing today? Who's Clover?");
    });
  });

  test("'never mind' also declines the judge's twin question about the candidate, so nothing asks again (a review)", async () => {
    const { actor } = await owner();
    await withChat(varied("Sounds like a fun weekend."), async () => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      const conversationId = first.value.conversation_id;
      const guessed = ensureSubjectEntity(actor, { name: "Clover", kind: "person" }, false);
      if (!guessed.ok || !guessed.value) throw new Error(guessed.error);
      queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Clover?", subjectId: guessed.value.id, source: "turn-judge" });
      const cancel = await runTurn(actor, "chat", "never mind", { conversationId });
      if (!cancel.ok) throw new Error(cancel.error);
      // The twin and the engine's own recorded decline: both declined.
      expect(listOpenQuestions(actor.id).map((q) => q.status)).toEqual(["declined", "declined"]);
      const next = await runTurn(actor, "chat", "she brought it back today anyway", { conversationId });
      if (!next.ok) throw new Error(next.error);
      expect(next.value.reply.text).toBe("That's a new one on me, tell me more.");
    });
  });

  test("a sensitive entity's line never reaches a child's prompt (a review)", async () => {
    const { actor, client } = await owner();
    const made = await client.post("/api/entities", { kind: "person", name: "Willow", description: "Going through a divorce, keep it quiet.", sensitive: true, scope: "household" });
    expect(made.status).toBe(201);
    await client.post("/api/people", { displayName: "Bramble", role: "child", birthdate: "2018-04-02" });
    const child = db.select().from(people).where(eq(people.displayName, "Bramble")).get()!;
    await withChat("Okay.", async (seen) => {
      const asChild = await runTurn(child, "chat", "Willow is coming for dinner");
      if (!asChild.ok) throw new Error(asChild.error);
      expect(contextOf(seen.requests[0]!)).not.toContain("divorce");
      const asOwner = await runTurn(actor, "chat", "Willow is coming for dinner");
      if (!asOwner.ok) throw new Error(asOwner.error);
      expect(contextOf(seen.requests[1]!)).toContain("divorce");
    });
  });

  test("'never mind' clears the ask with no entity and no second ask (who-ask-declined)", async () => {
    const { actor } = await owner();
    await withChat(varied("Sounds like a fun weekend."), async (seen) => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      const conversationId = first.value.conversation_id;
      const cancel = await runTurn(actor, "chat", "never mind", { conversationId });
      if (!cancel.ok) throw new Error(cancel.error);
      expect(cancel.value).toMatchObject({ source: "confirm", reply: { text: "Okay, no problem." } });
      expect(getPendingAsk(conversationId)).toBeNull();
      expect(entityNamed("Clover")).toBeUndefined();
      const next = await runTurn(actor, "chat", "she brought it back today anyway", { conversationId });
      if (!next.ok) throw new Error(next.error);
      expect(next.value.reply.text).toBe("That's a new one on me, tell me more.");
      expect(getPendingAsk(conversationId)).toBeNull();
      expect(seen.requests).toHaveLength(2);
    });
  });

  test("an answer the parser cannot read falls through to the model with the ask cleared; the carried unknown keeps the line and asks nothing again (unknown-name-marathon)", async () => {
    const { actor } = await owner();
    await withChat((request) => (request.messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes("how would you know")) ? "I don't, you just told me. Sounds like a big day for her." : "That's right, Nadia ran her marathon last spring."), async (seen) => {
      const first = await runTurn(actor, "chat", "Nadia just got back from her first marathon");
      if (!first.ok) throw new Error(first.error);
      const conversationId = first.value.conversation_id;
      expect(first.value.reply.text).toBe("I don't know Nadia yet, who's that?");
      const second = await runTurn(actor, "chat", "wait, how would you know that?", { conversationId });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.source).toBe("model");
      expect(second.value.reply.text).toBe("I don't, you just told me. Sounds like a big day for her.");
      expect(getPendingAsk(conversationId)).toBeNull();
      expect(contextOf(seen.requests[1]!)).toContain("never heard before: Nadia");
      expect(subjectsOfTurn(second.value.turn_id)).toEqual([{ type: "unresolved", surface_form: "Nadia", candidate_kinds: [], provenance: first.value.turn_id, confidence: 0.8, carried_question: null }]);
      expect(entityNamed("Nadia")).toBeUndefined();
    });
  });
});

describe("the judge's open question: a candidate is never knowledge", () => {
  function candidate(actor: PersonRow, name: string, kind: "person" | "pet") {
    const made = ensureSubjectEntity(actor, { name, kind }, false);
    if (!made.ok || !made.value) throw new Error(made.error);
    return made.value;
  }

  test("asked once at the end of the next reply on any conversation, then answered: the candidate is confirmed local with the pronouns, the question answered", async () => {
    const { actor } = await owner();
    const juniper = candidate(actor, "juniper", "pet");
    const question = queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
    // The candidate is not a known name and has no label.
    expect(subjectRosterFor(actor)).not.toContain("juniper");
    expect(subjectLabel(actor, juniper.id)).toBeNull();
    await withChat("Warm and sunny all week.", async () => {
      const other = resolveOrCreateConversation(actor, "chat");
      if (!other.ok) throw new Error(other.error);
      const reply = await runTurn(actor, "chat", "what's the weather like this week", { conversationId: other.value.id });
      if (!reply.ok) throw new Error(reply.error);
      expect(reply.value.reply.text).toBe("Warm and sunny all week. Who's Juniper?");
      expect(listOpenQuestions(actor.id)[0]).toMatchObject({ id: question.id, status: "asked" });
      expect(getPendingAsk(other.value.id)).toMatchObject({ kind: "who", name: "juniper", subjectId: juniper.id, openQuestionId: question.id });
      const answer = await runTurn(actor, "chat", "he's our rabbit", { conversationId: other.value.id });
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.value.reply.text).toBe("Got it, juniper is your rabbit.");
      expect(entityNamed("juniper")).toMatchObject({ id: juniper.id, kind: "pet", source: "local", pronouns: "he", confirmedByPersonId: actor.id });
      expect(listOpenQuestions(actor.id)[0]).toMatchObject({ status: "answered" });
      expect(subjectRosterFor(actor)).toContain("juniper");
    });
  });

  test("'not now' declines it for good: never asked again (open-question-once)", async () => {
    const { actor } = await owner();
    const juniper = candidate(actor, "juniper", "pet");
    queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
    await withChat(varied("Warm and sunny."), async () => {
      const first = await runTurn(actor, "chat", "what's the weather like");
      if (!first.ok) throw new Error(first.error);
      expect(first.value.reply.text).toBe("Warm and sunny. Who's Juniper?");
      const decline = await runTurn(actor, "chat", "not now", { conversationId: first.value.conversation_id });
      if (!decline.ok) throw new Error(decline.error);
      expect(decline.value.reply.text).toBe("Okay, no problem.");
      expect(listOpenQuestions(actor.id)[0]).toMatchObject({ status: "declined" });
      const later = await runTurn(actor, "chat", "and tomorrow", { conversationId: first.value.conversation_id });
      if (!later.ok) throw new Error(later.error);
      expect(later.value.reply.text).toBe("That's a new one on me, tell me more.");
      expect(entityNamed("juniper")).toMatchObject({ source: "inferred" });
    });
  });

  test("answered before it is asked: a bare answer shape about the candidate is read on the conversation that raised it, and nothing asks again", async () => {
    const { actor } = await owner();
    const juniper = candidate(actor, "juniper", "pet");
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    queueOpenQuestion({ person: actor.id, conversationId: conv.value.id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
    await withChat("Okay.", async (seen) => {
      const answer = await runTurn(actor, "chat", "he's our rabbit", { conversationId: conv.value.id });
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.value).toMatchObject({ source: "confirm", reply: { text: "Got it, juniper is your rabbit." } });
      expect(seen.requests).toHaveLength(0);
      expect(listOpenQuestions(actor.id)[0]).toMatchObject({ status: "answered" });
      const next = await runTurn(actor, "chat", "should he be outside in this heat", { conversationId: answer.value.conversation_id });
      if (!next.ok) throw new Error(next.error);
      expect(next.value.reply.text).toBe("Okay.");
      expect(subjectsOfTurn(next.value.turn_id)).toEqual([{ type: "household", entity_id: juniper.id, carried_question: null }]);
      expect(contextOf(seen.requests[0]!)).toContain("juniper (yours), he");
    });
  });

  test("the engine's own ask, answered after the judge made its candidate: the candidate is the entity (confirmed or replaced), and the judge's question is answered too, never asked again (a review)", async () => {
    const { actor } = await owner();
    await withChat(varied("Sounds like a fun weekend."), async () => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      // The judge, between the ask and the answer: a person guessed.
      const guessed = candidate(actor, "Clover", "person");
      queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Clover?", subjectId: guessed.id, source: "turn-judge" });
      const answer = await runTurn(actor, "chat", "she's our rabbit", { conversationId: first.value.conversation_id });
      if (!answer.ok) throw new Error(answer.error);
      const rabbit = entityNamed("Clover")!;
      expect(rabbit).toMatchObject({ kind: "pet", source: "local", pronouns: "she" });
      expect(rabbit.id).not.toBe(guessed.id);
      expect(db.select().from(entities).where(and(isNull(entities.deletedAt), eq(entities.name, "Clover"))).all()).toHaveLength(1);
      expect(listOpenQuestions(actor.id).map((q) => q.status)).toEqual(["answered"]);
      const next = await runTurn(actor, "chat", "what should I get her as a thank-you", { conversationId: first.value.conversation_id });
      if (!next.ok) throw new Error(next.error);
      expect(next.value.reply.text).toBe("That's a new one on me, tell me more.");
    });
    // The same kind: the candidate is confirmed in place.
    await withChat("Sounds like a fun weekend.", async () => {
      const first = await runTurn(actor, "chat", "Nadia just got back from her first marathon");
      if (!first.ok) throw new Error(first.error);
      const guessed = candidate(actor, "Nadia", "person");
      queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Nadia?", subjectId: guessed.id, source: "turn-judge" });
      const answer = await runTurn(actor, "chat", "my cousin, she teaches piano", { conversationId: first.value.conversation_id });
      if (!answer.ok) throw new Error(answer.error);
      expect(entityNamed("Nadia")).toMatchObject({ id: guessed.id, kind: "person", source: "local", pronouns: "she", confirmedByPersonId: actor.id });
      expect(listOpenQuestions(actor.id).filter((q) => q.subjectId === guessed.id).map((q) => q.status)).toEqual(["answered"]);
    });
  });

  test("a pending question never consumes an ordinary statement (a review): 'my sister is visiting tomorrow' is the model's turn", async () => {
    const { actor } = await owner();
    const juniper = candidate(actor, "juniper", "pet");
    queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
    await withChat("That'll be nice.", async (seen) => {
      const result = await runTurn(actor, "chat", "my sister is visiting tomorrow");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.source).toBe("model");
      expect(seen.requests).toHaveLength(1);
      expect(db.select().from(relationships).all()).toHaveLength(0);
      expect(entityNamed("juniper")).toMatchObject({ source: "inferred" });
      // The question rides at the end of that reply instead.
      expect(result.value.reply.text).toBe("That'll be nice. Who's Juniper?");
    });
  });

  test("the set's read: a queued question whose name is on the turn goes first; a relationship question about a name not in play holds", async () => {
    const { actor } = await owner();
    const { writeRelation } = await import("@/lib/subjects");
    const clover = candidate(actor, "Clover", "person");
    const edge = writeRelation(actor, { type: "partner_of", name: "Clover", stated: false }, clover, "turn-judge", 0.5);
    if (!edge.ok || !edge.value) throw new Error(edge.error);
    const older = queueOpenQuestion({ person: actor.id, kind: "who", text: "Is Clover your partner?", subjectId: edge.value.id, source: "turn-judge" });
    const juniper = candidate(actor, "juniper", "pet");
    const newer = queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
    let n = 0;
    await withChat(() => ["Third time this week.", "Clear skies tonight.", "Dinner sounds lovely."][n++]!, async () => {
      const first = await runTurn(actor, "chat", "juniper chewed through the garden hose again");
      if (!first.ok) throw new Error(first.error);
      expect(first.value.reply.text).toBe("Third time this week. Who's Juniper?");
      expect(getPendingAsk(first.value.conversation_id)).toMatchObject({ openQuestionId: newer.id });
      const answer = await runTurn(actor, "chat", "he's our rabbit", { conversationId: first.value.conversation_id });
      if (!answer.ok) throw new Error(answer.error);
      expect(entityNamed("juniper")).toMatchObject({ kind: "pet", source: "local", pronouns: "he" });
      // Clover is not in play: the relationship question holds.
      const later = await runTurn(actor, "chat", "what's the weather like", { conversationId: first.value.conversation_id });
      if (!later.ok) throw new Error(later.error);
      expect(later.value.reply.text).toBe("Clear skies tonight.");
      expect(listOpenQuestions(actor.id).find((q) => q.id === older.id)).toMatchObject({ status: "pending" });
      // Named again, it is put.
      const named = await runTurn(actor, "chat", "Clover is coming for dinner", { conversationId: first.value.conversation_id });
      if (!named.ok) throw new Error(named.error);
      expect(named.value.reply.text).toBe("Dinner sounds lovely. Is Clover your partner?");
    });
  });

  test("the answer volunteered before the ask goes to the question in play, not the oldest one about somebody else (a review)", async () => {
    const { actor } = await owner();
    const { writeRelation } = await import("@/lib/subjects");
    const clover = candidate(actor, "Clover", "person");
    const edge = writeRelation(actor, { type: "partner_of", name: "Clover", stated: false }, clover, "turn-judge", 0.5);
    if (!edge.ok || !edge.value) throw new Error(edge.error);
    queueOpenQuestion({ person: actor.id, kind: "who", text: "Is Clover your partner?", subjectId: edge.value.id, source: "turn-judge" });
    await withChat("Third time this week.", async () => {
      const first = await runTurn(actor, "chat", "juniper chewed through the garden hose again");
      if (!first.ok) throw new Error(first.error);
      // The judge's question about juniper arrives after the reply, on this conversation.
      const juniper = candidate(actor, "juniper", "pet");
      const q = queueOpenQuestion({ person: actor.id, conversationId: first.value.conversation_id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
      const answer = await runTurn(actor, "chat", "he's our rabbit", { conversationId: first.value.conversation_id });
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.value.reply.text).toBe("Got it, juniper is your rabbit.");
      expect(listOpenQuestions(actor.id).find((x) => x.id === q.id)).toMatchObject({ status: "answered" });
      expect(entityNamed("juniper")).toMatchObject({ kind: "pet", source: "local", pronouns: "he" });
    });
  });

  test("a bare 'no' to a relationship question drops the guess (a review)", async () => {
    const { actor } = await owner();
    const { writeRelation } = await import("@/lib/subjects");
    const raven = candidate(actor, "Raven", "person");
    const edge = writeRelation(actor, { type: "colleague_of", name: "Raven", stated: false }, raven, "turn-judge", 0.5);
    if (!edge.ok || !edge.value) throw new Error(edge.error);
    queueOpenQuestion({ person: actor.id, kind: "who", text: "Is Raven your coworker?", subjectId: edge.value.id, source: "turn-judge" });
    // The set's read: the name is in play (said on the turn), so the
    // relationship question is put.
    await withChat("That sounds tiring.", async () => {
      const first = await runTurn(actor, "chat", "Raven ran the meeting today and it went long");
      if (!first.ok) throw new Error(first.error);
      const no = await runTurn(actor, "chat", "No", { conversationId: first.value.conversation_id });
      if (!no.ok) throw new Error(no.error);
      expect(no.value.reply.text).toBe("Okay, scratch that.");
      expect(db.select().from(relationships).where(eq(relationships.id, edge.value!.id)).get()!.deletedAt).not.toBeNull();
      expect(listOpenQuestions(actor.id)[0]).toMatchObject({ status: "answered" });
    });
  });

  test("a bare answer in another conversation is not a question's from elsewhere: the model's turn, the question asked at its end (a review)", async () => {
    const { actor } = await owner();
    const juniper = candidate(actor, "juniper", "pet");
    const { createConversation } = await import("@/lib/conversationHistory");
    const raised = createConversation(actor, { surface: "chat" });
    if (!raised.ok) throw new Error(raised.error);
    queueOpenQuestion({ person: actor.id, conversationId: raised.value.id, kind: "who", text: "Who's Juniper?", subjectId: juniper.id, source: "turn-judge" });
    const elsewhere = createConversation(actor, { surface: "chat" });
    if (!elsewhere.ok) throw new Error(elsewhere.error);
    await withChat("Nice.", async (seen) => {
      const other = await runTurn(actor, "chat", "she's a teacher", { conversationId: elsewhere.value.id });
      if (!other.ok) throw new Error(other.error);
      expect(other.value.source).toBe("model");
      expect(seen.requests).toHaveLength(1);
      expect(entityNamed("juniper")).toMatchObject({ source: "inferred" });
      expect(other.value.reply.text).toBe("Nice. Who's Juniper?");
    });
  });

  test("the About line and a memory bullet's label ground the reply: a role the prompt supplied is never cut as invented (a review)", async () => {
    const { actor } = await owner();
    const { writeRelation } = await import("@/lib/subjects");
    const quill = ensureSubjectEntity(actor, { name: "Quill", kind: "person" }, true);
    if (!quill.ok || !quill.value) throw new Error(quill.error);
    const edge = writeRelation(actor, { type: "colleague_of", name: "Quill", stated: true }, quill.value, "turn-t", 1);
    if (!edge.ok) throw new Error(edge.error);
    const record = remember(actor, { text: "Quill likes seltzer", category: "preference", tier: "durable", scope: "person", person: actor.id, source: "turn-t", importance: 0.7, subject_id: quill.value.id });
    if (!record.ok) throw new Error(record.error);
    await withChat("Quill is your coworker, the one who likes seltzer.", async (seen) => {
      const result = await runTurn(actor, "chat", "who is Quill");
      if (!result.ok) throw new Error(result.error);
      expect(contextOf(seen.requests[0]!)).toContain("Quill (your coworker)");
      expect(result.value.reply.text).toBe("Quill is your coworker, the one who likes seltzer.");
    });
    const juniper = ensureSubjectEntity(actor, { name: "Juniper", kind: "pet" }, true);
    if (!juniper.ok || !juniper.value) throw new Error(juniper.error);
    const { updateEntity } = await import("@/lib/entities");
    expect(updateEntity(actor, juniper.value.id, { description: "rabbit", pronouns: "he" }).ok).toBe(true);
    await withChat("Juniper is a rabbit, keep him inside.", async (seen) => {
      const result = await runTurn(actor, "chat", "Juniper looks hot today");
      if (!result.ok) throw new Error(result.error);
      expect(contextOf(seen.requests[0]!)).toContain("Juniper (a pet), he: rabbit");
      expect(result.value.reply.text).toBe("Juniper is a rabbit, keep him inside.");
    });
  });

  test("a question whose subject is gone lapses; a stale pending question lapses; a confirmed entity is never replaced by an answer (a review)", async () => {
    const { actor } = await owner();
    const gone = candidate(actor, "Clover", "person");
    const q = queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Clover?", subjectId: gone.id, source: "turn-judge" });
    const { deleteEntity } = await import("@/lib/entities");
    expect(deleteEntity(actor, gone.id).ok).toBe(true);
    const stale = candidate(actor, "Marlow", "person");
    const old = queueOpenQuestion({ person: actor.id, kind: "who", text: "Who's Marlow?", subjectId: stale.id, source: "turn-judge" });
    db.update(openQuestions).set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }).where(eq(openQuestions.id, old.id)).run();
    await withChat("Warm and sunny.", async () => {
      const result = await runTurn(actor, "chat", "what's the weather like");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.reply.text).toBe("Warm and sunny.");
      expect(getPendingAsk(result.value.conversation_id)).toBeNull();
      expect(listOpenQuestions(actor.id).find((x) => x.id === q.id)?.status).toBe("expired");
      expect(listOpenQuestions(actor.id).find((x) => x.id === old.id)?.status).toBe("expired");
    });
    // A confirmed person answered as a pet stays a person.
    const { updateEntity } = await import("@/lib/entities");
    const confirmed = candidate(actor, "Willow", "person");
    expect(updateEntity(actor, confirmed.id, { confirm: true }).ok).toBe(true);
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    queueOpenQuestion({ person: actor.id, conversationId: conv.value.id, kind: "who", text: "Who's Willow?", subjectId: confirmed.id, source: "turn-judge" });
    await withChat("Okay.", async () => {
      const answer = await runTurn(actor, "chat", "she's our dog", { conversationId: conv.value.id });
      if (!answer.ok) throw new Error(answer.error);
      expect(entityNamed("Willow")).toMatchObject({ id: confirmed.id, kind: "person", pronouns: "she" });
      expect(db.select().from(entities).where(and(isNull(entities.deletedAt), eq(entities.name, "Willow"))).all()).toHaveLength(1);
    });
  });

  test("the answer turn's signal is an inform, so the judge extracts from it (the set's pending-ask-who row); a confirmed entity of another kind keeps its kind and the reply says so (a review)", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async () => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      const answer = await runTurn(actor, "chat", "my cousin, she teaches piano", { conversationId: first.value.conversation_id });
      if (!answer.ok) throw new Error(answer.error);
      const { turnSignalOf } = await import("@/lib/conversationHistory");
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, answer.value.turn_id)).get()!;
      expect(turnSignalOf(row)?.primary_act).toBe("inform");
      expect(row.judgeStatus).toBeNull(); // queued for the judge, never skipped
    });
    const { updateEntity } = await import("@/lib/entities");
    const confirmed = candidate(actor, "Rivet", "pet");
    expect(updateEntity(actor, confirmed.id, { confirm: true }).ok).toBe(true);
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    queueOpenQuestion({ person: actor.id, conversationId: conv.value.id, kind: "who", text: "Who's Rivet?", subjectId: confirmed.id, source: "turn-judge" });
    await withChat("Okay.", async () => {
      const answer = await runTurn(actor, "chat", "he's my neighbor", { conversationId: conv.value.id });
      if (!answer.ok) throw new Error(answer.error);
      expect(answer.value.reply.text).toBe("Got it. I have Rivet down as a pet already, so I left that as it is.");
      const rivet = entityNamed("Rivet")!;
      expect(rivet).toMatchObject({ kind: "pet", pronouns: "he" });
      expect(db.select().from(relationships).all().filter((e) => e.deletedAt === null && (e.fromId === rivet.id || e.toId === rivet.id))).toHaveLength(0);
    });
  });

  test("a declined engine ask is remembered: the judge's later candidate for the name queues no question (a review's race)", async () => {
    const { actor } = await owner();
    await withChat("Sounds like a fun weekend.", async () => {
      const first = await runTurn(actor, "chat", "Clover borrowed our tent for the weekend");
      if (!first.ok) throw new Error(first.error);
      const cancel = await runTurn(actor, "chat", "never mind", { conversationId: first.value.conversation_id });
      if (!cancel.ok) throw new Error(cancel.error);
    });
    const { openQuestionDeclined } = await import("@/lib/conversationHistory");
    expect(openQuestionDeclined(actor.id, "Who's Clover?")).toBe(true);
    expect(listOpenQuestions(actor.id).map((x) => x.status)).toEqual(["declined"]);
  });

  test("a candidate of the wrong kind is replaced by the stated one: records re-pointed, the guess gone", async () => {
    const { actor } = await owner();
    const guessed = candidate(actor, "Juniper", "person");
    const record = remember(actor, { text: "Juniper chewed through the garden hose", category: "event", tier: "episodic", scope: "person", person: actor.id, source: "turn-judge", importance: 0.4, subject_id: guessed.id });
    if (!record.ok) throw new Error(record.error);
    const conv = resolveOrCreateConversation(actor, "chat");
    if (!conv.ok) throw new Error(conv.error);
    queueOpenQuestion({ person: actor.id, conversationId: conv.value.id, kind: "who", text: "Who's Juniper?", subjectId: guessed.id, source: "turn-judge" });
    await withChat("Okay.", async () => {
      const answer = await runTurn(actor, "chat", "he's our rabbit", { conversationId: conv.value.id });
      if (!answer.ok) throw new Error(answer.error);
      const rabbit = entityNamed("Juniper")!;
      expect(rabbit).toMatchObject({ kind: "pet", source: "local", pronouns: "he" });
      expect(rabbit.id).not.toBe(guessed.id);
      expect(db.select().from(entities).where(eq(entities.id, guessed.id)).get()!.deletedAt).not.toBeNull();
      expect(db.select({ subjectId: memoryRecords.subjectId }).from(memoryRecords).where(eq(memoryRecords.id, record.value!.id)).get()!.subjectId).toBe(rabbit.id);
    });
  });

  test("'yes' to a relationship question states the candidate edge and confirms its entity; 'no' drops the guess", async () => {
    const { actor } = await owner();
    const { writeRelation } = await import("@/lib/subjects");
    const raven = candidate(actor, "Raven", "person");
    const edge = writeRelation(actor, { type: "colleague_of", name: "Raven", stated: false }, raven, "turn-judge", 0.5);
    if (!edge.ok || !edge.value) throw new Error(edge.error);
    const question = queueOpenQuestion({ person: actor.id, kind: "who", text: "Is Raven your coworker?", subjectId: edge.value.id, source: "turn-judge" });
    // The set's read: the name is in play (said on the turn), so the
    // relationship question is put.
    await withChat("That sounds tiring.", async () => {
      const first = await runTurn(actor, "chat", "Raven ran the meeting today and it went long");
      if (!first.ok) throw new Error(first.error);
      expect(first.value.reply.text).toBe("That sounds tiring. Is Raven your coworker?");
      const yes = await runTurn(actor, "chat", "yes", { conversationId: first.value.conversation_id });
      if (!yes.ok) throw new Error(yes.error);
      expect(yes.value.reply.text).toBe("Got it.");
      expect(db.select().from(relationships).where(eq(relationships.id, edge.value!.id)).get()).toMatchObject({ source: "stated", statedByPersonId: actor.id });
      expect(entityNamed("Raven")).toMatchObject({ source: "local", confirmedByPersonId: actor.id });
      expect(listOpenQuestions(actor.id).find((q) => q.id === question.id)).toMatchObject({ status: "answered" });
    });
    // The other way: a fresh guess, refused.
    const marlow = candidate(actor, "Marlow", "person");
    const guess = writeRelation(actor, { type: "colleague_of", name: "Marlow", stated: false }, marlow, "turn-judge", 0.5);
    if (!guess.ok || !guess.value) throw new Error(guess.error);
    queueOpenQuestion({ person: actor.id, kind: "who", text: "Is Marlow your coworker?", subjectId: guess.value.id, source: "turn-judge" });
    await withChat("That sounds tiring.", async () => {
      const first = await runTurn(actor, "chat", "Marlow kept me on the phone all evening");
      if (!first.ok) throw new Error(first.error);
      const no = await runTurn(actor, "chat", "no, she's my sister", { conversationId: first.value.conversation_id });
      if (!no.ok) throw new Error(no.error);
      expect(no.value.reply.text).toBe("Got it, Marlow is your sister.");
      expect(db.select().from(relationships).where(eq(relationships.id, guess.value!.id)).get()!.deletedAt).not.toBeNull();
      expect(db.select().from(relationships).all().filter((e) => e.deletedAt === null && e.type === "sibling_of")).toHaveLength(1);
      expect(entityNamed("Marlow")).toMatchObject({ pronouns: "she", source: "local" });
    });
  });
});
