// Lane 12 item 4: EVAL-07's dataset half. Never reads the real
// downloaded file (277 MB, and this suite has to pass on a machine
// that never ran the download at all) - a small embedded sample in the
// dataset's own real shape (found live against longmemeval_oracle.json,
// 2026-09-14), the same "a unit test per loader on a small embedded
// sample, never on the whole file" rule the item's own text states.
import { describe, expect, test } from "bun:test";
import { loadLongMemEval } from "../scripts/bench/datasets/longmemeval";

const SAMPLE = [
  {
    question_id: "gpt4_2655b836",
    question_type: "temporal-reasoning",
    question: "What was the first issue I had with my new car after its first service?",
    answer: "GPS system not functioning correctly",
    question_date: "2023/04/10 (Mon) 23:07",
    haystack_dates: ["2023/04/10 (Mon) 17:50", "2023/04/10 (Mon) 14:47"],
    haystack_session_ids: ["answer_4be1b6b4_2", "answer_4be1b6b4_3"],
    haystack_sessions: [
      [
        { role: "user", content: "My GPS keeps freezing after the service.", has_answer: true },
        { role: "assistant", content: "That sounds frustrating - when did you first notice it?" },
      ],
      [{ role: "user", content: "I also need an oil change soon.", has_answer: false }],
    ],
    answer_session_ids: ["answer_4be1b6b4_2"],
  },
  {
    question_id: "0862e8bf_abs",
    question_type: "single-session-user",
    question: "What's the name of my hamster?",
    answer: "You did not mention this information. You mentioned your cat Luna but not your hamster.",
    question_date: "2023/05/01 (Mon) 09:00",
    haystack_dates: ["2023/04/20 (Thu) 10:00"],
    haystack_session_ids: ["session_c6fd8ebd_abs"],
    haystack_sessions: [[{ role: "user", content: "My cat Luna is doing great.", has_answer: false }]],
    answer_session_ids: [],
  },
];

describe("loadLongMemEval", () => {
  test("one conversation per question, keyed by the question's own id", () => {
    const { conversations } = loadLongMemEval(SAMPLE);
    expect(conversations).toHaveLength(2);
    expect(conversations[0]!.id).toBe("gpt4_2655b836");
    expect(conversations[0]!.source).toBe("longmemeval");
    expect(conversations[0]!.modality).toBe("text");
  });

  test("sessions carry the haystack's own dates and ids, turns their own role and text", () => {
    const { conversations } = loadLongMemEval(SAMPLE);
    const sessions = conversations[0]!.sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.sessionId).toBe("answer_4be1b6b4_2");
    expect(sessions[0]!.timestamp).toBe("2023/04/10 (Mon) 17:50");
    expect(sessions[0]!.turns[0]!.speaker).toBe("user");
    expect(sessions[0]!.turns[0]!.text).toBe("My GPS keeps freezing after the service.");
  });

  test("has_answer carries through as isEvidence, never inferred", () => {
    const { conversations } = loadLongMemEval(SAMPLE);
    const turns = conversations[0]!.sessions[0]!.turns;
    expect(turns[0]!.isEvidence).toBe(true);
    expect(turns[1]!.isEvidence).toBe(false);
    expect(conversations[0]!.sessions[1]!.turns[0]!.isEvidence).toBe(false);
  });

  test("turnId is synthesized from the session and the turn's own position", () => {
    const { conversations } = loadLongMemEval(SAMPLE);
    expect(conversations[0]!.sessions[0]!.turns[0]!.turnId).toBe("answer_4be1b6b4_2:0");
    expect(conversations[0]!.sessions[0]!.turns[1]!.turnId).toBe("answer_4be1b6b4_2:1");
  });

  test("act and emotion stay null - LongMemEval carries neither label", () => {
    const { conversations } = loadLongMemEval(SAMPLE);
    for (const turn of conversations[0]!.sessions[0]!.turns) {
      expect(turn.act).toBeNull();
      expect(turn.emotion).toBeNull();
    }
  });

  test("the question record keeps the type, the answer, and the answer session ids", () => {
    const { questions } = loadLongMemEval(SAMPLE);
    expect(questions[0]).toEqual({
      questionId: "gpt4_2655b836",
      questionType: "temporal-reasoning",
      isAbstention: false,
      question: "What was the first issue I had with my new car after its first service?",
      answer: "GPS system not functioning correctly",
      questionDate: "2023/04/10 (Mon) 23:07",
      conversationId: "gpt4_2655b836",
      answerSessionIds: ["answer_4be1b6b4_2"],
    });
  });

  // The dataset's own convention (found live, 2026-09-14): an
  // abstention question's id carries an "_abs" suffix. Never guessed
  // from the answer text - a real abstention answer could theoretically
  // read like any other sentence.
  test("abstention is read from the question id's own _abs suffix", () => {
    const { questions } = loadLongMemEval(SAMPLE);
    expect(questions[0]!.isAbstention).toBe(false);
    expect(questions[1]!.isAbstention).toBe(true);
  });

  test("a question with no answer_session_ids gets an empty array, not undefined", () => {
    const { questions } = loadLongMemEval(SAMPLE);
    expect(questions[1]!.answerSessionIds).toEqual([]);
  });
});
