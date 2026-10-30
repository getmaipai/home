import { afterEach, describe, expect, test, mock, vi } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClockPage } from "@/apps/clock/ClockPage";
import { openClockAlarmEditor } from "@/apps/clock/clockHeader";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function stub(items: Array<{ id: string; kind: "alarm" | "reminder" | "timer"; text: string; at: string }>, records: Array<Record<string, unknown>> = []) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/alarms") && method === "GET") return Promise.resolve(Response.json(records));
    if (url.endsWith("/api/quick-timers") && method === "GET") return Promise.resolve(Response.json([
      { id: "tea", name: "Tea steep", minutes: 4 },
      { id: "break", name: "A little break", minutes: 10 },
      { id: "focus", name: "Focus session", minutes: 25 },
      { id: "deep", name: "Deep work", minutes: 45 },
    ]));
    if (url.endsWith("/api/world-places") && method === "GET") return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/coming-up") && (!init?.method || init.method === "GET")) return Promise.resolve(Response.json(items));
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST" && url.endsWith("/api/alarms")) return Promise.resolve(Response.json({ id: "alarm-created1", next_at: null }));
    if (method === "POST" && url.endsWith("/api/coming-up/timers")) return Promise.resolve(Response.json({ id: "timer-created" }));
    if (method === "POST" && url.endsWith("/skip-next")) return Promise.resolve(Response.json({ id: "alarm-abcdef", next_at: null }));
    if (url.endsWith("/api/alarms") || url.includes("/api/alarms/")) return Promise.resolve(Response.json({ id: "alarm-abcdef", next_at: null }));
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
      expect(view.queryByText("Quick timers")).toBeNull();
      expect(view.queryByText("No places yet")).toBeNull();
      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      expect((await view.findAllByText("Tea")).length).toBeGreaterThan(0);
      expect(view.queryByText("Wake", { selector: "p" })).toBeNull();
      expect(view.queryByText("No places yet")).toBeNull();
      expect(view.getByText(/remaining/)).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      expect(api.calls.some((call) => call.url.endsWith("/t1/done"))).toBe(true);
    } finally { api.restore(); }
  });

  test("each tab renders only its own content", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      await view.findByText("No alarms");
      expect(view.queryByText("Quick timers")).toBeNull();
      expect(view.queryByText("No places yet")).toBeNull();

      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      await view.findByText("Quick timers");
      expect(view.queryByText("No places yet")).toBeNull();

      fireEvent.click(view.getByRole("tab", { name: "World clocks" }));
      await view.findByText("No places yet");
      expect(view.queryByText("Quick timers")).toBeNull();
      expect(view.queryByText("No alarms")).toBeNull();

      fireEvent.click(view.getByRole("tab", { name: "Stopwatch" }));
      expect(view.getByRole("button", { name: "Start" })).toBeInTheDocument();
      expect(view.queryByText("Quick timers")).toBeNull();
      expect(view.queryByText("No places yet")).toBeNull();
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
    window.matchMedia = ((query: string) => ({
      matches: query.includes("639.98") ? window.innerWidth < 640 : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
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

  test("main shell navigation renders at every required width", async () => {
    const api = stub([]);
    const originalWidth = window.innerWidth;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("639.98") ? window.innerWidth < 640 : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      for (const width of [360, 402, 874, 744, 1440]) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
        expect(await view.findByRole("tab", { name: "Alarms" })).toBeInTheDocument();
        expect(view.getByRole("tab", { name: "World clocks" })).toBeInTheDocument();
        view.unmount();
      }
    } finally {
      api.restore();
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
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
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/a1/snooze"))).toBe(true));
      fireEvent.click(within(item).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/a1/done"))).toBe(true));
    } finally { api.restore(); }
  });

  test("shows plain empty states", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText("No alarms")).toBeInTheDocument();
      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      // The ring is the Timers empty state: no separate "No timers" line.
      expect(await view.findByText("Quick timers")).toBeInTheDocument();
      expect(view.queryByText("No timers")).toBeNull();
    } finally { api.restore(); }
  });

  test("record row gives repeat text, day names, switch name, next time, and PATCHes its day circles and switch", async () => {
    const record = { id: "alarm-abcdef", time: "06:30", days: [1, 2, 3, 4, 5], label: "Wake up", tag: "Wake up", enabled: true, sound: "gentle_wake", snooze_minutes: null, next_at: new Date(Date.now() + 7 * 60 * 60_000 + 12 * 60_000).toISOString() };
    const api = stub([], [record]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText("Weekdays · Gentle wake")).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
      expect(view.getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "false");
      expect(view.getByRole("switch", { name: /6:30 AM, weekdays, Wake up, on/i })).toBeInTheDocument();
      expect(await view.findByText(/Rings in/)).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Monday" }));
      await waitFor(() => expect(api.calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ days: [2, 3, 4, 5] }));
      fireEvent.click(view.getByRole("switch", { name: /6:30 AM/i }));
      await waitFor(() => expect(api.calls.find((call) => call.method === "PATCH" && (call.body as { enabled?: boolean }).enabled === false)).toBeTruthy());
    } finally { api.restore(); }
  });

  test("editor creates, edits, confirms delete, skips next, and the header plus opens an empty editor", async () => {
    const record = { id: "alarm-abcdef", time: "06:30", days: [1, 2, 3, 4, 5], label: "Wake up", tag: "Wake up", enabled: true, sound: "gentle_wake", snooze_minutes: null, next_at: null };
    const api = stub([], [record]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      openClockAlarmEditor();
      await waitFor(() => expect(view.queryByRole("dialog")).toBeTruthy());
      expect(await view.findByRole("dialog")).toBeInTheDocument();
      fireEvent.change(view.getByLabelText("Time"), { target: { value: "07:15" } });
      fireEvent.change(view.getByLabelText("Label"), { target: { value: "Stretch" } });
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(api.calls.find((call) => call.method === "POST" && call.url.endsWith("/api/alarms"))?.body).toMatchObject({ time: "07:15", label: "Stretch" }));
    } finally { api.restore(); }
  });

  test("an existing alarm opens for edit, can skip next and deletes after confirmation", async () => {
    const record = { id: "alarm-abcdef", time: "06:30", days: [1, 2, 3, 4, 5], label: "Wake up", tag: "Wake up", enabled: true, sound: "gentle_wake", snooze_minutes: null, next_at: null };
    const api = stub([], [record]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      fireEvent.click(await view.findByRole("button", { name: /6:30 AM, weekdays, Wake up/i }));
      expect(await view.findByLabelText("Label")).toHaveValue("Wake up");
      fireEvent.click(view.getByRole("button", { name: "Skip next" }));
      await waitFor(() => expect(view.getByText("Skipping the next one")).toBeInTheDocument());
      expect(api.calls.some((call) => call.method === "POST" && call.url.endsWith("/alarm-abcdef/skip-next"))).toBe(true);
      fireEvent.click(view.getByRole("button", { name: "Delete" }));
      expect(await view.findByRole("alertdialog")).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Delete alarm" }));
      await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE")).toBe(true));
    } finally { api.restore(); }
  });

  test("legacy one-time rows retain Done and Snooze, and the phone editor uses the bottom sheet", async () => {
    const api = stub([{ id: "legacy1", kind: "alarm", text: "gym", at: new Date(Date.now() + 3_600_000).toISOString() }]);
    const width = window.innerWidth;
    const media = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("639.98") ? true : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
      openClockAlarmEditor();
      await waitFor(() => expect(view.queryByRole("dialog")).toBeTruthy());
      await view.findByRole("dialog");
      expect(view.getByTestId("alarm-sheet-content").className).toContain("inset-x-0");
    } finally { api.restore(); window.matchMedia = media; Object.defineProperty(window, "innerWidth", { configurable: true, value: width }); }
  });
});
