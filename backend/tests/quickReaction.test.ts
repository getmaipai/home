import { describe, expect, test } from "bun:test";
import { cleanReaction, parseQuickCue } from "@/lib/quickReaction";

describe("cleanReaction", () => {
  test("keeps a short natural reaction and trims quotes", () => {
    expect(cleanReaction('"Oh no, that sounds really rough today."', "my feet hurt", [], [])).toBeNull(); // seven words
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
  test("a named sound becomes the tag when the engine has it, and nothing when it does not", () => {
    expect(cleanReaction("sigh", "my mom is in the hospital", [], [], ["sigh"])).toBe("[sigh]");
    expect(cleanReaction("Sigh.", "my mom is in the hospital", [], [], [])).toBeNull();
  });

  test("parseQuickCue: a reaction is immediate, a thinking sound is not, anything else is nothing", () => {
    expect(parseQuickCue("REACT: I'm so sorry.", "my dog died", [], [], [])).toEqual({ text: "I'm so sorry.", immediate: true });
    expect(parseQuickCue("ACK: Hmm, well.", "why is the sky blue", [], [], [])).toEqual({ text: "Hmm, well.", immediate: false });
    expect(parseQuickCue("ACK: Maybe tomorrow.", "when is snow", [], [], [])).toBeNull();
    expect(parseQuickCue("ACK: Eight seventeen.", "alarm", [], [], [])).toBeNull();
    expect(parseQuickCue("NONE", "hello", [], [], [])).toBeNull();
    expect(parseQuickCue("Sure, here you go.", "x", [], [], [])).toBeNull();
    expect(parseQuickCue("ACK: Hmm.", "x", [], ["hmm."], [])).toBeNull();
  });
});
