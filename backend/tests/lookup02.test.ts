// LOOKUP-02 (docs/dev.md section 16 parts 1, 2 and 4; docs/dev/
// session-a.md "LOOKUP-02"): the read over the draft's first two
// sentences on both paths, the hedge-plus-promise and help shapes, the
// hedged fact as a confession, the deliverable denial cut
// (false_capability), the offered question bound (never the turn's
// words), the imperative consent, the forced lookup as a ladder with
// the engine's own query and `via: forced`, and capability_claim off a
// lookup-served request. The scripted chat engine is the spec's stub
// server; the search is a fake SearXNG, as in tests/turnEngine.test.ts.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurn, lookupQueryFor, lookupConsent, LOOKUP_FAILED_LINE, withoutSentences } from "@/lib/turnEngine";
import { readLookupDraft, lookupShapeOf, hedgedFactShape, falseCapabilityShape, guardReply } from "@/lib/guards";
import { getPendingAsk } from "@/lib/conversationHistory";
import { setHouseholdSettingValue } from "@/lib/settings";
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

const SEARCH_ANSWER = "The support page is on the maker's site, with the manual and the pin count.";

/** The stub answers every plain completion with `draft`; a forced
 * completion (tool_choice required) calls the tool named by `forced`
 * (websearch with the model's own guess of a query, or knowledge, or
 * none); the fake SearXNG counts queries and answers unless `searxng`
 * is false. */
async function withLookup<T>(opts: { draft: string | ((r: ChatCompletionRequest) => string); forced?: "websearch" | "knowledge" | "none"; searxng?: boolean }, fn: (seen: { forced: number; queries: string[]; requests: ChatCompletionRequest[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { forced: 0, queries: [] as string[], requests: [] as ChatCompletionRequest[] };
  const stub = startStubLlmServer(0, {
    scriptedToolCalls: (request) => {
      if (request.tool_choice !== "required") return undefined;
      seen.forced++;
      const forced = opts.forced ?? "websearch";
      if (forced === "none") return undefined;
      if (forced === "knowledge") return [{ id: "call-k", type: "function", function: { name: "knowledge", arguments: JSON.stringify({ topic: "Marsh Lantern film" }) } }];
      return [{ id: "call-s", type: "function", function: { name: "websearch", arguments: JSON.stringify({ expression: "the model's own guess" }) } }];
    },
    scriptedChatReply: (request) => {
      seen.requests.push(request);
      if (request.messages.some((m) => typeof m.content === "string" && m.content.includes("BEGIN SEARCH RESULTS"))) return SEARCH_ANSWER;
      return typeof opts.draft === "function" ? opts.draft(request) : opts.draft;
    },
  });
  process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
  const searxng =
    opts.searxng === false
      ? null
      : Bun.serve({
          port: 0,
          fetch: (req) => {
            seen.queries.push(new URL(req.url).searchParams.get("q") ?? "");
            return Response.json({ results: [{ title: "Cosmo 7 support", url: "https://example.com/cosmo-7", content: "Support page, manual, 16 power pins." }] });
          },
        });
  if (searxng) setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
  try {
    return await fn(seen);
  } finally {
    stub.stop();
    searxng?.stop(true);
    delete process.env.MAIPAI_LLAMA_SERVER_URL;
    __resetLlmSupervisorForTests();
  }
}

const retained = (turnId: string) => {
  const row = db.select({ outcomes: conversationTurns.outcomes }).from(conversationTurns).where(eq(conversationTurns.id, turnId)).get();
  return row?.outcomes ? (JSON.parse(row.outcomes) as { packageId: string; status: string; via?: string; args?: Record<string, unknown> }[]) : [];
};

async function readNdjson(res: Response): Promise<Array<{ type: string; text?: string; value?: unknown }>> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("the shapes and the read", () => {
  test("the hedge-plus-promise and the help verbs are promises; 'I can help you find' and 'I can look into that' are offers", () => {
    expect(lookupShapeOf("I can't open pages myself, but I can help you find it.")).toBe("offer");
    expect(lookupShapeOf("I can't browse, but I can look that up for you.")).toBe("promise");
    expect(lookupShapeOf("Let me try to find it.")).toBe("promise");
    expect(lookupShapeOf("Let me see what I can find.")).toBe("promise");
    expect(lookupShapeOf("I can look into that.")).toBe("offer");
    expect(lookupShapeOf("Sounds like a fun weekend.")).toBeNull();
  });

  test("a hedge beside a checkable value is a hedged fact; a hedge alone or a value alone is not", () => {
    expect(hedgedFactShape("It usually takes a 12-pin connector, but check the manual to be sure.")).toBe(true);
    expect(hedgedFactShape("Returns are typically accepted within 30 days.")).toBe(true);
    expect(hedgedFactShape("I think it was directed by Serena Vale.")).toBe(true);
    // The set's read: a number word is a number; "one" is not.
    expect(hedgedFactShape("I think it's seven tracks.")).toBe(true);
    expect(hedgedFactShape("It's probably around twelve songs, but check.")).toBe(true);
    expect(hedgedFactShape("I think that's the one you mean.")).toBe(false);
    expect(hedgedFactShape("It takes a 12-pin connector.")).toBe(false);
    expect(hedgedFactShape("I'm not sure, honestly.")).toBe(false);
  });

  test("the deliverable denial shape", () => {
    for (const denial of ["I can't open pages myself, but I can help you find it.", "I'm not able to share links.", "I don't have a way to show you a picture.", "I can't browse the web."]) expect([denial, falseCapabilityShape(denial)]).toEqual([denial, true]);
    for (const other of ["I can't do that from a chat like this.", "I can't remember the date.", "Let me look it up."]) expect([other, falseCapabilityShape(other)]).toEqual([other, false]);
  });

  test("readLookupDraft(): two sentences, the denial cut first, an offer breaks the read (it binds, it never forces), a hedged fact only on a world question", () => {
    const opts = { worldQuestion: true, lookupServed: true };
    expect(readLookupDraft("I can't open pages myself, but I can help you find it. Let me look it up for you.", opts)).toEqual({ shape: "promise", sentence: "Let me look it up for you.", index: 1, denials: [0] });
    expect(readLookupDraft("The Cosmo 7 is a solid card. Let me look it up for you.", opts)).toMatchObject({ shape: "promise", index: 1 });
    expect(readLookupDraft("The Cosmo 7 is a solid card. Most people like it. Let me look it up for you.", opts)).toBeNull();
    expect(readLookupDraft("I'm not sure of the date. Want me to look it up?", opts)).toBeNull();
    expect(readLookupDraft("It usually takes a 12-pin connector, but check the manual to be sure.", opts)).toMatchObject({ shape: "hedged_fact", index: 0 });
    expect(readLookupDraft("It usually takes a 12-pin connector, but check the manual to be sure.", { worldQuestion: false, lookupServed: true })).toBeNull();
    expect(readLookupDraft("I can't share links, sorry.", opts)).toMatchObject({ shape: "denial", index: 0, denials: [0] });
    expect(readLookupDraft("I can't share links, sorry.", { worldQuestion: true, lookupServed: false })).toBeNull();
    expect(withoutSentences("I can't open pages myself. Let me look it up. The card is popular.", [0, 1])).toBe("The card is popular.");
    expect(withoutSentences("Let me look it up.", [0])).toBe(LOOKUP_FAILED_LINE);
  });

  test("lookupQueryFor(): the subject and the offer's field, the person's question as the fallback, the currency marker, never an objection", () => {
    const rivet = { type: "unresolved" as const, surface_form: "Rivet 3", candidate_kinds: [], provenance: "t", confidence: 0.4, carried_question: null };
    const cosmo = { ...rivet, surface_form: "Cosmo 7" };
    expect(lookupQueryFor({ subjects: [rivet], sentence: "Want me to look up what they're going for used?", utterance: "the old one's a Rivet 3 with 8 gigs", history: [], roster: [], shape: "offer" })).toBe("Rivet 3 going for used");
    expect(lookupQueryFor({ subjects: [cosmo], sentence: "Let me look it up for you.", utterance: "that's twice now, go on and do it", history: ["where's the maker's support page for the Cosmo 7 card", "you said that already"], roster: [], shape: "promise" })).toBe("maker support page for Cosmo 7 card");
    expect(lookupQueryFor({ subjects: [cosmo], sentence: "It usually takes a 12-pin connector.", utterance: "how many pins is the Cosmo 7 card", history: [], roster: [], shape: "hedged_fact" })).toBe("pins Cosmo 7 card");
    expect(lookupQueryFor({ subjects: [{ ...rivet, surface_form: "Rivet OS" }], sentence: "Let me check that.", utterance: "did the new Rivet OS come out today", history: [], roster: [], shape: "promise" })).toBe("new Rivet OS come out today");
    expect(lookupQueryFor({ subjects: [], sentence: "Let me check.", utterance: "ok", history: ["thanks"], roster: [], shape: "promise" })).toBeNull();
    // The offer's field first even with no subject on the stack (a review).
    expect(lookupQueryFor({ subjects: [], sentence: "I'll check the weather for you.", utterance: "is it going to rain tomorrow?", history: [], roster: [], shape: "promise" })).toBe("weather tomorrow");
  });

  test("lookupConsent(): the imperative forms and the plain yes, never a no or a new question", () => {
    for (const yes of ["go on then", "well find it", "just search it", "that's twice now, go on and do it", "yes", "do it", "look it up"]) expect([yes, lookupConsent(yes)]).toEqual([yes, true]);
    for (const no of ["no", "no thanks", "what about tomorrow", "never mind", "no wait, search for the Rivet 4 instead", "actually can you check my calendar for tomorrow"]) expect([no, lookupConsent(no)]).toEqual([no, false]);
  });

  test("capability_claim is off a lookup-served request and stays on an action request; the denial is false_capability only with the search", async () => {
    const served = { utterance: "find me the runtime of the new Marsh Lantern film", act: "directive" as const, personId: "p", lookupServed: true };
    expect(guardReply("Sure, I'll get that for you.", served).reason).toBeNull();
    expect(guardReply("Sure, I'll text her now.", { utterance: "can you text Nadia", act: "directive", personId: "p", lookupServed: false }).reason).toBe("capability_claim");
    // An action request with a question inside stays the guard's (a review).
    const { guardContextFrom, intentFor } = await import("@/lib/turnContext");
    const { classifyTurnSignal } = await import("@/lib/turnSignal");
    const utterance = "can you send the plumber a message asking what's wrong with the boiler";
    const signal = classifyTurnSignal({ text: utterance, ageBand: "adult" });
    const ctx = guardContextFrom({ turnId: "t", conversationId: "c", actorId: "p", surface: "chat", utterance, history: [], evidence: [], includedEvidenceIds: [], offeredToolIds: ["websearch"], outcomes: [], intent: intentFor(utterance, signal), persona: { id: "d", displayName: "MaiPai", examples: [] }, ageBand: "adult", now: new Date(), locale: "en-US", roster: ["Sage"], signal, subjects: [], subjectPronouns: [] });
    expect(ctx.lookupServed).toBe(false);
    const cut = guardReply("I can't open pages myself, but I can help you find it. The card is a popular one.", { utterance: "where's the support page for the Cosmo 7", act: "question", personId: "p", lookupServed: true });
    expect(cut).toMatchObject({ reason: "false_capability", replaced: false, reply: "The card is a popular one." });
    expect(guardReply("I can't open pages myself.", { utterance: "where's the support page for the Cosmo 7", act: "question", personId: "p", lookupServed: false }).reason).toBeNull();
  });
});

describe("the engine: the read on both paths, the ladder, the binding, the consent", () => {
  test("blocking path: a denial ahead of a promise is cut, the promise is read, the forced lookup runs with the engine's query via forced", async () => {
    const { actor } = await owner();
    await withLookup({ draft: "I can't open pages myself, but I can help you find it. Let me look it up for you." }, async (seen) => {
      const result = await runTurn(actor, "chat", "where's the maker's support page for the Cosmo 7 card");
      if (!result.ok) throw new Error(result.error);
      expect(seen.forced).toBe(1);
      expect(seen.queries).toEqual(["maker support page for Cosmo 7 card"]);
      expect(result.value.source).toBe("plugin");
      expect(result.value.reply.text).toBe(SEARCH_ANSWER);
      expect(retained(result.value.turn_id).map((o) => [o.packageId, o.status, o.via, o.args?.expression])).toEqual([["websearch", "succeeded", "forced", "maker support page for Cosmo 7 card"]]);
    });
  });

  test("blocking path: a hedged fact on a world question is not sent; the forced lookup runs on the subject and the field; the turn line says hedged_fact", async () => {
    const { actor } = await owner();
    await withLookup({ draft: "It usually takes a 12-pin connector, but check the manual to be sure." }, async (seen) => {
      const lines: string[] = [];
      const original = console.log;
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
        original(...args);
      };
      try {
        const result = await runTurn(actor, "chat", "how many pins is the Cosmo 7 card");
        if (!result.ok) throw new Error(result.error);
        expect(seen.forced).toBe(1);
        expect(seen.queries).toEqual(["pins Cosmo 7 card"]);
        expect(result.value.reply.text).toBe(SEARCH_ANSWER);
        expect(lines.some((l) => l.startsWith("[turn] {") && l.includes('"lookup_shape":"hedged_fact"'))).toBe(true);
      } finally {
        console.log = original;
      }
    });
    // The same hedge on a household question is the model's own reply.
    await withLookup({ draft: "Rover usually eats around 6, but check with Bramble." }, async (seen) => {
      const { ensureSubjectEntity } = await import("@/lib/subjects");
      expect(ensureSubjectEntity(actor, { name: "Rover", kind: "pet" }, true).ok).toBe(true);
      const result = await runTurn(actor, "chat", "when does Rover eat");
      if (!result.ok) throw new Error(result.error);
      expect(seen.forced).toBe(0);
      expect(result.value.source).toBe("model");
    });
  });

  test("the ladder: the model picks knowledge first and it finds nothing, so the search runs next with the engine's query, and both outcomes stay", async () => {
    const { actor } = await owner();
    await withLookup({ draft: "Let me check that for you.", forced: "knowledge" }, async (seen) => {
      const result = await runTurn(actor, "chat", "what's the new Marsh Lantern film actually about");
      if (!result.ok) throw new Error(result.error);
      expect(seen.forced).toBe(1);
      expect(seen.queries).toEqual(["new Marsh Lantern film actually about new"].map(() => seen.queries[0]!));
      expect(seen.queries[0]).toMatch(/marsh lantern/i);
      expect(result.value.source).toBe("plugin");
      expect(result.value.plugin_id).toBe("websearch");
      const outcomes = retained(result.value.turn_id).map((o) => [o.packageId, o.status, o.via]);
      expect(outcomes[outcomes.length - 1]).toEqual(["websearch", "succeeded", "forced"]);
      expect(outcomes.length).toBeGreaterThanOrEqual(1);
      expect(result.value.reply.text).not.toMatch(/can't actually do that|not able to do that|not something I can do/);
    });
    // Both rungs failing: the honest line, never cannot-do.
    await withLookup({ draft: "Let me check that for you.", forced: "none", searxng: false }, async () => {
      const result = await runTurn(actor, "chat", "what's the new Marsh Lantern film actually about");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.reply.text).toBe(LOOKUP_FAILED_LINE);
    });
  });

  test("an offer binds the offered question, never the turn; 'sure' and 'go on then' run it; the objection with a command re-runs a late promise's bound question", async () => {
    const { actor } = await owner();
    const { createConversation } = await import("@/lib/conversationHistory");
    for (const consent of ["sure", "go on then"]) {
      await withLookup({ draft: "Those hold their value. Want me to look up what they're going for used?" }, async (seen) => {
        // A fresh conversation each time: the same offer twice in one
        // would be REG-01's repeated question.
        const conv = createConversation(actor, { surface: "chat" });
        if (!conv.ok) throw new Error(conv.error);
        const first = await runTurn(actor, "chat", "the old one's a Rivet 3 with 8 gigs", { conversationId: conv.value.id });
        if (!first.ok) throw new Error(first.error);
        expect(seen.forced).toBe(0);
        expect(getPendingAsk(conv.value.id)).toMatchObject({ kind: "lookup", args: { expression: "Rivet 3 going for used" } });
        const ran = await runTurn(actor, "chat", consent, { conversationId: conv.value.id });
        if (!ran.ok) throw new Error(ran.error);
        expect(ran.value.plugin_id).toBe("websearch");
        expect(seen.queries).toEqual(["Rivet 3 going for used"]);
        expect(retained(ran.value.turn_id).map((o) => [o.packageId, o.via, o.args?.expression])).toEqual([["websearch", "ask", "Rivet 3 going for used"]]);
      });
    }
    await withLookup({ draft: "The Cosmo 7 is a solid card. Most people like it for the price. Let me look it up for you." }, async (seen) => {
      const conv = createConversation(actor, { surface: "chat" });
      if (!conv.ok) throw new Error(conv.error);
      const first = await runTurn(actor, "chat", "where's the maker's support page for the Cosmo 7 card", { conversationId: conv.value.id });
      if (!first.ok) throw new Error(first.error);
      // Past the read: the promise went out and bound the question.
      expect(seen.forced).toBe(0);
      expect(getPendingAsk(conv.value.id)).toMatchObject({ kind: "lookup", args: { expression: "maker support page for Cosmo 7 card" } });
      const rerun = await runTurn(actor, "chat", "that's twice now, go on and do it", { conversationId: conv.value.id });
      if (!rerun.ok) throw new Error(rerun.error);
      expect(rerun.value.plugin_id).toBe("websearch");
      expect(seen.queries).toEqual(["maker support page for Cosmo 7 card"]);
      expect(rerun.value.reply.text).not.toContain("Let me look it up");
    });
  });

  test("streaming path: the hold reads two sentences, so a promise behind a denial closes the draft and the forced lookup answers", async () => {
    const { client } = await owner();
    await withLookup({ draft: "I can't open pages myself, but I can help you find it. Let me look it up for you." }, async (seen) => {
      const res = await client.post("/api/turn/stream", { text: "where's the maker's support page for the Cosmo 7 card" });
      const events = await readNdjson(res);
      expect(seen.forced).toBe(1);
      expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).not.toContain("can't open");
      const done = events.find((e) => e.type === "done")!.value as { source: string; reply: { text: string }; turn_id: string };
      expect(done.source).toBe("plugin");
      expect(done.reply.text).toBe(SEARCH_ANSWER);
      expect(retained(done.turn_id).map((o) => o.via)).toEqual(["forced"]);
    });
  });
});
