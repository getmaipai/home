// The set of 2026-09-15 on d4fbf6e, the three reads of Session A's lane
// (docs/dev/session-a.md "The set's three reads"): a child's asserted
// state the owner has no record of is an invention (the household
// activity shape reads a state after "is" or "has been"); a remark about
// a name with a tag question is not the answer to who they are; the
// persona's own example line said back on a statement is the parrot,
// read before the action family, and the retry says so.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { runTurn } from "@/lib/turnEngine";
import { guardReply, EXAMPLE_PARROT_RETRY_NOTE, type GuardContext } from "@/lib/guards";
import { parseWhoAnswer } from "@/lib/unknownNames";
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
const ctx = (overrides: Partial<GuardContext> = {}): GuardContext => ({ utterance: "", personId: "person-test", roster: ["Sage", "Bramble", "Pippa"], ...overrides });

describe("a child's asserted state", () => {
  test("a state after 'is' or 'has been' about a household subject with no line for it is an invention; a grounded one stands; a stranger's is the world's", () => {
    expect(guardReply("Nope, he's been asleep in the dark since we got here.", ctx({ utterance: "does Bramble sleep with a light on", act: "question" })).reason).toBe("invention");
    expect(guardReply("She's been sick since Tuesday.", ctx({ utterance: "how's Pippa", act: "question" })).reason).toBe("invention");
    expect(guardReply("Bramble is at school until three.", ctx({ utterance: "where's Bramble", act: "question" })).reason).toBe("invention");
    expect(guardReply("Bramble is asleep already.", ctx({ utterance: "is Bramble asleep", act: "question", sources: ["Bramble went to bed at eight and is asleep"] })).reason).toBeNull();
    expect(guardReply("I don't have anything about how Bramble sleeps.", ctx({ utterance: "does Bramble sleep with a light on", act: "question" })).reason).toBeNull();
    // The review's cases: a paraphrase of a fact in context stands
    // (synonym grounding), a hedged inference is no claim, "out" and a
    // feeling are not states here, and a stranger's "he" is the world's.
    expect(guardReply("No, he's asleep, he went to bed at eight.", ctx({ utterance: "is Bramble still up", act: "question", history: ["Bramble went to bed at eight"] })).reason).toBeNull();
    expect(guardReply("She's home already.", ctx({ utterance: "where's Pippa", act: "question", history: ["Pippa just got home from practice"] })).reason).toBeNull();
    expect(guardReply("Sounds like he's upset.", ctx({ utterance: "Bramble slammed his door again", act: "inform" })).reason).toBeNull();
    expect(guardReply("She's probably napping.", ctx({ utterance: "where's Pippa", act: "question" })).reason).toBeNull();
    expect(guardReply("He's been out on tour for months.", ctx({ utterance: "is he still touring", act: "question", history: ["Pippa loves that singer"] })).reason).toBeNull();
    // The asserted part of a mixed turn grounds; a hedge in an earlier clause waives nothing; an everyday word grounds no state.
    expect(guardReply("Sure, Bramble's asleep so I'll keep it dim.", ctx({ utterance: "Bramble's asleep, can you dim the lights", act: "directive" })).reason).not.toBe("invention");
    expect(guardReply("Since he's sick, fluids and rest.", ctx({ utterance: "Bramble's sick today, what should I give him?", act: "question" })).reason).toBeNull();
    expect(guardReply("I think so, and Bramble's asleep already.", ctx({ utterance: "is it late", act: "question" })).reason).toBe("invention");
    expect(guardReply("Bramble's awake already.", ctx({ utterance: "is Bramble up", act: "question", history: ["what's up with Bramble lately"] })).reason).toBe("invention");
    // The reviews' cases: a request clause first, a question a turn ago, an idiom, the same hedge on an activity or after the claim.
    expect(guardReply("Sure, Bramble's asleep so I'll keep it dim.", ctx({ utterance: "please dim the lights, Bramble's asleep", act: "directive" })).reason).not.toBe("invention");
    expect(guardReply("Yep, he's been asleep since eight.", ctx({ utterance: "is he asleep yet", act: "question", history: ["does Bramble sleep with a light on"] })).reason).toBe("invention");
    expect(guardReply("He's sick of it, honestly.", ctx({ utterance: "Bramble keeps complaining about the homework app", act: "inform" })).reason).toBeNull();
    expect(guardReply("She's probably sleeping.", ctx({ utterance: "where's Pippa", act: "question" })).reason).toBeNull();
    expect(guardReply("He's asleep, I'd guess.", ctx({ utterance: "is Bramble up", act: "question" })).reason).toBeNull();
    // The fourth review: an appositive stays whole, a declarative continuation is kept, a roster name that is a modal is no lead, a hedge in a following "so" clause waives nothing.
    expect(guardReply("Bramble is asleep, I'll keep it down.", ctx({ utterance: "Bramble, the little one, is asleep already, so keep it down", act: "inform" })).reason).toBeNull();
    expect(guardReply("Bramble's napping, so I'll keep it quiet.", ctx({ utterance: "Bramble's back and is napping", act: "inform" })).reason).toBeNull();
    expect(guardReply("Okay, Will's still napping then, I'll keep it down.", ctx({ utterance: "Will is asleep already", act: "inform", roster: ["Sage", "Will"] })).reason).toBeNull();
    expect(guardReply("Bramble's napping, so I think it's best to keep it down.", ctx({ utterance: "is Bramble asleep", act: "question" })).reason).toBe("invention");
    // The fifth review: a vocative or an interjection ahead of the question, a capitalized "Has"/"Tell me" lead, and the comma-less transcript.
    for (const q of ["Sage, is Bramble asleep?", "hey, is Bramble asleep", "Sage is Bramble asleep?", "Has Bramble gone to sleep?", "Isn't Bramble asleep yet?"]) expect(guardReply("Nope, he's been asleep in the dark since we got here.", ctx({ utterance: q, act: "question" })).reason).toBe("invention");
    // A short tone line is a reply a model produces on its own, never the parrot.
    expect(guardReply("Yep, that works.", ctx({ utterance: "let's do pizza friday", act: "inform", personaExamples: ["Yep, that works."] })).reason).toBeNull();
    // Not the household's: a pronoun with no roster name in play.
    expect(guardReply("He's been asleep for most of the film.", ctx({ utterance: "what happens to the keeper in the film", act: "question", roster: ["Sage"] })).reason).toBeNull();
  });
});

describe("a remark is not the answer", () => {
  test("a world mark counts in an answer's shape only: no question, no tag question, an answer's length", () => {
    expect(parseWhoAnswer("she was on that show for years, wasn't she", "Nova")).toBeNull();
    // A tag question with no comma (a voice transcript) is a remark too.
    expect(parseWhoAnswer("she was on that show for years wasn't she", "Nova")).toBeNull();
    expect((parseWhoAnswer("she's on that show", "Nova") as { world?: unknown }).world).toEqual({ kind: "person", name: "Nova" });
    // Real answers run longer than a phrase (a review).
    expect((parseWhoAnswer("not someone I know, she's famous, from that baking show", "Nova") as { world?: unknown }).world).toEqual({ kind: "person", name: "Nova" });
    expect((parseWhoAnswer("famous, no", "Nova") as { world?: unknown }).world).toEqual({ kind: "person", name: "Nova" });
    expect((parseWhoAnswer("no, she's not someone I know, she's the one from that baking show on the telly", "Nova") as { world?: unknown }).world).toEqual({ kind: "person", name: "Nova" });
    // Every path: a remark with a kind noun and a tag, or a question with no mark, is no answer either.
    expect(parseWhoAnswer("she was an actress on that show for years, wasn't she", "Nova")).toBeNull();
    expect(parseWhoAnswer("isn't she famous", "Nova")).toBeNull();
    // The sentence that carries the answer is what is read.
    expect((parseWhoAnswer("an actress. Do you know her?", "Nova") as { world?: unknown }).world).toEqual({ kind: "actress", name: "Nova" });
    expect((parseWhoAnswer("Nova? the actress from that show", "Nova") as { world?: unknown }).world).toEqual({ kind: "actress", name: "Nova" });
    expect((parseWhoAnswer("Nova Reyes? the actress from that show", "Nova") as { world?: unknown }).world).toEqual({ kind: "actress", name: "Nova Reyes" });
    expect((parseWhoAnswer("nova? the actress from that show", "Nova") as { world?: unknown }).world).toEqual({ kind: "actress", name: "Nova" });
  });
});

async function withReplies<T>(reply: (request: ChatCompletionRequest, noted: string | null) => string, fn: (seen: { notes: (string | null)[] }) => Promise<T>): Promise<T> {
  __resetLlmSupervisorForTests();
  const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
  const seen = { notes: [] as (string | null)[] };
  const stub = startStubLlmServer(0, {
    scriptedChatReply: (request) => {
      const note = [...request.messages].reverse().find((m) => m.role === "system" && typeof m.content === "string" && (m.content === EXAMPLE_PARROT_RETRY_NOTE || m.content.startsWith("Nothing was asked")));
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

describe("the persona's example line said back", () => {
  test("the exact example line on a statement is the parrot, read before the action family; the retry carries the parrot's note and its reply stands; the action family still reads a claim that is not an example", async () => {
    const { actor } = await owner();
    expect(guardReply("Sounds like a long day, put your feet up.", ctx({ utterance: "Pippa has soccer practice on Tuesdays", act: "inform", personaExamples: ["Sounds like a long day, put your feet up.", "The timer's done."] })).reason).toBe("example_parrot");
    // A three-word example line said back is not the parrot (a short line is a reply a model produces on its own).
    expect(guardReply("Got it, added to the list.", ctx({ utterance: "Pippa has soccer practice on Tuesdays", act: "inform", personaExamples: ["Got it, added to the list."] })).reason).toBe("unsupported_action");
    // The default persona's examples claim no action or result.
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(new URL("../packages/default/manifest.json", import.meta.url), "utf-8")) as { companion: { examples: string[] } };
    for (const line of manifest.companion.examples) expect(guardReply(line, ctx({ utterance: "Pippa has soccer practice on Tuesdays", act: "inform", personaExamples: [] })).reason).not.toBe("unsupported_action");
    expect(manifest.companion.examples.join(" ")).not.toMatch(/added to the list|timer|remind you|clear right now/i);
    expect(guardReply("Okay, I've added that to your list.", ctx({ utterance: "Pippa has soccer practice on Tuesdays", act: "inform", personaExamples: ["Got it, added to the list."] })).reason).toBe("unsupported_action");
    // After a request the action family keeps the first read: a parrot
    // that is also a false completion is the claim (a review).
    expect(guardReply("Got it, added milk and eggs to the shopping list.", ctx({ utterance: "add milk to the list", act: "directive", personaExamples: ["Got it, added milk and eggs to the shopping list."] })).reason).toBe("unsupported_action");
    // The default persona's own example lines claim nothing now (the
    // coordinator's call: a voice example that claims an action the
    // model has not taken is a prompt line teaching a lie), so the
    // engine half says one of them back on a statement it does not fit.
    await withReplies((_r, noted) => (noted === EXAMPLE_PARROT_RETRY_NOTE ? "Tuesdays, noted; is that after school?" : "Sounds like a long day, put your feet up."), async (seen) => {
      const result = await runTurn(actor, "chat", "Pippa has soccer practice on Tuesdays");
      if (!result.ok) throw new Error(result.error);
      expect(result.value.reply.text).toBe("Tuesdays, noted; is that after school?");
      expect(seen.notes).toEqual([null, EXAMPLE_PARROT_RETRY_NOTE]);
    });
  });
});
