import { describe, expect, test } from "bun:test";
import { activityPopoverItems } from "./ActivityBell";

const row = (over: Record<string, unknown>) => ({ id: "a", source: "picture", state: "making", title: "Night Bus", line: "Step 2 of 4", percent: 40, typicalMinutes: null, href: "/media/pictures/1", at: "2026-11-12T10:00:00Z", ...over }) as never;

describe("activityPopoverItems", () => {
  test("waiting and making rows are running with their progress and step", () => {
    const [waiting, making] = activityPopoverItems([row({ state: "waiting" }), row({ id: "b" })]);
    expect(waiting!.state).toBe("running");
    expect(making).toMatchObject({ state: "running", progress: 40, step: "Step 2 of 4", kind: "picture" });
  });
  test("failed stays failed, done and attention are done, and a song is music", () => {
    const out = activityPopoverItems([row({ state: "failed" }), row({ id: "c", state: "attention" }), row({ id: "d", state: "done", source: "song" })]);
    expect(out.map((item) => item.state)).toEqual(["failed", "done", "done"]);
    expect(out[2]!.kind).toBe("music");
  });
  test("a row without a line or percent leaves those fields out", () => {
    const [item] = activityPopoverItems([row({ line: null, percent: null, href: null })]);
    expect(item).toMatchObject({ subtitle: undefined, progress: undefined, href: undefined });
  });
});
