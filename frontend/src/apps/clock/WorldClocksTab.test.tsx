import { afterEach, describe, expect, jest, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { WorldClocksTab } from "@/apps/clock/WorldClocksTab";
import { openClockAdd } from "@/apps/clock/clockHeader";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function mockApi(initial: Array<Record<string, unknown>> = []) {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let places = initial;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/api/world-places") && method === "GET") return Promise.resolve(Response.json(places));
    if (url.endsWith("/api/places/local-search?q=Kol")) return Promise.resolve(Response.json([{ name: "Kolkata", country: "India", zone: "Asia/Kolkata" }]));
    if (url.endsWith("/api/world-places") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      places = [...places, { ...body, id: "kolkata", position: places.length }];
      return Promise.resolve(Response.json(places.at(-1)));
    }
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("WorldClocksTab", () => {
  test("shows Home and computes date-line and half-hour offsets", async () => {
    const api = mockApi([
      { id: "auckland", name: "Auckland", country: "New Zealand", zone: "Pacific/Auckland", position: 0 },
      { id: "kolkata", name: "Kolkata", country: "India", zone: "Asia/Kolkata", position: 1 },
    ]);
    const now = new Date("2026-10-30T12:00:00.000Z").valueOf();
    jest.useFakeTimers();
    jest.setSystemTime(now);
    try {
      const view = renderWithQueryClient(<WorldClocksTab homeZone="America/New_York" />);
      await view.findByText("Auckland");
      expect(view.getByText(/17 hours ahead of you · Tomorrow/)).toBeInTheDocument();
      expect(view.getByText(/9 hours 30 minutes ahead of you/)).toBeInTheDocument();
    } finally { api.restore(); jest.useRealTimers(); }
  });

  test("searches and adds a place, then removes and moves saved places", async () => {
    const api = mockApi([
      { id: "london", name: "London", country: "United Kingdom", zone: "Europe/London", position: 0 },
      { id: "tokyo", name: "Tokyo", country: "Japan", zone: "Asia/Tokyo", position: 1 },
    ]);
    try {
      const view = renderWithQueryClient(<WorldClocksTab homeZone="America/New_York" />);
      openClockAdd();
      fireEvent.change(await view.findByLabelText("City"), { target: { value: "Kol" } });
      fireEvent.click(await view.findByRole("button", { name: "Kolkata, India" }));
      await waitFor(() => expect(api.calls.some((call) => call.method === "POST" && call.url.endsWith("/api/world-places"))).toBe(true));
      fireEvent.click(view.getByRole("button", { name: "Move Tokyo up" }));
      await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH" && call.url.includes("/api/world-places/"))).toBe(true));
      fireEvent.click(view.getByRole("button", { name: "Remove London" }));
      await waitFor(() => expect(api.calls.some((call) => call.method === "DELETE" && call.url.includes("/api/world-places/london"))).toBe(true));
    } finally { api.restore(); }
  });

  test("shows the API place limit message", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/world-places") && (!init?.method || init.method === "GET")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/places/local-search")) return Promise.resolve(Response.json([{ name: "Paris", country: "France", zone: "Europe/Paris" }]));
      return Promise.resolve(new Response(JSON.stringify({ error: "You can save up to 12 places." }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }) as typeof fetch;
    try {
      const view = renderWithQueryClient(<WorldClocksTab homeZone="UTC" />);
      openClockAdd();
      fireEvent.change(await view.findByLabelText("City"), { target: { value: "Paris" } });
      fireEvent.click(await view.findByRole("button", { name: "Paris, France" }));
      expect(await view.findByRole("alert")).toHaveTextContent("12 places");
    } finally { globalThis.fetch = originalFetch; }
  });

  test("updates local time on a minute interval", async () => {
    jest.useFakeTimers();
    const api = mockApi([{ id: "london", name: "London", country: "United Kingdom", zone: "Europe/London", position: 0 }]);
    const now = new Date("2026-10-30T12:00:00.000Z").valueOf();
    jest.setSystemTime(now);
    try {
      const view = renderWithQueryClient(<WorldClocksTab homeZone="UTC" />);
      await view.findByRole("heading", { name: "London" });
      const before = view.container.querySelector("time")?.textContent;
      jest.advanceTimersByTime(60_000);
      await waitFor(() => expect(view.container.querySelector("time")?.textContent).not.toBe(before));
    } finally { api.restore(); jest.useRealTimers(); }
  });
});
