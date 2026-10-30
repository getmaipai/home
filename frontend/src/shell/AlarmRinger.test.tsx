import { afterEach, describe, expect, test, mock } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AlarmRinger } from "@/shell/AlarmRinger";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { NotificationDeliveryView } from "@/lib/api";

const person = { id: "person-1" } as never;

afterEach(cleanup);

function alarm(id: string, createdAt: string, subjectJobId = `job-${id}`, text = "Your alarm"): NotificationDeliveryView {
  return { id, typeId: "alarm.due", level: "time_sensitive", text, channels: ["in_app"], createdAt, readAt: null, dismissedAt: null, subjectTurnId: null, subjectJobId, memoryIds: null, toast: false };
}

describe("AlarmRinger", () => {
  test("first load history is missed and a newly arriving alarm rings", async () => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    let notifications: NotificationDeliveryView[] = [alarm("old", new Date(Date.now() - 180_000).toISOString(), undefined, "Alarm: gym")];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notifications") && !init?.method) return Promise.resolve(Response.json(notifications));
      if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([{ key: "alarms.sound", value: "none" }, { key: "alarms.volume", value: "medium" }, { key: "alarms.snooze_minutes", value: 10 }]));
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    try {
      const { view, queryClient } = (() => { const result = renderWithQueryClient(<MemoryRouter><AlarmRinger person={person} /></MemoryRouter>); return { view: result, queryClient: result.queryClient }; })();
      expect(await view.findByText(/Missed at/)).toBeInTheDocument();
      expect(view.queryByText("Tap to turn the sound on")).toBeNull();
      await act(async () => { notifications = [alarm("old", notifications[0]!.createdAt, undefined, "Alarm: gym"), alarm("new", new Date().toISOString(), undefined, "Alarm: gym")]; queryClient.setQueryData(["notifications"], notifications); });
      await waitFor(() => expect(view.getByText("Time to get up: gym")).toBeInTheDocument());
      expect(view.getAllByRole("button", { name: "Done" })).toHaveLength(2);
      const newAlarmRow = view.getAllByText("Time to get up: gym")[0]!.closest("section");
      fireEvent.click(within(newAlarmRow!).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/notifications/new/dismiss") && call.method === "POST")).toBe(true));
    } finally { globalThis.fetch = original; }
  });

  test("closing the dialog with Escape hides it and leaves the alarm in the bell", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notifications") && !init?.method) return Promise.resolve(Response.json([alarm("a", new Date().toISOString())]));
      if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([{ key: "alarms.sound", value: "none" }]));
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><AlarmRinger person={person} /></MemoryRouter>);
      expect(await view.findByRole("button", { name: "Done" })).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(view.queryByRole("button", { name: "Done" })).toBeNull());
      expect(calls.some((call) => call.includes("dismiss"))).toBe(false);
    } finally { globalThis.fetch = original; }
  });

  test("multiple alarms stack and snooze offers the shared minute choices", async () => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; body?: unknown }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notifications") && !init?.method) return Promise.resolve(Response.json([alarm("a", new Date().toISOString()), alarm("b", new Date().toISOString())]));
      if (url.includes("/api/settings?scope=")) return Promise.resolve(Response.json([{ key: "alarms.sound", value: "none" }, { key: "alarms.volume", value: "medium" }, { key: "alarms.snooze_minutes", value: 10 }]));
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><AlarmRinger person={person} /></MemoryRouter>);
      expect(await view.findByText("2 alarms")).toBeInTheDocument();
      fireEvent.pointerDown(view.getAllByRole("button", { name: "More snooze options" })[0]!, { button: 0, ctrlKey: false });
      await waitFor(() => expect(view.getByText("5 minutes")).toBeInTheDocument());
      fireEvent.click(view.getByText("5 minutes"));
      await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/coming-up/job-a/snooze") && JSON.stringify(call.body) === JSON.stringify({ minutes: 5 }))).toBe(true));
    } finally { globalThis.fetch = original; }
  });

  test("blocked audio shows the tap line, reduced motion omits animation, and phone uses the top sheet without changing the avatar", async () => {
    const originalFetch = globalThis.fetch;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: query.includes("prefers-reduced-motion") || query.includes("max-width"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) });
    globalThis.fetch = mock((input: RequestInfo | URL) => String(input).includes("/api/notifications") ? Promise.resolve(Response.json([])) : Promise.resolve(Response.json([{ key: "alarms.sound", value: "bell" }, { key: "alarms.volume", value: "medium" }, { key: "alarms.snooze_minutes", value: 10 }]))) as unknown as typeof fetch;
    try {
      const rendered = renderWithQueryClient(<MemoryRouter><><button data-testid="avatar"><span>Companion</span></button><AlarmRinger person={person} /></></MemoryRouter>);
      const avatarBefore = rendered.getByTestId("avatar").outerHTML;
      await waitFor(() => expect(rendered.queryClient.getQueryData(["notifications"])).toBeDefined());
      await act(async () => { rendered.queryClient.setQueryData(["notifications"], [alarm("fresh", new Date().toISOString())]); });
      expect(await rendered.findByText("Tap to turn the sound on")).toBeInTheDocument();
      expect(document.querySelector("[data-slot='sheet-content']")).toBeTruthy();
      expect(document.querySelector("svg[aria-hidden='true']")?.getAttribute("class") ?? "").not.toContain("swing");
      expect(rendered.getByTestId("avatar").outerHTML).toBe(avatarBefore);
    } finally {
      globalThis.fetch = originalFetch;
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });
});
