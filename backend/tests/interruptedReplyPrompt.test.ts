import { contextToMessages } from "@/lib/turnMachine/messages";
import { describe, expect, test } from "bun:test";

describe("DUPLEX-06: the unheard part of an interrupted reply reaches the model as labelled background", () => {
  test("it rides as data, and the guidance to pick the reply back up sits outside the data wrapper", () => {
        const messages = contextToMessages(
      [{ id: "interrupted-reply", text: "The second built a house of sticks.", source: "interrupted", subjects: [], disclosure: "child_ok" }],
      "can you see me?",
      { id: "t", name: "T" } as never,
      { moves: {}, playfulness: "allowed", max_sentences: 2, max_words: 30, age_band: "adult", vocabulary_level: "standard", explanation_style: "concrete", trusted_adult_move: "none", content_disclosure: "full", react_move: null } as never,
      { clauses: [] } as never,
      "spoken",
    );
    const last = messages[messages.length - 1]!.content;
    expect(last).toContain("<untrusted_data>");
    expect(last).toContain("the part of your last reply the person did not hear");
    expect(last).toContain("The second built a house of sticks.");
    expect(last.indexOf("About the part of your last reply the person did not hear")).toBeGreaterThan(last.indexOf("</untrusted_data>"));
    expect(last).toContain("First decide which ONE case their words are");
    expect(last).toContain("carry on with your reply from where they stopped hearing it");
    expect(last).toContain("do not go back to what you were saying");
    expect(last).toContain("do not repeat what they heard");
  });
});
