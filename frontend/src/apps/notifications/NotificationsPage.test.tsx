import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NotificationsPage } from "@/apps/notifications/NotificationsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { NotificationDeliveryView } from "@/lib/api";

afterEach(cleanup);

function notification(overrides: Partial<NotificationDeliveryView> = {}): NotificationDeliveryView {
  return {
    id: "notif-abc123",
    typeId: "repairs.new",
    text: "A repair needs your attention",
    channels: ["in_app"],
    createdAt: new Date().toISOString(),
    readAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function renderPage() {
  return renderWithQueryClient(<NotificationsPage />);
}

function stubFetch(
  history: NotificationDeliveryView[],
  onDismiss: (id: string) => void = () => {},
): () => void {
  let items = history;
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const dismissMatch = url.match(/\/api\/notifications\/([^/]+)\/dismiss$/);
    if (dismissMatch && method === "POST") {
      const [, id] = dismissMatch as [string, string];
      onDismiss(id);
      items = items.map((n) => (n.id === id ? { ...n, dismissedAt: new Date().toISOString() } : n));
      return Promise.resolve(new Response(JSON.stringify({ id }), { status: 200 }));
    }
    if (url.endsWith("/api/notifications/history")) {
      return Promise.resolve(new Response(JSON.stringify(items), { status: 200 }));
    }
    if (url.endsWith("/api/notifications")) {
      return Promise.resolve(new Response(JSON.stringify(items.filter((n) => !n.dismissedAt)), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url} (${method})`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("NotificationsPage", () => {
  test("an empty last-30-days window says so, not a blank page", async () => {
    const restore = stubFetch([]);
    try {
      const { findByText } = renderPage();
      await findByText("Nothing in the last 30 days.");
    } finally {
      restore();
    }
  });

  test("shows a notification's text and state", async () => {
    const restore = stubFetch([notification({ text: "Backups haven't run in a while" })]);
    try {
      const { findByText } = renderPage();
      await findByText("Backups haven't run in a while");
      await findByText("New");
    } finally {
      restore();
    }
  });

  test("a dismissed row shows Dismissed and offers no Dismiss button", async () => {
    const restore = stubFetch([
      notification({ id: "notif-dismissed", text: "Already handled", dismissedAt: new Date().toISOString() }),
    ]);
    try {
      const { findByText, queryByRole } = renderPage();
      await findByText("Already handled");
      await findByText("Dismissed");
      expect(queryByRole("button", { name: /Dismiss Already handled/ })).toBeNull();
    } finally {
      restore();
    }
  });

  test("something older than 30 days doesn't show at all", async () => {
    const restore = stubFetch([notification({ text: "Ancient history", createdAt: daysAgo(45) })]);
    try {
      const { findByText } = renderPage();
      await findByText("Nothing in the last 30 days.");
    } finally {
      restore();
    }
  });

  test("dismissing one row calls the real dismiss route", async () => {
    const dismissed: string[] = [];
    const restore = stubFetch([notification({ id: "notif-1", text: "Fix the sidecar" })], (id) => dismissed.push(id));
    try {
      const { findByRole } = renderPage();
      fireEvent.click(await findByRole("button", { name: "Dismiss Fix the sidecar" }));
      await waitFor(() => expect(dismissed).toEqual(["notif-1"]));
    } finally {
      restore();
    }
  });

  test("clear all dismisses every still-pending row, leaving already-dismissed ones alone", async () => {
    const dismissed: string[] = [];
    const restore = stubFetch(
      [
        notification({ id: "notif-1", text: "First" }),
        notification({ id: "notif-2", text: "Second" }),
        notification({ id: "notif-3", text: "Already gone", dismissedAt: new Date().toISOString() }),
      ],
      (id) => dismissed.push(id),
    );
    try {
      const { findByRole } = renderPage();
      fireEvent.click(await findByRole("button", { name: "Clear all" }));
      await waitFor(() => expect(dismissed.sort()).toEqual(["notif-1", "notif-2"]));
    } finally {
      restore();
    }
  });

  test("clear all disappears once nothing is left pending", async () => {
    const restore = stubFetch([notification({ id: "notif-1", text: "Only one", dismissedAt: new Date().toISOString() })]);
    try {
      const { queryByRole, findByText } = renderPage();
      await findByText("Only one");
      expect(queryByRole("button", { name: "Clear all" })).toBeNull();
    } finally {
      restore();
    }
  });
});
