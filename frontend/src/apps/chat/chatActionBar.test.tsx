import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  type ChatModelAdapter,
  type ThreadMessageLike,
  useLocalRuntime,
} from "@assistant-ui/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ChatChildBandContext, createChatFeedbackAdapter, FeedbackButtons } from "@/apps/chat/chatActionBar";
import { api } from "@/lib/api";

afterEach(cleanup);

const NEVER_RUNS: ChatModelAdapter = {
  async *run() {
    /* never invoked - the message under test is seeded via initialMessages */
  },
};

function replyMessage(turnId: string): ThreadMessageLike {
  return {
    id: `${turnId}-reply`,
    role: "assistant",
    content: "A reply",
    metadata: { custom: { turnId } },
  };
}

function FeedbackUnderTest({ childBand = false }: { childBand?: boolean }) {
  const runtime = useLocalRuntime(NEVER_RUNS, {
    initialMessages: [replyMessage("turn-abc123")],
    adapters: { feedback: createChatFeedbackAdapter() },
  });
  return (
    <ChatChildBandContext.Provider value={childBand}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages>{() => <MessagePrimitive.Root><FeedbackButtons /></MessagePrimitive.Root>}</ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </ChatChildBandContext.Provider>
  );
}

function stubFeedbackSubmit() {
  const submit = spyOn(api, "submitConversationFeedback").mockResolvedValue({} as never);
  return { submit, restore: () => submit.mockRestore() };
}

describe("FeedbackButtons", () => {
  test("positive and negative taps use the feedback adapter and a down tap opens five reason chips", async () => {
    const feedback = stubFeedbackSubmit();
    try {
      const view = renderWithQueryClient(<FeedbackUnderTest />);
      const positive = await view.findByRole("button", { name: "Helpful" });
      const negative = await view.findByRole("button", { name: "Not helpful" });
      fireEvent.click(positive);
      fireEvent.click(negative);
      expect(feedback.submit).toHaveBeenNthCalledWith(1, "turn-abc123", "up");
      expect(feedback.submit).toHaveBeenNthCalledWith(2, "turn-abc123", "down");
      await waitFor(() => expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')).toBeTruthy());
      expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')?.querySelectorAll("button")).toHaveLength(5);
    } finally {
      feedback.restore();
    }
  });

  test("a reason chip resends the down rating with its selected reason", async () => {
    const feedback = stubFeedbackSubmit();
    try {
      const view = renderWithQueryClient(<FeedbackUnderTest />);
      fireEvent.click(await view.findByRole("button", { name: "Not helpful" }));
      fireEvent.click(await view.findByRole("button", { name: "Too long" }));
      await waitFor(() => expect(feedback.submit).toHaveBeenCalledTimes(2));
      expect(feedback.submit).toHaveBeenNthCalledWith(2, "turn-abc123", "down", "too_long");
    } finally {
      feedback.restore();
    }
  });

  test("the child band has the two buttons only", async () => {
    const feedback = stubFeedbackSubmit();
    try {
      const view = renderWithQueryClient(<FeedbackUnderTest childBand />);
      fireEvent.click(await view.findByRole("button", { name: "Not helpful" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')).toBeNull();
      expect(feedback.submit).toHaveBeenCalledTimes(1);
    } finally {
      feedback.restore();
    }
  });
});
