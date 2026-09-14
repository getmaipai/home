// Lane 14 item 2: EVAL-07's memory replay, the ingestion mapping,
// against small hand-built sessions - no engine, no file I/O.
import { describe, expect, test } from "bun:test";
import { sessionToIngestRows, isLongMemEvalHouseholdMember, locomoHouseholdMemberSpeaker } from "../scripts/bench/datasets/replayIngest";
import type { DatasetSession } from "../scripts/bench/datasets/types";

function session(turns: DatasetSession["turns"]): DatasetSession {
  return { sessionId: "s1", timestamp: "2023-04-10", turns };
}

describe("sessionToIngestRows", () => {
  test("a strictly alternating session pairs one household-member turn with the very next reply turn", () => {
    const rows = sessionToIngestRows(
      session([
        { turnId: "t0", speaker: "user", text: "My GPS keeps freezing.", act: null, emotion: null, isEvidence: false },
        { turnId: "t1", speaker: "assistant", text: "When did you first notice it?", act: null, emotion: null, isEvidence: false },
        { turnId: "t2", speaker: "user", text: "Yesterday afternoon.", act: null, emotion: null, isEvidence: true },
        { turnId: "t3", speaker: "assistant", text: "Got it, I'll look into that.", act: null, emotion: null, isEvidence: false },
      ]),
      isLongMemEvalHouseholdMember,
    );
    expect(rows).toEqual([
      { userText: "My GPS keeps freezing.", replyText: "When did you first notice it?", turnIds: ["t0", "t1"], isEvidence: false },
      { userText: "Yesterday afternoon.", replyText: "Got it, I'll look into that.", turnIds: ["t2", "t3"], isEvidence: true },
    ]);
  });

  test("two or more consecutive reply turns join into one row's own reply text", () => {
    const rows = sessionToIngestRows(
      session([
        { turnId: "t0", speaker: "user", text: "I also need an oil change.", act: null, emotion: null, isEvidence: false },
        { turnId: "t1", speaker: "assistant", text: "Sure, I can schedule that.", act: null, emotion: null, isEvidence: false },
        { turnId: "t2", speaker: "assistant", text: "Would Tuesday work?", act: null, emotion: null, isEvidence: false },
      ]),
      isLongMemEvalHouseholdMember,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.replyText).toBe("Sure, I can schedule that.\n\nWould Tuesday work?");
    expect(rows[0]!.turnIds).toEqual(["t0", "t1", "t2"]);
  });

  test("a household-member turn with nothing following it gets an empty reply, never invented", () => {
    const rows = sessionToIngestRows(session([{ turnId: "t0", speaker: "user", text: "One more thing.", act: null, emotion: null, isEvidence: false }]), isLongMemEvalHouseholdMember);
    expect(rows).toEqual([{ userText: "One more thing.", replyText: "", turnIds: ["t0"], isEvidence: false }]);
  });

  test("two household-member turns back to back each get their own row, the first with an empty reply", () => {
    const rows = sessionToIngestRows(
      session([
        { turnId: "t0", speaker: "user", text: "First thing.", act: null, emotion: null, isEvidence: false },
        { turnId: "t1", speaker: "user", text: "Second thing.", act: null, emotion: null, isEvidence: false },
        { turnId: "t2", speaker: "assistant", text: "Noted both.", act: null, emotion: null, isEvidence: false },
      ]),
      isLongMemEvalHouseholdMember,
    );
    expect(rows).toEqual([
      { userText: "First thing.", replyText: "", turnIds: ["t0"], isEvidence: false },
      { userText: "Second thing.", replyText: "Noted both.", turnIds: ["t1", "t2"], isEvidence: false },
    ]);
  });

  test("isEvidence is true when any folded-in reply turn carries it, even when the household-member turn itself does not", () => {
    const rows = sessionToIngestRows(
      session([
        { turnId: "t0", speaker: "user", text: "What about my hamster?", act: null, emotion: null, isEvidence: false },
        { turnId: "t1", speaker: "assistant", text: "You mentioned your cat Luna.", act: null, emotion: null, isEvidence: true },
      ]),
      isLongMemEvalHouseholdMember,
    );
    expect(rows[0]!.isEvidence).toBe(true);
  });

  test("an empty session produces no rows", () => {
    expect(sessionToIngestRows(session([]), isLongMemEvalHouseholdMember)).toEqual([]);
  });
});

describe("isLongMemEvalHouseholdMember", () => {
  test("role user is the household member, every other role is not", () => {
    expect(isLongMemEvalHouseholdMember({ turnId: "t", speaker: "user", text: "x", act: null, emotion: null, isEvidence: false })).toBe(true);
    expect(isLongMemEvalHouseholdMember({ turnId: "t", speaker: "assistant", text: "x", act: null, emotion: null, isEvidence: false })).toBe(false);
  });
});

describe("locomoHouseholdMemberSpeaker", () => {
  test("the first speaker to appear in the first session with any turns", () => {
    const sessions: DatasetSession[] = [
      { sessionId: "s0", timestamp: null, turns: [] },
      session([{ turnId: "t0", speaker: "Caroline", text: "hi", act: null, emotion: null, isEvidence: false }]),
    ];
    expect(locomoHouseholdMemberSpeaker(sessions)).toBe("Caroline");
  });

  test("null when every session is empty", () => {
    expect(locomoHouseholdMemberSpeaker([{ sessionId: "s0", timestamp: null, turns: [] }])).toBeNull();
  });
});
