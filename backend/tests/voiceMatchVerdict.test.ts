import { afterEach, expect, test } from "bun:test";
import { clearVoiceMatchVerdictsForTests, consumeVoiceMatchVerdict, setVoiceMatchVerdict } from "@/lib/voiceMatchVerdict";

afterEach(clearVoiceMatchVerdictsForTests);

test("verdict is consumed once and belongs only to its person", async () => {
  setVoiceMatchVerdict("person-a", Promise.resolve("agree"), 1000);
  expect(await consumeVoiceMatchVerdict("person-b", 0, 1000)).toBeNull();
  expect(await consumeVoiceMatchVerdict("person-a", 0, 1000)).toBe("agree");
  expect(await consumeVoiceMatchVerdict("person-a", 0, 1000)).toBeNull();
});

test("pending results wait only for the requested short window and expire", async () => {
  let resolve!: (value: "disagree") => void;
  setVoiceMatchVerdict("person-a", new Promise((done) => { resolve = done; }), 1000);
  expect(await consumeVoiceMatchVerdict("person-a", 0, 1000)).toBeNull();
  resolve("disagree");
  setVoiceMatchVerdict("person-b", Promise.resolve("agree"), 1000);
  expect(await consumeVoiceMatchVerdict("person-b", 0, 31_001)).toBeNull();
});

test("an unset verdict consumes as skipped and a recorded disagreement is one-shot", async () => {
  expect(await consumeVoiceMatchVerdict("person-none", 0)).toBeNull();
  setVoiceMatchVerdict("person-a", Promise.resolve("disagree"));
  expect(await consumeVoiceMatchVerdict("person-a", 0)).toBe("disagree");
  expect(await consumeVoiceMatchVerdict("person-a", 0)).toBeNull();
});
