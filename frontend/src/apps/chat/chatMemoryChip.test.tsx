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
import { forgetMessage } from "@/apps/chat/chatMemoryActions";

afterEach(cleanup);

// CHAT-20: the chip reads chatMemoryState.ts's own store, seeded from a
// message's `source`/`judgeStatus`/`memoryIds` metadata (a loaded row's
// real fields, or a live reply's `source` alone - the judge hasn't run
// yet at that point) - never network calls on its own; a poll (mounted
// separately, at the chat page's own top level) is what keeps a pending
// entry current. Every test here uses its own turnId: the store is a
// module-level singleton, and a shared id across tests would leak state
// (chatMemoryActions.test.ts's own established pattern).
function stubFetchNeverCalled(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.reject(new Error("chip should never fetch on its own"))) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

const NEVER_RUNS: ChatModelAdapter = {
  async *run() {
    /* never invoked - the message under test is seeded via initialMessages */
  },
};

function replyMessage(turnId: string, custom: Record<string, unknown>): ThreadMessageLike {
  return {
    id: `${turnId}-reply`,
    role: "assistant",
    content: "MaiPai's reply",
    metadata: { custom: { turnId, ...custom } },
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
  test("saved: shows the linked chip when the row already carries real memory_ids", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText, findByRole } = renderChip(
        replyMessage("turn-saved", { conversationId: "conv-1", source: "model", judgeStatus: "done", memoryIds: ["mem-1", "mem-2"] }),
      );
      await findByText("Memory updated");
      const link = await findByRole("link", { name: /Memory updated/ });
      expect(link.getAttribute("href")).toBe("/memory?ids=mem-1,mem-2");
    } finally {
      restore();
    }
  });

  test("pending: a model turn not yet judged shows 'Checking for memories'", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText } = renderChip(replyMessage("turn-pending", { conversationId: "conv-1", source: "model", judgeStatus: null, memoryIds: [] }));
      await findByText("Checking for memories");
    } finally {
      restore();
    }
  });

  test("pending: a live reply with no judgeStatus field at all reads the same as a fresh unjudged row", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText } = renderChip(replyMessage("turn-live", { conversationId: "conv-1", source: "model" }));
      await findByText("Checking for memories");
    } finally {
      restore();
    }
  });

  test("not_saved: a judged model turn with nothing worth remembering shows no chip", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { queryByText } = renderChip(
        replyMessage("turn-not-saved", { conversationId: "conv-1", source: "model", judgeStatus: "done", memoryIds: [] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
      expect(queryByText("Checking for memories")).toBeNull();
    } finally {
      restore();
    }
  });

  test("not_saved: a plugin-sourced turn (never queued for judging) shows no chip", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { queryByText } = renderChip(
        replyMessage("turn-plugin", { conversationId: "conv-1", source: "plugin", judgeStatus: null, memoryIds: [] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Checking for memories")).toBeNull();
    } finally {
      restore();
    }
  });

  test("failed: a judge that couldn't parse the turn shows the failed chip, linked to the memory page", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText, findByRole } = renderChip(
        replyMessage("turn-failed", { conversationId: "conv-1", source: "model", judgeStatus: "failed", memoryIds: [] }),
      );
      await findByText("Memory wasn't saved");
      const link = await findByRole("link", { name: /Memory wasn't saved/ });
      expect(link.getAttribute("href")).toBe("/memory");
    } finally {
      restore();
    }
  });

  test("a manual save always wins over a pending/not_saved judge status, regardless of source", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText } = renderChip(
        replyMessage("turn-manual-save", { conversationId: "conv-1", source: "plugin", judgeStatus: null, memoryIds: ["mem-manual"] }),
      );
      await findByText("Memory updated");
    } finally {
      restore();
    }
  });

  // CHAT-20's own acceptance: "forget from the chip updates the message."
  // ForgetThisMenuItem (chatActionBar.tsx) calls exactly this same
  // forgetMessage() on a click; this proves the chip really does update
  // once it resolves, without needing to drive the menu item's own click
  // handler through a portal.
  test("forgetting a saved message's memory turns the chip off", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/archive")) return Promise.resolve(new Response(JSON.stringify({ id: "mem-1", status: "archived" }), { status: 200 }));
      return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    }) as unknown as typeof fetch;
    try {
      const { findByText, queryByText } = renderChip(
        replyMessage("turn-forget", { conversationId: "conv-1", source: "model", judgeStatus: "done", memoryIds: ["mem-1"] }),
      );
      await findByText("Memory updated");

      await forgetMessage("turn-forget", ["mem-1"]);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Memory updated")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("renders nothing at all (not even a seed) without a turnId", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { container } = renderChip({ id: "no-turn", role: "assistant", content: "no metadata" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.textContent).toBe("");
    } finally {
      restore();
    }
  });
});
