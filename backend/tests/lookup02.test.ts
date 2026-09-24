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
import { runTurn, householdSubjectTurn } from "@/lib/turnEngine";
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
  // U6: the flip, decided (home/docs/dev.md, 2026-09-24) - pinned
  // explicitly now that old is no longer the default (the direct
  // runTurn() calls here don't care either way; a route-level case does).
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

const SEARCH_ANSWER = "The support page is on the maker's site, with the manual and the pin count.";

/** The stub answers every plain completion with `draft`; a forced
 * completion (tool_choice required) calls the tool named by `forced`
 * (websearch with the model's own guess of a query, or knowledge, or
 * none); the composition (CHAT-16, the request carrying `role: "tool"`
 * messages) answers SEARCH_ANSWER; the fake SearXNG counts queries and
 * answers unless `searxng` is false. CHAT-16 (K2) skips the model's rung
 * when the search is the only lookup tool ranked (every turn here), so
 * `seen.forced` stays 0 and the search's run shows in `seen.queries`
 * and the retained forced outcome. */
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
      if (request.messages.some((m) => m.role === "tool")) return SEARCH_ANSWER;
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
