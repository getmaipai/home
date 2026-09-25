import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextEnginesPage } from "@/next/pages/NextEnginesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { expectHomeTablesWithoutDemoOrActions } from "@/tests/expectHomeTables";
import type { EnginesOverview, EnginesHealth, StackRoleInfo, StackEngineInfo, StackHealthItem } from "@/lib/api";

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
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/engines/health")) return Promise.resolve(Response.json(health));
    if (url.includes("/api/engines")) return Promise.resolve(Response.json(overview));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextEnginesPage", () => {
  test("no Stack configured: the honest empty state, never an error", async () => {
    const restore = mockEnginesFetch({ configured: false, roles: [], engines: [], budget: null }, { configured: false, health: [] });
    try {
      renderWithQueryClient(<NextEnginesPage />);
      await waitFor(() => expect(document.body.textContent).toContain("No Stack configured"));
      expect(document.body.textContent).not.toContain("Could not load engines.");
    } finally {
      restore();
    }
  });

  test("a configured Stack: real roles, engines and health rows", async () => {
    const restore = mockEnginesFetch(
      {
        configured: true,
        roles: [makeRole({ label: "Chat", state: { state: "ready", since: "2026-09-21T00:00:00Z" }, model: { id: "qwen3-8b-instruct", sizeBytes: null, measuredFootprintBytes: null, measuredContextLength: null, estimated: true } })],
        engines: [makeEngine({ label: "llama.cpp server", currentTag: "b10797", state: "current" })],
        budget: { totalMemoryBytes: 1, capBytes: 1, freeMemoryBytes: 1, availablePercent: 50, pressure: "normal", memoryReadingDegraded: false, loaded: [], queue: [] },
      },
      { configured: true, health: [makeHealthItem({ title: "The chat engine crashed", severity: "critical" })] },
    );
    try {
      renderWithQueryClient(<NextEnginesPage />);
      await waitFor(() => expect(document.body.textContent).toContain("Chat"));
      expect(document.body.textContent).toContain("Ready");
      expect(document.body.textContent).toContain("qwen3-8b-instruct");
      expect(document.body.textContent).toContain("llama.cpp server");
      expect(document.body.textContent).toContain("b10797");
      expect(document.body.textContent).toContain("Current");
      expect(document.body.textContent).toContain("The chat engine crashed");
      expect(document.body.textContent).toContain("Critical");
      expect(document.body.textContent).not.toContain("No Stack configured");
      expectHomeTablesWithoutDemoOrActions(3);
    } finally {
      restore();
    }
  });

  test("a configured Stack with no health issues: the shared table's empty message", async () => {
    const restore = mockEnginesFetch(
      { configured: true, roles: [makeRole()], engines: [makeEngine()], budget: { totalMemoryBytes: 1, capBytes: 1, freeMemoryBytes: 1, availablePercent: 90, pressure: "normal", memoryReadingDegraded: false, loaded: [], queue: [] } },
      { configured: true, health: [] },
    );
    try {
      renderWithQueryClient(<NextEnginesPage />);
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
    const restore = mockEnginesFetch(
      {
        configured: true,
        roles: [],
        engines: [makeEngine({ label: "llama.cpp server", state: "current", needsRestart: true, stateReason: null })],
        budget: { totalMemoryBytes: 1, capBytes: 1, freeMemoryBytes: 1, availablePercent: 50, pressure: "normal", memoryReadingDegraded: false, loaded: [], queue: [] },
      },
      { configured: true, health: [] },
    );
    try {
      renderWithQueryClient(<NextEnginesPage />);
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
      renderWithQueryClient(<NextEnginesPage />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
