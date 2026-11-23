import { describe, expect, test } from "bun:test";
import { ACTIVITY_CARD_KIND, actionLabel, feedIcon, isFinished, leadIcon, lineOf, sourceName, stateWord } from "./activityRows";

const row = (over: Record<string, unknown>) => ({ id: "a", source: "picture", state: "making", title: "Night Bus", line: null, percent: null, typicalMinutes: null, href: "/x", at: "2026-11-12T10:00:00Z", ...over }) as never;

describe("activityRows", () => {
  test("card kinds map from the feed state", () => {
    expect(ACTIVITY_CARD_KIND).toEqual({ waiting: "waiting", making: "progress", done: "done", attention: "attention", failed: "problem" });
  });
  test("state words and action labels", () => {
    expect(stateWord("making")).toBe("Making now");
    expect(stateWord("failed")).toBe("Could not finish");
    expect(actionLabel(row({ state: "failed" }))).toBe("Try again");
    expect(actionLabel(row({ state: "attention" }))).toBe("Review");
    expect(actionLabel(row({ source: "notice", state: "failed" }))).toBe("Open");
  });
  test("source names", () => {
    expect(sourceName("song")).toBe("Music");
    expect(sourceName("notice")).toBe("Home");
  });
  test("lineOf names where a finished job was made, and keeps a notice line", () => {
    expect(lineOf(row({ state: "done" }))).toBe("Made in Pictures.");
    expect(lineOf(row({ source: "notice", state: "done", line: "Hello" }))).toBe("Hello");
    expect(lineOf(row({ line: "Step 2", typicalMinutes: 3 }))).toBe("Step 2 Usually about 3 minutes.");
    expect(lineOf(row({ typicalMinutes: 3 }))).toBe("Usually about 3 minutes.");
  });
  test("isFinished", () => {
    expect(isFinished(row({ state: "making" }))).toBe(false);
    expect(isFinished(row({ state: "failed" }))).toBe(true);
    expect(isFinished(row({ source: "notice", state: "waiting" }))).toBe(true);
  });
  test("icons are elements", () => {
    expect(leadIcon("done")).toBeTruthy();
    expect(feedIcon(row({ source: "video" }))).toBeTruthy();
    expect(feedIcon(row({ source: "job" }))).toBeTruthy();
  });
});
