import { describe, expect, test } from "bun:test";
import { pickStatusPhrase } from "@/lib/statusPhrases";
import { DEFAULT_PERSONA } from "@/lib/persona";
import statusPhrasesVocab from "@maipai/spec/vocab/status-phrases.json" with { type: "json" };

describe("pickStatusPhrase", () => {
  test("picks from the default vocab for a persona with no status_phrases of its own", () => {
    const conversationId = crypto.randomUUID();
    for (const moment of ["thinking", "searching", "checking"] as const) {
      expect(statusPhrasesVocab[moment]).toContain(pickStatusPhrase(conversationId, moment, DEFAULT_PERSONA));
    }
  });

  test("a companion's own set overrides one moment and falls back to the default for the others", () => {
    const conversationId = crypto.randomUUID();
    const persona = { ...DEFAULT_PERSONA, status_phrases: { searching: ["Hunting around…"] } };
    expect(pickStatusPhrase(conversationId, "searching", persona)).toBe("Hunting around…");
    expect(statusPhrasesVocab.thinking).toContain(pickStatusPhrase(conversationId, "thinking", persona));
    expect(statusPhrasesVocab.checking).toContain(pickStatusPhrase(conversationId, "checking", persona));
  });

  test("never repeats the immediately previous phrase for the same conversation and moment", () => {
    const conversationId = crypto.randomUUID();
    let previous = pickStatusPhrase(conversationId, "thinking", DEFAULT_PERSONA);
    for (let i = 0; i < 20; i++) {
      const next = pickStatusPhrase(conversationId, "thinking", DEFAULT_PERSONA);
      expect(next).not.toBe(previous);
      previous = next;
    }
  });

  test("a different moment for the same conversation rotates independently", () => {
    const conversationId = crypto.randomUUID();
    const thinking = pickStatusPhrase(conversationId, "thinking", DEFAULT_PERSONA);
    const searching = pickStatusPhrase(conversationId, "searching", DEFAULT_PERSONA);
    expect(statusPhrasesVocab.thinking).toContain(thinking);
    expect(statusPhrasesVocab.searching).toContain(searching);
  });
});
