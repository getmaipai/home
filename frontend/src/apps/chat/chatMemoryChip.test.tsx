import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { MemoryUpdatedChip } from "@/apps/chat/chatMemoryChip";
import type { NotificationDeliveryView } from "@/lib/api";

afterEach(cleanup);

const NEVER_RUNS: ChatModelAdapter = {
  async *run() {
    /* never invoked - the message under test is seeded via initialMessages */
  },
};

function notification(turnId: string, memoryIds: string[]): NotificationDeliveryView & { payload: unknown } {
  return {
    id: `n-${turnId}`,
    typeId: "memory.updated",
    text: "Memory updated",
    channels: ["in_app"],
    createdAt: "2026-09-05T00:00:00.000Z",
    readAt: null,
    dismissedAt: null,
    payload: { conversation_id: "conv-1", turn_id: turnId, memory_ids: memoryIds },
  };
}

function stubNotifications(notifications: NotificationDeliveryView[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/notifications")) {
      return Promise.resolve(new Response(JSON.stringify(notifications), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

function ChipUnderTest() {
  const runtime = useLocalRuntime(NEVER_RUNS, {
    initialMessages: [{ id: "reply-1", role: "assistant", content: "MaiPai's reply", metadata: { custom: { turnId: "turn-1" } } }],
  });
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

function renderChip() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ChipUnderTest />
    </MemoryRouter>,
  );
}

describe("MemoryUpdatedChip", () => {
  test("shows once a memory.updated notification names this message's turn", async () => {
    const restore = stubNotifications([notification("turn-1", ["mem-1", "mem-2"])]);
    try {
      const { findByText, findByRole } = renderChip();
      await findByText("Memory updated");
      const link = await findByRole("link", { name: /Memory updated/ });
      expect(link.getAttribute("href")).toBe("/memory?ids=mem-1,mem-2");
    } finally {
      restore();
    }
  });

  test("stays hidden when no notification names this message's turn", async () => {
    const restore = stubNotifications([notification("some-other-turn", ["mem-3"])]);
    try {
      const { queryByText } = renderChip();
      // Nothing to await on for absence; give the query a tick to settle.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
    } finally {
      restore();
    }
  });

  test("stays hidden while NotificationDeliveryView has no payload field at all (today's honest state)", async () => {
    const restore = stubNotifications([
      { id: "n1", typeId: "memory.updated", text: "Memory updated", channels: ["in_app"], createdAt: "2026-09-05T00:00:00.000Z", readAt: null, dismissedAt: null },
    ]);
    try {
      const { queryByText } = renderChip();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
    } finally {
      restore();
    }
  });
});
