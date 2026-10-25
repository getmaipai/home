import { afterEach, describe, expect, test } from "bun:test";
import { __clearInterruptedRepliesForTests, dropInterruptedReply, mayCarryInterruptedReply, noteInterruptedReply, takeInterruptedReply } from "@/lib/interruptedReply";

const RELEASED = "Once upon a time there were three little pigs. The first built a house of straw. The second built a house of sticks. The third built a house of bricks.";
const HEARD = "Once upon a time there were three little pigs. The first built a house of straw.";

afterEach(() => __clearInterruptedRepliesForTests());

describe("the unheard part of an interrupted reply", () => {
  test("is kept for the next turn of that conversation: that turn may read it again, a later turn gets nothing", () => {
    noteInterruptedReply("conv-1", "person-a", RELEASED, HEARD, 1000);
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 2000)).toBe("The second built a house of sticks. The third built a house of bricks.");
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 2000)).toBe("The second built a house of sticks. The third built a house of bricks.");
    expect(takeInterruptedReply("conv-1", "person-a", "turn-2", 3000)).toBeNull();
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 3000)).toBeNull();
  });

  test("never reaches another person or another conversation", () => {
    noteInterruptedReply("conv-1", "person-a", RELEASED, HEARD, 1000);
    expect(takeInterruptedReply("conv-2", "person-a", "turn-1", 2000)).toBeNull();
    expect(takeInterruptedReply("conv-1", "person-b", "turn-1", 2000)).toBeNull();
  });

  test("expires after ten minutes", () => {
    noteInterruptedReply("conv-1", "person-a", RELEASED, HEARD, 1000);
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 1000 + 10 * 60_000 + 1)).toBeNull();
  });

  test("a tiny remainder is not worth carrying and clears an older one", () => {
    noteInterruptedReply("conv-1", "person-a", RELEASED, HEARD, 1000);
    noteInterruptedReply("conv-1", "person-a", "Okay. That is all.", "Okay.", 1500);
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 2000)).toBeNull();
  });

  test("a very long remainder is capped", () => {
    noteInterruptedReply("conv-1", "person-a", `${HEARD} ${"word ".repeat(1000)}`, HEARD, 1000);
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 2000)!.length).toBeLessThanOrEqual(1200);
  });
});

describe("which turns may carry the unheard part", () => {
  const spoken = { spokenSurface: true, crisis: false, crisisSignal: false, repair: "none" };

  test("a plain spoken turn may", () => {
    expect(mayCarryInterruptedReply(spoken)).toBe(true);
  });

  test("a written turn never does (rule 5: no length instructions on written chat)", () => {
    expect(mayCarryInterruptedReply({ ...spoken, spokenSurface: false })).toBe(false);
  });

  test("a crisis turn, a turn carrying a crisis signal, or a repair turn never does (rule 0)", () => {
    expect(mayCarryInterruptedReply({ ...spoken, crisis: true })).toBe(false);
    expect(mayCarryInterruptedReply({ ...spoken, crisisSignal: true })).toBe(false);
    expect(mayCarryInterruptedReply({ ...spoken, repair: "correction" })).toBe(false);
  });

  test("a turn that may not carry it ends it", () => {
    noteInterruptedReply("conv-1", "person-a", RELEASED, HEARD, 1000);
    dropInterruptedReply("conv-1");
    expect(takeInterruptedReply("conv-1", "person-a", "turn-1", 2000)).toBeNull();
  });
});

