import { afterEach, describe, expect, test, mock } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComingUpPage } from "@/apps/reminders/ComingUpPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function stub(items: Array<{ id: string; kind: "alarm" | "reminder" | "timer"; text: string; at: string }>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/coming-up") && (!init?.method || init.method === "GET")) return Promise.resolve(Response.json(items));
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve(Response.json({ ok: true }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("ComingUpPage", () => {
  test("Coming up shows reminders only", async () => {
    const api = stub([{ id: "t1", kind: "timer", text: "Tea", at: new Date(Date.now() + 60_000).toISOString() }, { id: "r1", kind: "reminder", text: "Milk", at: new Date().toISOString() }, { id: "a1", kind: "alarm", text: "Wake", at: new Date().toISOString() }]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ComingUpPage /></MemoryRouter>);
      expect(await view.findByText("Milk")).toBeInTheDocument();
      expect(view.queryByText("Tea")).toBeNull();
      expect(view.queryByText("Wake")).toBeNull();
    } finally { api.restore(); }
  });

  test("reminder actions work", async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
    const api = stub([{ id: "r1", kind: "reminder", text: "Milk", at: tomorrow }]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ComingUpPage /></MemoryRouter>);
      expect(await view.findByText("Milk")).toBeInTheDocument();
      const headings = view.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
      expect(headings).toEqual(["Tomorrow"]);
      fireEvent.pointerDown(view.getAllByRole("button", { name: "Snooze" })[0]!, { button: 0, ctrlKey: false });
      await waitFor(() => expect(view.getByText("15 minutes")).toBeInTheDocument());
      fireEvent.click(view.getByText("15 minutes"));
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/r1/snooze") && JSON.stringify(call.body).includes("15"))).toBe(true));
      fireEvent.click(view.getAllByRole("button", { name: "Done" })[0]!);
      await waitFor(() => expect(api.calls.some((call) => call.url.endsWith("/r1/done"))).toBe(true));
    } finally { api.restore(); }
  });

  test("shows the plain empty state", async () => {
    const api = stub([]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><ComingUpPage /></MemoryRouter>);
      expect(await view.findByText("No reminders")).toBeInTheDocument();
    } finally { api.restore(); }
  });
});
