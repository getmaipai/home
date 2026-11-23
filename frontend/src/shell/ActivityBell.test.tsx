import { describe, expect, test } from "bun:test";
import { activityPopoverItems } from "./ActivityBell";

const row = (over: Record<string, unknown>) => ({ id: "a", source: "picture", state: "making", title: "Night Bus", line: "Step 2 of 4", percent: 40, typicalMinutes: null, href: "/media/pictures/1", at: "2026-11-12T10:00:00Z", ...over }) as never;

describe("activityPopoverItems", () => {
  test("waiting and making rows are running with their progress, line, state word and card kind", () => {
    const [waiting, making] = activityPopoverItems([row({ state: "waiting" }), row({ id: "b" })]);
    expect(waiting).toMatchObject({ state: "running", cardKind: "waiting", stateWord: "Waiting", actionLabel: "Open" });
    expect(making).toMatchObject({ state: "running", cardKind: "progress", stateWord: "Making now", progress: 40, line: "Step 2 of 4", kind: "picture" });
    expect(making!.icon).toBeTruthy();
  });
  test("failed stays failed, done and attention are done, and a song is music", () => {
    const out = activityPopoverItems([row({ state: "failed" }), row({ id: "c", state: "attention" }), row({ id: "d", state: "done", source: "song", line: null })]);
    expect(out.map((item) => item.state)).toEqual(["failed", "done", "done"]);
    expect(out.map((item) => item.cardKind)).toEqual(["problem", "attention", "done"]);
    expect(out.map((item) => item.actionLabel)).toEqual(["Try again", "Review", "Open"]);
    expect(out[2]!.kind).toBe("music");
    expect(out[2]!.line).toBe("Made in Music.");
  });
  test("a row without a line or percent leaves those fields out", () => {
    const [item] = activityPopoverItems([row({ line: null, percent: null, href: null })]);
    expect(item).toMatchObject({ line: "", progress: undefined, href: undefined });
  });
  test("a finished row carries its thumbnail, a running one does not, and a notice row is a plain done row with no kind", () => {
    const out = activityPopoverItems([row({ state: "done", thumbnailUrl: "/api/files/f1/thumb?w=320" }), row({ id: "m", thumbnailUrl: "/t" }), row({ id: "notice:n1", source: "notice", state: "done", thumbnailUrl: undefined })]);
    expect(out[0]!.thumbnailUrl).toBe("/api/files/f1/thumb?w=320");
    expect(out[1]!.thumbnailUrl).toBeUndefined();
    expect(out[2]).toMatchObject({ state: "done", kind: undefined });
  });
  test("only a finished row can be cleared, and clearing calls the handler with that row", () => {
    const cleared: string[] = [];
    const out = activityPopoverItems([row({ id: "run" }), row({ id: "fin", state: "done" })], (item) => cleared.push(item.id));
    expect(out[0]!.onClear).toBeUndefined();
    out[1]!.onClear!();
    expect(cleared).toEqual(["fin"]);
  });
});
