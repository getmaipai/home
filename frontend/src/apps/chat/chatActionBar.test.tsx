import { afterEach, describe, expect, mock, test } from "bun:test";
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

function stubFeedbackFetch() {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), body: String(init?.body ?? "") });
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("FeedbackButtons", () => {
  test("positive and negative taps use the feedback adapter and a down tap opens five reason chips", async () => {
    const fetchStub = stubFeedbackFetch();
    try {
      const view = renderWithQueryClient(<FeedbackUnderTest />);
      const positive = await view.findByRole("button", { name: "Helpful" });
      const negative = await view.findByRole("button", { name: "Not helpful" });
      fireEvent.click(positive);
      fireEvent.click(negative);
      expect(fetchStub.calls.map((call) => JSON.parse(call.body).verdict)).toEqual(["up", "down"]);
      await waitFor(() => expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')).toBeTruthy());
      expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')?.querySelectorAll("button")).toHaveLength(5);
    } finally {
      fetchStub.restore();
    }
  });

  test("a reason chip resends the down rating with its selected reason", async () => {
    const fetchStub = stubFeedbackFetch();
    try {
      const view = renderWithQueryClient(<FeedbackUnderTest />);
      fireEvent.click(await view.findByRole("button", { name: "Not helpful" }));
      fireEvent.click(await view.findByRole("button", { name: "Too long" }));
      await waitFor(() => expect(fetchStub.calls).toHaveLength(2));
      expect(JSON.parse(fetchStub.calls[1]!.body)).toMatchObject({ verdict: "down", reason: "too_long" });
    } finally {
      fetchStub.restore();
    }
  });

  test("the child band has the two buttons only", async () => {
    const fetchStub = stubFeedbackFetch();
    try {
      const view = renderWithQueryClient(<FeedbackUnderTest childBand />);
      fireEvent.click(await view.findByRole("button", { name: "Not helpful" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')).toBeNull();
      expect(fetchStub.calls).toHaveLength(1);
    } finally {
      fetchStub.restore();
    }
  });
});
