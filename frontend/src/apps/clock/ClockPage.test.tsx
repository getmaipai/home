import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
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
      expect(await view.findByText("Wake")).toBeInTheDocument();
      expect(view.queryByText("Milk")).toBeNull();
      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      expect(await view.findByText("Tea")).toBeInTheDocument();
      expect(view.getByText(/remaining/)).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Done" }));
      expect(api.calls.some((url) => url.endsWith("/t1/done"))).toBe(true);
    } finally { api.restore(); }
  });

  test("shows plain empty states", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ClockPage /></MemoryRouter>);
      expect(await view.findByText("No alarms")).toBeInTheDocument();
      fireEvent.click(view.getByRole("tab", { name: "Timers" }));
      expect(view.getByText("No timers")).toBeInTheDocument();
    } finally { api.restore(); }
  });
});
