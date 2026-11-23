// CHAT-CALM-ERRORS-01d (design data-scratch/research/chat-calm-errors.md
// sections 4 and 6): the header pill names the part and stays amber while
// chat is paused, turns red only once the Stack gave up, never pings on a
// failure, and stays out of a child's way; the bell's count is neutral unless
// something urgent is waiting.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatusIndicator } from "@/shell/StatusIndicator";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import { paintsRed } from "../../tests/paintsRed";

afterEach(async () => {
  cleanup();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
});

type AppState = "operational" | "degraded" | "down";
function app(id: string, name: string, state: AppState, reason: string | null, paused = state === "degraded") {
  return { id, name, state, reason, paused, history: [], uptimePercent: 100 };
}

function stubApps(apps: unknown[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/status/apps")) return Promise.resolve(Response.json(apps));
    return Promise.resolve(Response.json({ note: null, maintenance: [] }));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe("the header pill while chat is paused or down", () => {
  test("paused: one amber 'Chat paused' pill with no ping", async () => {
    const restore = stubApps([app("chat", "Chat", "degraded", "Chat is paused.")]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await view.findByRole("link", { name: "Chat paused" });
      expect(link.querySelector('[data-status="degraded"]')).toBeTruthy();
      expect(link.querySelector(".animate-ping")).toBeNull();
      expect(paintsRed(link)).toBeNull();
      expect(link.getAttribute("title")).toBe("Chat is paused.");
    } finally { restore(); }
  });

  test("chat degraded for another reason (an optional part down) is not called paused", async () => {
    const restore = stubApps([app("chat", "Chat", "degraded", "Chat's optional features may be unavailable.", false)]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      expect(await view.findByRole("link", { name: "Degraded" })).toBeTruthy();
    } finally { restore(); }
  });

  test("down past the recovery window: 'Chat is down' in red, still no ping", async () => {
    const restore = stubApps([app("chat", "Chat", "down", "Chat isn't working: MaiPai's AI isn't running.")]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      const link = await view.findByRole("link", { name: "Chat is down" });
      expect(link.querySelector('[data-status="offline"]')).toBeTruthy();
      expect(link.querySelector(".animate-ping")).toBeNull();
    } finally { restore(); }
  });

  test("more than one part affected keeps the general wording", async () => {
    const restore = stubApps([app("chat", "Chat", "down", "Chat isn't working."), app("library", "Library", "down", "Library isn't working.")]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator /></MemoryRouter>);
      expect(await view.findByRole("link", { name: "Something is down" })).toBeTruthy();
    } finally { restore(); }
  });

  test("a child sees no pill while something is paused or down; their composer line is their one signal", async () => {
    const restore = stubApps([app("chat", "Chat", "degraded", "Chat is paused.")]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator child /></MemoryRouter>);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      expect(view.queryByRole("link")).toBeNull();
    } finally { restore(); }
  });

  test("a child still sees the calm 'All good' pill", async () => {
    const restore = stubApps([app("chat", "Chat", "operational", null)]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><StatusIndicator child /></MemoryRouter>);
      expect(await view.findByRole("link", { name: "All good" })).toBeTruthy();
    } finally { restore(); }
  });
});
