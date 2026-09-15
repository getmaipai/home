// ASK-02 (docs/dev.md section 16 part 7; docs/dev/session-a.md
// "ASK-02"): the resolver's world edge. Candidate hygiene (an oath in
// its slot, a capitalized ordinary word, a typo one edit from a
// predicate, a token the tagger reads as an expression or a verb, a
// dash trimmed off the edge); a brand or a service as the world's,
// kind organization, never asked; a name the hub itself introduced
// (its last two replies, a retained outcome's result) as a world
// subject never asked back; and a `who` answer that makes the name the
// world's: no household entity, the raising turn run as a lookup at
// once. The scripted chat engine is the spec's stub server; the search
// is a fake SearXNG, as in tests/lookup02.test.ts.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurn, worldAnswerQuery } from "@/lib/turnEngine";
import { namesIn, properNounsIn, parseWhoAnswer, replyAsksAbout, replyAsksIdentityOf, resolveNames, type SubjectRef } from "@/lib/unknownNames";
import { getPendingAsk } from "@/lib/conversationHistory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { db } from "@/db";
import { people, entities, conversationTurns } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
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

const known = { names: ["Pippa", "Nadia", "Sage", "Rover"], resolveEntity: (name: string) => `ent-${name.toLowerCase()}` };
const show = (r: { subjects: SubjectRef[] }) => r.subjects.map((s) => (s.type === "unresolved" ? `unresolved:${s.surface_form}${s.candidate_kinds.length ? `[${s.candidate_kinds.join("/")}]` : ""}` : s.type === "world" ? `world:${s.display_name}` : `household:${s.entity_id}`));

describe("rule 1: candidate hygiene", () => {
  test("an oath in its slot is not a name; the same word outside it is", () => {
    expect(show(resolveNames("Lord, that took ages", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("oh God, not again", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Jesus - that took ages", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Lord is coming over for dinner", undefined, known, "t"))).toEqual(["unresolved:Lord"]);
  });
  test("an edge dash is trimmed; an internal hyphen stands", () => {
    expect(show(resolveNames("Bella - no, the other one", undefined, known, "t"))).toEqual(["unresolved:Bella"]);
    expect(show(resolveNames("Mary-Jane came by with our tent", undefined, known, "t"))).toEqual(["unresolved:Mary-Jane"]);
  });
  test("a capitalized ordinary word after a determiner, or one that was lowercase a turn ago, is that word", () => {
    expect(show(resolveNames("that Answer was wrong", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Storm hit the coast last night", undefined, { ...known, recent: ["that storm was loud"] }, "t"))).toEqual([]);
    expect(show(resolveNames("Storm hit the coast last night", undefined, known, "t"))).toEqual(["unresolved:Storm"]);
    // A word the lexicon does not know is a name however it was typed a turn ago.
    expect(show(resolveNames("Tempo played well", undefined, { ...known, recent: ["the tempo of that song is off"] }, "t"))).toEqual(["unresolved:Tempo"]);
  });
  test("a typo one edit from a predicate in a predicate's slot is not a name; a first name the lexicon knows never is a typo", () => {
    expect(show(resolveNames("Wong, that's not it", undefined, known, "t"))).toEqual([]);
    // The copula's complement introduces a name and is never the typo slot.
    expect(show(resolveNames("that's Wong", undefined, known, "t"))).toEqual(["unresolved:Wong"]);
    expect(show(resolveNames("Serena, that's not it", undefined, known, "t"))).toEqual(["unresolved:Serena"]);
    // A household frame keeps the name whatever the word looks like.
    expect(resolveNames("my cousin Wong is visiting", undefined, known, "t").subjects.map((s) => s.type)).toEqual(["unresolved"]);
  });
  test("a known name is never read by the hygiene rules", () => {
    expect(show(resolveNames("Rover, that's not it", undefined, known, "t"))).toEqual(["household:ent-rover"]);
  });
  test("the review's cases: an introduction, a possessive, a lowercase name a turn ago, a first name that is a lexicon word", () => {
    expect(show(resolveNames("his name is Clover", undefined, known, "t"))).toEqual(["unresolved:Clover"]);
    expect(show(resolveNames("this is Atlas", undefined, known, "t"))).toEqual(["unresolved:Atlas"]);
    expect(show(resolveNames("my Daisy has a cough", undefined, known, "t"))).toEqual(["unresolved:Daisy"]);
    expect(show(resolveNames("our Max is sick", undefined, known, "t"))).toEqual(["unresolved:Max"]);
    expect(show(resolveNames("Nova is coming over", undefined, { ...known, recent: ["is nova coming tonight?"] }, "t"))).toEqual(["unresolved:Nova"]);
    expect(show(resolveNames("Clover, dinner's ready", undefined, known, "t"))).toEqual(["unresolved:Clover"]);
    // The comma slot is the appositive introduction's too: a relation
    // frame's name is never read by the rules, an oath included.
    expect(show(resolveNames("Rover, our new puppy, is adorable", undefined, { ...known, names: ["Pippa"] }, "t"))).toEqual(["unresolved:Rover[pet]"]);
    expect(show(resolveNames("Atlas, my cousin, is visiting on Friday", undefined, known, "t"))).toEqual(["unresolved:Atlas[person]"]);
    expect(show(resolveNames("Jesus, my cousin, is visiting", undefined, known, "t"))).toEqual(["unresolved:Jesus[person]"]);
    expect(show(resolveNames("Jesus, my cousin", undefined, known, "t"))).toEqual(["unresolved:Jesus[person]"]);
    // The frame pattern also matches an oath before a clause; the oath
    // rule still reads it when no comma closes the appositive.
    expect(show(resolveNames("God, my dad is going to be so mad", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Man, my sister is late again", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Man, my sister is late", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("God, my dad is mad", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("God, my dad is so mad, I swear", undefined, known, "t"))).toEqual([]);
    expect(show(resolveNames("Rover, our new puppy", undefined, { ...known, names: ["Pippa"] }, "t"))).toEqual(["unresolved:Rover[pet]"]);
    expect(resolveNames("God, my dad is going to be so mad", undefined, known, "t").unknown).toEqual([]);
  });
});

describe("rule 2: brands and services", () => {
  test("a name before a model number or a product noun, or one the tagger knows as an organization, is unresolved with kind organization and never asked", () => {
    const card = resolveNames("wow, the Cosmo 7 card is a beast", undefined, known, "t");
    expect(show(card)).toEqual(["unresolved:Cosmo 7[organization]"]);
    expect(card.unknown.map((u) => u.ask)).toEqual([false]);
    const laptop = resolveNames("my Asus laptop died", undefined, known, "t");
    expect(show(laptop)).toEqual(["unresolved:Asus[organization]"]);
    expect(laptop.unknown.map((u) => u.ask)).toEqual([false]);
    expect(show(resolveNames("I watched it on YouTube last night", undefined, known, "t"))).toEqual(["unresolved:YouTube[organization]"]);
    // A person's name with a possessive frame still asks.
    const person = resolveNames("Nova borrowed our tent", undefined, known, "t");
    expect(person.unknown.map((u) => u.ask)).toEqual([true]);
  });
});

describe("rule 3: a name the hub introduced", () => {
  test("namesIn() reads the proper nouns of a reply, the household's out; a hub name resolves a candidate to a world subject, whole or as a part", () => {
    expect(namesIn("The film stars Serena Vale as the keeper and Sage as her brother.", ["Sage"])).toEqual(["Serena Vale"]);
    const hub = { ...known, hubNames: [{ name: "Serena Vale", provenance: "websearch", sourceKind: "web" as const, person: true }] };
    expect(show(resolveNames("who's Serena Vale", undefined, hub, "t"))).toEqual(["world:Serena Vale"]);
    expect(show(resolveNames("what else has Serena been in", undefined, hub, "t"))).toEqual(["world:Serena Vale"]);
    // A part matches a person's name only: "Nova" is not "Nova Scotia".
    const place = { ...known, hubNames: [{ name: "Nova Scotia", provenance: "weather", sourceKind: "weather" as const, person: false }] };
    expect(show(resolveNames("Nova is coming over, she's bringing cake", undefined, place, "t"))).toEqual(["unresolved:Nova"]);
    expect(resolveNames("who's Serena Vale", undefined, hub, "t").unknown).toEqual([]);
    // A relation frame on the person's own turn wins over a hub name.
    const cast = { ...known, hubNames: [{ name: "Vincent Marlow", provenance: "websearch", sourceKind: "web" as const }] };
    expect(show(resolveNames("my brother Vincent is visiting on Sunday", undefined, cast, "t"))).toEqual(["unresolved:Vincent[person]"]);
    // A reply's sentence-initial plain noun is no name the hub gave.
    expect(namesIn("Traffic looks clear tonight. Weather is mild, and Serena Vale is on at nine.", [], { properOnly: true })).toEqual(["Serena Vale"]);
    expect(properNounsIn("The film stars Serena Vale as the keeper; rain across Nova Scotia tonight.", [], { properOnly: true })).toEqual([{ name: "Serena Vale", person: true }, { name: "Nova Scotia", person: false }]);
  });
});

describe("rule 4: the world answer", () => {
  test("the parser reads a world kind, a mark, or a full name; a household relation noun wins", () => {
    expect(parseWhoAnswer("the actress, Serena Vale", "Serena")?.toString()).not.toBe("declined");
    expect((parseWhoAnswer("the actress, Serena Vale", "Serena") as { world?: unknown }).world).toEqual({ kind: "actress", name: "Serena Vale" });
    expect((parseWhoAnswer("a public figure", "Serena") as { world?: unknown }).world).toEqual({ kind: "person", name: "Serena" });
    expect((parseWhoAnswer("she's famous", "Serena") as { world?: unknown }).world).toEqual({ kind: "person", name: "Serena" });
    expect((parseWhoAnswer("she's on that show", "Serena") as { world?: unknown }).world).toEqual({ kind: "person", name: "Serena" });
    expect((parseWhoAnswer("Serena Vale", "Serena") as { world?: unknown }).world).toEqual({ kind: "person", name: "Serena Vale" });
    expect((parseWhoAnswer("the band from the festival", "Tempo") as { world?: unknown }).world).toEqual({ kind: "band", name: "Tempo" });
    expect((parseWhoAnswer("my cousin, she's an actress", "Nadia") as { world?: unknown; kind?: string }).world).toBeUndefined();
    expect(parseWhoAnswer("she's a chef", "Nadia")).toBeNull();
    // A private person's full name with a relation noun is the household's, never searched.
    // (The household parser reads the phrase where an answer puts it; a
    // full name ahead of it is unreadable and the model answers, which
    // is still no search.)
    for (const answer of ["Serena Vale, a friend from work", "she's Serena Vale, the neighbour", "it's Serena Vale from next door, a friend", "Serena Vale, she lives next door", "Serena Vale from school"]) {
      const read = parseWhoAnswer(answer, "Serena");
      expect(read === null || read === "declined" || read.world === undefined).toBe(true);
    }
    expect(parseWhoAnswer("he's our rabbit", "Juniper")).toMatchObject({ kind: "pet" });
  });
  test("the model's own identity question binds; a which-question or an offer about a world subject does not", () => {
    expect(replyAsksIdentityOf("Serena? Is that someone you know or a public figure?", "Serena")).toBe(true);
    expect(replyAsksIdentityOf("Who's Serena?", "Serena")).toBe(true);
    expect(replyAsksIdentityOf("Which Marsh Lantern album do you mean?", "Marsh Lantern")).toBe(false);
    expect(replyAsksIdentityOf("Want me to look up what Marsh Lantern are doing?", "Marsh Lantern")).toBe(false);
    expect(replyAsksIdentityOf("How is Serena doing?", "Serena")).toBe(false);
    expect(replyAsksAbout("Serena, someone you know or a public figure?", "Serena")).toBe(true);
  });
  test("the query is the full name and the raising turn's words", () => {
    const subject: Extract<SubjectRef, { type: "world" }> = { type: "world", kind: "actress", display_name: "Serena Vale", year: null, source_kind: null, stable_key: null, recency: "unknown", carried_question: null };
    expect(worldAnswerQuery(subject, "sounds like they worked out what happened to Serena", "Serena")).toBe("Serena Vale what happened");
    expect(worldAnswerQuery(subject, "what's Serena been in lately", "Serena")).toMatch(/^Serena Vale .*lately$/);
    expect(worldAnswerQuery(subject, "Serena", "Serena")).toBe("Serena Vale");
    expect(worldAnswerQuery(subject, "Who is Serena?", "Serena")).toBe("Serena Vale");
    expect(worldAnswerQuery(subject, "what's Serena up to these days?", "Serena")).not.toMatch(/what/);
    expect(worldAnswerQuery(subject, "Serena's new film, is it any good?", "Serena")).toBe("Serena Vale new film any good");
  });
});

const SEARCH_ANSWER = "The film stars Serena Vale as the keeper; she plays the lighthouse keeper and won a stage award last year.";

async function withLookup<T>(opts: { draft: (r: ChatCompletionRequest) => string }, fn: (seen: { forced: number; queries: string[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { forced: 0, queries: [] as string[] };
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request) => {
      if (request.tool_choice !== "required") return undefined;
      seen.forced++;
      return [{ id: "call-s", type: "function", function: { name: "websearch", arguments: JSON.stringify({ expression: "the model's own guess" }) } }];
    },
    scriptedChatReply: (request) => {
      if (request.messages.some((m) => typeof m.content === "string" && m.content.includes("BEGIN SEARCH RESULTS"))) return SEARCH_ANSWER;
      return opts.draft(request);
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  const searxng = Bun.serve({
    port: 0,
    fetch: (req) => {
      const q = new URL(req.url).searchParams.get("q") ?? "";
      seen.queries.push(q);
      return Response.json({ results: [{ title: "Marsh Lantern (film): cast", url: "https://example.com/marsh-lantern-film", content: "The new Marsh Lantern film stars Serena Vale as the lighthouse keeper and Vincent Marlow as her brother." }] });
    },
  });
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
  try {
    return await fn(seen);
  } finally {
    stub.stop();
    searxng.stop(true);
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

const lastUser = (r: ChatCompletionRequest) => String([...r.messages].reverse().find((m) => m.role === "user")?.content ?? "");
const retained = (turnId: string) => {
  const row = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  return row?.outcomes ? (JSON.parse(row.outcomes) as { packageId: string; status: string; via?: string; args?: Record<string, unknown> }[]) : [];
};
function turnLines(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
    original(...args);
  };
  return fn().then(() => lines).finally(() => (console.log = original));
}

describe("the flows", () => {
  test("hub-named-it: a name the search introduced is a world subject on the next turn, never asked back", async () => {
    const { actor } = await owner();
    await withLookup({ draft: (r) => (/who's in/.test(lastUser(r)) ? "Let me check that for you." : "She plays the lighthouse keeper in it.") }, async (seen) => {
      const first = await runTurn(actor, "chat", "who's in the new Marsh Lantern film");
      if (!first.ok) throw new Error(first.error);
      expect(first.value.source).toBe("plugin");
      expect(seen.forced).toBe(1);
      const lines = await turnLines(async () => {
        const second = await runTurn(actor, "chat", "who's Serena Vale", { conversationId: first.value.conversation_id });
        if (!second.ok) throw new Error(second.error);
        expect(second.value.reply.text).toBe("She plays the lighthouse keeper in it.");
        expect(getPendingAsk(first.value.conversation_id)).toBeNull();
      });
      const turn = lines.filter((l) => l.startsWith("[turn] {")).map((l) => JSON.parse(l.slice(7)) as { subjects?: { type: string; name: string; kind?: string }[] }).at(-1)!;
      expect(turn.subjects).toEqual([{ type: "world", name: "Serena Vale", kind: "mention" }]);
      expect(lines.some((l) => l.startsWith("[ask]"))).toBe(false);
    });
  });

  test("public-figure: the model's own question binds as the ask; the world answer creates no entity and runs the raising turn as a lookup on the full name", async () => {
    const { actor } = await owner();
    await withLookup({ draft: () => "Serena? Is that someone you know or a public figure?" }, async (seen) => {
      const first = await runTurn(actor, "chat", "sounds like they worked out what happened to Serena");
      if (!first.ok) throw new Error(first.error);
      expect(first.value.reply.text).toBe("Serena? Is that someone you know or a public figure?");
      const pending = getPendingAsk(first.value.conversation_id);
      expect(pending?.kind).toBe("who");
      expect(pending?.name).toBe("Serena");
      expect(pending?.carriedQuestion).toBe("sounds like they worked out what happened to Serena");
      const lines = await turnLines(async () => {
        const second = await runTurn(actor, "chat", "the actress, Serena Vale", { conversationId: first.value.conversation_id });
        if (!second.ok) throw new Error(second.error);
        expect(second.value.source).toBe("plugin");
        expect(second.value.plugin_id).toBe("websearch");
        expect(second.value.reply.text).toBe(SEARCH_ANSWER);
        expect(seen.queries).toEqual(["Serena Vale what happened"]);
        expect(seen.forced).toBe(0);
        expect(getPendingAsk(first.value.conversation_id)).toBeNull();
        expect(retained(second.value.turn_id).map((o) => [o.packageId, o.status, o.via, o.args?.expression])).toEqual([["websearch", "succeeded", "forced", "Serena Vale what happened"]]);
      });
      const turn = lines.filter((l) => l.startsWith("[turn] {")).map((l) => JSON.parse(l.slice(7)) as { subjects?: { type: string; name: string; kind?: string }[] }).at(-1)!;
      expect(turn.subjects).toEqual([{ type: "world", name: "Serena Vale", kind: "actress" }]);
      expect(db.select({ id: entities.id }).from(entities).where(and(eq(entities.name, "Serena Vale"), isNull(entities.deletedAt))).all()).toHaveLength(0);
      expect(db.select({ id: entities.id }).from(entities).where(and(eq(entities.name, "Serena"), isNull(entities.deletedAt))).all()).toHaveLength(0);
    });
  });

  test("a world answer with nothing carried acknowledges the name and runs nothing", async () => {
    const { actor } = await owner();
    await withLookup({ draft: () => "Nova? Who's that?" }, async (seen) => {
      // The engine's own ask carries the raising turn; an open question the judge queued carries none.
      const { queueOpenQuestion } = await import("@/lib/conversationHistory");
      const { setPendingAsk } = await import("@/lib/conversationHistory");
      const first = await runTurn(actor, "chat", "hey there");
      if (!first.ok) throw new Error(first.error);
      const q = queueOpenQuestion({ person: actor.id, conversationId: first.value.conversation_id, kind: "who", text: "Who's Nova?", source: "test" });
      setPendingAsk(first.value.conversation_id, { kind: "who", prompt: "Who's Nova?", packageId: "engine", args: { name: "Nova" }, name: "Nova", openQuestionId: q.id });
      const second = await runTurn(actor, "chat", "a singer", { conversationId: first.value.conversation_id });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.reply.text).toBe("Got it, Nova.");
      expect(seen.queries).toEqual([]);
      expect(getPendingAsk(first.value.conversation_id)).toBeNull();
    });
  });
});
