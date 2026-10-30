import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FreeUpMemory } from "@/apps/settings/FreeUpMemory";
import { CapabilityTable, capabilityWords } from "@/apps/settings/CapabilityTable";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });
const GB = 1024 ** 3;

describe("FreeUpMemory", () => {
  test("says what it would do, runs on the button and reports the result", async () => {
    let posted = false;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split("?")[0]!;
      if (path.endsWith("/api/performance/reclaim") && init?.method === "POST") { posted = true; return Promise.resolve(Response.json({ available: true, unloaded: 2, freed_bytes: 14 * GB })); }
      if (path.endsWith("/api/performance/reclaim")) return Promise.resolve(Response.json({ available: true, models: posted ? 0 : 2, bytes: posted ? 0 : 14 * GB }));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    const view = renderWithQueryClient(<FreeUpMemory />);
    expect(await view.findByText(/Unload 2 idle models, about 14.0 GB/)).toBeTruthy();
    fireEvent.click(view.getByText("Free up memory", { selector: "button" }));
    expect(await view.findByText("Unloaded 2 idle models, about 14.0 GB.")).toBeTruthy();
    await waitFor(() => expect(view.getByText("Nothing idle to unload right now.")).toBeTruthy());
  });
  test("an older Stack hides the card", async () => {
    globalThis.fetch = (() => Promise.resolve(Response.json({ available: false, models: 0, bytes: 0 }))) as unknown as typeof fetch;
    const view = renderWithQueryClient(<FreeUpMemory />);
    await waitFor(() => expect(view.queryByTestId("free-up-memory")).toBeNull());
  });
});

describe("CapabilityTable", () => {
  test("words a tier that does not fit with what it needs, and a missing tier as not offered", () => {
    expect(capabilityWords({ tier: "max", fits: false, needs_bytes: 80 * GB })).toBe("No, needs 80 GB");
    expect(capabilityWords({ tier: "boost", fits: true, needs_bytes: 20 * GB })).toBe("Yes");
    expect(capabilityWords(undefined)).toBe("Not offered");
  });
  test("draws one row per category and hides when the Stack is older", async () => {
    globalThis.fetch = (() => Promise.resolve(Response.json({ available: true, machine_class: "p64", rows: [{ category: "video", label: "Videos", cells: [{ tier: "standard", fits: true, needs_bytes: null }, { tier: "max", fits: false, needs_bytes: 80 * GB }] }] }))) as unknown as typeof fetch;
    const view = renderWithQueryClient(<CapabilityTable path="/api/x" />);
    expect(await view.findByText("Videos")).toBeTruthy();
    expect(view.getByText("No, needs 80 GB")).toBeTruthy();
    cleanup();
    globalThis.fetch = (() => Promise.resolve(Response.json({ available: false, machine_class: "unknown", rows: [] }))) as unknown as typeof fetch;
    const hidden = renderWithQueryClient(<CapabilityTable path="/api/y" />);
    await waitFor(() => expect(hidden.queryByTestId("capability-table")).toBeNull());
  });
});
