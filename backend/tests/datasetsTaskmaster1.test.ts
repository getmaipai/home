// Lane 13 item 1: a small embedded sample in the dataset's own real
// shape (found live against taskmaster1/self-dialogs.json and
// woz-dialogs.json, 2026-09-14), never the real files (self-dialogs.json
// alone is 65 MB).
import { describe, expect, test } from "bun:test";
import { loadTaskmaster1, taskmaster1SlotNames } from "../scripts/bench/datasets/taskmaster1";

const SAMPLE = [
  {
    conversation_id: "dlg-00055f4e-4a46-48bf-8d99-4e477663eb23",
    instruction_id: "restaurant-table-2",
    utterances: [
      { index: 0, speaker: "USER", text: "Hi, I'm looking to book a table for Korean food." },
      { index: 1, speaker: "ASSISTANT", text: "Ok, what area are you thinking about?" },
      {
        index: 2,
        speaker: "USER",
        text: "Somewhere in Southern NYC, maybe the East Village?",
        segments: [{ text: "Southern NYC, maybe the East Village", annotations: [{ name: "restaurant_reservation.location.restaurant.accept" }] }],
      },
    ],
  },
];

describe("loadTaskmaster1", () => {
  test("one conversation per conversation_id, stamped with the variant", () => {
    const { conversations } = loadTaskmaster1(SAMPLE, "self");
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.id).toBe("taskmaster1-self-dlg-00055f4e-4a46-48bf-8d99-4e477663eb23");
    expect(conversations[0]!.source).toBe("taskmaster1");
  });

  test("the same raw conversation gets a different id under the woz variant", () => {
    const { conversations } = loadTaskmaster1(SAMPLE, "woz");
    expect(conversations[0]!.id).toBe("taskmaster1-woz-dlg-00055f4e-4a46-48bf-8d99-4e477663eb23");
  });

  test("turns carry the raw speaker and text; act and emotion stay null", () => {
    const { conversations } = loadTaskmaster1(SAMPLE, "self");
    const turns = conversations[0]!.sessions[0]!.turns;
    expect(turns).toHaveLength(3);
    expect(turns[0]!.speaker).toBe("USER");
    expect(turns[0]!.text).toBe("Hi, I'm looking to book a table for Korean food.");
    expect(turns[0]!.act).toBeNull();
    expect(turns[0]!.emotion).toBeNull();
  });

  test("turnId is the conversation id and the utterance's own index", () => {
    const { conversations } = loadTaskmaster1(SAMPLE, "self");
    expect(conversations[0]!.sessions[0]!.turns[2]!.turnId).toBe("dlg-00055f4e-4a46-48bf-8d99-4e477663eb23:2");
  });

  test("slotNamesByTurn keys by turnId, only for a turn that carries a segment annotation", () => {
    const { slotNamesByTurn } = loadTaskmaster1(SAMPLE, "self");
    expect(slotNamesByTurn.get("dlg-00055f4e-4a46-48bf-8d99-4e477663eb23:2")).toEqual(["restaurant_reservation.location.restaurant.accept"]);
    expect(slotNamesByTurn.has("dlg-00055f4e-4a46-48bf-8d99-4e477663eb23:0")).toBe(false);
  });

  test("taskmaster1SlotNames reads an utterance's own annotation names, empty when it has none", () => {
    expect(taskmaster1SlotNames(SAMPLE[0]!, 2)).toEqual(["restaurant_reservation.location.restaurant.accept"]);
    expect(taskmaster1SlotNames(SAMPLE[0]!, 0)).toEqual([]);
  });
});
