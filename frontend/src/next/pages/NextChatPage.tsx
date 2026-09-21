import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AssistantRuntimeProvider, useAui, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { ThreadList } from "@maipai/ui/src/elements/thread-list.aui";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { getIcon } from "@maipai/ui/src/icons";
import { api, type Roster } from "@/lib/api";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

const HistoryIcon = getIcon("history");

/** /next/chat: SHELL-02's slice 2 (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's own wiring table) - the Elements thread LIST
 * (ui/src/elements/thread-list.aui.tsx, self-contained: New Thread,
 * search, grouped items, rename, delete) joins slice 1's thread on
 * Home's existing thread-list adapter (chatThreadListAdapter.ts,
 * already proven by ChatPage.tsx): open a past conversation, continue
 * it, start a new one, delete one. `getConversationId` is real now
 * (`useRemoteThreadListRuntime`'s own `runtimeHook`, ChatPage.tsx's
 * exact pattern) - slice 1's "no thread list, so no id to resolve"
 * comment no longer applies.
 *
 * No Pin here: the shipped Element's own "more" menu is Rename /
 * Archive / Delete, not Rename / Pin / Delete - the OLD shell's own
 * `assistant-ui/thread-list.aui.tsx` (Home's own product composition,
 * outside the vendored path) added Pin by hand against
 * `updateCustom({pinned})`; the vendored Elements version never grew
 * that action, and forking it to add one would be exactly what "the
 * kit wraps and composes, it does not fork" forbids. Archive itself
 * stays wired to `chatThreadListAdapter.ts`'s own deliberate refusal
 * ("the shared record has no archive state") - that decision predates
 * this slice and isn't this slice's call to revisit.
 *
 * Attachments, suggestions, tools and artifacts are each their own
 * follow-up slice (the wiring table's remaining rows). `speakReplies:
 * false` still holds - no "stop speaking" control on screen yet. */
function useNextChatRuntime(person: Roster, closeSheet: () => void) {
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name), [person.display_name]);

  // A named, `use`-prefixed function, not an inline arrow - ChatPage.tsx's
  // own comment on why: `useRemoteThreadListRuntime` calls `runtimeHook`
  // from inside its own render, so react-hooks/rules-of-hooks needs the
  // naming convention to recognize this as a real hook call.
  function useChatRuntimeHook() {
    const aui = useAui();
    const chatModelAdapter = useMemo(
      () =>
        createChatModelAdapter({
          getConversationId: async () => {
            const { remoteId } = await aui.threadListItem().initialize();
            await api.resumeConversation(remoteId);
            return remoteId;
          },
          consumeThinking: () => true,
          consumeSupersedes: () => undefined,
          onCrisisResources: setBanner,
          turnSchedulerRef,
          speakReplies: false,
        }),
      [aui],
    );
    return useLocalRuntime(chatModelAdapter);
  }

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatRuntimeHook,
    adapter: threadListAdapter,
    threadId: searchParams.get("conversation") ?? undefined,
    onThreadIdChange: (id) => {
      setSearchParams(id ? { conversation: id } : {}, { replace: true });
      closeSheet();
    },
  });

  return { runtime, banner };
}

export function NextChatPage({ person }: { person: Roster }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { runtime, banner } = useNextChatRuntime(person, () => setSheetOpen(false));
  // One element, rendered at both the desktop rail and the phone/tablet
  // Sheet below - ChatPage.tsx's own fix for exactly this (a code
  // review caught the two call sites drifting once one grew props the
  // other didn't).
  const threadList = <ThreadList />;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-[calc(100vh-140px)] flex-col">
        <div className="flex items-center border-b border-border pb-2 lg:hidden">
          <Button variant="ghost" size="icon" aria-label={sheetOpen ? "Hide threads" : "Show threads"} aria-expanded={sheetOpen} aria-controls="next-chat-threads" onClick={() => setSheetOpen((open) => !open)}>
            <HistoryIcon className="size-4" />
          </Button>
        </div>
        {banner ? (
          <Alert className="mx-4 mt-2 mb-2">
            <AlertDescription>{banner}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex min-h-0 flex-1 gap-4">
          {/* `lg:` not `sm:` - tokens.css's own --breakpoint-lg note
              (the kit's 960px default reopens a squeeze at tablet
              width), the same reason ChatPage.tsx's own persistent
              column uses it. */}
          <div className="hidden w-64 shrink-0 overflow-y-auto border-r border-border pr-2 lg:block">
            {threadList}
          </div>
          <div className="min-w-0 flex-1">
            <Thread />
          </div>
        </div>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent id="next-chat-threads" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2 lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Conversations</SheetTitle>
            <SheetDescription>Past conversations</SheetDescription>
          </SheetHeader>
          {threadList}
        </SheetContent>
      </Sheet>
    </AssistantRuntimeProvider>
  );
}
