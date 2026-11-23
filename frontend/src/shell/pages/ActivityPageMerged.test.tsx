// ACTIVITY-MERGE-01: the one Activity page shows jobs and notifications in the same card, with a thumbnail for a finished picture, and no separate Notifications page.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ActivityPage } from "@/shell/pages/ActivityPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(() => cleanup());

const now = () => new Date().toISOString();
const list = { seenAt: null, dot: "none", items: [{ id: "picture:1", source: "picture", state: "done", title: "A red fox", line: null, percent: null, typicalMinutes: null, href: "/files", at: now(), thumbnailUrl: "/api/files/f1/thumb?w=320" }] };
const notice = { id: "n1", typeId: "repairs.new", level: "time_sensitive", text: "MaiPai Stack is offline", channels: ["in_app"], createdAt: now(), readAt: null, dismissedAt: null, subjectTurnId: null, memoryIds: null, toast: false };

function setup() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url} ${String(init?.body ?? "")}`);
    if (url.includes("/api/notifications/history")) return Promise.resolve(Response.json([notice]));
    if (url.includes("/api/notifications/dismiss")) return Promise.resolve(Response.json({ count: 1 }));
    if (url.includes("/api/activity/seen")) return Promise.resolve(Response.json({ seenAt: now() }));
    if (url.includes("/api/activity")) return Promise.resolve(Response.json(list));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const page = () => renderWithQueryClient(<MemoryRouter initialEntries={["/activity"]}><Routes><Route path="/activity" element={<ActivityPage />} /></Routes></MemoryRouter>);

describe("ActivityPage with notifications merged in", () => {
  test("shows a notice in the same card style as a job, a thumbnail for the finished picture, and no Older messages link", async () => {
    const api = setup();
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("MaiPai Stack is offline")).toBeTruthy());
      expect(view.getByText("A red fox")).toBeTruthy();
      expect(document.querySelectorAll("[data-status-kind]").length).toBe(2);
      expect(document.querySelector('img[src*="/api/files/f1/thumb"]')).not.toBeNull();
      expect(view.queryByText("Older messages")).toBeNull();
    } finally { api.restore(); }
  });

  test("Clear this on a notice dismisses that notification", async () => {
    const api = setup();
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("MaiPai Stack is offline")).toBeTruthy());
      const card = view.getByText("MaiPai Stack is offline").closest("[data-status-kind]") as HTMLElement;
      fireEvent.click(Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Clear this")!);
      await waitFor(() => expect(api.calls.some((c) => c.startsWith("POST") && c.includes("/api/notifications/dismiss") && c.includes("n1"))).toBe(true));
    } finally { api.restore(); }
  });

  test("an empty list says messages too, and still has no Older messages link", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/notifications/history")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/activity/seen")) return Promise.resolve(Response.json({ seenAt: now() }));
      if (url.includes("/api/activity")) return Promise.resolve(Response.json({ seenAt: null, dot: "none", items: [] }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const view = page();
      await waitFor(() => expect(view.getByText("Nothing here yet")).toBeTruthy());
      expect(view.getByText("Pictures, videos, songs and messages show up here.")).toBeTruthy();
      expect(view.queryByText("Older messages")).toBeNull();
    } finally { globalThis.fetch = original; }
  });
});
