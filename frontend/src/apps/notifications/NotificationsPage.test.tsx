import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NotificationsPage } from "@/apps/notifications/NotificationsPage";
import { NOTIFICATIONS_HISTORY_QUERY_KEY } from "@/shell/NotificationBell";
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
    subjectTurnId: null,
    memoryIds: null,
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
  onDismissMany: (body: { ids: string[] } | { all: true }) => void = () => {},
): () => void {
  let items = history;
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/notifications/dismiss") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { ids: string[] } | { all: true };
      const ids = "all" in body ? items.filter((n) => !n.dismissedAt).map((n) => n.id) : body.ids;
      onDismissMany(body);
      let count = 0;
      items = items.map((n) => {
        if (ids.includes(n.id) && !n.dismissedAt) {
          count++;
          return { ...n, dismissedAt: new Date().toISOString() };
        }
        return n;
      });
      return Promise.resolve(new Response(JSON.stringify({ count }), { status: 200 }));
    }
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

  // Lane 15: "Clear all" now calls the real bulk route
  // (POST /api/notifications/dismiss) once with { ids }, the exact set
  // of pending rows this page's own 30-day window shows - not a
  // client-side loop over the per-item route (the shape this page used
  // before that route existed), and not { all: true } (which would
  // reach pending rows outside this page's own window too).
  test("clear all sends one { ids } call for every still-pending row, leaving already-dismissed ones alone", async () => {
    const bodies: Array<{ ids: string[] } | { all: true }> = [];
    const restore = stubFetch(
      [
        notification({ id: "notif-1", text: "First" }),
        notification({ id: "notif-2", text: "Second" }),
        notification({ id: "notif-3", text: "Already gone", dismissedAt: new Date().toISOString() }),
      ],
      undefined,
      (body) => bodies.push(body),
    );
    try {
      const { findByRole, queryByRole } = renderPage();
      fireEvent.click(await findByRole("button", { name: "Clear all" }));
      await waitFor(() => expect(queryByRole("button", { name: "Clear all" })).toBeNull());
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toEqual({ ids: ["notif-1", "notif-2"] });
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

  // Lane 15's other half: multi-select (Jesse's standing rule, batch
  // delete everywhere) - checkboxes on pending rows only (a dismissed
  // row has nothing left to select it for), a select-all, one Dismiss
  // selected control calling the same bulk route as Clear all.
  describe("multi-select", () => {
    test("Select mode shows a checkbox per pending row, none on an already-dismissed one", async () => {
      const restore = stubFetch([
        notification({ id: "notif-1", text: "First" }),
        notification({ id: "notif-2", text: "Already gone", dismissedAt: new Date().toISOString() }),
      ]);
      try {
        const { findByRole, getByLabelText, queryByLabelText } = renderPage();
        fireEvent.click(await findByRole("button", { name: "Select" }));
        expect(getByLabelText("Select First")).toBeInTheDocument();
        expect(queryByLabelText("Select Already gone")).toBeNull();
      } finally {
        restore();
      }
    });

    test("selecting rows and choosing Dismiss selected sends exactly those ids", async () => {
      const bodies: Array<{ ids: string[] } | { all: true }> = [];
      const restore = stubFetch(
        [
          notification({ id: "notif-1", text: "First" }),
          notification({ id: "notif-2", text: "Second" }),
          notification({ id: "notif-3", text: "Third" }),
        ],
        undefined,
        (body) => bodies.push(body),
      );
      try {
        const { findByRole, getByRole, getByLabelText } = renderPage();
        fireEvent.click(await findByRole("button", { name: "Select" }));
        fireEvent.click(getByLabelText("Select First"));
        fireEvent.click(getByLabelText("Select Third"));
        fireEvent.click(getByRole("button", { name: "Dismiss selected" }));
        await waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0]).toEqual({ ids: ["notif-1", "notif-3"] });
      } finally {
        restore();
      }
    });

    test("select-all selects every pending row, and toggling it again clears the selection", async () => {
      const restore = stubFetch([
        notification({ id: "notif-1", text: "First" }),
        notification({ id: "notif-2", text: "Second" }),
      ]);
      try {
        const { findByRole, getByRole, getByLabelText } = renderPage();
        fireEvent.click(await findByRole("button", { name: "Select" }));
        fireEvent.click(getByLabelText("Select all"));
        expect(getByRole("checkbox", { name: "Select First" })).toBeChecked();
        expect(getByRole("checkbox", { name: "Select Second" })).toBeChecked();
        expect(getByRole("toolbar", { name: "Batch actions" })).toHaveTextContent("2 selected");

        fireEvent.click(getByLabelText("Select all"));
        expect(getByRole("checkbox", { name: "Select First" })).not.toBeChecked();
      } finally {
        restore();
      }
    });

    test("Dismiss selected is disabled with nothing selected", async () => {
      const restore = stubFetch([notification({ id: "notif-1", text: "First" })]);
      try {
        const { findByRole, getByRole } = renderPage();
        fireEvent.click(await findByRole("button", { name: "Select" }));
        expect(getByRole("button", { name: "Dismiss selected" })).toBeDisabled();
      } finally {
        restore();
      }
    });

    test("Done leaves select mode without dismissing anything", async () => {
      const restore = stubFetch([notification({ id: "notif-1", text: "First" })]);
      try {
        const { findByRole, getByRole, getByLabelText, queryByRole } = renderPage();
        fireEvent.click(await findByRole("button", { name: "Select" }));
        fireEvent.click(getByLabelText("Select First"));
        fireEvent.click(getByRole("button", { name: "Done" }));
        expect(queryByRole("button", { name: "Dismiss selected" })).toBeNull();
        expect(getByRole("button", { name: "Select" })).toBeInTheDocument();
      } finally {
        restore();
      }
    });

    // A review caught the header row collapsing to nothing (BatchBar
    // was gated on pending.length > 0, same as Select/Clear all) the
    // moment every pending row disappeared while still in select mode -
    // the bell's own "Dismiss all", another tab, or a poll landing
    // mid-selection all reach this - leaving no "Done" button and no
    // way out of select mode at all short of a reload.
    test("Done stays reachable even if every pending row disappears while still in select mode", async () => {
      const restore = stubFetch([notification({ id: "notif-1", text: "First" })]);
      try {
        const { findByRole, getByRole, getByLabelText, queryClient } = renderPage();
        fireEvent.click(await findByRole("button", { name: "Select" }));
        fireEvent.click(getByLabelText("Select First"));

        queryClient.setQueryData(
          NOTIFICATIONS_HISTORY_QUERY_KEY,
          [{ ...notification({ id: "notif-1", text: "First" }), dismissedAt: new Date().toISOString() }],
        );

        await waitFor(() => expect(getByRole("button", { name: "Done" })).toBeInTheDocument());
      } finally {
        restore();
      }
    });
  });
});
