// NEXT-CACHE-01 (dev.md "U6 rerun ruling" (b) 2): contextToMessages()'s
// own cache-stable order, unit-tested directly against a synthetic
// ContextItem[] rather than a full turn - faster and more precise than
// driving the whole machine for exactly what this function decides:
// which items land in the stable message ahead of the window, which
// land in the volatile message after it, and that the stable message's
// own content never changes when only the volatile items do (the exact
// claim the prompt cache depends on).
import { describe, expect, test } from "bun:test";
import { contextToMessages } from "@/lib/turnMachine/messages";
import type { ContextItem } from "@/lib/turnMachine/contract";

function item(source: ContextItem["source"], text: string, id = `${source}-1`): ContextItem {
  return { id, text, source, subjects: [], disclosure: "child_ok" };
}

describe("contextToMessages(): NEXT-CACHE-01's cache-stable order", () => {
  test("profile and roster land in the first (stable) system message, ahead of the window", () => {
    const context: ContextItem[] = [
      item("profile", "Sage's profile: likes hiking."),
      item("roster", "Sage", "roster-0"),
      item("window", "hi", "window-user-1"),
      item("window", "Hello!", "window-assistant-2"),
    ];
    const messages = contextToMessages(context, "what's the weather");
    expect(messages[0]).toEqual({ role: "system", content: "[profile] Sage's profile: likes hiking.\n[household] Sage" });
    expect(messages[1]).toEqual({ role: "user", content: "hi" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Hello!" });
  });

  test("memory and clock land in a second system message, after the window and before the utterance", () => {
    const context: ContextItem[] = [item("memory", "Sage likes tea.", "memory-1"), item("clock", "Monday 9:00 AM")];
    const messages = contextToMessages(context, "what's the weather");
    expect(messages[0]).toEqual({ role: "system", content: "[remembered] Sage likes tea.\n[clock] Monday 9:00 AM" });
    expect(messages[1]).toEqual({ role: "user", content: "what's the weather" });
  });

  test("both halves together: stable, window, volatile, utterance, in that exact order", () => {
    const context: ContextItem[] = [
      item("profile", "Sage's profile: likes hiking."),
      item("roster", "Sage", "roster-0"),
      item("window", "hi", "window-user-1"),
      item("window", "Hello!", "window-assistant-2"),
      item("memory", "Sage likes tea.", "memory-1"),
      item("clock", "Monday 9:00 AM"),
    ];
    const messages = contextToMessages(context, "what's the weather");
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "system", "user"]);
    expect(messages[0]?.content).toBe("[profile] Sage's profile: likes hiking.\n[household] Sage");
    expect(messages[3]?.content).toBe("[remembered] Sage likes tea.\n[clock] Monday 9:00 AM");
    expect(messages[4]).toEqual({ role: "user", content: "what's the weather" });
  });

  // The prompt cache's own actual claim: the stable message's content
  // is a function of the stable items alone, never the volatile ones -
  // two turns in the same conversation with the same profile/roster
  // but different memory matches and a different clock reading must
  // produce byte-identical stable messages, the real-common-prefix
  // property llama-server's cache needs to hit at all.
  test("the stable message is byte-identical across two turns whose only difference is volatile context", () => {
    const stableItems: ContextItem[] = [item("profile", "Sage's profile: likes hiking."), item("roster", "Sage", "roster-0")];
    const turn1 = contextToMessages([...stableItems, item("memory", "Sage likes tea.", "memory-1"), item("clock", "Monday 9:00 AM")], "what's the weather");
    const turn2 = contextToMessages([...stableItems, item("memory", "Sage's birthday is in June.", "memory-2"), item("clock", "Monday 9:05 AM")], "who won the game");
    expect(turn1[0]).toEqual(turn2[0]);
  });

  test("no stable items: no first system message at all, not an empty one", () => {
    const context: ContextItem[] = [item("memory", "Sage likes tea.", "memory-1")];
    const messages = contextToMessages(context, "hi");
    expect(messages[0]).toEqual({ role: "system", content: "[remembered] Sage likes tea." });
  });

  test("no volatile items: no trailing system message before the utterance, not an empty one", () => {
    const context: ContextItem[] = [item("profile", "Sage's profile: likes hiking.")];
    const messages = contextToMessages(context, "hi");
    expect(messages).toEqual([{ role: "system", content: "[profile] Sage's profile: likes hiking." }, { role: "user", content: "hi" }]);
  });

  test("the utterance itself never appears in either context message, only as the final user message", () => {
    const context: ContextItem[] = [item("profile", "Sage's profile."), item("utterance", "what's the weather", "utterance")];
    const messages = contextToMessages(context, "what's the weather");
    expect(messages.filter((m) => m.role === "system").every((m) => !m.content.includes("[utterance]"))).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "user", content: "what's the weather" });
  });
});
