import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";
import { ambientHistoryItems } from "@/shell/AmbientCompanionPane";
import { heardText, useSpokenReply } from "@/shell/spokenReply";

afterEach(cleanup);

class FakeScheduler {
  constructor(public messageId?: string) {}
  heard = 0;
  cut = false;
  ended = false;
  heardVisibleEndFine() { return this.heard; }
  wasCutOff() { return this.cut; }
  hasEndedNaturally() { return this.ended; }
}
const asScheduler = (fake: FakeScheduler) => fake as unknown as SentenceSpeechScheduler;
const reply = (id: string, text: string) => ({ id, role: "assistant", content: [{ type: "text", text }] });
const FULL = "How are you doing today? I hope it is going well.";

describe("heardText", () => {
  test("keeps whole words and adds an ellipsis when cut off", () => {
    expect(heardText(FULL, 11, true)).toBe("How are you…");
    expect(heardText(FULL, 9, true)).toBe("How are…");
    expect(heardText(FULL, 7, true)).toBe("How are…");
    expect(heardText(FULL, 8, true)).toBe("How are…");
  });
  test("shows no ellipsis while the voice is still going", () => {
    expect(heardText(FULL, 8, false)).toBe("How are");
  });
  test("nothing heard yet leaves only the ellipsis when cut off", () => {
    expect(heardText(FULL, 0, true)).toBe("…");
    expect(heardText(FULL, 2, false)).toBe("");
  });
  test("everything heard is the full text with no ellipsis", () => {
    expect(heardText(FULL, FULL.length, true)).toBe(FULL);
  });
});

describe("useSpokenReply", () => {
  test("shows only what has been said while the reply is being spoken, then the whole reply when it ends", () => {
    const scheduler = new FakeScheduler("a1");
    const messages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi" }] }, reply("a1", FULL)];
    const { result, rerender } = renderHook(() => useSpokenReply(messages, asScheduler(scheduler), true));
    expect(result.current.get("a1")).toBe("");
    scheduler.heard = 9;
    act(() => rerender());
    expect(result.current.get("a1")).toBe("How are");
    scheduler.ended = true;
    act(() => rerender());
    expect(result.current.has("a1")).toBe(false);
  });

  test("the voice belongs to its own message even while the previous reply is still the newest one in the thread", () => {
    const old = new FakeScheduler("a1");
    old.ended = true;
    let scheduler = old;
    let messages = [reply("a1", FULL)];
    const { result, rerender } = renderHook(() => useSpokenReply(messages, asScheduler(scheduler), true));
    expect(result.current.size).toBe(0);
    scheduler = new FakeScheduler("a2");
    act(() => rerender());
    expect(result.current.has("a1")).toBe(false);
    messages = [reply("a1", FULL), { id: "u2", role: "user", content: [{ type: "text", text: "and?" }] }, reply("a2", "Next one is long enough to cut.")];
    scheduler.heard = 9;
    act(() => rerender());
    expect(result.current.has("a1")).toBe(false);
    expect(result.current.get("a2")).toBe("Next one");
  });

  test("a reply that is not read aloud is never held back", () => {
    const scheduler = new FakeScheduler();
    const { result } = renderHook(() => useSpokenReply([reply("a1", FULL)], asScheduler(scheduler), false));
    expect(result.current.size).toBe(0);
  });

  test("a cut-in keeps the heard words with an ellipsis, even after the next turn starts", () => {
    const first = new FakeScheduler("a1");
    let scheduler = first;
    let messages = [reply("a1", FULL)];
    const { result, rerender } = renderHook(() => useSpokenReply(messages, asScheduler(scheduler), true));
    first.heard = 9;
    first.cut = true;
    act(() => rerender());
    expect(result.current.get("a1")).toBe("How are…");
    scheduler = new FakeScheduler("a2");
    messages = [reply("a1", FULL), { id: "u2", role: "user", content: [{ type: "text", text: "wait" }] }, reply("a2", "")];
    act(() => rerender());
    expect(result.current.get("a1")).toBe("How are…");
    expect(result.current.has("a2")).toBe(false);
  });
});

describe("ambientHistoryItems with spoken text", () => {
  test("a companion bubble shows the spoken text, and an unspoken start leaves no bubble", () => {
    const messages = [reply("a1", FULL), reply("a2", "Next reply")];
    const items = ambientHistoryItems(messages, new Map([["a1", "How are…"], ["a2", ""]]));
    expect(items.map((item) => item.id)).toEqual(["a1"]);
  });
});
