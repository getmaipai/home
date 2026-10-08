import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatComposerNoticeContext, type ChatComposerNoticeValue } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

// CHAT-COMPOSER-SLOT-01: the one-line slot under the composer is always there,
// empty or not, in a new chat (composer centered or docked) and in an existing
// chat. An empty slot still takes its line, so the composer's bottom spacing
// never changes when a notice appears or goes away.
const NOOP: ChatModelAdapter = { run: async function* () { /* messages are seeded */ } };
const done = { type: "complete", reason: "stop" } as const;
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "Hello" }] },
  { role: "assistant", content: [{ type: "text", text: "Hi." }], status: done },
];
const NOTICE: ChatComposerNoticeValue = { text: "Chat is paused.", repairsLink: null };

function Harness({ messages, notice }: { messages: ThreadMessageLike[]; notice: ChatComposerNoticeValue | null }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: messages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatComposerNoticeContext.Provider value={notice}><ChatThread /></ChatComposerNoticeContext.Provider>
    </AssistantRuntimeProvider>
  );
}
const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch; });
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

async function slot(messages: ThreadMessageLike[], notice: ChatComposerNoticeValue | null) {
  const view = renderWithQueryClient(<MemoryRouter><Harness messages={messages} notice={notice} /></MemoryRouter>);
  await waitFor(() => expect(view.container.querySelector('[data-slot="aui_composer-notice"]')).not.toBeNull());
  return view.container.querySelector('[data-slot="aui_composer-notice"]') as HTMLElement;
}

describe("composer notice slot keeps its line", () => {
  for (const [name, messages] of [["new chat", [] as ThreadMessageLike[]], ["existing chat", MESSAGES]] as const) {
    // jsdom has no layout: the kit's reserved slot is a fixed h-6 single line
    // (composerNoticeReserve), checked by class here and by measured pixels in
    // scripts/screenshotComposerSlot.ts.
    test(`${name}: an empty slot is the fixed one-line slot`, async () => {
      const el = await slot(messages, null);
      expect(el.querySelector("[data-chat-notice]")).toBeNull();
      expect(el.className).toContain("h-6");
      expect(el.className).toContain("truncate");
    });
    test(`${name}: a notice fills the same fixed slot`, async () => {
      const el = await slot(messages, NOTICE);
      expect(el.querySelector("[data-chat-notice-text]")?.textContent).toBe(NOTICE.text);
      expect(el.className).toContain("h-6");
      expect(el.className).toContain("truncate");
    });
  }
});
