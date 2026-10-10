/** A refused or failed answer never stores a picture gallery, even one already placed while the answer streamed. */
import { describe, expect, test } from "bun:test";
import { settleAnswerImages } from "@/lib/answerImages/turn";
import type { TurnState } from "@/lib/turnMachine/contract";

function stateWithPlacedGallery(): TurnState {
  const block = { id: "blk-aaaaaaaaaaaa", after_paragraph: 1 };
  const event = { t: "block", call_id: "c1", block } as never;
  return {
    answerImages: { done: Promise.resolve(), block: { t: "block", call_id: "c1", block: { id: "blk-aaaaaaaaaaaa" } }, trace: undefined },
    outcomes: [],
    toolEvents: [event],
    placedBlocks: [{ event, offset: 5 }],
  } as unknown as TurnState;
}

describe("settleAnswerImages", () => {
  test("a placed gallery is removed from the stored events when the answer is not kept", async () => {
    const state = stateWithPlacedGallery();
    await settleAnswerImages(state, { keep: false });
    expect(state.toolEvents).toHaveLength(0);
    expect(state.placedBlocks).toHaveLength(0);
  });

  test("a placed gallery stays when the answer is kept", async () => {
    const state = stateWithPlacedGallery();
    await settleAnswerImages(state, { keep: true });
    expect(state.toolEvents).toHaveLength(1);
  });
});
