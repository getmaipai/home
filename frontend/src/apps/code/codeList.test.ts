// CODE-UX-01: the sessions column's order and markers, and the row-menu actions' calls.
import { describe, expect, test } from "bun:test";
import { arrangeSessions, needsSeenMark, rowMarker } from "./codeList";
import type { CodeSession } from "./codeApi";

const now = new Date("2026-11-22T15:00:00");
const row = (id: string, over: Partial<CodeSession> = {}): CodeSession => ({ id, title: id, repo: { kind: "none", base_branch: "main", work_branch: "w" }, mode: "ask", state: "idle", changes: { files: 0, additions: 0, deletions: 0 }, last_activity_at: "2026-11-22T09:00:00", pinned_at: null, archived_at: null, unread: false, ...over });

describe("rowMarker", () => {
  test("needs you, working and failed follow the state, and show on the open session too", () => {
    expect(rowMarker(row("a", { state: "needs_you", unread: true }), "a")).toBe("needs_you");
    for (const state of ["working", "starting", "queued"] as const) expect(rowMarker(row("a", { state }), "a")).toBe("working");
    expect(rowMarker(row("a", { state: "failed" }), undefined)).toBe("failed");
  });
  test("unread shows for a session that is not open and never for the open one", () => {
    expect(rowMarker(row("a", { unread: true }), "b")).toBe("unread");
    expect(rowMarker(row("a", { unread: true }), "a")).toBeNull();
    expect(rowMarker(row("a"), "b")).toBeNull();
  });
  test("the page marks the open session seen only while the hub still calls it unread", () => {
    expect(needsSeenMark(row("a", { unread: true }), "a")).toBe(true);
    expect(needsSeenMark(row("a", { unread: true }), "b")).toBe(false);
    expect(needsSeenMark(row("a"), "a")).toBe(false);
    expect(needsSeenMark(undefined, "a")).toBe(false);
    // CODE-FIX-01: a failed session that is open is marked seen too, so its red dot goes.
    expect(needsSeenMark(row("a", { state: "failed" }), "a")).toBe(true);
    expect(needsSeenMark(row("a", { state: "failed" }), "b")).toBe(false);
  });
});

describe("arrangeSessions", () => {
  const rows = [
    row("today-old", { last_activity_at: "2026-11-22T08:00:00" }), row("today-new", { last_activity_at: "2026-11-22T12:00:00" }),
    row("yesterday", { last_activity_at: "2026-11-21T12:00:00" }), row("old", { last_activity_at: "2026-11-01T12:00:00" }),
    row("pin-a", { pinned_at: "2026-11-10T00:00:00Z", last_activity_at: "2026-11-02T00:00:00" }), row("pin-b", { pinned_at: "2026-11-12T00:00:00Z" }),
    row("gone", { archived_at: "2026-11-20T00:00:00Z" }),
  ];
  test("pinned lead (newest pin first), then Today, Yesterday and Earlier by activity, and archived stay hidden", () => {
    const { groups, archivedCount, shown } = arrangeSessions(rows, { now });
    expect(groups.map((g) => g.label)).toEqual(["Pinned", "Today", "Yesterday", "Earlier"]);
    expect(shown.map((s) => s.id)).toEqual(["pin-b", "pin-a", "today-new", "today-old", "yesterday", "old"]);
    expect(archivedCount).toBe(1);
  });
  test("the archived toggle adds an Archived group last", () => {
    const { groups } = arrangeSessions(rows, { now, showArchived: true });
    expect(groups.at(-1)).toMatchObject({ id: "archived", label: "Archived" });
    expect(groups.at(-1)!.rows.map((s) => s.id)).toEqual(["gone"]);
  });
  test("search matches the title or the repository over what is visible, and a pinned match stays pinned", () => {
    expect(arrangeSessions(rows, { now, query: "PIN" }).shown.map((s) => s.id)).toEqual(["pin-b", "pin-a"]);
    expect(arrangeSessions([row("x", { repo: { kind: "github", full_name: "acme/lamp", base_branch: "main", work_branch: "w" } })], { now, query: "lamp" }).shown).toHaveLength(1);
    expect(arrangeSessions(rows, { now, query: "gone" }).shown).toEqual([]);
    expect(arrangeSessions(rows, { now, query: "gone", showArchived: true }).shown.map((s) => s.id)).toEqual(["gone"]);
  });
});
