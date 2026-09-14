// Lane 13 item 1: the selection rules exercised against small,
// hand-built inputs in each loader's own output shape (never the
// downloaded files - the same "a unit test per loader on a small
// embedded sample" rule the loader tests use, extended to mine.ts's
// own selectors), plus the phenomena.json/PHENOMENON_SELECTORS
// consistency check that keeps the sheet reproducible from the
// committed file alone.
import { describe, expect, test } from "bun:test";
import { PHENOMENON_SELECTORS, loadPhenomena, selectFragments, renderReviewSheet, isBackchannel, CORRECTION_RE, type MiningInputs, type Fragment } from "../scripts/bench/datasets/mine";
import type { DatasetConversation } from "../scripts/bench/datasets/types";

function conv(id: string, source: DatasetConversation["source"], turns: DatasetConversation["sessions"][number]["turns"]): DatasetConversation {
  return { id, source, modality: "text", sessions: [{ sessionId: `${id}-s`, timestamp: null, turns }] };
}

const dailydialog: DatasetConversation[] = [
  conv("dd1", "dailydialog", [
    { turnId: "dd1:0", speaker: "A", text: "I finished the project today.", act: 1, emotion: 0, isEvidence: false },
    { turnId: "dd1:1", speaker: "B", text: "When did you start it?", act: 2, emotion: 0, isEvidence: false },
    { turnId: "dd1:2", speaker: "A", text: "I am so happy about it!", act: 1, emotion: 4, isEvidence: false },
    { turnId: "dd1:3", speaker: "B", text: "Please send me the report.", act: 3, emotion: 0, isEvidence: false },
    { turnId: "dd1:4", speaker: "A", text: "I will send it tomorrow.", act: 4, emotion: 0, isEvidence: false },
    { turnId: "dd1:5", speaker: "B", text: "Okay", act: 1, emotion: 0, isEvidence: false },
    { turnId: "dd1:6", speaker: "A", text: "Goodbye, take care!", act: 1, emotion: 0, isEvidence: false },
  ]),
];

const taskmasterSelfConversations: DatasetConversation[] = [
  conv("t1", "taskmaster1", [
    { turnId: "t1:0", speaker: "USER", text: "I want a table for 4.", act: null, emotion: null, isEvidence: false },
    { turnId: "t1:1", speaker: "ASSISTANT", text: "Sure, just to confirm, a table for 4?", act: null, emotion: null, isEvidence: false },
    { turnId: "t1:2", speaker: "USER", text: "Actually, no I meant a table for 6.", act: null, emotion: null, isEvidence: false },
    { turnId: "t1:3", speaker: "ASSISTANT", text: "Got it.", act: null, emotion: null, isEvidence: false },
  ]),
];
const taskmasterSelf = { conversations: taskmasterSelfConversations, slotNamesByTurn: new Map([["t1:0", ["reservation.party_size"]], ["t1:3", ["reservation.party_size"]]]) };

const taskmasterWoz = {
  conversations: [conv("w1", "taskmaster1", [
    { turnId: "w1:0", speaker: "ASSISTANT", text: "How can I help?", act: null, emotion: null, isEvidence: false },
    { turnId: "w1:1", speaker: "USER", text: "Could you help me find a movie tonight?", act: null, emotion: null, isEvidence: false },
  ])],
  slotNamesByTurn: new Map<string, string[]>(),
};

const ccpeMConversations: DatasetConversation[] = [
  conv("c1", "ccpe-m", [
    { turnId: "c1:0", speaker: "ASSISTANT", text: "what do you like", act: null, emotion: null, isEvidence: false },
    { turnId: "c1:1", speaker: "USER", text: "I like thrillers.", act: null, emotion: null, isEvidence: false },
    { turnId: "c1:2", speaker: "ASSISTANT", text: "anything else", act: null, emotion: null, isEvidence: false },
    { turnId: "c1:3", speaker: "USER", text: "Actually I don't like thrillers anymore, I prefer comedies now.", act: null, emotion: null, isEvidence: false },
    { turnId: "c1:4", speaker: "USER", text: "Movies with a strong female lead.", act: null, emotion: null, isEvidence: false },
  ]),
];
const ccpeM = { conversations: ccpeMConversations, annotations: [{ turnId: "c1:1", annotationType: "ENTITY_PREFERENCE" }, { turnId: "c1:3", annotationType: "ENTITY_PREFERENCE" }, { turnId: "c1:4", annotationType: "ENTITY_DESCRIPTION" }] };

const quacConversations: DatasetConversation[] = [
  conv("q1", "quac", [
    { turnId: "qa1-q", speaker: "student", text: "Where is it?", act: null, emotion: null, isEvidence: false },
    { turnId: "qa1-a", speaker: "teacher", text: "Kerala", act: null, emotion: null, isEvidence: true },
    { turnId: "qa2-q", speaker: "student", text: "What about the rest?", act: null, emotion: null, isEvidence: false },
    { turnId: "qa2-a", speaker: "teacher", text: "CANNOTANSWER", act: null, emotion: null, isEvidence: false },
  ]),
];
const quac = {
  conversations: quacConversations,
  questions: [
    { conversationId: "q1", qaId: "qa1", followup: "y" as const, yesno: "y" as const, isUnanswerable: false },
    { conversationId: "q1", qaId: "qa2", followup: "n" as const, yesno: "x" as const, isUnanswerable: true },
  ],
};

const locomoConversations: DatasetConversation[] = [conv("l1", "locomo", [{ turnId: "D1:1", speaker: "A", text: "I went to Paris last summer.", act: null, emotion: null, isEvidence: true }])];
const locomo = {
  conversations: locomoConversations,
  questions: [
    { conversationId: "l1", question: "When did I go to Paris?", answer: "Last summer", adversarialAnswer: null, category: 3 as const, evidenceTurnIds: ["D1:1"] },
    { conversationId: "l1", question: "What else did I do that week?", answer: "unknown", adversarialAnswer: null, category: 2 as const, evidenceTurnIds: [] },
    { conversationId: "l1", question: "What is the population of Paris?", answer: "about 2 million", adversarialAnswer: null, category: 4 as const, evidenceTurnIds: [] },
    { conversationId: "l1", question: "Didn't I mention going to Rome?", answer: null, adversarialAnswer: "Yes, you mentioned Rome", category: 5 as const, evidenceTurnIds: [] },
  ],
};

const longmemevalConversations: DatasetConversation[] = [conv("lm1", "longmemeval", [{ turnId: "s1:0", speaker: "user", text: "My favorite color used to be blue but now it's green.", act: null, emotion: null, isEvidence: true }])];
const longmemeval = {
  conversations: longmemevalConversations,
  questions: [
    { questionId: "lm1", questionType: "knowledge-update", isAbstention: false, question: "What is my favorite color?", answer: "green", questionDate: null, conversationId: "lm1", answerSessionIds: ["s1"] },
    { questionId: "lm2_abs", questionType: "single-session-user", isAbstention: true, question: "What is my dog's name?", answer: "not mentioned", questionDate: null, conversationId: "lm1", answerSessionIds: [] },
    { questionId: "lm3", questionType: "single-session-preference", isAbstention: false, question: "What food do I like?", answer: "pizza", questionDate: null, conversationId: "lm1", answerSessionIds: ["s1"] },
    { questionId: "lm4", questionType: "temporal-reasoning", isAbstention: false, question: "How long ago did my color change?", answer: "recently", questionDate: null, conversationId: "lm1", answerSessionIds: ["s1"] },
  ],
};

const inputs: MiningInputs = { dailydialog, taskmasterSelf, taskmasterWoz, ccpeM, quac, locomo, longmemeval };

describe("lexical heuristics do not over-match ordinary turns (a code review found both live, 2026-09-14)", () => {
  test("isBackchannel checks the whole cleaned turn, not just its first word", () => {
    expect(isBackchannel("Right but that seems odd")).toBe(false);
    expect(isBackchannel("Sure thing lets go now")).toBe(false);
    expect(isBackchannel("Right")).toBe(true);
    expect(isBackchannel("Sure")).toBe(true);
    expect(isBackchannel("Okay.")).toBe(true);
    expect(isBackchannel("Got it")).toBe(true);
  });

  test("CORRECTION_RE requires an explicit retraction word, not a bare \"actually\" or \"i mean\" opener", () => {
    expect(CORRECTION_RE.test("I mean, could you check availability for Friday?")).toBe(false);
    expect(CORRECTION_RE.test("Actually I would like a window seat too.")).toBe(false);
    expect(CORRECTION_RE.test("No, I meant a table for six.")).toBe(true);
    expect(CORRECTION_RE.test("Sorry, I meant Thursday, not Friday.")).toBe(true);
    expect(CORRECTION_RE.test("That's not what I said.")).toBe(true);
  });
});

describe("phenomena.json / PHENOMENON_SELECTORS consistency", () => {
  test("every phenomenon named in phenomena.json has a selector, and every selector has a phenomena.json entry", () => {
    const ids = loadPhenomena().map((p) => p.id);
    expect(new Set(ids)).toEqual(new Set(Object.keys(PHENOMENON_SELECTORS)));
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.length).toBeLessThanOrEqual(25);
  });

  test("targetCount sums to about 200 (the item's own acceptance figure)", () => {
    const total = loadPhenomena().reduce((n, p) => n + p.targetCount, 0);
    expect(total).toBeGreaterThan(150);
    expect(total).toBeLessThan(260);
  });
});

describe("each phenomenon's selector finds its own planted example", () => {
  const cases: [string, (f: Fragment) => void][] = [
    ["question-after-inform", (f) => expect(f.turns.map((t) => t.text)).toEqual(["I finished the project today.", "When did you start it?"])],
    ["emotional-disclosure-and-reply", (f) => expect(f.labels.emotion).toBe(4)],
    ["directive", (f) => expect(f.turns.some((t) => t.text === "Please send me the report.")).toBe(true)],
    ["commissive-promise", (f) => expect(f.turns.some((t) => t.text === "I will send it tomorrow.")).toBe(true)],
    ["closing", (f) => expect(f.turns.at(-1)!.text).toBe("Goodbye, take care!")],
    ["backchannel", (f) => expect(f.turns.some((t) => t.text === "Okay")).toBe(true)],
    ["correction", (f) => expect(f.turns.some((t) => t.text.includes("no I meant"))).toBe(true)],
    ["confirmation", (f) => expect(f.turns.length).toBeGreaterThanOrEqual(2)],
    ["woz-indirect-request", (f) => expect(f.turns.some((t) => t.text.includes("Could you help"))).toBe(true)],
    ["preference-statement", (f) => expect(f.turns.some((t) => t.text === "I like thrillers.")).toBe(true)],
    ["preference-change", (f) => expect(f.turns.some((t) => t.text.includes("Actually I don't like"))).toBe(true)],
    ["entity-description", (f) => expect(f.turns.some((t) => t.text.includes("strong female lead"))).toBe(true)],
    ["elliptical-followup", (f) => expect(f.labels.followup).toBe("y")],
    ["unanswerable-question", (f) => expect(f.turns.some((t) => t.text === "CANNOTANSWER")).toBe(true)],
    ["yesno-question", (f) => expect(f.labels.yesno).toBe("y")],
    ["temporal-question", (f) => expect(f.labels.category).toBe(3)],
    ["multi-session-question", (f) => expect(f.labels.category).toBe(2)],
    ["open-domain-question", (f) => expect(f.labels.category).toBe(4)],
    ["adversarial-premise-question", (f) => {
      // A review found the gold_answer wrongly repeating the false-
      // premise adversarialAnswer text back as if it were correct
      // (LoCoMo's own eval treats that as the failure case): the sheet
      // must never present it as the right reply, only carry it as a
      // label so a reviewer can see what trap answer to write a
      // refusal scenario against.
      expect(f.turns.some((t) => t.speaker === "gold_answer" && t.text.includes("Yes, you mentioned Rome"))).toBe(false);
      expect(f.turns.some((t) => t.speaker === "gold_answer" && t.text.includes("refuses the premise"))).toBe(true);
      expect(f.labels.adversarialAnswer).toBe("Yes, you mentioned Rome");
    }],
    ["knowledge-update", (f) => expect(f.turns.some((t) => t.speaker === "question")).toBe(true)],
    ["abstention", (f) => expect(f.conversationId).toBe("lm1")],
    ["single-session-preference", (f) => expect(f.labels.questionType).toBe("single-session-preference")],
    ["temporal-reasoning", (f) => expect(f.labels.questionType).toBe("temporal-reasoning")],
  ];

  for (const [id, assertOn] of cases) {
    test(id, () => {
      const selector = PHENOMENON_SELECTORS[id];
      expect(selector).toBeDefined();
      const found = selector!(inputs);
      expect(found.length).toBeGreaterThan(0);
      assertOn(found[0]!);
      // Every fragment carries between one and four turns (item 1's own
      // "two to four turns around the phenomenon", relaxed to allow the
      // qa-style single-evidence fragments a sparse dataset can produce).
      for (const f of found) expect(f.turns.length).toBeGreaterThanOrEqual(1);
    });
  }

  test("a conversation's first ENTITY_PREFERENCE turn is never counted as a preference-change, even if its own text happens to carry a contrast word", () => {
    const firstIsContrastive = {
      conversations: [conv("c2", "ccpe-m", [{ turnId: "c2:0", speaker: "USER", text: "Actually, I love thrillers.", act: null, emotion: null, isEvidence: false }])],
      annotations: [{ turnId: "c2:0", annotationType: "ENTITY_PREFERENCE" }],
    };
    const found = PHENOMENON_SELECTORS["preference-change"]!({ ...inputs, ccpeM: firstIsContrastive });
    expect(found.some((f) => f.conversationId === "c2")).toBe(false);
  });
});

describe("selectFragments", () => {
  test("deterministic: the same seed produces the same selection, in the same order, on every call", () => {
    const phenomena = loadPhenomena();
    const first = selectFragments(inputs, phenomena, 42);
    const second = selectFragments(inputs, phenomena, 42);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  test("never exceeds a phenomenon's own targetCount", () => {
    const phenomena = loadPhenomena().map((p) => ({ ...p, targetCount: 1 }));
    const selected = selectFragments(inputs, phenomena, 42);
    for (const fragments of selected.values()) expect(fragments.length).toBeLessThanOrEqual(1);
  });

  test("throws if phenomena.json names a phenomenon with no registered selector", () => {
    const phenomena = [...loadPhenomena(), { id: "not-a-real-phenomenon", sources: [], description: "", labelRule: "", targetCount: 1 }];
    expect(() => selectFragments(inputs, phenomena, 42)).toThrow(/no selector/);
  });
});

describe("renderReviewSheet", () => {
  test("one section per phenomenon with its own label rule, a checkbox line and a rewrite-as line per fragment", () => {
    const phenomena = loadPhenomena();
    const selected = selectFragments(inputs, phenomena, 42);
    const sheet = renderReviewSheet(selected, phenomena);
    expect(sheet).toContain("## question-after-inform");
    expect(sheet).toContain("Label rule: DailyDialog's own act labels");
    expect(sheet).toContain("keep");
    expect(sheet).toContain("skip");
    expect(sheet).toContain("Rewrite as:");
    // git-ignored reminder, so a person who opens the file knows never
    // to commit it even if they find it outside data-scratch/.
    expect(sheet).toContain("git-ignored");
  });
});
