import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatusIndicator } from "@/shell/StatusIndicator";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";

afterEach(cleanup);

const baseHealth = {
  brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
  engines: {
    chat: { kind: "selection", pid: null, alive: true },
    embed: { kind: "spawned", pid: null, alive: true },
    background: { kind: "spawned", pid: null, alive: true },
    voice: { kind: "spawned", pid: null, alive: true },
  },
  sidecars: [],
};

describe("StatusIndicator", () => {
  test.each([
    [{ ...baseHealth }, "online", "All good"],
    [{ ...baseHealth, engines: { ...baseHealth.engines, chat: { kind: "starting", pid: null, alive: null } } }, "degraded", "Degraded"],
    [{ ...baseHealth, engines: { ...baseHealth.engines, chat: { kind: "stopped", pid: null, alive: null } } }, "offline", "Something is down"],
  ] as const)("renders the %s state and label", async (health, state, label) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json(health))) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await waitFor(() => {
        const found = view.getByRole("link", { name: label });
        expect(found.querySelector(`[data-status="${state}"]`)).toBeTruthy();
        return found;
      });
      expect(link.getAttribute("href")).toBe("/status");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("lists problem names in the link title", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json({
      ...baseHealth,
      engines: { ...baseHealth.engines, chat: { kind: "failed", pid: null, alive: null } },
      sidecars: [{ id: "kiwix-serve", status: "crashed", baseUrl: null }],
    }))) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await view.findByRole("link", { name: "Something is down" });
      await waitFor(() => expect(link.getAttribute("title")).toContain("Brain, Library"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses the maintenance state while an affected part is under maintenance", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [{ id: "m1", title: "Voice update", description: "", components: ["voice"], starts_at: "2026-09-30T00:00:00Z", ends_at: "2026-10-01T00:00:00Z", status: "in_progress" }] }));
      return Promise.resolve(Response.json({ ...baseHealth, engines: { ...baseHealth.engines, voice: { kind: "stopped", pid: null, alive: null } } }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await view.findByRole("link", { name: "Maintenance" });
      await waitFor(() => expect(link.querySelector('[data-status="maintenance"]')).toBeTruthy());
    } finally { globalThis.fetch = originalFetch; }
  });
});
