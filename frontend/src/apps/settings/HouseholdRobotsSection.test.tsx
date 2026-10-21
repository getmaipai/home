import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HouseholdRobotsSection } from "./HouseholdRobotsSection";

const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

function renderRobot(software: unknown) {
  const robot = { id: "device-test", kind: "robot", name: "Rivet", area: "Kitchen", lastSeenAt: null, createdAt: "2026-10-20T00:00:00.000Z", capabilities: [] };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/devices/robots")) return Response.json([robot]);
    if (url.includes("/install-status")) return Response.json({ hosted: true, enrollment_pending: false });
    if (url.includes("/software")) return Response.json(software);
    if (url.includes("/api/voice/voices")) return Response.json({ voices: [] });
    if (url.includes("/companion")) return Response.json({ controls: "child", companion_id: "", companions: [], home_location_set: true, speaking: { voice_id: "default", source: "home" } });
    return Response.json([]);
  }) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/?device=device-test"]}><Routes><Route path="/" element={<HouseholdRobotsSection />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("robot software details", () => {
  test("shows recorded firmware and running Bot versions with their current badges", async () => {
    const view = renderRobot({ firmware: { installed: { version: "0.2.24", at: "2026-10-21T12:00:00.000Z" }, available: "0.2.24", status: "up_to_date" }, bot: { running: "0.2.24", available: "0.2.24", status: "up_to_date" } });
    await waitFor(() => expect(view.getAllByText("Up to date")).toHaveLength(2));
    expect(view.getByText(/Installed 0\.2\.24, recorded/)).toBeTruthy();
    expect(view.getByText("0.2.24. Ready: 0.2.24.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Update firmware" })).toBeNull();
  });

  test("shows the unrecorded state and offers Update firmware only when an update is available", async () => {
    const view = renderRobot({ firmware: { installed: { version: "0.2.9", at: "2026-10-20T12:00:00.000Z" }, available: "0.2.24", status: "update_available" }, bot: { running: "0.2.9", available: "0.2.24", status: "restart_needed" } });
    await waitFor(() => expect(view.getByText(/Installed 0\.2\.9, recorded/)).toBeTruthy());
    expect(view.getByText("Update available")).toBeTruthy();
    expect(view.getByText("Restart needed")).toBeTruthy();
    expect(view.getByRole("button", { name: "Update firmware" })).toBeTruthy();
  });

  test("does not show Update firmware when firmware is current or unknown", async () => {
    const view = renderRobot({ firmware: { installed: null, available: "0.2.24", status: "unknown" }, bot: { running: null, available: "0.2.24", status: "unknown" } });
    await waitFor(() => expect(view.getByText(/Not recorded\. Ready to install/)).toBeTruthy());
    expect(view.queryByRole("button", { name: "Update firmware" })).toBeNull();
    expect(view.getByText("Not running. Ready: 0.2.24.")).toBeTruthy();
  });
});
