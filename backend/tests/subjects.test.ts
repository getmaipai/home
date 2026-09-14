// Step 3a: entities and subjects from conversation. The judge's subject
// writer (lib/subjects.ts) through judgeTurn(), the confirm transition
// on both PATCH routes, and what the chat prompt says about a subject.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetBackgroundSupervisorForTests } from "@/lib/backgroundSupervisor";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { judgeTurn } from "@/lib/memoryJudge";
import { recall, archiveByProvenance, forgetByIds, forget, supersede } from "@/lib/memory";
import { buildPromptParts } from "@/lib/turnEngine";
import { subjectLabel, subjectRosterFor } from "@/lib/subjects";
import { db } from "@/db";
import { people, conversationTurns, memoryRecords, entities, relationships } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnValue } from "@/wire";
import type { PersonRow } from "@/types";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetBackgroundSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
  delete process.env.MAIPAI_BACKGROUND_URL;
});

async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Marlow", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Marlow")).get()!;
  return { client, actor };
}

const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

function makeTurn(actor: PersonRow, userText: string, replyText: string) {
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("setup failed");
  const turnId = `turn-${Math.random().toString(36).slice(2, 12)}`;
  logTurn(actor, "chat", userText, { reply: { text: replyText }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
  return db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!;
}

async function withScriptedJudge<T>(reply: (schemaName: string | undefined, request: ChatCompletionRequest) => unknown, fn: () => Promise<T>): Promise<T> {
  __resetBackgroundSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      const schemaName = request.response_format?.type === "json_schema" ? request.response_format.json_schema.name : undefined;
      if (!schemaName) return undefined;
      return reply(schemaName, request);
    },
  });
  process.env.MAIPAI_BACKGROUND_URL = stub.url;
  try {
    return await fn();
  } finally {
    stub.stop();
  }
}

type Fact = Record<string, unknown>;
async function judgeWith(actor: PersonRow, userText: string, facts: Fact[]) {
  const turn = makeTurn(actor, userText, "Got it.");
  const result = await withScriptedJudge(
    (name) => (name === "extraction" || name?.includes("extract") ? { facts } : { facts, action: "ADD" }),
    () => judgeTurn(turn),
  );
  return { turn, result };
}

const QUILL_FACT = { text: "Quill likes seltzer", category: "preference", scope: "person", importance: 0.7, subject: { name: "Quill", kind: "person" } };

describe("the judge writes the entity a fact is about", () => {
  test("a stated coworker: a local entity, a stated colleague_of by the speaker with no confidence, and the record carries the subject", async () => {
    const { actor } = await owner();
    const { turn, result } = await judgeWith(actor, "my coworker Quill likes seltzer", [
      { ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } },
    ]);
    expect(result.factsWritten).toBe(1);

    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    expect(quill.kind).toBe("person");
    expect(quill.source).toBe("local");
    expect(quill.scope).toBe("person");
    expect(quill.person).toBe(actor.id);

    const record = db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!;
    expect(record.subjectId).toBe(quill.id);

    const self = db.select().from(entities).where(eq(entities.accountPersonId, actor.id)).get()!;
    // colleague_of is symmetric in the vocabulary: one edge, no inverse.
    const edges = db.select().from(relationships).all();
    expect(edges.map((e) => e.type)).toEqual(["colleague_of"]);
    const edge = edges.find((e) => e.fromId === self.id && e.toId === quill.id)!;
    expect(edge.source).toBe("stated");
    expect(edge.statedByPersonId).toBe(actor.id);
    expect(edge.confidence).toBeNull();
    expect(edge.confirmedByPersonId).toBeNull();
  });

  test("an inferred relation: source inferred, the importance as confidence, the turn as evidence, nobody named as having stated it", async () => {
    const { actor } = await owner();
    const { turn } = await judgeWith(actor, "Quill and I are grabbing lunch by the office again", [
      { ...QUILL_FACT, text: "Quill has lunch with Marlow near the office", importance: 0.6, relation: { type: "colleague_of", name: "Quill", stated: false } },
    ]);
    const edge = db.select().from(relationships).all().find((e) => e.type === "colleague_of" && e.person === actor.id)!;
    expect(edge.source).toBe("inferred");
    expect(edge.confidence).toBe(0.6);
    expect(JSON.parse(edge.evidence)).toEqual([turn.id]);
    expect(edge.statedByPersonId).toBeNull();
  });

  test("an entity only the model named is inferred; one the speaker named is local", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "the neighbor's dog barks all night", [
      { text: "The neighbor's dog barks at night", category: "person", scope: "person", importance: 0.4, subject: { name: "Rover", kind: "pet" } },
    ]);
    expect(db.select().from(entities).where(eq(entities.name, "Rover")).get()!.source).toBe("inferred");
    await judgeWith(actor, "Rover is the neighbor's dog", [
      { text: "Rover is the neighbor's dog", category: "person", scope: "person", importance: 0.4, subject: { name: "Rover", kind: "pet" } },
    ]);
    // Found, not duplicated, and still what it was: a mention does not
    // rewrite provenance.
    expect(db.select().from(entities).where(eq(entities.name, "Rover")).all().length).toBe(1);
  });

  test("a plain fact naming a known entity gets its subject without creating anything", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const { turn } = await judgeWith(actor, "Quill is out sick today", [{ text: "Quill was out sick", category: "event", scope: "person", importance: 0.3, subject: null, relation: null }]);
    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    const record = db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!;
    expect(record.subjectId).toBe(quill.id);
    expect(db.select().from(entities).all().filter((e) => e.kind === "person").length).toBe(2);
  });

  test("a repeated statement is one edge, and a speaker stating what was only inferred promotes it to stated", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "lunch with Quill again", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: false } }]);
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    await judgeWith(actor, "my coworker Quill likes seltzer, I said", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const edges = db.select().from(relationships).all();
    expect(edges.length).toBe(1);
    for (const e of edges) {
      expect(e.source).toBe("stated");
      expect(e.statedByPersonId).toBe(actor.id);
      expect(e.confidence).toBeNull();
    }
  });

  test("a directed relation stores its inverse, and promoting the one the speaker states carries the inverse along", async () => {
    const { actor } = await owner();
    const fact = { text: "Rover chewed a shoe", category: "person", scope: "person", importance: 0.5, subject: { name: "Rover", kind: "pet" } };
    await judgeWith(actor, "Rover chewed a shoe", [{ ...fact, relation: { type: "owns", name: "Rover", stated: false } }]);
    let edges = db.select().from(relationships).all();
    expect(edges.map((e) => e.type).sort()).toEqual(["owned_by", "owns"]);
    expect(edges.every((e) => e.source === "inferred")).toBe(true);
    await judgeWith(actor, "my dog Rover chewed a shoe", [{ ...fact, relation: { type: "owns", name: "Rover", stated: true } }]);
    edges = db.select().from(relationships).all();
    expect(edges.length).toBe(2);
    expect(edges.every((e) => e.source === "stated" && e.statedByPersonId === actor.id && e.confidence === null)).toBe(true);
  });

  test("a household member named as a subject resolves to their own person entity, never a second one", async () => {
    const { client, actor } = await owner();
    await client.post("/api/people", { displayName: "Bramble", role: "child" });
    await judgeWith(actor, "Bramble wants pancakes on Sunday", [
      { text: "Bramble wants pancakes on Sunday", category: "preference", scope: "household", importance: 0.5, subject: { name: "Bramble", kind: "person" } },
    ]);
    const brambles = db.select().from(entities).where(eq(entities.name, "Bramble")).all();
    expect(brambles.length).toBe(1);
    expect(brambles[0]!.accountPersonId).not.toBeNull();
    expect(brambles[0]!.scope).toBe("household");
  });
});

describe("the review's cases", () => {
  test("a place subject is created as a map place, with its subject on the record", async () => {
    const { actor } = await owner();
    const { turn } = await judgeWith(actor, "the office is on Elm Street", [
      { text: "Marlow's office is on Elm Street", category: "place", scope: "person", importance: 0.4, subject: { name: "Elm Street", kind: "place" } },
    ]);
    const place = db.select().from(entities).where(eq(entities.name, "Elm Street")).get()!;
    expect(place.kind).toBe("place");
    expect(place.placeKind).toBe("map");
    expect(db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!.subjectId).toBe(place.id);
  });

  test("a plain fact carrying the speaker's own name is about the other entity, never the speaker", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const { turn } = await judgeWith(actor, "Quill was out sick", [{ text: "Marlow's coworker Quill was out sick", category: "event", scope: "person", importance: 0.3, subject: null, relation: null }]);
    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    expect(db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!.subjectId).toBe(quill.id);
  });

  test("a thing named only in an owns relation is a thing, not a pet", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my car Civic needs an oil change", [
      { text: "Marlow's car needs an oil change", category: "thing", scope: "person", importance: 0.4, subject: null, relation: { type: "owns", name: "Civic", stated: true } },
    ]);
    expect(db.select().from(entities).where(eq(entities.name, "Civic")).get()!.kind).toBe("thing");
    expect(subjectRosterFor(actor)).not.toContain("Civic");
  });

  test("forgetting the only record about a judge-made entity removes the entity and its edges; an edit to the turn does the same", async () => {
    const { actor } = await owner();
    const { turn } = await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const record = db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!;
    expect(forgetByIds(actor, [record.id])[0]!.deleted).toBe(true);
    expect(db.select().from(entities).where(eq(entities.name, "Quill")).get()!.deletedAt).not.toBeNull();
    expect(db.select().from(relationships).all().every((e) => e.deletedAt !== null)).toBe(true);
    expect(subjectRosterFor(actor)).not.toContain("Quill");

    const second = await judgeWith(actor, "my coworker Raven likes tea", [
      { text: "Raven likes tea", category: "preference", scope: "person", importance: 0.6, subject: { name: "Raven", kind: "person" }, relation: { type: "colleague_of", name: "Raven", stated: true } },
    ]);
    expect(archiveByProvenance(second.turn.id)).toBe(1);
    expect(db.select().from(entities).where(eq(entities.name, "Raven")).get()!.deletedAt).not.toBeNull();
  });

  test("a second household member stating the same relation from their side gets their own edge, not the first speaker's", async () => {
    const { client, actor } = await owner();
    const created = await client.post("/api/people", { displayName: "Cosmo", role: "adult", secret: "0000" });
    const cosmo = db.select().from(people).where(eq(people.id, ((await created.json()) as { id: string }).id)).get()!;
    await judgeWith(actor, "my son Cosmo starts school Monday", [
      { text: "Cosmo starts school on Monday", category: "event", scope: "person", importance: 0.6, subject: { name: "Cosmo", kind: "person" }, relation: { type: "parent_of", name: "Cosmo", stated: true } },
    ]);
    await judgeWith(cosmo, "my dad Marlow makes pancakes", [
      { text: "Marlow makes pancakes", category: "person", scope: "person", importance: 0.5, subject: { name: "Marlow", kind: "person" }, relation: { type: "child_of", name: "Marlow", stated: true } },
    ]);
    const edges = db.select().from(relationships).all();
    expect(edges.filter((e) => e.person === actor.id).map((e) => e.type).sort()).toEqual(["child_of", "parent_of"]);
    expect(edges.filter((e) => e.person === cosmo.id).map((e) => e.type).sort()).toEqual(["child_of", "parent_of"]);
    const marlowEntity = db.select().from(entities).where(eq(entities.accountPersonId, actor.id)).get()!;
    expect(subjectLabel(cosmo, marlowEntity.id)).toBe("Marlow (your parent)");
  });

  test("an edited turn that restores a superseded fact keeps that fact's subject", async () => {
    const { actor } = await owner();
    const first = await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const r1 = db.select().from(memoryRecords).all().find((r) => r.source === first.turn.id)!;
    const second = makeTurn(actor, "Quill likes coffee now", "Noted.");
    const sup = supersede(actor, r1.id, { text: "Quill likes coffee", source: second.id, subject_id: r1.subjectId });
    expect(sup.ok).toBe(true);
    expect(archiveByProvenance(second.id)).toBe(1);
    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    expect(quill.deletedAt).toBeNull();
    expect(db.select().from(memoryRecords).where(eq(memoryRecords.id, r1.id)).get()!.status).toBe("active");
  });

  test("a refused write leaves no entity behind", async () => {
    const { client, actor } = await owner();
    const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = db.select().from(people).where(eq(people.id, ((await created.json()) as { id: string }).id)).get()!;
    // The one refusal the judge's own write path has: a child's fact
    // deduping onto a pinned household record (supersede's privileged
    // route check), scripted the way memoryJudge.test.ts does.
    const { remember } = await import("@/lib/memory");
    const pinned = remember(actor, { text: "Raven is the family's dentist", category: "fact", tier: "durable", scope: "household", source: "test", importance: 0.6, pinned: true });
    if (!pinned.ok) throw new Error("setup failed");
    const { sqlite } = await import("@/db");
    sqlite.query("INSERT INTO memory_embeddings (memory_id, space, dims, vector, hlc) VALUES (?, 'test', 4, ?, 'test-hlc')").run(pinned.value.id, Buffer.from(new Float32Array([1, 0, 0, 0]).buffer));
    const turn = makeTurn(child, "Raven is not our dentist anymore", "Okay.");
    await withScriptedJudge(
      (name) => {
        if (name === "memory_extraction") return { facts: [{ text: "Raven is no longer the dentist", category: "fact", scope: "household", importance: 0.6, subject: { name: "Raven", kind: "person" } }] };
        if (name === "memory_dedupe") return { action: "SUPERSEDE", id: pinned.value.id, merged_text: "Raven is no longer the dentist" };
        return undefined;
      },
      () => judgeTurn(turn),
    );
    const ravens = db.select().from(entities).where(eq(entities.name, "Raven")).all();
    expect(ravens.length).toBe(1);
    expect(ravens[0]!.deletedAt).not.toBeNull();
  });

  test("a confirmed entity survives the forgetting of the fact that made it", async () => {
    const { client, actor } = await owner();
    const { turn } = await judgeWith(actor, "the neighbor's dog barks all night", [
      { text: "The neighbor's dog barks at night", category: "person", scope: "person", importance: 0.4, subject: { name: "Rover", kind: "pet" } },
    ]);
    const rover = db.select().from(entities).where(eq(entities.name, "Rover")).get()!;
    expect((await client.request(`/api/entities/${rover.id}`, { method: "PATCH", body: { confirm: true } })).status).toBe(200);
    const record = db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!;
    forgetByIds(actor, [record.id]);
    expect(db.select().from(entities).where(eq(entities.id, rover.id)).get()!.deletedAt).toBeNull();
  });

  test("the per-person erasure takes the judge's entities and relationships with the memories, never the person's own entity", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const result = forget(actor, actor.id);
    expect(result.ok).toBe(true);
    expect(db.select().from(entities).where(eq(entities.name, "Quill")).get()!.deletedAt).not.toBeNull();
    expect(db.select().from(relationships).all().every((e) => e.deletedAt !== null)).toBe(true);
    expect(db.select().from(entities).where(eq(entities.accountPersonId, actor.id)).get()!.deletedAt).toBeNull();
  });

  test("a dog named only in an owns slot is a pet; a thing-category fact makes a thing", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "our dog Sprout chewed a shoe", [
      { text: "Sprout chewed a shoe", category: "person", scope: "person", importance: 0.4, subject: null, relation: { type: "owns", name: "Sprout", stated: true } },
    ]);
    expect(db.select().from(entities).where(eq(entities.name, "Sprout")).get()!.kind).toBe("pet");
    expect(subjectRosterFor(actor)).toContain("Sprout");
  });

  test("a relation slot never makes an entity beside the subject; one the speaker already has is joined", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my sister Nadia's dog Rover is sick", [
      { text: "Rover, Nadia's dog, is sick", category: "event", scope: "person", importance: 0.5, subject: { name: "Rover", kind: "pet" }, relation: { type: "sibling_of", name: "Nadia", stated: true } },
    ]);
    expect(db.select().from(entities).where(eq(entities.name, "Nadia")).get()).toBeUndefined();
    expect(db.select().from(relationships).all().length).toBe(0);
    await judgeWith(actor, "my sister Nadia lives in Porto", [
      { text: "Nadia lives in Porto", category: "person", scope: "person", importance: 0.6, subject: { name: "Nadia", kind: "person" }, relation: { type: "sibling_of", name: "Nadia", stated: true } },
    ]);
    const { turn } = await judgeWith(actor, "my sister Nadia's dog Rover is better", [
      { text: "Rover, Nadia's dog, is better", category: "event", scope: "person", importance: 0.5, subject: { name: "Rover", kind: "pet" }, relation: { type: "sibling_of", name: "Nadia", stated: true } },
    ]);
    expect(db.select().from(relationships).all().filter((e) => e.type === "sibling_of").length).toBe(1);
    // Forgetting a fact about Rover never touches Nadia: she is another
    // record's subject.
    forgetByIds(actor, [db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!.id]);
    expect(db.select().from(entities).where(eq(entities.name, "Nadia")).get()!.deletedAt).toBeNull();
  });

  test("a relation the model calls stated for a name the speaker never said is inferred, like the entity", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "lunch with the new hire again", [
      { text: "Marlow has lunch with the new hire", category: "event", scope: "person", importance: 0.5, subject: { name: "Quill", kind: "person" }, relation: { type: "colleague_of", name: "Quill", stated: true } },
    ]);
    expect(db.select().from(entities).where(eq(entities.name, "Quill")).get()!.source).toBe("inferred");
    const edge = db.select().from(relationships).all()[0]!;
    expect(edge.source).toBe("inferred");
    expect(edge.statedByPersonId).toBeNull();
  });

  test("a relation to a household member by nickname joins their own entity", async () => {
    const { client, actor } = await owner();
    const created = await client.post("/api/people", { displayName: "Nadia", nickname: "Nads", role: "adult", secret: "0000" });
    expect(created.status).toBe(201);
    await judgeWith(actor, "my sister Nads is coming over Sunday", [
      { text: "Nadia is coming over on Sunday", category: "event", scope: "person", importance: 0.5, subject: { name: "Nadia", kind: "person" }, relation: { type: "sibling_of", name: "Nads", stated: true } },
    ]);
    const edges = db.select().from(relationships).all();
    expect(edges.map((e) => e.type)).toEqual(["sibling_of"]);
    expect(db.select().from(entities).where(eq(entities.name, "Nadia")).all().length).toBe(1);
  });

  test("the last record citing an entity takes it with it, however long ago it was made", async () => {
    const { actor } = await owner();
    const first = await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    const { sqlite } = await import("@/db");
    sqlite.query("UPDATE entities SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", quill.id);
    const second = await judgeWith(actor, "Quill got promoted", [{ text: "Quill got promoted", category: "event", scope: "person", importance: 0.5, subject: { name: "Quill", kind: "person" }, relation: null }]);
    const r1 = db.select().from(memoryRecords).all().find((r) => r.source === first.turn.id)!;
    const r2 = db.select().from(memoryRecords).all().find((r) => r.source === second.turn.id)!;
    forgetByIds(actor, [r1.id]);
    expect(db.select().from(entities).where(eq(entities.id, quill.id)).get()!.deletedAt).toBeNull();
    forgetByIds(actor, [r2.id]);
    expect(db.select().from(entities).where(eq(entities.id, quill.id)).get()!.deletedAt).not.toBeNull();
    expect(subjectRosterFor(actor)).not.toContain("Quill");
  });

  test("a pet that shares a child's nickname is the pet, not the child", async () => {
    const { client, actor } = await owner();
    await client.post("/api/people", { displayName: "Bramble", nickname: "Bear", role: "child" });
    await judgeWith(actor, "our dog Bear needs his shots", [
      { text: "Bear the dog needs his shots", category: "person", scope: "person", importance: 0.5, subject: { name: "Bear", kind: "pet" }, relation: { type: "owns", name: "Bear", stated: true } },
    ]);
    const bear = db.select().from(entities).where(eq(entities.name, "Bear")).get()!;
    expect(bear.kind).toBe("pet");
    expect(db.select().from(relationships).all().map((e) => e.type).sort()).toEqual(["owned_by", "owns"]);
    // The same when the child already has an entity under that name.
    await client.post("/api/people", { displayName: "Sprout", role: "child" });
    await judgeWith(actor, "Sprout wants pancakes", [{ text: "Sprout wants pancakes", category: "preference", scope: "household", importance: 0.5, subject: { name: "Sprout", kind: "person" } }]);
    await judgeWith(actor, "our cat Sprout knocked over a plant", [
      { text: "Sprout the cat knocked over a plant", category: "person", scope: "person", importance: 0.4, subject: { name: "Sprout", kind: "pet" }, relation: { type: "owns", name: "Sprout", stated: true } },
    ]);
    expect(db.select().from(entities).where(eq(entities.name, "Sprout")).all().map((e) => e.kind).sort()).toEqual(["person", "pet"]);
    // And an older entity of another kind is still the same one, past
    // the member's newer entity.
    await judgeWith(actor, "Sprout the cat is asleep", [{ text: "Sprout the cat is asleep", category: "state", scope: "person", importance: 0.3, subject: { name: "Sprout", kind: "thing" } }]);
    expect(db.select().from(entities).where(eq(entities.name, "Sprout")).all().length).toBe(2);
  });

  test("an entity another active record still cites stays when one record is forgotten", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const { turn } = await judgeWith(actor, "Quill was out sick", [{ text: "Quill was out sick", category: "event", scope: "person", importance: 0.3, subject: { name: "Quill", kind: "person" }, relation: null }]);
    const record = db.select().from(memoryRecords).all().find((r) => r.source === turn.id)!;
    forgetByIds(actor, [record.id]);
    expect(db.select().from(entities).where(eq(entities.name, "Quill")).get()!.deletedAt).toBeNull();
  });
});

describe("recall and the prompt know whose fact it is", () => {
  test("recall by the subject's name finds the record; the prompt line says 'about Quill (your coworker)' for a stated relation", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    const matches = recall(actor, "what does Quill drink");
    expect(matches.length).toBe(1);
    expect(matches[0]!.record.text).toBe("Quill likes seltzer");
    const parts = buildPromptParts(actor, "what does Quill drink", matches);
    expect(parts.context).toContain("- Quill likes seltzer (about Quill (your coworker); as of");
  });

  test("an unconfirmed inferred relation is never said to the model (the name alone), and is plain once an adult confirms it", async () => {
    const { client, actor } = await owner();
    await judgeWith(actor, "lunch with Quill again", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: false } }]);
    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    expect(subjectLabel(actor, quill.id)).toBe("Quill");
    const parts = buildPromptParts(actor, "what does Quill drink", recall(actor, "what does Quill drink"));
    expect(parts.context).not.toContain("coworker");

    const edge = db.select().from(relationships).all().find((e) => e.toId === quill.id)!;
    const res = await client.request(`/api/relationships/${edge.id}`, { method: "PATCH", body: { confirm: true } });
    expect(res.status).toBe(200);
    expect(subjectLabel(actor, quill.id)).toBe("Quill (your coworker)");
    // Confirmed, not rewritten: how it was learned stays on the record.
    for (const e of db.select().from(relationships).all()) {
      expect(e.source).toBe("inferred");
      expect(e.confidence).toBe(0.7);
      expect(e.confirmedByPersonId).toBe(actor.id);
      expect(e.confirmedAt).not.toBeNull();
    }
  });

  test("an unconfirmed inferred entity is a candidate: no label in the prompt, not a known name for the guards, not an identity recall reads by", async () => {
    const { actor } = await owner();
    const { turn } = await judgeWith(actor, "the neighbor's dog barks all night", [
      { text: "The neighbor's dog barks at night", category: "person", scope: "person", importance: 0.4, subject: { name: "Rover", kind: "pet" } },
    ]);
    const rover = db.select().from(entities).where(eq(entities.name, "Rover")).get()!;
    expect(rover.source).toBe("inferred");
    expect(subjectLabel(actor, rover.id)).toBeNull();
    expect(subjectRosterFor(actor)).not.toContain("Rover");
    // The record is still the person's own words, found by them.
    const byWords = recall(actor, "does the neighbor's dog bark");
    expect(byWords.map((m) => m.record.source)).toContain(turn.id);
    const byName = recall(actor, "tell me about Rover");
    expect(byName.map((m) => m.record.source)).not.toContain(turn.id);
  });

  test("the guards' subject roster carries the speaker's people and pets, not their places", async () => {
    const { actor } = await owner();
    await judgeWith(actor, "my coworker Quill likes seltzer", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: true } }]);
    await judgeWith(actor, "the office is on Elm Street", [
      { text: "Marlow's office is on Elm Street", category: "place", scope: "person", importance: 0.4, subject: { name: "Elm Street", kind: "place" } },
    ]);
    const roster = subjectRosterFor(actor);
    expect(roster).toContain("Quill");
    expect(roster).not.toContain("Elm Street");
  });
});

describe("PATCH { confirm: true }", () => {
  async function inferredEdge(actor: PersonRow) {
    await judgeWith(actor, "lunch with Quill again", [{ ...QUILL_FACT, relation: { type: "colleague_of", name: "Quill", stated: false } }]);
    const quill = db.select().from(entities).where(eq(entities.name, "Quill")).get()!;
    const edge = db.select().from(relationships).all().find((e) => e.toId === quill.id)!;
    return { quill, edge };
  }

  test("a child cannot confirm (403); a non-inferred relationship cannot be confirmed (409); an unknown key is refused (400)", async () => {
    const { client, actor } = await owner();
    const { edge } = await inferredEdge(actor);
    const created = await client.post("/api/people", { displayName: "Bramble", role: "child" });
    const child = (await created.json()) as { id: string };
    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    // The child cannot see the owner's person-scope edge at all: a 404,
    // never a hint that it exists. The role check is exercised on an
    // edge the child owns below.
    expect((await childClient.request(`/api/relationships/${edge.id}`, { method: "PATCH", body: { confirm: true } })).status).toBe(404);

    const childRow = db.select().from(people).where(eq(people.id, child.id)).get()!;
    const own = await inferredEdgeFor(childRow);
    expect((await childClient.request(`/api/relationships/${own.id}`, { method: "PATCH", body: { confirm: true } })).status).toBe(403);

    expect((await client.request(`/api/relationships/${edge.id}`, { method: "PATCH", body: { confirm: true, source: "stated" } })).status).toBe(400);
    expect((await client.request(`/api/relationships/${edge.id}`, { method: "PATCH", body: { confirm: true } })).status).toBe(200);
    expect((await client.request(`/api/relationships/${edge.id}`, { method: "PATCH", body: { confirm: true } })).status).toBe(409);
  });

  async function inferredEdgeFor(actor: PersonRow) {
    await judgeWith(actor, "lunch with Raven again", [
      { text: "Raven has lunch with Bramble", category: "person", scope: "person", importance: 0.5, subject: { name: "Raven", kind: "person" }, relation: { type: "friend_of", name: "Raven", stated: false } },
    ]);
    const raven = db.select().from(entities).where(eq(entities.name, "Raven")).get()!;
    return db.select().from(relationships).all().find((e) => e.toId === raven.id)!;
  }

  test("an inferred entity is confirmed to local by an adult; provenance is not settable through the edit body", async () => {
    const { client, actor } = await owner();
    await judgeWith(actor, "the neighbor's dog barks all night", [
      { text: "The neighbor's dog barks at night", category: "person", scope: "person", importance: 0.4, subject: { name: "Rover", kind: "pet" } },
    ]);
    const rover = db.select().from(entities).where(eq(entities.name, "Rover")).get()!;
    expect(rover.source).toBe("inferred");
    expect((await client.request(`/api/entities/${rover.id}`, { method: "PATCH", body: { source: "local" } })).status).toBe(400);
    const res = await client.request(`/api/entities/${rover.id}`, { method: "PATCH", body: { confirm: true } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; confirmed_by_person_id: string | null; confirmed_at: string | null };
    expect(body.source).toBe("local");
    expect(body.confirmed_by_person_id).toBe(actor.id);
    expect(body.confirmed_at).not.toBeNull();
    expect((await client.request(`/api/entities/${rover.id}`, { method: "PATCH", body: { confirm: true } })).status).toBe(409);
  });
});
