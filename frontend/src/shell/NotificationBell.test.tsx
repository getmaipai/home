import { describe, expect, test, mock, afterEach } from "bun:test";
import { act, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NotificationToaster, notificationLine } from "@/shell/NotificationBell";
import { activateLocale } from "@/i18n";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { renderWithQueryClient } from "../../tests/renderWithQueryClient";
import type { NotificationDeliveryView } from "@/lib/api";

afterEach(async () => {
  cleanup();
  // getmaipai/home#123: Radix Popper schedules its own position update
  // (ResizeObserver/rAF) after the popover this file opens in several
  // tests; a click late in one test can still have that callback
  // pending at `cleanup()`, and without this flush it fires on the
  // FIRST tick of the NEXT test instead - landing on a stale fiber
  // outside `act()` (the "update to ForwardRef(PopperContent) was not
  // wrapped in act(...)" warning this surfaced as) and, once observed,
  // turning that next test's own `waitFor()` into a genuine hang
  // (bun's 5000ms per-test timeout) rather than a normal pass or
  // assertion failure. One flushed tick here, attributed to the test
  // that scheduled it, is enough - no real timer (react-query's own
  // 15s refetchInterval) is touched or cancelled, only pending
  // microtasks/macrotasks already queued are allowed to run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

// AppShell.tsx mounts both together now (HOME-UI-02f: the toast effect
// moved out of NotificationBell into its own NotificationToaster, split
// out so a toast still fires on phone even though the phone header
// fold hides the bell icon itself there - AppShell mounts
// NotificationToaster unconditionally, regardless of viewport, while
// NotificationBell stays desktop-only). Rendering both here matches
// real desktop composition, where this file's own toast assertions are
// exercised.
function renderBell() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ToastProvider>
        <NotificationToaster />
      </ToastProvider>
    </MemoryRouter>,
  );
}

// getmaipai/home#109: `toast` is declared once on NotificationType
// (backend/src/lib/notificationTypes.ts) and carried on the delivery
// view; the bell reads it directly instead of string-matching.
function notification(id: string, text: string, opts?: { typeId?: string; toast?: boolean; values?: Record<string, string> }): NotificationDeliveryView {
  return {
    id,
    typeId: opts?.typeId ?? "model.download_ready",
    level: opts?.typeId === "engines.problem" ? "time_sensitive" : "passive",
    text,
    values: opts?.values ?? null,
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

describe("NotificationToaster", () => {
  // ACTIVITY-PAGE-01: the bell leads to the Activity page, and a "clip ready" row opens its result (existing notification type).
  // The "seen" tracking (kit/primitives/Toast.tsx's push()) has to treat
  // whatever is pending on first load as history, not a flood of toasts
  // the moment the page opens - and still fire one the moment a genuinely
  // new row shows up on a later poll. Drives the second poll directly
  // through the query cache rather than waiting a real 15s for
  // `refetchInterval`.
  test("a notification absent from the first load triggers a toast once it appears", async () => {
    const restore = stubFetch({ "/api/notifications": [notification("n1", "Already here")] });
    try {
      const { getByText, queryClient } = renderBell();
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());

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
  test("a memory.updated arrival never toasts", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { queryByText, queryClient } = renderBell();
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());

      queryClient.setQueryData(["notifications"], [notification("n1", "I remembered: the wifi password", { typeId: "memory.updated", toast: false })]);

      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      // No toast: the popover is still closed here, so the only way this
      // text could be findable is a toast, exactly the assertion the test
      // above makes in reverse.
      expect(queryByText("I remembered: the wifi password")).toBeNull();
    } finally {
      restore();
    }
  });

  // getmaipai/home#109: the toast decision is declared once on
  // NotificationType (backend/src/lib/notificationTypes.ts) and carried
  // on the delivery view; the bell reads `toast` directly instead of
  // string-matching its own copy of the registry.
  test("a delivery with toast: false does not fire a toast", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { queryByText, queryClient } = renderBell();
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());

      queryClient.setQueryData(["notifications"], [notification("n1", "I remembered: trash day is Tuesday", { typeId: "memory.updated", toast: false })]);

      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      // No toast: the popover is still closed, so the only way this text
      // could be findable is a toast - the same assertion the memory.updated
      // test above makes, but driven by the `toast` field rather than the
      // typeId string.
      expect(queryByText("I remembered: trash day is Tuesday")).toBeNull();
    } finally {
      restore();
    }
  });

  test("a delivery with toast: true fires a toast when it arrives after the first load", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { getByText, queryClient } = renderBell();
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());

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
      const { getByText, queryClient } = renderBell();
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());

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
  // The exact regression a code review caught on HOME-UI-02f: the phone
  // header fold hides NotificationBell (the only place the toast effect
  // used to live) behind PhoneAvatarMenu instead, so a toast on phone
  // depends entirely on NotificationToaster working with no
  // NotificationBell mounted anywhere - not just alongside it, the way
  // every other test above renders both.
  test("NotificationToaster fires a toast with no NotificationBell mounted at all", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { getByText, queryClient } = renderWithQueryClient(
        <MemoryRouter>
          <ToastProvider>
            <NotificationToaster />
          </ToastProvider>
        </MemoryRouter>,
      );
      // No bell button to await here - give the first load a tick to
      // seed seenIds before the "new" arrival below.
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());

      queryClient.setQueryData(["notifications"], [notification("n1", "Qwen3 8B finished downloading and is ready to use.", { toast: true })]);

      await waitFor(() => expect(getByText("Qwen3 8B finished downloading and is ready to use.")).toBeInTheDocument());
    } finally {
      restore();
    }
  });

  test("alarm due notifications stay out of the courtesy toast", async () => {
    const restore = stubFetch({ "/api/notifications": [] });
    try {
      const { queryByText, queryClient } = renderWithQueryClient(
        <MemoryRouter><ToastProvider><NotificationToaster /></ToastProvider></MemoryRouter>,
      );
      await waitFor(() => expect(queryClient.getQueryData(["notifications"])).toBeDefined());
      queryClient.setQueryData(["notifications"], [notification("alarm-n1", "Alarm: gym", { typeId: "alarm.due", toast: true })]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Alarm: gym")).toBeNull();
    } finally { restore(); }
  });
});

// I18N-B1: a typed notification renders from { typeId, values } in the viewer's language; anything else shows its stored English text.
describe("notificationLine", () => {
  afterEach(async () => { await activateLocale("en-US"); });
  test("a Spanish viewer sees the typed line in Spanish and an English viewer sees English", async () => {
    const row = notification("n1", "Alarm: gimnasio", { typeId: "alarm.due", values: { task: "gimnasio" } });
    await activateLocale("es");
    expect(notificationLine(row)).toBe("Alarma: gimnasio");
    await activateLocale("en-US");
    expect(notificationLine(row)).toBe("Alarm: gimnasio");
  });
  test("an unlabelled alarm reads Alarm / Alarma, never Alarm: Alarm", async () => {
    const row = notification("n5", "Alarm", { typeId: "alarm.due", values: { task: "Alarm", labelled: "no" } });
    expect(notificationLine(row)).toBe("Alarm");
    await activateLocale("es");
    expect(notificationLine(row)).toBe("Alarma");
  });
  test("a stored English row (no values) or a type with no template still renders its text", async () => {
    await activateLocale("es");
    expect(notificationLine(notification("n2", "Old Model finished downloading and is ready to use."))).toBe("Old Model finished downloading and is ready to use.");
    expect(notificationLine(notification("n3", "Repair title", { typeId: "repairs.new", values: { title: "Repair title" } }))).toBe("Repair title");
  });
  test("a plural follows the count", async () => {
    await activateLocale("es");
    const row = notification("n4", "x", { typeId: "backups.target_failing", values: { target: "NAS", count: "1", message: "m" } });
    expect(notificationLine(row)).toContain("1 vez");
  });
});

// ACTIVITY-MERGE-01: the bell component is gone; only the query helpers and the toaster stay in this module.
describe("module surface", () => {
  test("exports no NotificationBell component", async () => {
    const mod = await import("@/shell/NotificationBell");
    expect("NotificationBell" in mod).toBe(false);
    expect(typeof mod.NotificationToaster).toBe("function");
  });
});
