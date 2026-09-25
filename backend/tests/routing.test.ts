// The remaining routing helpers only classify command shape and provide
// one utterance embedding for memory recall; package examples no longer
// have embedding rows or participate in routing decisions.
import { describe, test, expect } from "bun:test";
import { embedUtterance, conversationShaped, utteranceShape, commandOpenersFrom } from "@/lib/routing";

describe("embedUtterance() for memory recall", () => {
  test("returns a real vector for real text", async () => {
    const vector = await embedUtterance("what's the weather in Seattle");
    expect(vector).toBeDefined();
    expect(vector!.vector).toBeInstanceOf(Float32Array);
    expect(vector!.vector.length).toBeGreaterThan(0);
    expect(vector!.space).toBe("embed");
    expect(vector!.preprocess).toBe("v1");
  });

  test("returns undefined rather than throwing when embed rejects the input", async () => {
    expect(await embedUtterance("")).toBeUndefined();
  });
});

describe("conversation shape", () => {
  const openers = commandOpenersFrom(["remember that *", "remember *", "turn off the * light", "set a timer for *", "give me a trivia question", "what does * mean"]);

  test("commandOpenersFrom reads declared command verbs, not question openers or wildcards", () => {
    expect([...openers].sort()).toEqual(["give", "remember", "set", "turn"]);
  });

  test("recognizes questions and first-person turns as conversational", () => {
    expect(conversationShaped("who wrote the book IT")).toBe(true);
    expect(conversationShaped("I'm feeling kind of down")).toBe(true);
    expect(utteranceShape("who won the 1998 world cup")).toBe("question");
    expect(utteranceShape("I'm feeling kind of down")).toBe("first_person");
  });

  test("polite commands remain command-shaped", () => {
    expect(conversationShaped("can you set a timer for ten minutes?", openers)).toBe(false);
    expect(utteranceShape("please remember that the gate code is 4412", openers)).toBe("command");
  });
});
