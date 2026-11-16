import { describe, expect, test } from "bun:test";
import { tagsForDelivery } from "@/lib/speechJobs";

describe("speech delivery tags", () => {
  test("maps only delivery cues supported by the selected recorded engine", () => {
    expect(tagsForDelivery("Whisper softly with a short pause", ["whispers", "softly", "pause", "laughs"])).toEqual(["whispers", "softly", "pause"]);
  });

  test("leaves unsupported delivery ideas out of the script tags", () => {
    expect(tagsForDelivery("Speak warmly and dramatically", ["sighs", "laughs"])).toEqual([]);
  });
});
