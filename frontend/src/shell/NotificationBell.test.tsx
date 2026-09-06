import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationBell } from "@/shell/NotificationBell";
import { ToastProvider } from "@/kit/primitives/Toast";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { NotificationDeliveryView } from "@/lib/api";

afterEach(cleanup);

function renderBell() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ToastProvider>
        <NotificationBell />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function notification(id: string, text: string): NotificationDeliveryView {
  return {
    id,
    typeId: "model.download_ready",
    text,
    channels: ["in_app"],
    createdAt: "2026-09-05T00:00:00.000Z",
    readAt: null,
    dismissedAt: null,
  };
}

function stubFetch(byPath: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(new Response(JSON.stringify(match[1]), { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("NotificationBell", () => {
  test("shows the pending count and lists each notification", async () => {
    const restore = stubFetch({ "/api/notifications": [notification("n1", "Model download ready")] });
    try {
      const { findByRole, getByText } = renderBell();
      const button = await findByRole("button", { name: /Notifications \(1 pending\)/ });
      fireEvent.click(button);
      expect(getByText("Model download ready")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("dismissing removes it from the pending list, without waiting for the next poll", async () => {
    // Stateful, not a fixed fixture: dismissMutation's own `onSettled`
    // invalidates and refetches this same query (the standard optimistic-
    // update-plus-reconcile pattern, needed to close the real race a code
    // review, 2026-09-05, found against `refetchInterval`) - a stub that
    // always returns the same array regardless of the dismiss call would
    // undo the optimistic removal the moment that refetch lands.
    let dismissed = false;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/notifications/n1/dismiss")) {
        dismissed = true;
        return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      }
      if (url.includes("/api/notifications")) {
        return Promise.resolve(
          new Response(JSON.stringify(dismissed ? [] : [notification("n1", "Model download ready")]), {
            status: 200,
          }),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, getByRole, getByText, queryByText } = renderBell();
      fireEvent.click(await findByRole("button", { name: /Notifications/ }));
      getByText("Model download ready");
      fireEvent.click(getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(queryByText("Model download ready")).toBeNull());
    } finally {
      globalThis.fetch = original;
    }
  });

  test("dismissing here also invalidates NotificationsPage's own history cache, not just this popover's", async () => {
    // The regression this guards: an earlier version's dismissMutation
    // only invalidated its own ["notifications"] query - dismissing the
    // same notification here while /notifications was already open
    // (its history query mounted and cached) left that page showing a
    // stale, still-live Dismiss button until an unrelated remount (a
    // code review, 2026-09-06).
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/dismiss")) return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      if (url.includes("/api/notifications")) {
        return Promise.resolve(new Response(JSON.stringify([notification("n1", "Model download ready")]), { status: 200 }));
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, getByRole, queryClient } = renderBell();
      const invalidateSpy = mock(queryClient.invalidateQueries.bind(queryClient));
      queryClient.invalidateQueries = invalidateSpy;
      fireEvent.click(await findByRole("button", { name: /Notifications/ }));
      fireEvent.click(getByRole("button", { name: "Dismiss" }));
      await waitFor(() =>
        expect(invalidateSpy.mock.calls.some((call) => (call[0] as { queryKey: string[] }).queryKey[0] === "notifications-history")).toBe(
          true,
        ),
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  // The "seen" tracking (kit/primitives/Toast.tsx's push()) has to treat
  // whatever is pending on first load as history, not a flood of toasts
  // the moment the page opens - and still fire one the moment a genuinely
  // new row shows up on a later poll. Drives the second poll directly
  // through the query cache rather than waiting a real 15s for
  // `refetchInterval`.
  test("a notification absent from the first load triggers a toast once it appears", async () => {
    const restore = stubFetch({ "/api/notifications": [notification("n1", "Already here")] });
    try {
      const { findByRole, getByText, queryClient } = renderBell();
      await findByRole("button", { name: /Notifications \(1 pending\)/ });

      queryClient.setQueryData(
        ["notifications"],
        [notification("n1", "Already here"), notification("n2", "A new arrival")],
      );

      await waitFor(() => expect(getByText("A new arrival")).toBeInTheDocument());
    } finally {
      restore();
    }
  });
});
