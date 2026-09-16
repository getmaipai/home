import { describe, expect, test } from "bun:test";
import { asksWhatHubSaid, asksAboutEarlierTalk } from "@/lib/recallShapes";

describe("asksWhatHubSaid()", () => {
  test("matches what did you say", () => {
    expect(asksWhatHubSaid("What did you say about the trip?")).toBe(true);
  });

  test("matches tell me what you recommended", () => {
    expect(asksWhatHubSaid("Tell me what you recommended last week")).toBe(true);
  });

  test("does not match an ordinary question", () => {
    expect(asksWhatHubSaid("What time is the meeting?")).toBe(false);
  });
});

describe("asksAboutEarlierTalk()", () => {
  test("matches what did we decide", () => {
    expect(asksAboutEarlierTalk("What did we decide about dinner?")).toBe(true);
  });

  test("matches do you remember what I said", () => {
    expect(asksAboutEarlierTalk("Do you remember what I said this morning?")).toBe(true);
  });

  test("also counts the hub-side shapes", () => {
    expect(asksAboutEarlierTalk("What did you suggest last time?")).toBe(true);
  });

  test("does not match unrelated small talk", () => {
    expect(asksAboutEarlierTalk("How are you doing today?")).toBe(false);
  });
});
