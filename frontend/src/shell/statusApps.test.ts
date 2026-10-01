import { describe, expect, test } from "bun:test";
import { appStatusPresentation, appStatusSentence, appStatusToSidebar, sidebarItemStatus, summarizeStatusApp } from "@/shell/statusApps";
import type { StatusApp, StatusAppNeed } from "@/lib/api";

const appWithNeeds = (needs: StatusAppNeed[]): StatusApp => ({
  id: "chat", name: "Chat", state: "operational", reason: null, needs, history: [], uptimePercent: 100,
});

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

describe("status app summary", () => {
  test.each([
    ["all needs fine", [{ kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "operational", required: true }], "All fine."],
    ["required down", [{ kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "down", required: true }, { kind: "service", id: "musicbrainz.org", name: "MusicBrainz", purpose: "Look up music", state: "unknown", required: false }], "Chat isn't working: MaiPai's AI isn't running."],
    ["required degraded", [{ kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "degraded", required: true }], "Chat is slow to start: MaiPai's AI is still starting."],
    ["optional degraded", [{ kind: "service", id: "searxng", name: "Household web search", purpose: "Search the web", state: "degraded", required: false }], "Chat is working, but search is having trouble."],
    ["internet waiting", [{ kind: "internet", id: "internet", name: "Internet", purpose: "Reach outside services", state: "waiting", required: true }], "Chat is waiting for the internet."],
    ["unknown only", [{ kind: "service", id: "musicbrainz.org", name: "MusicBrainz", purpose: "Look up music", state: "unknown", required: false }, { kind: "service", id: "en.wikipedia.org", name: "Wikipedia", purpose: "Look up facts", state: "unknown", required: false }], "No recent problems."],
  ] as const)("summarizes %s", (_name, needs, expected) => {
    expect(summarizeStatusApp(appWithNeeds(needs as unknown as StatusAppNeed[]))).toBe(expected);
  });

  test("chooses a required problem before optional problems", () => {
    expect(summarizeStatusApp(appWithNeeds([
      { kind: "service", id: "searxng", name: "Household web search", purpose: "Search the web", state: "down", required: false },
      { kind: "engine", id: "chat", name: "MaiPai's AI", purpose: "Answer chat turns", state: "degraded", required: true },
    ]))).toBe("Chat is slow to start: MaiPai's AI is still starting.");
  });
});
