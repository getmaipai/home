import { expect, test } from "bun:test";
import { isOwnEcho, isOwnEchoTurn, normalizeOwnEchoTranscript } from "./ownEcho";

const T0 = 100_000;
const story = "Oh, I am so sorry. There was a story about a dragon named Ember.";

test("normalization expands contractions and equates curly apostrophes", () => {
  expect(normalizeOwnEchoTranscript("I'm so sorry")).toBe("i am so sorry");
  expect(normalizeOwnEchoTranscript("I’m so sorry")).toBe("i am so sorry");
});

test("soft openers, contraction variants, and garbled content are recognized as echo", () => {
  expect(isOwnEcho("I'm so sorry.", ["Oh, I am so sorry."])).toBe(true);
  expect(isOwnEcho("that I'm sorry.", ["that I’m sorry you’re the one"])).toBe(true);
  expect(isOwnEcho("Stop the drag.", ["There was a story about a dragon."])).toBe(true);
  expect(isOwnEcho("Hey yeah.", ["Just me here. I'm here if you want to talk."])).toBe(true);
  expect(isOwnEcho("Hey yeah.", ["Hey, I'm doing well."])).toBe(true);
});

test("hard stop commands stay person turns, including when their words occur in Home's story", () => {
  expect(isOwnEcho("Wait, stop.", ["He had to wait. Then he could not stop laughing."])).toBe(false);
  expect(isOwnEcho("Wait, stop. Sorry about that. What were you going to say?", ["Wait, I am sorry."])).toBe(false);
});

test("committed transcript echo drop honors timing, hard commands, and cut-ins", () => {
  expect(isOwnEchoTurn({ transcript: "I'm so sorry.", spoken: story, speechStartMs: T0 - 500, lastSpokeMs: T0, nowMs: T0 + 600 }).drop).toBe(true);
  expect(isOwnEchoTurn({ transcript: "that I'm sorry you're", spoken: "Oh, just that I’m sorry you’re the one saying sorry.", speechStartMs: T0 - 300, lastSpokeMs: T0, nowMs: T0 + 800 }).drop).toBe(true);
  expect(isOwnEchoTurn({ transcript: "Wait, stop. Sorry about that. What were you going to say?", spoken: "Oh, I am so sorry. That is a real loss.", speechStartMs: T0 - 200, lastSpokeMs: T0, nowMs: T0 + 900 }).drop).toBe(false);
  expect(isOwnEchoTurn({ transcript: "Oh, I am so sorry.", spoken: "Oh, I am so sorry. That is a real loss.", speechStartMs: T0 + 2000, lastSpokeMs: T0, nowMs: T0 + 3500 }).drop).toBe(false);
  expect(isOwnEchoTurn({ transcript: "I'm so sorry.", spoken: "Oh, I am so sorry.", speechStartMs: T0 - 300, lastSpokeMs: T0 - 15_000, nowMs: T0 }).drop).toBe(false);
  expect(isOwnEchoTurn({ transcript: "I'm so sorry.", spoken: story, speechStartMs: T0 - 500, lastSpokeMs: T0, nowMs: T0 + 600, followedAcceptedCutIn: true }).drop).toBe(false);
});
