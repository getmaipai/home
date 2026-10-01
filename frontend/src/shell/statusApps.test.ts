import { describe, expect, test } from "bun:test";
import { appStatusPresentation, appStatusSentence, appStatusToSidebar, sidebarItemStatus } from "@/shell/statusApps";
import type { StatusApp } from "@/lib/api";

describe("status app language and sidebar severity", () => {
  test.each([
    ["operational", { status: "online", label: "Working" }, null],
    ["degraded", { status: "degraded", label: "Degraded" }, "amber"],
    ["down", { status: "offline", label: "Not working" }, "red"],
    ["waiting_for_internet", { status: "degraded", label: "Waiting for internet" }, "amber"],
  ] as const)("maps %s consistently", (state, presentation, dot) => {
    expect(appStatusPresentation(state)).toEqual(presentation);
    expect(appStatusToSidebar(state)).toBe(dot);
  });

  test("uses the plain reason sentence as tooltip and accessible label", () => {
    expect(appStatusSentence("Chat", "down", "Chat isn't working right now.")).toEqual({
      ariaLabel: "Chat: not working",
      title: "Chat isn't working right now.",
    });
  });

  test("matches app names to nav items and suppresses healthy dots", () => {
    const apps: StatusApp[] = [
      { id: "chat", name: "Chat", state: "operational", reason: null, needs: [], history: [], uptimePercent: 100 },
      { id: "videos", name: "Videos", state: "down", reason: "YouTube isn't reachable right now.", needs: [], history: [], uptimePercent: 95 },
    ];
    expect(sidebarItemStatus(apps, { name: "Chat", url: "/next/chat" })).toBeUndefined();
    expect(sidebarItemStatus(apps, { name: "Videos", url: "/videos" })).toEqual({ badge: "red", title: "YouTube isn't reachable right now.", ariaLabel: "Videos: not working" });
    expect(sidebarItemStatus(apps, { name: "Family", url: "/people" })).toBeUndefined();
  });

  test("ignores a non-array response from an older or unavailable status route", () => {
    expect(sidebarItemStatus({} as never, { name: "Chat", url: "/chat" })).toBeUndefined();
  });
});
