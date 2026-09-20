import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationBell } from "@/shell/NotificationBell";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
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

// getmaipai/home#109: `toast` is declared once on NotificationType
// (backend/src/lib/notificationTypes.ts) and carried on the delivery
// view; the bell reads it directly instead of string-matching.
function notification(id: string, text: string, opts?: { typeId?: string; toast?: boolean }): NotificationDeliveryView {
  return {
    id,
    typeId: opts?.typeId ?? "model.download_ready",
    text,
    channels: ["in_app"],
    createdAt: "2026-09-05T00:00:00.000Z",
    readAt: null,
    dismissedAt: null,
    subjectTurnId: null,
    memoryIds: null,
    // Default to true; the memory.updated tests pass `toast: false`.
    toast: opts?.toast ?? true,
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

  // Jesse, 2026-09-13: a memory-saved toast on top of the "Memory
  // updated" chip (chatMemoryChip.tsx) is a redundant second ping for
  // the same event - the chip is the indicator now, this delivery type
  // must never toast, only every other type still does (the test above,
  // which relies on the exact same "toast renders without the popover
  // open" behavior to prove a toast fired at all).
  test("a memory.updated arrival never toasts, but still shows in the pending list", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { findByRole, getByRole, getByText, queryByText, queryClient } = renderBell();
      await findByRole("button", { name: /Notifications$/ });

      queryClient.setQueryData(["notifications"], [notification("n1", "I remembered: the wifi password", { typeId: "memory.updated", toast: false })]);

      // The badge update proves the delivery reached this component at
      // all - if the toast-skip also silently dropped the item, this
      // would hang forever.
      await waitFor(() => expect(getByRole("button", { name: /Notifications \(1 pending\)/ })).toBeInTheDocument());
      // No toast: the popover is still closed here, so the only way this
      // text could be findable is a toast, exactly the assertion the test
      // above makes in reverse.
      expect(queryByText("I remembered: the wifi password")).toBeNull();

      fireEvent.click(getByRole("button", { name: /Notifications \(1 pending\)/ }));
      expect(getByText("I remembered: the wifi password")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  // getmaipai/home#109: the toast decision is declared once on
  // NotificationType (backend/src/lib/notificationTypes.ts) and carried
  // on the delivery view; the bell reads `toast` directly instead of
  // string-matching its own copy of the registry.
  test("a delivery with toast: false is in the pending list but does not fire a toast", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { findByRole, getByRole, getByText, queryByText, queryClient } = renderBell();
      await findByRole("button", { name: /Notifications$/ });

      queryClient.setQueryData(["notifications"], [notification("n1", "I remembered: trash day is Tuesday", { typeId: "memory.updated", toast: false })]);

      await waitFor(() => expect(getByRole("button", { name: /Notifications \(1 pending\)/ })).toBeInTheDocument());
      // No toast: the popover is still closed, so the only way this text
      // could be findable is a toast - the same assertion the memory.updated
      // test above makes, but driven by the `toast` field rather than the
      // typeId string.
      expect(queryByText("I remembered: trash day is Tuesday")).toBeNull();

      fireEvent.click(getByRole("button", { name: /Notifications \(1 pending\)/ }));
      expect(getByText("I remembered: trash day is Tuesday")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("a delivery with toast: true fires a toast when it arrives after the first load", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { findByRole, getByText, queryClient } = renderBell();
      await findByRole("button", { name: /Notifications$/ });

      queryClient.setQueryData(["notifications"], [notification("n1", "Qwen3 8B finished downloading and is ready to use.", { toast: true })]);

      // The toast fires the moment the notification arrives as "new"
      // after the first-load seed. The popover is closed, so the only
      // way the text is findable is the toast.
      await waitFor(() => expect(getByText("Qwen3 8B finished downloading and is ready to use.")).toBeInTheDocument());
    } finally {
      restore();
    }
  });

  test("typeId 'memory.updated' with toast: true DOES fire a toast - the declaration decides, not the string", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { findByRole, getByText, queryClient } = renderBell();
      await findByRole("button", { name: /Notifications$/ });

      queryClient.setQueryData(["notifications"], [notification("n1", "I remembered: trash day is Tuesday", { typeId: "memory.updated", toast: true })]);

      // The bell must toast even though typeId is "memory.updated",
      // because the delivery view carries toast: true. This pins the
      // contract: the declaration on NotificationType is the sole source
      // of truth, not a string check in the frontend.
      await waitFor(() => expect(getByText("I remembered: trash day is Tuesday")).toBeInTheDocument());
    } finally {
      restore();
    }
  });

  // Lane 15 (Jesse's ask from live use): "Dismiss all" for the pending
  // list here.
  test("Dismiss all sends { all: true } and clears the whole pending list, without waiting for the next poll", async () => {
    let sawBody: unknown;
    let dismissedAll = false;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/notifications/dismiss") && init?.method === "POST") {
        sawBody = JSON.parse(String(init.body));
        dismissedAll = true;
        return Promise.resolve(new Response(JSON.stringify({ count: 2 }), { status: 200 }));
      }
      if (url.includes("/api/notifications")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(dismissedAll ? [] : [notification("n1", "First"), notification("n2", "Second")]),
            { status: 200 },
          ),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, getByRole, getByText, queryByText } = renderBell();
      fireEvent.click(await findByRole("button", { name: /Notifications \(2 pending\)/ }));
      getByText("First");
      getByText("Second");
      fireEvent.click(getByRole("button", { name: "Dismiss all" }));
      await waitFor(() => {
        expect(queryByText("First")).toBeNull();
        expect(queryByText("Second")).toBeNull();
        expect(sawBody).toEqual({ all: true });
      }, { timeout: 15_000 });
    } finally {
      globalThis.fetch = original;
    }
  }, 20_000);

  test("Dismiss all also invalidates NotificationsPage's own history cache", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/notifications/dismiss")) return Promise.resolve(new Response(JSON.stringify({ count: 1 }), { status: 200 }));
      if (url.includes("/api/notifications")) return Promise.resolve(new Response(JSON.stringify([notification("n1", "One")]), { status: 200 }));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, getByRole, queryClient } = renderBell();
      const invalidateSpy = mock(queryClient.invalidateQueries.bind(queryClient));
      queryClient.invalidateQueries = invalidateSpy;
      fireEvent.click(await findByRole("button", { name: /Notifications/ }));
      fireEvent.click(getByRole("button", { name: "Dismiss all" }));
      await waitFor(() =>
        expect(invalidateSpy.mock.calls.some((call) => (call[0] as { queryKey: string[] }).queryKey[0] === "notifications-history")).toBe(
          true,
        ),
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
