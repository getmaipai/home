import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { AdminContext, ChatAgeBandContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// DOCS-GAP-07: the "Turn trace" entry in a reply's More menu is an owner or
// admin link to /trace/:turnId; an adult never sees it, and Incognito has no trace.
const NOOP: ChatModelAdapter = { run: async function* () { /* messages are seeded */ } };
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "Question" }] },
  { role: "assistant", content: [{ type: "text", text: "Answer." }], status: { type: "complete", reason: "stop" }, metadata: { custom: { turnId: "turn-abc" } } },
];

function Harness({ admin, temporary = false }: { admin: boolean; temporary?: boolean }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: MESSAGES });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AdminContext.Provider value={admin}>
        <TemporaryChatContext.Provider value={{ on: temporary }}>
          <ChatAgeBandContext.Provider value="adult"><ChatThread /></ChatAgeBandContext.Provider>
        </TemporaryChatContext.Provider>
      </AdminContext.Provider>
    </AssistantRuntimeProvider>
  );
}

async function openMore(admin: boolean, temporary = false) {
  const view = renderWithQueryClient(<MemoryRouter><Harness admin={admin} temporary={temporary} /></MemoryRouter>);
  const trigger = await view.findByRole("button", { name: "More" });
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
  });
  await waitFor(() => expect(view.queryAllByRole("menuitem").length).toBeGreaterThan(0));
  return view;
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

describe("Turn trace menu item", () => {
  test("an admin sees a Turn trace link to that reply's trace page", async () => {
    const view = await openMore(true);
    const item = await view.findByRole("menuitem", { name: /Turn trace/ });
    const link = item.tagName === "A" ? item : item.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/trace/turn-abc");
  });

  test("an adult who is not an admin does not see it", async () => {
    const view = await openMore(false);
    expect(view.queryByRole("menuitem", { name: /Turn trace/ })).toBeNull();
  });

  test("an admin in Incognito does not see it", async () => {
    const view = await openMore(true, true);
    expect(view.queryByRole("menuitem", { name: /Turn trace/ })).toBeNull();
  });
});
