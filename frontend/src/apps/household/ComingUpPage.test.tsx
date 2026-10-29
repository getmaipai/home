import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComingUpPage } from "@/apps/household/ComingUpPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function stub(items: Array<{ id: string; kind: "alarm" | "reminder" | "timer"; text: string; at: string }>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/coming-up") && !init?.method) return Promise.resolve(Response.json(items));
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve(Response.json({ ok: true }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("ComingUpPage", () => {
  test("renders Today, Tomorrow and Later in order, actions work and timers count down", async () => {
    const now = new Date();
    const today = new Date(now.getTime() + 60_000).toISOString();
    const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
    const later = new Date(now.getTime() + 4 * 86_400_000).toISOString();
    const api = stub([{ id: "t1", kind: "timer", text: "Tea", at: today }, { id: "r1", kind: "reminder", text: "Milk", at: tomorrow }, { id: "a1", kind: "alarm", text: "Wake", at: later }]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ComingUpPage /></MemoryRouter>);
      expect(await view.findByText("Tea")).toBeInTheDocument();
      const headings = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
      expect(headings).toEqual(["Today", "Tomorrow", "Later"]);
      expect(view.getByText(/remaining/)).toBeInTheDocument();
      expect(view.getByRole("tab", { name: "Lists" })).toBeInTheDocument();
      fireEvent.pointerDown(view.getAllByRole("button", { name: "Snooze" })[0]!, { button: 0, ctrlKey: false });
      await waitFor(() => expect(view.getByText("15 minutes")).toBeInTheDocument());
      fireEvent.click(view.getByText("15 minutes"));
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/t1/snooze") && JSON.stringify(call.body).includes("15"))).toBe(true));
      fireEvent.click(view.getAllByRole("button", { name: "Done" })[0]!);
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/t1/done"))).toBe(true));
    } finally { api.restore(); }
  });

  test("shows the plain empty state", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ComingUpPage /></MemoryRouter>);
      expect(await view.findByText("Nothing is coming up.")).toBeInTheDocument();
    } finally { api.restore(); }
  });
});
