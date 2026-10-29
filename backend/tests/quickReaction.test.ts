import { describe, expect, test } from "bun:test";
import { cleanReaction } from "@/lib/quickReaction";

describe("cleanReaction", () => {
  test("keeps a short natural reaction and trims quotes", () => {
    expect(cleanReaction('"Oh no, that sounds rough."', "my feet hurt", [], [])).toBeNull(); // five words
    expect(cleanReaction('"Oh no."', "my dog died", [], [])).toBe("Oh no.");
    expect(cleanReaction("Ugh, no way.", "I lost my keys", [], [])).toBe("Ugh, no way.");
  });
  test("NONE, empty and non-letter output become nothing", () => {
    expect(cleanReaction("NONE", "set a timer", [], [])).toBeNull();
    expect(cleanReaction("none.", "set a timer", [], [])).toBeNull();
    expect(cleanReaction("   ", "hi", [], [])).toBeNull();
    expect(cleanReaction("72 degrees", "weather", [], [])).toBeNull();
    expect(cleanReaction("<think>", "hi", [], [])).toBeNull();
  });
  test("an echo of the person's words is not a reaction", () => {
    expect(cleanReaction("That was actually funny.", "haha that was actually pretty funny", [], [])).toBeNull();
  });
  test("a banned phrase or a recent repeat is dropped", () => {
    expect(cleanReaction("Oh right.", "x", ["oh right"], [])).toBeNull();
    expect(cleanReaction("Oh right.", "x", [], ["oh right."])).toBeNull();
    expect(cleanReaction("Hmm, okay.", "x", ["oh right"], ["Oh right."])).toBe("Hmm, okay.");
  });
});
