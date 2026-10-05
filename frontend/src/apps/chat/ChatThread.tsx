import { createContext, useCallback, useMemo, useRef, type RefObject } from "react";
import { useAssistantToolUI } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { MODEL_SELECTOR_SLOT, THREAD_SLOTS, TOOL_BINDINGS, type ToolBinding } from "@/apps/chat/elementBindings";
import { ChatConnectionBanner } from "@/apps/chat/chatConnectionBanner";
import { ChatThreadExtras } from "@/apps/chat/ChatThreadExtras";

export type ChatExtrasContextValue = {
  rootRef: RefObject<HTMLDivElement | null>;
  canUseIncognito: boolean;
  focusChatSearch: () => void;
  toggleSidebar: () => void;
  openSettings?: () => void;
};

export const ChatExtrasContext = createContext<ChatExtrasContextValue | null>(null);

// SHARED-THREAD-01: the one thread composition. The chat page and the /dev/ui
// showcase both render this and nothing else for the thread; which Element
// renders what lives in elementBindings.ts. A page passes behaviour props (the
// runtime comes from the AssistantRuntimeProvider around this), never its own
// slot components. Chat-only wiring (providers for the artifact canvas,
// sources panel, ...) wraps this in the page; the contexts default safely.

function ElementBinding({ binding }: { binding: ToolBinding }) {
  useAssistantToolUI({ toolName: binding.toolName, render: binding.render, display: "standalone" });
  return null;
}

export function ChatThread({ temporary, onEditSend, modelPickerAllowed = true, canUseIncognito = false, onOpenSettings }: {
  /** Incognito: the kit's temporary-thread styling. */
  temporary?: boolean;
  /** Called with the superseded turn id when an edited message is sent. */
  onEditSend?: (messageId: string, turnId?: string) => void;
  /** Gate for the composer's model selector (it also hides itself under two models). */
  modelPickerAllowed?: boolean;
  /** The signed-in person can use Incognito. */
  canUseIncognito?: boolean;
  /** Open the app's Settings route. */
  onOpenSettings?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const focusChatSearch = useCallback(() => {
    const focus = () => document.querySelector<HTMLInputElement>('[aria-label="Search chats"]')?.focus();
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search chats"]');
    if (search?.getClientRects().length) {
      search.focus();
      return;
    }
    document.querySelector<HTMLButtonElement>('[aria-label="Show conversations"], [aria-label="Show threads"]')?.click();
    window.setTimeout(focus, 100);
  }, []);
  const toggleSidebar = useCallback(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Show conversations"], [aria-label="Hide conversations"], [aria-label="Show threads"], [aria-label="Hide threads"]')?.click();
  }, []);
  const extraContext = useMemo(() => ({ rootRef, canUseIncognito, focusChatSearch, toggleSidebar, openSettings: onOpenSettings }), [canUseIncognito, focusChatSearch, onOpenSettings, toggleSidebar]);
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("input, button, a, textarea, select, [contenteditable='true']")) return;
        rootRef.current?.focus();
      }}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {TOOL_BINDINGS.map((binding) => <ElementBinding key={binding.toolName} binding={binding} />)}
      <div className="flex justify-center">
        <ChatConnectionBanner />
      </div>
      <ChatExtrasContext.Provider value={extraContext}>
        <Thread
          temporary={temporary}
          components={{
            ...THREAD_SLOTS,
            onEditSend,
            ThreadViewportExtra: ChatThreadExtras,
            viewport: {
              turnAnchor: "bottom",
              autoScroll: true,
              scrollToBottomOnRunStart: true,
              scrollToBottomOnInitialize: true,
              scrollToBottomOnThreadSwitch: true,
            },
            ComposerExtra: modelPickerAllowed ? MODEL_SELECTOR_SLOT : undefined,
          }}
        />
      </ChatExtrasContext.Provider>
    </div>
  );
}
