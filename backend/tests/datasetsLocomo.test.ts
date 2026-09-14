// Lane 12 item 4. A small embedded sample in LoCoMo's own real shape
// (found live against locomo10.json, 2026-09-14) - never the released
// file itself.
import { describe, expect, test } from "bun:test";
import { loadLocomo } from "../scripts/bench/datasets/locomo";

const SAMPLE = [
  {
    sample_id: "conv-26",
    conversation: {
      speaker_a: "Caroline",
      speaker_b: "Melanie",
      session_1_date_time: "1:56 pm on 8 May, 2023",
      session_1: [
        { speaker: "Caroline", dia_id: "D1:1", text: "Hey Mel! Good to see you! How have you been?" },
        { speaker: "Melanie", dia_id: "D1:2", text: "Hey Caroline! Swamped with the kids and work." },
        { speaker: "Caroline", dia_id: "D1:3", text: "I went to the LGBTQ support group on 7 May." },
      ],
      session_2_date_time: "2:10 pm on 9 May, 2023",
      session_2: [{ speaker: "Melanie", dia_id: "D2:1", text: "How was the support group?" }],
    },
    qa: [
      { question: "When did Caroline go to the LGBTQ support group?", answer: "7 May 2023", evidence: ["D1:3"], category: 2 as const },
      {
        question: "What did Caroline realize after her charity race?",
        evidence: ["D2:3"],
        adversarial_answer: "self-care is important",
        category: 5 as const,
      },
    ],
  },
];

describe("loadLocomo", () => {
  test("one conversation per sample_id, sessions in numeric order", () => {
    const { conversations } = loadLocomo(SAMPLE);
    expect(conversations).toHaveLength(1);
    const conv = conversations[0]!;
    expect(conv.id).toBe("conv-26");
    expect(conv.source).toBe("locomo");
    expect(conv.sessions.map((s) => s.sessionId)).toEqual(["session_1", "session_2"]);
  });

  test("each session keeps its own date_time and its turns' speaker, dia_id and text", () => {
    const { conversations } = loadLocomo(SAMPLE);
    const session1 = conversations[0]!.sessions[0]!;
    expect(session1.timestamp).toBe("1:56 pm on 8 May, 2023");
    expect(session1.turns[0]).toMatchObject({ turnId: "D1:1", speaker: "Caroline", text: "Hey Mel! Good to see you! How have you been?" });
  });

  test("every qa row becomes its own question, keyed back to the conversation", () => {
    const { questions } = loadLocomo(SAMPLE);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      conversationId: "conv-26",
      question: "When did Caroline go to the LGBTQ support group?",
      answer: "7 May 2023",
      adversarialAnswer: null,
      category: 2,
      evidenceTurnIds: ["D1:3"],
    });
  });

  // Category 5 (adversarial) carries no real answer - the correct
  // reply is that nothing supports the premise, not the adversarial
  // answer text repeated back (LoCoMo's own eval treats that as the
  // failure case).
  test("an adversarial question carries adversarialAnswer, never a real answer", () => {
    const { questions } = loadLocomo(SAMPLE);
    expect(questions[1]!.answer).toBeNull();
    expect(questions[1]!.adversarialAnswer).toBe("self-care is important");
    expect(questions[1]!.category).toBe(5);
  });

  test("a turn cited as evidence by any question in the file is marked isEvidence", () => {
    const { conversations } = loadLocomo(SAMPLE);
    const turnsByTurnId = new Map(conversations[0]!.sessions.flatMap((s) => s.turns).map((t) => [t.turnId, t]));
    expect(turnsByTurnId.get("D1:3")!.isEvidence).toBe(true);
    expect(turnsByTurnId.get("D1:1")!.isEvidence).toBe(false);
  });
});
