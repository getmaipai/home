import { afterEach, describe, expect, test, mock, vi } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClockPage } from "@/apps/clock/ClockPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function stub(items: Array<{ id: string; kind: "alarm" | "reminder" | "timer"; text: string; at: string }>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/coming-up") && (!init?.method || init.method === "GET")) return Promise.resolve(Response.json(items));
    calls.push(url);
    return Promise.resolve(Response.json({ ok: true }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("ClockPage", () => {
  test("Alarms and Timers tabs filter rows and timers count down", async () => {
    const api = stub([
      { id: "a1", kind: "alarm", text: "Wake", at: new Date(Date.now() + 3_600_000).toISOString() },
      { id: "r1", kind: "reminder", text: "Milk", at: new Date().toISOString() },
      { id: "t1", kind: "timer", text: "Tea", at: new Date(Date.now() + 60_000).toISOString() },
    ]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText("Wake", { selector: "p" })).toBeInTheDocument();
      expect(view.queryByText("Milk")).toBeNull();
      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      expect(await view.findByText("Tea")).toBeInTheDocument();
      expect(view.getByText(/remaining/)).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      expect(api.calls.some((url) => url.endsWith("/t1/done"))).toBe(true);
    } finally { api.restore(); }
  });

  test("tablist supports arrow keys and exposes the selected tab", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      const alarms = await view.findByRole("tab", { name: "Alarms" });
      alarms.focus();
      fireEvent.keyDown(alarms, { key: "ArrowRight" });
      await waitFor(() => expect(view.getByRole("tab", { name: "Timers" }).getAttribute("aria-selected")).toBe("true"));
    } finally { api.restore(); }
  });

  test("shows tagline and divider without repeating the page title, and adapts tabs to phone width", async () => {
    const api = stub([]);
    const width = window.innerWidth;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("639.98") ? window.innerWidth < 640 : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 402 });
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText("Make space for a gentler start.")).toBeInTheDocument();
      expect(view.container.querySelector("h1")?.className).toContain("sr-only");
      expect(view.container.querySelector("main")?.querySelector("p")?.className).toContain("border-b");
      expect(view.container.querySelector('[data-slot="tabs-list"]')?.getAttribute("data-variant")).toBe("bottom");
    } finally {
      api.restore(); window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });

  test("shows the next alarm and updates its relative time once per minute", async () => {
    vi.useFakeTimers();
    const at = new Date(Date.now() + 7 * 60 * 60_000 + 12 * 60_000).toISOString();
    const api = stub([{ id: "a1", kind: "alarm", text: "gym", at }]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText(/Next:/)).toHaveTextContent(/in 7 h 12 min/);
      vi.advanceTimersByTime(60_000);
      await waitFor(() => expect(view.getByText(/Next:/)).toHaveTextContent(/in 7 h 11 min/));
    } finally { api.restore(); vi.useRealTimers(); }
  });

  test("alarm row has the requested accessible name and preserves Done and Snooze actions", async () => {
    const api = stub([{ id: "a1", kind: "alarm", text: "gym", at: new Date(Date.now() + 3_600_000).toISOString() }]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      const row = await view.findByRole("group", { name: /once, gym/i });
      const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(Date.now() + 3_600_000));
      expect(row.getAttribute("aria-label")).toBe(`${time}, once, gym`);
      const item = row.closest("li") as HTMLElement;
      fireEvent.pointerDown(within(item).getByRole("button", { name: "Snooze" }), { button: 0, ctrlKey: false });
      await waitFor(() => expect(view.getByText("15 minutes")).toBeInTheDocument());
      fireEvent.click(view.getByText("15 minutes"));
      await waitFor(() => expect(api.calls.some((url) => url.endsWith("/a1/snooze"))).toBe(true));
      fireEvent.click(within(item).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(api.calls.some((url) => url.endsWith("/a1/done"))).toBe(true));
    } finally { api.restore(); }
  });

  test("shows plain empty states", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText("No alarms")).toBeInTheDocument();
      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      expect(await view.findByText("No timers")).toBeInTheDocument();
    } finally { api.restore(); }
  });
});
