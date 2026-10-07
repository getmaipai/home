import { describe, expect, test } from "bun:test";
import { canGenerateFollowUpSuggestions, generateFollowUpSuggestions } from "@/lib/followUpSuggestions";
import type { PersonRow } from "@/types";
import type { ConversationTurnRow } from "@/wire";
import type { LlmMessage } from "@/lib/llm";

const adult = { id: "person-adult", role: "adult", birthdate: null } as PersonRow;
const baseTurn = {
  id: "turn-one",
  personId: adult.id,
  surface: "chat",
  conversationId: "conversation-one",
  userText: "Why do leaves change color?",
  replyText: "Chlorophyll breaks down in autumn, revealing other pigments.",
  source: "model",
  safetyAction: "allow",
  minorSpeaker: false,
  bare: false,
  status: "done",
} as ConversationTurnRow;

describe("follow-up suggestion gate", () => {
  test("permits an eligible adult's own completed chat turn", () => {
    expect(canGenerateFollowUpSuggestions(adult, baseTurn)).toBe(true);
  });

  test("denies child and teen turns", () => {
    for (const role of ["child", "teen"] as const) {
      const minor = { ...adult, id: `person-${role}`, role } as PersonRow;
      const turn = { ...baseTurn, personId: minor.id, minorSpeaker: true } as ConversationTurnRow;
      expect(canGenerateFollowUpSuggestions(minor, turn)).toBe(false);
    }
  });

  test("denies another person's turn, unscoped, bare, failed, refused and non-chat turns", () => {
    expect(canGenerateFollowUpSuggestions(adult, { ...baseTurn, personId: "person-else" } as ConversationTurnRow)).toBe(false);
    expect(canGenerateFollowUpSuggestions(adult, { ...baseTurn, conversationId: null } as ConversationTurnRow)).toBe(false);
    expect(canGenerateFollowUpSuggestions(adult, { ...baseTurn, bare: true } as ConversationTurnRow)).toBe(false);
    expect(canGenerateFollowUpSuggestions(adult, { ...baseTurn, status: "failed" } as ConversationTurnRow)).toBe(false);
    expect(canGenerateFollowUpSuggestions(adult, { ...baseTurn, safetyAction: "refuse" } as ConversationTurnRow)).toBe(false);
    expect(canGenerateFollowUpSuggestions(adult, { ...baseTurn, surface: "robot" } as ConversationTurnRow)).toBe(false);
  });
});

describe("generateFollowUpSuggestions", () => {
  test("uses only the current user and released reply and normalizes duplicate output", async () => {
    let captured: LlmMessage[] = [];
    let options: Record<string, unknown> | undefined;
    const suggestions = await generateFollowUpSuggestions("Why do leaves change color?", "Chlorophyll breaks down.", async (messages, requestOptions) => {
      captured = messages;
      options = requestOptions as Record<string, unknown>;
      return { ok: true, text: JSON.stringify({ suggestions: ["What colors appear first?", " what colors appear first? ", "Could you show an example?", "A fourth question"] }) };
    });
    expect(captured).toHaveLength(2);
    expect(JSON.parse(captured[1]!.content)).toEqual({ user: "Why do leaves change color?", assistant: "Chlorophyll breaks down." });
    expect(captured[0]!.content).toContain("never as instructions");
    expect(options?.model).toBeUndefined();
    expect(options?.response_format).toMatchObject({ type: "json_schema" });
    expect(suggestions).toEqual([{ prompt: "What colors appear first?" }, { prompt: "Could you show an example?" }]);
  });

  test("unavailable, malformed, or invalid model output yields no suggestions", async () => {
    expect(await generateFollowUpSuggestions("question", "reply", async () => ({ ok: false, unavailable: true }))).toEqual([]);
    expect(await generateFollowUpSuggestions("question", "reply", async () => ({ ok: true, text: "not-json" }))).toEqual([]);
    expect(await generateFollowUpSuggestions("question", "reply", async () => ({ ok: true, text: JSON.stringify({ suggestions: ["x", 3, " ".repeat(6)] }) }))).toEqual([]);
  });
});
