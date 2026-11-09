// ACTIVITY-PAGE-01: the Activity page draws the viewer's own jobs as the kit StatusCard, newest first, grouped by day, with the hub's own words.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ActivityPage, groupByDay } from "@/shell/pages/ActivityPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { ActivityItemView, ActivityListView } from "@/lib/api";

afterEach(() => cleanup());

const at = (daysAgo: number, hour = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const item = (over: Partial<ActivityItemView>): ActivityItemView => ({ id: "picture:1", source: "picture", state: "done", title: "A red fox", line: null, percent: null, typicalMinutes: null, href: "/files", at: at(0), ...over });

function mockActivity(list: ActivityListView) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/api/activity/seen")) return Promise.resolve(Response.json({ seenAt: new Date().toISOString() }));
    if (url.includes("/api/activity")) return Promise.resolve(Response.json(list));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function page() {
  return renderWithQueryClient(<MemoryRouter initialEntries={["/activity"]}><Routes><Route path="/activity" element={<ActivityPage />} /><Route path="/apps/videos/create" element={<p>Videos create page</p>} /></Routes></MemoryRouter>);
}

describe("ActivityPage", () => {
  test("shows each state with its state word, title, one line and one action, grouped by day, newest first", async () => {
    const api = mockActivity({ seenAt: null, dot: "attention", items: [
      item({ id: "video:1", source: "video", state: "making", title: "A paper lantern", line: "Drawing the frames", percent: 42, href: "/apps/videos/create", at: at(0, 11) }),
      item({ id: "song:1", source: "song", state: "waiting", title: "Rainy porch song", line: "You are next.", href: "/apps/music/create?song=1", at: at(0, 10) }),
      item({ id: "picture:2", state: "done", title: "A red fox", at: at(0, 9) }),
      item({ id: "video:2", source: "video", state: "failed", title: "Rain on a tin roof", line: "I couldn't make that video. Try again, or ask for something simpler.", href: "/apps/videos/create", at: at(1) }),
      item({ id: "job:1", source: "job", state: "attention", title: "Asked to unlock a clip", line: "This is waiting for your answer.", href: "/chat", at: at(3) }),
    ] });
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("A paper lantern")).toBeTruthy());
      const cards = Array.from(document.querySelectorAll("[data-status-kind]")).map((node) => node.getAttribute("data-status-kind"));
      expect(cards).toEqual(["progress", "waiting", "done", "problem", "attention"]);
      const text = document.body.textContent ?? "";
      for (const word of ["Making now", "Waiting", "Done", "Could not finish", "Needs a look"]) expect(text).toContain(word);
      expect(text).toContain("Today");
      expect(text).toContain("Yesterday");
      expect(text.indexOf("A paper lantern")).toBeLessThan(text.indexOf("A red fox"));
      expect(text.indexOf("A red fox")).toBeLessThan(text.indexOf("Rain on a tin roof"));
      expect(text).toContain("I couldn't make that video. Try again, or ask for something simpler.");
      expect(within(view.getByText("Rain on a tin roof").closest("section")!).getByRole("button", { name: "Try again" })).toBeTruthy();
      expect(view.getByText("42%")).toBeTruthy();
      expect(text).toContain("Made in Pictures.");
    } finally { api.restore(); }
  });

  test("a making job with no percent says how long it usually takes", async () => {
    const api = mockActivity({ seenAt: null, dot: "running", items: [item({ id: "song:9", source: "song", state: "making", title: "Lullaby", line: "Making your song.", percent: null, typicalMinutes: 2, href: null })] });
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("Lullaby")).toBeTruthy());
      expect(document.body.textContent).toContain("Usually about 2 minutes.");
    } finally { api.restore(); }
  });

  test("the action opens the result or the app's page", async () => {
    const api = mockActivity({ seenAt: null, dot: "attention", items: [item({ id: "video:2", source: "video", state: "failed", title: "Rain on a tin roof", line: "Try again.", href: "/apps/videos/create" })] });
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("Rain on a tin roof")).toBeTruthy());
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(view.getByText("Videos create page")).toBeTruthy());
    } finally { api.restore(); }
  });

  test("opening the page marks what finished as seen, once", async () => {
    const api = mockActivity({ seenAt: null, dot: "finished", items: [item({})] });
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("A red fox")).toBeTruthy());
      await waitFor(() => expect(api.calls.filter((call) => call === "POST /api/activity/seen")).toHaveLength(1));
    } finally { api.restore(); }
  });

  test("an empty list says so in one kit info card and a link to older messages stays", async () => {
    const api = mockActivity({ seenAt: null, dot: "none", items: [] });
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("Nothing here yet")).toBeTruthy());
      expect(document.querySelector("[data-status-kind=info]")).toBeTruthy();
      expect(view.getByRole("link", { name: "Older messages" }).getAttribute("href")).toBe("/notifications");
    } finally { api.restore(); }
  });

  test("a failed read says what happened and offers Try again", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response("{}", { status: 500 }))) as unknown as typeof fetch;
    try {
      const view = page();
      await waitFor(() => expect(document.body.textContent).toContain("Activity could not load"));
      expect(view.getByRole("button", { name: /try again/i })).toBeTruthy();
    } finally { globalThis.fetch = original; }
  });
});

describe("groupByDay", () => {
  test("keeps the given order and starts a new group when the local day changes", () => {
    const groups = groupByDay([item({ id: "a", at: at(0, 12) }), item({ id: "b", at: at(0, 8) }), item({ id: "c", at: at(2) })]);
    expect(groups.map((group) => group.items.map((entry) => entry.id))).toEqual([["a", "b"], ["c"]]);
    expect(groups[0]?.heading).toBe("Today");
  });
});
