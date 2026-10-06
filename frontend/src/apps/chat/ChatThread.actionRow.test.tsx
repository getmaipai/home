import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { api } from "@/lib/api";

// CHAT-ACTION-ROW-01: the reply action row does not depend on which assistant
// reply is last. The same row (the same controls a child already has on the
// last reply, no reasons row, nothing new) sits under every finished reply.
const NOOP: ChatModelAdapter = { run: async function* () { /* messages are seeded */ } };
const done = { type: "complete", reason: "stop" } as const;
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "First question" }] },
  { role: "assistant", content: [{ type: "text", text: "First answer." }], status: done, metadata: { custom: { turnId: "turn-1" } } },
  { role: "user", content: [{ type: "text", text: "Second question" }] },
  { role: "assistant", content: [{ type: "text", text: "Second answer." }], status: done, metadata: { custom: { turnId: "turn-2" } } },
];

function Harness() {
  const runtime = useLocalRuntime(NOOP, { initialMessages: MESSAGES, adapters: { feedback: createChatFeedbackAdapter() } });
  return <AssistantRuntimeProvider runtime={runtime}><ChatThread /></AssistantRuntimeProvider>;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const ROW = ".aui-assistant-action-bar-root";
const labels = (row: Element) => Array.from(row.querySelectorAll("button")).map((b) => b.textContent?.trim() ?? "");

describe("the reply action row", () => {
  test("sits under every finished reply with the same controls, not only the last", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelectorAll(ROW)).toHaveLength(2));
    const [first, last] = Array.from(view.container.querySelectorAll(ROW));
    expect(labels(first!).length).toBeGreaterThanOrEqual(4);
    expect(labels(first!)).toEqual(labels(last!));
    for (const name of ["Copy", "Helpful", "Not helpful", "Refresh", "More"]) {
      expect(first!.textContent).toContain(name);
    }
  });

  test("a child gets the same row on an earlier reply: a rating goes to that reply's turn and opens no reasons row", async () => {
    const submit = spyOn(api, "submitConversationFeedback").mockResolvedValue({} as never);
    try {
      const view = renderWithQueryClient(<MemoryRouter><Harness /></MemoryRouter>);
      await waitFor(() => expect(view.container.querySelectorAll(ROW)).toHaveLength(2));
      const first = view.container.querySelectorAll(ROW)[0]!;
      const down = Array.from(first.querySelectorAll("button")).find((b) => b.textContent?.includes("Not helpful"))!;
      fireEvent.click(down);
      expect(submit).toHaveBeenCalledWith("turn-1", "down");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(view.container.querySelector('[data-slot="chat-feedback-reasons"]')).toBeNull();
    } finally {
      submit.mockRestore();
    }
  });
});
