// CHAT-01 (docs/dev/session-a.md): the ephemeral turn context, the one
// view the prompt and the guards share. These are the unit tests of its
// own rules; tests/turnEngine.test.ts proves them through runTurn() with
// scripted completions.
import { describe, expect, test } from "bun:test";
import { guardContextFrom, intentFor, markIncluded, includedEvidence, framedUnknownNames, sourcesFromRows, type TurnContext, type TurnEvidence } from "@/lib/turnContext";
import { classifyTurnSignal } from "@/lib/turnSignal";

// ACT-01: the intent and the guards' shape read the frozen signal; the
// tests classify the utterance the way prepareTurn() does, with the
// bundled command openers a test needs.
const openers = new Set(["set", "explain", "give", "walk", "tell"]);
const signalFor = (text: string) => classifyTurnSignal({ text, commandOpeners: openers, ageBand: "adult" });

test("sourcesFromRows(): keeps eight safe web sources and normalizes URLs", () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ title: `Result ${i}`, url: `https://example.com/${i}` }));
  rows[8] = { title: "Script", url: "javascript:alert(1)" };
  rows[2] = { title: "Credentials", url: "https://user:pw@example.com/a#frag" };
  rows[3] = { title: "WWW", url: "https://www.example.com/" };
  const sources = sourcesFromRows(rows);
  expect(sources).toHaveLength(8);
  expect(sources.some((s) => s.url === "https://example.com/a")).toBe(true);
  expect(sources.find((s) => s.title === "Credentials")?.site).toBe("example.com");
  expect(sources.find((s) => s.title === "WWW")?.site).toBe("example.com");
  expect(sources.some((s) => s.url.startsWith("javascript:"))).toBe(false);
});

const evidence = (id: string, kind: TurnEvidence["kind"], text: string, rendered = text): TurnEvidence => ({ id, kind, text, rendered, entityIds: [] });

function context(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    turnId: "turn-1",
    conversationId: "conv-1",
    actorId: "person-1",
    surface: "chat",
    utterance: "where is Pippa",
    history: [],
    evidence: [],
    includedEvidenceIds: [],
    offeredToolIds: [],
    outcomes: [],
    intent: intentFor("where is Pippa", signalFor("where is Pippa")),
    persona: { id: "default", displayName: "MaiPai", examples: ["Pippa is at the zoo today."] },
    ageBand: "adult",
    now: new Date("2026-09-13T15:00:00Z"),
    locale: "en-US",
    roster: ["Sage", "Pippa"],
    signal: signalFor("where is Pippa"),
    subjects: [],
    subjectPronouns: [],
    ...overrides,
  };
}

describe("markIncluded(): selection is the render", () => {
  test("an item is included only when the text the prompt shows for it survived intact; the utterance always is", () => {
    const ctx = context({
      evidence: [
        evidence("user:turn-1", "user_assertion", "where is Pippa"),
        evidence("memory:m1", "memory", "Pippa has soccer on Tuesdays", "- Pippa has soccer on Tuesdays (as of Sep 1, 12 days ago)"),
        evidence("memory:m2", "memory", "the trash goes out on Monday", "- the trash goes out on Monday (as of Sep 1, 12 days ago)"),
        evidence("clock", "clock", "Local time: Sunday, September 13, 2026, 3:00 pm"),
      ],
    });
    // m2's line was cut by a section cap: only its first half is in the prompt.
    markIncluded(ctx, "Context:\n- Pippa has soccer on Tuesdays (as of Sep 1, 12 days ago)\n- the trash goes out on M...\n\nLocal time: Sunday, September 13, 2026, 3:00 pm");
    expect(ctx.includedEvidenceIds).toEqual(["user:turn-1", "memory:m1", "clock"]);
    expect(includedEvidence(ctx).map((e) => e.id)).toEqual(["user:turn-1", "memory:m1", "clock"]);
  });
});

describe("guardContextFrom(): the guard input from the included evidence alone", () => {
  test("memories are sources, episodes are episodes, the profile, summary, roster and clock ground words, and nothing excluded reaches any of them", () => {
    const ctx = context({
      evidence: [
        evidence("memory:m1", "memory", "Pippa has soccer on Tuesdays"),
        evidence("memory:m2", "memory", "the trash goes out on Monday"),
        evidence("profile:p1", "profile", "Sage is a night-shift paramedic."),
        evidence("episode:e1", "episode", "we should try the new pool"),
        evidence("summary:conv-1", "summary", "Earlier: they planned a trip to the coast."),
        evidence("household:person-2", "household", "Pippa", "- Pippa (child)"),
        evidence("clock", "clock", "Local time: Sunday, September 13, 2026, 3:00 pm"),
      ],
      includedEvidenceIds: ["memory:m1", "profile:p1", "episode:e1", "summary:conv-1", "household:person-2", "clock"],
      history: [
        { role: "user", content: "what is Pippa up to" },
        { role: "assistant", content: "Pippa is at the library, I think." },
      ],
    });
    const guard = guardContextFrom(ctx);
    expect(guard.sources).toEqual(["Pippa has soccer on Tuesdays"]); // m2 was not in the prompt
    expect(guard.episodes).toEqual(["we should try the new pool"]);
    expect(guard.grounding).toEqual(["Sage is a night-shift paramedic.", "Earlier: they planned a trip to the coast.", "Pippa", "Local time: Sunday, September 13, 2026, 3:00 pm"]);
    expect(guard.history).toEqual(["what is Pippa up to"]); // the assistant's guess is not history the guard grounds on
    expect(guard.roster).toEqual(["Sage", "Pippa"]);
    expect(guard.personaExamples).toEqual(["Pippa is at the zoo today."]);
  });

  test("an assistant line and a persona example never become sources or grounding", () => {
    const ctx = context({
      history: [{ role: "assistant", content: "Pippa is at the library, I think." }],
    });
    const guard = guardContextFrom(ctx);
    expect(guard.sources).toEqual([]);
    expect(guard.grounding).toEqual([]);
    expect(guard.history).toEqual([]);
    expect(JSON.stringify([guard.sources, guard.grounding, guard.episodes])).not.toContain("zoo");
  });

  test("outcomes carry package id and status, and a summary that mentions an action is never one (CHAT-04 replaced actionsRan)", () => {
    const summary = evidence("summary:conv-1", "summary", "Earlier: MaiPai set a timer for the pasta.");
    expect(guardContextFrom(context({ evidence: [summary], includedEvidenceIds: ["summary:conv-1"] })).outcomes).toEqual([]);
    expect(guardContextFrom(context({ outcomes: [{ callId: "c1", packageId: "timer", status: "failed", errorCode: "400" }] })).outcomes).toEqual([{ packageId: "timer", status: "failed" }]);
    expect(guardContextFrom(context({ outcomes: [{ callId: "c1", packageId: "lock-doors", status: "pending" }] })).outcomes).toEqual([{ packageId: "lock-doors", status: "pending" }]);
    expect(guardContextFrom(context({ outcomes: [{ callId: "c1", packageId: "timer", status: "succeeded" }] })).outcomes).toEqual([{ packageId: "timer", status: "succeeded" }]);
  });
});

describe("intentFor(): the provisional intent", () => {
  test("kind reads the shape and defaults to chat; query is the utterance", () => {
    expect(intentFor("who won the 1998 world cup", signalFor("who won the 1998 world cup")).kind).toBe("lookup");
    expect(intentFor("set a timer for ten minutes", signalFor("set a timer for ten minutes")).kind).toBe("action");
    expect(intentFor("good morning", signalFor("good morning")).kind).toBe("chat");
    expect(intentFor("I'm feeling kind of down", signalFor("I'm feeling kind of down")).kind).toBe("chat");
    expect(intentFor("who won the 1998 world cup", signalFor("who won the 1998 world cup")).query).toBe("who won the 1998 world cup");
  });

  test("the detail flag is set only for the three phrasings, case-insensitive", () => {
    expect(intentFor("explain photosynthesis in detail", signalFor("explain photosynthesis in detail")).explicitDetailedAnswer).toBe(true);
    expect(intentFor("give me a DETAILED EXPLANATION of the rules", signalFor("give me a DETAILED EXPLANATION of the rules")).explicitDetailedAnswer).toBe(true);
    expect(intentFor("walk me through it step by step", signalFor("walk me through it step by step")).explicitDetailedAnswer).toBe(true);
    expect(intentFor("tell me about photosynthesis", signalFor("tell me about photosynthesis")).explicitDetailedAnswer).toBe(false);
    expect(intentFor("what are the details of the plan", signalFor("what are the details of the plan")).explicitDetailedAnswer).toBe(false);
  });
});

describe("ASK-01: the guards' unknown names are the context line's", () => {
  test("a framed name with no noun is unknown; a kind-stated or bare one is not", () => {
    const refs = [
      { type: "unresolved" as const, surface_form: "Clover", candidate_kinds: [], provenance: "t", confidence: 0.8, carried_question: null },
      { type: "unresolved" as const, surface_form: "Nadia", candidate_kinds: ["person" as const], provenance: "t", confidence: 0.8, carried_question: null },
      { type: "unresolved" as const, surface_form: "Cobra", candidate_kinds: [], provenance: "t", confidence: 0.4, carried_question: null },
      { type: "household" as const, entity_id: "ent-abcdef", carried_question: null },
    ];
    expect(framedUnknownNames({ subjects: refs })).toEqual(["Clover"]);
    expect(guardContextFrom(context({ subjects: refs, subjectPronouns: [{ name: "Clover", pronouns: "she" }], utterance: "Clover borrowed our tent and she loved it" })).unknownNames).toEqual(["Clover"]);
    expect(guardContextFrom(context({ subjects: refs, utterance: "Clover borrowed our tent and she loved it" })).pronounsInPlay).toEqual(["she"]);
  });
});
