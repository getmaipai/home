// CHAT-CALM-ERRORS-01d (design data-scratch/research/chat-calm-errors.md
// sections 4 and 6): the header pill names the part and stays amber while
// chat is paused, turns red only once the Stack gave up, never pings on a
// failure, and stays out of a child's way; the bell's count is neutral unless
// something urgent is waiting.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatusIndicator } from "@/shell/StatusIndicator";
import { NotificationBell } from "@/shell/NotificationBell";
import type { NotificationDeliveryView } from "@/lib/api";
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

function notification(id: string, level: NotificationDeliveryView["level"]): NotificationDeliveryView {
  return { id, typeId: "repairs.new", level, text: "MaiPai Stack is offline", channels: ["in_app"], createdAt: "2026-10-06T00:00:00.000Z", readAt: null, dismissedAt: null, subjectTurnId: null, memoryIds: null, toast: false };
}

function renderBell(items: NotificationDeliveryView[]) {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(Response.json(items))) as unknown as typeof fetch;
  const view = renderWithQueryClient(<MemoryRouter><NotificationBell /></MemoryRouter>);
  return { view, restore: () => { globalThis.fetch = original; } };
}

describe("the bell's count follows how urgent its items are", () => {
  test("a time-sensitive item (a Repairs notice) gets a neutral count, never red", async () => {
    const { view, restore } = renderBell([notification("n1", "time_sensitive")]);
    try {
      const button = await view.findByRole("button", { name: /Notifications \(1 pending\)/ });
      const count = await waitFor(() => { const found = button.querySelector("span.absolute"); expect(found).toBeTruthy(); return found!; });
      expect(count.className).not.toContain("destructive");
      expect(count.className).toContain("bg-foreground");
    } finally { restore(); }
  });

  test("an immediate item keeps the red count", async () => {
    const { view, restore } = renderBell([notification("n1", "immediate")]);
    try {
      const button = await view.findByRole("button", { name: /Notifications \(1 pending\)/ });
      const count = await waitFor(() => { const found = button.querySelector("span.absolute"); expect(found).toBeTruthy(); return found!; });
      expect(count.className).toContain("bg-destructive");
    } finally { restore(); }
  });
});
