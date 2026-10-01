import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatusIndicator } from "@/shell/StatusIndicator";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

afterEach(cleanup);

const appStatus = (state: "operational" | "degraded" | "down" | "waiting_for_internet") => ({ apps: [{
  id: "chat", name: "Chat", state, reason: state === "operational" ? null : "Chat isn't working right now.",
  needs: [{ kind: "engine", id: "chat", name: "Brain", state, required: true }], history: [], uptimePercent: 100,
}] });

describe("StatusIndicator", () => {
  test.each([
    ["operational", "online", "All good"],
    ["degraded", "degraded", "Degraded"],
    ["waiting_for_internet", "degraded", "Degraded"],
    ["down", "offline", "Something is down"],
  ] as const)("renders the %s app state and label", async (state, status, label) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(appStatus(state)));
      return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await waitFor(() => {
        const found = view.getByRole("link", { name: label });
        expect(found.querySelector(`[data-status="${status}"]`)).toBeTruthy();
        return found;
      });
      expect(link.getAttribute("href")).toBe("/status");
      if (state !== "operational") expect(link.getAttribute("title")).toBe("Chat isn't working right now.");
    } finally { globalThis.fetch = originalFetch; }
  });

  test("uses maintenance when all apps are working and a part is under maintenance", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(appStatus("operational")));
      return Promise.resolve(Response.json({ note: null, maintenance: [{ id: "m1", title: "Voice update", description: "", components: ["voice"], starts_at: "2026-09-30T00:00:00Z", ends_at: "2026-10-01T00:00:00Z", status: "in_progress" }] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await view.findByRole("link", { name: "Maintenance" });
      expect(link.querySelector('[data-status="maintenance"]')).toBeTruthy();
    } finally { globalThis.fetch = originalFetch; }
  });
});
