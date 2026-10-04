// Objection handling: a bare assertion of understanding is cut
// (self_assertion), and the retry note carries the objection.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { guardReply, OBJECTION_RETRY_NOTE, objectionRetryNote, isObjectionTurn, type GuardContext } from "@/lib/guards";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

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

