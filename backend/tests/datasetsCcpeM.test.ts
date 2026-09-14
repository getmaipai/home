// Lane 13 item 1: a small embedded sample in CCPE-M's own real shape
// (found live against ccpe/data.json, 2026-09-14).
import { describe, expect, test } from "bun:test";
import { loadCcpeM } from "../scripts/bench/datasets/ccpeM";

const SAMPLE = [
  {
    conversationId: "CCPE-8e113",
    utterances: [
      { index: 0, speaker: "ASSISTANT", text: "generally speaking what type of movies do you watch" },
      {
        index: 1,
        speaker: "USER",
        text: "I like thrillers a lot.",
        segments: [
          { text: "thrillers", annotations: [{ annotationType: "ENTITY_NAME" }] },
          { text: "I like thrillers a lot", annotations: [{ annotationType: "ENTITY_PREFERENCE" }] },
        ],
      },
      {
        index: 2,
        speaker: "USER",
        text: "Movies with a strong female lead, mostly.",
        segments: [{ text: "Movies with a strong female lead", annotations: [{ annotationType: "ENTITY_DESCRIPTION" }] }],
      },
    ],
  },
];

describe("loadCcpeM", () => {
  test("one conversation per conversationId, prefixed so ids never collide with another source", () => {
    const { conversations } = loadCcpeM(SAMPLE);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.id).toBe("ccpe-m-CCPE-8e113");
    expect(conversations[0]!.source).toBe("ccpe-m");
  });

  test("turns carry the raw speaker and text", () => {
    const { conversations } = loadCcpeM(SAMPLE);
    const turns = conversations[0]!.sessions[0]!.turns;
    expect(turns).toHaveLength(3);
    expect(turns[1]!.speaker).toBe("USER");
    expect(turns[1]!.text).toBe("I like thrillers a lot.");
  });

  test("every segment annotation on every turn is collected, keyed by turnId", () => {
    const { annotations } = loadCcpeM(SAMPLE);
    expect(annotations).toEqual([
      { turnId: "CCPE-8e113:1", annotationType: "ENTITY_NAME" },
      { turnId: "CCPE-8e113:1", annotationType: "ENTITY_PREFERENCE" },
      { turnId: "CCPE-8e113:2", annotationType: "ENTITY_DESCRIPTION" },
    ]);
  });

  test("a turn with no segments contributes no annotations", () => {
    const { annotations } = loadCcpeM(SAMPLE);
    expect(annotations.some((a) => a.turnId === "CCPE-8e113:0")).toBe(false);
  });
});
