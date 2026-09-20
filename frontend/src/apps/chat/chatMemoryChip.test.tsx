import { describe, expect, test, mock, afterEach } from "bun:test";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
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

function Location() {
  return <div data-testid="location">{useLocation().pathname + useLocation().search}</div>;
}

function renderChip(message: ThreadMessageLike) {
  return renderWithQueryClient(
    <MemoryRouter>
      <TooltipProvider>
        <Location />
        <ChipUnderTest message={message} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

// Radix's PopoverTrigger opens on pointerdown, not a plain click;
// happy-dom's click alone leaves it closed.
function openPopover(trigger: HTMLElement): void {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
  });
}

describe("MemoryUpdatedChip", () => {
  test("saved: shows the chip, and its Edit action navigates to the memory page with real memory_ids", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText, findByRole, getByTestId } = renderChip(
        replyMessage("turn-saved", { conversationId: "conv-1", source: "model", judgeStatus: "done", memoryIds: ["mem-1", "mem-2"] }),
      );
      await findByText("Remembered");
      openPopover(await findByRole("button", { name: /Remembered/ }));
      fireEvent.click(await findByRole("button", { name: "Edit" }));
      expect(getByTestId("location").textContent).toBe("/memory?ids=mem-1,mem-2");
    } finally {
      restore();
    }
  });

  // Jesse, 2026-09-13: pending is process, not an outcome - a person
  // should see this chip only once something has actually happened
  // ("Remembered"/"Memory wasn't saved"), never a mid-flight "Checking
  // for memories". The state machine (chatMemoryState.ts) still tracks
  // pending exactly as before; only the chip's own rendering of it
  // changed, to nothing.
  test("pending: a model turn not yet judged renders no chip at all", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { container } = renderChip(replyMessage("turn-pending", { conversationId: "conv-1", source: "model", judgeStatus: null, memoryIds: [] }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.querySelector('[data-slot="chat-memory-chip"]')).toBeNull();
    } finally {
      restore();
    }
  });

  test("pending: a live reply with no judgeStatus field at all also renders nothing", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { container } = renderChip(replyMessage("turn-live", { conversationId: "conv-1", source: "model" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.querySelector('[data-slot="chat-memory-chip"]')).toBeNull();
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
      expect(queryByText("Remembered")).toBeNull();
    } finally {
      restore();
    }
  });

  test("not_saved: a plugin-sourced turn (never queued for judging) shows no chip", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { container } = renderChip(
        replyMessage("turn-plugin", { conversationId: "conv-1", source: "plugin", judgeStatus: null, memoryIds: [] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.querySelector('[data-slot="chat-memory-chip"]')).toBeNull();
    } finally {
      restore();
    }
  });

  test("failed: a judge that couldn't parse the turn shows the failed chip, which navigates to the memory page on tap (no popover)", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { findByText, findByRole, getByTestId } = renderChip(
        replyMessage("turn-failed", { conversationId: "conv-1", source: "model", judgeStatus: "failed", memoryIds: [] }),
      );
      await findByText("Memory wasn't saved");
      fireEvent.click(await findByRole("button", { name: /Memory wasn't saved/ }));
      expect(getByTestId("location").textContent).toBe("/memory");
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
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
      await findByText("Remembered");
    } finally {
      restore();
    }
  });

  // CHAT-20's own acceptance: "forget from the chip updates the message."
  // ForgetThisMenuItem (chatActionBar.tsx) calls exactly this same
  // forgetMessage() on a click; this proves the chip really does update
  // once it resolves, without needing to drive the popover's own click
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
      await findByText("Remembered");

      await forgetMessage("turn-forget", ["mem-1"]);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryByText("Remembered")).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("renders nothing at all (not even a seed) without a turnId", async () => {
    const restore = stubFetchNeverCalled();
    try {
      const { container } = renderChip({ id: "no-turn", role: "assistant", content: "no metadata" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.querySelector('[data-slot="chat-memory-chip"]')).toBeNull();
    } finally {
      restore();
    }
  });
});
