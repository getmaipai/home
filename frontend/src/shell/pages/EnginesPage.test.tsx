import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { EnginesPage } from "@/shell/pages/EnginesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { EnginesOverview, EnginesHealth, StackRoleInfo, StackEngineInfo, StackHealthItem, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makeRole(overrides: Partial<StackRoleInfo> = {}): StackRoleInfo {
  return {
    id: "chat",
    label: "Chat",
    wire: "chat",
    residency: "resident",
    endpoints: ["/v1/chat/completions"],
    quality: ["everyday"],
    sharesModelWith: null,
    state: { state: "ready", since: "2026-09-21T00:00:00Z" },
    reason: null,
    model: { id: "qwen3-8b-instruct", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true },
    check: { state: "passed", at: "2026-09-21T00:00:00Z", reason: null, stale: false },
    ...overrides,
  } as StackRoleInfo;
}

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
    ...overrides,
  } as Roster;
}

function makeEngine(overrides: Partial<StackEngineInfo> = {}): StackEngineInfo {
  return {
    id: "llama-server",
    name: "llama-server",
    label: "llama.cpp server",
    platform: "darwin",
    arch: "arm64",
    verified: true,
    installed: true,
    matchesThisMachine: true,
    running: "b10797",
    currentTag: "b10797",
    newestTag: "b10797",
    current: true,
    notCurrent: false,
    needsRestart: false,
    state: "current",
    stateReason: null,
    directory: "/opt/maipai/stack/engines/llama-server",
    roleState: "ready",
    roleReason: null,
    ...overrides,
  } as StackEngineInfo;
}

function makeHealthItem(overrides: Partial<StackHealthItem> = {}): StackHealthItem {
  return {
    code: "engine.crashed.chat",
    severity: "critical",
    title: "The chat engine crashed",
    text: "It stopped responding.",
    since: "2026-09-21T00:00:00.000Z",
    cause: "out of memory",
    ...overrides,
  } as StackHealthItem;
}

function mockEnginesFetch(overview: EnginesOverview, health: EnginesHealth) {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.includes("/api/engines/health")) return Promise.resolve(Response.json(health));
    if (/\/api\/engines\/[^/]+\/(install|start|stop|restart)(?:\?|$)/.test(url)) return Promise.resolve(Response.json({ ok: true }));
    if (url.includes("/api/engines")) return Promise.resolve(Response.json(overview));
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("EnginesPage", () => {
  test("no Stack configured: the honest empty state, never an error", async () => {
    const { restore } = mockEnginesFetch({ configured: false, roles: [], engines: [], budget: null }, { configured: false, health: [] });
    try {
      renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("No Stack configured"));
      expect(document.body.textContent).not.toContain("Could not load engines.");
    } finally {
      restore();
    }
  });

  test("a configured Stack: real roles, engines and health rows", async () => {
    const { restore } = mockEnginesFetch(
      {
        configured: true,
        roles: [makeRole({ label: "Chat", state: { state: "ready", since: "2026-09-21T00:00:00Z" }, model: { id: "qwen3-8b-instruct", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true } })],
        engines: [makeEngine({ label: "llama.cpp server", currentTag: "b10797", state: "current" })],
        budget: { totalMemoryBytes: 1, capBytes: 1, freeMemoryBytes: 1, availablePercent: 50, pressure: "normal", memoryReadingDegraded: false, loaded: [], queue: [] },
      },
      { configured: true, health: [makeHealthItem({ title: "The chat engine crashed", severity: "critical" })] },
    );
    try {
      renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Chat"));
      expect(document.body.textContent).toContain("Ready");
      expect(document.body.textContent).toContain("qwen3-8b-instruct");
      expect(document.body.textContent).toContain("llama.cpp server");
      expect(document.body.textContent).toContain("b10797");
      expect(document.body.textContent).toContain("Current");
      expect(document.body.textContent).toContain("The chat engine crashed");
      expect(document.body.textContent).toContain("Critical");
      expect(document.body.textContent).not.toContain("No Stack configured");
      expect(document.body.textContent).not.toContain("Employee Data Table");
      expect(document.querySelectorAll('[data-slot="data-table"]').length).toBe(3);
      const engineRow = Array.from(document.querySelectorAll('[data-slot="data-table-row"]')).find((row) => row.textContent?.includes("llama.cpp server"))!;
      expect(within(engineRow as HTMLElement).getByRole("button", { name: "More actions" })).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("role sorting is page-controlled and adds no fetch", async () => {
    const { fetchMock, restore } = mockEnginesFetch(
      {
        configured: true,
        roles: [makeRole({ label: "Embedding" }), makeRole({ id: "chat", label: "Chat" })],
        engines: [],
        budget: null,
      },
      { configured: true, health: [] },
    );
    try {
      const view = renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Embedding"));
      const roleTable = view.container.querySelector<HTMLElement>("[aria-label='Engine roles']")!;
      const headerRow = roleTable.querySelector<HTMLElement>("[data-slot='data-table-header-row']")!;
      const roleHeader = within(headerRow).getByRole("columnheader", { name: "Role" });
      expect(roleHeader.getAttribute("aria-sort")).toBe("none");
      fireEvent.click(within(roleHeader).getByRole("button", { name: "Sort by Role" }));
      expect(roleHeader.getAttribute("aria-sort")).toBe("ascending");
      const bodyRows = Array.from(roleTable.querySelectorAll("[data-slot='data-table-body'] [data-slot='data-table-row']"));
      expect(bodyRows[0]?.textContent).toContain("Chat");
      const overviewReads = fetchMock.mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        return url.endsWith("/api/engines");
      });
      expect(overviewReads).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("a configured Stack with no health issues: the shared table's empty message", async () => {
    const { restore } = mockEnginesFetch(
      { configured: true, roles: [makeRole()], engines: [makeEngine()], budget: { totalMemoryBytes: 1, capBytes: 1, freeMemoryBytes: 1, availablePercent: 90, pressure: "normal", memoryReadingDegraded: false, loaded: [], queue: [] } },
      { configured: true, health: [] },
    );
    try {
      renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Chat"));
      expect(document.body.textContent).toContain("No data available.");
    } finally {
      restore();
    }
  });

  // A review finding: the status derivation used to string-match
  // stateReason === "newer installed" instead of reading needsRestart
  // directly - the two fields can disagree, and a real engine reporting
  // needsRestart:true with a state of "current" (mid-transition) must
  // still read "Needs restart", not fall through as if nothing needed
  // attention.
  test("an engine needing a restart reads 'Needs restart' even when its own state says current", async () => {
    const { restore } = mockEnginesFetch(
      {
        configured: true,
        roles: [],
        engines: [makeEngine({ label: "llama.cpp server", state: "current", needsRestart: true, stateReason: null })],
        budget: { totalMemoryBytes: 1, capBytes: 1, freeMemoryBytes: 1, availablePercent: 50, pressure: "normal", memoryReadingDegraded: false, loaded: [], queue: [] },
      },
      { configured: true, health: [] },
    );
    try {
      renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("llama.cpp server"));
      expect(document.body.textContent).toContain("Needs restart");
      expect(document.body.textContent).not.toContain("Update available");
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a non-admin sees the denied message and never fetches engines", async () => {
    const { fetchMock, restore } = mockEnginesFetch({ configured: true, roles: [], engines: [], budget: null }, { configured: true, health: [] });
    try {
      renderWithQueryClient(<EnginesPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage engines."));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(document.body.querySelector('[data-slot="data-table"]')).toBeNull();
    } finally {
      restore();
    }
  });

  test("engine action options follow installed and running state, call the real name and refresh both queries", async () => {
    const engines = [
      makeEngine({ id: "engine-to-install", name: "real-install-name", label: "Install display label", installed: false, running: null, currentTag: null }),
      makeEngine({ id: "engine-stopped", name: "real-stopped-name", label: "Stopped display label", installed: true, running: null }),
      makeEngine({ id: "engine-running", name: "real-running-name", label: "Running display label", installed: true, running: "pid-123" }),
    ];
    const { fetchMock, restore } = mockEnginesFetch(
      { configured: true, roles: [], engines, budget: null },
      { configured: true, health: [] },
    );
    try {
      renderWithQueryClient(<EnginesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Install display label"));

      async function openActions(label: string) {
        const row = Array.from(document.querySelectorAll('[data-slot="data-table-row"]')).find((candidate) => candidate.textContent?.includes(label))!;
        fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "More actions" }));
      }
      async function performAction(label: string, actionLabel: string, name: string, action: string) {
        const beforeOverview = fetchMock.mock.calls.filter(([input]) => {
          const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
          return url.includes("/api/engines") && !url.includes("/health") && !/\/api\/engines\/[^/]+\/(install|start|stop|restart)/.test(url);
        }).length;
        const beforeHealth = fetchMock.mock.calls.filter(([input]) => {
          const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
          return url.includes("/api/engines/health");
        }).length;
        await openActions(label);
        fireEvent.click(await within(document.body).findByRole("menuitem", { name: actionLabel }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining(`/api/engines/${name}/${action}`),
          expect.objectContaining({ method: "POST" }),
        ));
        await waitFor(() => {
          const overviewReads = fetchMock.mock.calls.filter(([input]) => {
            const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
            return url.includes("/api/engines") && !url.includes("/health") && !/\/api\/engines\/[^/]+\/(install|start|stop|restart)/.test(url);
          }).length;
          const healthReads = fetchMock.mock.calls.filter(([input]) => {
            const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
            return url.includes("/api/engines/health");
          }).length;
          expect(overviewReads).toBeGreaterThan(beforeOverview);
          expect(healthReads).toBeGreaterThan(beforeHealth);
        });
        expect(within(document.body).queryByRole("alertdialog")).toBeNull();
      }

      await openActions("Install display label");
      expect(await within(document.body).findByRole("menuitem", { name: "Install" })).toBeTruthy();
      expect(within(document.body).queryByRole("menuitem", { name: "Start" })).toBeNull();
      expect(within(document.body).queryByRole("menuitem", { name: "Stop" })).toBeNull();
      expect(within(document.body).queryByRole("menuitem", { name: "Restart" })).toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });

      await openActions("Stopped display label");
      expect(await within(document.body).findByRole("menuitem", { name: "Start" })).toBeTruthy();
      expect(within(document.body).getByRole("menuitem", { name: "Restart" })).toBeTruthy();
      expect(within(document.body).queryByRole("menuitem", { name: "Stop" })).toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });

      await openActions("Running display label");
      expect(await within(document.body).findByRole("menuitem", { name: "Stop" })).toBeTruthy();
      expect(within(document.body).getByRole("menuitem", { name: "Restart" })).toBeTruthy();
      expect(within(document.body).queryByRole("menuitem", { name: "Start" })).toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });

      await performAction("Install display label", "Install", "real-install-name", "install");
      await performAction("Stopped display label", "Start", "real-stopped-name", "start");
      await performAction("Running display label", "Stop", "real-running-name", "stop");
      await performAction("Running display label", "Restart", "real-running-name", "restart");
    } finally {
      restore();
    }
  });
});
