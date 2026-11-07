import { toastError, spyOnToast } from "../../../tests/toastSpy";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { TimersTab } from "@/apps/clock/TimersTab";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

spyOnToast();
afterEach(cleanup);

function mockApi() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const quick = [
    { id: "tea", name: "Tea steep", minutes: 4 },
    { id: "break", name: "A little break", minutes: 10 },
    { id: "focus", name: "Focus session", minutes: 25 },
    { id: "deep", name: "Deep work", minutes: 45 },
  ];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/quick-timers") && method === "GET") return Promise.resolve(Response.json(quick));
    if (url.endsWith("/api/coming-up") && method === "GET") return Promise.resolve(Response.json([]));
    if (url.endsWith("/api/coming-up/timers")) return Promise.resolve(Response.json({ id: "timer-new" }));
    if (url.includes("/api/coming-up/") && url.endsWith("/extend")) return Promise.resolve(Response.json({ id: "timer-one", at: new Date(Date.now() + 120_000).toISOString(), total_seconds: 180 }));
    if (url.includes("/api/coming-up/") && url.endsWith("/done")) return Promise.resolve(Response.json({ ok: true }));
    return Promise.resolve(Response.json({ id: "saved" }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("TimersTab", () => {
  test("loads four quick timers and selects a preset in the ring", async () => {
    const api = mockApi();
    try {
      const view = renderWithQueryClient(<TimersTab />);
      expect(await view.findByText("Tea steep")).toBeInTheDocument();
      expect(view.getByText("A little break")).toBeInTheDocument();
      expect(view.getAllByText("Focus session").length).toBeGreaterThan(0);
      expect(view.getByText("Deep work")).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Select Tea steep, 4 min" }));
      expect(view.getByText("04:00")).toBeInTheDocument();
    } finally { api.restore(); }
  });

  test("starts selected preset, extends, resets, and displays another running timer", async () => {
    const api = mockApi();
    const running = [
      { id: "timer-one", kind: "timer" as const, text: "Tea", at: new Date(Date.now() + 60_000).toISOString(), total_seconds: 120 },
      { id: "timer-two", kind: "timer" as const, text: "Break", at: new Date(Date.now() + 120_000).toISOString(), total_seconds: 180 },
    ];
    try {
      const view = renderWithQueryClient(<TimersTab running={running} />);
      await view.findByText("Quick timers");
      fireEvent.click(view.getByRole("button", { name: "Select Focus session, 25 min" }));
      fireEvent.click(view.getByRole("button", { name: "Start" }));
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/api/coming-up/timers") && call.method === "POST" && (call.body as { label: string }).label === "Focus session")).toBe(true));
      fireEvent.click(view.getByRole("button", { name: "+1 min" }));
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/timer-one/extend"))).toBe(true));
      expect(view.getByRole("button", { name: /Select Break/ })).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Reset" }));
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/timer-one/done"))).toBe(true));
    } finally { api.restore(); }
  });

  test("quick timer add, rename and delete use their routes", async () => {
    const api = mockApi();
    try {
      const view = renderWithQueryClient(<TimersTab />);
      await view.findByText("Deep work");
      fireEvent.pointerDown(view.getByRole("button", { name: "More options for Tea steep" }), { button: 0, ctrlKey: false });
      fireEvent.click(await view.findByText("Rename"));
      fireEvent.change(view.getByLabelText("Name"), { target: { value: "Herbal tea" } });
      fireEvent.click(view.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH" && call.url.includes("/api/quick-timers/tea"))).toBe(true));
      fireEvent.pointerDown(view.getByRole("button", { name: "More options for Deep work" }), { button: 0, ctrlKey: false });
      fireEvent.click(await view.findByText("Delete"));
      fireEvent.click(await view.findByRole("button", { name: "Delete timer" }));
      await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE" && call.url.includes("/api/quick-timers/deep"))).toBe(true));
    } finally { api.restore(); }
  });

  test("uses nonanimated rings with reduced motion", async () => {
    const api = mockApi();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      const view = renderWithQueryClient(<TimersTab />);
      await view.findByText("Quick timers");
      const ring = view.container.querySelector('[data-slot="progress-ring-arc"]');
      expect(ring).toHaveAttribute("data-animated", "false");
    } finally { api.restore(); window.matchMedia = originalMatchMedia; }
  });
});

describe("TimersTab failures", () => {
  function failing(match: (url: string, method: string) => boolean, message: string) {
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (match(url, method)) return Promise.resolve(Response.json({ error: message }, { status: 500 }));
      if (url.endsWith("/api/quick-timers") && method === "GET") return Promise.resolve(Response.json([{ id: "tea", name: "Tea steep", minutes: 4 }]));
      if (url.endsWith("/api/coming-up") && method === "GET") return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ id: "x" }));
    }) as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  test("a failed Start toasts and Start is usable again", async () => {
    toastError.mockClear();
    const restore = failing((url, method) => method === "POST" && url.endsWith("/api/coming-up/timers"), "Home could not start that timer.");
    try {
      const view = renderWithQueryClient(<TimersTab />);
      await view.findAllByText("Tea steep");
      fireEvent.click(view.getByRole("button", { name: "Select Tea steep, 4 min" }));
      fireEvent.click(view.getByRole("button", { name: "Start" }));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Home could not start that timer. Check your connection and try again."));
      await waitFor(() => expect((view.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(false));
    } finally { restore(); }
  });

  test("a failed quick-timer delete toasts and keeps the confirmation open; a failed load shows Retry", async () => {
    toastError.mockClear();
    const restore = failing((_url, method) => method === "DELETE", "Home could not delete that timer.");
    try {
      const view = renderWithQueryClient(<TimersTab />);
      await view.findAllByText("Tea steep");
      fireEvent.pointerDown(view.getByRole("button", { name: "More options for Tea steep" }), { button: 0, ctrlKey: false });
      fireEvent.click(await view.findByText("Delete"));
      fireEvent.click(await view.findByRole("button", { name: "Delete timer" }));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Home could not delete that timer. Check your connection and try again."));
      expect(view.getByTestId("destructive-confirm")).toBeInTheDocument();
    } finally { restore(); }
    const restoreLoad = failing((url, method) => method === "GET" && url.endsWith("/api/quick-timers"), "no");
    try {
      cleanup();
      const view = renderWithQueryClient(<TimersTab />);
      expect(await view.findByText("Could not load quick timers. Check your connection and try again.")).toBeInTheDocument();
      expect(view.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    } finally { restoreLoad(); }
  });
});
