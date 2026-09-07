import { describe, expect, test, afterEach } from "bun:test";
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

afterEach(cleanup);

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
    const { findByText, findByRole } = renderChip(replyMessage(["mem-1", "mem-2"]));
    await findByText("Memory updated");
    const link = await findByRole("link", { name: /Memory updated/ });
    expect(link.getAttribute("href")).toBe("/memory?ids=mem-1,mem-2");
  });

  test("stays hidden when the message carries an empty memory_ids list", async () => {
    const { queryByText } = renderChip(replyMessage([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryByText("Memory updated")).toBeNull();
  });

  test("stays hidden when the message has no memoryIds metadata at all", async () => {
    const { queryByText } = renderChip(replyMessage(undefined));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryByText("Memory updated")).toBeNull();
  });
});
