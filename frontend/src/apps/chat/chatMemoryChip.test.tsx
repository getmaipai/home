import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryUpdatedChip } from "@/apps/chat/chatMemoryChip";
import { NOTIFICATIONS_QUERY_KEY } from "@/shell/NotificationBell";
import type { NotificationDeliveryView } from "@/lib/api";

afterEach(cleanup);

// getmaipai/home#64: a message with no row-level memory_ids yet (a live
// reply, the judge hasn't run) falls back to polling GET /api/notifications
// for a matching memory.updated delivery - every test needs this stubbed,
// even the ones proving the row-level path alone (no live match should
// ever override real row data).
function stubNotifications(deliveries: NotificationDeliveryView[] = []): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/notifications")) return Promise.resolve(new Response(JSON.stringify(deliveries), { status: 200 }));
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function memoryUpdatedDelivery(subjectTurnId: string, memoryIds: string[]): NotificationDeliveryView {
  return {
    id: "notif-abc123",
    typeId: "memory.updated",
    text: "I remembered: something",
    channels: ["in_app"],
    createdAt: "2026-09-13T00:00:00.000Z",
    readAt: null,
    dismissedAt: null,
    subjectTurnId,
    memoryIds,
  };
}

const NEVER_RUNS: ChatModelAdapter = {
  async *run() {
    /* never invoked - the message under test is seeded via initialMessages */
  },
};

function replyMessage(memoryIds?: string[]): ThreadMessageLike {
  return {
    id: "reply-1",
    role: "assistant",
    content: "MaiPai's reply",
    metadata: { custom: { turnId: "turn-1", ...(memoryIds ? { memoryIds } : {}) } },
  };
}

function ChipUnderTest({ message }: { message: ThreadMessageLike }) {
  const runtime = useLocalRuntime(NEVER_RUNS, { initialMessages: [message] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages>{() => <MemoryUpdatedChip />}</ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function renderChip(message: ThreadMessageLike) {
  return renderWithQueryClient(
    <MemoryRouter>
      <ChipUnderTest message={message} />
    </MemoryRouter>,
  );
}

describe("MemoryUpdatedChip", () => {
  test("shows when this message's own history row carried real memory_ids", async () => {
    const restore = stubNotifications();
    try {
      const { findByText, findByRole } = renderChip(replyMessage(["mem-1", "mem-2"]));
      await findByText("Memory updated");
      const link = await findByRole("link", { name: /Memory updated/ });
      expect(link.getAttribute("href")).toBe("/memory?ids=mem-1,mem-2");
    } finally {
      restore();
    }
  });

  test("stays hidden when the message carries an empty memory_ids list and no live delivery matches either", async () => {
    const restore = stubNotifications();
    try {
      const { queryByText } = renderChip(replyMessage([]));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
    } finally {
      restore();
    }
  });

  test("stays hidden when the message has no memoryIds metadata and no live delivery matches", async () => {
    const restore = stubNotifications();
    try {
      const { queryByText } = renderChip(replyMessage(undefined));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
    } finally {
      restore();
    }
  });

  // getmaipai/home#64: the judge runs AFTER the turn - a live reply's own
  // metadata has no memory_ids at the moment it's rendered, so the chip
  // has to find out some other way once the judge finishes. This is that
  // path: a memory.updated delivery arrives (GET /api/notifications) whose
  // subjectTurnId matches this message's own turnId.
  test("shows via the live notifications poll when the judge finishes after the message already rendered", async () => {
    const restore = stubNotifications([memoryUpdatedDelivery("turn-1", ["mem-live-1"])]);
    try {
      const { findByText, findByRole } = renderChip(replyMessage(undefined));
      await findByText("Memory updated");
      const link = await findByRole("link", { name: /Memory updated/ });
      expect(link.getAttribute("href")).toBe("/memory?ids=mem-live-1");
    } finally {
      restore();
    }
  });

  test("ignores a memory.updated delivery for a DIFFERENT turn", async () => {
    const restore = stubNotifications([memoryUpdatedDelivery("turn-other", ["mem-other"])]);
    try {
      const { queryByText } = renderChip(replyMessage(undefined));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
    } finally {
      restore();
    }
  });

  // A code review (2026-09-13) caught the chip un-rendering itself: once
  // it found its ids via the live poll, NotificationBell.tsx's own
  // dismiss optimistically filters that same delivery out of the shared
  // NOTIFICATIONS_QUERY_KEY cache this chip also reads, so the very next
  // render's find() would miss and the chip already on screen would
  // vanish - dismissing the toast should never take back what the
  // transcript already showed.
  test("stays shown once found via the live poll, even if that delivery later disappears from the shared cache (a dismiss)", async () => {
    const restore = stubNotifications([memoryUpdatedDelivery("turn-1", ["mem-live-1"])]);
    try {
      const { findByText, queryClient } = renderChip(replyMessage(undefined));
      await findByText("Memory updated");

      // Simulates NotificationBell.tsx's dismissMutation onMutate: an
      // optimistic removal from the exact same query key, before any
      // network round trip completes.
      queryClient.setQueryData<NotificationDeliveryView[]>(NOTIFICATIONS_QUERY_KEY, []);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryClient.getQueryData<NotificationDeliveryView[]>(NOTIFICATIONS_QUERY_KEY)).toEqual([]); // the dismiss really landed in the cache
      await findByText("Memory updated"); // the chip itself never noticed
    } finally {
      restore();
    }
  });

  test("prefers the message's own row data over a live delivery, never polling once it's already known", async () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      fetchCalled = true;
      return Promise.reject(new Error("should never be called"));
    }) as unknown as typeof fetch;
    try {
      const { findByText } = renderChip(replyMessage(["mem-row-1"]));
      await findByText("Memory updated");
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
