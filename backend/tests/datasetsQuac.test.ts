// Lane 13 item 1: a small embedded sample in QuAC's own real shape
// (found live against quac/train_v0.2.json, 2026-09-14).
import { describe, expect, test } from "bun:test";
import { loadQuac, CANNOTANSWER } from "../scripts/bench/datasets/quac";

const SAMPLE = {
  data: [
    {
      paragraphs: [
        {
          context: "Malayalam is a language spoken in Kerala.",
          qas: [
            { id: "C_69758fcdfc1f46baba0e92c0f3b0919c_1_q#0", question: "Where is Malayali located?", followup: "m", yesno: "x", answers: [{ text: "Kerala" }] },
            { id: "C_69758fcdfc1f46baba0e92c0f3b0919c_1_q#1", question: "What other languages are spoken there?", followup: "n", yesno: "x", answers: [{ text: CANNOTANSWER }] },
            { id: "C_69758fcdfc1f46baba0e92c0f3b0919c_1_q#2", question: "Is it a big language?", followup: "y", yesno: "y", answers: [{ text: "Yes, very widely spoken" }] },
          ],
        },
      ],
    },
  ],
};

describe("loadQuac", () => {
  test("one conversation per paragraph, id stripped of the trailing _q#n", () => {
    const { conversations } = loadQuac(SAMPLE);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.id).toBe("quac-C_69758fcdfc1f46baba0e92c0f3b0919c_1");
    expect(conversations[0]!.source).toBe("quac");
  });

  test("each qa becomes a student turn and a teacher turn, in order", () => {
    const { conversations } = loadQuac(SAMPLE);
    const turns = conversations[0]!.sessions[0]!.turns;
    expect(turns).toHaveLength(6);
    expect(turns[0]).toMatchObject({ speaker: "student", text: "Where is Malayali located?" });
    expect(turns[1]).toMatchObject({ speaker: "teacher", text: "Kerala" });
  });

  test("an unanswerable teacher turn carries the CANNOTANSWER text and isEvidence false; an answered one is true", () => {
    const { conversations } = loadQuac(SAMPLE);
    const turns = conversations[0]!.sessions[0]!.turns;
    expect(turns[1]!.isEvidence).toBe(true);
    expect(turns[3]!.text).toBe(CANNOTANSWER);
    expect(turns[3]!.isEvidence).toBe(false);
  });

  test("questions carry the dataset's own followup and yesno tags, and isUnanswerable read from the answer text", () => {
    const { questions } = loadQuac(SAMPLE);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toEqual({ conversationId: "quac-C_69758fcdfc1f46baba0e92c0f3b0919c_1", qaId: "C_69758fcdfc1f46baba0e92c0f3b0919c_1_q#0", followup: "m", yesno: "x", isUnanswerable: false });
    expect(questions[1]!.isUnanswerable).toBe(true);
    expect(questions[2]).toMatchObject({ followup: "y", yesno: "y", isUnanswerable: false });
  });

  test("a paragraph with no qas is skipped rather than producing an empty conversation", () => {
    const { conversations } = loadQuac({ data: [{ paragraphs: [{ context: "x", qas: [] }] }] });
    expect(conversations).toHaveLength(0);
  });
});
