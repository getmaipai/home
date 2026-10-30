import { afterEach, describe, expect, test } from "bun:test";
import { __setDeliveryRunnerForTests, chooseDelivery, parseDelivery } from "@/lib/deliveryChoice";
import { freshCueState, planVoiceCues } from "@/lib/voiceCues";
import { cleanReaction } from "@/lib/quickReaction";

afterEach(() => __setDeliveryRunnerForTests(null));
const TAGS = ["laugh", "chuckle", "cough", "sigh", "clear throat", "gasp"];

describe("parseDelivery", () => {
  test("reads a sound and where it goes", () => {
    expect(parseDelivery("sigh after", TAGS)).toEqual({ tag: "sigh", place: "after" });
    expect(parseDelivery("Gasp before.", TAGS)).toEqual({ tag: "gasp", place: "before" });
    expect(parseDelivery("clear throat before", TAGS)).toEqual({ tag: "clear throat", place: "before" });
  });
  test("none, empty or a tag the engine does not have is plain", () => {
    expect(parseDelivery("none", TAGS).tag).toBeNull();
    expect(parseDelivery("", TAGS).tag).toBeNull();
    expect(parseDelivery("groan after", TAGS).tag).toBeNull();
    expect(parseDelivery("laugh after", ["sigh"]).tag).toBeNull();
  });
});

describe("chooseDelivery", () => {
  test("no tags on the engine means no question to the model", async () => {
    let asked = 0;
    __setDeliveryRunnerForTests((async () => { asked++; return { ok: true, text: "sigh after" }; }) as never);
    expect(await chooseDelivery("I understand.", "long day", [])).toBeUndefined();
    expect(asked).toBe(0);
  });
  test("a model that is unavailable gives no opinion so the old rules decide", async () => {
    __setDeliveryRunnerForTests((async () => ({ ok: false, unavailable: true })) as never);
    expect(await chooseDelivery("That's funny.", undefined, TAGS)).toBeUndefined();
  });
  test("the model's answer is returned", async () => {
    __setDeliveryRunnerForTests((async () => ({ ok: true, text: "sigh after" })) as never);
    expect(await chooseDelivery("Sounds like a rough day.", "long day at work", TAGS)).toEqual({ tag: "sigh", place: "after" });
  });
});

describe("planVoiceCues with a model choice", () => {
  const base = { turnId: "t1", level: "light" as const, band: "adult" as const, supportedTags: TAGS };
  test("places the chosen sound where the model said, with no keyword in the sentence", () => {
    const after = planVoiceCues({ ...base, text: "That sounds like a rough week.", choice: { tag: "sigh", place: "after" }, state: freshCueState() });
    expect(after.text).toBe("That sounds like a rough week. [sigh]");
    const before = planVoiceCues({ ...base, text: "Your package came early.", choice: { tag: "gasp", place: "before" }, state: freshCueState() });
    expect(before.text).toBe("[gasp] Your package came early.");
  });
  test("a plain choice, a number, or a child gets nothing", () => {
    expect(planVoiceCues({ ...base, text: "Sure thing.", choice: null, state: freshCueState() }).text).toBe("Sure thing.");
    expect(planVoiceCues({ ...base, text: "It is 72 degrees.", choice: { tag: "sigh", place: "after" }, state: freshCueState() }).text).toBe("It is 72 degrees.");
    expect(planVoiceCues({ ...base, band: "child", text: "That is funny.", choice: { tag: "laugh", place: "after" }, state: freshCueState() }).text).toBe("That is funny.");
  });
  test("two per turn at most", () => {
    let state = freshCueState();
    const texts: string[] = [];
    for (const sentence of ["One sad thing.", "Another sad thing.", "A third sad thing.", "A fourth sad thing."]) {
      const result = planVoiceCues({ ...base, text: sentence, choice: { tag: "sigh", place: "after" }, state });
      state = result.state; texts.push(result.text);
    }
    expect(texts.filter((t) => t.includes("[sigh]")).length).toBe(2);
  });
});

describe("quick reaction sound tags", () => {
  test("a leading tag from the engine's list is kept; any other bracket is dropped", () => {
    expect(cleanReaction("[sigh] Oh no.", "my dog died", [], [], ["sigh"])).toBe("[sigh] Oh no.");
    expect(cleanReaction("[groan] Oh no.", "my dog died", [], [], ["sigh"])).toBe("Oh no.");
    expect(cleanReaction("[sigh] Oh no.", "my dog died", [], [], [])).toBe("Oh no.");
  });
});
