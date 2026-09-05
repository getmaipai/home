import type { RemoteThreadListAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { createChatHistoryAdapter } from "@/apps/chat/chatHistoryAdapter";
import { messageText } from "@/apps/chat/chatMessageText";

// Mocked (docs/plans/session-b-ui.md step 4): the backend has exactly one
// conversation per person today (lib/conversationHistory.ts's flat turn
// list, GET /api/conversations) - session-a-intelligence.md's contract
// adds the real per-thread CRUD routes (list/create/patch/delete/batch-
// delete/clear) this adapter is meant to call, not yet merged to `main`.
// Everything here maps onto that one real conversation; "new"/rename/
// archive/delete are accepted but don't yet do anything a reload would
// notice. Swap the bodies below for real `api.*` calls once Session A's
// routes land (rebase and check) - the shape (RemoteThreadListAdapter)
// and the call sites (chatThreadListAdapter.ts is the only file that
// needs to change) stay the same either way.
const MAIN_THREAD_ID = "main";

export function createChatThreadListAdapter(selfName: string): RemoteThreadListAdapter {
  let title: string | undefined;

  return {
    async list() {
      return {
        threads: [
          {
            status: "regular",
            remoteId: MAIN_THREAD_ID,
            title: title ?? "Chat",
          },
        ],
      };
    },
    async rename(_remoteId, newTitle) {
      title = newTitle;
    },
    async archive() {},
    async unarchive() {},
    async delete() {},
    async initialize() {
      // Every local thread maps onto the one real conversation until
      // Session A's per-thread routes exist - there is nowhere else for a
      // "new" thread to go yet.
      return { remoteId: MAIN_THREAD_ID };
    },
    async fetch() {
      return { status: "regular", remoteId: MAIN_THREAD_ID, title: title ?? "Chat" };
    },
    // No model call: a real auto-generated title (summarizing via the chat
    // model) is real future scope once thread creation itself is real: for
    // now this just reads the first line of the first thing the household
    // member said, which is what "Chat" would otherwise sit as forever.
    async generateTitle(_remoteId, messages) {
      const firstUser = messages.find((m) => m.role === "user");
      const text = messageText(firstUser).trim();
      const derived = text.length > 0 ? text.slice(0, 60) : "Chat";
      return createAssistantStream((controller) => {
        controller.appendText(derived);
      });
    },
    unstable_useAdapters: () => ({ history: createChatHistoryAdapter(selfName) }),
  };
}
