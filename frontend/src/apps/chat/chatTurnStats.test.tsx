import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ChatTurnStats, ChatTurnStatsVisibleContext } from "@/apps/chat/chatTurnStats";

afterEach(cleanup);

const NEVER_RUNS: ChatModelAdapter = { async *run() {} };
const STATS = {
  prompt_tokens: 143,
  predicted_tokens: 37,
  tokens_per_second: 185,
  time_to_first_token_ms: 120,
  total_time_ms: 900,
  context_tokens: 143,
  context_used_percent: null,
  cache_reuse_tokens: 1157,
  cache_reuse_percent: 89,
  engine: "local b10797-test family.gguf",
  stop_reason: "stop",
};

function StatsUnderTest({ visible, message }: { visible: boolean; message: ThreadMessageLike }) {
  const runtime = useLocalRuntime(NEVER_RUNS, { initialMessages: [message] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatTurnStatsVisibleContext.Provider value={visible}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Viewport>
            <ThreadPrimitive.Messages>{() => <ChatTurnStats />}</ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </ChatTurnStatsVisibleContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function replyMessage(): ThreadMessageLike {
  return { id: "reply-stats", role: "assistant", content: "Hello.", metadata: { custom: { stats: STATS } } };
}

describe("ChatTurnStats (STATS-01)", () => {
  test("is off by default and renders nothing while the adult toggle is off", () => {
    const { queryByRole } = renderWithQueryClient(<StatsUnderTest visible={false} message={replyMessage()} />);
    expect(queryByRole("button", { name: "View reply stats" })).toBeNull();
  });

  test("shows the compact line and full list when the adult toggle is on", async () => {
    const view = renderWithQueryClient(<StatsUnderTest visible message={replyMessage()} />);
    expect(await view.findByText(/143 prompt/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "View reply stats" }));
    expect(await view.findByText("Reply details")).toBeInTheDocument();
    expect(view.getByText("local b10797-test family.gguf")).toBeInTheDocument();
  });

  test("child-band projection stays hidden even when stats metadata exists", () => {
    const { queryByText } = renderWithQueryClient(<StatsUnderTest visible={false} message={replyMessage()} />);
    expect(queryByText(/143 prompt/)).toBeNull();
    expect(queryByText("Reply details")).toBeNull();
  });
});
